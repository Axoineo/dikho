import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApiApp } from '../src/api/app.js'
import { sendEmail, activeProvider, deliveryStatus } from '../src/api/services/email/delivery.js'
import { verifySnsMessage, stringToSign, spkiFromCertificate, derFromPem, normalizeSesEvent, snsUrlAllowed } from '../src/api/services/email/sns.js'
import {
  buildCampaignMessage, fillVariables, unknownVariables, unsubscribeUrl, verifyUnsubscribe, dispatchCampaignBatch, campaignReadiness,
} from '../src/api/services/email/campaigns.js'
import { fromBase64 } from '../src/api/services/email/crypto.js'

// Amazon SES delivery, SNS event verification, campaigns and unsubscribe.
// Every outbound request is answered by a fake. Synthetic data only.

const KEY = Buffer.alloc(32, 5).toString('base64')
const TOPIC = 'arn:aws:sns:ap-south-1:000000000000:dikho-ses-events'
const ses = {
  AWS_SES_REGION: 'ap-south-1', AWS_SES_ACCESS_KEY_ID: 'SYNTHETICKEYID000000', AWS_SES_SECRET_ACCESS_KEY: 'synthetic-secret-key',
  AWS_SES_CONFIGURATION_SET: 'dikho-events', EMAIL_SES_SEND_ENABLED: 'true', EMAIL_FROM_ADDRESS: 'noreply@dikho.example',
}
const env = {
  ...ses, EMAIL_HUB_ENABLED: 'true', EMAIL_TOKEN_KEY: KEY, API_PUBLIC_URL: 'https://api.example.invalid', EMAIL_DAILY_CAP: '100',
  EMAIL_CAMPAIGN_SENDERS: 'news@dikho.example', AWS_SNS_TOPIC_ARN: TOPIC,
  SUPABASE_URL: 'https://db.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', SUPABASE_ANON_KEY: 'synthetic-anon',
}

let calls
let handlers
beforeEach((t) => {
  calls = []
  handlers = { rpc: {} }
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const req = input instanceof Request ? input : null
    const url = String(req ? req.url : input)
    const body = req ? await req.clone().text() : options.body
    const headers = req ? Object.fromEntries(req.headers) : options.headers ?? {}
    calls.push({ url, body, headers, method: req ? req.method : options.method ?? 'GET' })
    const m = url.match(/\/rest\/v1\/rpc\/(\w+)$/)
    if (m) {
      const h = handlers.rpc[m[1]]
      if (!h) throw new Error(`unexpected rpc ${m[1]}`)
      return h(JSON.parse(body))
    }
    if (url.startsWith('https://email.ap-south-1.amazonaws.com/')) return handlers.ses(JSON.parse(body), headers)
    if (url.startsWith('https://api.brevo.com/')) return handlers.brevo(JSON.parse(body))
    if (handlers.other) return handlers.other(url, options)
    throw new Error(`unexpected request ${url}`)
  })
})

// ── Delivery service ─────────────────────────────────────────────────────────
test('provider choice: SES when ready, Brevo only as the legacy fallback, nothing otherwise', () => {
  assert.equal(activeProvider(ses), 'ses')
  assert.equal(activeProvider({ ...ses, EMAIL_SES_SEND_ENABLED: 'false' }), null)
  assert.equal(activeProvider({ ...ses, EMAIL_SES_SEND_ENABLED: 'false', BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'a@dikho.example' }), 'brevo')
  assert.equal(activeProvider({ BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'a@dikho.example', EMAIL_PROVIDER: 'ses' }), null, 'forced SES that is not ready sends nothing')
  const status = deliveryStatus(ses)
  assert.equal(status.provider, 'ses')
  assert.doesNotMatch(JSON.stringify(status), /SYNTHETICKEYID|synthetic-secret/)
})

