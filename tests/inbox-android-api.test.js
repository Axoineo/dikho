import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import conversations from '../src/api/routes/whatsapp/conversations.js'
import contacts from '../src/api/routes/contacts/index.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'

// What the Android app adds to the API: paged lists with server search, smaller
// thread pages, and a template sent to a phone number. A fake D1 answers by the
// SQL it sees and Meta is a fake fetch; the SQL itself runs against real SQLite
// in the task brief's check. Synthetic data only.

const SENDER = { id: 'u-sender', permissions: { 'inbox.view': 'all', 'campaigns.send': 'all', 'wa_contacts.view': 'all' } }
const VIEWER = { id: 'u-viewer', permissions: { 'inbox.view': 'all' } }

let queries
let rows
let db
function fakeDb() {
  const answer = (sql, args) => {
    queries.push({ sql, args })
    const pick = (list) => list.find(([match]) => match.test(sql))?.[1]
    return {
      first: async () => {
        const handler = pick(db.first)
        return typeof handler === 'function' ? handler(args) : handler ?? null
      },
      all: async () => ({ results: (pick(db.all) ?? rows).slice() }),
      run: async () => { const handler = pick(db.run); if (handler) handler(args); return {} },
    }
  }
  return {
    prepare: (sql) => ({
      bind: (...args) => answer(sql, args),
      first: () => answer(sql, []).first(),
      all: () => answer(sql, []).all(),
    }),
  }
}

function request(path, { user = SENDER, env = {}, ...init } = {}) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => { c.set('user', user); await next() })
  app.route('/c', conversations)
  app.route('/contacts', contacts)
  const ctx = { waitUntil() {}, passThroughOnException() {} }
  return app.request(path, init, { DB: fakeDb(), WHATSAPP_DIRECT_TEMPLATE_DAILY_CAP: '200', WHATSAPP_ACCESS_TOKEN: 'synthetic', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_WABA_ID: '2', ...env }, ctx)
}
const post = (path, body, options = {}) => request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options,
})
const lastSelect = () => queries.findLast((q) => /FROM conversations conv/.test(q.sql))

let sends
let graphTemplates
beforeEach((t) => {
  queries = []
  rows = []
  sends = []
  db = { first: [], all: [], run: [] }
  graphTemplates = [{
    name: 'welcome', language: 'en', status: 'APPROVED', category: 'UTILITY',
    components: [{ type: 'BODY', text: 'Hello {{1}}' }],
  }]
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const text = String(url)
    if (text.includes('message_templates')) return Response.json({ data: graphTemplates })
    if (text.includes('/messages')) {
      sends.push(JSON.parse(init.body))
      return Response.json({ messages: [{ id: `wamid.synthetic.${sends.length}` }] })
    }
    return Response.json({})
  })
})

// ── The chat list ──────────────────────────────────────────────────────────

test('without a limit the list is the browser call: 200 rows and no paging fields', async () => {
  rows = [{ id: 1, last_message_at: '2026-11-01T00:00:00.000Z' }]
  const body = await (await request('/c')).json()
  assert.deepEqual(Object.keys(body.data), ['conversations'])
  assert.deepEqual(lastSelect().args, [200])
})

test('a page asks for one row more, and the cursor names its last row', async () => {
  rows = [3, 2, 1].map((id) => ({ id, last_message_at: `2026-11-0${id}T00:00:00.000Z` }))
  db.first = [[/COUNT\(\*\)/, { total: 7 }]]
  const body = await (await request('/c?limit=2')).json()
  assert.deepEqual(body.data.conversations.map((c) => c.id), [3, 2])
  assert.equal(body.data.nextCursor, '2026-11-02T00:00:00.000Z|2')
  assert.equal(body.data.unreadTotal, 7)
  assert.deepEqual(lastSelect().args, [3])
  assert.match(lastSelect().sql, /ORDER BY conv\.last_message_at DESC, conv\.id DESC/)
})

test('the last page has no cursor, and later pages do not recount unread chats', async () => {
  rows = [{ id: 1, last_message_at: '2026-11-01T00:00:00.000Z' }]
  const body = await (await request(`/c?limit=30&cursor=${encodeURIComponent('2026-11-02T00:00:00.000Z|9')}`)).json()
  assert.equal(body.data.nextCursor, null)
  assert.equal('unreadTotal' in body.data, false)
  assert.equal(queries.some((q) => /COUNT\(\*\)/.test(q.sql)), false)
  assert.deepEqual(lastSelect().args, ['2026-11-02T00:00:00.000Z', 9, 31])
})

