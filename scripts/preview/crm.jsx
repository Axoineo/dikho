// Preview harness: Clients, Vendors, Sales Orders and Purchase Orders inside
// the real app shell (sidebar + workspace), against an in-memory stand-in for
// PostgREST. Nothing leaves the browser: fetch is replaced before any app
// module loads, and WebSocket is stubbed so no realtime socket is opened.
//
//   /scripts/preview/crm.html?page=/clients            (or /vendors, …)
//   ?page=/settings/company   Settings (any section)
//   &role=viewer   only *.view permissions, to check hidden Add/Edit and
//                  that Organization settings stay out of reach
//   &db=old        answer like a database without the settings migration
//   &theme=dark    start in the dark theme
//
// Writes (insert, update, delete) change the in-memory tables, so add and edit
// round trips can be exercised end to end. Reload to reset.
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
// Same stylesheets, in the same order, as src/main.jsx.
import '../../src/index.css'
import '../../src/components/ContactDetails.css'
import '../../src/tailwind.css'

/* ── Sample data (fictional) ────────────────────────────────────────────── */

const CITIES = [
  { city: 'Ahmedabad', state: 'Gujarat', pincode: '380009' },
  { city: 'Mumbai', state: 'Maharashtra', pincode: '400013' },
  { city: 'Bengaluru', state: 'Karnataka', pincode: '560034' },
  { city: 'Pune', state: 'Maharashtra', pincode: '411001' },
  { city: 'New Delhi', state: 'Delhi', pincode: '110001' },
  { city: 'Surat', state: 'Gujarat', pincode: '395007' },
]
const PEOPLE = ['Aarav Mehta', 'Nisha Rao', 'Vikram Chandra', 'Priya Nair', 'Rohit Sharma', 'Meera Iyer', 'Kabir Shah', 'Ananya Desai']
const COMPANIES = [
  'Aarav Retail Group Pvt Ltd', 'Bluewave Beverages Ltd', 'Chandra Motors India', 'Deccan Foods Pvt Ltd',
  'Everest Realty LLP', 'Freshly Dairy Products', 'Ganga Textiles Ltd', 'Horizon Hospitals', 'Indus Paints Pvt Ltd',
  'Jaipur Jewels Co', 'Kaveri Electronics', 'Lotus Events & Weddings', 'Mahindra Tractors Dealer Network',
  'Narmada Cement Works', 'Orchid Hotels & Resorts', 'Pinnacle Finance Ltd',
]

const CLIENTS = Array.from({ length: 42 }, (_, index) => {
  const place = CITIES[index % CITIES.length]
  const company = COMPANIES[index % COMPANIES.length] + (index >= COMPANIES.length ? ` (${place.city})` : '')
  return {
    id: 300 + index,
    type: null,
    company_name: company,
    country_dialcode: 91,
    contact: 9876500000 + index * 137,
    email: `purchase${index + 1}@${COMPANIES[index % COMPANIES.length].split(' ')[0].toLowerCase()}.example.com`,
    alias: null,
    gstin: index % 5 === 3 ? null : `${['24', '27', '29', '27', '07', '24'][index % 6]}AAACA${String(4100 + index).padStart(4, '0')}F1Z${index % 9}`,
    gstin_date: index % 5 === 3 ? null : '2019-07-01',
    registration: index % 5 === 3 ? 'Unregistered' : 'Registered',
    pan_number: `AAACA${String(4100 + index).padStart(4, '0')}F`,
    status: index % 7 === 6 ? 0 : 1,
    tds_percentage: index % 3 === 0 ? '2' : null,
    tds_section: index % 3 === 0 ? '194C' : null,
    contact_person: PEOPLE[index % PEOPLE.length],
    designation: ['Marketing Head', 'Procurement Manager', 'Brand Manager', 'Director'][index % 4],
    address_line1: `${12 + index}, ${['MG Road', 'Ring Road', 'Linking Road', 'CG Road'][index % 4]}`,
    address_line2: index % 2 === 0 ? 'Near City Mall' : null,
    city: place.city,
    state: place.state,
    pincode: place.pincode,
    country: 'India',
  }
}).reverse()

const MEDIA = [{ id: 1, name: 'Hoarding' }, { id: 2, name: 'Digital' }, { id: 3, name: 'Transit' }, { id: 4, name: 'Print' }]
const SUB_MEDIA = [
  { id: 10, name: 'Banner', media_id: 1 }, { id: 11, name: 'Unipole', media_id: 1 },
  { id: 12, name: 'LED Wall', media_id: 2 }, { id: 13, name: 'Social', media_id: 2 },
  { id: 14, name: 'Bus Shelter', media_id: 3 }, { id: 15, name: 'Metro Branding', media_id: 3 },
  { id: 16, name: 'Newspaper', media_id: 4 },
]
const VENDOR_NAMES = ['Skyline Outdoor', 'Metro Media Works', 'Prime Hoardings', 'Vista Digital Screens', 'Orbit Transit Ads', 'Sunrise Printers', 'Bharat Unipoles', 'CityLights LED']
const VENDOR_PLACES = [
  { country: 'India', state: 'Gujarat', city: 'Ahmedabad', zipcode: '380009' },
  { country: 'India', state: 'Gujarat', city: 'Surat', zipcode: '395007' },
  { country: 'India', state: 'Maharashtra', city: 'Mumbai', zipcode: '400013' },
  { country: 'India', state: 'Karnataka', city: 'Bengaluru', zipcode: '560034' },
  { country: 'United Arab Emirates', state: 'Dubai', city: 'Dubai', zipcode: '00000' },
]

