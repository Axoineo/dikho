import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { requireAuth } from '../src/api/middleware/requireAuth.js'

beforeEach((t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network request in isolated auth test')
  })
})

function context(header, env = {
  SUPABASE_URL: 'https://auth.example.invalid',
  SUPABASE_ANON_KEY: 'synthetic-public-key',
}) {
  const state = new Map()
  return {
    env,
    req: { header: (name) => name === 'Authorization' ? header : undefined },
    set: (key, value) => state.set(key, value),
    state,
  }
}

test('missing or malformed bearer credentials cannot reach the protected handler', async (t) => {
  const next = t.mock.fn()
  for (const header of [undefined, '', 'Basic synthetic', 'Bearer ', 'bearer synthetic']) {
    await assert.rejects(requireAuth(context(header), next), { status: 401 })
  }
  assert.equal(fetch.mock.callCount(), 0)
  assert.equal(next.mock.callCount(), 0)
})

test('missing server auth configuration fails before any external request', async (t) => {
  const next = t.mock.fn()
  for (const env of [{}, { SUPABASE_URL: 'https://auth.example.invalid' }]) {
    await assert.rejects(requireAuth(context('Bearer synthetic-session', env), next), { status: 500 })
  }
  assert.equal(fetch.mock.callCount(), 0)
  assert.equal(next.mock.callCount(), 0)
})

test('invalid or expired upstream sessions cannot reach the protected handler', async (t) => {
  const next = t.mock.fn()
  for (const status of [401, 403]) {
    fetch.mock.mockImplementation(async () => new Response('{}', { status }))
    const c = context('Bearer synthetic-session')
    await assert.rejects(requireAuth(c, next), { status: 401 })
    assert.equal(c.state.has('user'), false)
  }
  assert.equal(next.mock.callCount(), 0)
})

test('a verified session sets only identity fields and awaits the protected handler', async (t) => {
  fetch.mock.mockImplementation(async (url, options) => {
    assert.equal(url, 'https://auth.example.invalid/auth/v1/user')
    assert.equal(options.headers.Authorization, 'Bearer synthetic-session')
    assert.equal(options.headers.apikey, 'synthetic-public-key')
    return Response.json({ id: 'synthetic-user', email: 'operator@example.invalid', extra: 'discarded' })
  })
  const c = context('Bearer synthetic-session')
  let handlerFinished = false
  const next = t.mock.fn(async () => {
    await Promise.resolve()
    handlerFinished = true
  })
  await requireAuth(c, next)
  assert.deepEqual(c.state.get('user'), { id: 'synthetic-user', email: 'operator@example.invalid' })
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(next.mock.callCount(), 1)
  assert.equal(handlerFinished, true)
})
