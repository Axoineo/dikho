import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { requireAuth, requirePermission } from '../src/api/middleware/requireAuth.js'

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

test('a database without this version\'s update, or one that is down, is a 503, never a sign-out', async (t) => {
  const next = t.mock.fn()
  for (const status of [404, 500, 502, 503]) {
    fetch.mock.mockImplementation(async () => Response.json({ code: 'PGRST202' }, { status }))
    await assert.rejects(requireAuth(context('Bearer synthetic-session'), next), { status: 503 })
  }
  assert.equal(next.mock.callCount(), 0)
})

const ACTIVE = {
  status: 'active', user_id: 'synthetic-user', session_id: 'synthetic-session-id',
  email: 'operator@example.invalid', phone: null, full_name: 'Synthetic Operator',
  system_role: 'staff', developer_level: null, theme: 'system',
  permissions: { 'clients.view': 'all', 'sales_orders.view': 'own' },
}

test('a verified session is checked with ONE call to my_access using the caller\'s own token', async (t) => {
  fetch.mock.mockImplementation(async (url, options) => {
    assert.equal(url, 'https://auth.example.invalid/rest/v1/rpc/my_access')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, 'Bearer synthetic-session')
    assert.equal(options.headers.apikey, 'synthetic-public-key')
    assert.ok(options.signal instanceof AbortSignal)
    return Response.json({ ...ACTIVE, extra: 'discarded' })
  })
  const c = context('Bearer synthetic-session')
  let handlerFinished = false
  const next = t.mock.fn(async () => {
    await Promise.resolve()
    handlerFinished = true
  })
  await requireAuth(c, next)
  assert.deepEqual(c.state.get('user'), {
    id: 'synthetic-user', email: 'operator@example.invalid', sessionId: 'synthetic-session-id',
    systemRole: 'staff', developerLevel: null,
    permissions: { 'clients.view': 'all', 'sales_orders.view': 'own' },
  })
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(next.mock.callCount(), 1)
  assert.equal(handlerFinished, true)
})

test('an ended session is a 401, so the dashboard signs out', async (t) => {
  const next = t.mock.fn()
  for (const status of ['session_ended', 'signed_out']) {
    fetch.mock.mockImplementation(async () => Response.json({ status }))
    await assert.rejects(requireAuth(context('Bearer synthetic-session'), next), { status: 401 })
  }
  assert.equal(next.mock.callCount(), 0)
})

test('a valid session that is not active staff is forbidden, whatever else it carries', async (t) => {
  const next = t.mock.fn()
  for (const access of [
    { status: 'not_staff' },
    { ...ACTIVE, status: 'suspended' },
    { ...ACTIVE, status: 'archived' },
    { ...ACTIVE, status: 'invited' },
    { ...ACTIVE, user_id: 42 },
    { status: 'active' },
  ]) {
    fetch.mock.mockImplementation(async () => Response.json(access))
    const c = context('Bearer synthetic-session')
    await assert.rejects(requireAuth(c, next), { status: 403 })
    assert.equal(c.state.has('user'), false)
  }
  assert.equal(next.mock.callCount(), 0)
})

test('an unreachable or malformed auth response fails closed', async (t) => {
  const next = t.mock.fn()
  fetch.mock.mockImplementation(async () => { throw new Error('synthetic network failure') })
  await assert.rejects(requireAuth(context('Bearer synthetic-session'), next), { status: 503 })
  for (const body of ['not json', 'null', '[]', '"active"']) {
    fetch.mock.mockImplementation(async () => new Response(body, { status: 200 }))
    await assert.rejects(requireAuth(context('Bearer synthetic-session'), next), (err) => [401, 403].includes(err.status))
  }
  assert.equal(next.mock.callCount(), 0)
})

test('requirePermission passes on any listed permission and refuses otherwise', async (t) => {
  t.mock.method(console, 'log', () => {})
  const guard = requirePermission('campaigns.view', 'campaigns.send')
  const withUser = (permissions) => ({
    get: () => ({ id: 'u', permissions }),
    req: { url: 'https://api.example.invalid/api/campaigns' },
  })
  const next = t.mock.fn(async () => {})
  await guard(withUser({ 'campaigns.send': 'all' }), next)
  assert.equal(next.mock.callCount(), 1)
  for (const permissions of [{}, { 'campaigns.view': 'none' }, { 'clients.view': 'all' }, null]) {
    await assert.rejects(guard(withUser(permissions), next), { status: 403 })
  }
  await assert.rejects(guard({ get: () => undefined, req: { url: 'https://x.invalid/' } }, next), { status: 403 })
  assert.equal(next.mock.callCount(), 1)
})