const VENDORS = []
const VENDOR_ADDRESSES = []
for (let index = 0; index < 38; index += 1) {
  const media = MEDIA[index % MEDIA.length]
  const subs = SUB_MEDIA.filter((item) => item.media_id === media.id)
  const place = VENDOR_PLACES[index % VENDOR_PLACES.length]
  const id = 1000 + index
  VENDORS.push({
    id,
    company_name: `${VENDOR_NAMES[index % VENDOR_NAMES.length]}${index >= VENDOR_NAMES.length ? ` ${place.city}` : ''} Pvt Ltd`,
    alias: index % 3 === 0 ? `${VENDOR_NAMES[index % VENDOR_NAMES.length].split(' ')[0]} ${place.city}` : null,
    contact_person: PEOPLE[(index + 3) % PEOPLE.length],
    country_dialcode: place.country === 'India' ? 91 : 971,
    contact: String(9825000000 + index * 211),
    email: `accounts${index + 1}@${VENDOR_NAMES[index % VENDOR_NAMES.length].split(' ')[0].toLowerCase()}.example.com`,
    gstin: place.country === 'India' ? `24AAACS${1000 + index}Q1Z${index % 10}` : null,
    gstin_date: null,
    pan_number: `AAACS${1000 + index}Q`,
    registration: 'Registered',
    vendor_type: index % 4 === 1 ? 'Individual' : 'Organization',
    media_id: media.id,
    sub_media_id: subs[index % subs.length].id,
    status: index % 6 === 5 ? 0 : 1,
    payment_term_type: index % 2 ? 'Campaign End Date' : 'Invoice Date',
    payment_term_value: [30, 45, 60][index % 3],
    tds_percentage: '1',
    tds_section: '194C',
    vendor_bank_name: 'HDFC Bank',
    vendor_ifsc_code: 'HDFC0001234',
    vendor_account_number: `5010${String(1000000 + index * 77).padStart(8, '0')}`,
    vendor_confirm_account_number: `5010${String(1000000 + index * 77).padStart(8, '0')}`,
    vendor_document_file_name: index % 4 === 0 ? 'gst-certificate.pdf' : null,
    vendor_document_file_path: index % 4 === 0 ? `vendors/${id}/gst-certificate.pdf` : null,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-20T10:00:00Z',
  })
  VENDOR_ADDRESSES.push({ id: 5000 + index, vendor_id: id, address: `${index + 4}, Industrial Estate`, ...place, country_code: place.country === 'India' ? 'IN' : 'AE', is_default: true })
}
VENDORS.reverse()

const SO_STATUSES = ['Draft', 'Pending Approval', 'Approved', 'In Progress', 'Completed', 'Cancelled']
const PURCHASE = ['Not Started', 'Partial', 'Completed']
const BRANDS = ['Freshly', 'Zenith', 'Motorline', 'Spicebox', 'Skyline Homes']
const ITEM_NAMES = ['Prime time TV spot', 'Metro station branding', 'Instagram reel bundle', 'Airport unipole', 'Radio jingle 30s', 'Hoarding 40x20 ft']

const SALESORDER = []
const ITEMS = []
let nextItemId = 90000
for (let index = 0; index < 47; index += 1) {
  const client = CLIENTS[index % 12]
  const subTotal = 125000 + index * 8450
  const taxTotal = Math.round(subTotal * 0.18 * 100) / 100
  const month = String((index % 9) + 1).padStart(2, '0')
  const id = 5001 + index
  SALESORDER.push({
    id,
    crm_reference_id: `CRM-2026-${String(index + 1).padStart(4, '0')}`,
    company: client.company_name,
    order_client_fullname: client.contact_person,
    order_type: ['ATL', 'TTL', 'BTL'][index % 3],
    unique_id: `SO-U-${id}`,
    order_number: `SO/2026/${String(index + 1).padStart(4, '0')}`,
    order_date: `2026-${month}-1${index % 9}`,
    invoice_date: index % 3 === 0 ? `2026-${month}-2${index % 8}` : null,
    sub_total: subTotal,
    tax_total: taxTotal,
    total: Math.round((subTotal + taxTotal) * 100) / 100,
    campaign_start_date: `2026-${month}-01`,
    campaign_end_date: `2026-${month}-2${index % 8}`,
    created_by: 'ops@dikho.example.com',
    created_by_id: 'preview-user',
    approved_by: index % 4 === 0 ? 'Meera Iyer' : null,
    approved_date: index % 4 === 0 ? `2026-${month}-05` : null,
    order_status: SO_STATUSES[index % SO_STATUSES.length],
    purchase_status: PURCHASE[index % PURCHASE.length],
    complete_date: index % 6 === 4 ? `2026-${month}-28` : null,
    order_color: index % 9 === 0 ? '#f9af1b' : null,
    created_at: '2026-01-04T09:12:00Z',
    updated_at: '2026-08-01T11:40:00Z',
    multi_purpose_so: index % 7 === 0,
    brand_name: BRANDS[index % BRANDS.length],
    invoice_courier: index % 3 === 0 ? 'Bluedart' : null,
    payment_receipt_amount: index % 2 === 0 ? Math.round(subTotal * 0.4 * 100) / 100 : null,
    vendor_address_id: null,
  })
  const count = (index % 3) + 1
  for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
    const taxable = Math.round((subTotal / count) * 100) / 100
    const tax = Math.round(taxable * 0.18 * 100) / 100
    const half = Math.round((tax / 2) * 100) / 100
    const interState = itemIndex % 2 === 1
    nextItemId += 1
    ITEMS.push({
      id: nextItemId, sales_order_id: id, purchase_order_id: null, so_item_id: null,
      type: ['Media', 'Production', 'Printing'][itemIndex % 3],
      name: ITEM_NAMES[(index + itemIndex) % ITEM_NAMES.length],
      short_name: `L${itemIndex + 1}`, label: 'Campaign line', reference_type: 'Sales Order',
      date: `2026-${month}-01`, invoice_number: itemIndex === 0 ? `INV/${id}/1` : null,
      is_taxable: true, gst_type: interState ? 'Inter-State' : 'Intra-State',
      taxable_amount: taxable, utgst_amount: 0,
      igst_amount: interState ? tax : 0, sgst_amount: interState ? 0 : Math.round((tax - half) * 100) / 100, cgst_amount: interState ? 0 : half,
      tax_amount: tax, after_tax_amount: Math.round((taxable + tax) * 100) / 100,
      document_color: null, document_note: itemIndex === 0 ? 'Rate card attached; client approved on call.' : null,
      self_audit_completed: itemIndex === 0, file_url: null, document_courier: null, courier_status: null,
      inv_id: null, inv_number: null, created_at: '2026-01-04T09:12:00Z', updated_at: '2026-08-01T11:40:00Z',
    })
  }
}

