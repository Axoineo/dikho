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
let dnsHandler
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
  dnsHandler = async () => Response.json({ Status: 0, Answer: [{ type: 15, data: '1 smtp.google.com.' }] })
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
    if (url.startsWith('https://cloudflare-dns.com/dns-query')) return dnsHandler(url, options)
    throw new Error(`unexpected request ${url}`)
  })
})

// ── Capability model ─────────────────────────────────────────────────────────
test('capabilities: Gmail does everything but quota; Hostinger says why it cannot', () => {
  const google = capabilitiesOf({ provider: 'google' })
  for (const f of FEATURES) assert.equal(google.capabilities[f], f !== 'quota', f)
  assert.match(google.unsupported.quota, /Gmail does not report/)

  const host = capabilitiesOf({ provider: 'hostinger' })
  for (const f of ['read', 'send', 'reply', 'forward', 'mark_read', 'star', 'attachments', 'quota']) assert.equal(host.capabilities[f], true, f)
  for (const f of ['search', 'drafts', 'labels', 'archive', 'send_as', 'push']) assert.equal(host.capabilities[f], false, f)
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
test('what Hostinger cannot do answers 409 with the reason and calls no provider', async () => {
  rpc.em_access = async () => Response.json(hostAccount())
  rpc.em_open_thread = async () => Response.json({ thread: { id: THREAD, account_id: HOST_BOX, gmail_thread_id: 'ab12' }, account: hostAccount(), notes: [], assignable: [], provider_messages: [] })
  rpc.um_log_denied = async () => Response.json(null)
  const cases = [
    ['/accounts/' + HOST_BOX + '/labels', authed(), /folders, not labels/],
    ['/accounts/' + HOST_BOX + '/send-as', authed(), /only as the mailbox address/],
    ['/accounts/' + HOST_BOX + '/drafts', authed(), /cannot save drafts/],
    ['/accounts/' + HOST_BOX + '/search?q=invoice', authed(), /older Hostinger mail/],
    ['/threads/' + THREAD + '/labels', json({ remove: ['INBOX'] }), /not available/i],
    ['/threads/' + THREAD + '/labels', json({ add: ['Label_12'] }), /folders, not labels/],
  ]
  for (const [path, init, message] of cases) {
    const res = await request(path, init)
    assert.equal(res.status, 409, path)
    assert.match((await res.json()).error.message, message, path)
  }
  assert.equal(gmailCalls().length, 0)
  assert.equal(hostingerCalls().length, 0)
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

// ── Hostinger reading, flags, attachments, sending and sync ──────────────────
const MSG_IN = '11111111-aaaa-4aaa-8aaa-111111111111'
const MSG_OUT = '22222222-bbbb-4bbb-8bbb-222222222222'
const refs = () => [
  { id: MSG_OUT, folder: 'INBOX.Sent', folder_role: 'sent', uid: 7, message_id: '<a@x>', sent_at: '2026-10-20T10:00:00.000Z', subject: 'Quote',
    from: { name: 'Contact', email: 'contact@example.invalid' }, recipients: [{ name: null, email: 'client@example.invalid', kind: 'to' }, { name: null, email: 'boss@example.invalid', kind: 'bcc' }],
    attachments: [], unseen: false, flagged: false },
  { id: MSG_IN, folder: 'INBOX', folder_role: 'inbox', uid: 41, message_id: '<b@y>', sent_at: '2026-10-21T09:00:00.000Z', subject: 'Re: Quote',
    from: { name: 'Client', email: 'client@example.invalid' }, recipients: [{ name: null, email: 'contact@example.invalid', kind: 'to' }, { name: null, email: 'hidden@example.invalid', kind: 'bcc' }],
    attachments: [{ id: 'att.1~x', filename: 'po.pdf', content_type: 'application/pdf', size: 5, inline: false }], unseen: true, flagged: false },
]
const openThread = (over = {}) => async () => Response.json({
  thread: { id: THREAD, account_id: HOST_BOX, gmail_thread_id: 'f'.repeat(32) }, account: hostAccount(), notes: [], assignable: [],
  provider_messages: refs(), ...over,
})

test('open: bodies fetched live by folder and UID, sanitized, never cached; folders and UIDs stay on the server', async () => {
  rpc.em_open_thread = openThread()
  hostingerHandler = async (url) => {
    if (url.endsWith('/folders/INBOX.Sent/messages/7/text')) return Response.json({ data: { text: 'Our quote', html: '' } })
    if (url.endsWith('/folders/INBOX/messages/41/text')) return Response.json({ data: { text: 'Thanks', html: '<p onclick="x()">Thanks<script>alert(1)</script></p>' } })
    throw new Error(`unexpected ${url}`)
  }
  const res = await request(`/threads/${THREAD}`, authed())
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  const [out, inbound] = body.data.messages
  assert.equal(out.id, MSG_OUT)
  assert.deepEqual(out.bcc, [{ name: null, email: 'boss@example.invalid' }], 'Bcc shown on the sender\'s own copy')
  assert.deepEqual(inbound.bcc, [], 'Bcc never shown on received mail')
  assert.ok(inbound.labels.includes('UNREAD') && inbound.labels.includes('INBOX'))
  assert.doesNotMatch(inbound.html, /script|onclick/)
  assert.match(inbound.render_path, new RegExp(`^/email/render/${THREAD}/${MSG_IN}\\?t=`))
  assert.equal(inbound.attachments[0].filename, 'po.pdf')
  assert.doesNotMatch(JSON.stringify(body), /INBOX\.Sent|"uid"|MBX_|"folder"/)
  assert.equal(gmailCalls().length, 0)
})

test('open: a message moved since the last sync comes back without its body and starts a sync', async () => {
  rpc.em_open_thread = openThread()
  rpc.em_claim_sync = async () => Response.json(null)
  hostingerHandler = async (url) => (url.includes('/messages/41/') ? Response.json({ error: 'gone', code: 'ERR_MESSAGE_NOT_FOUND' }, { status: 404 }) : Response.json({ data: { text: 'ok', html: '' } }))
  const res = await request(`/threads/${THREAD}`, authed())
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.match(body.data.messages[1].text, /moved or deleted/)
  await Promise.allSettled(pending)
  assert.ok(calls.some((c) => c.url.endsWith('/rpc/em_claim_sync')), 'a sync was started')
})

test('mark read: every unread received message flagged \\Seen in its folder, and the index updated', async () => {
  rpc.em_open_thread = openThread()
  let flags
  rpc.em_hostinger_set_flags = async (a) => { flags = a; return Response.json(null) }
  hostingerHandler = async (url, options) => {
    assert.ok(url.endsWith('/mailboxes/MBX_contact_1/folders/INBOX/messages/flags'))
    assert.deepEqual(JSON.parse(options.body), { uids: [41], addFlags: ['\\Seen'] })
    return Response.json({ data: { successful: [41], failed: [] } })
  }
  const res = await request(`/threads/${THREAD}/labels`, json({ remove: ['UNREAD'] }))
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.data.unread, false)
  assert.deepEqual(flags.p_message_ids, [MSG_IN])
  assert.equal(flags.p_unseen, false)
  assert.equal(flags.p_flagged, null)
})

test('mark read: only UIDs Hostinger confirmed are recorded', async () => {
  rpc.em_open_thread = openThread()
  let recorded = false
  rpc.em_hostinger_set_flags = async () => { recorded = true; return Response.json(null) }
  hostingerHandler = async () => Response.json({ data: { successful: [], failed: [{ reason: 'locked' }] } }, { status: 207 })
  const res = await request(`/threads/${THREAD}/labels`, json({ remove: ['UNREAD'] }))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).data.unread, true)
  assert.equal(recorded, false)
})

test('attachments: only an id the index lists for this conversation, downloaded as an opaque file', async () => {
  rpc.em_open_thread = openThread()
  hostingerHandler = async (url) => {
    assert.ok(url.endsWith('/folders/INBOX/messages/41/attachments/att.1~x'))
    return new Response(new Uint8Array([37, 80, 68, 70, 45]), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '5' } })
  }
  const res = await request(`/threads/${THREAD}/messages/${MSG_IN}/attachments/att.1~x?name=po.pdf`, authed())
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Content-Type'), 'application/octet-stream')
  assert.equal(res.headers.get('Content-Security-Policy'), "default-src 'none'; sandbox")
  assert.equal((await res.arrayBuffer()).byteLength, 5)

  calls = []
  const other = await request(`/threads/${THREAD}/messages/${MSG_IN}/attachments/att.2`, authed())
  assert.equal(other.status, 404)
  assert.equal(hostingerCalls().length, 0, 'an id the index does not list is never requested')
  assert.equal((await request(`/threads/${THREAD}/messages/${MSG_IN}/attachments/a%2Fb`, authed())).status, 400)
})

