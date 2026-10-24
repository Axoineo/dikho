import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok } from '../../utils/response.js'
import { readBoundedFormData } from '../../utils/body.js'
import { gmail, gmailBatchGet, uploadBody, GmailUncertainError } from '../../services/email/google.js'
import { buildMessage, parseRecipientInput, readMessage, unsafeHeader, isEmail } from '../../services/email/mime.js'
import { sanitizeHtml, htmlToText } from '../../services/email/sanitizeHtml.js'
import { fromBase64url } from '../../services/email/crypto.js'
import { inBackground, syncMailbox } from '../../services/email/sync.js'
import { logError, logEvent } from '../../utils/logger.js'
import {
  actor, rpc, uuidParam, patternParam, withGmail, noStore, UUID, GMAIL_ID, ATTACHMENT_ID, DRAFT_ID,
} from './shared.js'

// Writing mail from a connected mailbox: send (new, reply, reply all,
// forward) and Gmail drafts. Mounted behind requireAuth; responders and above.
//
// A send is attempted once. The browser makes one id per message (send_id);
// em_begin_send records it before Gmail is called, so a double click or a
// retried request returns the first attempt instead of sending again. If
// Gmail does not answer, the send is recorded as "uncertain" and the person is
// told to check Sent before trying again: retrying blindly could send twice.
const compose = new Hono()

const MAX_REQUEST_BYTES = 20 * 1024 * 1024
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
const MAX_FILES = 10
const MAX_RECIPIENTS = 50
const MAX_HTML = 1024 * 1024

const field = (form, name) => {
  const v = form.get(name)
  return typeof v === 'string' ? v : null
}

function cleanFilename(name) {
  return String(name || 'attachment').replace(/[\r\n\0/\\]/g, '_').slice(0, 180) || 'attachment'
}

// Reads and validates the composer's form. No network work happens here.
async function readDraft(c, { requireRecipient }) {
  const form = await readBoundedFormData(c, MAX_REQUEST_BYTES)
  const to = parseRecipientInput(field(form, 'to'), MAX_RECIPIENTS)
  const cc = parseRecipientInput(field(form, 'cc'), MAX_RECIPIENTS)
  const bcc = parseRecipientInput(field(form, 'bcc'), MAX_RECIPIENTS)
  if (!to || !cc || !bcc) throw new HTTPException(400, { message: 'Check the recipients: each must be a valid email address.' })
  const recipients = to.length + cc.length + bcc.length
  if (recipients > MAX_RECIPIENTS) throw new HTTPException(400, { message: `Send to at most ${MAX_RECIPIENTS} people at once. Use a campaign for more.` })
  if (requireRecipient && recipients === 0) throw new HTTPException(400, { message: 'Add at least one recipient.' })

  const subject = (field(form, 'subject') ?? '').trim()
  if (subject.length > 900 || unsafeHeader(subject)) throw new HTTPException(400, { message: 'The subject is too long or contains a line break.' })

  const rawHtml = field(form, 'html') ?? ''
  if (rawHtml.length > MAX_HTML) throw new HTTPException(413, { message: 'The message is too long.' })
  const html = sanitizeHtml(rawHtml, { keepStyles: false }).html
  const text = htmlToText(html)

  const mode = field(form, 'mode') ?? 'new'
  if (!['new', 'reply', 'reply_all', 'forward'].includes(mode)) throw new HTTPException(400, { message: 'Unknown compose mode' })
  const threadId = field(form, 'thread_id')
  if (threadId && !UUID.test(threadId)) throw new HTTPException(400, { message: 'Invalid conversation id' })
  const sourceMessage = field(form, 'source_message_id')
  if (sourceMessage && !GMAIL_ID.test(sourceMessage)) throw new HTTPException(400, { message: 'Invalid message id' })
  if (mode !== 'new' && (!threadId || !sourceMessage)) throw new HTTPException(400, { message: 'Replies and forwards need the original message.' })

  const fromAddress = (field(form, 'from') ?? '').trim().toLowerCase() || null
  if (fromAddress && !isEmail(fromAddress)) throw new HTTPException(400, { message: 'Invalid sender address' })

  let forwardParts = []
  const forwardRaw = field(form, 'forward_attachments')
  if (forwardRaw) {
    try { forwardParts = JSON.parse(forwardRaw) } catch { forwardParts = null }
    if (!Array.isArray(forwardParts) || forwardParts.length > MAX_FILES
        || !forwardParts.every((p) => ATTACHMENT_ID.test(p?.id ?? '') && typeof p?.filename === 'string')) {
      throw new HTTPException(400, { message: 'Invalid forwarded attachments' })
    }
  }

  const files = form.getAll('attachment').filter((f) => f && typeof f === 'object' && typeof f.arrayBuffer === 'function')
  if (files.length + forwardParts.length > MAX_FILES) throw new HTTPException(400, { message: `Attach at most ${MAX_FILES} files.` })
  let total = 0
  const attachments = []
  for (const file of files) {
    total += file.size
    if (total > MAX_ATTACHMENT_BYTES) throw new HTTPException(413, { message: 'Attachments add up to more than 15 MB.' })
    attachments.push({ filename: cleanFilename(file.name), mimeType: String(file.type || '').slice(0, 100), bytes: new Uint8Array(await file.arrayBuffer()) })
  }

  const sendId = (field(form, 'send_id') ?? '').toLowerCase()
  const draftId = field(form, 'draft_id')
  if (draftId && !DRAFT_ID.test(draftId)) throw new HTTPException(400, { message: 'Invalid draft id' })

  return { to, cc, bcc, subject, html, text, mode, threadId, sourceMessage, fromAddress, forwardParts, attachments, total, sendId, draftId }
}

