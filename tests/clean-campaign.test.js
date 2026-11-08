import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import campaigns from '../src/api/routes/campaigns/index.js'
import contacts from '../src/api/routes/contacts/index.js'
import webhook from '../src/api/routes/whatsapp/webhook.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'

// A clean campaign: imports that write only what changed, a header file sent to
// Meta once, a send that stops itself on Meta's spam and account errors, and
// people who tap "Stop promotions" opted out. A fake D1 answers by the SQL it
// sees; Meta is a fake fetch. Synthetic data only.

const SENDER = { id: 'u-sender', permissions: { 'campaigns.send': 'all', 'wa_contacts.import': 'all' } }
const VIEWER = { id: 'u-viewer', permissions: { 'campaigns.view': 'all' } }

let queries
let db
let meta

function fakeDb() {
  const answer = (sql, args) => {
    queries.push({ sql, args })
    const pick = (list) => {
      const hit = list.find(([match]) => match.test(sql))?.[1]
      return typeof hit === 'function' ? hit(args, sql) : hit
    }
    return {
      first: async () => pick(db.first) ?? null,
      all: async () => ({ results: pick(db.all) ?? [] }),
      run: async () => ({ meta: { changes: 1 } }),
    }
  }
  return {
    prepare: (sql) => ({ bind: (...args) => answer(sql, args), first: () => answer(sql, []).first(), all: () => answer(sql, []).all(), run: () => answer(sql, []).run() }),
    batch: async (statements) => Promise.all(statements.map(async (s) => {
      const out = await s.all()
      return { ...out, meta: { changes: db.batchChanges ? db.batchChanges() : 1 } }
    })),
  }
}

function app(user = SENDER) {
  const root = new Hono()
  root.onError(errorHandler)
  root.use('*', async (c, next) => { c.set('user', user); await next() })
  root.route('/campaigns', campaigns)
  root.route('/contacts', contacts)
  root.route('/webhook', webhook)
  return root
}

const ENV = { WHATSAPP_ACCESS_TOKEN: 'synthetic', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_APP_SECRET: 'synthetic-app-secret' }
const CTX = { waitUntil() {}, passThroughOnException() {} }
const post = (path, body, user) => app(user).request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}, { ...ENV, DB: fakeDb() }, CTX)

beforeEach((t) => {
  queries = []
  db = { first: [], all: [] }
  meta = { sends: [], uploads: [], reply: () => Response.json({ messages: [{ id: `wamid.${meta.sends.length}` }] }) }
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url).endsWith('/media')) {
      meta.uploads.push(init.body)
      return Response.json({ id: '778899' })
    }
    meta.sends.push(JSON.parse(init.body ?? '{}'))
    return meta.reply(meta.sends.length)
  })
})

// ── Importing checked rows ─────────────────────────────────────────────────

test('import-rows saves valid rows, counts bad ones, and returns the file\'s contacts minus opt-outs', async () => {
  let count = 10
  db.first = [[/COUNT\(\*\)/, () => ({ n: count++ === 10 ? 10 : 12 })]]
  db.all = [[/WHERE phone IN/, (args) => args.map((phone, i) => ({ id: i + 1, phone, name: 'N', attributes: '{"City":"Pune"}', opted_out: phone.endsWith('3') ? 1 : 0 }))]]
  const res = await post('/contacts/import-rows', { contacts: [
    { phone: '919876543210', name: '  Rahul   Sharma ', email: 'RAHUL@EXAMPLE.COM', attributes: { City: 'Pune' } },
    { phone: '919123456783', name: 'Opted Out' },
    { phone: '919988776655', name: 'Neha', company: 'Fig Foods' },
    { phone: '919988776655', name: 'Neha again' },
    { phone: '+919000000000', name: 'has a plus' },
    { phone: '12', name: 'too short' },
    { phone: '919811111111', attributes: ['not', 'an', 'object'] },
    { phone: '919822222222', name: { nested: true } },
  ] })
  assert.equal(res.status, 200)
  const { data } = await res.json()
  assert.equal(data.received, 8)
  assert.equal(data.invalid, 4)
  assert.equal(data.duplicates, 1)
  assert.equal(data.imported, 2)
  assert.equal(data.optedOut, 1)
  assert.deepEqual(data.contacts.map((c) => c.phone).sort(), ['919876543210', '919988776655'])
  assert.deepEqual(data.contacts[0].attributes, { City: 'Pune' }, 'attributes come back parsed')

  const upserts = queries.filter((q) => /INSERT INTO contacts/.test(q.sql))
  assert.equal(upserts.length, 3)
  assert.match(upserts[0].sql, /DO UPDATE SET[\s\S]+WHERE[\s\S]+IS NOT contacts\.attributes/, 'an unchanged row is not rewritten')
  assert.deepEqual(upserts[0].args, ['Rahul Sharma', '919876543210', 'rahul@example.com', null, '{"City":"Pune"}'])
})