test('SES: signed v2 request with configuration set, headers and tags', async () => {
  let seen
  handlers.ses = async (body, headers) => { seen = { body, headers }; return Response.json({ MessageId: 'ses-1' }) }
  const r = await sendEmail(ses, {
    to: [{ email: 'client@example.com', name: 'Client' }], subject: 'Hello', html: '<p>Hi</p>', text: 'Hi',
    headers: { 'List-Unsubscribe': '<https://x.example/u>' }, tags: { purpose: 'marketing', campaign: 'c-1', 'bad tag!': 'x' },
  })
  assert.deepEqual(r, { ok: true, provider: 'ses', messageId: 'ses-1' })
  assert.equal(calls[0].url, 'https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails')
  assert.match(seen.headers.authorization, /^AWS4-HMAC-SHA256 Credential=SYNTHETICKEYID000000\/\d{8}\/ap-south-1\/ses\/aws4_request/)
  assert.equal(seen.body.FromEmailAddress, '"Dikho" <noreply@dikho.example>')
  assert.equal(seen.body.ConfigurationSetName, 'dikho-events')
  assert.deepEqual(seen.body.Content.Simple.Headers, [{ Name: 'List-Unsubscribe', Value: '<https://x.example/u>' }])
  assert.deepEqual(seen.body.EmailTags, [{ Name: 'purpose', Value: 'marketing' }, { Name: 'campaign', Value: 'c-1' }])
})

test('SES: 5xx and timeouts are "uncertain" and never retried; throttling is retryable', async () => {
  handlers.ses = async () => new Response('{}', { status: 500 })
  let r = await sendEmail(ses, { to: [{ email: 'a@example.com' }], subject: 'S', html: 'x' })
  assert.equal(r.uncertain, true)
  assert.equal(calls.length, 1, 'aws4fetch retries are disabled')
  handlers.ses = async () => { throw new TypeError('connection reset') }
  r = await sendEmail(ses, { to: [{ email: 'a@example.com' }], subject: 'S', html: 'x' })
  assert.equal(r.uncertain, true)
  handlers.ses = async () => new Response(JSON.stringify({ message: 'Maximum sending rate exceeded.' }), { status: 429, headers: { 'x-amzn-ErrorType': 'TooManyRequestsException' } })
  r = await sendEmail(ses, { to: [{ email: 'a@example.com' }], subject: 'S', html: 'x' })
  assert.equal(r.retryable, true)
  handlers.ses = async () => new Response('{}', { status: 400, headers: { 'x-amzn-ErrorType': 'MessageRejected:http' } })
  r = await sendEmail(ses, { to: [{ email: 'a@example.com' }], subject: 'S', html: 'x' })
  assert.equal(r.ok, false)
  assert.match(r.reason, /MessageRejected/)
})

test('invalid messages never reach a provider', async () => {
  for (const message of [
    { to: [], subject: 'S', html: 'x' },
    { to: [{ email: 'not an address' }], subject: 'S', html: 'x' },
    { to: [{ email: 'a@example.com' }], subject: 'S\r\nBcc: x@example.com', html: 'x' },
    { to: [{ email: 'a@example.com' }], subject: 'S', html: 'x', headers: { 'X-Ok': 'line\nbreak' } },
  ]) {
    assert.equal((await sendEmail(ses, message)).ok, false)
  }
  assert.equal(calls.length, 0)
})

test('the staff welcome email keeps working through Brevo while SES is off', async () => {
  const { sendWelcome, welcomeChannelFor } = await import('../src/api/services/staffWelcome.js')
  const brevoEnv = { BREVO_API_KEY: 'synthetic', BREVO_SENDER_EMAIL: 'hello@dikho.example', APP_URL: 'https://app.example.invalid' }
  assert.equal(welcomeChannelFor(brevoEnv, { email: 'new@example.com' }), 'email')
  let seen
  handlers.brevo = async (body) => { seen = body; return Response.json({ messageId: '<b@x>' }, { status: 201 }) }
  assert.deepEqual(await sendWelcome(brevoEnv, 'email', { email: 'new@example.com', fullName: 'New Person' }), { ok: true })
  assert.deepEqual(seen.sender, { name: 'Dikho', email: 'hello@dikho.example' })
  assert.equal(seen.subject, 'You have been added to Dikho CRM')
  assert.match(seen.htmlContent, /Hi New,/)
  assert.equal(welcomeChannelFor({}, { email: 'new@example.com' }), null, 'no provider, no email channel')
})