test('attachments: an oversized download is cut off, not buffered whole', async () => {
  rpc.em_open_thread = openThread()
  hostingerHandler = async () => new Response('x', { headers: { 'Content-Length': String(30 * 1024 * 1024) } })
  const res = await request(`/threads/${THREAD}/messages/${MSG_IN}/attachments/att.1~x`, authed())
  assert.equal(res.status, 413)
})

function sendForm(over = {}) {
  const form = new FormData()
  form.set('to', 'client@example.invalid')
  form.set('subject', 'Re: Quote')
  form.set('html', '<p>Hi <img src="https://tracker.example/p.gif"></p>')
  form.set('send_id', '99999999-9999-4999-8999-999999999999')
  for (const [k, v] of Object.entries(over)) form.set(k, v)
  return authed({ method: 'POST', body: form })
}

test('send: a reply goes once through Hostinger with the original by folder and UID, recorded as sent', async () => {
  rpc.em_begin_send = async () => Response.json({ duplicate: false, account: hostAccount({ display_name: 'Dikho "Contact"' }) })
  rpc.em_open_thread = openThread()
  rpc.em_claim_sync = async () => Response.json(null)
  let finished
  rpc.em_finish_send = async (a) => { finished = a; return Response.json(null) }
  let sent
  hostingerHandler = async (url, options) => {
    assert.equal(url, 'https://api.mail.hostinger.com/api/v1/mailboxes/MBX_contact_1/send')
    sent = JSON.parse(options.body)
    return new Response(null, { status: 204 })
  }
  const res = await request(`/accounts/${HOST_BOX}/send`, sendForm({ mode: 'reply', thread_id: THREAD, source_message_id: MSG_IN }))
  assert.equal(res.status, 200)
  assert.deepEqual(sent.to, ['client@example.invalid'])
  assert.deepEqual(sent.inReplyTo, { uid: 41, folder: 'INBOX' })
  assert.equal(sent.forwardOf, undefined)
  assert.equal(sent.displayName, 'Dikho Contact')
  assert.doesNotMatch(sent.html, /tracker\.example/, 'remote images are dropped by the sanitizer')
  assert.equal(finished.p_status, 'sent')
  assert.equal(hostingerCalls().filter((c) => c.url.endsWith('/send')).length, 1)
  assert.equal(gmailCalls().length, 0)
})