test('bad page sizes and cursors are refused before any query', async () => {
  for (const limit of ['0', '-1', '101', '1.5', 'abc', '']) {
    assert.equal((await request(`/c?limit=${limit}`)).status, 400, `limit=${limit}`)
  }
  for (const cursor of ['', 'x', '2026-11-01', "2026-11-01T00:00:00Z|1' OR 1=1", '2026-11-01T00:00:00Z|abc']) {
    assert.equal((await request(`/c?limit=5&cursor=${encodeURIComponent(cursor)}`)).status, 400, `cursor=${cursor}`)
  }
  assert.equal(queries.length, 0)
})

test('search is bound as a value, with % and _ meaning themselves', async () => {
  await request(`/c?limit=5&q=${encodeURIComponent("50%_o'x")}`)
  const q = lastSelect()
  assert.equal(q.args[0], "%50\\%\\_o'x%")
  assert.equal(q.sql.includes("o'x"), false)
  assert.match(q.sql, /conv\.phone LIKE \?2/, 'digits in the term also search phone numbers')
  assert.equal(q.args[1], '%50%')
})

test('search with no digits leaves the phone column out, and unread narrows the page', async () => {
  await request('/c?limit=5&q=riya&unread=1')
  const q = lastSelect()
  assert.equal(/conv\.phone LIKE/.test(q.sql), false)
  assert.match(q.sql, /conv\.unread_count > 0/)
})

test('the list needs inbox.view', async () => {
  const res = await request('/c?limit=5', { user: { id: 'x', permissions: { 'campaigns.send': 'all' } } })
  assert.equal(res.status, 403)
  assert.equal(queries.length, 0)
})

// ── Thread and contacts pages ──────────────────────────────────────────────

test('a thread page can be smaller, never larger, than the browser page', async () => {
  rows = [{ id: 1, created_at: 'a' }]
  await request('/c/7/messages?limit=50')
  assert.deepEqual(queries.at(-1).args, [7, SENDER.id, 51])
  for (const limit of ['0', '501', 'x', '1.5']) {
    assert.equal((await request(`/c/7/messages?limit=${limit}`)).status, 400, `limit=${limit}`)
  }
})

test('contacts: the campaign call is unchanged, a page says what matches and how to go on', async () => {
  rows = [{ id: 2, created_at: '2026-11-02 00:00:00' }, { id: 1, created_at: '2026-11-01 00:00:00' }]
  let body = await (await request('/contacts?search=a')).json()
  assert.deepEqual(Object.keys(body.data), ['contacts'])
  assert.match(queries.at(-1).sql, /LIMIT 2000/)

  queries = []
  db.first = [[/COUNT\(\*\)/, { total: 12 }]]
  body = await (await request('/contacts?limit=1')).json()
  assert.equal(body.data.total, 12)
  assert.equal(body.data.contacts.length, 1)
  assert.equal(body.data.nextCursor, '2026-11-02 00:00:00|2')
  assert.match(queries.at(-1).sql, /LIMIT 2/)

  queries = []
  body = await (await request(`/contacts?limit=1&search=a&cursor=${encodeURIComponent('2026-11-02 00:00:00|2')}`)).json()
  assert.equal('total' in body.data, false)
  assert.deepEqual(queries.at(-1).args, ['%a%', '2026-11-02 00:00:00', 2])
  assert.equal((await request('/contacts?limit=1&cursor=nonsense')).status, 400)
})

test('contacts: a negative or fractional page size still has a row cap', async () => {
  for (const [limit, sent] of [['-5', 'LIMIT 2'], ['2.5', 'LIMIT 3'], ['99999', 'LIMIT 5001']]) {
    queries = []
    rows = []
    await request(`/contacts?limit=${limit}`)
    assert.ok(queries.some((q) => q.sql.includes(sent)), `${limit}: ${queries.map((q) => q.sql.match(/LIMIT \S+/)?.[0])}`)
  }
})

// ── A template to a phone number ───────────────────────────────────────────

const SEND = { phone: '98000 00001', name: 'welcome', language: 'en', values: { 1: 'Asha' } }
function allowSend(existing = null) {
  const conv = existing ?? { id: 5, phone: '919800000001', contact_id: null }
  let created = Boolean(existing)
  db.first = [
    [/FROM contacts WHERE phone/, null],
    [/direct_template_budget/, { sent: 1 }],
    [/SELECT 1 FROM messages/, null],
    [/SELECT \* FROM messages WHERE meta_message_id/, { id: 77, type: 'template' }],
    [/SELECT \* FROM conversations WHERE (phone|id)/, () => (created ? conv : null)],
  ]
  db.run = [[/INSERT INTO conversations/, () => { created = true }]]
}
const ran = (pattern) => queries.some((q) => pattern.test(q.sql))

