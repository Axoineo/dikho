// Turns one inbound WhatsApp `message` webhook event into durable state:
// contact -> conversation -> message, then a realtime broadcast and (for media)
// a background re-host job. Called from the webhook once the event has cleared
// the idempotency ledger, so every write here runs at most once per wamid.

import { broadcast } from './realtime.js'
import { ingestMedia, markMediaFailed } from './media.js'
import { logError } from '../../utils/logger.js'

// Normalises each supported message type to { type, body, media }. Unsupported
// types (location, contacts, reactions, ...) still create a row with a readable
// placeholder so the thread never silently drops a customer message.
function parseContent(m) {
  switch (m.type) {
    case 'text':     return { type: 'text', body: m.text?.body ?? '', media: null }
    case 'image':    return { type: 'image', body: m.image?.caption ?? '', media: m.image }
    case 'document': return { type: 'document', body: m.document?.caption ?? '', media: m.document }
    case 'audio':    return { type: 'audio', body: '', media: m.audio }
    case 'video':    return { type: 'video', body: m.video?.caption ?? '', media: m.video }
    case 'sticker':  return { type: 'sticker', body: '', media: m.sticker }
    default:         return { type: m.type ?? 'unknown', body: `[${m.type ?? 'unsupported message'}]`, media: null }
  }
}

export async function processInboundMessage(c, event) {
  const db = c.env.DB
  const m = event.raw
  const phone = event.from
  const at = event.timestamp
    ? new Date(Number(event.timestamp) * 1000).toISOString()
    : new Date().toISOString()

  const { type, body, media } = parseContent(m)
  const preview = (body || `📎 ${type}`).slice(0, 120)

  // 1. Contact upsert. Keep an existing name; only fill it from the WhatsApp
  //    profile when we don't have one yet.
  await db.prepare(
    `INSERT INTO contacts (name, phone, source) VALUES (?1, ?2, 'inbound')
     ON CONFLICT(phone) DO UPDATE SET
       name = COALESCE(contacts.name, ?1),
       updated_at = datetime('now')`,
  ).bind(event.waName, phone).run()
  const contact = await db.prepare('SELECT id FROM contacts WHERE phone = ?').bind(phone).first()

  // 2. Conversation upsert. unread_count++ and last_inbound_at (which powers the
  //    24-hour session window) both advance here.
  await db.prepare(
    `INSERT INTO conversations
       (contact_id, phone, wa_name, last_message_at, last_message_preview,
        last_message_direction, last_inbound_at, unread_count, status)
     VALUES (?1, ?2, ?3, ?4, ?5, 'inbound', ?4, 1, 'open')
     ON CONFLICT(phone) DO UPDATE SET
       contact_id = COALESCE(conversations.contact_id, ?1),
       wa_name = COALESCE(?3, conversations.wa_name),
       last_message_at = ?4,
       last_message_preview = ?5,
       last_message_direction = 'inbound',
       last_inbound_at = ?4,
       unread_count = conversations.unread_count + 1,
       status = 'open',
       updated_at = datetime('now')`,
  ).bind(contact?.id ?? null, phone, event.waName, at, preview).run()
  const conv = await db.prepare('SELECT * FROM conversations WHERE phone = ?').bind(phone).first()

  // 3. Message row. The wamid UNIQUE index is the final backstop against a
  //    double-insert even if two deliveries race past the idempotency ledger.
  const mediaStatus = media ? 'pending' : null
  const res = await db.prepare(
    `INSERT INTO messages
       (conversation_id, contact_id, phone, meta_message_id, direction, type,
        body, media_id, media_mime, media_filename, media_status, status, wa_timestamp, created_at)
     VALUES (?1, ?2, ?3, ?4, 'inbound', ?5, ?6, ?7, ?8, ?9, ?10, 'received', ?11, ?11)
     ON CONFLICT(meta_message_id) DO NOTHING`,
  ).bind(
    conv.id, contact?.id ?? null, phone, m.id, type, body,
    media?.id ?? null, media?.mime_type ?? null, media?.filename ?? null, mediaStatus, at,
  ).run()
  if ((res.meta?.changes ?? 0) === 0) return // duplicate; already delivered to the UI

  const row = await db.prepare('SELECT * FROM messages WHERE meta_message_id = ?').bind(m.id).first()

  // 4. Push to open agent tabs immediately. Text renders now; media fills in via
  //    the message:updated broadcast once the re-host completes.
  await broadcast(c.env, 'message:new', { conversation: conv, message: row })

  // 5. Re-host media in the background so the webhook can return its 200 fast.
  if (media?.id) {
    c.executionCtx.waitUntil(
      ingestMedia(c.env, { messageId: row.id, mediaId: media.id }).catch((err) => {
        logError('whatsapp.media.ingest_failed', err)
        return markMediaFailed(c.env, row.id)
      }),
    )
  }
}
