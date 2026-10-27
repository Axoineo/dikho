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
import { requireCapability, providerOf } from '../../services/email/providers.js'
import { readConversation, setFlag, downloadAttachment } from '../../services/email/hostingerMail.js'
import { syncMailbox } from '../../services/email/sync.js'
import {
  actor, rpc, uuidParam, requestContext, withGmail, withHostinger, publicAccount, noStore,
  GMAIL_ID, ATTACHMENT_ID, UUID, PROVIDER_ATTACHMENT_ID,
} from './shared.js'

// Conversations. Lists come from the metadata cache; opening a conversation
// reads it live from the provider (Gmail, or Hostinger by folder and UID)
// and returns sanitized content that is never stored or cached
// (Cache-Control: no-store). Mounted behind requireAuth.
const threads = new Hono()
const MAX_BODY = 16 * 1024
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const FOLDERS = new Set(['inbox', 'sent', 'drafts', 'starred', 'archived', 'all', 'assigned'])
const SYSTEM_LABELS = new Set(['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT'])
const USER_LABEL = /^Label_[0-9]{1,20}$/
// What each Gmail-style label change means, for providers without labels.
const LABEL_FEATURE = { UNREAD: 'mark_read', STARRED: 'star', INBOX: 'archive', IMPORTANT: 'labels' }

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
  requireCapability(account, 'search')
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
  requireCapability(account, 'read')
  if (providerOf(account) === 'hostinger') return openHostingerThread(c, id, meta)
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

// A Hostinger conversation: bodies of the newest messages, live, by folder
// and UID from the index. A message moved since the last sync comes back
// without its body, and a sync is started.
async function openHostingerThread(c, id, meta) {
  const account = meta.account
  const { messages: raw, omitted, stale } = await withHostinger(c, () => readConversation(c.env, account, meta.provider_messages))
  const messages = await Promise.all(raw.map(async ({ body, missing, ...m }) => {
    const html = body?.html ? sanitizeHtml(body.html) : null
    const ticket = html ? await issueRenderTicket(c.env, { userId: actor(c), threadId: id, messageId: m.id }) : null
    return {
      ...m,
      html: html?.html ?? null,
      render_path: ticket ? `/email/render/${id}/${m.id}?t=${ticket}` : null,
      blocked_images: html?.blockedImages ?? 0,
      text: missing ? 'This message was moved or deleted in Hostinger after the last sync.' : String(body?.text ?? '').slice(0, 200_000),
    }
  }))
  if (stale) inBackground(c, syncMailbox(c.env, account.id))
  noStore(c)
  return ok(c, {
    thread: meta.thread,
    account: publicAccount(account),
    notes: meta.notes,
    assignable: meta.assignable,
    messages,
    omitted,
  })
}

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
  for (const label of [...add, ...remove]) requireCapability(account, LABEL_FEATURE[label] ?? 'labels')
  if (providerOf(account) === 'hostinger') return ok(c, await hostingerFlags(c, account, meta.provider_messages ?? [], add, remove))
  const result = await withGmail(c, account, () => gmail(c.env, account, `/threads/${meta.thread.gmail_thread_id}/modify`, {
    method: 'POST', body: { addLabelIds: add, removeLabelIds: remove },
  }))
  const labels = [...new Set((result?.messages ?? []).flatMap((m) => (Array.isArray(m?.labelIds) ? m.labelIds : [])))]
    .filter((l) => typeof l === 'string').slice(0, 100)
  await rpc(c, 'em_set_thread_labels', { p_account: account.id, p_gmail_thread_id: meta.thread.gmail_thread_id, p_label_ids: labels })
  return ok(c, { label_ids: labels, unread: labels.includes('UNREAD'), starred: labels.includes('STARRED') })
})

// Read/unread and star on a Hostinger conversation, as IMAP flags: read
// marks every received message \Seen; unread clears it on the newest
// received one; star flags the newest message; unstar clears every flag.
async function hostingerFlags(c, account, refs, add, remove) {
  const received = refs.filter((r) => r.folder_role !== 'sent')
  const state = new Map(refs.map((r) => [r.id, { unseen: r.unseen, flagged: r.flagged }]))
  const apply = async (targets, flag, on, field, value) => {
    if (!targets.length) return
    const ids = await setFlag(c.env, account, targets, flag, on)
    for (const i of ids) state.get(i)[field] = value
    if (ids.length) {
      await rpc(c, 'em_hostinger_set_flags', {
        p_account: account.id, p_message_ids: ids,
        p_unseen: field === 'unseen' ? value : null, p_flagged: field === 'flagged' ? value : null,
      })
    }
  }
  await withHostinger(c, async () => {
    if (remove.includes('UNREAD')) await apply(received.filter((r) => r.unseen), '\\Seen', true, 'unseen', false)
    if (add.includes('UNREAD') && received.length) await apply([received.at(-1)], '\\Seen', false, 'unseen', true)
    if (add.includes('STARRED') && refs.length) await apply([refs.at(-1)], '\\Flagged', true, 'flagged', true)
    if (remove.includes('STARRED')) await apply(refs.filter((r) => r.flagged), '\\Flagged', false, 'flagged', false)
  })
  const unread = received.some((r) => state.get(r.id).unseen)
  const starred = refs.some((r) => state.get(r.id).flagged)
  const label_ids = [
    refs.some((r) => r.folder_role === 'inbox') && 'INBOX', refs.some((r) => r.folder_role === 'sent') && 'SENT',
    unread && 'UNREAD', starred && 'STARRED',
  ].filter(Boolean)
  return { label_ids, unread, starred }
}

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
  const messageId = c.req.param('messageId') ?? ''
  const attachmentId = c.req.param('attachmentId') ?? ''
  if (!GMAIL_ID.test(messageId) && !UUID.test(messageId)) throw new HTTPException(400, { message: 'Invalid message id' })
  if (!ATTACHMENT_ID.test(attachmentId) && !PROVIDER_ATTACHMENT_ID.test(attachmentId)) throw new HTTPException(400, { message: 'Invalid attachment id' })
  const meta = await rpc(c, 'em_open_thread', { p_actor: actor(c), p_thread: id, p_min_role: 'viewer' })
  const account = meta.account
  requireCapability(account, 'attachments')

  let bytes
  if (providerOf(account) === 'hostinger') {
    // Only an attachment the index lists for a message of this conversation.
    const ref = (meta.provider_messages ?? []).find((r) => r.id === messageId.toLowerCase())
    const attachment = ref?.attachments?.find((a) => a.id === attachmentId)
    if (!ref || !attachment) throw new HTTPException(404, { message: 'That attachment is not part of this conversation.' })
    bytes = await withHostinger(c, () => downloadAttachment(c.env, account, ref, attachment))
    if (!bytes) throw new HTTPException(413, { message: 'This attachment is too large to download here. Open it in Hostinger Webmail.' })
  } else {
    if (!GMAIL_ID.test(messageId) || !ATTACHMENT_ID.test(attachmentId)) throw new HTTPException(400, { message: 'Invalid attachment id' })
    const data = await withGmail(c, account, () => gmail(c.env, account, `/messages/${messageId}/attachments/${attachmentId}`))
    if (typeof data?.data !== 'string' || (Number(data.size) || 0) > MAX_ATTACHMENT_BYTES) {
      throw new HTTPException(413, { message: 'This attachment is too large to download here. Open it in Gmail.' })
    }
    bytes = fromBase64url(data.data)
  }
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
