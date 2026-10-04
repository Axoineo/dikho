import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { verifyTurnstile } from '../src/api/services/turnstile.js'

beforeEach((t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network request in isolated Turnstile test')
  })
  t.mock.method(console, 'log', () => {})
})

function context(env = {
  TURNSTILE_SECRET: 'synthetic-verification-secret',
  TURNSTILE_HOSTNAMES: ' forms.example.invalid, intake.example.invalid ',
}, ip = '192.0.2.10') {
  return { env, req: { header: (name) => name === 'CF-Connecting-IP' ? ip : undefined } }
}

const accepted = { success: true, action: 'vendor-registration', hostname: 'forms.example.invalid' }

test('missing secret or hostname allowlist fails closed without a request', async () => {
  for (const env of [{}, { TURNSTILE_SECRET: 'synthetic' }, {
    TURNSTILE_SECRET: 'synthetic', TURNSTILE_HOSTNAMES: ' , ',
  }, { TURNSTILE_HOSTNAMES: 'forms.example.invalid' }]) {
    await assert.rejects(verifyTurnstile(context(env), 'synthetic-token', accepted.action), { status: 500 })
  }
  assert.equal(fetch.mock.callCount(), 0)
})

test('empty, non-string and oversized tokens are rejected before verification', async () => {
  for (const token of [undefined, null, '', 1, {}, 'x'.repeat(2049)]) {
    await assert.rejects(verifyTurnstile(context(), token, accepted.action), { status: 403 })
  }
  assert.equal(fetch.mock.callCount(), 0)
})

test('a matching hostname and action passes server-side verification', async () => {
  fetch.mock.mockImplementation(async (url, options) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
    assert.equal(options.method, 'POST')
    assert.equal(options.body.get('secret'), 'synthetic-verification-secret')
    assert.equal(options.body.get('response'), 'synthetic-token')
    assert.equal(options.body.get('remoteip'), '192.0.2.10')
    assert.ok(options.signal instanceof AbortSignal)
    return Response.json(accepted)
  })
  await verifyTurnstile(context(), 'synthetic-token', accepted.action)
  assert.equal(fetch.mock.callCount(), 1)
})

test('a maximum-length token and another allowed hostname can pass without a client IP', async () => {
  fetch.mock.mockImplementation(async (_url, options) => {
    assert.equal(options.body.get('response').length, 2048)
    assert.equal(options.body.has('remoteip'), false)
    return Response.json({ ...accepted, hostname: 'intake.example.invalid' })
  })
  await verifyTurnstile(context(undefined, ''), 'x'.repeat(2048), accepted.action)
})

test('wrong hostname, wrong action, false success and duplicate tokens are denied', async () => {
  for (const result of [
    { ...accepted, hostname: 'attacker.example.invalid' },
    { ...accepted, action: 'another-form' },
    { ...accepted, success: 'true' },
    { ...accepted, success: false },
    {},
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
  ]) {
    fetch.mock.mockImplementation(async () => Response.json(result))
    await assert.rejects(verifyTurnstile(context(), 'synthetic-token', accepted.action), { status: 403 })
  }
})

test('upstream client failures surface as configuration errors and server failures as retryable', async () => {
  for (const [upstreamStatus, expectedStatus] of [[400, 500], [403, 500], [500, 503], [503, 503]]) {
    fetch.mock.mockImplementation(async () => new Response('synthetic upstream failure', { status: upstreamStatus }))
    await assert.rejects(verifyTurnstile(context(), 'synthetic-token', accepted.action), { status: expectedStatus })
  }
})

test('unparseable provider JSON fails closed with a retryable error', async () => {
  fetch.mock.mockImplementation(async () => new Response('not JSON'))
  await assert.rejects(verifyTurnstile(context(), 'synthetic-token', accepted.action), { status: 503 })
})

test('network and timeout failures fail closed without waiting for a real timeout', async () => {
  for (const error of [new TypeError('Synthetic network failure'), new DOMException('Synthetic timeout', 'TimeoutError')]) {
    fetch.mock.mockImplementation(async () => { throw error })
    await assert.rejects(verifyTurnstile(context(), 'synthetic-token', accepted.action), { status: 503 })
  }
})