// Purchase orders: salesorder rows with a vendor address (the convention the
// RLS policies use), their items pointing at an SO through sales_order_id and
// at the PO through purchase_order_id.
for (let index = 0; index < 14; index += 1) {
  const so = SALESORDER[index * 3]
  const address = VENDOR_ADDRESSES[(index * 5) % VENDOR_ADDRESSES.length]
  const vendor = VENDORS.find((row) => row.id === address.vendor_id)
  const soItem = ITEMS.find((row) => row.sales_order_id === so.id)
  const taxable = Math.round(soItem.taxable_amount * 0.72 * 100) / 100
  const tax = Math.round(taxable * 0.18 * 100) / 100
  const id = 7001 + index
  SALESORDER.push({
    ...so,
    id,
    order_number: `PO/2026/${String(index + 1).padStart(4, '0')}`,
    unique_id: `PO-U-${id}`,
    company: vendor.company_name,
    order_client_fullname: vendor.company_name,
    sub_total: taxable, tax_total: tax, total: Math.round((taxable + tax) * 100) / 100,
    payment_receipt_amount: index % 3 === 0 ? Math.round(taxable * 0.5 * 100) / 100 : null,
    multi_purpose_so: false,
    purchase_status: null,
    vendor_address_id: address.id,
  })
  nextItemId += 1
  ITEMS.push({
    ...soItem, id: nextItemId, purchase_order_id: id, so_item_id: soItem.id,
    reference_type: 'Purchase Order', taxable_amount: taxable, tax_amount: tax,
    igst_amount: soItem.igst_amount ? tax : 0, sgst_amount: soItem.igst_amount ? 0 : Math.round(tax / 2 * 100) / 100,
    cgst_amount: soItem.igst_amount ? 0 : Math.round(tax / 2 * 100) / 100,
    after_tax_amount: Math.round((taxable + tax) * 100) / 100,
  })
}

// The legacy flattened `purchaseorders` table, filled from the rows above so
// the page that still reads it has something to show.
const PURCHASEORDERS = SALESORDER.filter((row) => row.vendor_address_id).map((row) => {
  const address = VENDOR_ADDRESSES.find((item) => item.id === row.vendor_address_id)
  const vendor = VENDORS.find((item) => item.id === address.vendor_id)
  const item = ITEMS.find((entry) => entry.purchase_order_id === row.id)
  const so = SALESORDER.find((entry) => entry.id === item?.sales_order_id)
  return {
    ...row, order_sales_number: so?.order_number, order_vendor_fullname: vendor.contact_person,
    contact_person: vendor.contact_person, alias: vendor.alias, email: vendor.email, gstin: vendor.gstin,
    pan_number: vendor.pan_number, vendor_type: vendor.vendor_type, address: address.address, city: address.city,
    state: address.state, country: address.country, zipcode: address.zipcode,
  }
})

// Corporate-gifting leads, and the WhatsApp confirmation status the Worker
// keeps for some of their numbers (keyed by digits-only country code + mobile).
const LEAD_STATUSES = ['read', 'delivered', 'sent', 'failed', null]
const CG_LEADS = Array.from({ length: 33 }, (_, index) => ({
  id: 9000 + index,
  company_name: COMPANIES[(index + 5) % COMPANIES.length],
  name: PEOPLE[(index + 2) % PEOPLE.length],
  email: `hello${index + 1}@${COMPANIES[(index + 5) % COMPANIES.length].split(' ')[0].toLowerCase()}.example.com`,
  country_code: '+91',
  mobile: String(9825100000 + index * 97),
  city: CITIES[index % CITIES.length].city,
  created_at: `2026-10-${String(28 - (index % 27)).padStart(2, '0')}T06:30:00Z`,
}))
const LEAD_WA = CG_LEADS.flatMap((lead, index) => {
  const status = LEAD_STATUSES[index % LEAD_STATUSES.length]
  return status ? [{ phone: `91${lead.mobile}`, status, error_message: status === 'failed' ? 'Message undeliverable' : null }] : []
})

const TABLES = {
  clients: CLIENTS, vendors: VENDORS, vendor_addresses: VENDOR_ADDRESSES, media: MEDIA, sub_media: SUB_MEDIA,
  salesorder: SALESORDER, salesorderdocument: ITEMS, purchaseorders: PURCHASEORDERS, cg_leads: CG_LEADS,
}
let nextId = 200000

/* ── Settings stand-in (public.get_settings() and the functions around it) ─ */

const PARAMS = new URLSearchParams(window.location.search)
const DB_OLD = PARAMS.get('db') === 'old'
if (!DB_OLD) [...MEDIA, ...SUB_MEDIA].forEach((row) => { row.hidden = false })

