import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import { forgetLiveHolders, holderIsLive, signMediaTicket, verifyMediaTicket } from '../src/api/services/whatsapp/mediaTicket.js'

// Media tickets belong to one person's session and last an hour (pre-launch audit 4.3).
const nowSeconds = 1_800_000_000
// Ephemeral test keys are generated in memory and never printed or persisted.
const secret = randomBytes(32).toString('hex')
const HOLDER = { userId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222' }
const ENV = { SUPABASE_URL: 'https://synthetic.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' }

beforeEach((t) => {
  t.mock.method(Date, 'now', () => nowSeconds * 1000)
  t.mock.method(console, 'error', () => {})
  forgetLiveHolders()
})

test('a ticket names its holder and lasts an hour by default', async () => {
  const ticket = await signMediaTicket(secret, HOLDER)
  assert.equal(Number(ticket.split('.')[0]), nowSeconds + 60 * 60)
  assert.deepEqual(await verifyMediaTicket(secret, ticket), HOLDER)
  Date.now.mock.mockImplementation(() => (nowSeconds + 60 * 60) * 1000 + 1)
  assert.equal(await verifyMediaTicket(secret, ticket), null)
})

test('changing the expiry, the holder, the signature or the key invalidates it', async () => {
  const ticket = await signMediaTicket(secret, HOLDER, 60)
  const [exp, user, session, sig] = ticket.split('.')
  const other = '33333333-3333-4333-8333-333333333333'
  const flipped = (sig[0] === '0' ? '1' : '0') + sig.slice(1)
  for (const forged of [`${Number(exp) + 100}.${user}.${session}.${sig}`, `${exp}.${other}.${session}.${sig}`, `${exp}.${user}.${other}.${sig}`, `${exp}.${user}.${session}.${flipped}`]) {
    assert.equal(await verifyMediaTicket(secret, forged), null, forged.slice(0, 30))
  }
  assert.equal(await verifyMediaTicket(randomBytes(32).toString('hex'), ticket), null)
  assert.equal(await verifyMediaTicket('', ticket), null)
})

test('old six-hour tickets, malformed ones and tickets without a holder are refused', async () => {
  for (const ticket of [undefined, null, '', 'no-separator', `${nowSeconds + 60}.abc`, `${nowSeconds + 60}.${'a'.repeat(64)}`, 'NaN.x.y.z', 'x'.repeat(300)]) {
    assert.equal(await verifyMediaTicket(secret, ticket), null)
  }
  await assert.rejects(signMediaTicket(secret, { userId: HOLDER.userId }))
  await assert.rejects(signMediaTicket(secret, { userId: 'not-a-uuid', sessionId: HOLDER.sessionId }))
  await assert.rejects(signMediaTicket('', HOLDER))
})

function staffAnswer(t, answer) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization })
    return typeof answer === 'function' ? answer() : Response.json(answer)
  })
  return calls
}

test('a live session of active staff may open media, and the answer is reused for a minute', async (t) => {
  const calls = staffAnswer(t, [{ status: 'active', staff_sessions: [{ ended_at: null }] }])
  assert.equal(await holderIsLive(ENV, HOLDER), true)
  assert.equal(await holderIsLive(ENV, HOLDER), true)
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /staff_members\?select=status%2Cstaff_sessions%28ended_at%29&user_id=eq\.11111111/)
  assert.match(calls[0].url, /staff_sessions\.session_id=eq\.22222222/)
  Date.now.mock.mockImplementation(() => nowSeconds * 1000 + 61_000)
  await holderIsLive(ENV, HOLDER)
  assert.equal(calls.length, 2, 'asked again after a minute')
})

test('an ended session, a suspended person, an unknown person or no answer closes the ticket', async (t) => {
  for (const answer of [
    [{ status: 'active', staff_sessions: [{ ended_at: '2026-11-22T10:00:00Z' }] }],
    [{ status: 'suspended', staff_sessions: [] }],
    [],
    () => new Response('nope', { status: 500 }),
    () => { throw new TypeError('network down') },
  ]) {
    forgetLiveHolders()
    staffAnswer(t, answer)
    assert.equal(await holderIsLive(ENV, HOLDER), false)
  }
  assert.equal(await holderIsLive({}, HOLDER), false, 'no service key, no files')
})
