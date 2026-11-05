#!/usr/bin/env node
// Local stand-in for everything the Android app talks to, so device tests never
// touch production, send a real OTP or read real data. Synthetic records only.
//
//   :5199   the CRM SPA (a local build) plus /__probe.html, the native-hook page
//   :54321  fake Supabase Auth/PostgREST and fake API Worker
//   :8799   the real update handler from cloudflare-updater, with a test manifest
//
//   node dikho-mobile/tool/local-test/server.mjs --spa <dist dir> --updates <dir>
//
// Emulator access: adb reverse tcp:5199 tcp:5199 (likewise 54321 and 8799).
// The OTP is always 123456. GET :54321/__events lists what the app did and
// POST :54321/__expire-sessions revokes every session.

import { createReadStream, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { handleRequest } from '../../../cloudflare-updater/src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({ options: { spa: { type: 'string' }, updates: { type: 'string' } } })

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.apk': 'application/vnd.android.package-archive',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf',
}

const events = []
const log = (type, detail = {}) => { events.push({ at: new Date().toISOString(), type, ...detail }) }

/* ── Static files ──────────────────────────────────────────────────────── */

function sendFile(res, file) {
  const { size } = statSync(file)
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'no-cache' })
  createReadStream(file).pipe(res)
}

function underRoot(root, urlPath) {
  const file = normalize(join(root, decodeURIComponent(urlPath)))
  return file.startsWith(normalize(root)) ? file : null
}

// Set through :54321/__spa so tests can make the CRM's document misbehave.
let spaMode = 'ok'

createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost')
  if (pathname === '/__probe.html') return sendFile(res, join(here, 'probe.html'))
  if (spaMode === 'error') return res.writeHead(503, { 'Content-Type': 'text/html' }).end('<!doctype html><p>Down</p>')
  if (spaMode === 'hang') return undefined
  const file = values.spa && underRoot(values.spa, pathname)
  if (file && existsSync(file) && statSync(file).isFile()) return sendFile(res, file)
  if (values.spa && existsSync(join(values.spa, 'index.html'))) return sendFile(res, join(values.spa, 'index.html'))
  res.writeHead(404).end('SPA build not found')
}).listen(5199, '127.0.0.1')

/* ── Fake Supabase and API ─────────────────────────────────────────────── */

