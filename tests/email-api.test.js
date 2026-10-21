import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createApiApp } from '../src/api/app.js'
import { base64url, decryptToken, sha256Hex, pkceChallenge } from '../src/api/services/email/crypto.js'
import { resetGoogleKeyCache } from '../src/api/services/email/googleJwt.js'
import { forgetAccessToken } from '../src/api/services/email/google.js'

// The Email Hub API through the real app (CORS, auth, routing), with every
// outbound request answered by a fake: Supabase (my_access and the em_*
// functions), Google OAuth and Gmail. Synthetic data only.

const USER = '44444444-4444-4444-8444-444444444444'
const ACCOUNT = 'aaaaaaaa-1111-4111-8111-111111111111'
const THREAD = 'bbbbbbbb-2222-4222-8222-222222222222'

const env = {
  EMAIL_HUB_ENABLED: 'true',
  SUPABASE_URL: 'https://db.example.invalid',
  SUPABASE_ANON_KEY: 'synthetic-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
  GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'synthetic-client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://api.example.invalid/api/email/oauth/google/callback',
  EMAIL_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64'),
  APP_URL: 'https://app.example.invalid',
  GOOGLE_PUBSUB_TOPIC: 'projects/dikho-test/topics/gmail-push',
  GOOGLE_PUBSUB_AUDIENCE: 'https://api.example.invalid/api/email/webhooks/google-pubsub',
  GOOGLE_PUBSUB_SERVICE_ACCOUNT: 'push@dikho-test.iam.gserviceaccount.com',
}

let calls
let rpc
let google
let gmailHandler
let access
let pending
const app = createApiApp()

function request(path, init = {}, overrides = {}) {
  pending = []
  const ctx = { waitUntil: (p) => pending.push(p), passThroughOnException() {} }
  return app.request(`/api/email${path}`, init, { ...env, ...overrides }, ctx)
}
const settle = () => Promise.allSettled(pending)
const authed = (init = {}) => ({ ...init, headers: { Authorization: 'Bearer synthetic-session', ...(init.headers ?? {}) } })
const json = (body, method = 'POST') => authed({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach((t) => {
  calls = []
  rpc = {}
  google = {}
  gmailHandler = async () => Response.json({})
  access = { status: 'active', user_id: USER, permissions: { 'email_inbox.view': 'all' } }
  forgetAccessToken(ACCOUNT)
  resetGoogleKeyCache()
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = String(input instanceof Request ? input.url : input)
    const body = options.body
    calls.push({ url, method: options.method ?? 'GET', body })
    if (url.endsWith('/rest/v1/rpc/my_access')) return Response.json(access)
    const m = url.match(/\/rest\/v1\/rpc\/(\w+)$/)
    if (m) {
      const handler = rpc[m[1]]
      if (!handler) throw new Error(`unexpected rpc ${m[1]}`)
      return handler(JSON.parse(body))
    }
    if (url === 'https://oauth2.googleapis.com/token') return google.token(new URLSearchParams(body))
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return new Response(null, { status: 200 })
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return google.certs()
    if (url.startsWith('https://gmail.googleapis.com/')) return gmailHandler(url, options)
    throw new Error(`unexpected request ${url}`)
  })
})

const idToken = (claims) => `${base64url(new TextEncoder().encode('{"alg":"RS256"}'))}.${base64url(new TextEncoder().encode(JSON.stringify(claims)))}.sig`
const goodClaims = (over = {}) => ({
  iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, sub: 'google-sub-1', email: 'Sam@Example.com',
  email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600, name: 'Sam Sales', ...over,
})
const tokenReply = (over = {}) => async () => Response.json({
  access_token: 'synthetic-access', expires_in: 3599, refresh_token: '1//synthetic-refresh',
  scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify',
  id_token: idToken(goodClaims()), ...over,
})

