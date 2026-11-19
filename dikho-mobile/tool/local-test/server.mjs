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
// POST :54321/__expire-sessions revokes every session. POST :54321/__broadcast
// sends an event down the fake Realtime socket, as the API Worker would.

import { createHash, randomUUID } from 'node:crypto'
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

// A second person, for Live Assist runs: the helper, signed in from a desktop browser.
const HELPER = { ...USER, id: '00000000-0000-4000-8000-000000000009', email: 'helper@example.test' }

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const sessions = new Map()
// Access token -> whose it is.
const tokenUsers = new Map()
let counter = 0

function issueSession(user = USER) {
  counter += 1
  const exp = Math.floor(Date.now() / 1000) + 3600
  const access = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, aud: 'authenticated', role: 'authenticated', session_id: `local-${counter}`, exp })}.local`
  const refresh = `local-refresh-${counter}`
  sessions.set(refresh, access)
  tokenUsers.set(access, user)
  return { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, expires_at: exp, user }
}

const userOf = (req) => tokenUsers.get((req.headers.authorization ?? '').replace(/^Bearer /, '')) ?? USER

const liveToken = (req) => {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  return [...sessions.values()].includes(token)
}

const LEADS = [
  { id: '11111111-1111-4111-8111-111111111111', company_name: 'Example Gifts', name: 'Test Lead', country_code: '+91', mobile: '9800000011', email: 'lead@example.test', city: 'Pune', created_at: '2026-11-01T10:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', company_name: null, name: 'No Company Lead', country_code: '+91', mobile: '9800000012', email: null, city: null, created_at: '2026-11-02T10:00:00Z' },
]

const CLIENTS = [
  { id: 2, company_name: 'Example Traders', contact_person: 'Test Person', email: 'buyer@example.test', phone: '+910000000002', status: 'active', created_at: '2026-01-02T00:00:00Z' },
  { id: 1, company_name: 'Sample Media Works', contact_person: 'Another Person', email: 'media@example.test', phone: '+910000000001', status: 'active', created_at: '2026-01-01T00:00:00Z' },
]

const SALES_ORDERS = [{
  id: 1, order_number: 'SO-TEST-1', company: 'Example Traders', order_client_fullname: 'Test Person',
  order_date: '2026-01-02', order_status: 'Confirmed', sub_total: 1000, tax_total: 180, total: 1180,
  vendor_address_id: null, created_by_id: '00000000-0000-4000-8000-000000000001',
}, {
  // A purchase order shares the table; Sales orders must never show it.
  id: 2, order_number: 'PO-TEST-1', company: 'Northern Outdoor', vendor_address_id: 1, order_status: 'Approved',
  order_date: '2026-01-05', sub_total: 600, tax_total: 108, total: 708, created_by_id: '00000000-0000-4000-8000-000000000001',
}]

const SALES_ORDER_ITEMS = [{
  id: 1, sales_order_id: 1, name: 'Test billboard', hsn_sac: '998361', taxable_amount: 1000, tax_amount: 180,
  after_tax_amount: 1180, gst_type: 'GST 18%',
}, {
  // PO-TEST-1's line, bought for SO-TEST-1's billboard: never one of SO-TEST-1's own.
  id: 2, sales_order_id: 1, purchase_order_id: 2, so_item_id: 1, name: 'Billboard rent', taxable_amount: 600, tax_amount: 108,
  after_tax_amount: 708, is_taxable: true, gst_type: 'Intra-State', cgst_amount: 54, sgst_amount: 54, igst_amount: 0, utgst_amount: 0,
}]

// Enough leads for more than two pages, after the two hand-written ones.
for (let i = 3; i <= 62; i += 1) {
  LEADS.push({
    id: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`,
    company_name: i % 5 ? `Synthetic Company ${i}` : null,
    name: `Synthetic Person ${i}`,
    country_code: '+91',
    mobile: 9810000000 + i,
    email: i % 3 ? `person${i}@example.test` : null,
    city: ['Pune', 'Delhi', 'Mumbai'][i % 3],
    created_at: new Date(Date.UTC(2026, 9, 30) - i * 3600000).toISOString(),
  })
}

// Enough clients for more than two pages of the app's list.
for (let i = 3; i <= 60; i += 1) {
  CLIENTS.push({
    id: i, company_name: `Synthetic Client ${i}`, contact_person: `Contact ${i}`, email: `client${i}@example.test`,
    country_dialcode: 91, contact: 9820000000 + i, status: i % 7 ? 1 : 0, city: 'Mumbai', state: 'Maharashtra',
    created_at: '2026-03-01T00:00:00Z',
  })
}
CLIENTS.sort((a, b) => b.id - a.id)

/** PostgREST for `salesorder` and `salesorderdocument`: the filters both the page and
 * the app send, paging, and the app's inserts, updates and deletes, logged. */
async function salesOrdersRoute(req, res, url, path) {
  const orders = path === '/rest/v1/salesorder'
  const table = orders ? SALES_ORDERS : SALES_ORDER_ITEMS
  const q = url.searchParams
  const ids = (q.get('id') ?? '').match(/\d+/g)?.map(Number) ?? []
  if (req.method === 'GET') {
    let rows = [...table].sort((a, b) => b.id - a.id)
    if (!orders) rows.reverse()
    const nullable = (column) => {
      const filter = q.get(column)
      if (!filter) return
      const wanted = filter.match(/\d+/g)?.map(Number) ?? []
      rows = rows.filter((r) => (filter === 'is.null' ? r[column] == null
        : filter === 'not.is.null' ? r[column] != null
          : filter.startsWith('in.') ? wanted.includes(r[column])
            : `eq.${r[column]}` === filter))
    }
    nullable('vendor_address_id')
    nullable('purchase_order_id')
    nullable('sales_order_id')
    if (q.get('id')) rows = rows.filter((r) => ids.includes(r.id))
    if (q.get('order_status')) rows = rows.filter((r) => `eq.${r.order_status}` === q.get('order_status'))
    // A purchase order comes with its vendor and address, through vendor_address_id.
    if (q.get('select')?.startsWith('*,vendor_addresses(')) {
      rows = rows.map((r) => {
        const address = VENDOR_ADDRESSES.find((a) => a.id === r.vendor_address_id)
        return { ...r, vendor_addresses: address ? { ...address, vendors: VENDORS.find((v) => v.id === address.vendor_id) ?? null } : null }
      })
    }
    const or = q.get('or')
    const term = or?.match(/ilike\.%([^%]*)%/)?.[1]?.toLowerCase()
    if (term) rows = rows.filter((r) => [r.order_number, r.company, r.crm_reference_id].some((v) => String(v ?? '').toLowerCase().includes(term)))
    if (orders && q.get('select')?.startsWith('*')) log('salesorder_page', { range: req.headers.range ?? null, vendor: q.get('vendor_address_id'), status: q.get('order_status'), or })
    if (!orders && q.get('purchase_order_id')) log('order_lines', { po: q.get('purchase_order_id'), so: q.get('sales_order_id') })
    if (/vnd\.pgrst\.object/.test(req.headers.accept ?? '')) return rows[0] ? json(res, 200, rows[0]) : json(res, 406, { code: 'PGRST116', message: 'no rows' })
    const [from, to] = (req.headers.range ?? '0-999').split('-').map(Number)
    const page = rows.slice(from, to + 1)
    return json(res, 200, page, { 'Content-Range': page.length ? `${from}-${from + page.length - 1}/${rows.length}` : `*/${rows.length}` })
  }
  const body = req.method === 'DELETE' ? null : await readBody(req)
  if (req.method === 'POST') {
    const next = () => Math.max(0, ...table.map((r) => r.id)) + 1
    const rows = (Array.isArray(body) ? body : [body]).map((row) => {
      const saved = { ...row, id: next(), created_at: new Date().toISOString(), ...(orders ? { created_by_id: USER.id, vendor_address_id: row.vendor_address_id ?? null } : {}) }
      table.push(saved)
      return saved
    })
    log(orders ? 'salesorder_insert' : 'salesorder_items_insert', orders
      ? { id: rows[0].id, number: rows[0].order_number, company: rows[0].company, total: rows[0].total, createdBy: rows[0].created_by ?? null, vendorAddress: rows[0].vendor_address_id ?? null }
      : { count: rows.length, order: rows[0]?.sales_order_id, po: rows[0]?.purchase_order_id ?? null, soItems: rows.map((r) => r.so_item_id ?? null), names: rows.map((r) => r.name), tax: rows.map((r) => r.tax_amount) })
    return json(res, 201, Array.isArray(body) ? rows : rows[0])
  }
  if (req.method === 'PATCH') {
    const row = table.find((r) => ids.includes(r.id))
    if (!row) return json(res, 406, { code: 'PGRST116', message: 'no rows' })
    Object.assign(row, body)
    log(orders ? 'salesorder_update' : 'salesorder_item_update', { id: row.id })
    return json(res, 200, row)
  }
  if (req.method === 'DELETE') {
    const gone = table.filter((r) => ids.includes(r.id))
    for (const row of gone) table.splice(table.indexOf(row), 1)
    log(orders ? 'salesorder_delete' : 'salesorder_items_delete', { ids: gone.map((r) => r.id) })
    return json(res, 200, gone.map((r) => ({ id: r.id })))
  }
  return json(res, 405, {})
}

