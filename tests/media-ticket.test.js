import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import { signMediaTicket, verifyMediaTicket } from '../src/api/services/whatsapp/mediaTicket.js'

const nowSeconds = 1_800_000_000
// Ephemeral test keys are generated in memory and never printed or persisted.
const secret = randomBytes(32).toString('hex')

beforeEach((t) => {
  t.mock.method(Date, 'now', () => nowSeconds * 1000)
})

test('signed media tickets work until their expiry with the default and custom TTL', async () => {
  for (const ttl of [60, 6 * 60 * 60]) {
    const ticket = ttl === 60 ? await signMediaTicket(secret, ttl) : await signMediaTicket(secret)
    assert.equal(Number(ticket.split('.')[0]), nowSeconds + ttl)
    assert.equal(await verifyMediaTicket(secret, ticket), true)
  }
})

test('expired media tickets fail even when their signature was valid', async () => {
  const ticket = await signMediaTicket(secret, 60)
  Date.now.mock.mockImplementation(() => (nowSeconds + 60) * 1000 + 1)
  assert.equal(await verifyMediaTicket(secret, ticket), false)
})

test('changing the expiry, signature or signing key invalidates a media ticket', async () => {
  const ticket = await signMediaTicket(secret, 60)
  const [expiry, signature] = ticket.split('.')
  const tamperedSignature = (signature[0] === '0' ? '1' : '0') + signature.slice(1)
  assert.equal(await verifyMediaTicket(secret, `${Number(expiry) + 100}.${signature}`), false)
  assert.equal(await verifyMediaTicket(secret, `${expiry}.${tamperedSignature}`), false)
  assert.equal(await verifyMediaTicket(randomBytes(32).toString('hex'), ticket), false)
  assert.equal(await verifyMediaTicket('', ticket), false)
})

test('missing, malformed, nonfinite and unsigned media tickets fail', async () => {
  for (const ticket of [undefined, null, '', 'no-separator', 'NaN.fake', 'Infinity.fake', '.fake', `${nowSeconds + 60}.`, `${nowSeconds + 60}.fake`]) {
    assert.equal(await verifyMediaTicket(secret, ticket), false)
  }
})
