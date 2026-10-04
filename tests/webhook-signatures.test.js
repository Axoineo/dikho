import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import { verifyMetaSignature } from '../src/api/services/whatsapp/verifyMetaSignature.js'
import { verifyStandardWebhook } from '../src/api/utils/verifyWebhook.js'

const nowSeconds = 1_800_000_000
const metaSecret = randomBytes(32).toString('hex')
const hookKey = randomBytes(32)
const hookSecret = `v1,whsec_${hookKey.toString('base64')}`
const body = '{"event":"synthetic-test","count":1}'

beforeEach((t) => {
  t.mock.method(Date, 'now', () => nowSeconds * 1000)
})

function metaSignature(payload = body) {
  return `sha256=${createHmac('sha256', metaSecret).update(payload).digest('hex')}`
}

function hookHeaders({ timestamp = String(nowSeconds), id = 'synthetic-delivery', payload = body } = {}) {
  const signature = createHmac('sha256', hookKey).update(`${id}.${timestamp}.${payload}`).digest('base64')
  return new Headers({
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  })
}

test('Meta accepts a signature independently computed over the exact raw body', async () => {
  assert.equal(await verifyMetaSignature(body, metaSignature(), metaSecret), true)
})

test('Meta rejects modified content, whitespace changes and a wrong signing key', async () => {
  assert.equal(await verifyMetaSignature(body.replace(':1', ':2'), metaSignature(), metaSecret), false)
  assert.equal(await verifyMetaSignature(`${body}\n`, metaSignature(), metaSecret), false)
  assert.equal(await verifyMetaSignature(body, metaSignature(), randomBytes(32).toString('hex')), false)
})

test('Meta rejects missing configuration and missing or malformed signature headers', async () => {
  for (const header of [undefined, '', 'sha1=invalid', 'sha256=', 'sha256=not-hex', `sha256=${'0'.repeat(64)}`]) {
    assert.equal(await verifyMetaSignature(body, header, metaSecret), false)
  }
  assert.equal(await verifyMetaSignature(body, metaSignature(), ''), false)
})

test('Standard Webhooks accepts a valid signature and a rotated multi-signature header', async () => {
  const headers = hookHeaders()
  assert.deepEqual(await verifyStandardWebhook({ secret: hookSecret, headers, body }), { ok: true })
  headers.set('webhook-signature', `v1,invalid ${headers.get('webhook-signature')}`)
  assert.deepEqual(await verifyStandardWebhook({ secret: hookSecret, headers, body }), { ok: true })
})

test('Standard Webhooks binds the signature to raw body, event ID and timestamp', async () => {
  const validHeaders = hookHeaders()
  const changedId = new Headers(validHeaders)
  changedId.set('webhook-id', 'another-synthetic-delivery')
  const changedTimestamp = new Headers(validHeaders)
  changedTimestamp.set('webhook-timestamp', String(nowSeconds + 1))
  for (const [headers, payload] of [[validHeaders, `${body}\n`], [changedId, body], [changedTimestamp, body]]) {
    const result = await verifyStandardWebhook({ secret: hookSecret, headers, body: payload })
    assert.deepEqual(result, { ok: false, reason: 'signature mismatch' })
  }
})

test('Standard Webhooks rejects signed deliveries outside its past and future tolerance', async () => {
  for (const offset of [-301, 301]) {
    const headers = hookHeaders({ timestamp: String(nowSeconds + offset) })
    const result = await verifyStandardWebhook({ secret: hookSecret, headers, body })
    assert.deepEqual(result, { ok: false, reason: 'timestamp outside tolerance' })
  }
})

test('Standard Webhooks accepts the tolerance boundary and honors a tighter tolerance', async () => {
  const headers = hookHeaders({ timestamp: String(nowSeconds - 300) })
  assert.deepEqual(await verifyStandardWebhook({ secret: hookSecret, headers, body }), { ok: true })
  assert.deepEqual(await verifyStandardWebhook({ secret: hookSecret, headers, body, toleranceSeconds: 60 }), {
    ok: false, reason: 'timestamp outside tolerance',
  })
})

test('Standard Webhooks rejects missing configuration, headers and nonfinite timestamps', async () => {
  assert.deepEqual(await verifyStandardWebhook({ secret: '', headers: hookHeaders(), body }), {
    ok: false, reason: 'hook secret not configured',
  })
  for (const name of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) {
    const headers = hookHeaders()
    headers.delete(name)
    assert.deepEqual(await verifyStandardWebhook({ secret: hookSecret, headers, body }), {
      ok: false, reason: 'missing signature headers',
    })
  }
  for (const timestamp of ['NaN', 'Infinity', 'not-a-time']) {
    assert.deepEqual(await verifyStandardWebhook({ secret: hookSecret, headers: hookHeaders({ timestamp }), body }), {
      ok: false, reason: 'invalid timestamp',
    })
  }
})

test('Standard Webhooks rejects a malformed signature and a different valid-format key', async () => {
  const headers = hookHeaders()
  headers.set('webhook-signature', 'v1,malformed')
  assert.deepEqual(await verifyStandardWebhook({ secret: hookSecret, headers, body }), {
    ok: false, reason: 'signature mismatch',
  })
  assert.deepEqual(await verifyStandardWebhook({ secret: `v1,whsec_${randomBytes(32).toString('base64')}`, headers: hookHeaders(), body }), {
    ok: false, reason: 'signature mismatch',
  })
})
