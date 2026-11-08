import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import webhook from '../src/api/routes/whatsapp/webhook.js'
import conversations from '../src/api/routes/whatsapp/conversations.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'
import { STOP_REPLY, optKeyword } from '../src/api/services/whatsapp/optKeywords.js'

// A customer's "STOP" opts them out and gets one confirmation reply; "START"
// opts them back in. A fake D1 answers by the SQL it sees; Meta is a fake
// fetch. Synthetic data only.

const SECRET = 'synthetic-app-secret'
const PHONE = '919876543210'

let queries
let db
let sends
let background

function fakeDb() {
  const answer = (sql, args) => {
    queries.push({ sql, args })
    const pick = (list) => {
      const hit = list.find(([match]) => match.test(sql))?.[1]
      return typeof hit === 'function' ? hit(args) : hit
    }
    return {
      first: async () => pick(db.first) ?? null,
      all: async () => ({ results: pick(db.all) ?? [] }),
      run: async () => ({ meta: { changes: pick(db.run) ?? 1 } }),
    }
  }
  return {
    prepare: (sql) => ({ bind: (...args) => answer(sql, args), first: () => answer(sql, []).first(), all: () => answer(sql, []).all(), run: () => answer(sql, []).run() }),
    batch: async (statements) => Promise.all(statements.map((s) => s.run())),
  }
}

const ENV = () => ({ DB: fakeDb(), WHATSAPP_APP_SECRET: SECRET, WHATSAPP_ACCESS_TOKEN: 'synthetic', WHATSAPP_PHONE_NUMBER_ID: '1' })
const CTX = () => ({ waitUntil(promise) { background.push(promise) }, passThroughOnException() {} })

async function inbound(message) {
  const app = new Hono()
  app.onError(errorHandler)
  app.route('/webhook', webhook)
  const raw = JSON.stringify({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: PHONE, profile: { name: 'Synthetic Person' } }],
    messages: [{ id: 'wamid.IN1', from: PHONE, timestamp: '1700000000', ...message }],
  } }] }] })
  const signature = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`
  const res = await app.request('/webhook', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body: raw }, ENV(), CTX())
  await Promise.all(background)
  return res
}

const CONV = { id: 9, phone: PHONE, contact_id: 5, blocked_at: null }
const optUpdate = () => queries.find((q) => /UPDATE contacts SET opted_out/.test(q.sql))

beforeEach((t) => {
  queries = []
  sends = []
  background = []
  db = {
    first: [
      [/INSERT INTO webhook_events/, { id: 1 }],
      [/SELECT id FROM contacts/, { id: 5 }],
      [/FROM conversations WHERE phone/, CONV],
      [/FROM conversations WHERE id/, CONV],
      [/FROM messages WHERE meta_message_id/, (args) => ({ id: args[0] === 'wamid.OUT1' ? 101 : 100, meta_message_id: args[0] })],
    ],
    all: [],
    run: [],
  }
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    sends.push({ url: String(url), body: JSON.parse(init.body ?? '{}') })
    return Response.json({ messages: [{ id: 'wamid.OUT1' }] })
  })
})

test('only a bare STOP or START counts, in any capitals, typed or tapped', () => {
  for (const body of ['STOP', 'Stop', 'stop', '  stop. ', 'STOP!', 'Stop!!']) assert.equal(optKeyword({ text: { body } }), 'stop', body)
  for (const body of ['START', 'Start', 'start', 'start.']) assert.equal(optKeyword({ text: { body } }), 'start', body)
  for (const body of ['stop please', 'please stop', 'stopp', 'non-stop', 'STOP STOP', 'restart', '', 'x'.repeat(40)]) {
    assert.equal(optKeyword({ text: { body } }), null, body)
  }
  assert.equal(optKeyword({ type: 'button', button: { text: 'Stop' } }), 'stop')
  assert.equal(optKeyword({ type: 'interactive', interactive: { button_reply: { title: 'START' } } }), 'start')
  assert.equal(optKeyword({ type: 'image', image: { id: '1' } }), null)
  assert.equal(optKeyword(null), null)
})

test('STOP opts the contact out and sends the confirmation once, kept in the chat', async () => {
  const res = await inbound({ type: 'text', text: { body: 'Stop' } })
  assert.equal(res.status, 200)

  assert.deepEqual(optUpdate().args, [1, PHONE])
  assert.equal(sends.length, 1)
  assert.equal(sends[0].body.to, PHONE)
  assert.equal(sends[0].body.type, 'text')
  assert.equal(sends[0].body.text.body, STOP_REPLY)
  assert.match(STOP_REPLY, /^Your request to STOP receiving updates has been successfully registered\.\n\nPlease reply START/)

  const kept = queries.find((q) => /INSERT INTO messages/.test(q.sql) && /'outbound'/.test(q.sql))
  assert.ok(kept, 'the reply is recorded in the thread')
  assert.deepEqual(kept.args.slice(0, 5), [9, 5, PHONE, 'wamid.OUT1', STOP_REPLY])
})

test('START opts the contact back in, without a reply', async () => {
  await inbound({ type: 'text', text: { body: 'START' } })
  assert.deepEqual(optUpdate().args, [0, PHONE])
  assert.equal(sends.length, 0)
})

test('an ordinary message changes nothing', async () => {
  await inbound({ type: 'text', text: { body: 'Please stop calling me after 6' } })
  assert.equal(optUpdate(), undefined)
  assert.equal(sends.length, 0)
})

test('a redelivered STOP is not answered twice', async () => {
  db.run.push([/INSERT INTO messages/, 0])
  await inbound({ type: 'text', text: { body: 'STOP' } })
  assert.equal(optUpdate(), undefined)
  assert.equal(sends.length, 0)
})

test('a blocked number is opted out but gets no reply', async () => {
  db.first = db.first.map(([match, value]) => (/WHERE phone/.test(String(match)) ? [match, { ...CONV, blocked_at: '2026-11-01T00:00:00Z' }] : [match, value]))
  await inbound({ type: 'text', text: { body: 'stop' } })
  assert.deepEqual(optUpdate().args, [1, PHONE])
  assert.equal(sends.length, 0)
})

test('a failed confirmation is logged, the opt-out still stands, and nothing fake lands in the chat', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 131047, message: 'Re-engagement message' } }, { status: 400 }))
  const res = await inbound({ type: 'text', text: { body: 'STOP' } })
  assert.equal(res.status, 200)
  assert.deepEqual(optUpdate().args, [1, PHONE])
  assert.ok(!queries.some((q) => /INSERT INTO messages/.test(q.sql) && /'outbound'/.test(q.sql)))
})

test('the chat list carries each contact\'s opt-out, for the inbox warning', async () => {
  db.all = [[/FROM conversations conv/, [{ id: 9, phone: PHONE, opted_out: 1 }]]]
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => { c.set('user', { id: 'u', permissions: { 'inbox.view': 'all' } }); await next() })
  app.route('/conversations', conversations)
  const res = await app.request('/conversations', {}, ENV(), CTX())
  assert.equal(res.status, 200)
  assert.equal((await res.json()).data.conversations[0].opted_out, 1)
  assert.match(queries.find((q) => /FROM conversations conv/.test(q.sql)).sql, /ct\.opted_out AS opted_out/)
})
