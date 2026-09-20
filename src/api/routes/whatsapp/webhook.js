import { Hono } from 'hono'
import { ok, fail } from '../../utils/response.js'
import { logEvent, logError } from '../../utils/logger.js'

const webhook = new Hono()

// --- GET /api/whatsapp/webhook — Meta verification handshake -------------
//
// Meta calls this once when you save the webhook config in the App
// Dashboard. It must echo back hub.challenge as plain text/number with a
// 200 status if hub.verify_token matches, or Meta will refuse to save the
// subscription.
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

// --- POST /api/whatsapp/webhook — event receiver --------------------------
//
// IDEMPOTENCY STRATEGY (implemented fully once D1 lands in Phase 3/4):
//
// Meta retries webhook deliveries aggressively (network timeouts, non-200
// responses, etc.), so the same payload can arrive more than once. A single
// POST can also bundle several logically distinct sub-events in
// entry[].changes[].value, so idempotency has to be decided per sub-event,
// not per HTTP request:
//
//   - Incoming messages: value.messages[] — each has a stable Meta message
//     id ("wamid..."). That id alone is the idempotency key.
//   - Status updates: value.statuses[] — each has an id (the wamid the
//     status refers to) *and* a status (sent/delivered/read/failed). The
//     same wamid legitimately produces multiple status rows over time, so
//     the idempotency key there is the composite `${id}:${status}`.
//
// On arrival, every sub-event is upserted into `webhook_events`
// (idempotency_key TEXT UNIQUE) via `INSERT ... ON CONFLICT DO NOTHING`.
// Only rows that were actually inserted (not skipped as duplicates) get
// queued for processing — so replays are absorbed at the database layer
// before any business logic (message status writes, campaign counters)
// runs. A row's `processing_status` moves pending -> processed so a crash
// mid-processing can be retried without re-queuing.
//
// For now (Phase 2) we just log the payload and return 200 immediately —
// Meta requires a fast 200 regardless of whether processing succeeds, so
// heavier work will move to a Queue consumer rather than running inline
// here once it exists.
webhook.post('/', async (c) => {
  let payload
  try {
    payload = await c.req.json()
  } catch {
    // Still 200 — an unparseable retry from Meta should not be treated as
    // a failure that triggers more retries.
    logError('whatsapp.webhook.invalid_json', 'Body was not valid JSON')
    return ok(c, { received: true })
  }

  try {
    logEvent('whatsapp.webhook.received', payload)

    // TODO(Phase 3/4): for each entry[].changes[].value.{messages,statuses}
    // sub-event, compute its idempotency key (see strategy above), upsert
    // into webhook_events, and enqueue new ones onto a Cloudflare Queue for
    // async processing instead of handling them inline here.
  } catch (err) {
    // Never let a processing error turn into a non-200 — log and move on.
    logError('whatsapp.webhook.processing_error', err)
  }

  return ok(c, { received: true })
})

export default webhook
