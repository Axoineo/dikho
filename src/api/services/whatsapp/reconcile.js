import { STATUS_COLUMN, STATUS_RANK, storedRankSql } from './messageStatus.js'
import { processInboundMessage } from './inbound.js'
import { logEvent, logError } from '../../utils/logger.js'

// Replays stored delivery receipts onto their message rows.
//
// Why this has to exist: a campaign send claims its rows as `pending` with no
// wamid, fires every Meta request, and only writes the wamids back afterwards
// (finalizeMessages in routes/campaigns/index.js). Meta's policy rejections —
// notably 131049, "not delivered to maintain healthy ecosystem engagement" —
// come back within milliseconds, so the receipt reaches the webhook while the
// row still has meta_message_id = NULL. The live UPDATE matches nothing and
// the receipt is stranded even though its payload is safely in the ledger.
// That is how 772 failures and 11 deliveries from campaign 13 stayed invisible
// while the rows sat at `sent`, making our delivery rate disagree with Meta's.
//
// The webhook now parks an unmatched receipt as 'unmatched' instead of
// 'processed', and this pass re-applies it once the wamid lands.
//
// Written as four UPDATE ... FROM statements rather than a read-then-write
// loop: D1's free plan bills row *writes* (100k/day) and caps bound
// parameters at 100 per query, so the WHERE clause below is deliberately
// narrow enough to touch only rows that actually change.
export function buildStatusSql(status, { includeProcessed = false, sinceIso = null } = {}) {
  const column = STATUS_COLUMN[status]
  if (!column) return null

  const conditions = ["event_type = 'status'", 'substr(idempotency_key, instr(idempotency_key, \':\') + 1) = ?2']
  if (!includeProcessed) conditions.push("processing_status = 'unmatched'")
  if (sinceIso) conditions.push('received_at >= ?3')

  // A replay applies receipts out of order by construction — we may be handing
  // a row a failure recorded before a delivery that has since been applied.
  // The rank guard alone is not enough here: `failed` outranks everything, so
  // a stale 131049 would bury a message we know reached the phone. Gate it on
  // the status as well as the timestamps, because a row can legitimately read
  // 'delivered' with a null delivered_at (29 of them do — their delivery
  // receipt was lost and only the later read receipt landed).
  const notAlreadyTerminal = status === 'failed'
    ? "AND m.status IN ('pending', 'sent') AND m.delivered_at IS NULL AND m.read_at IS NULL"
    : ''

  const sql = `UPDATE messages AS m
     SET status = CASE WHEN ?1 > (${storedRankSql('m.status')}) THEN ?2 ELSE m.status END,
         ${column} = COALESCE(m.${column}, e.at),
         error_code = COALESCE(m.error_code, e.code),
         error_message = COALESCE(m.error_message, e.title)
     FROM (
       SELECT substr(idempotency_key, 1, instr(idempotency_key, ':') - 1) AS wamid,
              strftime('%Y-%m-%dT%H:%M:%fZ',
                       CAST(json_extract(payload, '$.timestamp') AS INTEGER), 'unixepoch') AS at,
              CAST(json_extract(payload, '$.errors[0].code') AS TEXT) AS code,
              json_extract(payload, '$.errors[0].title') AS title
       FROM webhook_events
       WHERE ${conditions.join(' AND ')}
     ) AS e
     WHERE m.meta_message_id = e.wamid
       ${notAlreadyTerminal}
       -- Skip rows this receipt would leave untouched, so a no-op sweep costs
       -- reads only and never eats into the daily row-write budget.
       AND (?1 > (${storedRankSql('m.status')}) OR m.${column} IS NULL)`

  return { sql, params: [STATUS_RANK[status], status, ...(sinceIso ? [sinceIso] : [])] }
}

async function applyStatus(db, status, options) {
  const built = buildStatusSql(status, options)
  if (!built) return 0
  const result = await db.prepare(built.sql).bind(...built.params).run()
  return result.meta?.changes ?? 0
}

// Clears the backlog flag on every parked receipt whose message row now
// exists. Rows that stay 'unmatched' are receipts for sends we never stored
// (superseded retry attempts keep their old wamid in the ledger) — harmless,
// and worth keeping as evidence rather than deleting.
export const SETTLE_LEDGER_SQL = `UPDATE webhook_events
     SET processing_status = 'processed', processed_at = datetime('now')
     WHERE processing_status = 'unmatched'
       AND EXISTS (
         SELECT 1 FROM messages m
         WHERE m.meta_message_id =
           substr(webhook_events.idempotency_key, 1,
                  instr(webhook_events.idempotency_key, ':') - 1)
       )`

async function settleLedger(db) {
  const result = await db.prepare(SETTLE_LEDGER_SQL).run()
  return result.meta?.changes ?? 0
}

