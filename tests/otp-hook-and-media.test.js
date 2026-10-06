import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import auth from '../src/api/routes/auth/index.js'
import media from '../src/api/routes/whatsapp/media.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'
import { signMediaTicket } from '../src/api/services/whatsapp/mediaTicket.js'

// Ephemeral keys, generated in memory and never printed or persisted.
const hookKey = randomBytes(32)
const appSecret = randomBytes(32).toString('hex')

const app = new Hono()
app.onError(errorHandler)
app.route('/auth', auth)
app.route('/media', media)

beforeEach((t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    throw new Error(`Unexpected request in isolated test: ${url}`)
  })
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
})

function signedHook(payload) {
  const body = JSON.stringify(payload)
  const id = 'synthetic-delivery'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', hookKey).update(`${id}.${timestamp}.${body}`).digest('base64')
  return {
    method: 'POST',
    body,
    headers: { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` },
  }
}

const hookEnv = {
  SUPABASE_SEND_SMS_HOOK_SECRET: `v1,whsec_${hookKey.toString('base64')}`,
  SUPABASE_URL: 'https://db.example.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
}

function hookFor(user) {
  return signedHook({ user: { phone: '919800000001', ...user }, sms: { otp: '123456' } })
}

test('the OTP hook asks the database, and sends nothing for someone who is not active staff', async () => {
  const asked = []
  fetch.mock.mockImplementation(async (url, options) => {
    asked.push({ url, body: JSON.parse(options.body) })
    return Response.json(false)
  })
  // app_metadata no longer decides anything, whatever it claims.
  for (const user of [
    { id: 'u1', app_metadata: { dikho_roles: ['admin'] } },
    { id: 'u2', user_metadata: { dikho_roles: ['admin'] } },
  ]) {
    const res = await app.request('/auth/whatsapp-otp', hookFor(user), hookEnv)
    assert.equal(res.status, 403)
  }
  assert.deepEqual(asked.map((a) => a.url), [
    'https://db.example.invalid/rest/v1/rpc/staff_is_active',
    'https://db.example.invalid/rest/v1/rpc/staff_is_active',
  ])
  assert.deepEqual(asked.map((a) => a.body.p_user), ['u1', 'u2'])
})

test('the OTP hook sends nothing without a user id, and fails closed when the database is unreachable', async () => {
  const noId = await app.request('/auth/whatsapp-otp', hookFor({}), hookEnv)
  assert.equal(noId.status, 403)
  assert.equal(fetch.mock.callCount(), 0)

  fetch.mock.mockImplementation(async () => { throw new Error('synthetic network failure') })
  const down = await app.request('/auth/whatsapp-otp', hookFor({ id: 'u1' }), hookEnv)
  assert.equal(down.status, 503)
  assert.equal(fetch.mock.callCount(), 1)
})

test('the OTP hook refuses unsigned and oversized requests before reading further', async () => {
  const unsigned = await app.request('/auth/whatsapp-otp', { method: 'POST', body: '{}' }, hookEnv)
  assert.equal(unsigned.status, 401)
  const huge = await app.request('/auth/whatsapp-otp', {
    method: 'POST', body: 'x', headers: { 'Content-Length': String(65 * 1024) },
  }, hookEnv)
  assert.equal(huge.status, 413)
  assert.equal(fetch.mock.callCount(), 0)
})

// In-memory stand-in for the R2 binding: get/head with optional range.
function bucket(objects) {
  const find = (key) => objects[key]
  return {
    async head(key) {
      const o = find(key)
      return o ? { size: o.bytes.length } : null
    },
    async get(key, options = {}) {
      const o = find(key)
      if (!o) return null
      const { offset = 0, length = o.bytes.length - offset } = options.range ?? {}
      return {
        size: o.bytes.length,
        body: o.bytes.slice(offset, offset + length),
        httpMetadata: { contentType: o.type },
        httpEtag: '"synthetic"',
      }
    },
  }
}

const mediaEnv = {
  WHATSAPP_APP_SECRET: appSecret,
  MEDIA: bucket({
    'day/photo': { type: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5]) },
    'day/page': { type: 'text/html', bytes: new TextEncoder().encode('<script>alert(1)</script>') },
    'day/vector': { type: 'image/svg+xml', bytes: new TextEncoder().encode('<svg onload="alert(1)"/>') },
  }),
}

test('media that a browser would execute is forced to download inside a sandbox', async () => {
  const t = encodeURIComponent(await signMediaTicket(appSecret))
  for (const key of ['day/page', 'day/vector']) {
    const res = await app.request(`/media/${key}?t=${t}`, {}, mediaEnv)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Content-Disposition'), 'attachment')
    assert.match(res.headers.get('Content-Security-Policy'), /^sandbox/)
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff')
  }
  const photo = await app.request(`/media/day/photo?t=${t}`, {}, mediaEnv)
  assert.equal(photo.headers.get('Content-Disposition'), null)
  assert.equal(photo.headers.get('X-Content-Type-Options'), 'nosniff')
})

test('media requires a ticket, and bad ranges are unsatisfiable rather than errors', async () => {
  assert.equal((await app.request('/media/day/photo', {}, mediaEnv)).status, 401)
  const t = encodeURIComponent(await signMediaTicket(appSecret))
  const ranged = await app.request(`/media/day/photo?t=${t}`, { headers: { Range: 'bytes=2-100' } }, mediaEnv)
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get('Content-Range'), 'bytes 2-7/8')
  for (const range of ['bytes=5-2', 'bytes=8-', 'bytes=99-120']) {
    const res = await app.request(`/media/day/photo?t=${t}`, { headers: { Range: range } }, mediaEnv)
    assert.equal(res.status, 416, range)
  }
})
