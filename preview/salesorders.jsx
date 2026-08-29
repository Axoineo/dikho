// Throwaway harness: renders SalesOrdersPage against a stubbed PostgREST so the
// module can be checked in the browser without a Supabase session.
//
// The stub is deliberately strict about the parts that matter — it honours
// offset/limit and content-range for pagination, `or=…ilike` for search, and
// `sales_order_id=eq.N` for the nested items — and it accepts writes so the
// add/edit round trip can be exercised end to end.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'

const CLIENTS = [
  { company_name: 'Aarav Retail Group Pvt Ltd', contact_person: 'Aarav Mehta' },
  { company_name: 'Bluewave Beverages Ltd', contact_person: 'Nisha Rao' },
  { company_name: 'Chandra Motors India', contact_person: 'Vikram Chandra' },
  { company_name: 'Deccan Foods Pvt Ltd', contact_person: 'Priya Nair' },
  { company_name: 'Everest Realty LLP', contact_person: 'Rohit Sharma' },
]

const TYPES = ['ATL', 'TTL', 'BTL']
const STATUSES = ['Draft', 'Pending Approval', 'Approved', 'In Progress', 'Completed', 'Cancelled']
const PURCHASE = ['Not Started', 'Partial', 'Completed']
const BRANDS = ['Freshly', 'Zenith', 'Motorline', 'Spicebox', 'Skyline Homes']

let nextOrderId = 5000
let nextItemId = 90000

const ORDERS = Array.from({ length: 47 }, (_, index) => {
  const client = CLIENTS[index % CLIENTS.length]
  const subTotal = 125000 + index * 8450
  const taxTotal = Math.round(subTotal * 0.18 * 100) / 100
  nextOrderId += 1
  return {
    id: nextOrderId,
    crm_reference_id: `CRM-2026-${String(index + 1).padStart(4, '0')}`,
    company: client.company_name,
    order_client_fullname: client.contact_person,
    order_type: TYPES[index % TYPES.length],
    unique_id: `SO-U-${nextOrderId}`,
    order_number: `SO/2026/${String(index + 1).padStart(4, '0')}`,
    order_date: `2026-0${(index % 8) + 1}-1${index % 9}`,
    invoice_date: index % 3 === 0 ? `2026-0${(index % 8) + 1}-2${index % 8}` : null,
    sub_total: subTotal,
    tax_total: taxTotal,
    total: Math.round((subTotal + taxTotal) * 100) / 100,
    campaign_start_date: `2026-0${(index % 8) + 1}-01`,
    campaign_end_date: `2026-0${(index % 8) + 1}-2${index % 8}`,
    created_by: 'ops@dikho.example.com',
    created_by_id: null,
    approved_by: index % 4 === 0 ? 'Meera Iyer' : null,
    approved_date: index % 4 === 0 ? `2026-0${(index % 8) + 1}-05` : null,
    order_status: STATUSES[index % STATUSES.length],
    purchase_status: PURCHASE[index % PURCHASE.length],
    complete_date: index % 6 === 0 ? `2026-0${(index % 8) + 1}-28` : null,
    order_color: index % 5 === 0 ? '#f9af1b' : null,
    created_at: '2026-01-04T09:12:00Z',
    updated_at: '2026-08-01T11:40:00Z',
    multi_purpose_so: index % 7 === 0,
    brand_name: BRANDS[index % BRANDS.length],
    invoice_courier: index % 3 === 0 ? 'Bluedart' : null,
    payment_receipt_amount: index % 2 === 0 ? Math.round(subTotal * 0.4 * 100) / 100 : null,
  }
})

const ITEM_NAMES = ['Prime time TV spot', 'Metro station branding', 'Instagram reel bundle', 'Airport unipole', 'Radio jingle — 30s']