// ── SNS verification ─────────────────────────────────────────────────────────
async function keyPair() {
  return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
}
async function signed(message, privateKey, version = '2') {
  const hash = version === '2' ? 'SHA-256' : 'SHA-1'
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey)
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['sign'])
  const full = { SignatureVersion: version, SigningCertURL: 'https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-abc.pem', ...message }
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(stringToSign(full)))
  return { ...full, Signature: Buffer.from(sig).toString('base64') }
}
const notification = (over = {}) => ({
  Type: 'Notification', MessageId: '22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324', TopicArn: TOPIC,
  Message: JSON.stringify({ eventType: 'Bounce', mail: { messageId: 'ses-1' }, bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'gone@example.com' }] } }),
  Timestamp: new Date().toISOString(), ...over,
})

test('SNS: genuine messages pass, in both signature versions', async () => {
  const { publicKey, privateKey } = await keyPair()
  const spki = await crypto.subtle.exportKey('spki', publicKey)
  const getKey = (url, hash) => crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify'])
  assert.deepEqual(await verifySnsMessage(env, await signed(notification(), privateKey, '2'), { getKey }), { ok: true })
  assert.deepEqual(await verifySnsMessage(env, await signed(notification({ Subject: 'Amazon SES Email Event Notification' }), privateKey, '1'), { getKey }), { ok: true })
  const confirm = await signed({ Type: 'SubscriptionConfirmation', MessageId: 'm', TopicArn: TOPIC, Message: 'confirm', Token: 't',
    SubscribeURL: 'https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&Token=t', Timestamp: new Date().toISOString() }, privateKey)
  assert.deepEqual(await verifySnsMessage(env, confirm, { getKey }), { ok: true })
})

test('SNS: forged, foreign, stale and malformed messages are refused', async () => {
  const { publicKey, privateKey } = await keyPair()
  const spki = await crypto.subtle.exportKey('spki', publicKey)
  const getKey = (url, hash) => crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify'])
  const good = await signed(notification(), privateKey)
  const cases = [
    [{ ...good, Message: good.Message.replace('Permanent', 'Transient') }, 'signature'],
    [await signed(notification({ TopicArn: 'arn:aws:sns:ap-south-1:999999999999:other' }), privateKey), 'topic'],
    [{ ...good, SigningCertURL: 'http://sns.ap-south-1.amazonaws.com/x.pem' }, 'cert_url'],
    [{ ...good, SigningCertURL: 'https://sns.ap-south-1.amazonaws.com.evil.example/x.pem' }, 'cert_url'],
    [{ ...good, SigningCertURL: 'https://evil.example/sns.ap-south-1.amazonaws.com/x.pem' }, 'cert_url'],
    [await signed(notification({ Timestamp: new Date(Date.now() - 2 * 3600_000).toISOString() }), privateKey), 'stale'],
    [{ ...good, SignatureVersion: '3' }, 'signature_version'],
    [{ ...good, Type: 'Other' }, 'type'],
    [{ ...good, Signature: undefined }, 'shape'],
  ]
  for (const [message, reason] of cases) {
    assert.equal((await verifySnsMessage(env, message, { getKey })).reason, reason)
  }
  assert.equal((await verifySnsMessage({ ...env, AWS_SNS_TOPIC_ARN: '' }, good, { getKey })).reason, 'not_configured')
  assert.equal(snsUrlAllowed('https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription'), true)
  assert.equal(snsUrlAllowed('https://sns.us-east-1.amazonaws.com:8443/'), false)
})

test('the public key is read from a real X.509 certificate', async () => {
  const der = derFromPem(readFileSync(new URL('./fixtures/sns-synthetic-cert.pem', import.meta.url), 'utf8'))
  const spki = spkiFromCertificate(der)
  const expected = fromBase64(readFileSync(new URL('./fixtures/sns-synthetic-cert.pubkey.pem', import.meta.url), 'utf8')
    .replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  assert.deepEqual(Buffer.from(spki), Buffer.from(expected))
  await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  assert.throws(() => spkiFromCertificate(new Uint8Array([0x30, 0x82, 0xff])))
})

test('SES events are normalized without keeping addresses in the event detail', () => {
  const e = normalizeSesEvent('n-1', { eventType: 'Bounce', mail: { messageId: 'ses-1', timestamp: '2026-10-21T10:00:00Z', tags: { campaign: ['c-1'] } },
    bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'gone@example.com' }], timestamp: '2026-10-21T10:00:05Z' } })
  assert.equal(e.event_type, 'bounce')
  assert.equal(e.permanent, true)
  assert.deepEqual(e.recipients, ['gone@example.com'])
  assert.equal(e.occurred_at, '2026-10-21T10:00:05Z')
  assert.doesNotMatch(JSON.stringify(e.detail), /@/)
  assert.equal(normalizeSesEvent('n-2', { eventType: 'Complaint', mail: {}, complaint: { complainedRecipients: [{ emailAddress: 'c@example.com' }] } }).event_type, 'complaint')
  assert.equal(normalizeSesEvent('n-3', { notificationType: 'Delivery', mail: {}, delivery: { recipients: ['d@example.com'] } }).event_type, 'delivery')
  assert.equal(normalizeSesEvent('n-4', { eventType: 'Open', mail: {} }).event_type, 'other')
})