test('import-rows refuses an empty, oversized or malformed body, and needs the import permission', async () => {
  for (const body of [{}, { contacts: [] }, { contacts: 'x' }, { contacts: Array.from({ length: 5001 }, () => ({ phone: '919876543210' })) }]) {
    assert.equal((await post('/contacts/import-rows', body)).status, 400)
  }
  assert.equal((await post('/contacts/import-rows', { contacts: [{ phone: 'abc' }] })).status, 400)
  assert.equal((await post('/contacts/import-rows', { contacts: [{ phone: '919876543210' }] }, VIEWER)).status, 403)
  assert.ok(!queries.some((q) => /INSERT/.test(q.sql)))
})

// ── The header file goes to Meta once ──────────────────────────────────────

const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])
function upload(format, bytes, type, user = SENDER) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), 'launch.mp4')
  return app(user).request(`/campaigns/header-media?format=${format}`, { method: 'POST', body: form }, { ...ENV, DB: fakeDb() }, CTX)
}

test('an MP4 is uploaded to Meta and its media ID comes back', async () => {
  const res = await upload('VIDEO', MP4, 'video/mp4')
  assert.equal(res.status, 200)
  assert.deepEqual((await res.json()).data, { mediaId: '778899', size: MP4.byteLength })
  assert.equal(meta.uploads.length, 1)
})

test('wrong types, fake videos, unknown formats and viewers are refused before Meta is called', async () => {
  assert.equal((await upload('VIDEO', MP4, 'image/png')).status, 415)
  assert.equal((await upload('VIDEO', new TextEncoder().encode('not a video at all'), 'video/mp4')).status, 415)
  assert.equal((await upload('AUDIO', MP4, 'video/mp4')).status, 400)
  assert.equal((await upload('VIDEO', MP4, 'video/mp4', VIEWER)).status, 403)
  assert.equal((await upload('IMAGE', MP4, 'image/jpeg')).status, 415, 'an image must really be a JPEG')
  assert.equal(meta.uploads.length, 0)
})

// ── A send that stops itself ───────────────────────────────────────────────

const PEOPLE = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, phone: `9198000000${String(i).padStart(2, '0')}`, name: `P${i}` }))
const SEND = { name: 'Launch', contactIds: PEOPLE.map((p) => p.id), templateName: 'launch', templateLanguage: 'en', templateBody: 'Hi', requestId: 'aaaaaaaa-1111-4111-8111-111111111111' }