const ITEMS = ORDERS.flatMap((order, orderIndex) => (
  Array.from({ length: (orderIndex % 3) + 1 }, (_, itemIndex) => {
    const taxable = Math.round((order.sub_total / ((orderIndex % 3) + 1)) * 100) / 100
    const tax = Math.round(taxable * 0.18 * 100) / 100
    const half = Math.round((tax / 2) * 100) / 100
    const interState = itemIndex % 2 === 1
    nextItemId += 1
    return {
      id: nextItemId,
      sales_order_id: order.id,
      type: ['Media', 'Production', 'Printing'][itemIndex % 3],
      name: ITEM_NAMES[(orderIndex + itemIndex) % ITEM_NAMES.length],
      short_name: `L${itemIndex + 1}`,
      date: order.campaign_start_date,
      invoice_number: itemIndex === 0 ? `INV/${order.id}/1` : null,
      is_taxable: true,
      gst_type: interState ? 'Inter-State' : 'Intra-State',
      taxable_amount: taxable,
      utgst_amount: 0,
      igst_amount: interState ? tax : 0,
      sgst_amount: interState ? 0 : Math.round((tax - half) * 100) / 100,
      cgst_amount: interState ? 0 : half,
      tax_amount: tax,
      after_tax_amount: Math.round((taxable + tax) * 100) / 100,
      document_color: itemIndex === 0 ? '#2f9e6f' : null,
      document_note: itemIndex === 0 ? 'Rate card attached; client approved on call.' : null,
      self_audit_completed: itemIndex === 0,
      label: 'Campaign line',
      reference_type: 'Sales Order',
      purchase_order_id: itemIndex === 0 ? 700 + orderIndex : null,
      inv_id: null,
      inv_number: itemIndex === 0 ? `INV/${order.id}/1` : null,
      created_at: '2026-01-04T09:12:00Z',
      updated_at: '2026-08-01T11:40:00Z',
      file_url: itemIndex === 0 ? 'https://example.com/rate-card.pdf' : null,
      document_courier: itemIndex === 0 ? 'Bluedart' : null,
      courier_status: itemIndex === 0 ? 'Delivered' : null,
    }
  })
))

function respond(body, { start = 0, end = 0, total = 0 } = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-range': `${start}-${end}/${total}` },
  })
}

function idFrom(url) {
  const value = url.searchParams.get('id')
  return value?.startsWith('eq.') ? Number(value.slice(3)) : null
}

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const table = url.pathname.split('/').pop()
  const method = (init.method || 'GET').toUpperCase()
  const offset = Number(url.searchParams.get('offset') || 0)
  const limit = Number(url.searchParams.get('limit') || 1000)
  const body = init.body ? JSON.parse(init.body) : null

  if (table === 'clients') return respond(CLIENTS)

  if (table === 'salesorder') {
    if (method === 'POST') {
      nextOrderId += 1
      const created = { ...(Array.isArray(body) ? body[0] : body), id: nextOrderId, created_at: new Date().toISOString() }
      ORDERS.unshift(created)
      return respond(created)
    }

    if (method === 'PATCH') {
      const id = idFrom(url)
      const target = ORDERS.find((row) => row.id === id)
      if (target) Object.assign(target, body)
      return respond(target || {})
    }

    if (method === 'DELETE') {
      const id = idFrom(url)
      const position = ORDERS.findIndex((row) => row.id === id)
      if (position >= 0) ORDERS.splice(position, 1)
      return respond([])
    }

    let rows = ORDERS
    const or = url.searchParams.get('or')
    if (or) {
      const needle = (or.match(/ilike\.%([^%)]*)%/) || [])[1]?.toLowerCase() || ''
      rows = rows.filter((row) => ['order_number', 'company', 'crm_reference_id']
        .some((column) => String(row[column] || '').toLowerCase().includes(needle)))
    }

    const total = rows.length
    const page = rows.slice(offset, offset + limit)
    return respond(page, { start: offset, end: offset + page.length - 1, total })
  }

  if (table === 'salesorderdocument') {
    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : [body]
      const created = rows.map((row) => {
        nextItemId += 1
        const saved = { ...row, id: nextItemId }
        ITEMS.push(saved)
        return saved
      })
      return respond(created)
    }

    if (method === 'PATCH') {
      const id = idFrom(url)
      const target = ITEMS.find((row) => row.id === id)
      if (target) Object.assign(target, body)
      return respond(target || {})
    }

    if (method === 'DELETE') {
      const raw = url.searchParams.get('id') || ''
      const ids = (raw.match(/\(([^)]*)\)/) || [])[1]?.split(',').map(Number) || []
      ids.forEach((id) => {
        const position = ITEMS.findIndex((row) => row.id === id)
        if (position >= 0) ITEMS.splice(position, 1)
      })
      return respond([])
    }

    const parent = url.searchParams.get('sales_order_id')
    let rows = ITEMS
    if (parent?.startsWith('eq.')) rows = rows.filter((row) => String(row.sales_order_id) === parent.slice(3))
    const page = rows.slice(offset, offset + limit)
    return respond(page, { start: offset, end: offset + page.length - 1, total: rows.length })
  }

  return respond([])
}

const { __PreviewSalesOrdersPage: SalesOrdersPage } = await import('../src/App.jsx')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="workspace">
      <SalesOrdersPage session={{ user: { id: 'preview-user', email: 'ops@dikho.example.com' } }} />
    </div>
  </StrictMode>,
)