test('SES webhook end to end with a real certificate: recorded once, forged refused', async (t) => {
  let dir
  try {
    dir = mkdtempSync(join(tmpdir(), 'sns-'))
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'),
      '-days', '1', '-subj', '/CN=sns.test'], { stdio: 'ignore' })
  } catch {
    t.skip('openssl is not available')
    return
  }
  const cert = readFileSync(join(dir, 'c.pem'), 'utf8')
  const pkcs8 = readFileSync(join(dir, 'k.pem'), 'utf8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  rmSync(dir, { recursive: true, force: true })
  const privateKey = await crypto.subtle.importKey('pkcs8', fromBase64(pkcs8), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['sign'])
  handlers.other = async (url) => (url.endsWith('.pem') ? new Response(cert) : new Response('', { status: 404 }))
  const recorded = []
  handlers.rpc.em_record_delivery_event = async (args) => { recorded.push(args.p_event); return Response.json(recorded.length === 1 ? 'recorded' : 'duplicate') }

  const app = createApiApp()
  const post = (message, extra = {}) => app.request('/api/email/webhooks/ses', { method: 'POST', body: JSON.stringify(message) }, { ...env, ...extra })
  const message = await signed(notification(), privateKey)
  assert.equal((await post(message)).status, 204)
  assert.equal(recorded[0].event_type, 'bounce')
  assert.deepEqual(recorded[0].recipients, ['gone@example.com'])
  assert.equal((await post(message)).status, 204, 'a redelivery is acknowledged (and recorded as a duplicate)')
  assert.equal((await post({ ...message, Message: message.Message.replace('ses-1', 'ses-2') })).status, 403, 'forged content refused')
  assert.equal(recorded.length, 2)
  assert.equal((await post(message, { EMAIL_HUB_ENABLED: 'false' })).status, 204, 'events still land when the module is switched off')
})

// ── Campaign content and unsubscribe ─────────────────────────────────────────
test('variables: only the allowed names, values escaped in HTML', () => {
  assert.deepEqual(unknownVariables(['Hi {{first_name}}', '{{ company }}', '{{password}} {{env}}']), ['password', 'env'])
  assert.equal(fillVariables('<p>Hi {{first_name}}</p>', { first_name: '<script>x</script>' }, { html: true }), '<p>Hi &lt;script&gt;x&lt;/script&gt;</p>')
  assert.equal(fillVariables('Hi {{name}}', { name: 'A\r\nBcc: x' }), 'Hi A Bcc: x')
})

