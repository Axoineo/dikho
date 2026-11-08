// STOP and START replies from customers.
//
// A message that is just "STOP" (any capitals, an optional "." or "!") opts the
// person out: campaigns skip them, the app's send-to-a-number refuses them, and
// the inbox shows a warning on their chat. They get one confirmation reply,
// which is free because they have just messaged us. "START" opts them back in
// and confirms that too, but only when they were opted out, so a stray "Start"
// from anyone else gets no confirmation. Meta's own "Stop
// promotions" button arrives separately, as error 131050 on a receipt (see
// routes/whatsapp/webhook.js).
//
// This runs once per inbound wamid (processInboundMessage returns early on a
// duplicate), so a redelivered webhook never sends a confirmation twice.

import { sendTextMessage } from './graph.js'
import { broadcast } from './realtime.js'
import { logError, logEvent } from '../../utils/logger.js'

export const STOP_REPLY = 'Your request to STOP receiving updates has been successfully registered.\n\n'
  + 'Please reply START if you would like to start receiving important updates on WhatsApp again. Thank you.'

// The owner's wording, mirroring STOP_REPLY.
export const START_REPLY = 'Your request to START receiving updates has been successfully registered.\n\n'
  + 'Please reply STOP if you would like to stop receiving important updates on WhatsApp. Thank you.'

const KEYWORD = /^\s*(stop|start)[\s.!]*$/i

// "stop" or "start" when the message is only that word: typed, or the label of
// a quick-reply or interactive button. Anything longer ("please stop calling")
// is an ordinary message for a person to read.
export function optKeyword(message) {
  const text = message?.text?.body ?? message?.button?.text ?? message?.interactive?.button_reply?.title ?? ''
  if (typeof text !== 'string' || text.length > 24) return null
  return KEYWORD.exec(text)?.[1].toLowerCase() ?? null
}

// Records the choice on the contact (created for this number by the inbound
// upsert just before), tells open inboxes, and sends the confirmation: always
// for STOP, and for START only when it actually opted them back in.
export async function applyOptKeyword(c, { keyword, conv }) {
  const optedOut = keyword === 'stop' ? 1 : 0
  const result = await c.env.DB.prepare(
    `UPDATE contacts SET opted_out = ?1, updated_at = datetime('now') WHERE phone = ?2 AND opted_out <> ?1`,
  ).bind(optedOut, conv.phone).run()
  const changed = (result?.meta?.changes ?? 0) > 0
  logEvent('whatsapp.opt_keyword', { keyword, changed, conversation_id: conv.id })
  await broadcast(c.env, 'conversation:opted', { id: conv.id, opted_out: optedOut })

  const reply = keyword === 'stop' ? STOP_REPLY : changed ? START_REPLY : null
  // A blocked number cannot be messaged, so it gets no confirmation either.
  if (reply && !conv.blocked_at) {
    c.executionCtx.waitUntil(sendOptReply(c.env, conv, reply).catch((err) => logError('whatsapp.opt_reply_failed', err)))
  }
}

// The confirmation goes out as an ordinary text reply and is kept in the chat,
// sent by no one (the system), so staff can see what the customer was told.
async function sendOptReply(env, conv, text) {
  const sent = await sendTextMessage(env, { to: conv.phone, body: text })
  if (!sent.ok) {
    logError('whatsapp.opt_reply_failed', `Meta error ${sent.errorCode}`)
    return
  }
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO messages
       (conversation_id, contact_id, phone, meta_message_id, direction, type, body, status, sent_at, wa_timestamp, created_at)
     VALUES (?1, ?2, ?3, ?4, 'outbound', 'text', ?5, 'sent', ?6, ?6, ?6)
     ON CONFLICT(meta_message_id) DO NOTHING`,
  ).bind(conv.id, conv.contact_id ?? null, conv.phone, sent.messageId, text, now).run()
  await env.DB.prepare(
    `UPDATE conversations SET last_message_at = ?1, last_message_preview = ?2,
       last_message_direction = 'outbound', updated_at = datetime('now')
     WHERE id = ?3`,
  ).bind(now, text.slice(0, 120), conv.id).run()

  const row = await env.DB.prepare('SELECT * FROM messages WHERE meta_message_id = ?').bind(sent.messageId).first()
  const fresh = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(conv.id).first()
  if (row && fresh) await broadcast(env, 'message:new', { conversation: fresh, message: row })
}