/** PostgREST for `clients`: paging, the search, and the app's insert and update. */
async function clientsRoute(req, res, url) {
  const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  if (req.method === 'POST') {
    const row = { ...(await readBody(req)), id: Math.max(...CLIENTS.map((c) => c.id)) + 1 }
    CLIENTS.unshift(row)
    log('client_insert', { body: row, prefer: req.headers.prefer ?? null, single })
    return json(res, 201, single ? row : [row])
  }
  if (req.method === 'PATCH') {
    const id = Number((url.searchParams.get('id') ?? '').replace(/^eq\./, ''))
    const index = CLIENTS.findIndex((c) => c.id === id)
    const patch = await readBody(req)
    log('client_update', { id, body: patch, single })
    if (index < 0) return json(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })
    CLIENTS[index] = { ...CLIENTS[index], ...patch }
    return json(res, 200, single ? CLIENTS[index] : [CLIENTS[index]])
  }
  const or = url.searchParams.get('or') ?? ''
  const text = (or.match(/company_name\.ilike\.%([^%]*)%/) ?? [])[1]?.toLowerCase()
  const matching = CLIENTS.filter((c) => !text || [c.company_name, c.contact_person, c.email, c.gstin, c.pan_number].some((v) => v && String(v).toLowerCase().includes(text)))
  const range = (req.headers.range ?? '').match(/^(\d+)-(\d+)$/)
  // The web page asks with offset and limit in the query; the app with a Range header.
  const from = range ? Number(range[1]) : Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 0)
  const to = range ? Number(range[2]) : (limit ? from + limit - 1 : matching.length - 1)
  log('clients_page', { range: req.headers.range ?? null, or })
  const rows = matching.slice(from, to + 1)
  return json(res, 200, rows, { 'Content-Range': rows.length ? `${from}-${from + rows.length - 1}/${matching.length}` : `*/${matching.length}` })
}

/** PostgREST's paging and the two filters the Leads screens use, enough to test them. */
function leadsRoute(req, res, url) {
  const or = url.searchParams.get('or') ?? ''
  const range = (req.headers.range ?? '').match(/^(\d+)-(\d+)$/)
  log('leads_page', { range: req.headers.range ?? null, or, count: req.headers.prefer ?? null })
  const text = (or.match(/company_name\.ilike\.%([^%]*)%/) ?? [])[1]?.toLowerCase()
  const numbers = ((or.match(/mobile\.in\.\(([\d,]+)\)/) ?? [])[1] ?? '').split(',').filter(Boolean)
  const matching = LEADS.filter((lead) => {
    if (!or) return true
    const inText = text && [lead.company_name, lead.name, lead.email, lead.city].some((v) => v && v.toLowerCase().includes(text))
    return inText || numbers.includes(String(lead.mobile))
  })
  const from = range ? Number(range[1]) : 0
  const to = range ? Number(range[2]) : matching.length - 1
  const rows = matching.slice(from, to + 1)
  const contentRange = rows.length ? `${from}-${from + rows.length - 1}/${matching.length}` : `*/${matching.length}`
  return json(res, 200, rows, { 'Content-Range': contentRange })
}

// Long on purpose: a name that fits proves nothing about a phone's width.
const VENDORS = [
  { id: 1, company_name: 'Northern Outdoor Advertising and Hoardings Private Limited', alias: 'NOAH', contact_person: 'Test Vendor Person', email: 'vendor.accounts.department@example.test', contact: '9800000021', country_dialcode: '+91', gstin: '27AAAAA0000A1Z5', pan_number: 'AAAAA0000A', vendor_type: 'Media owner', status: 'active', media_id: 1, sub_media_id: 1, payment_term_type: 'Days', payment_term_value: 30, tds_section: '194C', tds_percentage: 2, opening_balance: 12000, vendor_bank_name: 'Example Bank', vendor_account_number: '000000000000', vendor_ifsc_code: 'EXMP0000001', created_at: '2026-02-01T00:00:00Z' },
  { id: 2, company_name: 'Sample Printers', alias: null, contact_person: 'Other Person', email: 'print@example.test', contact: '9800000022', country_dialcode: '+91', gstin: null, pan_number: null, vendor_type: 'Printing', status: 'active', media_id: 1, sub_media_id: null, created_at: '2026-02-02T00:00:00Z' },
]

const VENDOR_ADDRESSES = [
  { id: 1, vendor_id: 1, address: '12 Example Road, Sample Nagar', city: 'Mumbai', state: 'Maharashtra', country: 'India', zipcode: '400001', is_default: true },
]

const MEDIA = [{ id: 1, name: 'Outdoor', hidden: false }]
const SUB_MEDIA = [{ id: 1, name: 'Hoarding', media_id: 1, hidden: false }]

// The native email inbox's fixtures.
const EMAIL_ROUTE = /^\/api\/email\/(accounts|threads|recipients|campaigns|audience|templates|preferences|status|directory|oauth)(\/|$)/
// Who may use the shared mailbox; the owner sets it up.
const EMAIL_MEMBERS = [{ user_id: USER.id, full_name: 'Local Owner', role: 'admin', active: true, is_owner: false, granted_by_name: '' }]
const EMAIL_CAMPAIGNS = []
// Consent records by address: one already agreed, so the screen shows both states.
const CONSENT = new Map([['asha@client.test', { marketing: 'subscribed', marketing_source: 'form', marketing_note: 'Expo stall form', marketing_changed_at: '2026-11-01T10:00:00Z', marketing_changed_by_name: 'Local Owner', suppressed: false, suppressed_reason: null, suppressed_at: null }]])
const EMAIL = {
  mailbox: { id: '33333333-3333-4333-8333-333333333333', email_address: 'sales@example.test', display_name: 'Sales', provider: 'google', status: 'connected', role: 'manager', kind: 'shared', can_configure: true, member_count: 1, campaign_sender: false, unread_count: 1, last_synced_at: new Date().toISOString() },
  threads: [
    { id: '44444444-4444-4444-8444-444444444441', subject: 'Hoarding rates for December', snippet: 'Could you share the rates', last_message_at: new Date(Date.now() - 3600_000).toISOString(), unread: true, starred: false, has_attachments: true, message_count: 1, account_email: 'sales@example.test', account_name: 'Sales', workflow_status: 'open', participants: [{ name: 'Asha Rao', email: 'asha@client.test' }, { name: 'Sales', email: 'sales@example.test' }], label_ids: ['INBOX', 'UNREAD'] },
    { id: '44444444-4444-4444-8444-444444444442', subject: 'Invoice copy', snippet: 'Thanks, received', last_message_at: new Date(Date.now() - 86400_000 * 2).toISOString(), unread: false, starred: false, has_attachments: false, message_count: 2, account_email: 'sales@example.test', account_name: 'Sales', workflow_status: 'open', participants: [{ name: 'Ravi Kumar', email: 'ravi@client.test' }], label_ids: ['INBOX'] },
  ],
}
function emailThreadDetail(thread) {
  return {
    thread,
    account: EMAIL.mailbox,
    notes: [],
    assignable: [{ user_id: USER.id, full_name: 'Local Owner' }, { user_id: HELPER.id, full_name: 'Helper Person' }],
    messages: [{
      id: 'm1', date: thread.last_message_at, from: thread.participants[0], to: [{ name: 'Sales', email: 'sales@example.test' }], cc: [], bcc: [], reply_to: [],
      subject: thread.subject, unread: thread.unread, draft: false,
      html: '<p>Hello,</p><p>Could you share the <b>rates for December</b>? Our brief is attached.</p><p><a href="https://example.test/brief">See the brief online</a></p><table style="width:100%"><tr><td>Site</td><td>Size</td></tr><tr><td>Ring Road</td><td>40x20</td></tr></table>',
      text: 'Hello, could you share the rates for December? Our brief is attached.',
      blocked_images: 1,
      attachments: [{ id: 'att1', filename: 'brief.pdf', mime_type: 'application/pdf', size: 20480, inline: false }],
    }],
  }
}

// Live Assist sessions, and an event on a person's private staff channel.
const ASSIST = new Map()
function staffBroadcast(userId, event, payload) {
  const topic = `realtime:staff:${userId}`
  log('staff_event', { user: userId, event })
  for (const socket of sockets) if (socket.topics?.has(topic)) sendTo(socket, { topic, event: 'broadcast', payload: { type: 'broadcast', event, payload } })
}

// Settings: the person's own preferences and theme, the organization's formats, its
// invoice details and one dropdown list. Only courier statuses are seeded, so the
// order screens keep their built-in lists.
const SETTINGS = {
  theme: null,
  preferences: {},
  organization: { date_format: 'd MMM yyyy', number_format: 'en-IN' },
  lists: [
    { id: 1, list_key: 'courier_status', value: 'Sent', label: null, sort_order: 10, hidden: false },
    { id: 2, list_key: 'courier_status', value: 'Delivered', label: null, sort_order: 20, hidden: false },
  ],
  company: {
    legal_name: 'Example Media LLP', gstin: null, pan: null, state_code: '27', address_line1: '1 Test Road', address_line2: null,
    city: 'Pune', state: 'Maharashtra', pincode: '411001', country: 'India',
    bank_name: null, bank_account_name: null, bank_account_number: null, bank_ifsc: null, bank_branch: null,
  },
}

