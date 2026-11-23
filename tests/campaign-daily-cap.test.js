import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import campaigns from '../src/api/routes/campaigns/index.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'
import { releaseCampaignSends, reserveCampaignSends } from '../src/api/services/whatsapp/campaignBudget.js'

// The daily ceiling on WhatsApp campaign messages (pre-launch audit 3.4). The
// counter's SQL runs against real SQLite here, with migration 0014 applied, through
// a small stand-in for D1's prepare/bind/batch. Synthetic data.

function d1(sqlite) {
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
    exec: () => {
      const prepared = sqlite.prepare(sql)
      if (/^\s*SELECT|RETURNING/i.test(sql)) return { results: prepared.all(...args) }
      prepared.run(...args)
      return { results: [] }
    },
  })
  return {
    prepare: (sql) => statement(sql),
    // D1 runs a batch as one transaction.
    batch: async (statements) => {
      sqlite.exec('BEGIN')
      try {
        const out = statements.map((s) => s.exec())
        sqlite.exec('COMMIT')
        return out
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
    },
  }
}

function budgetDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../migrations/0014_campaign_send_budget.sql', import.meta.url), 'utf8'))
  return { sqlite, DB: d1(sqlite) }
}

const usedToday = (sqlite) => sqlite.prepare('SELECT sent FROM campaign_send_budget WHERE day = ?').get(new Date().toISOString().slice(0, 10))?.sent ?? 0

beforeEach((t) => {
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
})

test('places are granted until the ceiling, then partly, then not at all', async () => {
  const { sqlite, DB } = budgetDb()
  const env = { DB, WHATSAPP_CAMPAIGN_DAILY_CAP: '100' }
  assert.equal(await reserveCampaignSends(env, 40), 40)
  assert.equal(await reserveCampaignSends(env, 40), 40)
  assert.equal(await reserveCampaignSends(env, 40), 20, 'only what is left of the 100')
  assert.equal(await reserveCampaignSends(env, 40), 0)
  assert.equal(usedToday(sqlite), 100)
})

test('places a stopped batch never used are given back', async () => {
  const { sqlite, DB } = budgetDb()
  const env = { DB, WHATSAPP_CAMPAIGN_DAILY_CAP: '100' }
  await reserveCampaignSends(env, 60)
  await releaseCampaignSends(env, 25)
  assert.equal(usedToday(sqlite), 35)
  await releaseCampaignSends(env, 500)
  assert.equal(usedToday(sqlite), 0, 'never below zero')
})

test('a lowered ceiling grants nothing and never lowers what was already used', async () => {
  const { sqlite, DB } = budgetDb()
  await reserveCampaignSends({ DB, WHATSAPP_CAMPAIGN_DAILY_CAP: '100' }, 90)
  assert.equal(await reserveCampaignSends({ DB, WHATSAPP_CAMPAIGN_DAILY_CAP: '50' }, 10), 0)
  assert.equal(usedToday(sqlite), 90)
})

test('a missing or invalid ceiling, or a missing table, sends nothing', async () => {
  const { DB } = budgetDb()
  for (const cap of [undefined, '', '0', '-5', 'lots', '2.5']) {
    assert.equal(await reserveCampaignSends({ DB, WHATSAPP_CAMPAIGN_DAILY_CAP: cap }, 10), null, `cap ${cap}`)
  }
  const bare = d1(new DatabaseSync(':memory:'))
  assert.equal(await reserveCampaignSends({ DB: bare, WHATSAPP_CAMPAIGN_DAILY_CAP: '100' }, 10), null, 'migration 0014 not applied')
  assert.equal(await reserveCampaignSends({ DB, WHATSAPP_CAMPAIGN_DAILY_CAP: '100' }, 0), 0)
})

// The route: the ceiling runs out part way through the first batch.
let queries
let sends
function fakeDb({ usedBefore, cap }) {
  const answer = (sql, args) => {
    queries.push({ sql, args })
    return {
      first: async () => {
        if (/INSERT INTO campaigns/.test(sql)) return { id: 9 }
        if (/SUM\(CASE/.test(sql)) return { sent: sends.length, failed: 0 }
        return null
      },
      all: async () => {
        if (/FROM contacts/.test(sql)) return { results: [{ id: 1, phone: '919800000001', name: 'A' }, { id: 2, phone: '919800000002', name: 'B' }] }
        if (/RETURNING contact_id/.test(sql)) return { results: [{ contact_id: args[1] }] }
        if (/SELECT sent FROM campaign_send_budget/.test(sql)) return { results: [{ sent: usedBefore }] }
        if (/UPDATE campaign_send_budget SET sent = MIN/.test(sql)) return { results: [{ sent: Math.min(usedBefore + args[1], Math.max(usedBefore, cap)) }] }
        return { results: [] }
      },
      run: async () => ({ meta: { changes: 1 } }),
    }
  }
  return {
    prepare: (sql) => ({ bind: (...args) => answer(sql, args), first: () => answer(sql, []).first(), all: () => answer(sql, []).all(), run: () => answer(sql, []).run() }),
    batch: async (statements) => Promise.all(statements.map((s) => s.all())),
  }
}

function send(db, cap) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => { c.set('user', { id: 'u-sender', permissions: { 'campaigns.send': 'all' } }); await next() })
  app.route('/campaigns', campaigns)
  const body = { name: 'Diwali', contactIds: [1, 2], templateName: 'welcome', templateLanguage: 'en', templateBody: 'Hi', requestId: 'bbbbbbbb-2222-4222-8222-222222222222' }
  return app.request('/campaigns/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, {
    DB: db, WHATSAPP_ACCESS_TOKEN: 'synthetic', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_CAMPAIGN_DAILY_CAP: cap,
  }, { waitUntil() {}, passThroughOnException() {} })
}

beforeEach((t) => {
  queries = []
  sends = []
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    sends.push(JSON.parse(init.body ?? '{}'))
    return Response.json({ messages: [{ id: `wamid.${sends.length}` }] })
  })
})

test('when the ceiling runs out mid-batch, only the covered recipients are sent and the campaign stops', async () => {
  const res = await send(fakeDb({ usedBefore: 4, cap: 5 }), '5')
  assert.equal(res.status, 200)
  const { data } = await res.json()
  assert.equal(sends.length, 1, 'one place was left')
  assert.equal(data.halted.code, 'daily_limit')
  assert.equal(data.halted.resumable, true)
  assert.deepEqual(data.notSent, [2])
  const release = queries.find((q) => /DELETE FROM messages/.test(q.sql))
  assert.deepEqual(release.args, [9, 2], 'the uncovered recipient goes back to never attempted')
  assert.ok(queries.some((q) => /UPDATE campaigns SET status = 'stopped'/.test(q.sql)))
})

test('with no counter the campaign sends nothing and says so', async () => {
  const res = await send(fakeDb({ usedBefore: 0, cap: 100 }), undefined)
  const { data } = await res.json()
  assert.equal(sends.length, 0)
  assert.equal(data.halted.code, 'budget_unavailable')
  assert.deepEqual(data.notSent, [1, 2])
})

test('under the ceiling a campaign goes out as before', async () => {
  const res = await send(fakeDb({ usedBefore: 0, cap: 5000 }), '5000')
  const { data } = await res.json()
  assert.equal(sends.length, 2)
  assert.equal(data.halted, undefined)
})
