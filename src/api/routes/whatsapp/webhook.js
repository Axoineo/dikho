import { Hono } from 'hono'
import { ok, fail } from '../../utils/response.js'
import { logEvent, logError } from '../../utils/logger.js'
import { verifyMetaSignature } from '../../services/whatsapp/verifyMetaSignature.js'
import { processInboundMessage } from '../../services/whatsapp/inbound.js'
import { processCallEvent, callerPhone } from '../../services/whatsapp/calls.js'
import { broadcast } from '../../services/whatsapp/realtime.js'

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
// A message's key is its wamid, which Meta guarantees globally unique.
//
// A call's key is `${wacid}:${event}` for the same reason as a status: one call
// produces connect and then terminate, and both have to survive the ledger.
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

      // The customer's WhatsApp profile name lives on value.contacts, keyed by
      // wa_id — not inside the message — so index it here and attach it below.
      const profileByWaId = {}
      for (const contact of value.contacts ?? []) {
        profileByWaId[contact.wa_id] = contact.profile?.name ?? null
      }

      for (const message of value.messages ?? []) {
        events.push({
          type: 'message',
          idempotencyKey: message.id,
          messageId: message.id,
          from: message.from,
          waName: profileByWaId[message.from] ?? null,
          timestamp: message.timestamp,
          raw: message,
        })
      }

      // Voice calls (WhatsApp Business Calling API). Arrives only once the app
      // is subscribed to the `calls` webhook field; until then this loop is
      // simply never entered.
      for (const call of value.calls ?? []) {
        const phone = callerPhone(value, call)
        events.push({
          type: 'call',
          idempotencyKey: `${call.id}:${call.event}`,
          callId: call.id,
          event: call.event,                       // connect | terminate
          phone,
          waName: profileByWaId[phone] ?? null,
          // We never place outbound calls, so an absent direction is inbound.
          inbound: call.direction !== 'BUSINESS_INITIATED',
          timestamp: call.timestamp,
          raw: call,
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

// Applies a delivery/read receipt to the matching outbound message, then pushes
// the tick change to open agent tabs so the bubble's status icon updates live.
async function processStatus(c, event) {
  const column = STATUS_COLUMN[event.status]
  if (!column) return

  const at = event.timestamp
    ? new Date(Number(event.timestamp) * 1000).toISOString()
    : new Date().toISOString()

  const result = await c.env.DB.prepare(
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

  // Only broadcast when a row actually matched (ignores receipts for messages we
  // never stored, e.g. legacy sends). The UI keys on the wamid.
  if ((result.meta?.changes ?? 0) > 0) {
    await broadcast(c.env, 'status:update', {
      messageId: event.messageId,
      status: event.status,
      at,
      errorMessage: event.errorMessage,
    })
  }
}

async function processEvent(c, event) {
  if (event.type === 'status') return processStatus(c, event)
  if (event.type === 'message') return processInboundMessage(c, event)
  if (event.type === 'call') return processCallEvent(c, event)
}

// --- POST /api/whatsapp/webhook — inbound messages + delivery receipts ----
//
// Answers 200 for anything we have durably recorded — including an event we
// stored but could not process, which stays replayable from its payload. A
// processing bug must not turn into a redelivery storm.
//
// The one case that returns 503 is losing the event store itself: an
// unrecorded event that we ACK is gone for good, and on 2026-09-25 that is
// exactly how a day of delivery receipts was dropped when D1 hit its free-tier
// daily row-write cap. A non-200 makes Meta redeliver the whole payload with
// backoff for up to 7 days, which outlives a midnight-UTC quota reset.
webhook.post('/', async (c) => {
  // Read the raw body once — the signature is computed over these exact bytes,
  // and re-serialising parsed JSON would not reproduce them.
  const raw = await c.req.text()

  const signatureOk = await verifyMetaSignature(
    raw,
    c.req.header('x-hub-signature-256'),
    c.env.WHATSAPP_APP_SECRET,
  )
  if (!signatureOk) {
    logError('whatsapp.webhook.bad_signature', 'X-Hub-Signature-256 mismatch or missing')
    // 200 (not 401) so a spoofer cannot probe, and Meta never retry-storms.
    return ok(c, { received: true })
  }

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    logError('whatsapp.webhook.invalid_json', 'Body was not valid JSON')
    return ok(c, { received: true })
  }

  const events = extractEvents(payload)
  logEvent('whatsapp.webhook.received', payload)

  // Ring first, bookkeep second. A ringing call is live for ~30 seconds and has
  // no second chance: Meta's redelivery backoff — the thing that makes every
  // other event here recoverable — is worthless once the caller has hung up. So
  // the SDP offer goes out to open agent tabs before the idempotency ledger and
  // before any D1 write that could be slow or over its daily quota, and the
  // durable record below catches up on its own time. A redelivered connect
  // simply rings again; the UI keys on the call id and ignores the duplicate.
  for (const event of events) {
    if (event.type !== 'call' || event.event !== 'connect' || !event.inbound) continue
    c.executionCtx.waitUntil(broadcast(c.env, 'call:incoming', {
      callId: event.callId,
      phone: event.phone,
      waName: event.waName,
      sdp: event.raw?.session?.sdp ?? null,
      at: event.timestamp
        ? new Date(Number(event.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
    }))
  }

  for (const event of events) {
    // Claim the event. The UNIQUE index on idempotency_key is what makes
    // retries safe, but the claim deliberately reaches rows that already
    // exist and are *not* yet 'processed': an earlier attempt that died
    // mid-flight (see the 503 paths below) leaves the row at 'pending', and
    // skipping it on redelivery would strand it forever. Only a row we know
    // reached 'processed' is a true duplicate, and DO UPDATE ... WHERE
    // filters exactly those out — no row comes back, so we skip it.
    let claim
    try {
      claim = await c.env.DB.prepare(
        `INSERT INTO webhook_events (event_type, idempotency_key, payload)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(idempotency_key) DO UPDATE
           SET payload = excluded.payload
           WHERE webhook_events.processing_status <> 'processed'
         RETURNING id`,
      ).bind(event.type, event.idempotencyKey, JSON.stringify(event.raw)).first()
    } catch (err) {
      // The ledger write itself failed, so D1 is down or over its daily
      // row-write quota and NOTHING about this event has been recorded.
      // ACKing here is how inbound messages get lost silently, so hand the
      // payload back instead: Meta redelivers with backoff for up to 7 days,
      // which comfortably outlives a midnight-UTC quota reset. Events earlier
      // in this same payload are already claimed and skip themselves.
      logError('whatsapp.webhook.ledger_unavailable', err)
      return fail(c, 'WEBHOOK_STORAGE_UNAVAILABLE', 'Event store unavailable; please retry', 503)
    }

    if (!claim) continue

    try {
      await processEvent(c, event)
      await c.env.DB.prepare(
        `UPDATE webhook_events
         SET processing_status = 'processed', processed_at = datetime('now')
         WHERE idempotency_key = ?`,
      ).bind(event.idempotencyKey).run()
    } catch (err) {
      // Processing failed. Park the row as 'failed' and keep going: one bad
      // event (an unsupported shape, a media fetch that 404s) must not hold
      // up the rest of the payload, and the stored payload stays replayable.
      logError('whatsapp.webhook.event_failed', err)
      try {
        await c.env.DB.prepare(
          `UPDATE webhook_events SET processing_status = 'failed' WHERE idempotency_key = ?`,
        ).bind(event.idempotencyKey).run()
      } catch (markErr) {
        // Even the bookkeeping write failed, which means the failure above was
        // D1 being unavailable rather than a bad event. The row is stranded at
        // 'pending' with its payload intact; ask for redelivery so the claim
        // above picks it back up once writes work again.
        logError('whatsapp.webhook.mark_failed_unavailable', markErr)
        return fail(c, 'WEBHOOK_STORAGE_UNAVAILABLE', 'Event store unavailable; please retry', 503)
      }
    }
  }

  return ok(c, { received: true })
})

export default webhook