/** The Settings database functions, as supabase/migrations/20261028120000_settings.sql answers them. */
function settingsRpc(name, args) {
  const nextId = (rows) => Math.max(0, ...rows.map((r) => r.id)) + 1
  switch (name) {
    case 'set_my_preferences': {
      const next = { ...SETTINGS.preferences, ...(args.p_changes ?? {}) }
      for (const key of Object.keys(next)) if (next[key] === null) delete next[key]
      SETTINGS.preferences = next
      log('settings_preferences', { changes: args.p_changes })
      return [200, next]
    }
    case 'set_my_theme':
      SETTINGS.theme = args.p_theme
      log('settings_theme', { theme: args.p_theme })
      return [204]
    case 'update_organization_settings':
      SETTINGS.organization = { ...SETTINGS.organization, ...(args.p_changes ?? {}) }
      log('settings_organization', { changes: args.p_changes })
      return [200, SETTINGS.organization]
    case 'get_organization_profile':
      return [200, SETTINGS.company]
    case 'update_organization_profile':
      SETTINGS.company = { ...SETTINGS.company, ...(args.p_changes ?? {}) }
      log('settings_company', { changes: args.p_changes })
      return [200, SETTINGS.company]
    case 'add_list_option': {
      const value = String(args.p_value ?? '').trim()
      if (SETTINGS.lists.some((r) => r.list_key === args.p_list && r.value.toLowerCase() === value.toLowerCase())) {
        return [409, { code: 'PT409', message: 'That value is already in the list' }]
      }
      const row = { id: nextId(SETTINGS.lists), list_key: args.p_list, value, label: args.p_label ?? null, sort_order: 999, hidden: false }
      SETTINGS.lists.push(row)
      log('settings_list_add', { list: args.p_list, value, label: row.label })
      return [200, row]
    }
    case 'set_list_option_hidden': {
      const row = SETTINGS.lists.find((r) => r.id === args.p_id)
      if (!row) return [404, { code: 'PT404', message: 'Value not found' }]
      row.hidden = Boolean(args.p_hidden)
      log('settings_list_hidden', { id: row.id, hidden: row.hidden })
      return [200, row]
    }
    case 'move_list_option': {
      const row = SETTINGS.lists.find((r) => r.id === args.p_id)
      if (!row) return [404, { code: 'PT404', message: 'Value not found' }]
      const same = SETTINGS.lists.filter((r) => r.list_key === row.list_key).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      const other = same[same.indexOf(row) + (args.p_direction < 0 ? -1 : 1)]
      if (other) [row.sort_order, other.sort_order] = [other.sort_order, row.sort_order]
      log('settings_list_move', { id: row.id, direction: args.p_direction })
      return [204]
    }
    case 'save_media': {
      let row = MEDIA.find((m) => m.id === args.p_id)
      if (!row) { row = { id: nextId(MEDIA), name: args.p_name, hidden: false }; MEDIA.push(row) }
      if (args.p_name != null) row.name = args.p_name
      if (args.p_hidden != null) row.hidden = args.p_hidden
      log('settings_media', { id: args.p_id ?? null, name: args.p_name ?? null, hidden: args.p_hidden ?? null })
      return [200, row]
    }
    case 'save_sub_media': {
      let row = SUB_MEDIA.find((m) => m.id === args.p_id)
      if (!row) { row = { id: nextId(SUB_MEDIA), media_id: args.p_media_id, name: args.p_name, hidden: false }; SUB_MEDIA.push(row) }
      if (args.p_name != null) row.name = args.p_name
      if (args.p_hidden != null) row.hidden = args.p_hidden
      log('settings_sub_media', { id: args.p_id ?? null, media: args.p_media_id ?? null, name: args.p_name ?? null, hidden: args.p_hidden ?? null })
      return [200, row]
    }
    default:
      return null
  }
}

const CONTACTS = Array.from({ length: 75 }, (_, i) => ({
  id: i + 1,
  name: i % 7 === 3 ? null : `Sample Contact With A Fairly Long Name ${i + 1}`,
  phone: `9198${String(1000000 + i).padStart(8, '0')}`,
  company: i % 2 ? 'Example Company Private Limited' : null,
  opted_out: i % 9 === 4 ? 1 : 0,
  created_at: '2026-03-01T00:00:00Z',
}))

const CAMPAIGNS = [
  { id: 1, name: 'Diwali offers for corporate gifting buyers', template_name: 'festive_offer_with_a_long_name', status: 'completed', sent_count: 1180, total_count: 1200, created_at: '2026-10-20T10:00:00Z' },
  { id: 2, name: 'Short', template_name: 'welcome', status: 'sending', sent_count: 12, total_count: 90, created_at: '2026-11-01T10:00:00Z' },
]

/** GET /api/whatsapp/analytics, in the shape src/api/services/whatsapp/analytics.js answers. Synthetic. */
function analyticsFixture(days) {
  const today = Date.UTC(2026, 10, 9)
  const daily = Array.from({ length: days }, (_, i) => {
    const day = new Date(today - (days - 1 - i) * 86400000).toISOString().slice(0, 10)
    const campaignDay = (days - i) % 6 === 2
    const base = 30 + ((i * 37) % 40)
    const sent = base + (campaignDay ? 1000 + ((i * 53) % 250) : 0)
    const delivered = Math.round(sent * 0.9)
    const read = Math.round(delivered * 0.6)
    return { day, sent, delivered, read, failed: Math.round(sent * 0.04), inbound: 20 + ((i * 29) % 60), campaign: campaignDay ? sent - base : 0, replies: Math.round(base * 0.8), automatic: Math.round(base * 0.2) }
  })
  const sum = (key) => daily.reduce((total, row) => total + row[key], 0)
  const totals = Object.fromEntries(['sent', 'delivered', 'read', 'failed', 'inbound', 'campaign', 'replies', 'automatic'].map((k) => [k, sum(k)]))
  totals.awaiting = Math.round(totals.sent * 0.01)
  const previous = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v * 0.85)]))
  return {
    range: { days, from: daily[0].day, to: daily.at(-1).day, previousFrom: new Date(today - (days * 2 - 1) * 86400000).toISOString().slice(0, 10), utcOffsetMinutes: 330 },
    totals, previous, daily,
    failures: [
      { code: '131049', count: Math.round(totals.failed * 0.7), reason: 'Held back by Meta to protect engagement (marketing limit per person)' },
      { code: '131026', count: Math.round(totals.failed * 0.3), reason: 'Not on WhatsApp, or cannot receive this message' },
    ],
    templates: [
      { name: 'festive_offer_with_a_long_name', sent: 2400, delivered: 2160, read: 1300, failed: 96, quality: 'GREEN', status: 'APPROVED', category: 'MARKETING',
        replyTaps: [{ label: 'Interested', count: 180 }, { label: 'Not now', count: 22 }], replyTapTotal: 202, links: [{ label: 'View catalogue', count: 240 }], linkTaps: 240, cost: 1884.0 },
      { name: 'welcome', sent: 300, delivered: 290, read: 200, failed: 4, quality: 'YELLOW', status: 'APPROVED', category: 'UTILITY',
        replyTaps: [], replyTapTotal: 0, links: [], linkTaps: 0, cost: 33.0 },
    ],
    templateInsights: { available: true },
    templateHealth: { GREEN: 3, YELLOW: 1, RED: 0, UNKNOWN: 1, paused: 0 },
    campaigns: CAMPAIGNS.map((c) => ({ id: c.id, name: c.name, template: c.template_name, status: c.status, audience: c.total_count, createdAt: c.created_at, sent: c.sent_count, delivered: Math.round(c.sent_count * 0.9), read: Math.round(c.sent_count * 0.55), failed: Math.round(c.sent_count * 0.04) })),
    audience: { contacts: CONTACTS.length, optedOut: CONTACTS.filter((c) => c.opted_out).length, added: 12 },
    inbox: { open: 40, unread: 22 },
    account: { phone: '+91 00000 00000', verifiedName: 'Example Business', nameStatus: 'APPROVED', quality: 'GREEN', throughput: 'STANDARD', messagingLimit: 'TIER_2K' },
    spend: { currency: 'INR', total: 4120.5, volume: 5200, byCategory: [{ category: 'MARKETING', volume: 5000, cost: 4100 }, { category: 'UTILITY', volume: 200, cost: 20.5 }], daily: daily.filter((r) => r.campaign).map((r) => ({ day: r.day, cost: Math.round(r.campaign * 78.5) / 100 })) },
    metaErrors: [],
    computedAt: new Date().toISOString(),
  }
}

function campaignFixture(id) {
  const c = CAMPAIGNS.find((row) => row.id === id)
  if (!c) return null
  const timeline = Array.from({ length: 30 }, (_, hour) => ({ hour, delivered: Math.max(0, Math.round(400 / (hour + 1)) - 8), read: Math.max(0, Math.round(220 / (hour + 1)) - 4) }))
  return {
    campaign: { id: c.id, name: c.name, template: c.template_name, language: 'en', status: c.status, audience: c.total_count, createdAt: c.created_at, completedAt: null },
    totals: { sent: c.sent_count, delivered: Math.round(c.sent_count * 0.9), read: Math.round(c.sent_count * 0.55), failed: Math.round(c.sent_count * 0.04), awaiting: Math.round(c.sent_count * 0.02), notSent: c.total_count - c.sent_count, replied: Math.round(c.sent_count * 0.12), optedOut: 3 },
    failures: [{ code: '131026', count: Math.round(c.sent_count * 0.04), reason: 'Not on WhatsApp, or cannot receive this message' }],
    timeline, replyWindowDays: 7, computedAt: new Date().toISOString(),
    taps: {
      replies: [{ label: 'Interested', count: Math.round(c.sent_count * 0.1), people: Math.round(c.sent_count * 0.09) }],
      replyTotal: Math.round(c.sent_count * 0.1),
      links: null, linkTotal: null, linkCost: null,
      insights: { available: false, reason: null },
    },
  }
}

