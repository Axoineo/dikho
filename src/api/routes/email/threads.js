import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok } from '../../utils/response.js'
import { readBoundedJson } from '../../utils/body.js'
import { gmail, gmailBatchGet } from '../../services/email/google.js'
import { readMessage, summarizeThread, METADATA_QUERY } from '../../services/email/mime.js'
import { sanitizeHtml } from '../../services/email/sanitizeHtml.js'
import { inBackground } from '../../services/email/sync.js'
import { fromBase64url } from '../../services/email/crypto.js'
import { issueRenderTicket } from '../../services/email/renderTicket.js'
import { logError } from '../../utils/logger.js'
import {
  actor, rpc, uuidParam, patternParam, requestContext, withGmail, publicAccount, noStore, GMAIL_ID, ATTACHMENT_ID,
} from './shared.js'

// Conversations. Lists come from the metadata cache; opening a conversation
// reads it live from Gmail and returns sanitized content that is never
// stored or cached (Cache-Control: no-store). Mounted behind requireAuth.
const threads = new Hono()
const MAX_BODY = 16 * 1024
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const FOLDERS = new Set(['inbox', 'sent', 'drafts', 'starred', 'archived', 'all', 'assigned'])
const SYSTEM_LABELS = new Set(['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT'])
const USER_LABEL = /^Label_[0-9]{1,20}$/

threads.get('/threads', async (c) => {
  const q = c.req.query()
  if (q.folder && !FOLDERS.has(q.folder)) throw new HTTPException(400, { message: 'Unknown folder' })
  if (q.account && !/^[0-9a-f-]{36}$/i.test(q.account)) throw new HTTPException(400, { message: 'Invalid mailbox id' })
  if (q.before_at && Number.isNaN(Date.parse(q.before_at))) throw new HTTPException(400, { message: 'Invalid cursor' })
  if (q.before_id && !/^[0-9a-f-]{36}$/i.test(q.before_id)) throw new HTTPException(400, { message: 'Invalid cursor' })
  const params = {
    account: q.account || null,
    folder: q.folder || 'inbox',
    unread: q.unread === '1',
    search: typeof q.search === 'string' ? q.search.slice(0, 100) : null,
    before_at: q.before_at || null,
    before_id: q.before_id || null,
    limit: Math.min(Math.max(Number.parseInt(q.limit, 10) || 30, 1), 50),
  }
  noStore(c)
  return ok(c, await rpc(c, 'em_list_threads', { p_actor: actor(c), p_params: params }))
})

// Search inside one mailbox in Gmail itself (older mail than the cache holds,
// Gmail's own operators). Results are added to the cache as metadata.
threads.get('/accounts/:id/search', async (c) => {
  const id = uuidParam(c)
  const query = String(c.req.query('q') ?? '').trim()
  if (!query || query.length > 200) throw new HTTPException(400, { message: 'Enter up to 200 characters to search for.' })
  const account = await rpc(c, 'em_access', { p_actor: actor(c), p_account: id, p_min_role: 'viewer' })
  const ids = await withGmail(c, account, async () => {
    const list = await gmail(c.env, account, '/threads', { query: new URLSearchParams({ q: query, maxResults: '25' }).toString() })
    const found = (list?.threads ?? []).map((t) => t?.id).filter((t) => GMAIL_ID.test(t ?? ''))
    const results = await gmailBatchGet(c.env, account, found.map((t) => `/threads/${t}?${METADATA_QUERY}`))
    const summaries = results.map((r) => (r?.error ? null : summarizeThread(r))).filter(Boolean)
    if (summaries.length) await rpc(c, 'em_upsert_threads', { p_account: id, p_threads: summaries })
    return summaries.map((s) => s.id)
  })
  noStore(c)
  return ok(c, { threads: ids.length ? await rpc(c, 'em_get_threads', { p_actor: actor(c), p_account: id, p_gmail_thread_ids: ids }) : [] })
})

threads.get('/threads/:id', async (c) => {
  const id = uuidParam(c)
  const meta = await rpc(c, 'em_open_thread', { p_actor: actor(c), p_thread: id, p_min_role: 'viewer' })
  const account = meta.account
  const thread = await withGmail(c, account, async () => {
    try {
      return await gmail(c.env, account, `/threads/${meta.thread.gmail_thread_id}`, { query: 'format=full' })
    } catch (err) {
      if (err?.status === 404) {
        inBackground(c, rpc(c, 'em_mark_threads_deleted', { p_account: account.id, p_gmail_thread_ids: [meta.thread.gmail_thread_id] }).catch(() => {}))
      }
      throw err
    }
  })

  const messages = await Promise.all((thread?.messages ?? []).slice(-100).map(async (raw) => {
    const m = readMessage(raw)
    const html = m.html ? sanitizeHtml(m.html) : null
    // The frame loads the message from /render with a ticket for this one
    // message; the sanitized HTML is also returned for quoting in replies.
    const ticket = html && GMAIL_ID.test(m.id ?? '') ? await issueRenderTicket(c.env, { userId: actor(c), threadId: id, messageId: m.id }) : null
    return {
      id: m.id,
      date: m.date,
      from: m.from,
      to: m.to,
      cc: m.cc,
      bcc: m.labels.includes('SENT') ? m.bcc : [],
      reply_to: m.reply_to,
      subject: m.subject,
      labels: m.labels,
      unread: m.unread,
      draft: m.labels.includes('DRAFT'),
      html: html?.html ?? null,
      render_path: ticket ? `/email/render/${id}/${m.id}?t=${ticket}` : null,
      blocked_images: html?.blockedImages ?? 0,
      text: m.text.slice(0, 200_000),
      attachments: m.attachments,
    }
  }))

  // The full thread also refreshes the cached metadata (labels, unread).
  const summary = summarizeThread(thread)
  if (summary) inBackground(c, rpc(c, 'em_upsert_threads', { p_account: account.id, p_threads: [summary] }).catch((err) => logError('email.thread.cache_failed', err)))

  noStore(c)
  return ok(c, {
    thread: meta.thread,
    account: publicAccount(account),
    notes: meta.notes,
    assignable: meta.assignable,
    messages,
  })
})