test('send: a Hostinger timeout is "uncertain", not retried, and the person is told to check Sent', async () => {
  rpc.em_begin_send = async () => Response.json({ duplicate: false, account: hostAccount() })
  let finished
  rpc.em_finish_send = async (a) => { finished = a; return Response.json(null) }
  hostingerHandler = async () => new Response('{}', { status: 504 })
  const res = await request(`/accounts/${HOST_BOX}/send`, sendForm())
  assert.equal(res.status, 502)
  assert.match((await res.json()).error.message, /Check the Sent folder/)
  assert.equal(finished.p_status, 'uncertain')
  assert.equal(hostingerCalls().length, 1)
})

test('send: replying to a message outside the conversation, or as another address, is refused and recorded as failed', async () => {
  rpc.em_begin_send = async () => Response.json({ duplicate: false, account: hostAccount() })
  rpc.em_open_thread = openThread()
  const statuses = []
  rpc.em_finish_send = async (a) => { statuses.push(a.p_status); return Response.json(null) }
  const foreign = await request(`/accounts/${HOST_BOX}/send`, sendForm({ mode: 'reply', thread_id: THREAD, source_message_id: '33333333-cccc-4ccc-8ccc-333333333333' }))
  assert.equal(foreign.status, 400)
  const alias = await request(`/accounts/${HOST_BOX}/send`, sendForm({ from: 'ceo@example.invalid', send_id: '88888888-8888-4888-8888-888888888888' }))
  assert.equal(alias.status, 409)
  assert.deepEqual(statuses, ['failed', 'failed'])
  assert.equal(hostingerCalls().length, 0)
})