const STAFF = [
  { user_id: USER.id, full_name: 'Local Owner', email: USER.email, phone: '+919000000000', status: 'active', system_role: 'owner', online: true, designation: 'Founder', department: 'Management', created_at: '2026-01-01T00:00:00Z', last_seen_at: new Date().toISOString() },
  { user_id: '00000000-0000-4000-8000-000000000002', full_name: 'A Staff Member With A Long Full Name', email: 'staff.member.long.address@example.test', phone: '+919000000001', status: 'active', system_role: 'staff', online: false, designation: 'Campaign executive', department: 'Sales', created_at: '2026-02-01T00:00:00Z', last_seen_at: '2026-11-01T10:00:00Z', employee_id: 'E-2', template_id: 't1', template: 'Sales executive', can_manage: true, active_sessions: 1, overrides: {} },
  { user_id: '00000000-0000-4000-8000-000000000003', full_name: 'Invited Person', email: 'invited@example.test', phone: null, status: 'invited', system_role: 'staff', online: false, designation: null, created_at: '2026-10-01T00:00:00Z' },
  { user_id: HELPER.id, full_name: 'Helper Person', email: HELPER.email, phone: null, status: 'active', system_role: 'owner', online: true, designation: 'Support', department: 'Management', created_at: '2026-01-02T00:00:00Z', last_seen_at: new Date().toISOString() },
]

const USER_CATALOG = {
  actor: { id: USER.id, user_id: USER.id, system_role: 'owner', rank: 40, level: 100, permissions: { 'users.view': 'all', 'clients.view': 'all', 'clients.create': 'all' } },
  departments: [{ id: 'd1', name: 'Sales', archived: false, members: 1, teams: [] }],
  permissions: [
    { key: 'clients.view', module: 'Clients', action: 'view', label: 'View clients', allowed_scopes: ['own', 'all'] },
    { key: 'clients.create', module: 'Clients', action: 'create', label: 'Add clients', allowed_scopes: ['all'] },
  ],
  role_permissions: {},
  templates: [{ id: 't1', key: 'sales_executive', name: 'Sales executive', built_in: true, members: 1, permissions: { 'clients.view': 'all' } }],
}

