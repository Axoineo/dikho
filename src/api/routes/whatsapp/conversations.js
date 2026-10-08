import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok, fail } from '../../utils/response.js'
import {
  sendTextMessage, sendMediaMessage, sendReaction, sendStructuredMessage, sendTemplateMessage,
  fetchApprovedTemplates, markMessageRead, blockUser, unblockUser,
} from '../../services/whatsapp/graph.js'
import { InputError, buildContact, buildInteractive, buildLocation, serializePayload } from '../../services/whatsapp/richContent.js'
import { buildComponents, renderTemplateText, sanitizeParam, templateTokens } from '../../../lib/templateVars.js'
import { uploadMediaToMeta, storeOutboundCopy } from '../../services/whatsapp/media.js'
import { broadcast } from '../../services/whatsapp/realtime.js'
import { MAX_DASHBOARD_JSON_BYTES, formFile, readBoundedFormData, readJsonOr } from '../../utils/body.js'
import { safeDisplayName, sniffType } from '../../utils/fileType.js'
import { logEvent } from '../../utils/logger.js'
import { requirePermission } from '../../middleware/requireAuth.js'

// Most recent inbound message id — the one Meta read-receipts and typing
// indicators must reference (they attach to a received message). None for a
// blocked number: nothing at all goes to it until it is unblocked.
async function lastInboundWamid(db, conversationId) {
  const row = await db.prepare(
    `SELECT meta_message_id FROM messages
     WHERE conversation_id = ?1 AND direction = 'inbound' AND meta_message_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM conversations WHERE id = ?1 AND blocked_at IS NOT NULL)
     ORDER BY id DESC LIMIT 1`,
  ).bind(conversationId).first()
  return row?.meta_message_id ?? null
}

const conversations = new Hono()

const SESSION_MS = 24 * 60 * 60 * 1000

// The 24-hour customer service window. Enforced here as well as in the UI — the
// UI check is a convenience, not a security boundary, and Meta rejects free-form
// sends outside the window anyway (only templates are allowed).
function withinSession(conv) {
  return Boolean(conv.last_inbound_at) &&
    Date.now() - new Date(conv.last_inbound_at).getTime() < SESSION_MS
}

// Meta refuses every message to a number the business has blocked. Checked
// here first so the agent gets a plain answer instead of Meta's error, and no
// subrequest is spent on a send that cannot succeed.
const BLOCKED_MESSAGE = 'You blocked this contact. Unblock them to send a message.'
const GONE_MESSAGE = 'That message is no longer in this chat.'

// A message of this conversation that the agent can still see: not deleted on
// its own, not behind a clear, and not a reaction (those are folded onto the
// message they are on, never shown as messages themselves).
function visibleMessage(db, conv, messageId) {
  if (!Number.isInteger(messageId) || messageId < 1) return null
  return db.prepare(
    `SELECT * FROM messages
     WHERE id = ?1 AND conversation_id = ?2 AND hidden_at IS NULL AND id > ?3 AND type <> 'reaction'`,
  ).bind(messageId, conv.id, conv.cleared_through_id ?? 0).first()
}

// The wamid a reply may quote, from the id the dashboard sent. Undefined when
// the message is not a reply; null when it named a message that is gone.
async function replyContext(db, conv, replyTo) {
  if (replyTo === undefined || replyTo === null || replyTo === '') return undefined
  const target = await visibleMessage(db, conv, Number(replyTo))
  return target?.meta_message_id ?? null
}

// The media types WhatsApp Cloud API accepts, with its per-type size limits.
// Documents may be up to 100 MB on Meta's side; they are capped lower here
// because the Worker buffers the file (128 MB of memory) and keeps an R2 copy.
// Anything else is refused before it is read into memory or sent anywhere,
// which also keeps active content (HTML, SVG) out of the R2 bucket we serve.
const MB = 1024 * 1024
const MEDIA_RULES = {
  'image/jpeg': { type: 'image', maxBytes: 5 * MB, sniff: true },
  'image/png': { type: 'image', maxBytes: 5 * MB, sniff: true },
  'image/webp': { type: 'sticker', maxBytes: 500 * 1024, sniff: true },
  'video/mp4': { type: 'video', maxBytes: 16 * MB },
  'video/3gpp': { type: 'video', maxBytes: 16 * MB },
  'audio/aac': { type: 'audio', maxBytes: 16 * MB },
  'audio/amr': { type: 'audio', maxBytes: 16 * MB },
  'audio/mpeg': { type: 'audio', maxBytes: 16 * MB },
  'audio/mp4': { type: 'audio', maxBytes: 16 * MB },
  'audio/ogg': { type: 'audio', maxBytes: 16 * MB },
  'text/plain': { type: 'document', maxBytes: 16 * MB },
  'application/pdf': { type: 'document', maxBytes: 16 * MB, sniff: true },
  'application/msword': { type: 'document', maxBytes: 16 * MB },
  'application/vnd.ms-excel': { type: 'document', maxBytes: 16 * MB },
  'application/vnd.ms-powerpoint': { type: 'document', maxBytes: 16 * MB },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { type: 'document', maxBytes: 16 * MB },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { type: 'document', maxBytes: 16 * MB },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { type: 'document', maxBytes: 16 * MB },
}
const MAX_MEDIA_REQUEST_BYTES = 16 * MB + 64 * 1024

