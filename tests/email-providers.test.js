import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createApiApp } from '../src/api/app.js'
import { capabilitiesOf, providerOf, FEATURES } from '../src/api/services/email/providers.js'
import { publicAccount } from '../src/api/routes/email/shared.js'
import {
  hostinger, listManagedMailboxes, HostingerUncertainError, HostingerAuthError, HostingerError,
} from '../src/api/services/email/hostinger.js'
import { syncMailbox } from '../src/api/services/email/sync.js'

// Mailbox providers: the capability model, the Hostinger Mail API client and
// connecting Hostinger mailboxes, through the real app with every outbound
// request answered by a fake (Supabase, Gmail, Hostinger). Synthetic data only.

const USER = '44444444-4444-4444-8444-444444444444'
const GOOGLE_BOX = 'aaaaaaaa-1111-4111-8111-111111111111'
const HOST_BOX = 'cccccccc-3333-4333-8333-333333333333'
const THREAD = 'bbbbbbbb-2222-4222-8222-222222222222'
const TOKEN = 'synthetic-hostinger-token-0123456789'

const env = {
  EMAIL_HUB_ENABLED: 'true',
  SUPABASE_URL: 'https://db.example.invalid',
  SUPABASE_ANON_KEY: 'synthetic-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
  EMAIL_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64'),
  HOSTINGER_MAIL_API_TOKEN: TOKEN,
}

const hostAccount = (over = {}) => ({
  id: HOST_BOX, kind: 'shared', provider: 'hostinger', email_address: 'contact@example.invalid', status: 'connected',
  role: 'admin', provider_account_id: 'MBX_contact_1', token_enc: null, history_id: null, ...over,
})

let calls
let rpc
let hostingerHandler
let access
let logs
let pending
const app = createApiApp()

function request(path, init = {}, overrides = {}) {
  pending = []
  const ctx = { waitUntil: (p) => pending.push(p), passThroughOnException() {} }
  return app.request(`/api/email${path}`, init, { ...env, ...overrides }, ctx)
}
const authed = (init = {}) => ({ ...init, headers: { Authorization: 'Bearer synthetic-session', ...(init.headers ?? {}) } })
const json = (body, method = 'POST') => authed({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const hostingerCalls = () => calls.filter((c) => c.url.startsWith('https://api.mail.hostinger.com/'))
const gmailCalls = () => calls.filter((c) => /googleapis\.com/.test(c.url))
const me = (mailboxes) => async () => Response.json({ data: { orderResourceId: 'ORD_1', mailboxes } })

beforeEach((t) => {
  calls = []
  rpc = {}
  logs = []
  hostingerHandler = me([{ resourceId: 'MBX_contact_1', address: 'Contact@Example.invalid' }, { resourceId: 'MBX_sales_2', address: 'sales@example.invalid' }])
  access = { status: 'active', user_id: USER, email: 'sam@example.invalid', permissions: { 'email_inbox.view': 'all', 'email_mailboxes.manage': 'all' } }
  t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')))
  t.mock.method(console, 'error', (...a) => logs.push(a.join(' ')))
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push({ url, method: options.method ?? 'GET', body: options.body, headers: options.headers ?? {} })
    if (url.endsWith('/rest/v1/rpc/my_access')) return Response.json(access)
    const m = url.match(/\/rest\/v1\/rpc\/(\w+)$/)
    if (m) {
      const handler = rpc[m[1]]
      if (!handler) throw new Error(`unexpected rpc ${m[1]}`)
      return handler(JSON.parse(options.body))
    }
    if (url.startsWith('https://api.mail.hostinger.com/')) return hostingerHandler(url, options)
    throw new Error(`unexpected request ${url}`)
  })
})

