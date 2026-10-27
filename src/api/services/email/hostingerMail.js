import { callUserRpc } from '../userAdmin.js'
import { hostinger, HostingerAuthError, HostingerError } from './hostinger.js'
import { syncMaxThreads } from './config.js'
import { isEmail } from './mime.js'
import { logError, logEvent } from '../../utils/logger.js'

// Reading and writing a Hostinger mailbox through the Hostinger Mail API.
//
// Hostinger exposes IMAP folders and per-folder UIDs, not Gmail threads.
// Dikho syncs three folders (inbox, sent, archive when it exists) into a
// metadata-only index (em_hostinger_sync); the database derives
// conversations from Message-ID / In-Reply-To. Bodies and attachments are
// fetched live when a conversation is opened and are never stored.
//
// Subrequest budget (Workers Free: 50 per invocation): a sync is about 8
// requests; opening a conversation fetches at most OPEN_LIMIT bodies.

const rpc = (env, fn, args) => callUserRpc({ env }, fn, args)
const OPEN_LIMIT = 20
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_SEND_ATTACHMENT_BYTES = 15 * 1024 * 1024

const mailboxPath = (account) => {
  const id = account?.provider_account_id
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id ?? '')) throw new HostingerError(409, 'Connect this mailbox to Hostinger again.')
  return `/mailboxes/${encodeURIComponent(id)}`
}
const folderPath = (account, folder) => `${mailboxPath(account)}/folders/${encodeURIComponent(folder)}`

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }))
  return out
}

// ── Folders ──────────────────────────────────────────────────────────────────
/** Which folder is the inbox, sent and archive, from SPECIAL-USE first, then names. */
export function folderRoles(folders) {
  const list = (Array.isArray(folders) ? folders : []).filter((f) => typeof f?.path === 'string' && f.path.length <= 200)
  const special = (use) => list.find((f) => String(f.specialUse ?? '').toLowerCase() === use)
  const named = (...names) => list.find((f) => names.includes(String(f.name ?? '').toLowerCase()) || names.includes(f.path.toLowerCase()))
  const inbox = list.find((f) => f.path.toUpperCase() === 'INBOX')
  const sent = special('\\sent') ?? named('inbox.sent', 'sent', 'sent items', 'sent messages')
  const archive = special('\\archive') ?? named('inbox.archive', 'archive')
  return [
    inbox && { folder: inbox.path, role: 'inbox' },
    sent && { folder: sent.path, role: 'sent' },
    archive && { folder: archive.path, role: 'archive' },
  ].filter(Boolean)
}

// ── Sync ─────────────────────────────────────────────────────────────────────
const person = (a) => {
  const email = typeof a?.address === 'string' ? a.address.trim().toLowerCase() : ''
  return isEmail(email) ? { name: typeof a?.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 120) : null, email } : null
}
const people = (list, kind) => (Array.isArray(list) ? list : []).slice(0, 50).map(person).filter(Boolean).map((p) => ({ ...p, kind }))
const header = (v) => (typeof v === 'string' && v.length <= 998 && !/[\r\n\0]/.test(v) ? v.trim() || null : null)

/** One message of a Hostinger listing, as the index stores it; null if unusable. */
export function indexEntry(m) {
  const uid = Number(m?.uid)
  const at = Date.parse(m?.date ?? '')
  if (!Number.isSafeInteger(uid) || uid < 1 || uid > 4294967295 || !Number.isFinite(at)) return null
  const flags = Array.isArray(m.flags) ? m.flags.map(String) : []
  return {
    uid,
    sent_at: new Date(at).toISOString(),
    subject: typeof m.subject === 'string' ? m.subject.slice(0, 998) : '',
    message_id: header(m.messageId),
    in_reply_to: header(m.inReplyTo),
    unseen: m.unseen === true,
    flagged: flags.includes('\\Flagged'),
    sender: person(m.from),
    recipients: [...people(m.to, 'to'), ...people(m.cc, 'cc'), ...people(m.bcc, 'bcc')].slice(0, 100),
    attachments: (Array.isArray(m.attachments) ? m.attachments : []).slice(0, 20)
      .filter((a) => typeof a?.id === 'string' && a.id.length <= 200)
      .map((a) => ({
        id: a.id,
        filename: typeof a.filename === 'string' && a.filename ? a.filename.slice(0, 200) : 'attachment',
        content_type: typeof a.contentType === 'string' ? a.contentType.slice(0, 100) : 'application/octet-stream',
        size: Number.isSafeInteger(a.sizeBytes) && a.sizeBytes >= 0 ? a.sizeBytes : null,
        inline: a.inline === true,
      })),
  }
}

