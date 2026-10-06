import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import publicRoutes from '../src/api/routes/public/index.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'

const env = {
  TURNSTILE_SECRET: 'synthetic-verification-secret',
  TURNSTILE_HOSTNAMES: 'forms.example.invalid',
  SUPABASE_URL: 'https://db.example.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
}

const app = new Hono()
app.onError(errorHandler)
app.route('/public', publicRoutes)

const PDF = new TextEncoder().encode('%PDF-1.7\nsynthetic document\n')
let calls

// Routes every outbound request by URL and records it. `overrides` replaces
// the default answer for one kind of call.
function upstream(overrides = {}) {
  calls = []
  return async (url, options = {}) => {
    const call = { url: String(url), method: options.method ?? 'GET', options }
    calls.push(call)
    if (call.url.startsWith('https://challenges.cloudflare.com/')) {
      return overrides.siteverify?.() ?? Response.json({ success: true, action: 'vendor-register', hostname: 'forms.example.invalid' })
    }
    if (call.url.startsWith(`${env.SUPABASE_URL}/storage/v1/object`)) {
      return overrides.storage?.(call) ?? Response.json({ Key: 'ok' })
    }
    if (call.url === `${env.SUPABASE_URL}/rest/v1/rpc/public_register_vendor`) {
      return overrides.rpc?.() ?? new Response('4242', { status: 200 })
    }
    throw new Error(`Unexpected request in isolated test: ${call.url}`)
  }
}

beforeEach((t) => {
  t.mock.method(globalThis, 'fetch', upstream())
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
})

function multipart(payload, document) {
  const form = new FormData()
  form.append('payload', JSON.stringify(payload))
  if (document) form.append('document', document.blob, document.name)
  return form
}

const submission = {
  'cf-turnstile-response': 'synthetic-token',
  vendor: {
    company_name: 'Synthetic Vendor LLP',
    vendor_document_file_path: 'vendors_documents/424242/someone-elses.pdf',
    vendor_document_file_name: 'forged.pdf',
  },
  address: { address: 'Synthetic Street' },
}

const rpcArgs = () => JSON.parse(calls.find((c) => c.url.includes('/rpc/')).options.body)

test('a verified submission stores the document under a server-chosen key and links it', async () => {
  const res = await app.request('/public/vendor', {
    method: 'POST',
    body: multipart(submission, { blob: new Blob([PDF], { type: 'image/png' }), name: '../GST cert.pdf' }),
  }, env)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { success: true, data: { id: 4242 } })

  assert.deepEqual(calls.map((c) => c.method), ['POST', 'POST', 'POST'])
  const upload = calls[1]
  const key = upload.url.slice(`${env.SUPABASE_URL}/storage/v1/object/Dikho/`.length)
  assert.match(key, /^vendors_documents\/public\/[0-9a-f-]{36}\.pdf$/)
  // The sniffed type wins over the browser's claim of image/png.
  assert.equal(upload.options.headers['Content-Type'], 'application/pdf')
  assert.equal(upload.options.headers['x-upsert'], 'false')
  assert.equal(upload.options.headers.Authorization, 'Bearer synthetic-service-key')

  const { p_vendor } = rpcArgs()
  assert.equal(p_vendor.vendor_document_file_path, key)
  assert.equal(p_vendor.vendor_document_file_name, 'GST cert.pdf')
  assert.equal(p_vendor.company_name, 'Synthetic Vendor LLP')
})

test('a JSON submission cannot point the vendor at an existing object', async () => {
  const res = await app.request('/public/vendor', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submission),
  }, env)
  assert.equal(res.status, 200)
  const { p_vendor } = rpcArgs()
  assert.equal(p_vendor.vendor_document_file_path, null)
  assert.equal(p_vendor.vendor_document_file_name, null)
  assert.equal(calls.some((c) => c.url.includes('/storage/')), false)
})

test('wrong, empty or disguised documents are refused before the Turnstile token is spent', async () => {
  for (const [blob, status] of [
    [new Blob(['<html><script>alert(1)</script></html>'], { type: 'application/pdf' }), 415],
    [new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/png' }), 415],
    [new Blob([new Uint8Array(0)], { type: 'application/pdf' }), 400],
    [new Blob([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], { type: 'image/gif' }), 415],
  ]) {
    const res = await app.request('/public/vendor', { method: 'POST', body: multipart(submission, { blob, name: 'x.pdf' }) }, env)
    assert.equal(res.status, status)
  }
  assert.equal(calls.length, 0)
})

test('oversized bodies are refused from the declared length without reading them', async () => {
  const res = await app.request('/public/vendor', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(11 * 1024 * 1024) },
    body: 'x',
  }, env)
  assert.equal(res.status, 413)
  const json = await app.request('/public/vendor', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(65 * 1024) }, body: '{}',
  }, env)
  assert.equal(json.status, 413)
  assert.equal(calls.length, 0)
})

test('a failed Turnstile check stores nothing and writes nothing', async (t) => {
  fetch.mock.mockImplementation(upstream({ siteverify: () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }) }))
  const res = await app.request('/public/vendor', {
    method: 'POST', body: multipart(submission, { blob: new Blob([PDF], { type: 'application/pdf' }), name: 'a.pdf' }),
  }, env)
  assert.equal(res.status, 403)
  assert.deepEqual(calls.map((c) => c.url.split('?')[0]), ['https://challenges.cloudflare.com/turnstile/v0/siteverify'])
  t.mock.reset()
})

test('a rejected registration removes the document it just stored', async () => {
  fetch.mock.mockImplementation(upstream({ rpc: () => Response.json({ code: 'P0001', message: 'company_name is required' }, { status: 400 }) }))
  const res = await app.request('/public/vendor', {
    method: 'POST', body: multipart(submission, { blob: new Blob([PDF], { type: 'application/pdf' }), name: 'a.pdf' }),
  }, env)
  assert.equal(res.status, 400)
  const key = calls[1].url.slice(`${env.SUPABASE_URL}/storage/v1/object/Dikho/`.length)
  const cleanup = calls.at(-1)
  assert.equal(cleanup.method, 'DELETE')
  assert.equal(cleanup.url, `${env.SUPABASE_URL}/storage/v1/object/Dikho`)
  assert.deepEqual(JSON.parse(cleanup.options.body), { prefixes: [key] })
})

test('a storage failure stops the registration before the database is touched', async () => {
  fetch.mock.mockImplementation(upstream({ storage: () => new Response('{}', { status: 413 }) }))
  const res = await app.request('/public/vendor', {
    method: 'POST', body: multipart(submission, { blob: new Blob([PDF], { type: 'application/pdf' }), name: 'a.pdf' }),
  }, env)
  assert.equal(res.status, 502)
  assert.equal(calls.some((c) => c.url.includes('/rpc/')), false)
})
