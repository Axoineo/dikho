import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok } from '../../utils/response.js'
import { formFile, readBoundedFormData, readBoundedJson } from '../../utils/body.js'
import { EXTENSION_FOR, safeDisplayName, sniffType } from '../../utils/fileType.js'
import { verifyTurnstile } from '../../services/turnstile.js'
import { callRpc } from '../../services/supabaseRpc.js'
import { removeObject, uploadObject } from '../../services/supabaseStorage.js'
import { enqueueCgLeadConfirmation } from '../../services/whatsapp/cgLeadConfirmation.js'

// Unauthenticated write endpoints for the two public forms. These are the only
// routes under /api that accept a write from someone with no session, so each
// one is gated on a Turnstile token before it reaches Supabase.
//
// Flow per submit:
//   browser renders the widget with `action` ──► token
//   POST here with { "cf-turnstile-response": token, ...payload }
//   verifyTurnstile() ──► siteverify (success + action + hostname)
//   callRpc() with the service-role key ──► SECURITY DEFINER RPC
//
// Deliberately NOT registered behind requireAuth in app.js — the whole point is
// that the public has no session. Turnstile is what stands in for one.
const publicRoutes = new Hono()

// Bound to the `data-action` / `action:` value each form renders its widget
// with. Keep these in sync with src/features/public/* — a mismatch makes every
// submit fail the action check (and shows up as turnstile.rejected in the logs).
const ACTION_VENDOR_REGISTER = 'vendor-register'
const ACTION_CG_LEAD = 'cg-lead'

// The field name Cloudflare's own docs use for the token, kept verbatim so this
// matches what a plain (non-JS) Turnstile form post would send.
const TOKEN_FIELD = 'cf-turnstile-response'

// Form payloads are a few hundred bytes of text; 64 KB is generous headroom and
// still small enough that nobody can make the Worker buffer anything sizeable.
const MAX_JSON_BYTES = 64 * 1024

// The vendor's supporting document (GST certificate, PAN card). Matches the
// limit and types the form has always advertised. The whole multipart body is
// capped at the document limit plus the JSON allowance, before it is buffered.
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const MAX_MULTIPART_BYTES = MAX_DOCUMENT_BYTES + MAX_JSON_BYTES
const DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

// Public uploads get their own folder so their provenance (unauthenticated,
// unverified) is visible from the key alone, and the storage policies can
// treat them separately from documents staff attach to a known vendor.
const DOCUMENT_BUCKET = 'Dikho'
const DOCUMENT_PREFIX = 'vendors_documents/public'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Size and type checks run BEFORE Turnstile, because the token is single-use:
// rejecting a wrong file after spending it would make the visitor solve the
// challenge again for a mistake that had nothing to do with it.
async function readDocument(file) {
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new HTTPException(413, { message: 'Document must be smaller than 10 MB.' })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength === 0) throw new HTTPException(400, { message: 'The document is empty.' })

  // The sniffed type, never the browser's claim, decides what is stored and
  // which Content-Type it is later served with.
  const type = sniffType(bytes)
  if (!DOCUMENT_TYPES.has(type)) {
    throw new HTTPException(415, { message: 'Document must be a PDF, JPG, PNG or WEBP file.' })
  }
  return { bytes, type, name: safeDisplayName(file.name) }
}

/**
 * Public vendor registration — src/features/public/PublicVendorForm.jsx.
 *
 * Accepts multipart/form-data (`payload` JSON text, optional `document` file)
 * or a plain JSON body when there is no document. Either way the document is
 * stored by this Worker after Turnstile passes, under a key generated here;
 * the browser has no write access to Storage and cannot choose the path.
 */
publicRoutes.post('/vendor', async (c) => {
  const isMultipart = /^multipart\/form-data/i.test(c.req.header('Content-Type') || '')

  let body
  let document = null
  if (isMultipart) {
    const form = await readBoundedFormData(c, MAX_MULTIPART_BYTES)
    const payload = form.get('payload')
    if (typeof payload !== 'string' || payload.length > MAX_JSON_BYTES) {
      throw new HTTPException(400, { message: 'Missing or oversized form payload' })
    }
    try {
      body = JSON.parse(payload)
    } catch {
      throw new HTTPException(400, { message: 'Invalid form payload' })
    }
    const file = formFile(form, 'document')
    if (file) document = await readDocument(file)
  } else {
    body = await readBoundedJson(c, MAX_JSON_BYTES)
  }

  await verifyTurnstile(c, body?.[TOKEN_FIELD], ACTION_VENDOR_REGISTER)

  // The RPC whitelists and coerces every column itself, and assigns `status`
  // and `opening_balance` server-side. The document columns are the exception:
  // they are owned by this route, so whatever the caller put there is dropped.
  const vendor = { ...(isObject(body?.vendor) ? body.vendor : {}) }
  vendor.vendor_document_file_path = null
  vendor.vendor_document_file_name = null

  let storedPath = null
  if (document) {
    storedPath = `${DOCUMENT_PREFIX}/${crypto.randomUUID()}.${EXTENSION_FOR[document.type]}`
    await uploadObject(c, DOCUMENT_BUCKET, storedPath, document.bytes, document.type)
    vendor.vendor_document_file_path = storedPath
    vendor.vendor_document_file_name = document.name
  }

  let id
  try {
    id = await callRpc(c, 'public_register_vendor', {
      p_vendor: vendor,
      p_address: isObject(body?.address) ? body.address : {},
    })
  } catch (err) {
    // The registration was rejected, so nothing references the document.
    // Remove it now rather than leave an orphan for a cleanup job to find.
    if (storedPath) await removeObject(c, DOCUMENT_BUCKET, storedPath)
    throw err
  }

  return ok(c, { id })
})

/**
 * Corporate-gifting lead — src/features/public/PublicClientWelcome.jsx.
 */
publicRoutes.post('/cg-lead', async (c) => {
  const body = await readBoundedJson(c, MAX_JSON_BYTES)
  await verifyTurnstile(c, body?.[TOKEN_FIELD], ACTION_CG_LEAD)

  const lead = isObject(body?.lead) ? body.lead : {}
  await callRpc(c, 'public_submit_cg_lead', { p_lead: lead })

  // Queues the WhatsApp confirmation for ~7 minutes from now rather than
  // sending it here; the every-minute cron in worker.js does the sending. See
  // services/whatsapp/cgLeadConfirmation.js. Fire-and-forget either way: the
  // visitor's success screen must not wait on this, and a queue failure must
  // never turn an already-saved lead into a visible error.
  c.executionCtx.waitUntil(enqueueCgLeadConfirmation(c.env, lead))

  return ok(c, { submitted: true })
})

export default publicRoutes
