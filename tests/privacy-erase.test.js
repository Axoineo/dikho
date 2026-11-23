import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import contacts from '../src/api/routes/contacts/index.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'
import { erasePerson } from '../src/api/services/privacy/erase.js'

// Erasing one person (pre-launch audit 12.3), against real SQLite with every D1
// migration applied, through a small stand-in for D1. Synthetic people only.

const ERASE = '919800000001'
const KEEP = '919800000002'

function d1(sqlite) {
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
    exec: () => {
      const prepared = sqlite.prepare(sql)
      if (/^\s*SELECT|RETURNING/i.test(sql)) return { results: prepared.all(...args), meta: { changes: 0 } }
      return { results: [], meta: { changes: Number(prepared.run(...args).changes) } }
    },
  })
  return {
    prepare: (sql) => statement(sql),
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

function seeded() {
  const sqlite = new DatabaseSync(':memory:')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) sqlite.exec(readFileSync(new URL(file, dir), 'utf8'))
  for (const [id, phone] of [[1, ERASE], [2, KEEP]]) {
    sqlite.prepare('INSERT INTO contacts (id, name, phone) VALUES (?, ?, ?)').run(id, `Person ${id}`, phone)
    sqlite.prepare('INSERT INTO conversations (id, contact_id, phone) VALUES (?, ?, ?)').run(id, id, phone)
    sqlite.prepare(`INSERT INTO messages (id, conversation_id, contact_id, phone, direction, type, body, media_url)
      VALUES (?, ?, ?, ?, 'inbound', 'image', 'hello', ?)`).run(id * 10, id, id, phone, `/whatsapp/media/day/photo-${id}`)
    sqlite.prepare("INSERT INTO message_stars (message_id, user_id, created_at) VALUES (?, ?, '2026-11-01')").run(id * 10, 'u-1')
    sqlite.prepare("INSERT INTO conversation_events (conversation_id, action, actor, created_at) VALUES (?, 'cleared', 'u-1', '2026-11-01')").run(id)
    sqlite.prepare(`INSERT INTO webhook_events (event_type, idempotency_key, payload, processing_status)
      VALUES ('message', ?, ?, 'processed')`).run(`wamid.${id}`, JSON.stringify({ from: phone, text: 'hello' }))
    sqlite.prepare("INSERT INTO template_send_cooldowns (phone, template_name, last_sent_at) VALUES (?, 'welcome', '2026-11-01')").run(phone)
  }
  sqlite.prepare("INSERT INTO campaigns (id, name, template_name, status, total_count, sent_count) VALUES (5, 'Diwali', 'welcome', 'completed', 2, 2)").run()
  for (const [id, phone] of [[1, ERASE], [2, KEEP]]) {
    sqlite.prepare(`INSERT INTO messages (id, campaign_id, contact_id, phone, status, body)
      VALUES (?, 5, ?, ?, 'sent', 'Happy Diwali')`).run(100 + id, id, phone)
  }
  return sqlite
}

let deletedKeys
let leadRequests
const bucket = { async delete(keys) { deletedKeys.push(...keys) } }

beforeEach((t) => {
  deletedKeys = []
  leadRequests = []
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    leadRequests.push({ url: String(url), method: init?.method })
    return Response.json([{ id: 'lead-1' }])
  })
})

const env = (sqlite) => ({ DB: d1(sqlite), MEDIA: bucket, SUPABASE_URL: 'https://synthetic.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' })
const count = (sqlite, sql, ...args) => sqlite.prepare(sql).get(...args).n

test('everything held for the number goes; the other person is untouched', async () => {
  const sqlite = seeded()
  const counts = await erasePerson(env(sqlite), ERASE)
  assert.deepEqual(counts, { conversations: 1, messagesDeleted: 1, campaignMessagesAnonymised: 1, contactsDeleted: 1, mediaDeleted: 1, leadsDeleted: 1 })

  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM contacts WHERE phone = ?', ERASE), 0)
  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM conversations WHERE phone = ?', ERASE), 0)
  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM messages WHERE phone = ?', ERASE), 0)
  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM message_stars WHERE message_id = 10'), 0)
  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM conversation_events WHERE conversation_id = 1'), 0)
  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM template_send_cooldowns WHERE phone = ?', ERASE), 0)
  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM webhook_events WHERE payload LIKE ?', `%${ERASE}%`), 0)
  assert.equal(count(sqlite, "SELECT COUNT(*) n FROM webhook_events WHERE idempotency_key = 'wamid.1'"), 1, 'kept to recognise a redelivery')
  assert.deepEqual(deletedKeys, ['day/photo-1'])

  // The campaign keeps its count, without the person in it.
  const campaignRow = sqlite.prepare('SELECT phone, contact_id, body FROM messages WHERE id = 101').get()
  assert.deepEqual({ ...campaignRow }, { phone: 'erased', contact_id: null, body: null })
  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM messages WHERE campaign_id = 5'), 2)

  // The other person is exactly as before.
  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM contacts WHERE phone = ?', KEEP), 1)
  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM messages WHERE phone = ?', KEEP), 2)
  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM webhook_events WHERE payload LIKE ?', `%${KEEP}%`), 1)

  // Leads are matched with and without the country code, with the service key.
  assert.equal(leadRequests.length, 1)
  assert.equal(leadRequests[0].method, 'DELETE')
  assert.match(leadRequests[0].url, /cg_leads\?mobile=in\.\(919800000001,9800000001\)$/)
})

test('running it again finds nothing more and changes nothing', async () => {
  const sqlite = seeded()
  await erasePerson(env(sqlite), ERASE)
  deletedKeys = []
  const again = await erasePerson(env(sqlite), ERASE)
  assert.equal(again.messagesDeleted + again.contactsDeleted + again.conversations + again.mediaDeleted, 0)
  assert.equal(count(sqlite, 'SELECT COUNT(*) n FROM messages WHERE phone = ?', KEEP), 2)
})

function erase(body, permissions) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => { c.set('user', { id: 'u-admin', permissions }); await next() })
  app.route('/contacts', contacts)
  return app.request('/contacts/erase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env(seeded()), { waitUntil() {}, passThroughOnException() {} })
}

const BOTH = { 'wa_contacts.delete': 'all', 'inbox.delete': 'all' }

test('the route needs both delete permissions and the number typed twice', async () => {
  assert.equal((await erase({ phone: ERASE, confirm: ERASE }, { 'wa_contacts.delete': 'all' })).status, 403)
  assert.equal((await erase({ phone: ERASE, confirm: ERASE }, { 'inbox.delete': 'all' })).status, 403)
  assert.equal((await erase({ phone: ERASE, confirm: KEEP }, BOTH)).status, 400)
  assert.equal((await erase({ phone: 'abc', confirm: 'abc' }, BOTH)).status, 400)
  const ok = await erase({ phone: '98000 00001', confirm: '+91 98000-00001' }, BOTH)
  assert.equal(ok.status, 200, 'written the way people type it')
  assert.equal((await ok.json()).data.contactsDeleted, 1)
})
