import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createApiApp } from '../src/api/app.js'
import { dispatchCampaignBatch, campaignReadiness } from '../src/api/services/email/campaigns.js'
import { encryptToken } from '../src/api/services/email/crypto.js'
import { forgetAccessToken } from '../src/api/services/email/google.js'

// Campaigns sent through a connected mailbox instead of Amazon SES, with
// every outbound request answered by a fake (Supabase, Google, Gmail,
// Hostinger). SES is off throughout. Synthetic data only.

const USER = 'a1111111-1111-4111-8111-111111111111'
const CAMPAIGN = 'c1111111-1111-4111-8111-111111111111'
const GMAIL_BOX = 'aaaaaaaa-1111-4111-8111-111111111111'
const HOST_BOX = 'cccccccc-3333-4333-8333-333333333333'
const KEY = Buffer.alloc(32, 7).toString('base64')

const env = {
  EMAIL_HUB_ENABLED: 'true',
  SUPABASE_URL: 'https://db.example.invalid',
  SUPABASE_ANON_KEY: 'synthetic-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
  EMAIL_TOKEN_KEY: KEY,
  API_PUBLIC_URL: 'https://api.example.invalid',
  EMAIL_DAILY_CAP: '100',
  GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'synthetic-client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://api.example.invalid/api/email/oauth/google/callback',
  HOSTINGER_MAIL_API_TOKEN: 'synthetic-hostinger-token-0123456789',
}

const campaign = { id: CAMPAIGN, from_name: 'Dikho Offers', from_email: 'news@example.invalid', reply_to: null, subject: 'Hello {{first_name}}', preheader: '', html: '<p>Hi {{first_name}}</p>', text_body: '' }
const recipients = (n) => Array.from({ length: n }, (_, i) => ({ id: `r0000000-0000-4000-8000-00000000000${i + 1}`, email: `p${i + 1}@example.com`, name: `Person ${i + 1}` }))

let calls
let rpc
let gmailHandler
let hostingerHandler
let access
const gmailSender = async () => ({ id: GMAIL_BOX, provider: 'google', provider_account_id: null, email_address: 'news@example.invalid', display_name: 'News', token_enc: await encryptToken(env, '1//refresh', 'news@example.invalid') })
const hostSender = { id: HOST_BOX, provider: 'hostinger', provider_account_id: 'MBX_news_1', email_address: 'news@example.invalid', display_name: 'News', token_enc: null }

beforeEach((t) => {
  calls = []
  rpc = {}
  access = { status: 'active', user_id: USER, email: 'maker@example.invalid', permissions: { 'email_campaigns.create': 'all', 'email_inbox.view': 'all' } }
  gmailHandler = async () => Response.json({ id: 'gm1' })
  hostingerHandler = async () => new Response(null, { status: 204 })
  forgetAccessToken(GMAIL_BOX)
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push({ url, method: options.method ?? 'GET', body: options.body, headers: options.headers ?? {} })
    if (url.endsWith('/rest/v1/rpc/my_access')) return Response.json(access)
    const m = url.match(/\/rest\/v1\/rpc\/(\w+)$/)
    if (m) {
      if (!rpc[m[1]]) throw new Error(`unexpected rpc ${m[1]}`)
      return rpc[m[1]](JSON.parse(options.body))
    }
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-access', expires_in: 3600 })
    if (url.startsWith('https://gmail.googleapis.com/')) return gmailHandler(url, options)
    if (url.startsWith('https://api.mail.hostinger.com/')) return hostingerHandler(url, options)
    if (url.includes('amazonaws.com')) throw new Error('SES must never be called')
    throw new Error(`unexpected request ${url}`)
  })
})

const sends = (host) => calls.filter((c) => c.url.startsWith(host) && c.method === 'POST')
const app = createApiApp()
const req = (path, init = {}, extra = {}) => app.request(`/api/email${path}`, {
  ...init, headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
}, { ...env, ...extra })

// ── Readiness ────────────────────────────────────────────────────────────────
test('readiness no longer needs SES; it needs a daily cap, the unsubscribe address and the key', () => {
  const r = campaignReadiness(env)
  assert.equal(r.ready, true)
  assert.equal(r.ses, false)
  assert.equal(r.scheduler, false)
  assert.deepEqual(campaignReadiness({ ...env, EMAIL_DAILY_CAP: '' }).missing, ['an organization-wide daily limit (EMAIL_DAILY_CAP)'])
})

