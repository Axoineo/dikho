import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import conversations from '../src/api/routes/whatsapp/conversations.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'
import {
  EMPTY_THREAD, foldReactions, mergeNewestPage, prependOlderPage, threadFromPage,
} from '../src/features/whatsapp/inbox/messageModel.js'

// The inbox thread a page at a time: the browser's paging helpers, and the
// API route's input checks and page shape against a fake D1. The SQL itself
// is exercised against a real local D1 (see the task brief); here the fake
// only records what the route asked for. Synthetic data only.

const at = (minute) => new Date(Date.UTC(2026, 9, 1, 9, minute)).toISOString()
const row = (id, minute, extra = {}) => ({ id, created_at: at(minute), direction: 'inbound', type: 'text', body: `m${id}`, meta_message_id: `wamid.${id}`, ...extra })
const ids = (thread) => thread.messages.map((m) => m.id)

test('a page from an API without paging has nothing older to ask for', () => {
  assert.deepEqual(threadFromPage({ messages: [row(1, 1), row(2, 2)] }), { messages: [row(1, 1), row(2, 2)], hasMore: false, before: 1 })
  assert.equal(threadFromPage({ messages: [row(1, 1)], hasMore: 'yes' }).hasMore, false)
  assert.deepEqual(threadFromPage({ messages: [], hasMore: false }), EMPTY_THREAD)
})

test('an older page goes in front and moves the cursor', () => {
  const t1 = threadFromPage({ messages: [row(5, 5), row(6, 6)], hasMore: true })
  const t2 = prependOlderPage(t1, { messages: [row(3, 3), row(4, 4)], hasMore: true }, 5)
  assert.deepEqual(ids(t2), [3, 4, 5, 6])
  assert.equal(t2.before, 3)
  assert.equal(t2.hasMore, true)
  const t3 = prependOlderPage(t2, { messages: [row(1, 1)], hasMore: false }, 3)
  assert.deepEqual(ids(t3), [1, 3, 4, 5, 6])
  assert.equal(t3.hasMore, false)
})

test('a late webhook row a broadcast appended is placed by time once its page arrives', () => {
  // id 9 carries WhatsApp's older timestamp, so the server orders it before 5.
  const t0 = threadFromPage({ messages: [row(5, 5), row(6, 6)], hasMore: true })
  const t1 = { ...t0, messages: [...t0.messages, row(9, 4, { status: 'stale' })] }
  const t2 = prependOlderPage(t1, { messages: [row(3, 3), row(9, 4)], hasMore: false }, 5)
  assert.deepEqual(ids(t2), [3, 9, 5, 6])
  assert.equal(t2.messages[1].status, undefined, 'the server copy wins')
})

test('an older page is dropped when the thread moved on while it was in flight', () => {
  const t1 = threadFromPage({ messages: [row(7, 7)], hasMore: true })
  assert.equal(prependOlderPage(t1, { messages: [row(1, 1)], hasMore: false }, 5), t1)
})

test('rows with the same time are ordered by id across a page boundary', () => {
  const t1 = threadFromPage({ messages: [row(4, 2), row(5, 2)], hasMore: true })
  const t2 = prependOlderPage(t1, { messages: [row(2, 2), row(3, 2)], hasMore: false }, 4)
  assert.deepEqual(ids(t2), [2, 3, 4, 5])
})

test('the refresh keeps older pages when the newest page joins onto them', () => {
  let t = threadFromPage({ messages: [row(4, 4), row(5, 5), row(6, 6)], hasMore: true })
  t = prependOlderPage(t, { messages: [row(1, 1), row(2, 2), row(3, 3)], hasMore: false }, 4)
  // Meanwhile 7 arrived, and 6 was deleted by another agent.
  const merged = mergeNewestPage(t, { messages: [row(5, 5), row(7, 7)], hasMore: true })
  assert.deepEqual(ids(merged), [1, 2, 3, 4, 5, 7])
  assert.equal(merged.hasMore, false, 'paging state is untouched')
  assert.equal(merged.before, 1)
})