test('sends, normalising the number here, and creates the chat only afterwards', async () => {
  allowSend()
  const res = await post('/c/template', SEND)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.data.conversationId, 5)
  assert.equal(sends[0].to, '919800000001')
  const insert = queries.find((q) => /INSERT INTO conversations/.test(q.sql))
  assert.equal(insert.args[1], '919800000001')
  assert.ok(queries.indexOf(insert) > queries.findIndex((q) => /direct_template_budget/.test(q.sql)))
  assert.ok(ran(/INSERT INTO messages/))
})

test('needs campaigns.send, and an unusable number or choice is refused before anything else', async () => {
  allowSend()
  assert.equal((await post('/c/template', SEND, { user: VIEWER })).status, 403)
  assert.equal(queries.length, 0)
  for (const phone of ['12', 'abc', '', 12345678901, null]) {
    const res = await post('/c/template', { ...SEND, phone })
    assert.equal(res.status, 400, `phone=${phone}`)
    assert.equal((await res.json()).error.code, 'INVALID_PHONE')
  }
  for (const bad of [{ name: 'Bad Name' }, { name: '' }, { language: '!' }]) {
    assert.equal((await post('/c/template', { ...SEND, ...bad })).status, 400)
  }
  assert.equal(sends.length, 0)
  assert.equal(queries.length, 0)
})

test('someone who opted out is refused, with nothing spent', async () => {
  allowSend()
  db.first[0] = [/FROM contacts WHERE phone/, { id: 3, opted_out: 1 }]
  const res = await post('/c/template', SEND)
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error.code, 'OPTED_OUT')
  assert.equal(sends.length, 0)
  assert.equal(ran(/direct_template_budget/), false)
})

test('a blocked number and a repeat within two minutes are refused, with nothing spent', async () => {
  allowSend({ id: 5, phone: '919800000001', blocked_at: '2026-11-01T00:00:00Z' })
  assert.equal((await (await post('/c/template', SEND)).json()).error.code, 'BLOCKED')

  allowSend({ id: 5, phone: '919800000001' })
  db.first[2] = [/SELECT 1 FROM messages/, { 1: 1 }]
  assert.equal((await (await post('/c/template', SEND)).json()).error.code, 'DUPLICATE')
  assert.equal(sends.length, 0)
  assert.equal(ran(/direct_template_budget/), false)
})

test('at the ceiling nothing is sent, and no chat appears', async () => {
  allowSend()
  db.first[1] = [/direct_template_budget/, null]
  const res = await post('/c/template', SEND)
  assert.equal(res.status, 429)
  assert.equal((await res.json()).error.code, 'DAILY_LIMIT')
  assert.equal(sends.length, 0)
  assert.equal(ran(/INSERT INTO conversations/), false)
  assert.deepEqual(queries.find((q) => /direct_template_budget/.test(q.sql)).args.slice(1), [200])
})

test('a missing or invalid ceiling refuses the send, and so does a failing counter', async () => {
  allowSend()
  for (const cap of [undefined, '', 'abc', '0', '-5']) {
    const res = await post('/c/template', SEND, { env: { WHATSAPP_DIRECT_TEMPLATE_DAILY_CAP: cap } })
    assert.equal(res.status, 503, `cap=${cap}`)
  }
  allowSend()
  db.first[1] = [/direct_template_budget/, () => { throw new Error('no such table') }]
  assert.equal((await post('/c/template', SEND)).status, 503)
  assert.equal(sends.length, 0)
})

test('a template WhatsApp has not approved, or with an empty variable, goes nowhere', async () => {
  allowSend()
  assert.equal((await (await post('/c/template', { ...SEND, name: 'other' })).json()).error.code, 'TEMPLATE_NOT_FOUND')
  assert.equal((await (await post('/c/template', { ...SEND, values: {} })).json()).error.code, 'INVALID')
  assert.equal(sends.length, 0)
  assert.equal(ran(/direct_template_budget/), false)
})

test('when Meta refuses, the chat is not created', async (t) => {
  allowSend()
  t.mock.method(globalThis, 'fetch', async (url) => (String(url).includes('message_templates')
    ? Response.json({ data: graphTemplates })
    : Response.json({ error: { code: 131000, message: 'refused' } }, { status: 400 })))
  const res = await post('/c/template', SEND)
  assert.equal(res.status, 502)
  assert.equal(ran(/INSERT INTO conversations/), false)
})

test('the existing send to a chat still works through the shared steps', async () => {
  allowSend({ id: 5, phone: '919800000001' })
  db.first.push([/SELECT \* FROM conversations WHERE id/, { id: 5, phone: '919800000001' }])
  const res = await post('/c/5/template', { name: 'welcome', language: 'en', values: { 1: 'Asha' } })
  assert.equal(res.status, 200)
  assert.equal(sends[0].to, '919800000001')
  assert.equal(ran(/direct_template_budget/), false, 'the chat route does not use the phone ceiling')
})