// Everything that needs Gmail before the message can be built: the reply
// headers of the original, forwarded attachments, and the sender identity.
async function prepare(c, account, draft) {
  let gmailThreadId = null
  let inReplyTo = null
  let references = null

  if (draft.threadId) {
    const meta = await rpc(c, 'em_open_thread', { p_actor: actor(c), p_thread: draft.threadId, p_min_role: 'responder' })
    if (meta.thread.account_id !== account.id) throw new HTTPException(400, { message: 'That conversation belongs to another mailbox.' })
    const source = await gmail(c.env, account, `/messages/${draft.sourceMessage}`, {
      query: 'format=metadata&metadataHeaders=Message-ID&metadataHeaders=References',
    })
    if (source?.threadId !== meta.thread.gmail_thread_id) throw new HTTPException(400, { message: 'That message is not part of this conversation.' })
    const parsed = readMessage(source)
    if (draft.mode !== 'forward') {
      gmailThreadId = meta.thread.gmail_thread_id
      const id = /^<[^<>\s]{1,900}>$/.test(parsed.message_id) ? parsed.message_id : null
      if (id) {
        inReplyTo = id
        const refs = parsed.references.split(/\s+/).filter((r) => /^<[^<>\s]{1,900}>$/.test(r)).slice(-20)
        references = [...refs, id].join(' ').slice(-1900)
      }
    }
  }

  const attachments = [...draft.attachments]
  let total = draft.total
  for (const part of draft.forwardParts) {
    const data = await gmail(c.env, account, `/messages/${draft.sourceMessage}/attachments/${part.id}`)
    const bytes = fromBase64url(data?.data ?? '')
    total += bytes.byteLength
    if (total > MAX_ATTACHMENT_BYTES) throw new HTTPException(413, { message: 'Attachments add up to more than 15 MB.' })
    attachments.push({ filename: cleanFilename(part.filename), mimeType: String(part.mime_type || '').slice(0, 100), bytes })
  }

  let from = { email: account.email_address, name: account.display_name || null }
  if (draft.fromAddress && draft.fromAddress !== account.email_address) {
    const sendAs = await gmail(c.env, account, '/settings/sendAs')
    const identity = (sendAs?.sendAs ?? []).find((s) => String(s?.sendAsEmail).toLowerCase() === draft.fromAddress
      && (s.isPrimary || s.verificationStatus === 'accepted'))
    if (!identity) throw new HTTPException(400, { message: 'This mailbox cannot send as that address.' })
    from = { email: draft.fromAddress, name: typeof identity.displayName === 'string' ? identity.displayName.slice(0, 120) : null }
  }

  const raw = buildMessage({
    from, to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, html: draft.html, text: draft.text,
    inReplyTo, references, attachments,
  })
  return { raw, gmailThreadId }
}

