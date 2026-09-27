#!/usr/bin/env node
//
// Re-applies delivery receipts that reached the webhook before their message
// row had a wamid.
//
// A campaign send claims its rows as `pending` with no wamid, fires every Meta
// request, and only writes the wamids back once the whole batch returns
// (finalizeMessages in src/api/routes/campaigns/index.js). Meta's policy
// rejections — 131049, "not delivered to maintain healthy ecosystem
// engagement" — come back in milliseconds, so the receipt arrives while
// meta_message_id is still NULL. The live UPDATE matched nothing, the event
// was marked 'processed', and the row sat at `sent` forever.
//
// That is why our overview disagreed with Meta's: 772 failures and 11
// deliveries from campaign 13 were stranded in the ledger with their payloads
// intact. The webhook now parks such receipts as 'unmatched' and a cron drains
// them (src/api/services/whatsapp/reconcile.js); this script is the one-off
// repair for everything dropped before that existed.
//
// Usage:
//   node scripts/whatsapp/reconcile-receipts.mjs            # dry run
//   node scripts/whatsapp/reconcile-receipts.mjs --apply    # write to D1
//
// Idempotent: receipts only move a status forward, and a second pass finds
// nothing. Related: ./replay-webhook-events.mjs, which handles the different
// failure mode of events stranded at 'pending' by the 2026-09-25 quota stall.

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { buildStatusSql, SETTLE_LEDGER_SQL } from '../../src/api/services/whatsapp/reconcile.js'

const DB = 'dikho-whatsapp'
const CONFIG = 'wrangler.api.jsonc'
const APPLY = process.argv.includes('--apply')
const OUT = 'scripts/whatsapp/.reconcile.sql'
const STATUSES = ['sent', 'delivered', 'read', 'failed']

const quote = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

// buildStatusSql is written for D1's bound parameters; inline them so the
// statements can be handed to `wrangler d1 execute --file`.
const inline = ({ sql, params }) =>
  sql.replace(/\?(\d)/g, (_, n) => quote(params[Number(n) - 1]))

function d1(args) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '-c', CONFIG, ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const start = out.indexOf('[')
  return start === -1 ? [] : JSON.parse(out.slice(start))
}

// Counts rows each receipt would actually move, without writing anything.
const PREVIEW_SQL = `
WITH ev AS (
  SELECT substr(idempotency_key, 1, instr(idempotency_key, ':') - 1) AS wamid,
         substr(idempotency_key, instr(idempotency_key, ':') + 1) AS st
  FROM webhook_events WHERE event_type = 'status'
), j AS (
  SELECT ev.st, m.status, m.delivered_at, m.read_at,
    CASE ev.st WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END AS rr,
    CASE m.status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END AS sr
  FROM ev JOIN messages m ON m.meta_message_id = ev.wamid
)
SELECT st, COUNT(*) AS matched,
  SUM(CASE WHEN rr > sr AND (st <> 'failed'
        OR (status IN ('pending','sent') AND delivered_at IS NULL AND read_at IS NULL))
      THEN 1 ELSE 0 END) AS would_advance
FROM j GROUP BY st ORDER BY st`

const statements = [
  ...STATUSES.map((s) => inline(buildStatusSql(s, { includeProcessed: true }))),
  SETTLE_LEDGER_SQL,
  // Campaign rollups are derived from the rows this pass just corrected.
  `UPDATE campaigns SET
     sent_count = (SELECT COUNT(*) FROM messages
                   WHERE campaign_id = campaigns.id AND status IN ('sent','delivered','read')),
     failed_count = (SELECT COUNT(*) FROM messages
                     WHERE campaign_id = campaigns.id AND status = 'failed')`,
]

writeFileSync(OUT, statements.map((s) => `${s.trim()};`).join('\n\n') + '\n')

console.log(`Wrote ${statements.length} statements to ${OUT}\n`)
for (const row of d1(['--json', '--command', PREVIEW_SQL])[0]?.results ?? []) {
  console.log(`  ${row.st.padEnd(10)} ${String(row.matched).padStart(5)} receipts matched a row, ` +
    `${row.would_advance} would change its status`)
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.')
  process.exit(0)
}

console.log('\nApplying...')
for (const result of d1(['--json', '--file', OUT])) {
  console.log(`  rows written: ${result.meta?.rows_written ?? 0}`)
}
console.log('Done.')