async function listFolder(env, account, folder, max) {
  const messages = []
  let total = 0
  let reachedEnd = false
  // One page size throughout: Hostinger pages by page number, so changing
  // perPage between pages would skip or repeat messages.
  const perPage = Math.min(100, max)
  for (let page = 1; messages.length < max && page <= 5; page++) {
    const result = await hostinger(env, `${folderPath(account, folder)}/messages`, {
      query: new URLSearchParams({ page: String(page), perPage: String(perPage), sort: '-uid' }).toString(),
    })
    const data = Array.isArray(result?.data) ? result.data : null
    if (!data) throw new HostingerError(502, 'Hostinger returned an unexpected answer.')
    total = Number(result?.pagination?.total) || 0
    for (const m of data) {
      if (messages.length >= max) break
      const entry = indexEntry(m)
      if (entry) messages.push(entry)
    }
    if (data.length < perPage || page >= (Number(result?.pagination?.totalPages) || 1)) {
      reachedEnd = messages.length < max
      break
    }
  }
  // Everything listed: the whole folder is known, so anything else Dikho
  // holds for it is gone. Otherwise only the listed range is authoritative.
  const complete = reachedEnd && (total === 0 || messages.length >= total)
  const minUid = messages.length ? (complete ? 1 : Math.min(...messages.map((m) => m.uid))) : (total === 0 ? null : undefined)
  return { messages, minUid }
}

/** One sync pass, after em_claim_sync. Never throws; records the outcome. */
export async function syncHostingerMailbox(env, claim) {
  const account = claim
  try {
    const folders = await hostinger(env, `${mailboxPath(account)}/folders`, { query: 'perPage=100' })
    const roles = folderRoles(folders?.data)
    if (!roles.some((r) => r.role === 'inbox')) throw new HostingerError(502, 'Hostinger did not report an inbox for this mailbox.')
    const payload = []
    for (const { folder, role } of roles) {
      const { messages, minUid } = await listFolder(env, account, folder, role === 'inbox' ? syncMaxThreads(env) : 100)
      // undefined: Hostinger said the folder has messages but listed none; skip rather than wipe.
      if (minUid === undefined) continue
      payload.push({ folder, role, min_uid: minUid, messages })
    }
    const result = await rpc(env, 'em_hostinger_sync', { p_account: account.id, p_folders: payload })
    await rpc(env, 'em_finish_sync', { p_account: account.id, p_history_id: null, p_full: true, p_error: null, p_watch_expires_at: null })
    logEvent('email.sync.done', { provider: 'hostinger', added: result?.added, threads: result?.threads })
    return { ok: true, full: true, updated: result?.threads ?? 0 }
  } catch (err) {
    try {
      if (err instanceof HostingerError && (err.status === 403 || err.code === 'ERR_MAILBOX_NOT_FOUND' || err.status === 409)) {
        await rpc(env, 'em_mark_account', {
          p_account: account.id, p_state: 'reauth_required',
          p_error: 'Dikho\'s Hostinger API token no longer covers this mailbox. An administrator needs to include it, then reconnect.',
        })
      } else {
        const message = err instanceof HostingerAuthError
          ? 'Hostinger did not accept Dikho\'s API token. An administrator needs to check HOSTINGER_MAIL_API_TOKEN.'
          : err instanceof HostingerError ? err.message : 'Sync failed and will be retried.'
        if (!(err instanceof HostingerError) && !(err instanceof HostingerAuthError)) logError('email.sync.hostinger_failed', err)
        await rpc(env, 'em_finish_sync', { p_account: account.id, p_history_id: null, p_full: false, p_error: message, p_watch_expires_at: null })
      }
    } catch (inner) {
      logError('email.sync.record_failed', inner)
    }
    return { ok: false }
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────
/** The body of one indexed message: { text, html }. */
export async function messageBody(env, account, ref) {
  const result = await hostinger(env, `${folderPath(account, ref.folder)}/messages/${Number(ref.uid)}/text`)
  return {
    text: typeof result?.data?.text === 'string' ? result.data.text : '',
    html: typeof result?.data?.html === 'string' ? result.data.html : '',
  }
}

const ROLE_LABEL = { inbox: 'INBOX', sent: 'SENT', archive: null }

/**
 * The newest messages of a conversation in the shape the dashboard renders
 * for Gmail. `refs` come from em_open_thread (oldest first). A message that
 * has moved since the last sync is returned without its body; `stale` says
 * a sync is due.
 */
export async function readConversation(env, account, refs) {
  const latest = (Array.isArray(refs) ? refs : []).slice(-OPEN_LIMIT)
  let stale = false
  const bodies = await mapLimit(latest, 4, async (ref) => {
    try {
      return await messageBody(env, account, ref)
    } catch (err) {
      if (err instanceof HostingerError && err.status === 404) { stale = true; return null }
      throw err
    }
  })
  const messages = latest.map((ref, i) => {
    const recipients = Array.isArray(ref.recipients) ? ref.recipients : []
    const pick = (kind) => recipients.filter((r) => r.kind === kind).map(({ name, email }) => ({ name, email }))
    const labels = [ROLE_LABEL[ref.folder_role], ref.unseen && ref.folder_role !== 'sent' ? 'UNREAD' : null, ref.flagged ? 'STARRED' : null].filter(Boolean)
    return {
      id: ref.id,
      date: ref.sent_at,
      from: ref.from ?? null,
      to: pick('to'),
      cc: pick('cc'),
      bcc: ref.folder_role === 'sent' ? pick('bcc') : [],
      reply_to: [],
      subject: ref.subject ?? '',
      labels,
      unread: labels.includes('UNREAD'),
      draft: false,
      body: bodies[i],
      missing: bodies[i] === null,
      attachments: (Array.isArray(ref.attachments) ? ref.attachments : []).map((a) => ({
        id: a.id, filename: a.filename, mime_type: a.content_type, size: a.size ?? 0, inline: Boolean(a.inline),
      })),
    }
  })
  return { messages, omitted: Math.max(0, (refs?.length ?? 0) - latest.length), stale }
}

/** An attachment of an indexed message, bounded, as bytes. */
export async function downloadAttachment(env, account, ref, attachment) {
  if ((attachment.size ?? 0) > MAX_ATTACHMENT_BYTES) return null
  const res = await hostinger(env, `${folderPath(account, ref.folder)}/messages/${Number(ref.uid)}/attachments/${encodeURIComponent(attachment.id)}`, {
    raw: true, timeoutMs: 30_000,
  })
  if (Number(res.headers.get('Content-Length') || 0) > MAX_ATTACHMENT_BYTES) {
    await res.body?.cancel()
    return null
  }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_ATTACHMENT_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength }
  return bytes
}

// ── Flags ────────────────────────────────────────────────────────────────────
/**
 * Adds or removes one IMAP flag on the given indexed messages, per folder (at
 * most 100 UIDs a call). Returns the ids Hostinger confirmed.
 */
export async function setFlag(env, account, refs, flag, on) {
  const byFolder = new Map()
  for (const ref of refs) {
    if (!byFolder.has(ref.folder)) byFolder.set(ref.folder, [])
    byFolder.get(ref.folder).push(ref)
  }
  const confirmed = []
  for (const [folder, list] of byFolder) {
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100)
      const result = await hostinger(env, `${folderPath(account, folder)}/messages/flags`, {
        method: 'POST', retry: true,
        body: { uids: chunk.map((r) => Number(r.uid)), ...(on ? { addFlags: [flag] } : { removeFlags: [flag] }) },
      })
      const ok = new Set((Array.isArray(result?.data?.successful) ? result.data.successful : []).map(Number))
      for (const r of chunk) if (ok.has(Number(r.uid))) confirmed.push(r.id)
    }
  }
  return confirmed
}