// An Ogg stream whose first packet is an Opus header: "OggS" at byte 0 and
// "OpusHead" where the first page's payload starts, after the 27-byte page
// header and its segment table (Ogg Opus puts that header alone on page one).
function isOggOpus(mime, bytes) {
  if (mime !== 'audio/ogg' || bytes.byteLength < 64) return false
  const b = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 320))
  const ascii = (from, len) => String.fromCharCode(...b.subarray(from, from + len))
  const start = 27 + b[26]
  return ascii(0, 4) === 'OggS' && ascii(start, 8) === 'OpusHead'
}

// Contact photos: raster images only (no SVG, which can carry script).
const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_AVATAR_BYTES = 2 * MB

/* ── GET /api/whatsapp/conversations — chat list ───────────────────────────
   Newest activity first, matching the WhatsApp Web left pane. */
conversations.get('/', requirePermission('inbox.view'), async (c) => {
  const { results } = await c.env.DB.prepare(
    // last_message_status is derived, not stored: the list row needs the
    // delivery state of the newest outbound message so it can show the same
    // ticks the thread does. Deriving it here beats adding a column that the
    // send path and every status webhook would have to remember to update —
    // one missed write and the list lies about delivery.
    //
    // Cheap despite being correlated: idx_messages_conversation is
    // (conversation_id, created_at), so this is a reverse index scan that
    // stops at the first outbound row. Measured against production — 27
    // conversations cost 88 rows read in total.
    //
    // A cleared chat must not keep showing ticks for a message it no longer
    // shows, hence the cleared_through_id bound. Deleted chats (status
    // 'deleted') drop out through the status filter. Reactions are skipped:
    // Meta never reports them past `sent` (see sendReaction).
    `SELECT conv.*, ct.name AS contact_name, ct.avatar_url AS avatar_url,
            (SELECT m.status FROM messages m
              WHERE m.conversation_id = conv.id AND m.direction = 'outbound'
                AND m.id > conv.cleared_through_id AND m.type <> 'reaction'
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT 1) AS last_message_status
     FROM conversations conv
     LEFT JOIN contacts ct ON ct.id = conv.contact_id
     WHERE conv.status = 'open'
     ORDER BY conv.last_message_at DESC
     LIMIT 200`,
  ).all()
  return ok(c, { conversations: results })
})

/* ── GET /api/whatsapp/conversations/:id/messages — full thread ────────────
   Everything after the last Clear chat / Delete chat, minus messages deleted
   one by one (migration 0011). `starred` is the caller's own star. */
conversations.get('/:id/messages', requirePermission('inbox.view'), async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Bad conversation id' })

  const { results } = await c.env.DB.prepare(
    `SELECT m.*,
            EXISTS (SELECT 1 FROM message_stars s WHERE s.message_id = m.id AND s.user_id = ?2) AS starred
     FROM messages m
     WHERE m.conversation_id = ?1 AND m.hidden_at IS NULL
       AND m.id > COALESCE((SELECT cleared_through_id FROM conversations WHERE id = ?1), 0)
     ORDER BY m.created_at ASC LIMIT 500`,
  ).bind(id, c.get('user')?.id ?? '').all()
  return ok(c, { messages: results })
})

/* ── POST /api/whatsapp/conversations/:id/read — clear the unread badge ────
   Also sends Meta a read receipt for the latest inbound message so the customer
   sees your blue double-ticks. Best-effort via waitUntil. */
conversations.post('/:id/read', requirePermission('inbox.view'), async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').bind(id).run()

  const wamid = await lastInboundWamid(c.env.DB, id)
  if (wamid) {
    c.executionCtx.waitUntil(markMessageRead(c.env, { messageId: wamid }).catch(() => {}))
  }
  return ok(c, { ok: true })
})

/* ── POST /api/whatsapp/conversations/:id/typing — show "typing…" to customer ─
   Meta shows it for ~25s or until a message is sent. The frontend throttles this
   while the agent types. Returns immediately; the Meta call runs in the background. */
conversations.post('/:id/typing', requirePermission('inbox.reply'), async (c) => {
  const id = Number(c.req.param('id'))
  const wamid = await lastInboundWamid(c.env.DB, id)
  if (wamid) {
    c.executionCtx.waitUntil(markMessageRead(c.env, { messageId: wamid, typing: true }).catch(() => {}))
  }
  return ok(c, { ok: true })
})

