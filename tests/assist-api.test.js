import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import assist from '../src/api/routes/assist/index.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'

// Live Assist routes with requireAuth replaced by a fixed, verified actor and
// every outbound request answered by a fake. Synthetic data only.
const HELPER = '11111111-1111-4111-8111-111111111111'
const EMPLOYEE = '22222222-2222-4222-8222-222222222222'
const OTHER_HELPER = '33333333-3333-4333-8333-333333333333'
const SESSION = '44444444-4444-4444-8444-444444444444'
const REQUEST = '55555555-5555-4555-8555-555555555555'

const env = { SUPABASE_URL: 'https://db.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' }

function appFor(userId, permissions = {}) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => { c.set('user', { id: userId, permissions }); await next() })
  app.route('/assist', assist)
  return app
}

let calls
let rpc
beforeEach((t) => {
  calls = []
  rpc = {}
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null
    calls.push({ url, body })
    const m = url.match(/\/rest\/v1\/rpc\/(\w+)$/)
    if (m) {
      if (!rpc[m[1]]) throw new Error(`unexpected rpc ${m[1]}`)
      return rpc[m[1]](body)
    }
    if (url.endsWith('/realtime/v1/api/broadcast')) return new Response(null, { status: 202 })
    throw new Error(`unexpected request ${url}`)
  })
})

const post = (body) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const session = (extra = {}) => ({
  id: SESSION, status: 'requested', helper_id: HELPER, helper_name: 'Helper (synthetic)',
  employee_id: EMPLOYEE, employee_name: 'Employee (synthetic)', expires_at: '2026-10-07T10:00:00Z', ...extra,
})
const broadcasts = () => calls.filter((c) => c.url.endsWith('/broadcast')).flatMap((c) => c.body.messages)

test('starting needs live_assist.use, refused before any database call', async () => {
  const res = await appFor(HELPER, {}).request('/assist/sessions', post({ employee_id: EMPLOYEE }), env)
  assert.equal(res.status, 403)
  assert.equal(calls.length, 0)
})

test('malformed input is refused before any network call', async () => {
  const app = appFor(HELPER, { 'live_assist.use': 'all' })
  assert.equal((await app.request('/assist/sessions', post({}), env)).status, 400)
  assert.equal((await app.request('/assist/sessions', post({ employee_id: 'x' }), env)).status, 400)
  assert.equal((await app.request('/assist/sessions', post({ employee_id: EMPLOYEE, help_request_id: 'nope' }), env)).status, 400)
  assert.equal((await app.request('/assist/sessions/not-a-uuid/end', post({}), env)).status, 400)
  assert.equal((await app.request(`/assist/sessions/${SESSION}/respond`, post({ accept: 'yes' }), env)).status, 400)
  assert.equal((await app.request('/assist/help', post({ message: 'x'.repeat(301) }), env)).status, 400)
  assert.equal((await app.request('/assist/help', post({ message: 42 }), env)).status, 400)
  const huge = await app.request('/assist/help', { method: 'POST', body: 'x', headers: { 'Content-Length': String(5 * 1024) } }, env)
  assert.equal(huge.status, 413)
  assert.equal(calls.length, 0)
})

test('a request reaches only the employee, with the verified helper as actor', async () => {
  rpc.la_start = async () => Response.json(session())
  const res = await appFor(HELPER, { 'live_assist.use': 'all' }).request('/assist/sessions', post({ employee_id: EMPLOYEE }), env)
  assert.equal(res.status, 201)
  assert.equal(calls[0].body.p_actor, HELPER)
  assert.deepEqual(broadcasts().map((m) => [m.topic, m.event, m.private]), [[`staff:${EMPLOYEE}`, 'assist_request', true]])
})

test('helping from a help request tells the other helpers it is taken', async () => {
  rpc.la_start = async () => Response.json(session({ help_request_id: REQUEST, claimed_request: true, helpers: [HELPER, OTHER_HELPER] }))
  await appFor(HELPER, { 'live_assist.use': 'all' }).request('/assist/sessions', post({ employee_id: EMPLOYEE, help_request_id: REQUEST }), env)
  assert.deepEqual(broadcasts().map((m) => [m.topic, m.event]), [
    [`staff:${EMPLOYEE}`, 'assist_request'],
    [`staff:${OTHER_HELPER}`, 'help_closed'],
  ])
})

test('a rule refusal is passed through and audited', async () => {
  rpc.la_start = async () => Response.json({ code: 'PT403', message: 'You can only manage people below your own role.' }, { status: 403 })
  rpc.um_log_denied = async () => new Response(null, { status: 204 })
  const res = await appFor(HELPER, { 'live_assist.use': 'all' }).request('/assist/sessions', post({ employee_id: EMPLOYEE }), env)
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error.message, 'You can only manage people below your own role.')
  assert.equal(calls.find((c) => c.url.endsWith('um_log_denied')).body.p_action, 'live_assist.use')
  assert.equal(broadcasts().length, 0)
})

test('an answer to an expired request is a clear 409 and tells nobody', async () => {
  rpc.la_respond = async () => Response.json(session({ status: 'ended', end_reason: 'expired', stale: true }))
  const res = await appFor(EMPLOYEE).request(`/assist/sessions/${SESSION}/respond`, post({ accept: true }), env)
  assert.equal(res.status, 409)
  assert.equal(broadcasts().length, 0)
})