// `includeProcessed` widens the sweep to receipts the webhook already ACKed —
// needed once, to repair receipts dropped before the 'unmatched' flag existed.
// The routine (cron) path leaves it off and only drains the parked backlog.
export async function reconcileStatuses(db, { includeProcessed = false, sinceIso = null } = {}) {
  const applied = {}
  for (const status of ['sent', 'delivered', 'read', 'failed']) {
    applied[status] = await applyStatus(db, status, { includeProcessed, sinceIso })
  }
  const settled = await settleLedger(db)
  return { applied, settled }
}

// Opportunistic status reconcile, driven by request traffic.
//
// WHY: this sweep only ever ran on the `*/10 * * * *` cron, and that cron does
// not fire on this account — see the cloudflare-cron-not-firing notes and
// services/whatsapp/cgLeadConfirmation.js for the evidence (a probe row 7+
// minutes overdue, a 100-second `wrangler tail` with zero invocations). So the
// safety net for the receipt-before-wamid race described at the top of this
// file has been disarmed: a parked receipt would sit 'unmatched' forever and
// our delivery numbers would quietly under-report Meta's, which is exactly the
// failure that hid 772 campaign-13 rejections once already.
//
// Checked 2026-10-01: nothing is currently stranded (0 actionable receipts, 0
// inbound messages missing a row). This is about keeping it that way.
//
// GUARDED so it is nearly free when idle: the cheap probe below asks whether
// any parked receipt actually has a message row to land on, and the full sweep
// only runs if one does. That matters because there are permanently
// unmatchable orphans in the ledger — 13 of them, receipts for sends we never
// stored (superseded retries keep their old wamid) — and a naive
// "are there unmatched rows?" check would be true forever and run the sweep on
// every request. The probe reads the `processing_status` index, then does at
// most a handful of `meta_message_id` lookups.
//
// reconcileInbound is deliberately NOT called here: its guard query is a
// NOT EXISTS scan over every message-type event rather than an indexed lookup,
// and it exists for a one-time historical repair (two pre-inbox messages from
// 2026-09-24) rather than an ongoing race. It stays on the cron, for if the
// cron ever starts working.
let lastReconcileAt = 0
const RECONCILE_INTERVAL_MS = 120_000

export function maybeReconcileOnRequest(c) {
  if (!c.env?.DB || !c.executionCtx) return
  const now = Date.now()
  if (now - lastReconcileAt < RECONCILE_INTERVAL_MS) return
  lastReconcileAt = now

  c.executionCtx.waitUntil((async () => {
    try {
      const actionable = await c.env.DB.prepare(
        `SELECT 1 FROM webhook_events w
         JOIN messages m
           ON m.meta_message_id = substr(w.idempotency_key, 1, instr(w.idempotency_key, ':') - 1)
         WHERE w.processing_status = 'unmatched'
         LIMIT 1`,
      ).first()
      if (!actionable) return

      const result = await reconcileStatuses(c.env.DB)
      logEvent('whatsapp.reconcile.opportunistic', result)
    } catch (err) {
      logError('whatsapp.reconcile.opportunistic_failed', err)
    }
  })())
}

// Re-runs inbound customer messages that reached the ledger but never became a
// row — two of them from 2026-09-24, received before the inbox shipped, so the
// webhook of the day ACKed them with nothing to write them to. Their payloads
// survived, so the thread can still be recovered.
//
// Deliberately goes through processInboundMessage rather than generated SQL:
// an inbound message also upserts the contact and conversation, re-hosts its
// media into R2 and broadcasts to open agent tabs. Replaying only the row
// would leave the rest half-built. `ctx` needs `env` and `executionCtx`, which
// both a Hono context and a { env, executionCtx } shim from the cron satisfy.
export async function reconcileInbound(ctx, { limit = 25 } = {}) {
  const { results } = await ctx.env.DB.prepare(
    `SELECT idempotency_key, payload FROM webhook_events AS w
     WHERE w.event_type = 'message'
       AND NOT EXISTS (
         SELECT 1 FROM messages m WHERE m.meta_message_id = w.idempotency_key
       )
     ORDER BY w.received_at
     LIMIT ?1`,
  ).bind(limit).all()

  let replayed = 0
  for (const row of results ?? []) {
    try {
      const raw = JSON.parse(row.payload)
      // The WhatsApp profile name lived on the envelope's `contacts` array, not
      // on the message, so a replay cannot recover it. Both upserts COALESCE
      // the name, so passing null keeps whatever we already know.
      await processInboundMessage(ctx, {
        raw, from: raw.from, waName: null, timestamp: raw.timestamp,
      })
      replayed += 1
    } catch (err) {
      logError('whatsapp.reconcile.inbound_failed', err)
    }
  }
  return replayed
}