// Persists a just-sent outbound message and advances the conversation summary,
// then broadcasts it so every open tab (including the sender's) converges on the
// same row. Returns the stored row. A reaction leaves the summary alone: it is
// not a message in the list's sense, and Meta never reports it delivered or
// read, so it would park a lone grey tick on the row.
async function recordOutbound(c, conv, { metaMessageId, type, body, mediaUrl, mediaMime, filename, mediaSize, contextWamid, payload }) {
  const user = c.get('user')
  const now = new Date().toISOString()

  await c.env.DB.prepare(
    `INSERT INTO messages
       (conversation_id, contact_id, phone, meta_message_id, direction, type,
        body, media_url, media_mime, media_filename, media_size, media_status, status, sender, sent_at, wa_timestamp, created_at,
        context_wamid, payload)
     VALUES (?1, ?2, ?3, ?4, 'outbound', ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'sent', ?12, ?13, ?13, ?13, ?14, ?15)`,
  ).bind(
    conv.id, conv.contact_id, conv.phone, metaMessageId, type, body ?? null,
    mediaUrl ?? null, mediaMime ?? null, filename ?? null, mediaSize ?? null, mediaUrl ? 'ready' : null,
    user?.id ?? null, now, contextWamid ?? null, serializePayload(payload),
  ).run()

  if (type !== 'reaction') {
    await c.env.DB.prepare(
      `UPDATE conversations SET
         last_message_at = ?1, last_message_preview = ?2,
         last_message_direction = 'outbound', updated_at = datetime('now')
       WHERE id = ?3`,
    ).bind(now, (body || `📎 ${type}`).slice(0, 120), conv.id).run()
  }

  const row = await c.env.DB.prepare('SELECT * FROM messages WHERE meta_message_id = ?').bind(metaMessageId).first()
  const freshConv = await c.env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(conv.id).first()
  await broadcast(c.env, 'message:new', { conversation: freshConv, message: row })
  return row
}

/* ── POST /api/whatsapp/conversations/:id/messages — text reply ────────────
   `replyTo` (a message id in this chat) sends it as a reply quoting that one. */
conversations.post('/:id/messages', requirePermission('inbox.reply'), async (c) => {
  const id = Number(c.req.param('id'))
  const { body, replyTo } = (await readJsonOr(c, MAX_DASHBOARD_JSON_BYTES, {})) ?? {}
  if (typeof body !== 'string' || !body.trim()) throw new HTTPException(400, { message: 'Message body is required' })

  const conv = await c.env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first()
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (conv.blocked_at) return fail(c, 'BLOCKED', BLOCKED_MESSAGE, 409)
  if (!withinSession(conv)) {
    return fail(c, 'OUTSIDE_24H', 'The 24-hour session has closed — send an approved template instead.', 409)
  }
  const contextWamid = await replyContext(c.env.DB, conv, replyTo)
  if (contextWamid === null) return fail(c, 'REPLY_TARGET_GONE', GONE_MESSAGE, 409)

  const sent = await sendTextMessage(c.env, { to: conv.phone, body: body.trim(), contextWamid })
  if (!sent.ok) return fail(c, 'SEND_FAILED', sent.errorMessage, 502)

  const row = await recordOutbound(c, conv, { metaMessageId: sent.messageId, type: 'text', body: body.trim(), contextWamid })
  return ok(c, { message: row })
})

/* ── POST /api/whatsapp/conversations/:id/media — media reply ────────────── */
conversations.post('/:id/media', requirePermission('inbox.reply'), async (c) => {
  const id = Number(c.req.param('id'))
  const conv = await c.env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first()
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (conv.blocked_at) return fail(c, 'BLOCKED', BLOCKED_MESSAGE, 409)
  if (!withinSession(conv)) {
    return fail(c, 'OUTSIDE_24H', 'The 24-hour session has closed — send an approved template instead.', 409)
  }

  const form = await readBoundedFormData(c, MAX_MEDIA_REQUEST_BYTES)
  const file = formFile(form, 'file')
  const caption = (form.get('caption') || '').toString().trim().slice(0, 1024)
  if (!file) {
    throw new HTTPException(400, { message: 'No file uploaded under the "file" field' })
  }
  const contextWamid = await replyContext(c.env.DB, conv, form.get('replyTo'))
  if (contextWamid === null) return fail(c, 'REPLY_TARGET_GONE', GONE_MESSAGE, 409)
  // A voice note must be OGG with Opus inside, or WhatsApp shows it as a plain
  // audio file; the dashboard's recorder produces exactly that.
  const voice = form.get('voice') === '1'

  const mime = (file.type || '').split(';')[0].trim().toLowerCase()
  const rule = MEDIA_RULES[mime]
  if (!rule) {
    return fail(c, 'UNSUPPORTED_MEDIA', 'WhatsApp cannot send this file type. Use JPG, PNG, MP4, MP3, PDF or an Office document.', 415)
  }
  if (file.size > rule.maxBytes) {
    return fail(c, 'TOO_LARGE', `This ${rule.type} must be ${Math.round(rule.maxBytes / 1024 / 1024 * 10) / 10} MB or smaller.`, 413)
  }
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength === 0) return fail(c, 'EMPTY_FILE', 'The file is empty.', 400)
  if (rule.sniff && sniffType(bytes) !== mime) {
    return fail(c, 'UNSUPPORTED_MEDIA', 'The file content does not match its type.', 415)
  }
  if (voice && !isOggOpus(mime, bytes)) {
    return fail(c, 'UNSUPPORTED_MEDIA', 'A voice note must be an OGG/Opus recording.', 415)
  }
  const filename = safeDisplayName(file.name, 'upload')
  const type = rule.type

  // Upload to Meta (for sending) and keep our own copy (for display) in parallel.
  const [uploaded, mediaUrl] = await Promise.all([
    uploadMediaToMeta(c.env, { bytes, mime, filename }),
    storeOutboundCopy(c.env, { bytes, mime }),
  ])
  if (!uploaded.ok) return fail(c, 'MEDIA_UPLOAD_FAILED', uploaded.errorMessage, 502)

  const sent = await sendMediaMessage(c.env, {
    to: conv.phone, type, mediaId: uploaded.mediaId, caption: voice ? '' : caption, filename, contextWamid, voice,
  })
  if (!sent.ok) return fail(c, 'SEND_FAILED', sent.errorMessage, 502)

  const row = await recordOutbound(c, conv, {
    metaMessageId: sent.messageId, type, body: voice ? null : caption || null,
    mediaUrl, mediaMime: mime, filename, mediaSize: file.size ?? bytes.byteLength, contextWamid,
    payload: voice ? { kind: 'voice' } : null,
  })
  return ok(c, { message: row })
})