test('accepting tells the helper', async () => {
  rpc.la_respond = async (b) => {
    assert.equal(b.p_actor, EMPLOYEE)
    assert.equal(b.p_accept, true)
    return Response.json(session({ status: 'active' }))
  }
  const res = await appFor(EMPLOYEE).request(`/assist/sessions/${SESSION}/respond`, post({ accept: true }), env)
  assert.equal(res.status, 200)
  assert.deepEqual(broadcasts().map((m) => [m.topic, m.event, m.payload.status]), [[`staff:${HELPER}`, 'assist_response', 'active']])
})

test('ending tells both sides; only connection_lost is passed as a reason', async () => {
  rpc.la_end = async (b) => Response.json(session({ status: 'ended', end_reason: b.p_reason ?? 'employee_ended' }))
  await appFor(EMPLOYEE).request(`/assist/sessions/${SESSION}/end`, post({ reason: 'whatever' }), env)
  assert.equal(calls[0].body.p_reason, null)
  assert.deepEqual(broadcasts().map((m) => m.topic).sort(), [`staff:${EMPLOYEE}`, `staff:${HELPER}`].sort())
  calls = []
  await appFor(EMPLOYEE).request(`/assist/sessions/${SESSION}/end`, post({ reason: 'connection_lost' }), env)
  assert.equal(calls[0].body.p_reason, 'connection_lost')
})

test('asking for help tells every eligible helper in one request, and asking again tells nobody', async () => {
  rpc.la_request_help = async (b) => {
    assert.equal(b.p_actor, EMPLOYEE)
    assert.equal(b.p_section, null)
    return Response.json({ request_id: REQUEST, already_open: false, requester_name: 'Employee (synthetic)', message: 'How?', section: null, helpers: [HELPER, OTHER_HELPER] })
  }
  const res = await appFor(EMPLOYEE).request('/assist/help', post({ message: 'How?', section: 'Not Valid!' }), env)
  assert.equal(res.status, 201)
  assert.equal((await res.json()).data.helpers_notified, 2)
  const sends = calls.filter((c) => c.url.endsWith('/broadcast'))
  assert.equal(sends.length, 1)
  assert.deepEqual(sends[0].body.messages.map((m) => m.topic), [`staff:${HELPER}`, `staff:${OTHER_HELPER}`])

  calls = []
  rpc.la_request_help = async () => Response.json({ request_id: REQUEST, already_open: true, helpers: [] })
  const again = await appFor(EMPLOYEE).request('/assist/help', post({}), env)
  assert.equal(again.status, 200)
  assert.equal(broadcasts().length, 0)
})

test('broadcasts are capped at 30 people per call', async () => {
  const many = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  rpc.la_request_help = async () => Response.json({ request_id: REQUEST, already_open: false, helpers: many })
  await appFor(EMPLOYEE).request('/assist/help', post({}), env)
  assert.equal(broadcasts().length, 30)
})

test('asking one chosen person passes them on and tells only them', async () => {
  rpc.la_request_help = async (b) => {
    assert.equal(b.p_actor, EMPLOYEE)
    assert.equal(b.p_helper, OTHER_HELPER)
    return Response.json({
      request_id: REQUEST, already_open: false, requester_name: 'Employee (synthetic)', message: null, section: 'sales-orders',
      helper_id: OTHER_HELPER, helper_name: 'Other helper (synthetic)', helpers: [OTHER_HELPER],
    })
  }
  const res = await appFor(EMPLOYEE).request('/assist/help', post({ section: 'sales-orders', helper_id: OTHER_HELPER.toUpperCase() }), env)
  assert.equal(res.status, 201)
  const { data } = await res.json()
  assert.equal(data.helper_name, 'Other helper (synthetic)')
  assert.deepEqual(broadcasts().map((m) => [m.topic, m.event, m.payload.for_you]), [[`staff:${OTHER_HELPER}`, 'help_request', true]])
})

test('asking everyone leaves the helper argument out, so older databases still answer', async () => {
  rpc.la_request_help = async (b) => {
    assert.equal('p_helper' in b, false)
    return Response.json({ request_id: REQUEST, already_open: false, helpers: [HELPER] })
  }
  await appFor(EMPLOYEE).request('/assist/help', post({ helper_id: null }), env)
  assert.equal(broadcasts()[0].payload.for_you, false)
})

test('a malformed chosen person is refused before any network call', async () => {
  const res = await appFor(EMPLOYEE).request('/assist/help', post({ helper_id: 'someone' }), env)
  assert.equal(res.status, 400)
  assert.equal(calls.length, 0)
})

test('the helper list is for the verified caller only', async () => {
  rpc.la_my_helpers = async (b) => {
    assert.deepEqual(Object.keys(b), ['p_actor'])
    assert.equal(b.p_actor, EMPLOYEE)
    return Response.json([{ user_id: HELPER, full_name: 'Helper (synthetic)', online: true, busy: false }])
  }
  const res = await appFor(EMPLOYEE).request('/assist/helpers?p_actor=' + HELPER, {}, env)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).data[0].user_id, HELPER)
})
