import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import users from '../src/api/routes/users/index.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'

// The User Management routes with requireAuth replaced by a fixed, verified
// actor, and every outbound request answered by a fake. Synthetic data only.
const ACTOR = '11111111-1111-4111-8111-111111111111'
const TARGET = '22222222-2222-4222-8222-222222222222'
const NEW_USER = '33333333-3333-4333-8333-333333333333'

const env = {
  SUPABASE_URL: 'https://db.example.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
}

function appFor(permissions) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user', { id: ACTOR, permissions, sessionId: 'synthetic-session' })
    await next()
  })
  app.route('/users', users)
  return app
}

const ALL = Object.fromEntries([
  'users.view', 'users.create', 'users.edit', 'users.permissions', 'users.suspend', 'users.sessions',
  'templates.manage', 'departments.manage', 'audit_logs.view',
].map((k) => [k, 'all']))

let calls
let rpc
beforeEach((t) => {
  calls = []
  rpc = {}
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null
    calls.push({ url, method: options.method ?? 'GET', body })
    const m = url.match(/\/rest\/v1\/rpc\/(\w+)$/)
    if (m) {
      const handler = rpc[m[1]]
      if (!handler) throw new Error(`unexpected rpc ${m[1]}`)
      return handler(body)
    }
    if (url.endsWith('/auth/v1/admin/users') && options.method === 'POST') return Response.json({ id: NEW_USER })
    if (url.includes('/auth/v1/admin/users/')) return Response.json({})
    if (url.endsWith('/realtime/v1/api/broadcast')) return new Response(null, { status: 202 })
    throw new Error(`unexpected request ${url}`)
  })
})

const json = (body, init = {}) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, ...init })
const ruleError = (status, message) => async () => Response.json({ code: `PT${status}`, message }, { status })

test('route guards refuse before any database call', async () => {
  const app = appFor({ 'users.view': 'all' })
  for (const [path, init] of [
    ['/users', json({ full_name: 'A', email: 'a@example.invalid' })],
    [`/users/${TARGET}/status`, json({ status: 'suspended' })],
    [`/users/${TARGET}/permissions`, { ...json({ overrides: {} }), method: 'PUT' }],
    ['/users/audit', {}],
  ]) {
    const res = await app.request(path, init, env)
    assert.equal(res.status, 403, path)
  }
  assert.equal(calls.length, 0)
})

test('malformed ids and bodies are refused before any network call', async () => {
  const app = appFor(ALL)
  assert.equal((await app.request('/users/not-a-uuid', {}, env)).status, 400)
  assert.equal((await app.request('/users', json({ full_name: 'A' }), env)).status, 400)
  assert.equal((await app.request('/users', json({ full_name: 'A', email: 'nope' }), env)).status, 400)
  assert.equal((await app.request('/users', json({ full_name: 'A', phone: '12' }), env)).status, 400)
  assert.equal((await app.request('/users', json({ full_name: 'x'.repeat(201), email: 'a@example.invalid' }), env)).status, 400)
  assert.equal((await app.request(`/users/${TARGET}/status`, json({ status: 'deleted' }), env)).status, 400)
  assert.equal((await app.request(`/users/${TARGET}/sign-out`, json({ session_id: 'x' }), env)).status, 400)
  assert.equal((await app.request('/users/audit?before=1;drop', {}, env)).status, 400)
  const huge = await app.request('/users', { method: 'POST', body: 'x', headers: { 'Content-Length': String(40 * 1024) } }, env)
  assert.equal(huge.status, 413)
  assert.equal(calls.length, 0)
})

test('adding someone checks first, creates the account, then the staff record', async () => {
  rpc.um_check_create = async () => new Response(null, { status: 204 })
  rpc.um_find_account = async () => Response.json(null)
  rpc.um_create_member = async (b) => Response.json({ user_id: b.p_user, full_name: 'New Person' })
  const res = await appFor(ALL).request('/users', json({
    full_name: 'New Person', email: 'New.Person@Example.invalid', template_id: TARGET, send_welcome: false,
    status: 'active', is_owner: true,
  }), { ...env })
  assert.equal(res.status, 201)
  const order = calls.map((c) => c.url.replace(env.SUPABASE_URL, ''))
  assert.deepEqual(order, [
    '/rest/v1/rpc/um_check_create', '/rest/v1/rpc/um_find_account', '/auth/v1/admin/users', '/rest/v1/rpc/um_create_member',
  ])
  // Only known profile fields reach the database; the email is normalised.
  assert.deepEqual(calls[0].body.p_profile, { full_name: 'New Person', template_id: TARGET })
  assert.equal(calls[1].body.p_email, 'new.person@example.invalid')
  assert.equal(calls[2].body.email_confirm, true)
  assert.equal('password' in calls[2].body, false)
  assert.equal(calls[3].body.p_actor, ACTOR)
})