// ── Dispatch through Gmail ───────────────────────────────────────────────────
test('Gmail sender: one upload per recipient from the mailbox address, unsubscribe headers, never retried', async () => {
  let finished
  rpc.em_claim_campaign_batch = async (a) => {
    assert.equal(a.p_allow_ses, false)
    return Response.json({ campaign, sender: await gmailSender(), recipients: recipients(2) })
  }
  rpc.em_finish_campaign_batch = async (a) => { finished = a; return Response.json(null) }
  const raws = []
  gmailHandler = async (url, options) => {
    assert.equal(url, 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart')
    raws.push(await new Response(options.body).text())
    return Response.json({ id: `gm${raws.length}` })
  }
  const summary = await dispatchCampaignBatch(env)
  assert.deepEqual(summary, { sent: 2, failed: 0, uncertain: 0, retry: 0 })
  assert.deepEqual(finished.p_results.map((r) => r.status), ['sent', 'sent'])
  assert.equal(finished.p_cooldown_seconds, null)
  assert.equal(finished.p_pause_note, null)
  assert.equal(raws.length, 2)
  assert.match(raws[0], /From: "Dikho Offers" <news@example\.invalid>/)
  assert.match(raws[0], /List-Unsubscribe: <https:\/\/api\.example\.invalid\/api\/email\/unsubscribe\?r=/)
  assert.match(raws[0], /List-Unsubscribe-Post: List-Unsubscribe=One-Click/)
})

test('Gmail sender: a sending limit rests the mailbox and holds the rest of the batch back unsent', async () => {
  let finished
  rpc.em_claim_campaign_batch = async () => Response.json({ campaign, sender: await gmailSender(), recipients: recipients(4) })
  rpc.em_finish_campaign_batch = async (a) => { finished = a; return Response.json(null) }
  gmailHandler = async () => Response.json({ error: { code: 403, errors: [{ reason: 'dailyLimitExceeded' }] } }, { status: 403 })
  const summary = await dispatchCampaignBatch(env)
  assert.equal(summary.sent, 0)
  assert.equal(summary.retry, 4)
  assert.equal(finished.p_cooldown_seconds, 6 * 3600)
  assert.ok(sends('https://gmail.googleapis.com/').length <= 2, 'at most the in-flight pair was attempted')
})

test('Gmail sender: a refused grant pauses the campaign; a timeout is uncertain and not retried', async () => {
  let finished
  rpc.em_claim_campaign_batch = async () => Response.json({ campaign, sender: await gmailSender(), recipients: recipients(1) })
  rpc.em_finish_campaign_batch = async (a) => { finished = a; return Response.json(null) }
  gmailHandler = async () => new Response('{}', { status: 401 })
  await dispatchCampaignBatch(env)
  assert.match(finished.p_pause_note, /Reconnect it/)
  assert.equal(finished.p_results[0].status, 'pending')

  forgetAccessToken(GMAIL_BOX)
  calls = []
  gmailHandler = async () => { throw new TypeError('timeout') }
  await dispatchCampaignBatch(env)
  assert.equal(finished.p_results[0].status, 'uncertain')
  assert.equal(sends('https://gmail.googleapis.com/').length, 1)
})

// ── Dispatch through Hostinger ───────────────────────────────────────────────
test('Hostinger sender: one POST /send per recipient, display name, no custom headers, accepted without an id', async () => {
  let finished
  rpc.em_claim_campaign_batch = async () => Response.json({ campaign: { ...campaign, reply_to: 'sales@example.invalid' }, sender: hostSender, recipients: recipients(2) })
  rpc.em_finish_campaign_batch = async (a) => { finished = a; return Response.json(null) }
  const bodies = []
  hostingerHandler = async (url, options) => {
    assert.equal(url, 'https://api.mail.hostinger.com/api/v1/mailboxes/MBX_news_1/send')
    bodies.push(JSON.parse(options.body))
    return new Response(null, { status: 204 })
  }
  assert.deepEqual(await dispatchCampaignBatch(env), { sent: 2, failed: 0, uncertain: 0, retry: 0 })
  assert.deepEqual(bodies.map((b) => b.to), [['p1@example.com'], ['p2@example.com']])
  assert.equal(bodies[0].displayName, 'Dikho Offers')
  assert.equal(bodies[0].subject, 'Hello Person')
  assert.match(bodies[0].html, /unsubscribe\?r=/, 'the footer link is the unsubscribe route')
  assert.equal('headers' in bodies[0] || 'replyTo' in bodies[0], false)
  assert.deepEqual(finished.p_results.map((r) => r.message_id ?? null), [null, null])
})

test('Hostinger sender: 429 rests the mailbox; a token that no longer covers it pauses; 5xx is uncertain', async () => {
  let finished
  rpc.em_claim_campaign_batch = async () => Response.json({ campaign, sender: hostSender, recipients: recipients(1) })
  rpc.em_finish_campaign_batch = async (a) => { finished = a; return Response.json(null) }
  hostingerHandler = async () => Response.json({ error: 'slow down', code: 'ERR_RATE_LIMITED' }, { status: 429 })
  await dispatchCampaignBatch(env)
  assert.equal(finished.p_cooldown_seconds, 900)
  assert.equal(finished.p_results[0].status, 'pending')

  hostingerHandler = async () => Response.json({ error: 'Forbidden', code: 'ERR_FORBIDDEN' }, { status: 403 })
  await dispatchCampaignBatch(env)
  assert.match(finished.p_pause_note, /no longer covers/)

  calls = []
  hostingerHandler = async () => new Response('{}', { status: 502 })
  await dispatchCampaignBatch(env)
  assert.equal(finished.p_results[0].status, 'uncertain')
  assert.equal(sends('https://api.mail.hostinger.com/').length, 1)
})

// ── Routes ───────────────────────────────────────────────────────────────────
test('campaign list offers the mailboxes this person may send from, and no SES senders while SES is off', async () => {
  rpc.em_list_campaigns = async () => Response.json([])
  rpc.em_campaign_senders = async (a) => { assert.equal(a.p_actor, USER); return Response.json([{ id: HOST_BOX, email_address: 'news@example.invalid', provider: 'hostinger', daily_cap: 50, sent_today: 3 }]) }
  const res = await req('/campaigns')
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.data.sender_mailboxes[0].daily_cap, 50)
  assert.deepEqual(body.data.senders, [])
  assert.equal(body.data.readiness.ready, true)
})

