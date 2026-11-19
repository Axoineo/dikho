import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import campaigns from '../src/api/routes/campaigns/index.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'
import { createApiApp } from '../src/api/app.js'

// A retried "Send" must not message everyone twice, and a batch must not choose its
// own template. A fake D1 answers by the SQL it sees and Meta is a fake fetch; the
// SQL's real behaviour is checked against SQLite in the task brief. Synthetic data.

const SENDER = { id: 'u-sender', permissions: { 'campaigns.send': 'all' } }

let queries
let db
let sends
function fakeDb() {
  const answer = (sql, args) => {
    queries.push({ sql, args })
    const pick = (list) => list.find(([match]) => match.test(sql))?.[1]
    return {
      first: async () => { const handler = pick(db.first); return typeof handler === 'function' ? handler(args) : handler ?? null },
      all: async () => ({ results: pick(db.all) ?? [] }),
      run: async () => ({ meta: { changes: 1 } }),
    }
  }
  return {
    prepare: (sql) => ({ bind: (...args) => answer(sql, args), first: () => answer(sql, []).first(), all: () => answer(sql, []).all(), run: () => answer(sql, []).run() }),
    batch: async (statements) => Promise.all(statements.map((s) => s.all())),
  }
}

function request(path, body, user = SENDER) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => { c.set('user', user); await next() })
  app.route('/campaigns', campaigns)
  return app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, {
    DB: fakeDb(), WHATSAPP_ACCESS_TOKEN: 'synthetic', WHATSAPP_PHONE_NUMBER_ID: '1',
  }, { waitUntil() {}, passThroughOnException() {} })
}

const SEND = { name: 'Diwali', contactIds: [1, 2], templateName: 'welcome', templateLanguage: 'en', templateBody: 'Hi', requestId: 'aaaaaaaa-1111-4111-8111-111111111111' }

beforeEach((t) => {
  queries = []
  sends = []
  db = {
    first: [[/sent_count, failed_count/, { sent_count: 2, failed_count: 0 }], [/SUM\(CASE/, { sent: 2, failed: 0 }]],
    all: [
      [/FROM contacts/, [{ id: 1, phone: '919800000001', name: 'A' }, { id: 2, phone: '919800000002', name: 'B' }]],
      [/RETURNING contact_id|claim/i, []],
    ],
  }
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    sends.push(JSON.parse(init.body ?? '{}'))
    return Response.json({ messages: [{ id: `wamid.${sends.length}` }] })
  })
})

test('the first press creates one campaign under its id', async () => {
  db.first.unshift([/INSERT INTO campaigns/, { id: 7 }])
  const res = await request('/campaigns/send', SEND)
  assert.equal(res.status, 200)
  const insert = queries.find((q) => /INSERT INTO campaigns/.test(q.sql))
  assert.match(insert.sql, /ON CONFLICT\(request_id\) DO NOTHING/)
  assert.equal(insert.args.at(-1), SEND.requestId)
  assert.equal((await res.json()).data.campaignId, 7)
})

test('a retry finds the same campaign and reports its real totals', async () => {
  db.first.unshift([/INSERT INTO campaigns/, null], [/SELECT id FROM campaigns WHERE request_id/, { id: 7 }])
  const res = await request('/campaigns/send', SEND)
  assert.equal(res.status, 200)
  const { data } = await res.json()
  assert.equal(data.campaignId, 7)
  assert.equal(data.sent, 2, 'the lost first attempt still counts')
})

test('a request with no id or a malformed one behaves as before', async () => {
  db.first.unshift([/INSERT INTO campaigns/, { id: 8 }])
  for (const requestId of [undefined, '', 'short', "x'; DROP TABLE campaigns;--", 5]) {
    queries = []
    await request('/campaigns/send', { ...SEND, requestId })
    const insert = queries.find((q) => /INSERT INTO campaigns/.test(q.sql))
    assert.doesNotMatch(insert.sql, /request_id/, `requestId=${requestId}`)
  }
})

test('a batch sends the template recorded on the campaign, whatever the request says', async () => {
  db.first.unshift([/SELECT template_name, template_language FROM campaigns/, { template_name: 'welcome', template_language: 'en' }])
  db.all = [[/FROM contacts/, [{ id: 1, phone: '919800000001', name: 'A' }]]]
  await request('/campaigns/send-batch', { campaignId: 7, contactIds: [1], templateName: 'something_else', templateLanguage: 'fr' })
  assert.ok(queries.some((q) => /SELECT template_name, template_language FROM campaigns/.test(q.sql)))
  for (const body of sends) assert.notEqual(body?.template?.name, 'something_else')
})

test('a batch for a campaign that does not exist is refused, with nothing sent', async () => {
  const res = await request('/campaigns/send-batch', { campaignId: 999, contactIds: [1] })
  assert.equal(res.status, 404)
  assert.equal(sends.length, 0)
})

test('sending needs campaigns.send', async () => {
  const res = await request('/campaigns/send', SEND, { id: 'x', permissions: { 'campaigns.view': 'all' } })
  assert.equal(res.status, 403)
  assert.equal(queries.length, 0)
})

// ── The session check ──────────────────────────────────────────────────────

const ENV = { SUPABASE_URL: 'https://db.example.invalid', SUPABASE_ANON_KEY: 'synthetic-anon', DB: null }

for (const path of ['/api/contacts', '/api/campaigns', '/api/templates', '/api/users', '/api/whatsapp/conversations']) {
  test(`${path}: no token is refused, and a live session is checked exactly once`, async (t) => {
    const app = createApiApp()
    const ctx = { waitUntil() {}, passThroughOnException() {} }
    const env = { ...ENV, DB: fakeDb() }
    assert.equal((await app.request(path, {}, env, ctx)).status, 401)

    let checks = 0
    t.mock.method(globalThis, 'fetch', async (url) => {
      if (String(url).includes('my_access')) {
        checks += 1
        return Response.json({ status: 'active', user_id: 'u', session_id: 's', system_role: 'owner', permissions: {} })
      }
      return Response.json({})
    })
    await app.request(path, { headers: { Authorization: 'Bearer synthetic-session' } }, env, ctx)
    assert.equal(checks, 1, 'one Supabase round trip per request')
  })
}