// ── Module switch and route classes ──────────────────────────────────────────
test('the whole module is invisible unless EMAIL_HUB_ENABLED=true', async () => {
  for (const path of ['/accounts', '/oauth/google/callback?state=x', '/status']) {
    assert.equal((await request(path, authed(), { EMAIL_HUB_ENABLED: 'false' })).status, 404, path)
  }
  assert.equal((await request('/webhooks/google-pubsub', { method: 'POST' }, { EMAIL_HUB_ENABLED: '' })).status, 404)
  assert.equal(calls.length, 0)
})

test('staff routes need a session; provider callbacks do not use one', async () => {
  for (const path of ['/accounts', '/threads', '/status', '/directory']) {
    assert.equal((await request(path)).status, 401, path)
  }
  // The OAuth return carries no bearer token and is not refused for it.
  const res = await request('/oauth/google/callback')
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('Location'), 'https://app.example.invalid/email/settings?connect=invalid')
  assert.equal(calls.length, 0)
})

test('status reports readiness without values', async () => {
  const res = await request('/status', authed())
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.data.gmail.configured, true)
  assert.equal(body.data.gmail.push, true)
  assert.equal(body.data.delivery.provider, null, 'no sender configured')
  assert.doesNotMatch(JSON.stringify(body), /synthetic-client-secret|synthetic-service|AAAA/)
})