/* ── POST /api/whatsapp/conversations/:id/avatar — set contact photo ───────
   The Cloud API does not expose WhatsApp profile pictures, so agents set one
   here. Stored in R2 and served through the same auth-gated media route. */
conversations.post('/:id/avatar', requirePermission('inbox.reply'), async (c) => {
  const id = Number(c.req.param('id'))
  const conv = await c.env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first()
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (!conv.contact_id) return fail(c, 'NO_CONTACT', 'Conversation has no linked contact', 409)

  const form = await readBoundedFormData(c, MAX_AVATAR_BYTES + 64 * 1024)
  const file = formFile(form, 'file')
  if (!file) {
    throw new HTTPException(400, { message: 'No file uploaded under the "file" field' })
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return fail(c, 'TOO_LARGE', 'Photo must be 2 MB or smaller.', 413)
  }
  const bytes = await file.arrayBuffer()
  // The stored type comes from the bytes, never from the browser's claim.
  const mime = sniffType(bytes)
  if (!AVATAR_TYPES.has(mime)) {
    return fail(c, 'UNSUPPORTED_MEDIA', 'Photo must be a JPG, PNG, WEBP or GIF image.', 415)
  }

  const url = await storeOutboundCopy(c.env, { bytes, mime })
  await c.env.DB.prepare('UPDATE contacts SET avatar_url = ?1, updated_at = datetime(\'now\') WHERE id = ?2')
    .bind(url, conv.contact_id).run()

  await broadcast(c.env, 'conversation:updated', { id: conv.id, avatar_url: url })
  return ok(c, { avatar_url: url })
})

/* ── Clear chat, Delete chat, Block ────────────────────────────────────────
   History is hidden, never deleted (migration 0011 says why), and each action
   is recorded in conversation_events against the staff member who took it.
   Each route announces its change on its own event name: tabs still running
   an older dashboard ignore names they do not know, where a new field on
   conversation:updated would have been applied blindly. */

async function findConversation(c) {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) throw new HTTPException(400, { message: 'Bad conversation id' })
  return c.env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first()
}