// ── Capability model ─────────────────────────────────────────────────────────
test('capabilities: Gmail does everything but quota; Hostinger says why it cannot', () => {
  const google = capabilitiesOf({ provider: 'google' })
  for (const f of FEATURES) assert.equal(google.capabilities[f], f !== 'quota', f)
  assert.match(google.unsupported.quota, /Gmail does not report/)

  const host = capabilitiesOf({ provider: 'hostinger' })
  assert.equal(host.capabilities.quota, true)
  assert.equal(host.capabilities.drafts, false)
  assert.match(host.unsupported.drafts, /cannot save drafts/)
  assert.match(host.unsupported.labels, /folders, not labels/)
  assert.match(host.unsupported.send_as, /only as the mailbox address/)

  // Rows from before the provider was reported are Google; anything unknown can do nothing.
  assert.equal(providerOf({}), 'google')
  assert.equal(providerOf({ provider: 'outlook' }), null)
  assert.ok(Object.values(capabilitiesOf({ provider: 'outlook' }).capabilities).every((v) => v === false))
})

test('publicAccount never carries the token, the cursor or the Hostinger resource id', () => {
  const out = publicAccount(hostAccount({ token_enc: 'k1.secret', history_id: '42' }))
  assert.equal(out.token_enc, undefined)
  assert.equal(out.history_id, undefined)
  assert.equal(out.provider_account_id, undefined)
  assert.equal(out.provider, 'hostinger')
  assert.equal(out.capabilities.quota, true)
  assert.doesNotMatch(JSON.stringify(out), /MBX_|secret/)
})

