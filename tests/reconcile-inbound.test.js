import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { FULL_INBOUND_SQL, ROUTINE_INBOUND_SQL, reconcileInbound } from '../src/api/services/whatsapp/reconcile.js'

// The routine inbound reconcile (the 10-minute cron) once scanned every event
// in the webhook ledger, about 11,000 rows a run, and used up D1's free 5
// million daily row reads on 2026-11-08. It must read through the
// processing_status index and leave fresh events to the live webhook; the full
// scan is for the manual repair route only. Synthetic data only.

let queries
const db = {
  prepare: (sql) => ({
    bind: (...args) => ({
      all: async () => { queries.push({ sql, args }); return { results: [] } },
      run: async () => { queries.push({ sql, args }); return { meta: { changes: 1 } } },
    }),
  }),
}

beforeEach(() => { queries = [] })

test('the routine pass reads only failed or unfinished events, never fresh ones', async () => {
  assert.match(ROUTINE_INBOUND_SQL, /processing_status IN \('pending', 'failed'\)/)
  assert.match(ROUTINE_INBOUND_SQL, /received_at < datetime\('now', '-10 minutes'\)/)
  await reconcileInbound({ env: { DB: db } })
  assert.equal(queries[0].sql, ROUTINE_INBOUND_SQL)
  assert.deepEqual(queries[0].args, [25])
})

test('only the manual repair asks for the full scan', async () => {
  assert.doesNotMatch(FULL_INBOUND_SQL, /processing_status/)
  await reconcileInbound({ env: { DB: db } }, { includeProcessed: true })
  assert.equal(queries[0].sql, FULL_INBOUND_SQL)
})