// ── Connecting a mailbox ─────────────────────────────────────────────────────
test('start: state stored only as a hash, PKCE challenge in the consent URL', async () => {
  let begun
  rpc.em_begin_connect = async (args) => { begun = args; return Response.json({ login_hint: null }) }
  const res = await request('/oauth/google/start', json({}))
  assert.equal(res.status, 200)
  const url = new URL((await res.json()).data.url)
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(url.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/gmail.modify')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('access_type'), 'offline')
  const state = url.searchParams.get('state')
  assert.equal(begun.p_state_hash, await sha256Hex(state), 'database holds the hash, not the state')
  assert.notEqual(begun.p_state_hash, state)
  assert.equal(url.searchParams.get('code_challenge'), await pkceChallenge(begun.p_verifier))
  assert.equal(begun.p_actor, USER)
  assert.equal(begun.p_account, null)
})

test('start refuses when Google is not configured', async () => {
  const res = await request('/oauth/google/start', json({}), { EMAIL_TOKEN_KEY: '' })
  assert.equal(res.status, 503)
})

test('callback: one use of the state, encrypted grant stored for the person who started', async () => {
  const verifier = 'v'.repeat(64)
  let stored
  rpc.em_take_state = async () => Response.json({ user_id: USER, account_id: null, code_verifier: verifier })
  rpc.em_store_connection = async (args) => { stored = args; return Response.json({ id: ACCOUNT, kind: 'personal', email_address: 'sam@example.com' }) }
  rpc.em_claim_sync = async () => Response.json(null)
  google.token = async (form) => {
    assert.equal(form.get('code_verifier'), verifier)
    assert.equal(form.get('grant_type'), 'authorization_code')
    return tokenReply()()
  }
  const res = await request('/oauth/google/callback?state=' + 's'.repeat(43) + '&code=4/synthetic-code')
  await settle()
  assert.equal(res.headers.get('Location'), 'https://app.example.invalid/email/settings?connect=connected')
  assert.equal(stored.p_actor, USER)
  assert.equal(stored.p_email, 'sam@example.com')
  assert.equal(stored.p_subject, 'google-sub-1')
  assert.doesNotMatch(stored.p_token_enc, /synthetic-refresh/, 'never stored in the clear')
  assert.equal(await decryptToken(env, stored.p_token_enc, 'sam@example.com'), '1//synthetic-refresh')
  const takeCall = calls.find((c) => c.url.endsWith('/em_take_state'))
  assert.equal(JSON.parse(takeCall.body).p_state_hash, await sha256Hex('s'.repeat(43)))
})

test('callback: a replayed or expired state stops before Google is asked', async () => {
  rpc.em_take_state = async () => Response.json(null)
  const res = await request('/oauth/google/callback?state=' + 's'.repeat(43) + '&code=4/synthetic-code')
  assert.equal(res.headers.get('Location'), 'https://app.example.invalid/email/settings?connect=expired')
  assert.ok(!calls.some((c) => c.url.includes('oauth2.googleapis.com')))
})

test('callback: consent declined, wrong workspace, missing scope, unverified email', async () => {
  rpc.em_take_state = async () => Response.json({ user_id: USER, account_id: null, code_verifier: 'v'.repeat(64) })
  rpc.em_store_connection = async () => { throw new Error('must not store') }

  let res = await request('/oauth/google/callback?state=' + 's'.repeat(43) + '&error=access_denied')
  assert.match(res.headers.get('Location'), /connect=cancelled$/)

  google.token = tokenReply({ id_token: idToken(goodClaims({ hd: 'other.example' })) })
  res = await request('/oauth/google/callback?state=' + 's'.repeat(43) + '&code=4/synthetic-code', {}, { GOOGLE_WORKSPACE_DOMAIN: 'example.com' })
  assert.match(res.headers.get('Location'), /connect=wrong_domain$/)

  google.token = tokenReply({ scope: 'openid email' })
  res = await request('/oauth/google/callback?state=' + 's'.repeat(43) + '&code=4/synthetic-code')
  assert.match(res.headers.get('Location'), /connect=scope_missing$/)

  google.token = tokenReply({ id_token: idToken(goodClaims({ email_verified: false })) })
  res = await request('/oauth/google/callback?state=' + 's'.repeat(43) + '&code=4/synthetic-code')
  assert.match(res.headers.get('Location'), /connect=identity_invalid$/)

  google.token = tokenReply({ id_token: idToken(goodClaims({ aud: 'someone-else' })) })
  res = await request('/oauth/google/callback?state=' + 's'.repeat(43) + '&code=4/synthetic-code')
  assert.match(res.headers.get('Location'), /connect=identity_invalid$/)
})

test('callback: a refused connection revokes the fresh grant', async () => {
  rpc.em_take_state = async () => Response.json({ user_id: USER, account_id: ACCOUNT, code_verifier: 'v'.repeat(64) })
  rpc.em_store_connection = async () => Response.json({ code: 'PT409', message: 'You signed in to Google as a different address' }, { status: 409 })
  google.token = tokenReply()
  const res = await request('/oauth/google/callback?state=' + 's'.repeat(43) + '&code=4/synthetic-code')
  await settle()
  assert.match(res.headers.get('Location'), /connect=conflict$/)
  assert.ok(calls.some((c) => c.url.startsWith('https://oauth2.googleapis.com/revoke')))
})

// ── Reading ──────────────────────────────────────────────────────────────────
const openMeta = (role = 'viewer') => async () => Response.json({
  thread: { id: THREAD, account_id: ACCOUNT, gmail_thread_id: '18c0a1', subject: 'Rates' },
  account: { id: ACCOUNT, email_address: 'sam@example.com', status: 'connected', role, token_enc: 'kSECRET', history_id: '99' },
  notes: [], assignable: [],
})

test('opening a thread: live from Gmail, sanitized, never cached, no token in the answer', async () => {
  rpc.em_open_thread = openMeta()
  rpc.em_upsert_threads = async () => Response.json(1)
  google.token = async (form) => {
    assert.equal(form.get('grant_type'), 'refresh_token')
    return Response.json({ access_token: 'synthetic-access', expires_in: 3599 })
  }
  // The stored token must decrypt: make a real one for this mailbox.
  const { encryptToken } = await import('../src/api/services/email/crypto.js')
  const tokenEnc = await encryptToken(env, '1//synthetic-refresh', 'sam@example.com')
  rpc.em_open_thread = async () => Response.json({
    thread: { id: THREAD, account_id: ACCOUNT, gmail_thread_id: '18c0a1', subject: 'Rates' },
    account: { id: ACCOUNT, email_address: 'sam@example.com', status: 'connected', role: 'viewer', token_enc: tokenEnc, history_id: '99' },
    notes: [], assignable: [],
  })
  const html = base64url(new TextEncoder().encode('<p onclick="x()">Hi</p><script>steal()</script><img src="https://t.example/p.gif">'))
  gmailHandler = async (url) => {
    assert.match(url, /\/threads\/18c0a1\?format=full$/)
    return Response.json({ id: '18c0a1', messages: [{ id: '18c0a2', threadId: '18c0a1', labelIds: ['INBOX'], internalDate: '1000',
      payload: { mimeType: 'text/html', headers: [{ name: 'From', value: 'c@client.example' }, { name: 'Bcc', value: 'hidden@example.com' }], body: { data: html } } }] })
  }
  const res = await request(`/threads/${THREAD}`, authed())
  await settle()
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  const text = await res.text()
  assert.doesNotMatch(text, /token_enc|kSECRET|synthetic-refresh|history_id/)
  const body = JSON.parse(text)
  assert.equal(body.data.messages[0].html, '<p>Hi</p>')
  assert.equal(body.data.messages[0].blocked_images, 1)
  assert.deepEqual(body.data.messages[0].bcc, [], 'Bcc only on our own sent copy')
})

test('a refused Google grant marks the mailbox for reconnection', async () => {
  const { encryptToken } = await import('../src/api/services/email/crypto.js')
  const tokenEnc = await encryptToken(env, '1//revoked', 'sam@example.com')
  let marked
  rpc.em_open_thread = async () => Response.json({
    thread: { id: THREAD, account_id: ACCOUNT, gmail_thread_id: '18c0a1' },
    account: { id: ACCOUNT, email_address: 'sam@example.com', role: 'viewer', token_enc: tokenEnc }, notes: [], assignable: [],
  })
  rpc.em_mark_account = async (args) => { marked = args; return new Response(null, { status: 204 }) }
  google.token = async () => Response.json({ error: 'invalid_grant' }, { status: 400 })
  const res = await request(`/threads/${THREAD}`, authed())
  assert.equal(res.status, 409)
  assert.equal(marked.p_state, 'reauth_required')
})

test('list input is validated before the database is asked', async () => {
  for (const q of ['?folder=../x', '?account=nope', '?before_at=yesterday', '?before_id=1']) {
    assert.equal((await request(`/threads${q}`, authed())).status, 400, q)
  }
  assert.ok(!calls.some((c) => c.url.endsWith('/em_list_threads')))
})

test('labels: only known system labels and the mailbox\'s own labels reach Gmail', async () => {
  const { encryptToken } = await import('../src/api/services/email/crypto.js')
  const tokenEnc = await encryptToken(env, '1//r', 'sam@example.com')
  rpc.em_open_thread = async (args) => {
    assert.equal(args.p_min_role, 'responder')
    return Response.json({ thread: { id: THREAD, account_id: ACCOUNT, gmail_thread_id: '18c0a1' },
      account: { id: ACCOUNT, email_address: 'sam@example.com', role: 'responder', token_enc: tokenEnc } })
  }
  let stored
  rpc.em_set_thread_labels = async (args) => { stored = args; return new Response(null, { status: 204 }) }
  google.token = async () => Response.json({ access_token: 'a', expires_in: 3599 })
  let sent
  gmailHandler = async (url, options) => {
    sent = JSON.parse(options.body)
    return Response.json({ id: '18c0a1', messages: [{ id: '1', labelIds: ['STARRED', 'Label_7'] }] })
  }
  const res = await request(`/threads/${THREAD}/labels`, json({ add: ['STARRED', 'Label_7', 'TRASH', 'SPAM', 'x'], remove: ['INBOX', 'UNREAD'] }))
  assert.equal(res.status, 200)
  assert.deepEqual(sent, { addLabelIds: ['STARRED', 'Label_7'], removeLabelIds: ['INBOX', 'UNREAD'] })
  assert.deepEqual(stored.p_label_ids, ['STARRED', 'Label_7'])
  assert.equal((await request(`/threads/${THREAD}/labels`, json({ add: ['TRASH'] }))).status, 400)
})

test('attachments download as opaque files under a sandbox CSP', async () => {
  const { encryptToken } = await import('../src/api/services/email/crypto.js')
  const tokenEnc = await encryptToken(env, '1//r', 'sam@example.com')
  rpc.em_open_thread = async () => Response.json({ thread: { id: THREAD, account_id: ACCOUNT, gmail_thread_id: '18c0a1' },
    account: { id: ACCOUNT, email_address: 'sam@example.com', role: 'viewer', token_enc: tokenEnc } })
  google.token = async () => Response.json({ access_token: 'a', expires_in: 3599 })
  gmailHandler = async () => Response.json({ size: 5, data: base64url(new TextEncoder().encode('<html>')) })
  const res = await request(`/threads/${THREAD}/messages/18c0a2/attachments/ANGjdJ_x?name=${encodeURIComponent('../../evil".html')}`, authed())
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Content-Type'), 'application/octet-stream')
  assert.match(res.headers.get('Content-Disposition'), /^attachment; filename="\.\._\.\._evil_\.html"/)
  assert.match(res.headers.get('Content-Security-Policy'), /sandbox/)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  assert.equal((await request(`/threads/${THREAD}/messages/xyz/attachments/a`, authed())).status, 400)
})

// ── Sending ──────────────────────────────────────────────────────────────────
function sendForm(fields) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return authed({ method: 'POST', body: form })
}
const SEND_ID = 'cccccccc-3333-4333-8333-333333333333'

