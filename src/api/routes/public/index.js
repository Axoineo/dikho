import { Hono } from 'hono'
import { parseJson } from '../../middleware/errorHandler.js'
import { ok } from '../../utils/response.js'
import { verifyTurnstile } from '../../services/turnstile.js'
import { callRpc } from '../../services/supabaseRpc.js'

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

/**
 * Public vendor registration — src/features/public/PublicVendorForm.jsx.
 * The document upload still goes to Supabase storage straight from the browser;
 * only the vendor + address rows come through here.
 */
publicRoutes.post('/vendor', async (c) => {
  const body = await parseJson(c)
  await verifyTurnstile(c, body?.[TOKEN_FIELD], ACTION_VENDOR_REGISTER)

  // The RPC whitelists and coerces every column itself, and assigns `status`
  // and `opening_balance` server-side, so the payload is passed through as-is
  // rather than re-validated here.
  const id = await callRpc(c, 'public_register_vendor', {
    p_vendor: body?.vendor ?? {},
    p_address: body?.address ?? {},
  })

  return ok(c, { id })
})

/**
 * Corporate-gifting lead — src/features/public/PublicClientWelcome.jsx.
 */
publicRoutes.post('/cg-lead', async (c) => {
  const body = await parseJson(c)
  await verifyTurnstile(c, body?.[TOKEN_FIELD], ACTION_CG_LEAD)

  await callRpc(c, 'public_submit_cg_lead', { p_lead: body?.lead ?? {} })

  return ok(c, { submitted: true })
})

export default publicRoutes