// The same values the migration seeds.
const SEED_LISTS = {
  order_type: ['ATL', 'TTL', 'BTL'],
  order_status: ['Draft', 'Pending Approval', 'Approved', 'In Progress', 'Completed', 'Cancelled'],
  purchase_status: ['Not Started', 'Partial', 'Completed'],
  item_type: ['Media', 'Production', 'Printing', 'Installation', 'Service', 'Other'],
  courier_status: ['Not Sent', 'Dispatched', 'In Transit', 'Delivered', 'Returned'],
  row_color: [['#185494', 'Blue'], ['#f9af1b', 'Amber'], ['#2f9e6f', 'Green'], ['#b23b43', 'Red'], ['#6c4bb6', 'Purple'], ['#6b7684', 'Slate']],
  registration: ['Registered', 'Unregistered', 'Composition', 'Other'],
}
const OPTION_LISTS = []
for (const [listKey, values] of Object.entries(SEED_LISTS)) {
  values.forEach((entry, index) => {
    const [value, label] = Array.isArray(entry) ? entry : [entry, null]
    OPTION_LISTS.push({ id: OPTION_LISTS.length + 1, list_key: listKey, value, label, sort_order: (index + 1) * 10, hidden: false })
  })
}
const ORGANIZATION = { date_format: 'd MMM yyyy', number_format: 'en-IN', updated_at: null }
// Fictional company: the real one lives only in the database.
const PROFILE = {
  legal_name: 'Sample Media LLP', gstin: '24AAAFS1234K1Z5', pan: 'AAAFS1234K', state_code: '24',
  address_line1: '4th Floor, Example Towers', address_line2: 'CG Road', city: 'Ahmedabad', state: 'Gujarat',
  pincode: '380009', country: 'India', bank_name: 'HDFC Bank', bank_account_name: 'Sample Media LLP',
  bank_account_number: '50100012345678', bank_ifsc: 'HDFC0001234', bank_branch: 'Navrangpura',
}
let PREFERENCES = {}
const MEMBER = {
  user_id: 'preview-user', full_name: 'Priya Sharma', email: 'priya@dikho.example.com', phone: '919876500001',
  system_role: 'admin', developer_level: null, designation: 'Operations Manager', department: 'Operations', team: 'Media buying',
  reporting_manager: 'Meera Iyer', employee_id: 'EMP-014', joining_date: '2024-04-01', status: 'active',
  sessions: [
    { session_id: 's1', current: true, signed_in_at: '2026-10-28T04:10:00Z', last_seen_at: new Date().toISOString(), section: 'settings', city: 'Ahmedabad', region: 'Gujarat', country: 'IN', ip: '203.0.113.10', user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36' },
    { session_id: 's2', current: false, signed_in_at: '2026-10-26T13:40:00Z', last_seen_at: '2026-10-27T17:05:00Z', section: 'clients', city: 'Mumbai', region: 'Maharashtra', country: 'IN', ip: '198.51.100.7', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  ],
  recent_sign_ins: [],
}
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

function fail(status, code, message) {
  return reply({ code, message, details: null, hint: null }, { status })
}

function saveNamed(rows, args, extra) {
  const name = args.p_name?.trim()
  const clash = name && rows.find((row) => row.name.toLowerCase() === name.toLowerCase() && row.id !== args.p_id
    && (!extra || row.media_id === (args.p_media_id ?? rows.find((item) => item.id === args.p_id)?.media_id)))
  if (clash) return fail(409, 'PT409', `"${name}" already exists`)
  let row = rows.find((item) => item.id === args.p_id)
  if (!row) {
    if (!name) return fail(400, 'PT400', 'Enter a name')
    row = { id: (nextId += 1), name, hidden: false, ...extra }
    rows.push(row)
  }
  if (name) row.name = name
  if (args.p_hidden != null) row.hidden = args.p_hidden
  return reply(row)
}

function settingsRpc(name, args) {
  if (DB_OLD) return fail(404, 'PGRST202', `Could not find the function public.${name} in the schema cache`)
  switch (name) {
    case 'get_settings':
      return reply({ organization: ORGANIZATION, lists: OPTION_LISTS })
    case 'set_my_preferences': {
      PREFERENCES = { ...PREFERENCES, ...args.p_changes }
      Object.keys(PREFERENCES).forEach((key) => { if (PREFERENCES[key] == null) delete PREFERENCES[key] })
      return reply(PREFERENCES)
    }
    case 'update_organization_settings':
      Object.assign(ORGANIZATION, args.p_changes, { updated_at: new Date().toISOString() })
      return reply(ORGANIZATION)
    case 'get_organization_profile':
      return reply(PROFILE)
    case 'update_organization_profile': {
      const next = { ...PROFILE, ...args.p_changes }
      if (next.gstin && !GSTIN.test(next.gstin)) return fail(400, 'PT400', 'GSTIN is not valid')
      if (GSTIN.test(next.gstin || '')) next.state_code = next.gstin.slice(0, 2)
      Object.assign(PROFILE, next)
      return reply(PROFILE)
    }
    case 'add_list_option': {
      const value = String(args.p_value || '').trim()
      if (OPTION_LISTS.some((row) => row.list_key === args.p_list && row.value.toLowerCase() === value.toLowerCase())) {
        return fail(409, 'PT409', 'That value is already in this list')
      }
      const order = Math.max(0, ...OPTION_LISTS.filter((row) => row.list_key === args.p_list).map((row) => row.sort_order)) + 10
      const row = { id: OPTION_LISTS.length + 1, list_key: args.p_list, value: args.p_list === 'row_color' ? value.toLowerCase() : value, label: args.p_label ?? null, sort_order: order, hidden: false }
      OPTION_LISTS.push(row)
      return reply(row)
    }
    case 'set_list_option_hidden': {
      const row = OPTION_LISTS.find((item) => item.id === args.p_id)
      row.hidden = args.p_hidden
      return reply(row)
    }
    case 'move_list_option': {
      const row = OPTION_LISTS.find((item) => item.id === args.p_id)
      const list = OPTION_LISTS.filter((item) => item.list_key === row.list_key).sort((a, b) => a.sort_order - b.sort_order)
      const other = list[list.indexOf(row) + args.p_direction]
      if (other) [row.sort_order, other.sort_order] = [other.sort_order, row.sort_order]
      return reply(row)
    }
    case 'save_media':
      return saveNamed(MEDIA, args)
    case 'save_sub_media':
      return saveNamed(SUB_MEDIA, args, { media_id: args.p_media_id ?? SUB_MEDIA.find((item) => item.id === args.p_id)?.media_id })
    default:
      return null
  }
}

/* ── User management stand-in (/api/users and its catalog) ─────────────── */

const UM_ACTIONS = ['view', 'create', 'edit', 'delete']
const UM_PERMISSIONS = [
  ...[['Clients', 'clients'], ['Leads', 'leads'], ['Vendors', 'vendors'], ['Sales Orders', 'sales_orders'], ['Purchase Orders', 'purchase_orders']]
    .flatMap(([module, key], m) => UM_ACTIONS.map((action, a) => ({
      key: `${key}.${action}`, module, action, label: `${action} ${module}`, description: null,
      allowed_scopes: key === 'sales_orders' && action !== 'create' ? ['own', 'all'] : ['all'], developer_only: false, sort_order: m * 10 + a,
    }))),
  ...[['users.view', 'View users'], ['users.create', 'Add users'], ['users.edit', 'Edit user profiles'], ['users.roles', 'Change system roles'],
    ['users.sessions', 'See sessions and force sign-out'], ['audit_logs.view', 'View the audit log'], ['live_assist.use', 'Use Live Assist']]
    .map(([key, label], i) => ({ key, module: 'User Management', action: key.split('.')[1], label, description: null, allowed_scopes: ['all'], developer_only: false, sort_order: 100 + i })),
  { key: 'settings.manage', module: 'Settings', action: 'manage', label: 'Manage organization settings', description: null, allowed_scopes: ['all'], developer_only: false, sort_order: 800 },
]
const UM_ALL = Object.fromEntries(UM_PERMISSIONS.map((p) => [p.key, 'all']))
const UM_TEMPLATES = [
  { id: 't-sales', name: 'Sales Executive', description: 'Clients, leads and their own sales orders.', built_in: true, members: 2,
    permissions: { 'clients.view': 'all', 'clients.create': 'all', 'clients.edit': 'all', 'leads.view': 'all', 'sales_orders.view': 'own', 'sales_orders.create': 'all', 'sales_orders.edit': 'own', 'vendors.view': 'all' } },
  { id: 't-ops', name: 'Operations', description: 'Vendors and purchase orders.', built_in: true, members: 1,
    permissions: { 'vendors.view': 'all', 'vendors.create': 'all', 'vendors.edit': 'all', 'purchase_orders.view': 'all', 'purchase_orders.create': 'all', 'purchase_orders.edit': 'all', 'sales_orders.view': 'all' } },
  { id: 't-admin', name: 'Administrator', description: 'Every business permission.', built_in: true, members: 1, permissions: UM_ALL },
]
const UM_DEPARTMENTS = [
  { id: 'd-sales', name: 'Sales', archived: false, members: 3, teams: [{ id: 'tm-corp', name: 'Corporate accounts', archived: false, members: 2 }, { id: 'tm-retail', name: 'Retail brands', archived: false, members: 1 }] },
  { id: 'd-ops', name: 'Operations', archived: false, members: 2, teams: [{ id: 'tm-media', name: 'Media buying', archived: false, members: 2 }] },
]
const UM_PEOPLE = [
  ['preview-user', 'Priya Sharma', 'admin', null, 'active', 'd-ops', 'tm-media', 't-admin', 'Operations manager', true],
  ['u-vikram', 'Vikram Chandra', 'staff', null, 'active', 'd-sales', 'tm-corp', 't-sales', 'Account manager', true],
  ['u-aarav', 'Aarav Mehta', 'owner', 'developer', 'active', null, null, null, 'Director', false],
  ['u-meera', 'Meera Iyer', 'manager', null, 'active', 'd-sales', 'tm-retail', 't-sales', 'Sales lead', false],
  ['u-kabir', 'Kabir Shah', 'staff', null, 'invited', 'd-ops', 'tm-media', 't-ops', 'Media planner', false],
  ['u-rohit', 'Rohit Sharma', 'staff', null, 'suspended', null, null, null, null, false],
].map(([id, name, role, dev, status, dept, team, template, designation, online], i) => ({
  user_id: id, full_name: name, email: `${name.split(' ')[0].toLowerCase()}@dikho.example.com`, phone: `9198765000${10 + i}`,
  system_role: role, developer_level: dev, status, department_id: dept, department: UM_DEPARTMENTS.find((d) => d.id === dept)?.name ?? null,
  team_id: team, team: UM_DEPARTMENTS.flatMap((d) => d.teams).find((t) => t.id === team)?.name ?? null,
  template_id: template, template: UM_TEMPLATES.find((t) => t.id === template)?.name ?? null, designation,
  employee_id: `EMP-0${14 + i}`, joining_date: '2024-04-01', online, last_seen_at: online ? new Date().toISOString() : '2026-10-27T10:00:00Z',
  last_seen_section: online ? (i === 0 ? 'settings' : 'clients') : null, last_sign_in_at: '2026-10-29T04:10:00Z',
  status_reason: status === 'suspended' ? 'Left the team' : null, status_changed_at: status === 'suspended' ? '2026-10-20T09:00:00Z' : null,
  welcome_sent_at: '2026-10-01T09:00:00Z', welcome_channel: 'email', created_at: '2026-09-01T09:00:00Z', active_sessions: online ? 1 : 0,
  reporting_manager_id: i === 1 ? 'u-meera' : null, reporting_manager: i === 1 ? 'Meera Iyer' : null,
}))
const UM_AUDIT = [
  { id: 'a1', occurred_at: '2026-10-29T11:02:00Z', event_type: 'user.template_changed', actor_id: 'preview-user', actor: 'Priya Sharma', target_user_id: 'u-vikram', target: 'Vikram Chandra', old_value: { template: 'Custom' }, new_value: { template: 'Sales Executive' }, ip: '203.0.113.10' },
  { id: 'a2', occurred_at: '2026-10-29T10:15:00Z', event_type: 'user.created', actor_id: 'u-aarav', actor: 'Aarav Mehta', target_user_id: 'u-kabir', target: 'Kabir Shah', ip: '198.51.100.7' },
  { id: 'a3', occurred_at: '2026-10-28T16:40:00Z', event_type: 'user.suspended', actor_id: 'preview-user', actor: 'Priya Sharma', target_user_id: 'u-rohit', target: 'Rohit Sharma', ip: '203.0.113.10' },
]
function umMember(id) {
  const base = UM_PEOPLE.find((m) => m.user_id === id) || UM_PEOPLE[0]
  const template = UM_TEMPLATES.find((t) => t.id === base.template_id)
  return {
    ...base,
    permissions: Object.fromEntries(Object.entries(template?.permissions ?? (base.system_role === 'owner' ? UM_ALL : {})).map(([k, s]) => [k, { scope: s }])),
    overrides: id === 'u-vikram' ? { 'vendors.create': { effect: 'grant', scope: 'all' }, 'sales_orders.edit': { effect: 'revoke', scope: null } } : {},
    can_manage: base.system_role !== 'owner',
    sessions: id === 'preview-user' ? MEMBER.sessions : [], recent_sign_ins: [],
  }
}
function usersApiReply(path, method) {
  const ok = (data) => reply({ success: true, data })
  if (method !== 'GET') return ok({})
  if (path.endsWith('/api/users')) return ok(UM_PEOPLE)
  if (path.endsWith('/api/users/catalog')) {
    return ok({
      actor: { user_id: 'preview-user', system_role: 'admin', rank: 20, permissions: UM_ALL },
      permissions: UM_PERMISSIONS, templates: UM_TEMPLATES, departments: UM_DEPARTMENTS,
      role_permissions: { admin: { 'users.view': 'all', 'users.create': 'all', 'users.edit': 'all', 'settings.manage': 'all' } },
    })
  }
  if (path.endsWith('/api/users/audit')) return ok(UM_AUDIT)
  const id = path.split('/api/users/')[1]?.split('/')[0]
  return id ? ok(umMember(id)) : null
}

/* ── WhatsApp stand-in (/api/campaigns, /api/contacts, /api/templates) ─── */

const WA_CONTACTS = PEOPLE.map((name, i) => ({
  id: 700 + i, name, phone: `91982510${String(i * 37 + 11).padStart(4, '0')}`, company: COMPANIES[(i + 3) % COMPANIES.length],
  email: `${name.split(' ')[0].toLowerCase()}@example.com`, opted_out: i === 4,
}))
const WA_CAMPAIGNS = [
  { id: 41, name: 'Diwali hampers · Gujarat', template_name: 'diwali_offer_2026', status: 'completed', sent_count: 1980, total_count: 2000, created_at: '2026-10-28 09:00:00' },
  { id: 40, name: 'Corporate follow-up', template_name: 'client_conformation_', status: 'completed', sent_count: 412, total_count: 412, created_at: '2026-10-21 09:00:00' },
  { id: 39, name: 'Rate card October', template_name: 'rate_card', status: 'sending', sent_count: 180, total_count: 640, created_at: '2026-10-20 09:00:00' },
]
const WA_TEMPLATES = [
  { name: 'diwali_offer_2026', status: 'APPROVED', language: 'en', category: 'MARKETING', hasVariables: true,
    headerText: 'Diwali gifting is here', bodyText: 'Hi {{1}}, our Diwali gifting range for {{2}} is ready to view.', footerText: 'Dikho', buttons: [{ text: 'View catalogue' }] },
  { name: 'client_conformation_', status: 'APPROVED', language: 'en', category: 'UTILITY', hasVariables: false,
    headerText: null, bodyText: 'Thanks for your enquiry. Our team will call you shortly.', footerText: null, buttons: [] },
]
function whatsappApiReply(url) {
  const ok = (data) => reply({ success: true, data })
  const path = url.pathname
  if (path.endsWith('/api/campaigns/stats')) return ok({ contacts: 8412, campaigns: 36, accepted: 61230, delivered: 58904, read: 41377, failed: 1412, awaiting: 914 })
  if (path.endsWith('/api/campaigns')) return ok({ campaigns: WA_CAMPAIGNS })
  if (/\/api\/campaigns\/\d+\/unsent$/.test(path)) {
    return ok({ audienceSource: 'recorded', unaccounted: 0, counts: { total: 43, failed: 23, neverAttempted: 20 }, contacts: [
      { id: 1, name: 'Nisha Rao', phone: '919825100011', reason: 'failed', errorMessage: 'Message undeliverable' },
      { id: 2, name: 'Kabir Shah', phone: '919825100048', reason: 'never_attempted', errorMessage: null },
    ] })
  }
  if (path.endsWith('/api/contacts')) {
    const term = (url.searchParams.get('search') || '').toLowerCase()
    return ok({ contacts: WA_CONTACTS.filter((c) => !term || `${c.name} ${c.phone} ${c.company}`.toLowerCase().includes(term)) })
  }
  if (path.endsWith('/api/templates')) return ok({ templates: WA_TEMPLATES, source: 'meta' })
  return null
}

// Read-only handles for automated checks of what a save actually wrote.
window.__crmDb = TABLES
window.__settingsDb = { OPTION_LISTS, ORGANIZATION, PROFILE, MEMBER, preferences: () => PREFERENCES }

/* ── A small PostgREST stand-in ─────────────────────────────────────────── */

const RESERVED = new Set(['select', 'order', 'offset', 'limit', 'or', 'on_conflict', 'columns'])

function read(row, path) {
  return path.split('.').reduce((value, key) => {
    if (Array.isArray(value)) return value.map((entry) => entry?.[key])
    return value?.[key]
  }, row)
}

function compare(value, op, arg) {
  if (Array.isArray(value)) return value.some((entry) => compare(entry, op, arg))
  const text = value == null ? null : String(value)
  switch (op) {
    case 'eq': return text === arg
    case 'neq': return text !== arg
    case 'gt': return Number(value) > Number(arg)
    case 'gte': return Number(value) >= Number(arg)
    case 'lt': return Number(value) < Number(arg)
    case 'lte': return Number(value) <= Number(arg)
    case 'is': return arg === 'null' ? value == null : String(Boolean(value)) === arg
    case 'in': return arg.replace(/^\(|\)$/g, '').split(',').map((part) => part.replace(/^"|"$/g, '')).includes(text)
    case 'ilike': {
      const needle = arg.replace(/\*/g, '%').toLowerCase()
      const pattern = new RegExp(`^${needle.split('%').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
      return text != null && pattern.test(text.toLowerCase())
    }
    default: return true
  }
}

function test(row, column, expression) {
  const negate = expression.startsWith('not.')
  const body = negate ? expression.slice(4) : expression
  const dot = body.indexOf('.')
  const result = compare(read(row, column), body.slice(0, dot), body.slice(dot + 1))
  return negate ? !result : result
}

function filterRows(rows, params) {
  let out = rows
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue
    out = out.filter((row) => test(row, key, value))
  }
  const or = params.get('or')
  if (or) {
    const parts = or.replace(/^\(|\)$/g, '').split(',')
    out = out.filter((row) => parts.some((part) => {
      const [column, ...rest] = part.split('.')
      return test(row, column, rest.join('.'))
    }))
  }
  return out
}

function sortRows(rows, order) {
  if (!order) return rows
  const keys = order.split(',').map((part) => part.split('.'))
  return [...rows].sort((a, b) => {
    for (const [column, direction] of keys) {
      const left = a[column]
      const right = b[column]
      if (left === right) continue
      const sign = direction === 'desc' ? -1 : 1
      if (left == null) return 1
      if (right == null) return -1
      return (left > right ? 1 : -1) * sign
    }
    return 0
  })
}

// Only the embeds these four pages ask for.
function embed(table, rows, select) {
  if (!select) return rows
  return rows.map((row) => {
    const copy = { ...row }
    if (table === 'vendors' && select.includes('vendor_addresses')) {
      copy.vendor_addresses = VENDOR_ADDRESSES.filter((item) => item.vendor_id === row.id)
    }
    if (table === 'salesorder' && select.includes('vendor_addresses')) {
      const address = VENDOR_ADDRESSES.find((item) => item.id === row.vendor_address_id) || null
      copy.vendor_addresses = address && {
        ...address,
        vendors: select.includes('vendors') ? (VENDORS.find((item) => item.id === address.vendor_id) || null) : undefined,
      }
    }
    return copy
  })
}

function reply(body, { status = 200, range } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (range) headers['content-range'] = range
  return Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status, headers }))
}

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, window.location.href)
  const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase()
  const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined))
  const single = (headers.get('accept') || '').includes('vnd.pgrst.object')
  const table = url.pathname.split('/').pop()
  const rows = TABLES[table]

  const params = url.searchParams
  const body = init.body ? JSON.parse(init.body) : null

  if (url.pathname.includes('/rest/v1/rpc/')) {
    return settingsRpc(table, body || {}) ?? reply(null)
  }
  if (url.pathname.endsWith('/api/cg-leads/whatsapp-status')) {
    return reply({ success: true, data: { statuses: LEAD_WA } })
  }
  if (/\/api\/(campaigns|contacts|templates)/.test(url.pathname)) {
    const answer = whatsappApiReply(url)
    if (answer) return answer
  }
  if (url.pathname.endsWith('/api/assist/helpers')) {
    return reply({ success: true, data: [
      { user_id: 'u-meera', full_name: 'Meera Iyer', online: true, in_session: false },
      { user_id: 'u-aarav', full_name: 'Aarav Mehta', online: false, in_session: false },
    ] })
  }
  if (url.pathname.endsWith('/api/users/me')) {
    return reply({ success: true, data: MEMBER })
  }
  if (url.pathname.includes('/api/users') && !/\/sign-out$/.test(url.pathname)) {
    const answer = usersApiReply(url.pathname, method)
    if (answer) return answer
  }
  if (/\/api\/users\/[^/]+\/sign-out$/.test(url.pathname) && method === 'POST') {
    MEMBER.sessions = MEMBER.sessions.filter((session) => session.session_id !== body?.session_id)
    return reply({ success: true, data: {} })
  }
  if (!url.pathname.includes('/rest/v1/') || !rows) {
    return reply([])
  }

  if (method === 'POST') {
    const created = (Array.isArray(body) ? body : [body]).map((row) => ({ ...row, id: row.id ?? (nextId += 1) }))
    rows.unshift(...created)
    const result = embed(table, created, params.get('select'))
    return reply(single ? result[0] : result, { status: 201 })
  }

  const matched = filterRows(rows, params)

  if (method === 'PATCH') {
    matched.forEach((row) => Object.assign(row, body))
    const result = embed(table, matched, params.get('select'))
    return reply(single ? (result[0] ?? null) : result)
  }

  if (method === 'DELETE') {
    matched.forEach((row) => rows.splice(rows.indexOf(row), 1))
    return reply(single ? (matched[0] ?? null) : matched)
  }

  const sorted = sortRows(matched, params.get('order'))
  const offset = Number(params.get('offset') || 0)
  const limit = Number(params.get('limit') || 1000)
  const page = embed(table, sorted.slice(offset, offset + limit), params.get('select'))
  const range = `${offset}-${offset + Math.max(page.length - 1, 0)}/${sorted.length}`
  return reply(single ? (page[0] ?? null) : page, { range })
}

// No realtime connections from a preview.
window.WebSocket = class {
  constructor() { this.readyState = 3 }
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

/* ── The shell ──────────────────────────────────────────────────────────── */

const { AccessContext } = await import('../../src/lib/access.js')
const { Sidebar } = await import('../../src/components/Sidebar.jsx')
const { default: ClientsPage } = await import('../../src/features/clients/ClientsPage.jsx')
const { default: VendorsPage } = await import('../../src/features/vendors/VendorsPage.jsx')
const { default: SalesOrdersPage } = await import('../../src/features/sales-orders/SalesOrdersPage.jsx')
const { default: PurchaseOrdersPage } = await import('../../src/features/purchase-orders/PurchaseOrdersPage.jsx')
const { default: LeadsPage } = await import('../../src/features/leads/LeadsPage.jsx')
const { default: UsersPage } = await import('../../src/features/users/UsersPage.jsx')
const { default: UserProfilePage } = await import('../../src/features/users/UserProfilePage.jsx')
const { default: WhatsAppDashboard } = await import('../../src/features/whatsapp/WhatsAppDashboard.jsx')
const { default: WhatsAppContacts } = await import('../../src/features/whatsapp/WhatsAppContacts.jsx')
const { default: WhatsAppCampaigns } = await import('../../src/features/whatsapp/WhatsAppCampaigns.jsx')
const { default: WhatsAppTemplates } = await import('../../src/features/whatsapp/WhatsAppTemplates.jsx')
const { AskHelpDialog, MyHelpPill, HelpToasts } = await import('../../src/features/live-assist/HelpWidgets.jsx')
const { IncomingDialog } = await import('../../src/features/live-assist/EmployeeAssist.jsx')
const { default: AccessDenied } = await import('../../src/components/AccessDenied.jsx')
const { PlaceholderPage } = await import('../../src/components/PlaceholderPage.jsx')

// The idle warning as AuthenticatedLayout renders it (same markup), to look at.
export function IdlePreview() {
  return (
    <div className="session-warning-overlay" role="dialog" aria-modal="true" aria-label="Session expiry warning">
      <div className="session-warning-box">
        <strong>Still there?</strong>
        <p>You'll be signed out in <span className="session-warning-timer">4:32</span> due to inactivity.</p>
        <button className="primary-button" type="button">Stay signed in</button>
      </div>
    </div>
  )
}
await import('../../src/features/live-assist/liveAssist.css')

// Live Assist's pieces on their own, to look at: ?page=/assist (ask dialog,
// pending pill, helper toasts) or ?page=/assist/incoming (the consent dialog).
export function AssistPreview({ incoming }) {
  const noop = () => {}
  if (incoming) {
    return <IncomingDialog session={{ helper_name: 'Meera Iyer', expires_at: new Date(Date.now() + 45000).toISOString() }} onAccept={noop} onDecline={noop} />
  }
  return (
    <>
      <AskHelpDialog onClose={noop} onSend={noop} already={false} />
      <MyHelpPill helperName="Meera" onCancel={noop} />
      <HelpToasts requests={[{ id: 'r1', requester_name: 'Vikram Chandra', for_you: true, section: 'sales-orders', message: 'Where do I add the invoice number?' }]} onHelp={noop} onDismiss={noop} />
    </>
  )
}
const { default: SettingsPage } = await import('../../src/features/settings/SettingsPage.jsx')
const { loadSettings } = await import('../../src/lib/settings.js')
// AuthenticatedLayout does this once access is granted.
loadSettings()

const MODULES = ['clients', 'vendors', 'sales_orders', 'purchase_orders']
const VIEW_ONLY = new URLSearchParams(window.location.search).get('role') === 'viewer'
const permissions = {}
for (const module of MODULES) {
  for (const action of ['view', 'create', 'edit', 'delete']) {
    permissions[`${module}.${action}`] = VIEW_ONLY && action !== 'view' ? 'none' : 'all'
  }
}
for (const key of ['leads.view', 'users.view', 'inbox.view', 'campaigns.view', 'wa_contacts.view', 'wa_templates.view']) permissions[key] = 'all'
for (const key of ['campaigns.send', 'wa_contacts.import', 'wa_contacts.delete']) permissions[key] = VIEW_ONLY ? 'none' : 'all'
permissions['settings.manage'] = VIEW_ONLY ? 'none' : 'all'
for (const key of ['users.create', 'users.edit', 'users.roles', 'users.permissions', 'users.suspend', 'users.sessions', 'audit_logs.view', 'templates.manage', 'departments.manage', 'live_assist.use']) permissions[key] = VIEW_ONLY ? 'none' : 'all'

const ACCESS = {
  status: 'active', user_id: 'preview-user', full_name: 'Priya Sharma',
  system_role: 'admin', developer_level: null, theme: 'system', permissions,
}
const SESSION = { user: { id: 'preview-user', email: 'priya@dikho.example.com', user_metadata: { full_name: 'Priya Sharma' } } }
const START = PARAMS.get('page') || '/clients'

export function Shell() {
  // Phones start with the rail closed, as AuthenticatedLayout does.
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 768px)').matches)
  const [themeMode, setThemeMode] = useState(PARAMS.get('theme') || 'light')
  useEffect(() => {
    const dark = themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [themeMode])
  const settings = <SettingsPage themeMode={themeMode} onThemeChange={setThemeMode} />
  return (
    <div className={`app-shell${collapsed ? ' sidebar-is-closed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} onOverlayClick={null} onLogout={() => {}} session={SESSION} />
      <div className="app-main">
        <main className="workspace">
          <Routes>
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/vendors" element={<VendorsPage />} />
            <Route path="/sales-orders" element={<SalesOrdersPage session={SESSION} />} />
            <Route path="/purchase-orders" element={<PurchaseOrdersPage session={SESSION} />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:userId" element={<UserProfilePage />} />
            <Route path="/whatsapp" element={<WhatsAppDashboard />} />
            <Route path="/whatsapp/contacts" element={<WhatsAppContacts />} />
            <Route path="/whatsapp/campaigns" element={<WhatsAppCampaigns />} />
            <Route path="/whatsapp/templates" element={<WhatsAppTemplates />} />
            <Route path="/denied" element={<AccessDenied />} />
            <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
            <Route path="/idle" element={<IdlePreview />} />
            <Route path="/assist" element={<AssistPreview />} />
            <Route path="/assist/incoming" element={<AssistPreview incoming />} />
            <Route path="/settings" element={settings} />
            <Route path="/settings/:section" element={settings} />
            <Route path="*" element={<Navigate to="/clients" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AccessContext.Provider value={ACCESS}>
      <MemoryRouter initialEntries={[START]}>
        <Shell />
      </MemoryRouter>
    </AccessContext.Provider>
  </StrictMode>,
)