async function sendSetup() {
  const { encryptToken } = await import('../src/api/services/email/crypto.js')
  const tokenEnc = await encryptToken(env, '1//r', 'sam@example.com')
  const finished = []
  rpc.em_begin_send = async () => Response.json({ duplicate: false,
    account: { id: ACCOUNT, email_address: 'sam@example.com', display_name: 'Sam', status: 'connected', role: 'responder', token_enc: tokenEnc } })
  rpc.em_finish_send = async (args) => { finished.push(args); return new Response(null, { status: 204 }) }
  rpc.em_claim_sync = async () => Response.json(null)
  google.token = async () => Response.json({ access_token: 'a', expires_in: 3599 })
  return finished
}

test('send: validated, sanitized, sent once through the upload endpoint', async () => {
  const finished = await sendSetup()
  let uploads = 0
  let raw = ''
  gmailHandler = async (url, options) => {
    assert.match(url, /^https:\/\/gmail\.googleapis\.com\/upload\/gmail\/v1\/users\/me\/messages\/send\?uploadType=multipart$/)
    uploads++
    raw = options.body
    return Response.json({ id: '18c0ff', threadId: '18c0fe' })
  }
  const res = await request(`/accounts/${ACCOUNT}/send`, sendForm({
    send_id: SEND_ID, to: 'Client <c@client.example>', subject: 'Rates', html: '<p>Hello</p><script>x()</script>',
  }))
  await settle()
  assert.equal(res.status, 200)
  assert.equal(uploads, 1)
  assert.match(raw, /Content-Type: message\/rfc822/)
  assert.match(raw, /From: "Sam" <sam@example\.com>/)
  assert.doesNotMatch(Buffer.from(raw.split('text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString(), /script/)
  assert.deepEqual(finished.map((f) => f.p_status), ['sent'])
})

test('send: a duplicate submit returns the first attempt and sends nothing', async () => {
  rpc.em_begin_send = async () => Response.json({ duplicate: true, status: 'sent', gmail_message_id: '18c0ff' })
  gmailHandler = async () => { throw new Error('must not reach Gmail') }
  const res = await request(`/accounts/${ACCOUNT}/send`, sendForm({ send_id: SEND_ID, to: 'c@client.example', subject: 'x', html: 'x' }))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).data.duplicate, true)
})

test('send: a Gmail timeout is "uncertain" and is not retried', async () => {
  const finished = await sendSetup()
  let uploads = 0
  gmailHandler = async () => { uploads++; throw new TypeError('network connection lost') }
  const res = await request(`/accounts/${ACCOUNT}/send`, sendForm({ send_id: SEND_ID, to: 'c@client.example', subject: 'x', html: 'x' }))
  assert.equal(res.status, 502)
  assert.match((await res.json()).error.message, /Check the Sent folder/)
  assert.equal(uploads, 1, 'never sent twice')
  assert.deepEqual(finished.map((f) => f.p_status), ['uncertain'])
})

test('send: bad recipients, header injection and missing ids are refused before anything is recorded', async () => {
  for (const fields of [
    { send_id: SEND_ID, to: 'not-an-address', subject: 'x' },
    { send_id: SEND_ID, to: '', subject: 'x' },
    { send_id: SEND_ID, to: 'c@client.example', subject: 'x\r\nBcc: all@example.com' },
    { send_id: 'nope', to: 'c@client.example', subject: 'x' },
    { send_id: SEND_ID, to: 'c@client.example', subject: 'x', mode: 'reply' },
    { send_id: SEND_ID, to: Array.from({ length: 51 }, (_, i) => `p${i}@example.com`).join(','), subject: 'x' },
  ]) {
    assert.equal((await request(`/accounts/${ACCOUNT}/send`, sendForm(fields))).status, 400, JSON.stringify(fields).slice(0, 80))
  }
  assert.ok(!calls.some((c) => c.url.endsWith('/em_begin_send')))
})

// ── Gmail push ───────────────────────────────────────────────────────────────
async function pushSetup() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  google.certs = async () => Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'max-age=3600' } })
  return async (claims, kid = 'k1') => {
    const enc = (o) => base64url(new TextEncoder().encode(JSON.stringify(o)))
    const head = enc({ alg: 'RS256', kid, typ: 'JWT' })
    const body = enc({ iss: 'https://accounts.google.com', aud: env.GOOGLE_PUBSUB_AUDIENCE, email: env.GOOGLE_PUBSUB_SERVICE_ACCOUNT,
      email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims })
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`)))
    return `${head}.${body}.${base64url(sig)}`
  }
}

const pushBody = (data) => JSON.stringify({ message: { data: Buffer.from(JSON.stringify(data)).toString('base64'), messageId: '1' }, subscription: 's' })

test('push: only Google-signed tokens for this subscription are accepted', async () => {
  const sign = await pushSetup()
  let target = null
  rpc.em_push_target = async (args) => { target = args; return Response.json(null) }
  const post = async (token) => request('/webhooks/google-pubsub', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: pushBody({ emailAddress: 'sam@example.com', historyId: 12345 }) })

  assert.equal((await post(null)).status, 401)
  assert.equal((await post(await sign({ aud: 'https://elsewhere.example' }))).status, 401, 'wrong audience')
  assert.equal((await post(await sign({ email: 'attacker@evil.example' }))).status, 401, 'wrong service account')
  assert.equal((await post(await sign({ exp: Math.floor(Date.now() / 1000) - 3600 }))).status, 401, 'expired')
  assert.equal((await post(await sign({}, 'unknown-kid'))).status, 401, 'unknown key')
  const forged = (await sign({})).split('.')
  forged[1] = base64url(new TextEncoder().encode(JSON.stringify({ aud: env.GOOGLE_PUBSUB_AUDIENCE })))
  assert.equal((await post(forged.join('.'))).status, 401, 'tampered claims')
  assert.equal(target, null, 'nothing reached the database')

  const res = await post(await sign({}))
  assert.equal(res.status, 204)
  assert.deepEqual(target, { p_email: 'sam@example.com', p_history_id: '12345' })
})

test('push: a duplicate or stale notification triggers no sync', async () => {
  const sign = await pushSetup()
  rpc.em_push_target = async () => Response.json(null)
  rpc.em_claim_sync = async () => { throw new Error('must not sync') }
  const res = await request('/webhooks/google-pubsub', { method: 'POST', headers: { Authorization: `Bearer ${await sign({})}` },
    body: pushBody({ emailAddress: 'sam@example.com', historyId: 1 }) })
  await settle()
  assert.equal(res.status, 204)
})