/** The module pages' lists, so a walk at phone width has rows to tap. */
function moduleFixture(path, url) {
  if (path === '/rest/v1/vendors') {
    // Newest first, with addresses embedded, as the vendor queries ask.
    const rows = [...VENDORS].sort((a, b) => b.id - a.id).map((v) => ({ ...v, vendor_addresses: VENDOR_ADDRESSES.filter((a) => a.vendor_id === v.id) }))
    return { rows, range: `0-${rows.length - 1}/${rows.length}` }
  }
  if (path === '/rest/v1/vendor_addresses') {
    // The purchase order form asks for one vendor's addresses.
    const vendor = url.searchParams.get('vendor_id')
    const rows = VENDOR_ADDRESSES.filter((a) => !vendor || `eq.${a.vendor_id}` === vendor)
    return { rows, range: rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' }
  }
  if (path === '/rest/v1/media') return { rows: MEDIA, range: '0-0/1' }
  if (path === '/rest/v1/sub_media') return { rows: SUB_MEDIA, range: '0-0/1' }
  if (path === '/api/contacts') {
    const limit = Number(url.searchParams.get('limit')) || 2000
    const q = (url.searchParams.get('search') ?? '').toLowerCase()
    const matching = CONTACTS.filter((c) => !q || `${c.name ?? ''} ${c.phone}`.toLowerCase().includes(q))
    const start = Number(url.searchParams.get('cursor')) || 0
    const contacts = matching.slice(start, start + limit)
    const next = start + limit
    return { data: { contacts, total: matching.length, nextCursor: next < matching.length ? String(next) : null } }
  }
  if (path === '/api/cg-leads/whatsapp-status') {
    return { data: { statuses: [
      { phone: '919800000011', status: 'read', error_message: null },
      { phone: '919810000004', status: 'failed', error_message: 'This number is not on WhatsApp.' },
    ] } }
  }
  if (path === '/api/whatsapp/analytics') {
    const days = Number(url.searchParams.get('days') ?? 30)
    return [7, 30, 90].includes(days) ? { data: analyticsFixture(days) } : { status: 400, error: 'days must be 7, 30 or 90' }
  }
  const campaignMatch = path.match(/^\/api\/whatsapp\/analytics\/campaigns\/(\d+)$/)
  if (campaignMatch) {
    const data = campaignFixture(Number(campaignMatch[1]))
    return data ? { data } : { status: 404, error: 'Campaign not found' }
  }
  if (path === '/api/campaigns') return { data: { campaigns: CAMPAIGNS } }
  if (path === '/api/users') return { data: STAFF }
  if (path === '/api/users/catalog') return { data: USER_CATALOG }
  if (path === '/api/users/me') return { data: STAFF[0] }
  // Empty, in the shapes the Email Hub pages expect.
  if (path.startsWith('/api/email/')) return { data: { threads: [], accounts: [], campaigns: [], templates: [], results: [], mailboxes: [], readiness: { missing: [] }, senders: [], sender_mailboxes: [], nextCursor: null } }
  return null
}

const PERMISSIONS = Object.fromEntries(['clients.view', 'leads.view', 'vendors.view', 'sales_orders.view', 'purchase_orders.view', 'users.view', 'email_inbox.view', 'inbox.view', 'inbox.reply', 'inbox.delete', 'inbox.block', 'campaigns.view', 'campaigns.send', 'wa_contacts.view', 'wa_contacts.delete', 'wa_contacts.import', 'wa_templates.view', 'clients.create', 'vendors.create', 'sales_orders.create', 'purchase_orders.create', 'users.create', 'clients.edit', 'vendors.edit', 'sales_orders.edit', 'purchase_orders.edit', 'email_campaigns.view', 'email_campaigns.create', 'email_templates.manage', 'email_consent.manage', 'email_settings.manage', 'settings.manage', 'live_assist.use'].map((key) => [key, 'all']))

/* ── The WhatsApp inbox, in memory ─────────────────────────────────────── */

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString()
const CHATS = Array.from({ length: 240 }, (_, i) => ({
  id: i + 1,
  phone: `9198${String(i).padStart(8, '0')}`,
  wa_name: i === 3 ? null : `Test Contact ${i + 1}`,
  contact_name: null,
  avatar_url: null,
  status: 'open',
  cleared_through_id: 0,
  blocked_at: null,
  unread_count: i % 11 === 2 ? 3 : 0,
  // The first few are inside the 24-hour window, the rest long past it.
  last_inbound_at: minutesAgo(i < 40 ? 5 + i : 2000 + i),
  last_message_at: minutesAgo(5 + i),
  last_message_preview: i === 1 ? '📎 image' : `Synthetic message preview number ${i + 1}, long enough to need cutting off on a phone`,
  last_message_direction: i % 3 ? 'inbound' : 'outbound',
  last_message_status: 'read',
}))

let nextMessageId = 5000
const inboxMessage = (chatId, fields) => {
  nextMessageId += 1
  const at = minutesAgo(fields.minutes ?? 0)
  return {
    id: nextMessageId, conversation_id: chatId, meta_message_id: `wamid.local.${nextMessageId}`, direction: 'inbound', type: 'text',
    body: null, status: 'received', wa_timestamp: at, created_at: at, starred: 0, ...fields, minutes: undefined,
  }
}

const THREADS = new Map()
function threadOf(chatId) {
  if (THREADS.has(chatId)) return THREADS.get(chatId)
  const rows = []
  for (let i = 180; i > 8; i -= 1) {
    rows.push(inboxMessage(chatId, {
      minutes: i * 30, direction: i % 3 ? 'inbound' : 'outbound', status: i % 3 ? 'received' : 'read',
      body: `Synthetic message ${181 - i}. A sentence or two of text, the length of a normal reply in a real chat.`,
    }))
  }
  const first = rows.at(-1)
  rows.push(
    inboxMessage(chatId, { minutes: 40, direction: 'outbound', status: 'read', body: 'Replying to that one', context_wamid: first.meta_message_id }),
    inboxMessage(chatId, { minutes: 35, type: 'image', media_mime: 'image/png', media_url: '/api/whatsapp/media/photo-1', media_status: 'ready', media_size: 11872, body: 'A photo with a caption' }),
    inboxMessage(chatId, { minutes: 34, type: 'image', media_mime: 'image/png', media_url: '/api/whatsapp/media/photo-2', media_status: 'ready', media_size: 11872 }),
    inboxMessage(chatId, { minutes: 33, type: 'document', media_mime: 'application/pdf', media_url: '/api/whatsapp/media/doc-1', media_status: 'ready', media_size: 482000, media_filename: 'Rate card.pdf' }),
    inboxMessage(chatId, { minutes: 32, type: 'location', body: '📍 Office', payload: JSON.stringify({ kind: 'location', latitude: 18.52, longitude: 73.85, name: 'Office', address: 'Pune' }) }),
    inboxMessage(chatId, { minutes: 31, type: 'contacts', body: '👤 Someone', payload: JSON.stringify({ kind: 'contacts', contacts: [{ name: 'Someone', org: 'Example Co', phones: [{ phone: '+91 98000 00000' }], emails: ['a@example.test'] }] }) }),
    inboxMessage(chatId, { minutes: 30, direction: 'outbound', status: 'read', type: 'template', body: 'Hello there', payload: JSON.stringify({ kind: 'template', name: 'welcome', language: 'en', body: 'Hello there', footer: 'Sent by Dikho', buttons: ['Yes', 'No'] }) }),
    inboxMessage(chatId, { minutes: 29, direction: 'outbound', status: 'read', type: 'interactive', body: 'Pick one', payload: JSON.stringify({ kind: 'interactive', interactive_type: 'buttons', body: 'Pick one', buttons: ['First', 'Second'] }) }),
    inboxMessage(chatId, { minutes: 28, type: 'system', body: 'This customer changed their number.' }),
    inboxMessage(chatId, { minutes: 20, body: 'The newest message from the customer', pinned_at: minutesAgo(10) }),
  )
  const newest = rows.at(-1)
  rows.push(inboxMessage(chatId, { minutes: 19, type: 'reaction', body: '👍', context_wamid: newest.meta_message_id }))
  THREADS.set(chatId, rows)
  return rows
}

const TEMPLATES = [
  { name: 'welcome', language: 'en', category: 'UTILITY', status: 'APPROVED', headerText: '', headerFormat: null, bodyText: 'Hello {{1}}, welcome to Dikho.', footerText: 'Sent by Dikho', buttons: [], variables: ['1'] },
  { name: 'offer_with_photo', language: 'en', category: 'MARKETING', status: 'APPROVED', headerText: '', headerFormat: 'IMAGE', bodyText: 'Festive offer', footerText: '', buttons: [], variables: [] },
  { name: 'follow_up', language: 'en', category: 'MARKETING', status: 'APPROVED', headerText: 'Thanks', headerFormat: 'TEXT', bodyText: 'Thanks for your interest, {{1}}. Can we call you on {{2}}?', footerText: '', buttons: [], variables: ['1', '2'] },
  { name: 'static_note', language: 'en', category: 'UTILITY', status: 'APPROVED', headerText: '', headerFormat: null, bodyText: 'A short note from Dikho.', footerText: '', buttons: [], variables: [] },
]

const readBytes = (req) => new Promise((resolve) => {
  const parts = []
  req.on('data', (chunk) => parts.push(chunk))
  req.on('end', () => resolve(Buffer.concat(parts)))
})

// The API's own check, so a recording it would refuse is refused here too.
function isOggOpus(mime, bytes) {
  if (mime !== 'audio/ogg' || bytes.length < 64) return false
  const start = 27 + bytes[26]
  return bytes.subarray(0, 4).toString('latin1') === 'OggS' && bytes.subarray(start, start + 8).toString('latin1') === 'OpusHead'
}

let lastUpload = null

function multipart(req, body) {
  const boundary = /boundary=(.+)$/.exec(req.headers['content-type'] ?? '')?.[1]
  const parts = {}
  for (const raw of body.toString('latin1').split(`--${boundary}`)) {
    const m = /^\r\nContent-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?(?:\r\nContent-Type: ([^\r]+))?\r\n\r\n([\s\S]*)\r\n$/.exec(raw)
    if (m) parts[m[1]] = { filename: m[2], type: m[3], value: Buffer.from(m[4], 'latin1') }
  }
  return parts
}

async function inboxRoute(req, res, path, url) {
  const send = (data) => json(res, 200, { success: true, data })
  const refuse = (status, code, message) => json(res, status, { success: false, error: { code, message } })

  if (path === '/api/templates') return send({ source: 'meta', templates: TEMPLATES })
  if (path === '/api/whatsapp/media-ticket') return send({ ticket: 'local-ticket' })
  if (path === '/api/whatsapp/conversations/template' && req.method === 'POST') {
    const body = await readBody(req)
    log('direct_template', { phone: body.phone, name: body.name, values: body.values })
    const digits = String(body.phone ?? '').replace(/\D/g, '')
    if (digits.length < 10) return refuse(400, 'INVALID_PHONE', 'That is not a phone number WhatsApp can reach.')
    if (digits.endsWith('99')) return refuse(409, 'OPTED_OUT', 'This person opted out of WhatsApp messages.')
    let chat = CHATS.find((c) => c.phone === digits)
    if (!chat) {
      chat = { ...CHATS[0], id: CHATS.length + 1, phone: digits, wa_name: null, last_inbound_at: null, unread_count: 0, last_message_at: minutesAgo(0), last_message_preview: 'Template' }
      CHATS.unshift(chat)
    }
    return send({ conversationId: chat.id, message: inboxMessage(chat.id, { direction: 'outbound', status: 'sent', type: 'template', body: 'Template' }) })
  }
  if (path === '/api/whatsapp/conversations') {
    const limit = Number(url.searchParams.get('limit')) || 200
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const unread = url.searchParams.get('unread') === '1'
    log('chat_page', { limit, q, unread, cursor: url.searchParams.get('cursor') })
    const matching = CHATS
      .filter((c) => c.status === 'open')
      .filter((c) => !unread || c.unread_count > 0)
      .filter((c) => !q || (c.wa_name ?? '').toLowerCase().includes(q) || c.phone.includes(q) || (c.last_message_preview ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at) || b.id - a.id)
    const cursor = url.searchParams.get('cursor')
    const start = cursor ? matching.findIndex((c) => `${c.last_message_at}|${c.id}` === cursor) + 1 : 0
    const page = matching.slice(start, start + limit)
    const last = page.at(-1)
    return send({
      conversations: page,
      nextCursor: start + limit < matching.length ? `${last.last_message_at}|${last.id}` : null,
      ...(cursor ? {} : { unreadTotal: CHATS.filter((c) => c.status === 'open' && c.unread_count > 0).length }),
    })
  }
  const match = /^\/api\/whatsapp\/conversations\/(\d+)(?:\/([a-z]+))?(?:\/(\d+))?(?:\/([a-z]+))?$/.exec(path)
  if (!match) return null
  const chatId = Number(match[1])
  const chat = CHATS.find((c) => c.id === chatId)
  if (!chat) return refuse(404, 'NOT_FOUND', 'Conversation not found')
  const action = match[2] ?? ''
  const rows = threadOf(chatId)
  const append = (fields) => {
    const row = inboxMessage(chatId, { direction: 'outbound', status: 'sent', ...fields })
    rows.push(row)
    chat.last_message_at = row.created_at
    chat.last_message_preview = row.body ?? `📎 ${row.type}`
    chat.last_message_direction = 'outbound'
    return send({ message: row })
  }
  if (action === 'messages' && req.method === 'GET' && !match[3]) {
    const limit = Number(url.searchParams.get('limit')) || 500
    const before = Number(url.searchParams.get('before')) || null
    log('thread_page', { chatId, limit, before })
    const visible = rows.filter((m) => !before || m.id < before)
    return send({ messages: visible.slice(-limit), hasMore: visible.length > limit })
  }
  if (action === 'read') { chat.unread_count = 0; log('read', { chatId }); return send({ ok: true }) }
  if (action === 'typing') return send({ ok: true })
  if (action === 'messages' && req.method === 'POST' && !match[3]) {
    const body = await readBody(req)
    log('text_sent', { chatId, body: body.body })
    return append({ body: body.body })
  }
  if (action === 'media' && req.method === 'POST') {
    const parts = multipart(req, await readBytes(req))
    const file = parts.file
    const voice = parts.voice?.value.toString() === '1'
    const mime = (file?.type ?? '').toLowerCase()
    const accepted = Boolean(file) && (!voice || isOggOpus(mime, file.value))
    log('media_sent', { chatId, filename: file?.filename, mime, voice, bytes: file?.value.length, accepted })
    if (!accepted) return refuse(415, 'UNSUPPORTED_MEDIA', 'A voice note must be an OGG/Opus recording.')
    lastUpload = file
    return append({
      type: mime.startsWith('audio/') ? 'audio' : mime.startsWith('image/') ? 'image' : 'document', media_mime: mime, media_url: '/api/whatsapp/media/last-upload',
      media_status: 'ready', media_size: file.value.length, media_filename: file.filename, payload: voice ? JSON.stringify({ kind: 'voice' }) : null,
    })
  }
  if (['location', 'contact', 'interactive', 'template'].includes(action) && req.method === 'POST') {
    const body = await readBody(req)
    log('structured_sent', { chatId, action })
    return append({ type: action === 'contact' ? 'contacts' : action, body: body.body ?? body.name ?? 'Sent', payload: JSON.stringify({ kind: action === 'contact' ? 'contacts' : action, ...body }) })
  }
  if (action === 'clear') {
    const through = rows.at(-1)?.id ?? 0
    rows.length = 0
    chat.cleared_through_id = through
    log('cleared', { chatId })
    return send({ conversation: chat })
  }
  if (action === '' && req.method === 'DELETE') { chat.status = 'deleted'; log('deleted', { chatId }); return send({ id: chatId }) }
  if (action === 'block') {
    chat.blocked_at = req.method === 'POST' ? minutesAgo(0) : null
    log(req.method === 'POST' ? 'blocked' : 'unblocked', { chatId })
    return send({ conversation: chat })
  }
  if (action === 'forward') {
    const body = await readBody(req)
    log('forwarded', { chatId, messageId: body.messageId })
    return append({ body: 'Forwarded message' })
  }
  if (action === 'messages' && match[3]) {
    const target = rows.find((m) => m.id === Number(match[3]))
    if (!target) return refuse(404, 'GONE', 'That message is no longer in this chat.')
    if (match[4] === 'reaction') {
      const body = await readBody(req)
      return append({ type: 'reaction', body: body.emoji, context_wamid: target.meta_message_id })
    }
    if (match[4] === 'pin') { target.pinned_at = req.method === 'POST' ? minutesAgo(0) : null; return send({ message: target }) }
    if (match[4] === 'star') { target.starred = req.method === 'POST' ? 1 : 0; return send({ id: target.id }) }
    if (!match[4] && req.method === 'DELETE') { rows.splice(rows.indexOf(target), 1); return send({ id: target.id }) }
  }
  return null
}

/* ── A small stand-in for Supabase Realtime ────────────────────────────── */

const sockets = new Set()

function frame(text) {
  const body = Buffer.from(text)
  const head = body.length < 126
    ? Buffer.from([0x81, body.length])
    : body.length < 65536
      ? Buffer.from([0x81, 126, body.length >> 8, body.length & 255])
      : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([body.length >>> 24, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255])])
  return Buffer.concat([head, body])
}