test('a refused staff record deletes the account that was just created, and the refusal is audited', async () => {
  rpc.um_check_create = async () => new Response(null, { status: 204 })
  rpc.um_find_account = async () => Response.json(null)
  rpc.um_create_member = ruleError(403, 'Only an Owner can make someone an Owner.')
  rpc.um_log_denied = async () => new Response(null, { status: 204 })
  const res = await appFor(ALL).request('/users', json({ full_name: 'X', phone: '9800000001', system_role: 'owner' }), env)
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error.message, 'Only an Owner can make someone an Owner.')
  const del = calls.find((c) => c.method === 'DELETE')
  assert.equal(del.url, `${env.SUPABASE_URL}/auth/v1/admin/users/${NEW_USER}`)
  const denied = calls.find((c) => c.url.endsWith('um_log_denied'))
  assert.equal(denied.body.p_action, 'users.create')
})

test('an existing account without a staff record is reused, never duplicated; a staff one is a conflict', async () => {
  rpc.um_check_create = async () => new Response(null, { status: 204 })
  rpc.um_find_account = async () => Response.json({ user_id: TARGET, is_staff: false })
  rpc.um_create_member = async (b) => Response.json({ user_id: b.p_user })
  const reused = await appFor(ALL).request('/users', json({ full_name: 'Y', email: 'y@example.invalid', send_welcome: false }), env)
  assert.equal(reused.status, 201)
  assert.equal((await reused.json()).data.reused_account, true)
  assert.equal(calls.some((c) => c.url.includes('/auth/v1/admin/users')), false)

  calls.length = 0
  rpc.um_find_account = async () => Response.json({ user_id: TARGET, is_staff: true })
  const conflict = await appFor(ALL).request('/users', json({ full_name: 'Y', email: 'y@example.invalid' }), env)
  assert.equal(conflict.status, 409)
  assert.equal(calls.some((c) => c.url.includes('/auth/v1/admin/users') || c.url.endsWith('um_create_member')), false)
})

test('suspending ends access in the database, blocks sign-in, then tells the open dashboard', async () => {
  rpc.um_set_status = async () => Response.json({ user_id: TARGET, status: 'suspended' })
  const res = await appFor(ALL).request(`/users/${TARGET}/status`, json({ status: 'suspended', reason: 'Left' }), env)
  assert.equal(res.status, 200)
  const order = calls.map((c) => `${c.method} ${c.url.replace(env.SUPABASE_URL, '')}`)
  assert.deepEqual(order, [
    'POST /rest/v1/rpc/um_set_status',
    `PUT /auth/v1/admin/users/${TARGET}`,
    'POST /realtime/v1/api/broadcast',
  ])
  assert.equal(calls[1].body.ban_duration, '876000h')
  assert.deepEqual(calls[2].body.messages[0].topic, `staff:${TARGET}`)
  assert.equal(calls[2].body.messages[0].private, true)
})

test('reactivating lifts the sign-in block and sends no sign-out notice', async () => {
  rpc.um_set_status = async () => Response.json({ user_id: TARGET, status: 'active' })
  const res = await appFor(ALL).request(`/users/${TARGET}/status`, json({ status: 'active' }), env)
  assert.equal(res.status, 200)
  assert.equal(calls[1].body.ban_duration, 'none')
  assert.equal(calls.some((c) => c.url.endsWith('/broadcast')), false)
})

test('a database rule error is passed through with its status; other errors are generic', async () => {
  rpc.um_update_member = ruleError(409, 'Another person already has that employee ID.')
  const res = await appFor(ALL).request(`/users/${TARGET}`, { ...json({ employee_id: 'E1' }), method: 'PATCH' }, env)
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error.message, 'Another person already has that employee ID.')

  rpc.um_update_member = async () => Response.json({ code: '23514', message: 'violates check constraint with value 9800000001' }, { status: 400 })
  const generic = await appFor(ALL).request(`/users/${TARGET}`, { ...json({ employee_id: 'E1' }), method: 'PATCH' }, env)
  assert.equal(generic.status, 500)
  assert.doesNotMatch((await generic.json()).error.message, /9800000001/)
})

test('force sign-out passes the verified actor, and the optional session, to the database', async () => {
  const session = '44444444-4444-4444-8444-444444444444'
  rpc.um_revoke_sessions = async () => Response.json(1)
  const res = await appFor({}).request(`/users/${TARGET}/sign-out`, json({ session_id: session }), env)
  assert.equal(res.status, 200)
  assert.equal(calls[0].body.p_actor, ACTOR)
  assert.equal(calls[0].body.p_session, session)
  assert.equal(calls[1].body.messages[0].payload.session_id, session)
})

test('an existing account that has a password is never given staff access', async () => {
  rpc.um_check_create = async () => new Response(null, { status: 204 })
  rpc.um_find_account = async () => Response.json({ user_id: TARGET, is_staff: false, has_password: true })
  const res = await appFor(ALL).request('/users', json({ full_name: 'Z', email: 'z@example.invalid' }), env)
  assert.equal(res.status, 409)
  assert.equal(calls.some((c) => c.url.endsWith('um_create_member') || c.url.includes('/auth/v1/admin/users')), false)
})

test('the session making the request is marked as this device', async () => {
  rpc.um_get_member = async () => Response.json({
    user_id: ACTOR,
    sessions: [{ session_id: 'synthetic-session', current: false }, { session_id: 'other', current: false }],
  })
  const res = await appFor({}).request('/users/me', {}, env)
  const { data } = await res.json()
  assert.deepEqual(data.sessions.map((s) => s.current), [true, false])
})