// ── Sending ──────────────────────────────────────────────────────────────────
const toBase64 = (bytes) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/**
 * The request body for POST /send. `source` is the indexed message being
 * answered or forwarded; Hostinger copies its Message-ID into In-Reply-To and
 * References and flags it \Answered or $forwarded itself.
 */
export function sendRequest(account, draft, { source = null, attachments = [] } = {}) {
  let total = 0
  for (const a of attachments) total += a.bytes.byteLength
  if (total > MAX_SEND_ATTACHMENT_BYTES) throw new HostingerError(413, 'Attachments add up to more than 15 MB.')
  const ref = source ? { uid: Number(source.uid), folder: source.folder } : null
  return {
    to: draft.to.map((r) => r.email),
    ...(draft.cc.length ? { cc: draft.cc.map((r) => r.email) } : {}),
    ...(draft.bcc.length ? { bcc: draft.bcc.map((r) => r.email) } : {}),
    ...(account.display_name ? { displayName: String(account.display_name).replace(/[\r\n"]/g, '').slice(0, 120) } : {}),
    subject: draft.subject,
    html: draft.html,
    text: draft.text,
    ...(attachments.length ? {
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: toBase64(a.bytes),
        contentType: a.mimeType || 'application/octet-stream',
      })),
    } : {}),
    ...(ref && draft.mode === 'forward' ? { forwardOf: ref } : {}),
    ...(ref && (draft.mode === 'reply' || draft.mode === 'reply_all') ? { inReplyTo: ref } : {}),
  }
}

/** Sends once. Throws HostingerUncertainError when the outcome is unknown. */
export async function sendMessage(env, account, body) {
  await hostinger(env, `${mailboxPath(account)}/send`, { method: 'POST', body, retry: false, timeoutMs: 60_000 })
}