function campaignDb() {
  db.first = [
    [/INSERT INTO campaigns/, { id: 7 }],
    [/SUM\(CASE/, { sent: 0, failed: 0 }],
    [/SELECT template_name, template_language FROM campaigns/, { template_name: 'launch', template_language: 'en' }],
  ]
  db.all = [
    [/FROM contacts/, PEOPLE],
    [/RETURNING contact_id/, (args) => [{ contact_id: args[1] }]],
  ]
}
const metaError = (code, message) => Response.json({ error: { code, message } }, { status: 400 })

test('a spam-limit error from Meta stops the send; the rest are not sent and the loop is told to stop', async () => {
  campaignDb()
  meta.reply = () => metaError(131048, 'Spam rate limit hit')
  const res = await post('/campaigns/send', SEND)
  assert.equal(res.status, 200)
  const { data } = await res.json()

  assert.ok(meta.sends.length < PEOPLE.length, `only the in-flight sends went out (${meta.sends.length})`)
  assert.equal(data.halted.code, '131048')
  assert.equal(data.halted.resumable, false)
  assert.match(data.halted.reason, /spam/)
  assert.equal(data.remaining, undefined, 'no `remaining`, so every client loop ends')
  assert.equal(data.notSent.length, PEOPLE.length - meta.sends.length)

  const released = queries.filter((q) => /DELETE FROM messages/.test(q.sql))
  assert.equal(released.length, data.notSent.length, 'unattempted claims go back to never-attempted')
  assert.ok(queries.some((q) => /UPDATE campaigns SET status = 'stopped'/.test(q.sql)))
})

test('a spam error Meta reported by webhook stops the next batch before anything is sent', async () => {
  campaignDb()
  db.first.unshift([/error_code IN/, (args) => {
    assert.ok(args.includes('131048') && args.includes('132015'))
    return { error_code: '131048' }
  }])
  const res = await post('/campaigns/send-batch', { campaignId: 7, contactIds: [1, 2, 3], templateBody: 'Hi' })
  const { data } = await res.json()
  assert.equal(meta.sends.length, 0)
  assert.equal(data.halted.code, '131048')
  assert.deepEqual(data.notSent, [1, 2, 3])
  assert.equal(data.remaining, undefined)
  assert.ok(!queries.some((q) => /RETURNING contact_id/.test(q.sql)), 'nobody was claimed')
})

test('a batch where most messages fail for an unlisted reason stops too, and may be resumed', async () => {
  campaignDb()
  meta.reply = () => metaError(131026, 'Message undeliverable')
  const { data } = await (await post('/campaigns/send', SEND)).json()
  assert.equal(meta.sends.length, PEOPLE.length, 'per-person failures do not stop mid-batch')
  assert.equal(data.halted.code, 'mostly_failed')
  assert.equal(data.halted.resumable, true)
  assert.equal(data.notSent.length, 0)
})

test('a normal batch with a few per-person failures carries on', async () => {
  campaignDb()
  meta.reply = (n) => (n % 6 === 0 ? metaError(131026, 'Message undeliverable') : Response.json({ messages: [{ id: `wamid.${n}` }] }))
  const { data } = await (await post('/campaigns/send', SEND)).json()
  assert.equal(data.halted, undefined)
  assert.equal(data.sent + data.failed, PEOPLE.length)
  assert.ok(!queries.some((q) => /status = 'stopped'/.test(q.sql)))
})

// ── "Stop promotions" opts the person out ──────────────────────────────────

function signedWebhook(payload) {
  const raw = JSON.stringify(payload)
  const signature = `sha256=${createHmac('sha256', ENV.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`
  return app().request('/webhook', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body: raw }, { ...ENV, DB: fakeDb() }, CTX)
}
const failedReceipt = (code) => ({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'failed', timestamp: '1700000000', errors: [{ code, title: 'x' }] }] } }] }] })

test('a 131050 receipt opts the contact out; other failures do not', async () => {
  db.first = [[/INSERT INTO webhook_events/, { id: 1 }]]
  assert.equal((await signedWebhook(failedReceipt(131050))).status, 200)
  const optOut = queries.find((q) => /UPDATE contacts SET opted_out = 1/.test(q.sql))
  assert.ok(optOut)
  assert.deepEqual(optOut.args, ['wamid.X'])

  queries = []
  await signedWebhook(failedReceipt(131049))
  assert.ok(!queries.some((q) => /opted_out = 1/.test(q.sql)))
})