test('submit: a mailbox campaign skips the SES sender list; without a mailbox and without SES it is refused', async () => {
  let submitted = 0
  rpc.em_submit_campaign = async () => { submitted++; return Response.json({ id: CAMPAIGN, status: 'pending_approval' }) }
  rpc.em_get_campaign = async () => Response.json({ id: CAMPAIGN, sender_account_id: GMAIL_BOX, sender_provider: 'google', from_email: 'news@example.invalid' })
  assert.equal((await req(`/campaigns/${CAMPAIGN}/submit`, { method: 'POST', body: '{}' })).status, 200)

  rpc.em_get_campaign = async () => Response.json({ id: CAMPAIGN, sender_account_id: null, from_email: 'news@example.invalid' })
  const noMailbox = await req(`/campaigns/${CAMPAIGN}/submit`, { method: 'POST', body: '{}' })
  assert.equal(noMailbox.status, 400)
  assert.match((await noMailbox.json()).error.message, /connected mailbox/)

  rpc.em_get_campaign = async () => Response.json({ id: CAMPAIGN, sender_account_id: HOST_BOX, sender_provider: 'hostinger', reply_to: 'sales@example.invalid', from_email: 'news@example.invalid' })
  const replyTo = await req(`/campaigns/${CAMPAIGN}/submit`, { method: 'POST', body: '{}' })
  assert.equal(replyTo.status, 400)
  assert.match((await replyTo.json()).error.message, /reply-to/)
  assert.equal(submitted, 1)
})