// Dikho workflow: status and assignee. Never touches Gmail.
threads.patch('/threads/:id', async (c) => {
  const body = await readBoundedJson(c, MAX_BODY)
  const patch = {}
  if (body && 'workflow_status' in body) patch.workflow_status = body.workflow_status
  if (body && 'assigned_to' in body) {
    if (body.assigned_to !== null && !/^[0-9a-f-]{36}$/i.test(String(body.assigned_to))) throw new HTTPException(400, { message: 'Invalid assignee' })
    patch.assigned_to = body.assigned_to
  }
  if (!Object.keys(patch).length) throw new HTTPException(400, { message: 'Nothing to change' })
  return ok(c, await rpc(c, 'em_update_thread', { p_actor: actor(c), p_thread: uuidParam(c), p_patch: patch, p_ctx: requestContext(c) }))
})

// Gmail state: read/unread, archive (INBOX), star, important and the
// mailbox's own labels. Responders and above.
threads.post('/threads/:id/labels', async (c) => {
  const body = await readBoundedJson(c, MAX_BODY)
  const pick = (list) => (Array.isArray(list) ? list : []).filter((l) => typeof l === 'string' && (SYSTEM_LABELS.has(l) || USER_LABEL.test(l)))
  const add = [...new Set(pick(body?.add))].slice(0, 10)
  const remove = [...new Set(pick(body?.remove))].slice(0, 10).filter((l) => !add.includes(l))
  if (!add.length && !remove.length) throw new HTTPException(400, { message: 'Nothing to change' })

  const meta = await rpc(c, 'em_open_thread', { p_actor: actor(c), p_thread: uuidParam(c), p_min_role: 'responder' })
  const account = meta.account
  const result = await withGmail(c, account, () => gmail(c.env, account, `/threads/${meta.thread.gmail_thread_id}/modify`, {
    method: 'POST', body: { addLabelIds: add, removeLabelIds: remove },
  }))
  const labels = [...new Set((result?.messages ?? []).flatMap((m) => (Array.isArray(m?.labelIds) ? m.labelIds : [])))]
    .filter((l) => typeof l === 'string').slice(0, 100)
  await rpc(c, 'em_set_thread_labels', { p_account: account.id, p_gmail_thread_id: meta.thread.gmail_thread_id, p_label_ids: labels })
  return ok(c, { label_ids: labels, unread: labels.includes('UNREAD'), starred: labels.includes('STARRED') })
})

threads.post('/threads/:id/notes', async (c) => {
  const body = await readBoundedJson(c, MAX_BODY)
  if (typeof body?.body !== 'string') throw new HTTPException(400, { message: 'Write a note' })
  return ok(c, await rpc(c, 'em_add_note', { p_actor: actor(c), p_thread: uuidParam(c), p_body: body.body.slice(0, 4000) }), 201)
})

threads.get('/threads/:id/crm', async (c) => {
  return ok(c, await rpc(c, 'em_thread_crm', { p_actor: actor(c), p_thread: uuidParam(c) }))
})

async function link(c, linked) {
  const type = c.req.param('type')
  const entity = c.req.param('entityId')
  if (!['client', 'vendor', 'lead'].includes(type) || !/^[0-9a-f-]{1,36}$/i.test(entity ?? '')) {
    throw new HTTPException(400, { message: 'Unknown record' })
  }
  return ok(c, await rpc(c, 'em_link', { p_actor: actor(c), p_thread: uuidParam(c), p_type: type, p_entity: entity.toLowerCase(), p_linked: linked }))
}
threads.put('/threads/:id/links/:type/:entityId', (c) => link(c, true))
threads.delete('/threads/:id/links/:type/:entityId', (c) => link(c, false))

// An attachment, as a download. Membership of the mailbox is the boundary
// (em_open_thread at viewer). Always served as an opaque download under a
// sandboxing CSP, never rendered by the browser as a page.
threads.get('/threads/:id/messages/:messageId/attachments/:attachmentId', async (c) => {
  const id = uuidParam(c)
  const messageId = patternParam(c, 'messageId', GMAIL_ID, 'message id')
  const attachmentId = patternParam(c, 'attachmentId', ATTACHMENT_ID, 'attachment id')
  const meta = await rpc(c, 'em_open_thread', { p_actor: actor(c), p_thread: id, p_min_role: 'viewer' })
  const account = meta.account
  const data = await withGmail(c, account, () => gmail(c.env, account, `/messages/${messageId}/attachments/${attachmentId}`))
  if (typeof data?.data !== 'string' || (Number(data.size) || 0) > MAX_ATTACHMENT_BYTES) {
    throw new HTTPException(413, { message: 'This attachment is too large to download here. Open it in Gmail.' })
  }
  const bytes = fromBase64url(data.data)
  const name = String(c.req.query('name') ?? 'attachment').replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 150) || 'attachment'
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

export default threads