test('campaign messages carry a signed unsubscribe link and one-click headers', async () => {
  const recipient = { id: 'dddddddd-1111-4111-8111-111111111111', email: 'sia@example.com', name: 'Sia <b>Rao</b>', company: 'Acme' }
  const m = await buildCampaignMessage(env, { id: 'c-1', from_name: 'Dikho', from_email: 'news@dikho.example', subject: 'Hi {{first_name}}', preheader: 'Offer', html: '<p>Hello {{name}}</p>', text_body: '' }, recipient)
  const link = await unsubscribeUrl(env, recipient.id)
  assert.match(link, /^https:\/\/api\.example\.invalid\/api\/email\/unsubscribe\?r=dddddddd-1111-4111-8111-111111111111&s=[A-Za-z0-9_-]{43}$/)
  assert.equal(m.headers['List-Unsubscribe'], `<${link}>`)
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  assert.equal(m.subject, 'Hi Sia')
  assert.match(m.html, /Hello Sia &lt;b&gt;Rao&lt;\/b&gt;/)
  assert.match(m.text, /Unsubscribe: https:\/\/api\.example\.invalid/)
  const sig = new URL(link).searchParams.get('s')
  assert.equal(await verifyUnsubscribe(env, recipient.id, sig), true)
  assert.equal(await verifyUnsubscribe(env, 'eeeeeeee-1111-4111-8111-111111111111', sig), false, 'bound to the recipient')
  const rotated = { ...env, EMAIL_TOKEN_KEY: Buffer.alloc(32, 6).toString('base64') }
  assert.equal(await verifyUnsubscribe(rotated, recipient.id, sig), false, 'another key does not verify')
  assert.equal(await verifyUnsubscribe({ ...rotated, EMAIL_TOKEN_KEY_PREVIOUS: env.EMAIL_TOKEN_KEY }, recipient.id, sig), true,
    'links sent before a rotation keep working while the previous key is set')
})

test('unsubscribe: GET only asks, POST records, a bad link changes nothing, works with the module off', async () => {
  const app = createApiApp()
  const id = 'dddddddd-1111-4111-8111-111111111111'
  const link = await unsubscribeUrl(env, id)
  const path = new URL(link).pathname + new URL(link).search
  let unsubscribed = 0
  handlers.rpc.em_unsubscribe_recipient = async (args) => { assert.equal(args.p_recipient, id); unsubscribed++; return Response.json({ email: 'x' }) }

  const get = await app.request(path, {}, env)
  assert.equal(get.status, 200)
  assert.match(await get.text(), /<form method="post"/)
  assert.equal(unsubscribed, 0, 'a link preview does not unsubscribe')
  assert.match(get.headers.get('Content-Security-Policy'), /form-action 'self'/)

  const oneClick = await app.request(path, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, { ...env, EMAIL_HUB_ENABLED: 'false' })
  assert.equal(oneClick.status, 200)
  assert.equal(unsubscribed, 1)
  const bad = await app.request(path.replace(/s=[^&]+/, `s=${'A'.repeat(43)}`), { method: 'POST' }, env)
  assert.equal(bad.status, 400)
  assert.equal(unsubscribed, 1)
})

test('dispatch: one batch, results recorded as sent, retry, uncertain or failed', async () => {
  let finished
  handlers.rpc.em_claim_campaign_batch = async (args) => {
    assert.equal(args.p_daily_cap, 100)
    return Response.json({
      campaign: { id: 'c-1', from_name: 'Dikho', from_email: 'news@dikho.example', subject: 'Hi', preheader: '', html: '<p>x</p>', text_body: '' },
      recipients: [
        { id: 'r0000000-0000-4000-8000-000000000001', email: 'a@example.com', name: 'A' },
        { id: 'r0000000-0000-4000-8000-000000000002', email: 'b@example.com', name: 'B' },
        { id: 'r0000000-0000-4000-8000-000000000003', email: 'c@example.com', name: 'C' },
      ],
    })
  }
  handlers.rpc.em_finish_campaign_batch = async (args) => { finished = args.p_results; return new Response(null, { status: 204 }) }
  handlers.ses = async (body) => {
    const to = body.Destination.ToAddresses[0]
    if (to === 'a@example.com') return Response.json({ MessageId: 'ses-a' })
    if (to === 'b@example.com') return new Response('{}', { status: 429 })
    throw new TypeError('timeout')
  }
  const summary = await dispatchCampaignBatch(env)
  assert.deepEqual(summary, { sent: 1, failed: 0, uncertain: 1, retry: 1 })
  assert.deepEqual(finished.map((r) => [r.status, r.message_id ?? null]), [['sent', 'ses-a'], ['pending', null], ['uncertain', null]])
  assert.equal(calls.filter((c) => c.url.includes('amazonaws')).length, 3, 'one attempt per recipient')

  // A sender that is not verified for campaigns sends nothing.
  handlers.rpc.em_claim_campaign_batch = async () => Response.json({
    campaign: { id: 'c-2', from_email: 'ceo@dikho.example', subject: 'x', html: 'x' }, recipients: [{ id: 'r0000000-0000-4000-8000-000000000004', email: 'a@example.com' }],
  })
  calls = []
  await dispatchCampaignBatch(env)
  assert.equal(finished[0].status, 'failed')
  assert.equal(calls.filter((c) => c.url.includes('amazonaws')).length, 0)
})