test('sync: folders by role, newest messages by UID, indexed without bodies, outcome recorded', async () => {
  rpc.em_claim_sync = async () => Response.json({ id: HOST_BOX, provider: 'hostinger', provider_account_id: 'MBX_contact_1', email_address: 'contact@example.invalid', token_enc: null })
  let synced
  let finished
  rpc.em_hostinger_sync = async (a) => { synced = a; return Response.json({ added: 2, threads: 1 }) }
  rpc.em_finish_sync = async (a) => { finished = a; return Response.json(null) }
  const msg = (uid, over = {}) => ({
    uid, path: 'INBOX', date: '2026-10-21T09:00:00Z', flags: ['\\Flagged'], unseen: true, size: 10, subject: 'Hello',
    from: { name: 'Client', address: 'Client@Example.invalid' }, to: [{ name: '', address: 'contact@example.invalid' }], cc: [], bcc: [],
    messageId: '<m' + uid + '@x>', inReplyTo: null, attachments: [], ...over,
  })
  hostingerHandler = async (url) => {
    if (url.includes('/folders?')) {
      return Response.json({ data: [
        { path: 'INBOX', name: 'INBOX', delimiter: '.', specialUse: null, messageCount: 2, unreadCount: 1 },
        { path: 'INBOX.Sent', name: 'Sent', delimiter: '.', specialUse: '\\Sent', messageCount: 0, unreadCount: 0 },
        { path: 'INBOX.Junk', name: 'Junk', delimiter: '.', specialUse: '\\Junk', messageCount: 9, unreadCount: 9 },
      ], pagination: { page: 1, perPage: 100, total: 3, totalPages: 1 } })
    }
    if (url.includes('/folders/INBOX/messages?')) {
      assert.match(url, /sort=-uid/)
      return Response.json({ data: [msg(42), msg(41, { date: 'not a date' }), msg(40, { subject: 'Hi\r\nBcc: x', messageId: 'bad\nid' })], pagination: { page: 1, perPage: 100, total: 3, totalPages: 1 } })
    }
    if (url.includes('/folders/INBOX.Sent/messages?')) return Response.json({ data: [], pagination: { page: 1, perPage: 100, total: 0, totalPages: 0 } })
    throw new Error(`unexpected ${url}`)
  }
  const result = await syncMailbox(env, HOST_BOX)
  assert.equal(result.ok, true)
  assert.deepEqual(synced.p_folders.map((f) => [f.folder, f.role, f.min_uid, f.messages.length]), [['INBOX', 'inbox', 40, 2], ['INBOX.Sent', 'sent', null, 0]])
  const [first, second] = synced.p_folders[0].messages
  assert.equal(first.flagged, true)
  assert.deepEqual(first.sender, { name: 'Client', email: 'client@example.invalid' })
  assert.equal(second.message_id, null, 'a header with a line break is dropped')
  assert.equal(JSON.stringify(synced).includes('html'), false, 'no bodies are indexed')
  assert.equal(finished.p_error, null)
  assert.equal(finished.p_full, true)
  assert.equal(gmailCalls().length, 0)
})