compose.post('/accounts/:id/send', async (c) => {
  const id = uuidParam(c)
  const draft = await readDraft(c, { requireRecipient: true })
  const { sendId, draftId } = draft
  if (!UUID.test(sendId)) throw new HTTPException(400, { message: 'Missing send id' })

  const begun = await rpc(c, 'em_begin_send', { p_actor: actor(c), p_account: id, p_send_id: sendId })
  if (begun.duplicate) {
    // Same message submitted again: report the first attempt, send nothing.
    return ok(c, { status: begun.status, duplicate: true, message_id: begun.gmail_message_id ?? null })
  }
  const account = begun.account

  const finish = (status, extra = {}) => rpc(c, 'em_finish_send', {
    p_send_id: sendId, p_status: status, p_message_id: extra.messageId ?? null,
    p_thread_id: extra.threadId ?? null, p_error: extra.error ?? null,
  }).catch((err) => logError('email.send.record_failed', err))

  let prepared
  try {
    prepared = await withGmail(c, account, () => prepare(c, account, draft))
  } catch (err) {
    await finish('failed', { error: 'could not prepare the message' })
    throw err
  }

  let sent
  try {
    sent = await withGmail(c, account, () => gmail(c.env, account, '/messages/send', {
      method: 'POST', retry: false, upload: uploadBody(prepared.gmailThreadId ? { threadId: prepared.gmailThreadId } : {}, prepared.raw),
    }))
  } catch (err) {
    if (err instanceof GmailUncertainError) {
      await finish('uncertain', { error: err.message })
      logEvent('email.send.uncertain', { status: err.status })
      throw new HTTPException(502, { message: 'Gmail did not confirm whether the message was sent. Check the Sent folder before sending it again.' })
    }
    await finish('failed', { error: err?.message ?? 'send refused' })
    throw err
  }

  await finish('sent', { messageId: sent?.id, threadId: sent?.threadId })
  logEvent('email.send.sent', { mode: draft.mode, recipients: draft.to.length + draft.cc.length + draft.bcc.length, attachments: draft.attachments.length + draft.forwardParts.length })
  if (draftId) {
    inBackground(c, gmail(c.env, account, `/drafts/${draftId}`, { method: 'DELETE' }).catch(() => {}))
  }
  inBackground(c, syncMailbox(c.env, id))
  return ok(c, { status: 'sent', message_id: sent?.id ?? null, gmail_thread_id: sent?.threadId ?? null })
})

// ── Drafts (Gmail is where they live) ────────────────────────────────────────
compose.get('/accounts/:id/drafts', async (c) => {
  const account = await rpc(c, 'em_access', { p_actor: actor(c), p_account: uuidParam(c), p_min_role: 'responder' })
  const drafts = await withGmail(c, account, async () => {
    const list = await gmail(c.env, account, '/drafts', { query: 'maxResults=25' })
    const items = (list?.drafts ?? []).filter((d) => DRAFT_ID.test(d?.id ?? '') && GMAIL_ID.test(d?.message?.id ?? ''))
    if (!items.length) return []
    const metas = await gmailBatchGet(c.env, account, items.map((d) => `/messages/${d.message.id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject`))
    return items.map((d, i) => {
      const m = metas[i]?.error ? null : readMessage(metas[i])
      return { id: d.id, message_id: d.message.id, gmail_thread_id: d.message.threadId ?? null, subject: m?.subject ?? '', to: m?.to ?? [], date: m?.date ?? null }
    })
  })
  noStore(c)
  return ok(c, { drafts })
})

compose.get('/accounts/:id/drafts/:draftId', async (c) => {
  const account = await rpc(c, 'em_access', { p_actor: actor(c), p_account: uuidParam(c), p_min_role: 'responder' })
  const draftId = patternParam(c, 'draftId', DRAFT_ID, 'draft id')
  const data = await withGmail(c, account, () => gmail(c.env, account, `/drafts/${draftId}`, { query: 'format=full' }))
  const m = readMessage(data?.message)
  noStore(c)
  return ok(c, {
    id: draftId, to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject,
    html: m.html ? sanitizeHtml(m.html, { keepStyles: false }).html : null, text: m.text,
    gmail_thread_id: data?.message?.threadId ?? null,
  })
})

async function saveDraft(c, draftId) {
  const id = uuidParam(c)
  const account = await rpc(c, 'em_access', { p_actor: actor(c), p_account: id, p_min_role: 'responder' })
  const draft = await readDraft(c, { requireRecipient: false })
  if (draft.attachments.length || draft.forwardParts.length) {
    throw new HTTPException(400, { message: 'Attachments are added when the message is sent, not saved with the draft.' })
  }
  const result = await withGmail(c, account, async () => {
    const prepared = await prepare(c, account, draft)
    const message = prepared.gmailThreadId ? { threadId: prepared.gmailThreadId } : {}
    return gmail(c.env, account, draftId ? `/drafts/${draftId}` : '/drafts', {
      method: draftId ? 'PUT' : 'POST',
      upload: uploadBody(draftId ? { id: draftId, message } : { message }, prepared.raw),
    })
  })
  return ok(c, { id: result?.id ?? draftId, message_id: result?.message?.id ?? null })
}

compose.post('/accounts/:id/drafts', (c) => saveDraft(c, null))
compose.put('/accounts/:id/drafts/:draftId', (c) => saveDraft(c, patternParam(c, 'draftId', DRAFT_ID, 'draft id')))

compose.delete('/accounts/:id/drafts/:draftId', async (c) => {
  const account = await rpc(c, 'em_access', { p_actor: actor(c), p_account: uuidParam(c), p_min_role: 'responder' })
  const draftId = patternParam(c, 'draftId', DRAFT_ID, 'draft id')
  await withGmail(c, account, () => gmail(c.env, account, `/drafts/${draftId}`, { method: 'DELETE' }))
  return ok(c, { deleted: true })
})

export default compose