test('dispatch does nothing until a daily cap, the unsubscribe address and the key are set', async () => {
  for (const missing of ['EMAIL_DAILY_CAP', 'API_PUBLIC_URL', 'EMAIL_TOKEN_KEY']) {
    const partial = { ...env, [missing]: '' }
    assert.equal(campaignReadiness(partial).ready, false, missing)
    assert.deepEqual(await dispatchCampaignBatch(partial), { skipped: 'not_ready' })
  }
  assert.equal(calls.length, 0)
})

test('without SES, dispatch claims only campaigns that have a sender mailbox', async () => {
  const claims = []
  handlers.rpc.em_claim_campaign_batch = async (args) => { claims.push(args); return Response.json(null) }
  const noSes = { ...env, EMAIL_SES_SEND_ENABLED: '' }
  assert.equal(campaignReadiness(noSes).ready, true)
  assert.equal(campaignReadiness(noSes).ses, false)
  assert.deepEqual(await dispatchCampaignBatch(noSes), { idle: true })
  assert.deepEqual(await dispatchCampaignBatch(env), { idle: true })
  assert.deepEqual(claims.map((a) => a.p_allow_ses), [false, true])
  assert.equal(calls.filter((c) => c.url.includes('amazonaws')).length, 0)
})

test('jobs endpoint exists only with a strong secret, and needs it', async () => {
  const app = createApiApp()
  const secret = 's'.repeat(40)
  handlers.rpc.em_claim_campaign_batch = async () => Response.json(null)
  handlers.rpc.em_sync_due = async () => Response.json([])
  const run = (auth, extra) => app.request('/api/email/jobs/run', { method: 'POST', headers: auth ? { Authorization: auth } : {} }, { ...env, ...extra })
  assert.equal((await run(`Bearer ${secret}`)).status, 404, 'no secret configured')
  assert.equal((await run('Bearer short', { EMAIL_JOBS_SECRET: 'short' })).status, 404, 'weak secret refused')
  assert.equal((await run('Bearer wrong', { EMAIL_JOBS_SECRET: secret })).status, 404)
  const ok = await run(`Bearer ${secret}`, { EMAIL_JOBS_SECRET: secret })
  assert.equal(ok.status, 200)
  assert.deepEqual((await ok.json()).data, { campaigns: { idle: true }, synced: false })
})

// ── Campaign routes ──────────────────────────────────────────────────────────
function staffApp(permissions, email = 'maker@dikho.example') {
  handlers.rpc.my_access = async () => Response.json({ status: 'active', user_id: 'a1111111-1111-4111-8111-111111111111', email, permissions })
  const app = createApiApp()
  return (path, init = {}, extra = {}) => app.request(`/api/email${path}`, {
    ...init, headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  }, { ...env, ...extra })
}
const CAMPAIGN = 'cccccccc-1111-4111-8111-111111111111'

test('campaign content is sanitized and only allowed variables are accepted', async () => {
  const req = staffApp({ 'email_campaigns.create': 'all' })
  let saved
  handlers.rpc.em_save_campaign = async (args) => { saved = args.p_fields; return Response.json({ id: CAMPAIGN }) }
  let res = await req('/campaigns', { method: 'POST', body: JSON.stringify({ name: 'N', subject: 'Hi {{first_name}}', html: '<p onclick="x()">Hi</p><script>bad()</script>' }) })
  assert.equal(res.status, 201)
  assert.equal(saved.html, '<p>Hi</p>')
  assert.equal(saved.text_body, 'Hi')
  res = await req('/campaigns', { method: 'POST', body: JSON.stringify({ name: 'N', html: '{{api_key}}' }) })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error.message, /Unknown variable: \{\{api_key\}\}/)
  res = await req('/campaigns', { method: 'POST', body: JSON.stringify({ name: 'N', subject: 'a\nb' }) })
  assert.equal(res.status, 400)
  res = await req('/campaigns', { method: 'POST', body: JSON.stringify({ name: 'N', audience: { sources: ['client', 'everyone'], media: ['1', 'x;drop'] } }) })
  assert.equal(res.status, 201)
  assert.deepEqual(saved.audience.sources, ['client'])
  assert.deepEqual(saved.audience.media, ['1'])
})