test('the refresh replaces the thread when the page is all of it, or leaves a gap', () => {
  let t = threadFromPage({ messages: [row(4, 4), row(5, 5)], hasMore: true })
  t = prependOlderPage(t, { messages: [row(1, 1)], hasMore: false }, 4)
  // Cleared in another tab: the whole thread is one short page.
  assert.deepEqual(mergeNewestPage(t, { messages: [row(8, 8)], hasMore: false }), { messages: [row(8, 8)], hasMore: false, before: 8 })
  // More than a page arrived: nothing here joins it, so start over from it.
  const gap = mergeNewestPage(t, { messages: [row(20, 20), row(21, 21)], hasMore: true })
  assert.deepEqual(gap, { messages: [row(20, 20), row(21, 21)], hasMore: true, before: 20 })
})

test('a reaction whose message is on an older page shows nowhere until that page loads', () => {
  const target = row(2, 2)
  const page1 = { messages: [row(10, 10), row(11, 11, { type: 'reaction', body: '👍', context_wamid: 'wamid.2', meta_message_id: 'wamid.r' })], hasMore: true }
  let t = threadFromPage(page1)
  let folded = foldReactions(t.messages)
  assert.deepEqual(folded.shown.map((m) => m.id), [10], 'no stray reaction bubble')
  t = prependOlderPage(t, { messages: [row(1, 1), target, row(3, 3, { type: 'reaction', body: '😮', context_wamid: 'wamid.2', meta_message_id: 'wamid.r0' })], hasMore: false }, 10)
  folded = foldReactions(t.messages)
  assert.deepEqual(folded.shown.map((m) => m.id), [1, 2, 10])
  assert.deepEqual(folded.reactionsFor(target), { customer: '👍' }, 'the newer reaction wins over the older page one')
})

// ── The route ──────────────────────────────────────────────────────────────

const VIEWER = { id: 'u-viewer', permissions: { 'inbox.view': 'all' } }
let queries
let cursorRow
let pageRows
function fakeDb() {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          const q = { sql, args }
          queries.push(q)
          return {
            first: async () => (sql.includes('SELECT id, created_at FROM messages') ? cursorRow : null),
            all: async () => ({ results: pageRows.slice() }),
          }
        },
      }
    },
  }
}
function appFor(user) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => { c.set('user', user); await next() })
  app.route('/c', conversations)
  return app
}
const get = (path, user = VIEWER) => appFor(user).request(path, {}, { DB: fakeDb() })

beforeEach((t) => {
  queries = []
  cursorRow = null
  pageRows = []
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
})

test('reading a thread needs inbox.view, refused before any query', async () => {
  const res = await get('/c/1/messages', { id: 'u-x', permissions: { 'campaigns.send': 'all' } })
  assert.equal(res.status, 403)
  assert.equal(queries.length, 0)
})

test('a malformed cursor is refused before any query', async () => {
  for (const before of ['', 'abc', '0', '-1', '1.5', '1e3', ' 7', '0x10', '9999999999999999']) {
    const res = await get(`/c/1/messages?before=${encodeURIComponent(before)}`)
    assert.equal(res.status, 400, `before=${JSON.stringify(before)}`)
  }
  assert.equal(queries.length, 0)
})

test('a cursor from another chat is refused', async () => {
  const res = await get('/c/1/messages?before=42')
  assert.equal(res.status, 400)
  assert.equal(queries.length, 1)
  assert.deepEqual(queries[0].args, [42, 1], 'looked up within this conversation only')
})

test('the newest page asks for one row past the page and drops it', async () => {
  pageRows = Array.from({ length: 501 }, (_, i) => row(i + 1, i))
  const body = await (await get('/c/7/messages')).json()
  assert.equal(body.data.messages.length, 500)
  assert.equal(body.data.messages[0].id, 2, 'the extra row is the oldest')
  assert.equal(body.data.hasMore, true)
  const [q] = queries
  assert.deepEqual(q.args, [7, 'u-viewer', 501])
  assert.match(q.sql, /ORDER BY m\.created_at DESC, m\.id DESC/)
  assert.doesNotMatch(q.sql, /\?4/)
})

test('an older page binds the cursor row\'s time and id', async () => {
  cursorRow = { id: 600, created_at: at(30) }
  pageRows = [row(1, 1), row(2, 2)]
  const body = await (await get('/c/7/messages?before=600')).json()
  assert.equal(body.data.hasMore, false)
  assert.deepEqual(body.data.messages.map((m) => m.id), [1, 2])
  assert.deepEqual(queries[1].args, [7, 'u-viewer', 501, at(30), 600])
  assert.match(queries[1].sql, /m\.created_at <= \?4 AND \(m\.created_at < \?4 OR m\.id < \?5\)/)
})
