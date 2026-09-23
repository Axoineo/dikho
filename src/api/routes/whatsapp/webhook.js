import { Hono } from 'hono'
import { ok, fail } from '../../utils/response.js'
import { logEvent, logError } from '../../utils/logger.js'

const webhook = new Hono()

// --- GET /api/whatsapp/webhook — Meta verification handshake -------------
//
// Meta calls this once when you save the webhook config. It must echo back
// hub.challenge with a 200 when hub.verify_token matches, or Meta refuses to
// save the subscription.
webhook.get('/', (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  const expectedToken = c.env.WHATSAPP_VERIFY_TOKEN
  if (mode === 'subscribe' && token && expectedToken && token === expectedToken) {
    logEvent('whatsapp.webhook.verified', { mode })
    return c.text(challenge ?? '', 200)
  }

  logEvent('whatsapp.webhook.verify_failed', { mode })
  return fail(c, 'WEBHOOK_VERIFICATION_FAILED', 'Verify token mismatch', 403)
})

// Flattens the nested Meta envelope into individual sub-events, each with its
// own idempotency key.
//
// A status update's key is `${wamid}:${status}` rather than just the wamid,
// because one message legitimately produces sent -> delivered -> read over
// time. Keying on the wamid alone would drop every receipt after the first.
function extractEvents(payload) {
  const events = []

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {}

      for (const status of value.statuses ?? []) {
        events.push({
          type: 'status',
          idempotencyKey: `${status.id}:${status.status}`,
          messageId: status.id,
          status: status.status,
          timestamp: status.timestamp,
          errorCode: status.errors?.[0]?.code ? String(status.errors[0].code) : null,
          errorMessage: status.errors?.[0]?.title ?? null,
          raw: status,
        })
      }

      for (const message of value.messages ?? []) {
        events.push({
          type: 'message',
          idempotencyKey: message.id,
          messageId: message.id,
          raw: message,
        })
      }
    }
  }

  return events
}

const STATUS_COLUMN = {
  sent: 'sent_at',
  delivered: 'delivered_at',
  read: 'read_at',
  failed: 'failed_at',
}

// Never downgrade: a late "delivered" must not overwrite a "read" that already
// arrived, since Meta does not guarantee receipt ordering. The stored status
// is ranked inline in SQL so the comparison happens in a single statement.
const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 }

const STORED_RANK_SQL = `CASE status
  WHEN 'pending' THEN 0
  WHEN 'sent' THEN 1
  WHEN 'delivered' THEN 2
  WHEN 'read' THEN 3
  WHEN 'failed' THEN 4
  ELSE 0 END`

async function processEvent(db, event) {
  if (event.type !== 'status') return

  const column = STATUS_COLUMN[event.status]
  if (!column) return

  const at = event.timestamp
    ? new Date(Number(event.timestamp) * 1000).toISOString()
    : new Date().toISOString()

  await db.prepare(
    `UPDATE messages
     SET status = CASE WHEN ?1 > (${STORED_RANK_SQL}) THEN ?2 ELSE status END,
         ${column} = COALESCE(${column}, ?3),
         error_code = COALESCE(?4, error_code),
         error_message = COALESCE(?5, error_message)
     WHERE meta_message_id = ?6`,
  ).bind(
    STATUS_RANK[event.status] ?? 0,
    event.status,
    at,
    event.errorCode,
    event.errorMessage,
    event.messageId,
  ).run()
}

// --- POST /api/whatsapp/webhook — delivery/read receipts ------------------
//
// Always answers 200 quickly: a non-200 makes Meta retry the whole payload,
// and a processing bug should not turn into a redelivery storm.
webhook.post('/', async (c) => {
  let payload
  try {
    payload = await c.req.json()
  } catch {
    logError('whatsapp.webhook.invalid_json', 'Body was not valid JSON')
    return ok(c, { received: true })
  }

  try {
    logEvent('whatsapp.webhook.received', payload)
    const events = extractEvents(payload)

    for (const event of events) {
      // The UNIQUE index on idempotency_key is what makes retries safe:
      // a replayed event inserts 0 rows and is skipped before any state change.
      const insert = await c.env.DB.prepare(
        `INSERT OR IGNORE INTO webhook_events (event_type, idempotency_key, payload)
         VALUES (?, ?, ?)`,
      ).bind(event.type, event.idempotencyKey, JSON.stringify(event.raw)).run()

      if ((insert.meta?.changes ?? 0) === 0) continue

      try {
        await processEvent(c.env.DB, event)
        await c.env.DB.prepare(
          `UPDATE webhook_events
           SET processing_status = 'processed', processed_at = datetime('now')
           WHERE idempotency_key = ?`,
        ).bind(event.idempotencyKey).run()
      } catch (err) {
        logError('whatsapp.webhook.event_failed', err)
        await c.env.DB.prepare(
          `UPDATE webhook_events SET processing_status = 'failed' WHERE idempotency_key = ?`,
        ).bind(event.idempotencyKey).run()
      }
    }
  } catch (err) {
    logError('whatsapp.webhook.processing_error', err)
  }

  return ok(c, { received: true })
})

export default webhook