test('saving: the sender mailbox id is validated before the database is asked', async () => {
  let saved
  rpc.em_save_campaign = async (a) => { saved = a; return Response.json({ id: CAMPAIGN }) }
  assert.equal((await req(`/campaigns/${CAMPAIGN}`, { method: 'PUT', body: JSON.stringify({ sender_account_id: 'not-a-mailbox' }) })).status, 400)
  assert.equal(saved, undefined)
  assert.equal((await req(`/campaigns/${CAMPAIGN}`, { method: 'PUT', body: JSON.stringify({ sender_account_id: HOST_BOX.toUpperCase() }) })).status, 200)
  assert.equal(saved.p_fields.sender_account_id, HOST_BOX)
})

test('test send: through the sender mailbox, only to the requester, within both limits', async () => {
  rpc.em_get_campaign = async () => Response.json({ ...campaign, sender_account_id: HOST_BOX, sender_provider: 'hostinger' })
  rpc.em_access = async (a) => {
    assert.equal(a.p_min_role, 'responder')
    return Response.json({ ...hostSender, status: 'connected', campaign_sender: true, role: 'responder' })
  }
  let org = true
  let mailbox = true
  rpc.em_take_budget = async () => Response.json(org)
  rpc.em_take_mailbox_budget = async (a) => { assert.equal(a.p_account, HOST_BOX); return Response.json(mailbox) }
  let sent
  hostingerHandler = async (url, options) => { sent = JSON.parse(options.body); return new Response(null, { status: 204 }) }
  const res = await req(`/campaigns/${CAMPAIGN}/test`, { method: 'POST', body: JSON.stringify({ to: 'someone-else@example.com' }) })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).data.via, 'hostinger')
  assert.deepEqual(sent.to, ['maker@example.invalid'])
  assert.match(sent.subject, /^\[Test\] /)

  mailbox = false
  assert.equal((await req(`/campaigns/${CAMPAIGN}/test`, { method: 'POST', body: '{}' })).status, 429)
  org = false
  assert.equal((await req(`/campaigns/${CAMPAIGN}/test`, { method: 'POST', body: '{}' })).status, 429)
})

test('test send: a mailbox not allowed for campaigns is refused before anything is spent', async () => {
  rpc.em_get_campaign = async () => Response.json({ ...campaign, sender_account_id: HOST_BOX })
  rpc.em_access = async () => Response.json({ ...hostSender, status: 'connected', campaign_sender: false })
  rpc.em_take_budget = async () => { throw new Error('must not spend') }
  assert.equal((await req(`/campaigns/${CAMPAIGN}/test`, { method: 'POST', body: '{}' })).status, 409)
  assert.equal(sends('https://api.mail.hostinger.com/').length, 0)
})

test('allowing a mailbox to send campaigns needs a limit; the database decides who may', async () => {
  let args
  rpc.em_set_campaign_sender = async (a) => { args = a; return Response.json({ id: HOST_BOX, provider: 'hostinger', campaign_sender: true, campaign_daily_cap: 40 }) }
  for (const body of [{ enabled: true }, { enabled: true, daily_cap: 0 }, { enabled: true, daily_cap: 5000 }, { enabled: 'yes' }]) {
    assert.equal((await req(`/accounts/${HOST_BOX}/campaign-sender`, { method: 'PUT', body: JSON.stringify(body) })).status, 400, JSON.stringify(body))
  }
  assert.equal(args, undefined)
  const res = await req(`/accounts/${HOST_BOX}/campaign-sender`, { method: 'PUT', body: JSON.stringify({ enabled: true, daily_cap: 40 }) })
  assert.equal(res.status, 200)
  assert.equal(args.p_daily_cap, 40)
  assert.equal(args.p_enabled, true)
  assert.equal(args.p_actor, USER)
})

test('"send next batch" needs a campaign permission and runs one bounded batch', async () => {
  access.permissions = { 'email_inbox.view': 'all' }
  assert.equal((await req('/campaigns/dispatch', { method: 'POST', body: '{}' })).status, 403)
  access.permissions = { 'email_campaigns.approve': 'all' }
  rpc.em_claim_campaign_batch = async () => Response.json(null)
  const res = await req('/campaigns/dispatch', { method: 'POST', body: '{}' })
  assert.equal(res.status, 200)
  assert.deepEqual((await res.json()).data, { idle: true })
})