test('decisions need the approve permission, the reviewed hash and, for a rejection, a reason', async () => {
  let req = staffApp({ 'email_campaigns.create': 'all' })
  assert.equal((await req(`/campaigns/${CAMPAIGN}/decision`, { method: 'POST', body: JSON.stringify({ approve: true, hash: 'a'.repeat(64) }) })).status, 403)
  req = staffApp({ 'email_campaigns.approve': 'all' })
  handlers.rpc.em_decide_campaign = async (args) => Response.json({ id: CAMPAIGN, status: args.p_approve ? 'approved' : 'rejected' })
  assert.equal((await req(`/campaigns/${CAMPAIGN}/decision`, { method: 'POST', body: JSON.stringify({ approve: true }) })).status, 400)
  assert.equal((await req(`/campaigns/${CAMPAIGN}/decision`, { method: 'POST', body: JSON.stringify({ approve: false, hash: 'a'.repeat(64) }) })).status, 400)
  assert.equal((await req(`/campaigns/${CAMPAIGN}/decision`, { method: 'POST', body: JSON.stringify({ approve: true, hash: 'a'.repeat(64) }) })).status, 200)
})

test('submitting needs a verified sender', async () => {
  const req = staffApp({ 'email_campaigns.create': 'all' })
  handlers.rpc.em_get_campaign = async () => Response.json({ id: CAMPAIGN, from_email: 'ceo@dikho.example' })
  handlers.rpc.em_submit_campaign = async () => { throw new Error('must not submit') }
  const res = await req(`/campaigns/${CAMPAIGN}/submit`, { method: 'POST', body: '{}' })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error.message, /verified sender/)
})

test('a test send goes only to the requester, through SES, within the budget', async () => {
  const req = staffApp({ 'email_campaigns.create': 'all' }, 'maker@dikho.example')
  handlers.rpc.em_get_campaign = async () => Response.json({ id: CAMPAIGN, from_email: 'news@dikho.example', from_name: 'Dikho', subject: 'Offer', html: '<p>Hi {{first_name}}</p>' })
  let budget = true
  handlers.rpc.em_take_budget = async () => Response.json(budget)
  let sent
  handlers.ses = async (body) => { sent = body; return Response.json({ MessageId: 'ses-test' }) }
  const res = await req(`/campaigns/${CAMPAIGN}/test`, { method: 'POST', body: JSON.stringify({ to: 'someone-else@example.com' }) })
  assert.equal(res.status, 200)
  assert.deepEqual(sent.Destination.ToAddresses, ['maker@dikho.example'])
  assert.equal(sent.Content.Simple.Subject.Data, '[Test] Offer')
  budget = false
  assert.equal((await req(`/campaigns/${CAMPAIGN}/test`, { method: 'POST', body: '{}' })).status, 429)
})

test('campaign previews: isolated page, sample values, real footer, permission re-checked', async () => {
  const { issueRenderTicket } = await import('../src/api/services/email/renderTicket.js')
  const app = createApiApp()
  let actorSeen
  handlers.rpc.em_get_campaign = async (args) => { actorSeen = args.p_actor; return Response.json({ id: CAMPAIGN, from_name: 'Dikho', subject: 'S', html: '<p>Hi {{first_name}}</p><img src="https://t.example/p.gif">' }) }
  const ticket = await issueRenderTicket(env, { userId: 'a1111111-1111-4111-8111-111111111111', threadId: CAMPAIGN, messageId: 'campaign' })
  const res = await app.request(`/api/email/preview/campaign/${CAMPAIGN}?t=${ticket}`, {}, env)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('Content-Security-Policy'), /^sandbox allow-scripts/)
  const page = await res.text()
  assert.match(page, /Hi Asha/)
  assert.match(page, /Unsubscribe/)
  assert.doesNotMatch(page, /t\.example/)
  assert.equal(actorSeen, 'a1111111-1111-4111-8111-111111111111')
  assert.equal((await app.request(`/api/email/preview/template/${CAMPAIGN}?t=${ticket}`, {}, env)).status, 403, 'a campaign ticket does not open a template')
})