/** The client's frames, text (opcode 1) and binary (opcode 2), unmasked. */
function readFrames(buffer) {
  const frames = []
  let at = 0
  while (buffer.length - at >= 2) {
    const opcode = buffer[at] & 15
    let length = buffer[at + 1] & 127
    let cursor = at + 2
    if (length === 126) { if (buffer.length - cursor < 2) break; length = buffer.readUInt16BE(cursor); cursor += 2 }
    else if (length === 127) { if (buffer.length - cursor < 8) break; length = Number(buffer.readBigUInt64BE(cursor)); cursor += 8 }
    if (buffer.length - cursor < length + 4) break
    const mask = buffer.subarray(cursor, cursor + 4)
    cursor += 4
    const data = Buffer.from(buffer.subarray(cursor, cursor + length))
    for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4]
    if (opcode === 1 || opcode === 2) frames.push({ opcode, data })
    at = cursor + length
  }
  return { frames, rest: buffer.subarray(at) }
}

// Realtime's two protocols: the app's InboxRealtime speaks 1.0.0 (JSON objects);
// supabase-js in the browser speaks 2.0.0 (JSON arrays, and a broadcast it sends as a
// binary "user broadcast push").
function decodeMessage({ opcode, data }, vsn2) {
  if (opcode === 1) {
    const value = JSON.parse(data.toString())
    if (!vsn2) return value
    const [join_ref, ref, topic, event, payload] = value
    return { join_ref, ref, topic, event, payload }
  }
  if (data[0] !== 3) return null
  const [joinRefSize, refSize, topicSize, eventSize, metaSize, encoding] = [data[1], data[2], data[3], data[4], data[5], data[6]]
  let at = 7
  const take = (size) => { const part = data.subarray(at, at + size).toString(); at += size; return part }
  const join_ref = take(joinRefSize)
  const ref = take(refSize)
  const topic = take(topicSize)
  const userEvent = take(eventSize)
  take(metaSize)
  const body = data.subarray(at).toString()
  return { join_ref, ref, topic, event: 'broadcast', payload: { type: 'broadcast', event: userEvent, payload: encoding === 1 ? JSON.parse(body) : {} } }
}

function sendTo(socket, { join_ref = null, ref = null, topic, event, payload }) {
  socket.write(frame(socket.vsn2 ? JSON.stringify([join_ref, ref, topic, event, payload]) : JSON.stringify({ topic, event, ref, payload })))
}

function upgradeRealtime(req, socket) {
  if (!req.url.startsWith('/realtime/v1/websocket')) { socket.destroy(); return }
  const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  sockets.add(socket)
  socket.topics = new Set()
  socket.vsn2 = req.url.includes('vsn=2.0.0')
  let pending = Buffer.alloc(0)
  socket.on('data', (chunk) => {
    const { frames, rest } = readFrames(Buffer.concat([pending, chunk]))
    pending = rest
    for (const raw of frames) {
      let message
      try { message = decodeMessage(raw, socket.vsn2) } catch { message = null }
      if (!message) continue
      if (message.event === 'phx_join') {
        socket.topics.add(message.topic)
        log('realtime_join', { topic: message.topic, private: message.payload?.config?.private, hasToken: Boolean(message.payload?.access_token) })
      }
      if (message.event === 'phx_leave') socket.topics.delete(message.topic)
      if (message.event === 'phx_join' || message.event === 'heartbeat' || message.event === 'phx_leave') {
        sendTo(socket, { join_ref: message.join_ref, ref: message.ref, topic: message.topic, event: 'phx_reply', payload: { status: 'ok', response: {} } })
      }
      // A client's broadcast goes to everyone else on the channel, as Realtime relays
      // Live Assist's setup messages between the two devices.
      if (message.event === 'broadcast' && socket.topics.has(message.topic)) {
        if (String(message.topic).startsWith('realtime:assist:')) log('assist_signal', { topic: message.topic, type: message.payload?.payload?.type ?? null, from: message.payload?.payload?.from ?? null })
        for (const other of sockets) {
          if (other !== socket && other.topics?.has(message.topic)) sendTo(other, { topic: message.topic, event: 'broadcast', payload: message.payload })
        }
      }
    }
  })
  socket.on('close', () => sockets.delete(socket))
  socket.on('error', () => sockets.delete(socket))
}

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