// `messageId` 'cleared' takes the boundary from the row the UPDATE just wrote
// (a batch runs in order, as one transaction), so the history records
// exactly what was hidden.
function conversationEvent(c, conversationId, action, messageId = null) {
  const actor = c.get('user')?.id ?? null
  const now = new Date().toISOString()
  return messageId === 'cleared'
    ? c.env.DB.prepare(
      `INSERT INTO conversation_events (conversation_id, action, actor, message_id, created_at)
       SELECT id, ?2, ?3, cleared_through_id, ?4 FROM conversations WHERE id = ?1`,
    ).bind(conversationId, action, actor, now)
    : c.env.DB.prepare(
      `INSERT INTO conversation_events (conversation_id, action, actor, message_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(conversationId, action, actor, messageId, now)
}

// Hides everything the thread holds right now, in one UPDATE however long the
// thread is. Messages that arrive afterwards get higher ids and show as usual.
async function hideHistory(c, conv, { remove }) {
  const db = c.env.DB
  const action = remove ? 'deleted' : 'cleared'
  await db.batch([
    db.prepare(
      `UPDATE conversations SET
         cleared_through_id = MAX(cleared_through_id,
           (SELECT COALESCE(MAX(id), 0) FROM messages WHERE conversation_id = ?1)),
         status = CASE WHEN ?2 = 1 THEN 'deleted' ELSE status END,
         unread_count = 0,
         last_message_preview = NULL,
         last_message_direction = NULL,
         updated_at = datetime('now')
       WHERE id = ?1`,
    ).bind(conv.id, remove ? 1 : 0),
    conversationEvent(c, conv.id, action, 'cleared'),
  ])
  logEvent(`whatsapp.inbox.chat_${action}`, { conversation_id: conv.id, user_id: c.get('user')?.id ?? null })
  return db.prepare('SELECT * FROM conversations WHERE id = ?').bind(conv.id).first()
}

/* ── POST /api/whatsapp/conversations/:id/clear — Clear chat ───────────────
   Empties the thread for everyone on the team; the chat stays in the list. */
conversations.post('/:id/clear', requirePermission('inbox.delete'), async (c) => {
  const conv = await findConversation(c)
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)

  const fresh = await hideHistory(c, conv, { remove: false })
  await broadcast(c.env, 'conversation:cleared', { conversation: fresh })
  return ok(c, { conversation: fresh })
})

/* ── DELETE /api/whatsapp/conversations/:id — Delete chat ──────────────────
   Clears it and takes it off the list. The customer's next message brings it
   back (the webhook's upsert reopens it) with only the new messages showing. */
conversations.delete('/:id', requirePermission('inbox.delete'), async (c) => {
  const conv = await findConversation(c)
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)

  await hideHistory(c, conv, { remove: true })
  await broadcast(c.env, 'conversation:deleted', { id: conv.id })
  return ok(c, { id: conv.id })
})

const BLOCK_WINDOW_MESSAGE = 'WhatsApp only lets you block someone within 24 hours of their last message.'

async function setBlocked(c, conv, blocked) {
  const db = c.env.DB
  await db.batch([
    db.prepare(`UPDATE conversations SET blocked_at = ?1, updated_at = datetime('now') WHERE id = ?2`)
      .bind(blocked ? new Date().toISOString() : null, conv.id),
    conversationEvent(c, conv.id, blocked ? 'blocked' : 'unblocked'),
  ])
  logEvent(`whatsapp.inbox.${blocked ? 'blocked' : 'unblocked'}`, { conversation_id: conv.id, user_id: c.get('user')?.id ?? null })
  const fresh = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(conv.id).first()
  await broadcast(c.env, 'conversation:blocked', { id: conv.id, blocked_at: fresh?.blocked_at ?? null })
  return fresh
}

/* ── POST /api/whatsapp/conversations/:id/block — Block ────────────────────
   Puts the number on the business's WhatsApp block list. Only recorded here
   once Meta has confirmed it. */
conversations.post('/:id/block', requirePermission('inbox.block'), async (c) => {
  const conv = await findConversation(c)
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (conv.blocked_at) return ok(c, { conversation: conv })
  // Meta's own rule (its error 131047). Checked first so the refusal reads
  // plainly and spends no subrequest; the Meta answer is mapped the same way
  // in case the two clocks disagree at the edge of the window.
  if (!withinSession(conv)) return fail(c, 'OUTSIDE_24H', BLOCK_WINDOW_MESSAGE, 409)

  const result = await blockUser(c.env, { phone: conv.phone })
  if (!result.ok) {
    logEvent('whatsapp.inbox.block_failed', { conversation_id: conv.id, code: result.errorCode })
    if (result.errorCode === '131047') return fail(c, 'OUTSIDE_24H', BLOCK_WINDOW_MESSAGE, 409)
    return fail(c, 'BLOCK_FAILED', 'WhatsApp did not block this number. Please try again.', 502)
  }

  const fresh = await setBlocked(c, conv, true)
  return ok(c, { conversation: fresh })
})

/* ── DELETE /api/whatsapp/conversations/:id/block — Unblock ──────────────── */
conversations.delete('/:id/block', requirePermission('inbox.block'), async (c) => {
  const conv = await findConversation(c)
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (!conv.blocked_at) return ok(c, { conversation: conv })

  const result = await unblockUser(c.env, { phone: conv.phone })
  if (!result.ok) {
    logEvent('whatsapp.inbox.unblock_failed', { conversation_id: conv.id, code: result.errorCode })
    return fail(c, 'UNBLOCK_FAILED', 'WhatsApp did not unblock this number. Please try again.', 502)
  }

  const fresh = await setBlocked(c, conv, false)
  return ok(c, { conversation: fresh })
})

/* ── Locations, contact cards, buttons, lists, links, requests ───────────
   Free-form messages like a text reply: open 24-hour window, not blocked,
   `replyTo` quotes a message. richContent.js checks Meta's limits first, so
   a refusal names the field to fix instead of passing on Meta's error. */

async function sendableConversation(c) {
  const conv = await findConversation(c)
  if (!conv) return { error: fail(c, 'NOT_FOUND', 'Conversation not found', 404) }
  if (conv.blocked_at) return { error: fail(c, 'BLOCKED', BLOCKED_MESSAGE, 409) }
  if (!withinSession(conv)) {
    return { error: fail(c, 'OUTSIDE_24H', 'The 24-hour reply window has closed. Send an approved template instead.', 409) }
  }
  return { conv }
}

function structuredRoute(build, type) {
  return async (c) => {
    const input = (await readJsonOr(c, 32 * 1024, {})) ?? {}
    let built
    try { built = build(input) } catch (err) {
      if (err instanceof InputError) return fail(c, 'INVALID', err.message, 400)
      throw err
    }
    const { conv, error } = await sendableConversation(c)
    if (error) return error
    const contextWamid = await replyContext(c.env.DB, conv, input.replyTo)
    if (contextWamid === null) return fail(c, 'REPLY_TARGET_GONE', GONE_MESSAGE, 409)

    const sent = await sendStructuredMessage(c.env, { to: conv.phone, message: built.message, contextWamid })
    if (!sent.ok) return fail(c, 'SEND_FAILED', sent.errorMessage, 502)
    const row = await recordOutbound(c, conv, {
      metaMessageId: sent.messageId, type, body: built.body, contextWamid, payload: built.payload,
    })
    return ok(c, { message: row })
  }
}

/* POST /:id/location  { latitude, longitude, name?, address? } */
conversations.post('/:id/location', requirePermission('inbox.reply'), structuredRoute(buildLocation, 'location'))
/* POST /:id/contact   { name, phone, email?, company? } */
conversations.post('/:id/contact', requirePermission('inbox.reply'), structuredRoute(buildContact, 'contacts'))
/* POST /:id/interactive { kind: buttons | list | cta_url | location_request | address, ... } */
conversations.post('/:id/interactive', requirePermission('inbox.reply'), structuredRoute(buildInteractive, 'interactive'))

/* ── POST /api/whatsapp/conversations/:id/template: approved template ─────
   The one thing that may go out after the 24-hour window, which is why it is
   here: it re-opens a conversation. It spends message credit, so it needs
   campaigns.send ("Send and retry campaigns: spends WhatsApp message credit"),
   not inbox.reply. The template is re-read from Meta and must be approved;
   every {{variable}} needs a value; a media header or a link button with a
   variable is refused because the inbox does not collect those. The same
   template to the same chat within two minutes is refused as a double send. */
const TEMPLATE_REPEAT_MS = 2 * 60 * 1000

conversations.post('/:id/template', requirePermission('campaigns.send'), async (c) => {
  const { name, language, values } = (await readJsonOr(c, 16 * 1024, {})) ?? {}
  if (typeof name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(name) || typeof language !== 'string' || !/^[A-Za-z_-]{2,15}$/.test(language)) {
    throw new HTTPException(400, { message: 'Pick a template.' })
  }
  const conv = await findConversation(c)
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (conv.blocked_at) return fail(c, 'BLOCKED', BLOCKED_MESSAGE, 409)

  let templates
  try { templates = await fetchApprovedTemplates(c.env) } catch {
    return fail(c, 'TEMPLATES_UNAVAILABLE', 'Could not load the approved templates from WhatsApp. Please try again.', 502)
  }
  const template = templates.find((t) => t.name === name && t.language === language && t.status === 'APPROVED')
  if (!template) return fail(c, 'TEMPLATE_NOT_FOUND', 'That template is not approved.', 404)
  if (template.headerFormat && template.headerFormat !== 'TEXT') {
    return fail(c, 'TEMPLATE_UNSUPPORTED', 'This template has a photo, video or document header, which the inbox cannot fill in yet.', 409)
  }
  if ((template.buttons ?? []).some((b) => /\{\{/.test(b?.url ?? ''))) {
    return fail(c, 'TEMPLATE_UNSUPPORTED', 'This template has a link button with a variable, which the inbox cannot fill in yet.', 409)
  }

  const map = {}
  for (const token of templateTokens(template)) {
    const value = sanitizeParam(values?.[token]).slice(0, 1024)
    if (!value) return fail(c, 'INVALID', `Fill in {{${token}}}.`, 400)
    map[token] = { source: 'literal', value }
  }

  const recent = await c.env.DB.prepare(
    `SELECT 1 FROM messages
     WHERE conversation_id = ?1 AND direction = 'outbound' AND type = 'template'
       AND json_extract(payload, '$.name') = ?2 AND created_at > ?3 LIMIT 1`,
  ).bind(conv.id, name, new Date(Date.now() - TEMPLATE_REPEAT_MS).toISOString()).first()
  if (recent) return fail(c, 'DUPLICATE', 'This template was just sent to this chat.', 409)

  const sent = await sendTemplateMessage(c.env, {
    to: conv.phone, templateName: name, languageCode: language, components: buildComponents(template, map, {}),
  })
  if (!sent.ok) return fail(c, 'SEND_FAILED', sent.errorMessage, 502)

  const body = renderTemplateText(template.bodyText, map, {})
  const row = await recordOutbound(c, conv, {
    metaMessageId: sent.messageId, type: 'template', body,
    payload: {
      kind: 'template', name, language,
      header: renderTemplateText(template.headerText, map, {}) || null,
      body,
      footer: template.footerText || null,
      buttons: (template.buttons ?? []).map((b) => String(b?.text ?? '').slice(0, 40)).filter(Boolean).slice(0, 10),
    },
  })
  return ok(c, { message: row })
})

/* ── Per-message actions: react, pin, star, delete, forward ───────────────
   React and forward send real WhatsApp messages, so they follow the same
   rules as a reply: open 24-hour window, not blocked. Pin, star and delete
   only change what the team sees here; the Cloud API has no equivalent. */

async function findMessage(c) {
  const conv = await findConversation(c)
  if (!conv) return { conv: null, message: null }
  const message = await visibleMessage(c.env.DB, conv, Number(c.req.param('messageId')))
  return { conv, message }
}

// A single emoji, or '' to take the reaction off. Generous on length because
// one emoji can be several code points (skin tones, flags, ZWJ sequences).
const EMOJI = /^\p{Extended_Pictographic}|^\p{Regional_Indicator}/u

/* ── POST /:id/messages/:messageId/reaction — react (emoji '' removes) ───── */
conversations.post('/:id/messages/:messageId/reaction', requirePermission('inbox.reply'), async (c) => {
  const { emoji } = (await readJsonOr(c, 1024, {})) ?? {}
  const value = typeof emoji === 'string' ? emoji.trim() : null
  if (value === null || value.length > 16 || (value !== '' && !EMOJI.test(value))) {
    throw new HTTPException(400, { message: 'Pick one emoji.' })
  }

  const { conv, message } = await findMessage(c)
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (!message?.meta_message_id) return fail(c, 'GONE', GONE_MESSAGE, 409)
  if (conv.blocked_at) return fail(c, 'BLOCKED', BLOCKED_MESSAGE, 409)
  if (!withinSession(conv)) {
    return fail(c, 'OUTSIDE_24H', 'The 24-hour reply window has closed, so a reaction cannot be sent.', 409)
  }

  const sent = await sendReaction(c.env, { to: conv.phone, messageWamid: message.meta_message_id, emoji: value })
  if (!sent.ok) {
    if (sent.errorCode === '131009') return fail(c, 'TOO_OLD', 'WhatsApp only takes reactions to messages from the last 30 days.', 409)
    return fail(c, 'SEND_FAILED', sent.errorMessage, 502)
  }
  const row = await recordOutbound(c, conv, {
    metaMessageId: sent.messageId, type: 'reaction', body: value, contextWamid: message.meta_message_id,
  })
  return ok(c, { message: row })
})

const MAX_PINS = 3

async function setPinned(c, pinned) {
  const { conv, message } = await findMessage(c)
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (!message) return fail(c, 'GONE', GONE_MESSAGE, 409)
  const db = c.env.DB
  if (pinned && !message.pinned_at) {
    // WhatsApp's own limit, and what keeps the pinned bar one line.
    const { n } = await db.prepare(
      `SELECT COUNT(*) AS n FROM messages
       WHERE conversation_id = ?1 AND pinned_at IS NOT NULL AND hidden_at IS NULL AND id > ?2`,
    ).bind(conv.id, conv.cleared_through_id ?? 0).first()
    if (n >= MAX_PINS) return fail(c, 'PIN_LIMIT', `A chat can have ${MAX_PINS} pinned messages. Unpin one first.`, 409)
  }
  if (pinned !== Boolean(message.pinned_at)) {
    await db.prepare('UPDATE messages SET pinned_at = ?1, pinned_by = ?2 WHERE id = ?3')
      .bind(pinned ? new Date().toISOString() : null, pinned ? c.get('user')?.id ?? null : null, message.id).run()
  }
  const row = await db.prepare('SELECT * FROM messages WHERE id = ?').bind(message.id).first()
  await broadcast(c.env, 'message:updated', { message: row })
  return ok(c, { message: row })
}

/* ── POST / DELETE /:id/messages/:messageId/pin — pin for the team ───────── */
conversations.post('/:id/messages/:messageId/pin', requirePermission('inbox.reply'), (c) => setPinned(c, true))
conversations.delete('/:id/messages/:messageId/pin', requirePermission('inbox.reply'), (c) => setPinned(c, false))

async function setStarred(c, starred) {
  const { conv, message } = await findMessage(c)
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (!message) return fail(c, 'GONE', GONE_MESSAGE, 409)
  const userId = c.get('user')?.id
  if (!userId) throw new HTTPException(401, { message: 'Invalid or expired session' })
  await (starred
    ? c.env.DB.prepare('INSERT OR IGNORE INTO message_stars (message_id, user_id, created_at) VALUES (?1, ?2, ?3)')
      .bind(message.id, userId, new Date().toISOString())
    : c.env.DB.prepare('DELETE FROM message_stars WHERE message_id = ?1 AND user_id = ?2').bind(message.id, userId)
  ).run()
  return ok(c, { id: message.id, starred })
}

/* ── POST / DELETE /:id/messages/:messageId/star — the caller's own star ─── */
conversations.post('/:id/messages/:messageId/star', requirePermission('inbox.view'), (c) => setStarred(c, true))
conversations.delete('/:id/messages/:messageId/star', requirePermission('inbox.view'), (c) => setStarred(c, false))

/* ── DELETE /:id/messages/:messageId — Delete one message ──────────────────
   Hidden for the whole team and recorded in conversation_events. The Cloud
   API cannot unsend, so the customer keeps it. */
conversations.delete('/:id/messages/:messageId', requirePermission('inbox.delete'), async (c) => {
  const { conv, message } = await findMessage(c)
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (!message) return fail(c, 'GONE', GONE_MESSAGE, 409)
  const db = c.env.DB
  await db.batch([
    db.prepare(
      `UPDATE messages SET hidden_at = ?1, hidden_by = ?2, pinned_at = NULL, pinned_by = NULL WHERE id = ?3`,
    ).bind(new Date().toISOString(), c.get('user')?.id ?? null, message.id),
    conversationEvent(c, conv.id, 'message_deleted', message.id),
  ])
  logEvent('whatsapp.inbox.message_deleted', { conversation_id: conv.id, message_id: message.id, user_id: c.get('user')?.id ?? null })
  await broadcast(c.env, 'message:hidden', { conversation_id: conv.id, id: message.id })
  return ok(c, { id: message.id })
})

function parsePayload(json) {
  try { return json ? JSON.parse(json) : null } catch { return null }
}

const FORWARDABLE_TYPES = new Set(['text', 'image', 'video', 'audio', 'document', 'sticker', 'location'])
const MEDIA_PREFIX = '/whatsapp/media/'

/* ── POST /api/whatsapp/conversations/:id/forward — forward into this chat ─
   `messageId` may come from any chat the agent can see. Sent as a new
   message: the Cloud API has no forwarding, so the customer sees no
   "Forwarded" label. Media goes from our R2 copy back through Meta's upload,
   and the new row reuses that copy rather than storing it twice. */
conversations.post('/:id/forward', requirePermission('inbox.reply'), async (c) => {
  const conv = await findConversation(c)
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (conv.blocked_at) return fail(c, 'BLOCKED', BLOCKED_MESSAGE, 409)
  if (!withinSession(conv)) {
    return fail(c, 'OUTSIDE_24H', 'The 24-hour reply window for this chat has closed.', 409)
  }

  const { messageId } = (await readJsonOr(c, 1024, {})) ?? {}
  const sourceId = Number(messageId)
  if (!Number.isInteger(sourceId) || sourceId < 1) throw new HTTPException(400, { message: 'Bad message id' })
  const source = await c.env.DB.prepare(
    `SELECT m.* FROM messages m JOIN conversations sc ON sc.id = m.conversation_id
     WHERE m.id = ?1 AND m.hidden_at IS NULL AND m.id > sc.cleared_through_id`,
  ).bind(sourceId).first()
  if (!source) return fail(c, 'GONE', 'That message is no longer available.', 404)
  if (!FORWARDABLE_TYPES.has(source.type)) return fail(c, 'NOT_FORWARDABLE', 'This kind of message cannot be forwarded.', 409)

  const sourcePayload = parsePayload(source.payload)
  if (source.type === 'location') {
    let built
    try { built = buildLocation(sourcePayload ?? {}) } catch { return fail(c, 'NOT_FORWARDABLE', 'This location cannot be forwarded.', 409) }
    const sent = await sendStructuredMessage(c.env, { to: conv.phone, message: built.message })
    if (!sent.ok) return fail(c, 'SEND_FAILED', sent.errorMessage, 502)
    const row = await recordOutbound(c, conv, { metaMessageId: sent.messageId, type: 'location', body: built.body, payload: built.payload })
    return ok(c, { message: row })
  }

  if (source.type === 'text') {
    if (!source.body?.trim()) return fail(c, 'NOT_FORWARDABLE', 'This kind of message cannot be forwarded.', 409)
    const sent = await sendTextMessage(c.env, { to: conv.phone, body: source.body })
    if (!sent.ok) return fail(c, 'SEND_FAILED', sent.errorMessage, 502)
    const row = await recordOutbound(c, conv, { metaMessageId: sent.messageId, type: 'text', body: source.body })
    return ok(c, { message: row })
  }

  if (source.media_status !== 'ready' || !source.media_url?.startsWith(MEDIA_PREFIX)) {
    return fail(c, 'NOT_FORWARDABLE', 'This file is not available to forward.', 409)
  }
  const object = await c.env.MEDIA.get(source.media_url.slice(MEDIA_PREFIX.length))
  if (!object) return fail(c, 'NOT_FORWARDABLE', 'This file is not available to forward.', 409)
  const mime = (source.media_mime || object.httpMetadata?.contentType || '').split(';')[0].trim().toLowerCase()
  const rule = MEDIA_RULES[mime]
  if (!rule) return fail(c, 'UNSUPPORTED_MEDIA', 'WhatsApp cannot send this file type.', 415)
  if (object.size > rule.maxBytes) {
    return fail(c, 'TOO_LARGE', `WhatsApp cannot send a ${rule.type} this large.`, 413)
  }

  const bytes = await object.arrayBuffer()
  const filename = safeDisplayName(source.media_filename, 'file')
  const uploaded = await uploadMediaToMeta(c.env, { bytes, mime, filename })
  if (!uploaded.ok) return fail(c, 'MEDIA_UPLOAD_FAILED', uploaded.errorMessage, 502)
  const caption = (source.body || '').slice(0, 1024)
  const voice = sourcePayload?.kind === 'voice' && mime === 'audio/ogg'
  const sent = await sendMediaMessage(c.env, { to: conv.phone, type: rule.type, mediaId: uploaded.mediaId, caption, filename, voice })
  if (!sent.ok) return fail(c, 'SEND_FAILED', sent.errorMessage, 502)

  const row = await recordOutbound(c, conv, {
    metaMessageId: sent.messageId, type: rule.type, body: caption || null,
    mediaUrl: source.media_url, mediaMime: mime, filename, mediaSize: object.size,
    payload: voice ? { kind: 'voice' } : null,
  })
  return ok(c, { message: row })
})

export default conversations