// ── Hostinger client ─────────────────────────────────────────────────────────
test('client: bearer token, JSON envelope, malformed mailboxes dropped, addresses lower-cased', async () => {
  hostingerHandler = me([
    { resourceId: 'MBX_ok_1', address: 'Team@Example.invalid' },
    { resourceId: 'bad id with spaces', address: 'x@example.invalid' },
    { resourceId: 'MBX_noaddr' },
    { resourceId: 'MBX_dupe', address: 'team@example.invalid' },
    'nonsense',
  ])
  const list = await listManagedMailboxes(env)
  assert.deepEqual(list, [{ resourceId: 'MBX_ok_1', address: 'team@example.invalid' }])
  const [call] = hostingerCalls()
  assert.equal(call.url, 'https://api.mail.hostinger.com/api/v1/me')
  assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`)
})

test('client: a read backs off on 429 and succeeds; repeated 429s give up after two retries', async () => {
  let n = 0
  hostingerHandler = async () => (++n === 1
    ? new Response(JSON.stringify({ error: 'Too many', code: 'ERR_RATE_LIMITED' }), { status: 429, headers: { 'Retry-After': '0.01' } })
    : Response.json({ data: { orderResourceId: 'o', mailboxes: [] } }))
  assert.deepEqual(await listManagedMailboxes(env), [])
  assert.equal(n, 2)

  n = 0
  hostingerHandler = async () => { n++; return new Response('{}', { status: 429, headers: { 'Retry-After': '0.01' } }) }
  await assert.rejects(listManagedMailboxes(env), (err) => err instanceof HostingerError && err.status === 429)
  assert.equal(n, 3)
})

test('client: a send is never retried; timeouts and 5xx are "uncertain", a 422 is a plain refusal', async () => {
  let n = 0
  hostingerHandler = async () => { n++; throw new TypeError('network down') }
  await assert.rejects(hostinger(env, '/mailboxes/MBX_1/send', { method: 'POST', body: {} }), HostingerUncertainError)
  assert.equal(n, 1)

  n = 0
  hostingerHandler = async () => { n++; return new Response('{}', { status: 504 }) }
  await assert.rejects(hostinger(env, '/mailboxes/MBX_1/send', { method: 'POST', body: {} }), HostingerUncertainError)
  assert.equal(n, 1)

  hostingerHandler = async () => Response.json({ error: 'to is invalid', code: 'ERR_VALIDATION', params: { to: ['bad'] } }, { status: 422 })
  await assert.rejects(hostinger(env, '/mailboxes/MBX_1/send', { method: 'POST', body: {} }),
    (err) => err instanceof HostingerError && !(err instanceof HostingerUncertainError) && err.status === 422 && err.code === 'ERR_VALIDATION')
})

test('client: a refused or missing token is an auth error, made without sending the token anywhere else', async () => {
  hostingerHandler = async () => Response.json({ error: 'Unauthenticated.', code: 'ERR_UNAUTHENTICATED' }, { status: 401 })
  await assert.rejects(listManagedMailboxes(env), HostingerAuthError)
  await assert.rejects(listManagedMailboxes({ ...env, HOSTINGER_MAIL_API_TOKEN: '' }), HostingerAuthError)
  assert.equal(hostingerCalls().length, 1, 'no request without a token')
  hostingerHandler = async () => Response.json({ error: 'boom', code: 'ERR_INTERNAL' }, { status: 500, headers: { 'Retry-After': '0.01' } })
  await assert.rejects(listManagedMailboxes(env))
  assert.ok(logs.every((l) => !l.includes(TOKEN)), 'the token is never logged')
})

test('client: an unexpected success body is refused, not trusted', async () => {
  hostingerHandler = async () => Response.json({ data: { mailboxes: 'not a list' } })
  await assert.rejects(listManagedMailboxes(env), (err) => err.status === 502)
  hostingerHandler = async () => new Response('<html>proxy</html>', { status: 200 })
  await assert.rejects(listManagedMailboxes(env), (err) => err.status === 502)
})

// ── Status and discovery ─────────────────────────────────────────────────────
test('status reports whether Hostinger is set up, never the token', async () => {
  const on = await (await request('/status', authed())).json()
  assert.equal(on.data.hostinger.configured, true)
  assert.doesNotMatch(JSON.stringify(on), new RegExp(TOKEN))
  const off = await (await request('/status', authed(), { HOSTINGER_MAIL_API_TOKEN: '' })).json()
  assert.equal(off.data.hostinger.configured, false)
  assert.equal(hostingerCalls().length, 0)
})

test('discovery: setup permission required; addresses only, never Hostinger ids', async () => {
  const res = await request('/hostinger/mailboxes', authed())
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.deepEqual(body.data.addresses, ['contact@example.invalid', 'sales@example.invalid'])
  assert.doesNotMatch(JSON.stringify(body), /MBX_/)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')

  calls = []
  access.permissions = { 'email_inbox.view': 'all' }
  assert.equal((await request('/hostinger/mailboxes', authed())).status, 403)
  assert.equal(hostingerCalls().length, 0)
})

test('discovery: not configured answers 503 and asks Hostinger nothing; a refused token says what to check', async () => {
  const off = await request('/hostinger/mailboxes', authed(), { HOSTINGER_MAIL_API_TOKEN: '' })
  assert.equal(off.status, 503)
  assert.equal(hostingerCalls().length, 0)

  hostingerHandler = async () => Response.json({ error: 'Unauthenticated.', code: 'ERR_UNAUTHENTICATED' }, { status: 401 })
  const refused = await request('/hostinger/mailboxes', authed())
  assert.equal(refused.status, 503)
  assert.match((await refused.json()).error.message, /HOSTINGER_MAIL_API_TOKEN/)
})

// ── Connecting ───────────────────────────────────────────────────────────────
test('shared Hostinger mailbox: checked against the token before anything is created', async () => {
  let created = 0
  rpc.em_create_shared = async () => { created++; return Response.json({}) }
  const res = await request('/accounts/shared', json({ email_address: 'unknown@example.invalid', provider: 'hostinger' }))
  assert.equal(res.status, 409)
  assert.match((await res.json()).error.message, /does not cover this address/)
  assert.equal(created, 0)
})

test('shared Hostinger mailbox: created for Hostinger and connected with the ids Hostinger reported', async () => {
  let createArgs
  let connectArgs
  rpc.em_create_shared = async (args) => { createArgs = args; return Response.json({ id: HOST_BOX, kind: 'shared', provider: 'hostinger', email_address: 'contact@example.invalid', status: 'pending' }) }
  rpc.em_connect_hostinger = async (args) => { connectArgs = args; return Response.json(hostAccount()) }
  const res = await request('/accounts/shared', json({
    email_address: ' Contact@Example.invalid ', provider: 'hostinger', display_name: 'Contact',
    // Anything the browser adds about Hostinger is ignored.
    resourceId: 'MBX_attacker', mailboxes: [{ resourceId: 'MBX_attacker', address: 'contact@example.invalid' }],
  }))
  const body = await res.json()
  assert.equal(res.status, 201)
  assert.equal(createArgs.p_provider, 'hostinger')
  assert.equal(createArgs.p_email, 'contact@example.invalid')
  assert.equal(connectArgs.p_account, HOST_BOX)
  assert.deepEqual(connectArgs.p_mailboxes, [
    { resourceId: 'MBX_contact_1', address: 'contact@example.invalid' },
    { resourceId: 'MBX_sales_2', address: 'sales@example.invalid' },
  ])
  assert.equal(body.data.provider, 'hostinger')
  assert.equal(body.data.provider_account_id, undefined)
  assert.doesNotMatch(JSON.stringify(body), /MBX_/)
})

test('shared Google mailbox: unchanged, no provider argument, Hostinger never asked', async () => {
  let createArgs
  rpc.em_create_shared = async (args) => { createArgs = args; return Response.json({ id: GOOGLE_BOX, kind: 'shared', provider: 'google', email_address: 'team@example.invalid' }) }
  const res = await request('/accounts/shared', json({ email_address: 'team@example.invalid' }))
  assert.equal(res.status, 201)
  assert.equal('p_provider' in createArgs, false)
  assert.equal((await res.json()).data.capabilities.drafts, true)
  assert.equal(hostingerCalls().length, 0)

  assert.equal((await request('/accounts/shared', json({ email_address: 'team@example.invalid', provider: 'outlook' }))).status, 400)
})

test('connect: personal (no account) or a shared one; the database decides who may', async () => {
  let args
  rpc.em_connect_hostinger = async (a) => { args = a; return Response.json(hostAccount({ kind: 'personal', owner_id: USER })) }
  const res = await request('/accounts/hostinger/connect', json({ resourceId: 'MBX_attacker' }))
  assert.equal(res.status, 200)
  assert.equal(args.p_account, null)
  assert.equal(args.p_actor, USER)
  assert.equal(args.p_mailboxes.length, 2)

  rpc.em_connect_hostinger = async () => Response.json({ code: 'PT403', message: 'Only this mailbox\'s administrators can connect it.' }, { status: 403 })
  rpc.um_log_denied = async () => Response.json(null)
  const denied = await request('/accounts/hostinger/connect', json({ account_id: HOST_BOX }))
  assert.equal(denied.status, 403)

  assert.equal((await request('/accounts/hostinger/connect', json({ account_id: 'nope' }))).status, 400)
})

// ── Gmail-only routes refuse a Hostinger mailbox before any Gmail call ───────
test('Gmail-only routes answer 409 with the reason for a Hostinger mailbox and call no provider', async () => {
  rpc.em_access = async () => Response.json(hostAccount())
  rpc.em_open_thread = async () => Response.json({ thread: { id: THREAD, account_id: HOST_BOX, gmail_thread_id: 'ab12' }, account: hostAccount(), notes: [], assignable: [] })
  rpc.um_log_denied = async () => Response.json(null)
  const cases = [
    ['/accounts/' + HOST_BOX + '/labels', authed(), /folders, not labels/],
    ['/accounts/' + HOST_BOX + '/send-as', authed(), /only as the mailbox address/],
    ['/accounts/' + HOST_BOX + '/drafts', authed(), /cannot save drafts/],
    ['/accounts/' + HOST_BOX + '/search?q=invoice', authed(), /not available/i],
    ['/accounts/' + HOST_BOX + '/sync', json({}), /not available/i],
    ['/threads/' + THREAD, authed(), /not available/i],
    ['/threads/' + THREAD + '/labels', json({ remove: ['UNREAD'] }), /not available/i],
    ['/threads/' + THREAD + '/messages/ab12/attachments/att1', authed(), /not available/i],
  ]
  for (const [path, init, message] of cases) {
    const res = await request(path, init)
    assert.equal(res.status, 409, path)
    assert.match((await res.json()).error.message, message, path)
  }
  assert.equal(gmailCalls().length, 0)
  assert.equal(hostingerCalls().length, 0)
})

test('send from a Hostinger mailbox is refused and recorded as failed, never sent through Gmail', async () => {
  let finished
  rpc.em_begin_send = async () => Response.json({ duplicate: false, account: hostAccount() })
  rpc.em_finish_send = async (a) => { finished = a; return Response.json(null) }
  const form = new FormData()
  form.set('to', 'client@example.invalid')
  form.set('subject', 'Hello')
  form.set('html', '<p>Hi</p>')
  form.set('send_id', '99999999-9999-4999-8999-999999999999')
  const res = await request(`/accounts/${HOST_BOX}/send`, authed({ method: 'POST', body: form }))
  assert.equal(res.status, 409)
  assert.equal(finished.p_status, 'failed')
  assert.equal(gmailCalls().length, 0)
})

test('quota: read from Hostinger for a Hostinger mailbox; Gmail mailboxes say why not', async () => {
  rpc.em_access = async () => Response.json(hostAccount())
  hostingerHandler = async (url) => {
    assert.equal(url, 'https://api.mail.hostinger.com/api/v1/mailboxes/MBX_contact_1/quota')
    return Response.json({ data: { quotas: [], totalUsage: 1048576, totalLimit: 10485760, totalPercentage: 10, supported: true } })
  }
  const res = await request(`/accounts/${HOST_BOX}/quota`, authed())
  assert.equal(res.status, 200)
  assert.deepEqual((await res.json()).data.quota, { used_bytes: 1048576, limit_bytes: 10485760, percent: 10 })

  rpc.em_access = async () => Response.json({ ...hostAccount(), provider: 'google', provider_account_id: null })
  const google = await request(`/accounts/${GOOGLE_BOX}/quota`, authed())
  assert.equal(google.status, 409)
  assert.match((await google.json()).error.message, /Gmail does not report/)
})

test('mailbox list carries provider and capabilities, never resource ids or tokens', async () => {
  rpc.em_list_accounts = async () => Response.json({
    can_connect_personal: true, can_manage_shared: true,
    mailboxes: [{ ...hostAccount(), unread_count: 0 }],
    shared_setup: [{ ...hostAccount(), member_count: 1 }],
  })
  rpc.em_sync_due = async () => Response.json([])
  const res = await request('/accounts', authed())
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.data.mailboxes[0].provider, 'hostinger')
  assert.equal(body.data.mailboxes[0].capabilities.drafts, false)
  assert.equal(body.data.shared_setup[0].unsupported.labels, 'Hostinger mailboxes have folders, not labels.')
  assert.doesNotMatch(JSON.stringify(body), /MBX_|token_enc/)
})

test('sync never runs Gmail code for a Hostinger mailbox', async () => {
  rpc.em_claim_sync = async () => Response.json({ id: HOST_BOX, provider: 'hostinger', provider_account_id: 'MBX_contact_1', token_enc: null })
  const result = await syncMailbox(env, HOST_BOX)
  assert.deepEqual(result, { skipped: true, provider: 'hostinger' })
  assert.equal(gmailCalls().length, 0)
})