const USER = {
  id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
  email: 'owner@example.test', phone: '', app_metadata: { provider: 'email' }, user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const sessions = new Map()
let counter = 0

function issueSession() {
  counter += 1
  const exp = Math.floor(Date.now() / 1000) + 3600
  const access = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: USER.id, aud: 'authenticated', role: 'authenticated', session_id: `local-${counter}`, exp })}.local`
  const refresh = `local-refresh-${counter}`
  sessions.set(refresh, access)
  return { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, expires_at: exp, user: USER }
}

const liveToken = (req) => {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  return [...sessions.values()].includes(token)
}

const CLIENTS = [
  { id: 2, company_name: 'Example Traders', contact_person: 'Test Person', email: 'buyer@example.test', phone: '+910000000002', status: 'active', created_at: '2026-01-02T00:00:00Z' },
  { id: 1, company_name: 'Sample Media Works', contact_person: 'Another Person', email: 'media@example.test', phone: '+910000000001', status: 'active', created_at: '2026-01-01T00:00:00Z' },
]

const SALES_ORDERS = [{
  id: 1, order_number: 'SO-TEST-1', company: 'Example Traders', order_client_fullname: 'Test Person',
  order_date: '2026-01-02', order_status: 'Confirmed', sub_total: 1000, tax_total: 180, total: 1180,
}]

const SALES_ORDER_ITEMS = [{
  id: 1, sales_order_id: 1, name: 'Test billboard', hsn_sac: '998361', taxable_amount: 1000, tax_amount: 180,
  after_tax_amount: 1180, gst_type: 'GST 18%',
}]

const PERMISSIONS = Object.fromEntries(['clients.view', 'leads.view', 'vendors.view', 'sales_orders.view', 'purchase_orders.view', 'users.view', 'email_inbox.view', 'inbox.view', 'campaigns.view', 'wa_contacts.view', 'wa_templates.view'].map((key) => [key, 'all']))

const CORS = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*',
  'Access-Control-Expose-Headers': '*',
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS, ...headers }).end(body === undefined ? undefined : JSON.stringify(body))
}

function fakePdf(res) {
  const body = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': body.length, ...CORS }).end(body)
}

const readBody = (req) => new Promise((resolve) => {
  const parts = []
  req.on('data', (chunk) => parts.push(chunk))
  req.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(parts).toString() || '{}')) } catch { resolve({}) }
  })
})

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end()

  if (path === '/__events') return json(res, 200, events)
  if (path === '/__clear-releases') {
    if (values.updates) rmSync(join(values.updates, 'manifest.json'), { force: true })
    return json(res, 200, {})
  }
  if (path === '/__spa') { spaMode = url.searchParams.get('mode') ?? 'ok'; return json(res, 200, { spaMode }) }
  if (path === '/__expire-sessions') { sessions.clear(); log('sessions_expired'); return json(res, 200, {}) }

  if (path === '/auth/v1/otp') { log('otp_requested'); return json(res, 200, {}) }
  if (path === '/auth/v1/verify') {
    const body = await readBody(req)
    if (body.token !== '123456') { log('otp_rejected'); return json(res, 403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }) }
    log('otp_verified')
    return json(res, 200, issueSession())
  }
  if (path === '/auth/v1/token') {
    const body = await readBody(req)
    if (!sessions.has(body.refresh_token)) { log('refresh_rejected'); return json(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }) }
    sessions.delete(body.refresh_token)
    log('session_refreshed')
    return json(res, 200, issueSession())
  }
  if (path === '/auth/v1/logout') {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    for (const [refresh, access] of sessions) if (access === token) sessions.delete(refresh)
    log('logout')
    return json(res, 204)
  }
  if (path === '/auth/v1/user') return liveToken(req) ? json(res, 200, USER) : json(res, 401, { code: 401, msg: 'invalid JWT' })

  if (path.startsWith('/storage/v1/object/sign/') || path.startsWith('/api/whatsapp/media/')) {
    log('file_fetched', { path })
    return fakePdf(res)
  }
  if (path === '/frame-check') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    return res.end('<!doctype html><script>parent.postMessage({frameBridge: typeof window.DikhoAndroid}, "*")</script>')
  }

  if (path === '/api/email/oauth/google/complete') {
    const body = await readBody(req)
    log('email_connect', { state: body.state, signedIn: liveToken(req) })
    return json(res, 200, { success: true, data: { outcome: 'connected' } })
  }

  if (path.startsWith('/rest/v1/') || path.startsWith('/api/') || path.startsWith('/functions/')) {
    if (!liveToken(req) && !path.startsWith('/functions/')) return json(res, 401, { code: 'PGRST301', message: 'JWT expired' })
    if (path === '/rest/v1/rpc/my_access') {
      return json(res, 200, { status: 'active', user_id: USER.id, role: 'owner', permissions: PERMISSIONS, preferences: {}, theme: null })
    }
    if (path === '/rest/v1/rpc/get_settings') return json(res, 200, { organization: {}, lists: [] })
    if (path === '/rest/v1/rpc/touch_session') return json(res, 200, 'ok')
    // A long list on paper, so the pagination controls have many pages to lay out.
    if (path === '/rest/v1/clients') return json(res, 200, CLIENTS, { 'Content-Range': `0-${CLIENTS.length - 1}/500` })
    if (path === '/rest/v1/salesorder') return json(res, 200, SALES_ORDERS, { 'Content-Range': '0-0/1' })
    if (path === '/rest/v1/salesorderdocument') return json(res, 200, SALES_ORDER_ITEMS, { 'Content-Range': '0-0/1' })
    if (path.startsWith('/rest/v1/rpc/')) return json(res, 200, null)
    if (path.startsWith('/rest/v1/')) return json(res, 200, [], { 'Content-Range': '*/0' })
    return json(res, 200, { success: true, data: {} })
  }

  json(res, 404, { error: 'not_found' })
}).listen(54321, '127.0.0.1')

/* ── Update service: the real handler over a test manifest ─────────────── */

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost')
  const dir = values.updates
  if (pathname.startsWith('/releases/')) {
    const file = dir && underRoot(dir, pathname)
    if (!file || !existsSync(file)) return res.writeHead(404).end()
    log('apk_downloaded', { path: pathname })
    return sendFile(res, file)
  }
  const manifestFile = dir && join(dir, 'manifest.json')
  const manifest = manifestFile && existsSync(manifestFile)
    ? JSON.parse(readFileSync(manifestFile, 'utf8'))
    : { schema: 1, appId: 'in.dikho.crm', channels: { stable: null } }
  log('update_check', { query: new URL(req.url, 'http://localhost').search })
  const answer = handleRequest(new Request(`http://localhost:8799${req.url}`, { method: req.method }), manifest)
  res.writeHead(answer.status, Object.fromEntries(answer.headers))
  res.end(await answer.text())
}).listen(8799, '127.0.0.1')

console.log('Local test servers ready on 5199, 54321 and 8799')