const readRaw = (req) => new Promise((resolve) => {
  const parts = []
  req.on('data', (chunk) => parts.push(chunk))
  req.on('end', () => resolve(Buffer.concat(parts).toString()))
})

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
  if (path === '/__broadcast') {
    const { event, payload } = await readBody(req)
    if (event === 'message:new' && payload?.message && payload?.conversation) {
      threadOf(payload.conversation.id).push(payload.message)
      Object.assign(CHATS.find((c) => c.id === payload.conversation.id) ?? {}, payload.conversation)
    }
    for (const socket of sockets) sendTo(socket, { topic: 'realtime:wa-inbox', event: 'broadcast', payload: { type: 'broadcast', event, payload } })
    return json(res, 200, { sockets: sockets.size })
  }
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
    log('otp_verified', { email: body.email ?? null })
    return json(res, 200, issueSession(body.email === HELPER.email ? HELPER : USER))
  }
  if (path === '/auth/v1/token') {
    const body = await readBody(req)
    if (!sessions.has(body.refresh_token)) { log('refresh_rejected'); return json(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }) }
    const user = tokenUsers.get(sessions.get(body.refresh_token)) ?? USER
    sessions.delete(body.refresh_token)
    log('session_refreshed')
    return json(res, 200, issueSession(user))
  }
  if (path === '/auth/v1/logout') {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    for (const [refresh, access] of sessions) if (access === token) sessions.delete(refresh)
    log('logout')
    return json(res, 204)
  }
  if (path === '/auth/v1/user') return liveToken(req) ? json(res, 200, userOf(req)) : json(res, 401, { code: 401, msg: 'invalid JWT' })

  if (path.startsWith('/api/whatsapp/media/photo-')) {
    log('photo_fetched', { path, ticket: url.searchParams.get('t') })
    const photo = readFileSync(join(here, '../../assets/brand/logo.png'))
    return res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': photo.length, ...CORS }).end(photo)
  }
  if (path === '/api/whatsapp/media/last-upload' && lastUpload) {
    log('upload_fetched', { path })
    return res.writeHead(200, { 'Content-Type': lastUpload.type, 'Content-Length': lastUpload.value.length, ...CORS }).end(lastUpload.value)
  }
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
      const who = userOf(req)
      return json(res, 200, {
        status: 'active', user_id: who.id, email: who.email, full_name: who === HELPER ? 'Helper Person' : 'Local Owner',
        role: 'owner', system_role: 'owner', permissions: PERMISSIONS, preferences: SETTINGS.preferences, theme: SETTINGS.theme,
      })
    }
    if (path === '/rest/v1/rpc/get_settings') return json(res, 200, { organization: SETTINGS.organization, lists: SETTINGS.lists })
    if (path.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
      const answer = settingsRpc(path.slice('/rest/v1/rpc/'.length), (await readBody(req)) ?? {})
      if (answer) return answer[0] === 204 ? json(res, 204) : json(res, answer[0], answer[1])
    }
    if (path === '/rest/v1/rpc/touch_session') return json(res, 200, 'ok')
    // A long list on paper, so the pagination controls have many pages to lay out.
    if (path === '/rest/v1/clients') return clientsRoute(req, res, url)
    if (path === '/rest/v1/salesorder' || path === '/rest/v1/salesorderdocument') return salesOrdersRoute(req, res, url, path)
    if (path.startsWith('/rest/v1/rpc/')) return json(res, 200, null)
    // A pretend campaign send: batches of 40, logged, nothing leaves this machine.
    if ((path === '/api/campaigns/send' || path === '/api/campaigns/send-batch') && req.method === 'POST') {
      const body = await readBody(req)
      const ids = Array.isArray(body?.contactIds) ? body.contactIds : []
      if (!ids.length) return json(res, 400, { success: false, error: { message: 'contactIds is required' } })
      const campaignId = path.endsWith('/send') ? 900 : body.campaignId
      log(path.endsWith('/send') ? 'campaign_send' : 'campaign_batch', {
        campaignId, requestId: body.requestId ?? null, name: body.name ?? null, template: body.templateName, count: ids.length,
      })
      return json(res, 200, { success: true, data: { campaignId, sent: Math.min(40, ids.length), failed: 0, remaining: ids.slice(40) } })
    }
    // Vendor writes, one row back as PostgREST answers with return=representation.
    if ((path === '/rest/v1/vendors' || path === '/rest/v1/vendor_addresses') && (req.method === 'POST' || req.method === 'PATCH')) {
      const body = await readBody(req)
      const table = path.endsWith('vendors') ? VENDORS : VENDOR_ADDRESSES
      let row
      if (req.method === 'POST') {
        row = { ...body, id: Math.max(0, ...table.map((r) => r.id)) + 1, created_at: new Date().toISOString() }
        table.push(row)
      } else {
        const id = Number(String(url.searchParams.get('id') ?? '').replace('eq.', ''))
        row = table.find((r) => r.id === id)
        if (!row) return json(res, 406, { code: 'PGRST116', message: 'no rows' })
        Object.assign(row, body)
      }
      log(path.endsWith('vendors') ? `vendor_${req.method === 'POST' ? 'insert' : 'update'}` : `vendor_address_${req.method === 'POST' ? 'insert' : 'update'}`, { id: row.id, company: row.company_name ?? null, city: row.city ?? null })
      return json(res, req.method === 'POST' ? 201 : 200, row)
    }
    // The email inbox: one connected mailbox, two conversations, a message with HTML,
    // a link and an attachment. Sends are logged, never sent.
    if (path.startsWith('/api/email/') && EMAIL_ROUTE.test(path)) {
      const ok = (data) => json(res, 200, { success: true, data })
      const raw = req.method === 'GET' ? '' : await readRaw(req)
      if (path === '/api/email/accounts') return ok({ mailboxes: [EMAIL.mailbox], can_connect_personal: true, can_manage_shared: true, shared_setup: [] })
      // Email settings. Google is "set up"; its consent page is never real here.
      if (path === '/api/email/status') return ok({ gmail: { configured: true, push: false }, hostinger: { configured: false }, delivery: { provider: 'brevo', brevo: { configured: true }, ses: { configured: false } } })
      if (path === '/api/email/oauth/google/start') {
        log('email_connect_start', { account: JSON.parse(raw || '{}').account_id ?? null })
        return ok({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=local-test&state=local' })
      }
      if (path === '/api/email/directory') return ok([{ user_id: HELPER.id, full_name: 'Helper Person', has_inbox: true }])
      if (path === `/api/email/accounts/${EMAIL.mailbox.id}/routing`) return ok({ inbound: 'direct', note: 'Incoming mail for example.test is delivered to Google Workspace.', mx: [{ host: 'smtp.google.com' }] })
      const member = path.match(new RegExp(`^/api/email/accounts/${EMAIL.mailbox.id}/members(?:/([0-9a-f-]{36}))?$`))
      if (member) {
        if (req.method === 'PUT' && member[1]) {
          const role = JSON.parse(raw || '{}').role
          log('email_member', { user: member[1], role })
          const known = EMAIL_MEMBERS.find((m) => m.user_id === member[1])
          if (known) known.role = role
          else EMAIL_MEMBERS.push({ user_id: member[1], full_name: member[1] === HELPER.id ? 'Helper Person' : 'Someone', role, active: true, is_owner: false, granted_by_name: 'Local Owner' })
        }
        if (req.method === 'DELETE' && member[1]) {
          log('email_member', { user: member[1], role: null })
          EMAIL_MEMBERS.splice(EMAIL_MEMBERS.findIndex((m) => m.user_id === member[1]), 1)
        }
        return ok({ members: EMAIL_MEMBERS, can_configure: true })
      }
      if (path === '/api/email/threads') return ok({ threads: EMAIL.threads, has_more: false })
      if (path === '/api/email/recipients') return json(res, 200, { success: true, data: [] })
      if (path.endsWith('/send-as')) return ok({ identities: [] })
      if (path.endsWith('/labels') && req.method === 'GET') return ok({ labels: [{ id: 'Label_1', name: 'Quotes' }] })
      const thread = EMAIL.threads.find((t) => path.startsWith(`/api/email/threads/${t.id}`))
      if (thread && path.endsWith('/labels')) {
        const body = JSON.parse(raw || '{}')
        log('email_labels', { thread: thread.id, add: body.add ?? [], remove: body.remove ?? [] })
        if ((body.remove ?? []).includes('UNREAD')) thread.unread = false
        if ((body.add ?? []).includes('UNREAD')) thread.unread = true
        thread.label_ids = [...new Set([...(thread.label_ids ?? []), ...(body.add ?? [])])].filter((l) => !(body.remove ?? []).includes(l))
        return ok({ label_ids: thread.label_ids, unread: thread.unread, starred: thread.label_ids.includes('STARRED') })
      }
      if (thread && path.endsWith('/notes')) { log('email_note', { thread: thread.id }); return ok({ id: randomUUID(), author_name: 'Local Owner', body: JSON.parse(raw).body, created_at: new Date().toISOString() }) }
      if (thread && path.endsWith('/crm')) return ok({ records: [], can_view: { client: true, vendor: true, lead: true } })
      if (thread && path.includes('/attachments/')) {
        log('email_attachment', { thread: thread.id })
        const body = Buffer.from('%PDF-1.4\n%%EOF\n')
        return res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, ...CORS }).end(body)
      }
      if (thread && req.method === 'PATCH') {
        const patch = JSON.parse(raw || '{}')
        log('email_workflow', { thread: thread.id, ...patch })
        Object.assign(thread, patch)
        return ok(patch)
      }
      if (thread) return ok(emailThreadDetail(thread))
      // Campaigns and templates: drafts are kept for the run, nothing is ever sent.
      if (path === '/api/email/campaigns' && req.method === 'GET') {
        return ok({
          campaigns: EMAIL_CAMPAIGNS, readiness: { ready: false, missing: ['a campaign sender'], scheduler: false }, senders: [],
          sender_mailboxes: [{ id: EMAIL.mailbox.id, email_address: EMAIL.mailbox.email_address, provider: 'google', sent_today: 0, daily_cap: 200 }],
          variables: { first_name: 'First name', company: 'Company' }, max_recipients: 5000,
        })
      }
      if (path === '/api/email/campaigns' && req.method === 'POST') {
        const fields = JSON.parse(raw || '{}')
        const campaign = { ...fields, id: randomUUID(), status: 'draft', can_edit: true, can_approve: true, created_by: userOf(req).id, created_by_name: 'Local Owner', updated_at: new Date().toISOString(), history: [] }
        EMAIL_CAMPAIGNS.push(campaign)
        log('email_campaign_saved', { name: fields.name, sources: fields.audience?.sources ?? [], html: fields.html, subject: fields.subject })
        return ok(campaign)
      }
      const campaign = EMAIL_CAMPAIGNS.find((c) => path === `/api/email/campaigns/${c.id}`)
      if (campaign && req.method === 'GET') return ok(campaign)
      if (campaign && req.method === 'PUT') {
        Object.assign(campaign, JSON.parse(raw || '{}'), { updated_at: new Date().toISOString() })
        log('email_campaign_saved', { name: campaign.name, sources: campaign.audience?.sources ?? [], html: campaign.html, subject: campaign.subject })
        return ok(campaign)
      }
      if (path === '/api/email/preferences') {
        const consentOf = (email) => ({ email, marketing: null, marketing_source: null, marketing_note: null, marketing_changed_at: null, marketing_changed_by_name: null, suppressed: false, suppressed_reason: null, suppressed_at: null, ...CONSENT.get(email) })
        if (req.method === 'GET') {
          const email = (new URL(req.url, 'http://localhost').searchParams.get('email') ?? '').trim().toLowerCase()
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(res, 400, { success: false, error: { message: 'Enter a valid email address.' } })
          return ok(consentOf(email))
        }
        const body = JSON.parse(raw || '{}')
        const email = String(body.email ?? '').trim().toLowerCase()
        if (body.marketing === 'subscribed' && !['form', 'verbal', 'written', 'imported'].includes(body.source)) {
          return json(res, 400, { success: false, error: { message: 'Say how this person agreed to receive marketing email (form, verbal, written or imported).' } })
        }
        const next = consentOf(email)
        if ('marketing' in body) Object.assign(next, { marketing: body.marketing, marketing_source: body.source ?? 'request', marketing_note: body.note ?? null, marketing_changed_at: new Date().toISOString(), marketing_changed_by_name: 'Local Owner' })
        if (body.suppress === true) Object.assign(next, { suppressed: true, suppressed_reason: 'manual', suppressed_at: new Date().toISOString() })
        if (body.unsuppress === true) Object.assign(next, { suppressed: false, suppressed_reason: null, suppressed_at: null })
        CONSENT.set(email, next)
        log('email_consent', { email, marketing: body.marketing, source: body.source, note: body.note, suppress: body.suppress, unsuppress: body.unsuppress })
        return ok(next)
      }
      if (path === '/api/email/audience/options') return ok({ countries: ['India'], states: ['Gujarat', 'Maharashtra'], cities: ['Surat', 'Pune'], media: [{ id: 1, name: 'Outdoor' }], sub_media: [{ id: 1, name: 'Hoarding', media_id: 1 }] })
      if (path === '/api/email/audience/preview') {
        const audience = JSON.parse(raw || '{}').audience ?? {}
        const n = (audience.sources ?? []).length * 40
        return ok({ eligible: n, matched: n + 12, no_consent: 10, unsubscribed: 1, suppressed: 1, by_source: Object.fromEntries((audience.sources ?? []).map((s) => [s, 40])), can_use: { client: true, vendor: true, lead: true }, sample: [{ name: 'Asha Rao', email: 'asha@client.test', company: 'Client Co' }] })
      }
      if (path === '/api/email/templates') return ok({ templates: [{ id: 'tpl-1', name: 'Rate card', kind: 'marketing', subject: 'Our rates', version: 1, updated_at: new Date().toISOString() }], variables: { marketing: { first_name: 'First name' }, transactional: {} } })
      if (path === '/api/email/templates/tpl-1') return ok({ id: 'tpl-1', name: 'Rate card', kind: 'marketing', subject: 'Our rates for {{first_name}}', preheader: '', html: '<p>Our December rates.</p>', version: 1, versions: [{ version: 1, saved_by_name: 'Local Owner', saved_at: new Date().toISOString() }] })
      if (path.endsWith('/send')) {
        const field = (name) => (raw.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`)) ?? [])[1] ?? null
        log('email_send', { mode: field('mode'), to: field('to'), subject: field('subject'), thread: field('thread_id'), sendId: field('send_id') })
        return ok({ status: 'sent', message_id: 'm-local' })
      }
      // Anything else (a mailbox's settings) falls through to the empty answers below.
    }
    // Live Assist: sessions between the app (the employee) and a browser (the helper),
    // each side told over its own staff channel, as src/api/routes/assist does.
    if (path.startsWith('/api/assist/')) {
      const ok = (data, status = 200) => json(res, status, { success: true, data })
      const me = userOf(req)
      const body = req.method === 'GET' ? null : await readBody(req)
      const notice = (session) => ({
        id: session.id, status: session.status, helper_id: session.helper_id, helper_name: session.helper_name,
        employee_id: session.employee_id, employee_name: session.employee_name, expires_at: session.expires_at,
        end_reason: session.end_reason ?? null, from_help_request: Boolean(session.help_request_id),
      })
      if (path === '/api/assist/state') return ok({ incoming: null, sessions: [], help_requests: [], my_help_request: null })
      if (path === '/api/assist/helpers') return ok(STAFF.filter((m) => m.user_id !== me.id && m.status === 'active' && m.online).map((m) => ({ user_id: m.user_id, full_name: m.full_name, online: true, busy: false })))
      if (path === '/api/assist/sessions' && req.method === 'POST') {
        const nameOf = (id) => STAFF.find((m) => m.user_id === id)?.full_name ?? 'Someone'
        const session = {
          id: randomUUID(), status: 'requested', helper_id: me.id, helper_name: nameOf(me.id), employee_id: body.employee_id,
          employee_name: nameOf(body.employee_id), expires_at: new Date(Date.now() + 60_000).toISOString(), help_request_id: body.help_request_id ?? null,
        }
        ASSIST.set(session.id, session)
        log('assist_start', { helper: me.id, employee: body.employee_id })
        staffBroadcast(session.employee_id, 'assist_request', notice(session))
        return ok(notice(session), 201)
      }
      const match = path.match(/^\/api\/assist\/sessions\/([^/]+)\/(respond|end)$/)
      if (match && req.method === 'POST') {
        const session = ASSIST.get(match[1])
        if (!session) return json(res, 404, { success: false, error: { message: 'Not found' } })
        if (match[2] === 'respond') {
          session.status = body.accept === true ? 'active' : 'ended'
          if (body.accept !== true) session.end_reason = 'declined'
          log('assist_respond', { accept: body.accept === true })
          staffBroadcast(session.helper_id, 'assist_response', notice(session))
        } else {
          session.status = 'ended'
          session.end_reason = body.reason === 'connection_lost' ? 'connection_lost' : me.id === session.helper_id ? 'helper_ended' : 'employee_ended'
          log('assist_end', { by: me.id === session.helper_id ? 'helper' : 'employee', reason: session.end_reason })
          for (const id of [session.helper_id, session.employee_id]) staffBroadcast(id, 'assist_ended', notice(session))
        }
        return ok(notice(session))
      }
      if (path === '/api/assist/help' && req.method === 'POST') {
        const request = { id: randomUUID(), requester_id: me.id, requester_name: STAFF.find((m) => m.user_id === me.id)?.full_name ?? 'Someone', message: body.message ?? null, section: body.section ?? null, created_at: new Date().toISOString(), for_you: Boolean(body.helper_id) }
        log('assist_help', { message: request.message, section: request.section, helper: body.helper_id ?? null })
        const helpers = body.helper_id ? [body.helper_id] : STAFF.filter((m) => m.user_id !== me.id && m.status === 'active').map((m) => m.user_id)
        for (const id of helpers) staffBroadcast(id, 'help_request', request)
        return ok({ request_id: request.id, already_open: false, expires_at: new Date(Date.now() + 900_000).toISOString(), helper_id: body.helper_id ?? null, helper_name: null, helpers_notified: helpers.length }, 201)
      }
      if (path.startsWith('/api/assist/help/') && path.endsWith('/cancel')) { log('assist_help_cancel'); return ok({ cancelled: true }) }
      return json(res, 404, { success: false, error: { message: 'Not found' } })
    }
    // User Management: a few synthetic people, the catalog, and the changes logged.
    if (path === '/api/users' || path.startsWith('/api/users/')) {
      const ok = (data) => json(res, 200, { success: true, data })
      if (path === '/api/users' && req.method === 'GET') return ok(STAFF)
      if (path === '/api/users/catalog') return ok(USER_CATALOG)
      if (path === '/api/users/audit') return ok([])
      // /api/users/me is the signed-in person, as the API answers it.
      const self = path.split('/')[3] === 'me'
      const id = self ? USER.id : path.split('/')[3]
      const body = req.method === 'GET' ? null : await readBody(req)
      if (path.endsWith('/permissions')) { log('user_permissions', { id, overrides: body?.overrides }); return ok({ ...STAFF.find((m) => m.user_id === id), overrides: body?.overrides ?? {} }) }
      if (path.endsWith('/status')) { log('user_status', { id, status: body?.status, reason: body?.reason ?? null }); return ok({ user: STAFF.find((m) => m.user_id === id), sign_in_updated: true }) }
      if (path.endsWith('/sign-out')) { log('user_sign_out', { id, session: body?.session_id ?? null }); return ok({ sessions_ended: 1 }) }
      const member = STAFF.find((m) => m.user_id === id)
      if (!member) return json(res, 404, { success: false, error: { message: 'Not found' } })
      return ok({
        ...member,
        permissions: { 'clients.view': { scope: 'all', source: 'template' } },
        sessions: [
          { session_id: '11111111-2222-4333-8444-555555555555', user_agent: 'DikhoCRM/1.1.0 (Android)', city: 'Pune', region: 'Maharashtra', country: 'IN', signed_in_at: '2026-11-17T04:00:00Z', last_seen_at: '2026-11-17T05:00:00Z', current: self },
          ...(self ? [{ session_id: '11111111-2222-4333-8444-666666666666', user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36', city: 'Mumbai', region: 'Maharashtra', country: 'IN', signed_in_at: '2026-11-16T04:00:00Z', last_seen_at: '2026-11-16T05:00:00Z', current: false }] : []),
        ],
        recent_sign_ins: [],
      })
    }
    // Contacts read and checked on the phone; only clean rows arrive. Logged, then kept.
    if (path === '/api/contacts/import-rows' && req.method === 'POST') {
      const body = await readBody(req)
      const list = Array.isArray(body?.contacts) ? body.contacts : []
      log('contacts_import', { count: list.length, phones: list.map((c) => c.phone), names: list.map((c) => c.name), attributes: list.map((c) => c.attributes) })
      let imported = 0
      for (const c of list) {
        if (CONTACTS.some((x) => x.phone === c.phone)) continue
        CONTACTS.unshift({ id: Math.max(0, ...CONTACTS.map((x) => x.id)) + 1, name: c.name, phone: c.phone, email: c.email, company: c.company, attributes: c.attributes, opted_out: 0, created_at: new Date().toISOString().replace('T', ' ').slice(0, 19) })
        imported += 1
      }
      return json(res, 200, { success: true, data: { received: list.length, imported, updated: 0, unchanged: list.length - imported, duplicates: 0, invalid: 0, optedOut: 0, contacts: [] } })
    }
    if (path === '/api/contacts' && req.method === 'DELETE') {
      const body = await readBody(req)
      const ids = body?.all === true ? CONTACTS.map((c) => c.id) : (Array.isArray(body?.contactIds) ? body.contactIds.map(Number) : [])
      if (!ids.length) return json(res, 400, { success: false, error: { message: 'Provide contactIds (array) or { all: true }' } })
      for (const id of ids) {
        const at = CONTACTS.findIndex((c) => c.id === id)
        if (at >= 0) CONTACTS.splice(at, 1)
      }
      log('contacts_deleted', { ids: body.all === true ? 'all' : ids })
      return json(res, 200, { success: true, data: { deleted: body.all === true ? 'all' : ids.length } })
    }
    const fixture = moduleFixture(path, url)
    if (fixture?.rows) return json(res, 200, fixture.rows, { 'Content-Range': fixture.range })
    if (fixture?.data) return json(res, 200, { success: true, data: fixture.data })
    if (fixture?.error) return json(res, fixture.status, { success: false, error: { message: fixture.error } })
    if (path === '/rest/v1/cg_leads') return leadsRoute(req, res, url)
    if (path.startsWith('/rest/v1/')) return json(res, 200, [], { 'Content-Range': '*/0' })
    if (path.startsWith('/api/whatsapp/') || path === '/api/templates') {
      const handled = await inboxRoute(req, res, path, url)
      if (handled !== null) return handled
    }
    return json(res, 200, { success: true, data: {} })
  }

  json(res, 404, { error: 'not_found' })
}).on('upgrade', upgradeRealtime).listen(54321, '127.0.0.1')

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
