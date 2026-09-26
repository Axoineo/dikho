#!/usr/bin/env node
//
// Replays webhook events that were stored but never applied.
//
// The webhook writes every Meta event to the `webhook_events` ledger before
// acting on it, so an event whose processing died mid-flight is still on disk
// with its payload intact — it just never reached the `messages` table. That
// is what happened on 2026-09-25, when D1 hit its free-tier daily row-write
// cap: 177 delivery/read receipts landed in the ledger and stuck at 'pending',
// leaving the dashboard under-reporting delivered/read counts.
//
// This regenerates the writes those events should have made, from the stored
// payloads, and marks them processed. It is idempotent: receipts only ever
// move a message's status forward (see STATUS_RANK), and re-running after a
// successful pass finds nothing left to do.
//
// Usage:
//   node scripts/whatsapp/replay-webhook-events.mjs           # dry run
//   node scripts/whatsapp/replay-webhook-events.mjs --apply   # write to D1
//
// Status receipts only. Stranded *message* events are not replayed here: they
// re-host media and broadcast to open tabs, so they belong on the real code
// path rather than in generated SQL.

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const DB = 'dikho-whatsapp'
const CONFIG = 'wrangler.api.jsonc'
const APPLY = process.argv.includes('--apply')
const OUT = 'scripts/whatsapp/.replay.sql'

// Mirrors processStatus() in src/api/routes/whatsapp/webhook.js. Keep in sync:
// a receipt must never downgrade a status Meta already advanced past.
const STATUS_COLUMN = { sent: 'sent_at', delivered: 'delivered_at', read: 'read_at', failed: 'failed_at' }
const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 }
const STORED_RANK_SQL = `CASE status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END`

const quote = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

function d1(sql, { json = true } = {}) {
  const args = ['wrangler', 'd1', 'execute', DB, '--remote', '-c', CONFIG]
  if (json) args.push('--json')
  args.push('--command', sql)
  const out = execFileSync('npx', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (!json) return out
  // wrangler prefixes npm notices; the JSON payload starts at the first bracket.
  return JSON.parse(out.slice(out.indexOf('[')))
}

const rows = d1(
  `SELECT idempotency_key, payload FROM webhook_events
   WHERE event_type = 'status' AND processing_status <> 'processed'
   ORDER BY id`,
)[0].results

if (rows.length === 0) {
  console.log('Nothing to replay — every stored status event is already processed.')
  process.exit(0)
}

const statements = []
const counts = {}
let skipped = 0

for (const row of rows) {
  const status = JSON.parse(row.payload)
  const column = STATUS_COLUMN[status.status]
  if (!column) { skipped += 1; continue }

  const at = status.timestamp
    ? new Date(Number(status.timestamp) * 1000).toISOString()
    : new Date().toISOString()
  const errorCode = status.errors?.[0]?.code ? String(status.errors[0].code) : null
  const errorMessage = status.errors?.[0]?.title ?? null

  statements.push(
    `UPDATE messages SET
       status = CASE WHEN ${STATUS_RANK[status.status] ?? 0} > (${STORED_RANK_SQL}) THEN ${quote(status.status)} ELSE status END,
       ${column} = COALESCE(${column}, ${quote(at)}),
       error_code = COALESCE(${quote(errorCode)}, error_code),
       error_message = COALESCE(${quote(errorMessage)}, error_message)
     WHERE meta_message_id = ${quote(status.id)};`,
    `UPDATE webhook_events SET processing_status = 'processed', processed_at = datetime('now')
     WHERE idempotency_key = ${quote(row.idempotency_key)};`,
  )
  counts[status.status] = (counts[status.status] ?? 0) + 1
}

writeFileSync(OUT, statements.join('\n') + '\n')

console.log(`Stranded status events: ${rows.length}`)
for (const [status, n] of Object.entries(counts)) console.log(`  ${status}: ${n}`)
if (skipped) console.log(`  (${skipped} skipped — unrecognised status)`)
console.log(`\n${statements.length} statements written to ${OUT}`)

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write these to D1.')
  process.exit(0)
}

console.log('\nApplying to D1...')
console.log(
  execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '-c', CONFIG, '--file', OUT], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  }).slice(-800),
)
