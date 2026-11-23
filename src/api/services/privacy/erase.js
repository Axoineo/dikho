import { logError, logEvent } from '../../utils/logger.js'

// Erases one person, found by phone number, from the WhatsApp data in D1 and R2 and
// from the corporate-gifting leads in Supabase (pre-launch audit 12.3, 2026-11-22:
// deleting a chat only hid it and deleting a contact only unlinked it).
//
// What happens to each kind of record:
//   media files of their messages                 deleted (R2)
//   inbox messages and their stars                deleted
//   chats and their action history                deleted
//   the contact, queued confirmations, cooldowns  deleted
//   campaign messages                             kept, but stripped of the number,
//                                                  text and files, so campaign totals
//                                                  stay right (audience tracking)
//   stored webhook payloads naming the number     replaced by {"erased":true}; the
//                                                  row stays so a redelivered event is
//                                                  still recognised as a duplicate
//   gifting leads with this number                deleted (Supabase, service role)
//
// Order makes a retry safe: files first (found from the rows), then every D1 change
// in one batch (one transaction), then the leads. If a step fails, running it again
// finds what is left and finishes.

const MEDIA_PREFIX = '/whatsapp/media/'
const CHUNK = 90 // D1 allows 100 bound parameters per statement

function chunks(list, size = CHUNK) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

const marks = (n) => Array.from({ length: n }, () => '?').join(',')

/** Erases everything held for `phone` (normalised digits). Returns counts. */
export async function erasePerson(env, phone) {
  const db = env.DB
  const conversations = (await db.prepare('SELECT id FROM conversations WHERE phone = ?').bind(phone).all()).results.map((r) => r.id)
  if (conversations.length > CHUNK) throw new Error('More chats than one erase handles')

  const inConversation = conversations.length ? ` OR conversation_id IN (${marks(conversations.length)})` : ''
  const messages = (await db.prepare(
    `SELECT id, campaign_id, media_url FROM messages WHERE phone = ?${inConversation}`,
  ).bind(phone, ...conversations).all()).results

  const inbox = messages.filter((m) => m.campaign_id === null).map((m) => m.id)
  const mediaKeys = [...new Set(messages
    .map((m) => (typeof m.media_url === 'string' && m.media_url.startsWith(MEDIA_PREFIX) ? m.media_url.slice(MEDIA_PREFIX.length) : null))
    .filter(Boolean))]

  for (const keys of chunks(mediaKeys, 1000)) await env.MEDIA.delete(keys)

  const statements = []
  for (const ids of chunks(inbox)) {
    statements.push(db.prepare(`DELETE FROM message_stars WHERE message_id IN (${marks(ids.length)})`).bind(...ids))
    statements.push(db.prepare(`DELETE FROM messages WHERE id IN (${marks(ids.length)})`).bind(...ids))
  }
  statements.push(db.prepare(
    `UPDATE messages SET phone = 'erased', contact_id = NULL, conversation_id = NULL, body = NULL, payload = NULL,
       media_id = NULL, media_url = NULL, media_filename = NULL, error_message = NULL, context_wamid = NULL
     WHERE campaign_id IS NOT NULL AND (phone = ?${inConversation})`,
  ).bind(phone, ...conversations))
  if (conversations.length) {
    statements.push(db.prepare(`DELETE FROM conversation_events WHERE conversation_id IN (${marks(conversations.length)})`).bind(...conversations))
    statements.push(db.prepare(`DELETE FROM conversations WHERE id IN (${marks(conversations.length)})`).bind(...conversations))
  }
  const contactStatement = statements.push(db.prepare('DELETE FROM contacts WHERE phone = ?').bind(phone)) - 1
  statements.push(db.prepare('DELETE FROM cg_lead_outbox WHERE phone = ?').bind(phone))
  statements.push(db.prepare('DELETE FROM template_send_cooldowns WHERE phone = ?').bind(phone))
  statements.push(db.prepare(`UPDATE webhook_events SET payload = '{"erased":true}' WHERE payload LIKE ?`).bind(`%${phone}%`))
  const results = await db.batch(statements)

  return {
    conversations: conversations.length,
    messagesDeleted: inbox.length,
    campaignMessagesAnonymised: messages.length - inbox.length,
    contactsDeleted: results[contactStatement]?.meta?.changes ?? 0,
    mediaDeleted: mediaKeys.length,
    leadsDeleted: await eraseLeads(env, phone),
  }
}

// Gifting leads keep the number without its country code, in a numeric column.
async function eraseLeads(env, phone) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase is not configured')
  const forms = [phone]
  if (phone.startsWith('91') && phone.length === 12) forms.push(phone.slice(2))
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/cg_leads?mobile=in.(${forms.join(',')})`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    logError('privacy.erase.leads_failed', `status ${res.status}`)
    throw new Error('The leads could not be erased')
  }
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) ? rows.length : 0
}

export function logErasure(userId, counts) {
  logEvent('privacy.erased', { user_id: userId, ...counts })
}