test('sync: a token that no longer covers the mailbox asks for reconnection; a refused token is reported, not blamed on the mailbox', async () => {
  rpc.em_claim_sync = async () => Response.json({ id: HOST_BOX, provider: 'hostinger', provider_account_id: 'MBX_contact_1' })
  let marked
  let finished
  rpc.em_mark_account = async (a) => { marked = a; return Response.json(null) }
  rpc.em_finish_sync = async (a) => { finished = a; return Response.json(null) }
  hostingerHandler = async () => Response.json({ error: 'Forbidden', code: 'ERR_FORBIDDEN' }, { status: 403 })
  assert.equal((await syncMailbox(env, HOST_BOX)).ok, false)
  assert.equal(marked.p_state, 'reauth_required')

  marked = null
  hostingerHandler = async () => Response.json({ error: 'Unauthenticated.' }, { status: 401 })
  assert.equal((await syncMailbox(env, HOST_BOX)).ok, false)
  assert.equal(marked, null)
  assert.match(finished.p_error, /HOSTINGER_MAIL_API_TOKEN/)
})

// ── Inbound routing (read-only DNS) ──────────────────────────────────────────
test('routing: a Hostinger mailbox on a domain whose MX is Google is connected but does not receive directly', async () => {
  rpc.em_access = async () => Response.json(hostAccount())
  let asked
  dnsHandler = async (url, options) => { asked = { url, accept: options.headers.Accept }; return Response.json({ Status: 0, Answer: [{ type: 15, data: '1 SMTP.GOOGLE.COM.' }] }) }
  const res = await request(`/accounts/${HOST_BOX}/routing`, authed())
  const body = (await res.json()).data
  assert.equal(res.status, 200)
  assert.equal(asked.url, 'https://cloudflare-dns.com/dns-query?name=example.invalid&type=MX')
  assert.equal(asked.accept, 'application/dns-json')
  assert.deepEqual(body.mx, [{ preference: 1, host: 'smtp.google.com' }])
  assert.equal(body.routes_to, 'google')
  assert.equal(body.inbound, 'elsewhere')
  assert.match(body.note, /split delivery/)
})

test('routing: direct, none, mixed and a failed lookup are told apart, never guessed', async () => {
  rpc.em_access = async () => Response.json(hostAccount())
  const check = async (answer) => {
    dnsHandler = answer
    return (await (await request(`/accounts/${HOST_BOX}/routing`, authed())).json()).data
  }
  let d = await check(async () => Response.json({ Status: 0, Answer: [{ type: 15, data: '10 mx2.hostinger.com.' }, { type: 15, data: '5 mx1.hostinger.com.' }] }))
  assert.equal(d.inbound, 'direct')
  assert.deepEqual(d.mx.map((m) => m.host), ['mx1.hostinger.com', 'mx2.hostinger.com'])
  d = await check(async () => Response.json({ Status: 0 }))
  assert.equal(d.inbound, 'none')
  d = await check(async () => Response.json({ Status: 0, Answer: [{ type: 15, data: '1 smtp.google.com.' }, { type: 15, data: '5 mx1.hostinger.com.' }] }))
  assert.equal(d.routes_to, 'mixed')
  d = await check(async () => Response.json({ Status: 2 }))
  assert.equal(d.inbound, 'unknown')
  d = await check(async () => { throw new TypeError('offline') })
  assert.equal(d.inbound, 'unknown')
})
