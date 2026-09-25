import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok, fail } from '../../utils/response.js'
import { sendTextMessage, sendMediaMessage, markMessageRead } from '../../services/whatsapp/graph.js'
import { uploadMediaToMeta, storeOutboundCopy } from '../../services/whatsapp/media.js'
import { broadcast } from '../../services/whatsapp/realtime.js'

// Most recent inbound message id — the one Meta read-receipts and typing
// indicators must reference (they attach to a received message).
async function lastInboundWamid(db, conversationId) {
  const row = await db.prepare(
    `SELECT meta_message_id FROM messages
     WHERE conversation_id = ? AND direction = 'inbound' AND meta_message_id IS NOT NULL
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

// Maps a MIME type to the WhatsApp media message type. Anything unrecognised is
// sent as a document, which accepts any file.
function mediaTypeFor(mime = '') {
  if (mime.startsWith('image/')) return mime === 'image/webp' ? 'sticker' : 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

/* ── GET /api/whatsapp/conversations — chat list ───────────────────────────
   Newest activity first, matching the WhatsApp Web left pane. */
conversations.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT conv.*, ct.name AS contact_name, ct.avatar_url AS avatar_url
     FROM conversations conv
     LEFT JOIN contacts ct ON ct.id = conv.contact_id
     WHERE conv.status = 'open'
     ORDER BY conv.last_message_at DESC
     LIMIT 200`,
  ).all()
  return ok(c, { conversations: results })
})

/* ── GET /api/whatsapp/conversations/:id/messages — full thread ──────────── */
conversations.get('/:id/messages', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Bad conversation id' })

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 500`,
  ).bind(id).all()
  return ok(c, { messages: results })
})

/* ── POST /api/whatsapp/conversations/:id/read — clear the unread badge ────
   Also sends Meta a read receipt for the latest inbound message so the customer
   sees your blue double-ticks. Best-effort via waitUntil. */
conversations.post('/:id/read', async (c) => {
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
conversations.post('/:id/typing', async (c) => {
  const id = Number(c.req.param('id'))
  const wamid = await lastInboundWamid(c.env.DB, id)
  if (wamid) {
    c.executionCtx.waitUntil(markMessageRead(c.env, { messageId: wamid, typing: true }).catch(() => {}))
  }
  return ok(c, { ok: true })
})

// Persists a just-sent outbound message and advances the conversation summary,
// then broadcasts it so every open tab (including the sender's) converges on the
// same row. Returns the stored row.
async function recordOutbound(c, conv, { metaMessageId, type, body, mediaUrl, mediaMime, filename, mediaSize }) {
  const user = c.get('user')
  const now = new Date().toISOString()

  await c.env.DB.prepare(
    `INSERT INTO messages
       (conversation_id, contact_id, phone, meta_message_id, direction, type,
        body, media_url, media_mime, media_filename, media_size, media_status, status, sender, sent_at, wa_timestamp, created_at)
     VALUES (?1, ?2, ?3, ?4, 'outbound', ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'sent', ?12, ?13, ?13, ?13)`,
  ).bind(
    conv.id, conv.contact_id, conv.phone, metaMessageId, type, body ?? null,
    mediaUrl ?? null, mediaMime ?? null, filename ?? null, mediaSize ?? null, mediaUrl ? 'ready' : null,
    user?.id ?? null, now,
  ).run()

  await c.env.DB.prepare(
    `UPDATE conversations SET
       last_message_at = ?1, last_message_preview = ?2,
       last_message_direction = 'outbound', updated_at = datetime('now')
     WHERE id = ?3`,
  ).bind(now, (body || `📎 ${type}`).slice(0, 120), conv.id).run()

  const row = await c.env.DB.prepare('SELECT * FROM messages WHERE meta_message_id = ?').bind(metaMessageId).first()
  const freshConv = await c.env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(conv.id).first()
  await broadcast(c.env, 'message:new', { conversation: freshConv, message: row })
  return row
}

/* ── POST /api/whatsapp/conversations/:id/messages — text reply ──────────── */
conversations.post('/:id/messages', async (c) => {
  const id = Number(c.req.param('id'))
  const { body } = await c.req.json().catch(() => ({}))
  if (!body?.trim()) throw new HTTPException(400, { message: 'Message body is required' })

  const conv = await c.env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first()
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (!withinSession(conv)) {
    return fail(c, 'OUTSIDE_24H', 'The 24-hour session has closed — send an approved template instead.', 409)
  }

  const sent = await sendTextMessage(c.env, { to: conv.phone, body: body.trim() })
  if (!sent.ok) return fail(c, 'SEND_FAILED', sent.errorMessage, 502)

  const row = await recordOutbound(c, conv, { metaMessageId: sent.messageId, type: 'text', body: body.trim() })
  return ok(c, { message: row })
})

/* ── POST /api/whatsapp/conversations/:id/media — media reply ────────────── */
conversations.post('/:id/media', async (c) => {
  const id = Number(c.req.param('id'))
  const conv = await c.env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first()
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (!withinSession(conv)) {
    return fail(c, 'OUTSIDE_24H', 'The 24-hour session has closed — send an approved template instead.', 409)
  }

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  const caption = (form?.get('caption') || '').toString().trim()
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new HTTPException(400, { message: 'No file uploaded under the "file" field' })
  }

  const bytes = await file.arrayBuffer()
  const mime = file.type || 'application/octet-stream'
  const filename = file.name || 'upload'
  const type = mediaTypeFor(mime)

  // Upload to Meta (for sending) and keep our own copy (for display) in parallel.
  const [uploaded, mediaUrl] = await Promise.all([
    uploadMediaToMeta(c.env, { bytes, mime, filename }),
    storeOutboundCopy(c.env, { bytes, mime }),
  ])
  if (!uploaded.ok) return fail(c, 'MEDIA_UPLOAD_FAILED', uploaded.errorMessage, 502)

  const sent = await sendMediaMessage(c.env, {
    to: conv.phone, type, mediaId: uploaded.mediaId, caption, filename,
  })
  if (!sent.ok) return fail(c, 'SEND_FAILED', sent.errorMessage, 502)

  const row = await recordOutbound(c, conv, {
    metaMessageId: sent.messageId, type, body: caption || null,
    mediaUrl, mediaMime: mime, filename, mediaSize: file.size ?? bytes.byteLength,
  })
  return ok(c, { message: row })
})

/* ── POST /api/whatsapp/conversations/:id/avatar — set contact photo ───────
   The Cloud API does not expose WhatsApp profile pictures, so agents set one
   here. Stored in R2 and served through the same auth-gated media route. */
conversations.post('/:id/avatar', async (c) => {
  const id = Number(c.req.param('id'))
  const conv = await c.env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first()
  if (!conv) return fail(c, 'NOT_FOUND', 'Conversation not found', 404)
  if (!conv.contact_id) return fail(c, 'NO_CONTACT', 'Conversation has no linked contact', 409)

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new HTTPException(400, { message: 'No file uploaded under the "file" field' })
  }
  const mime = file.type || 'image/jpeg'
  if (!mime.startsWith('image/')) {
    throw new HTTPException(400, { message: 'Avatar must be an image' })
  }

  const url = await storeOutboundCopy(c.env, { bytes: await file.arrayBuffer(), mime })
  await c.env.DB.prepare('UPDATE contacts SET avatar_url = ?1, updated_at = datetime(\'now\') WHERE id = ?2')
    .bind(url, conv.contact_id).run()

  await broadcast(c.env, 'conversation:updated', { id: conv.id, avatar_url: url })
  return ok(c, { avatar_url: url })
})

export default conversations
