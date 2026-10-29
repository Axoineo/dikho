import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Icon } from '../../components/Icon'
import { SearchableSelect } from '../../components/SearchableSelect'
import { formatDateInput, formatDisplayDate, formatDateRange, formatRupees } from '../../lib/format'
import { round2, toAmount } from '../../lib/money'
import { campaignDays, todayIso } from '../../lib/dates'
import {
  ORDER_TYPE_OPTIONS, ORDER_STATUS_OPTIONS,
  GST_TYPE_OPTIONS, GST_RATES,
  itemAmounts, rateFromAmounts, gstBreakdown,
  storedItemTotals, applyItemChange,
} from '../../lib/gst'
import { statusTone, missingColumnFrom, notNullColumnFrom } from '../../lib/status'
import { sessionActor } from '../sales-orders/salesOrderHelpers'
import SalesOrderItemCard from '../sales-orders/SalesOrderItemCard'
import { useAccess } from '../../lib/access'
import { listValues, preferredPageSize, useSettings } from '../../lib/settings'
import {
  PageHeader, SearchField, ResultCount, Pagination, StatusPill, Cell, RowChevron, SkeletonRows, EmptyState, Toast,
  DetailsPanel, Section, KeyValues, FormModal, FormSection, Field, CheckToggle, Disclosure,
} from '../../components/crm/CrmUi'

/* ─── Constants ────────────────────────────────────────────────────────── */

// Purchase orders live in public.salesorder: a row with vendor_address_id is
// a PO (the convention the RLS policies use; see the user-management
// migration). Their items are salesorderdocument rows with purchase_order_id
// set, whose sales_order_id points at the sales order they were bought for.
//
// The list used to read public.purchaseorders, a flattened table left over
// from an older schema that nothing writes to, so a PO saved here never
// appeared in the list. It now reads the rows it writes.
const PO_HEADER_TABLE     = 'salesorder'
const PO_ITEM_TABLE       = 'salesorderdocument'
const PO_PAGE_SIZES       = [25, 50, 100]
const PO_COLUMN_COUNT     = 7
const PO_SEARCH_COLUMNS   = ['order_number', 'company', 'crm_reference_id', 'brand_name']
const PO_SEARCH_FALLBACK  = ['company']
// The vendor and its address come along through the foreign keys
// salesorder.vendor_address_id -> vendor_addresses -> vendors. Someone
// without vendors.view gets null embeds, and the row falls back to the
// vendor name stored on the order itself.
const PO_SELECT = '*,vendor_addresses(id,vendor_id,address,city,state,country,zipcode,vendors(id,company_name,contact_person,alias,email,gstin,pan_number,vendor_type))'

const PO_ITEM_TYPE_OPTIONS = ['Media', 'Production', 'Printing', 'Installation', 'Service', 'Other']

const MAX_WRITE_ATTEMPTS = 8

const PO_FALLBACKS = {
  unique_id: () => `PO-${Date.now()}`,
  crm_reference_id: () => '',
  order_type: () => ORDER_TYPE_OPTIONS[0],
  order_status: () => ORDER_STATUS_OPTIONS[0],
  purchase_status: () => 'Not Started',
  order_date: () => todayIso(),
  order_client_fullname: (row) => row.company || 'Vendor',
  brand_name: () => '',
  multi_purpose_so: () => false,
  payment_receipt_amount: () => 0,
  created_by: () => 'Dikho',
}

const PO_ITEM_FALLBACKS = {
  type: () => PO_ITEM_TYPE_OPTIONS[0],
  short_name: (row) => row.name || 'Item',
  label: (row) => row.name || 'Item',
  reference_type: () => 'Purchase Order',
  gst_type: () => GST_TYPE_OPTIONS[0].value,
  date: () => todayIso(),
  invoice_number: () => '',
  is_taxable: () => true,
  self_audit_completed: () => false,
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

// Flattens a salesorder row and its embeds into the fields the list, the
// panel and the edit form read.
function normalizePO(row, salesOrders = {}) {
  const address = row.vendor_addresses || null
  const vendor = address?.vendors || null
  const so = row.sales_order_id ? salesOrders[row.sales_order_id] : null
  return {
    ...row,
    vendor_id: address?.vendor_id ?? row.vendor_id ?? null,
    vendor_name: vendor?.company_name || row.company,
    contact_person: vendor?.contact_person ?? row.contact_person ?? null,
    alias: vendor?.alias ?? null,
    email: vendor?.email ?? null,
    gstin: vendor?.gstin ?? null,
    pan_number: vendor?.pan_number ?? null,
    vendor_type: vendor?.vendor_type ?? null,
    address: address?.address ?? null,
    city: address?.city ?? null,
    state: address?.state ?? null,
    country: address?.country ?? null,
    zipcode: address?.zipcode ?? null,
    order_sales_number: so?.order_number ?? row.order_sales_number ?? null,
    so_company: so?.company ?? row.so_company ?? null,
  }
}

// Which sales order each PO was raised against, read from its items. Two
// small requests per page; someone who cannot see sales orders just gets no
// SO number.
async function attachSalesOrders(rows) {
  const ids = rows.map((row) => row.id)
  if (ids.length === 0) return rows
  const { data: links } = await supabase.from(PO_ITEM_TABLE).select('purchase_order_id,sales_order_id').in('purchase_order_id', ids)
  const soByPo = {}
  ;(links || []).forEach((link) => { if (link.sales_order_id && !soByPo[link.purchase_order_id]) soByPo[link.purchase_order_id] = link.sales_order_id })
  const soIds = [...new Set(Object.values(soByPo))]
  const { data: sos } = soIds.length
    ? await supabase.from(PO_HEADER_TABLE).select('id,order_number,company').in('id', soIds)
    : { data: [] }
  const salesOrders = Object.fromEntries((sos || []).map((so) => [so.id, so]))
  return rows.map((row) => normalizePO({ ...row, sales_order_id: soByPo[row.id] ?? null }, salesOrders))
}


const MONEY_EPSILON = 0.005

function reconcilePOTotals(items) {
  let subTotal = 0, taxTotal = 0, grandTotal = 0
  items.forEach((item, index) => {
    const amounts = itemAmounts(item)
    const position = index + 1
    const splitSum = round2(amounts.cgst_amount + amounts.sgst_amount + amounts.igst_amount + amounts.utgst_amount)
    if (Math.abs(splitSum - amounts.tax_amount) > MONEY_EPSILON) {
      throw new Error(`Item ${position}: GST split (${splitSum}) ≠ tax amount (${amounts.tax_amount}).`)
    }
    if (Math.abs(amounts.after_tax_amount - (amounts.taxable_amount + amounts.tax_amount)) > MONEY_EPSILON) {
      throw new Error(`Item ${position}: after-tax ≠ taxable + tax.`)
    }
    subTotal += amounts.taxable_amount
    taxTotal += amounts.tax_amount
    grandTotal += amounts.after_tax_amount
  })
  return { sub_total: round2(subTotal), tax_total: round2(taxTotal), total: round2(grandTotal) }
}

function poSearchFilter(request, query, columns) {
  const safe = query.replace(/[%_]/g, '').replace(/[(),]/g, ' ').trim()
  if (!safe) return request
  return request.or(columns.map(c => `${c}.ilike.%${safe}%`).join(','))
}

function isIlikeTypeError(error) {
  return error?.code === '42883' || /\bilike\b/i.test(String(error?.message || ''))
}

async function writeRows(run, rows, fallbacks) {
  let current = rows.map(r => ({ ...r }))
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const { data, error } = await run(current)
    if (!error) return data
    const missing = missingColumnFrom(error)
    if (missing && current.some(r => missing in r)) {
      current = current.map(r => { const n = { ...r }; delete n[missing]; return n })
      continue
    }
    const required = notNullColumnFrom(error)
    const isEmpty = (r) => r[required] === null || r[required] === undefined
    if (required && fallbacks[required] && current.some(isEmpty)) {
      current = current.map((r, i) => isEmpty(r) ? { ...r, [required]: fallbacks[required](rows[i] || {}, i) } : r)
      continue
    }
    throw error
  }
  throw new Error('Could not find a payload this table accepts.')
}

/* ─── Form shapes ─────────────────────────────────────────────────────── */

function blankPOForm() {
  return {
    order_number: '',
    crm_reference_id: '',
    // The first value each list offers (Settings > Lists).
    order_type: listValues('order_type', ORDER_TYPE_OPTIONS)[0] ?? '',
    order_date: todayIso(),
    order_status: listValues('order_status', ORDER_STATUS_OPTIONS)[0] ?? '',
    campaign_start_date: '',
    campaign_end_date: '',
    brand_name: '',
    order_color: '',
    payment_receipt_amount: '',
    approved_by: '',
    approved_date: '',
    complete_date: '',
    // PO-specific
    sales_order_id: '',
    so_order_number: '',
    so_company: '',
    vendor_id: '',
    vendor_name: '',
    vendor_address_id: '',
  }
}

function poToForm(row) {
  return {
    order_number: row.order_number ?? '',
    crm_reference_id: row.crm_reference_id ?? '',
    order_type: row.order_type ?? '',
    order_date: formatDateInput(row.order_date),
    order_status: row.order_status ?? '',
    campaign_start_date: formatDateInput(row.campaign_start_date),
    campaign_end_date: formatDateInput(row.campaign_end_date),
    brand_name: row.brand_name ?? '',
    order_color: row.order_color ?? '',
    payment_receipt_amount: row.payment_receipt_amount == null ? '' : String(row.payment_receipt_amount),
    approved_by: row.approved_by ?? '',
    approved_date: formatDateInput(row.approved_date),
    complete_date: formatDateInput(row.complete_date),
    // Carried over from the saved row. These used to start empty, and saving
    // wrote vendor_address_id back as null: that turns a purchase order into
    // a sales order (or is refused by RLS for someone with only PO rights).
    sales_order_id: row.sales_order_id ? String(row.sales_order_id) : '',
    so_order_number: row.order_sales_number ?? '',
    so_company: row.so_company ?? '',
    vendor_id: row.vendor_id ? String(row.vendor_id) : '',
    vendor_name: row.vendor_name ?? row.company ?? '',
    vendor_address_id: row.vendor_address_id ? String(row.vendor_address_id) : '',
  }
}

function blankPOItem(key) {
  return {
    key,
    id: null,
    so_item_id: '',
    so_item_name: '',
    so_item_taxable: 0,
    type: listValues('item_type', PO_ITEM_TYPE_OPTIONS)[0] ?? '',
    name: '',
    short_name: '',
    label: '',
    date: '',
    invoice_number: '',
    is_taxable: true,
    gst_type: GST_TYPE_OPTIONS[0].value,
    gst_rate: '18',
    taxable_amount: '',
    tax_amount: '',
    document_note: '',
    self_audit_completed: false,
    file_url: '',
    expanded: false,
  }
}

function poItemToForm(row, key) {
  return {
    key,
    id: row.id ?? null,
    so_item_id: row.so_item_id ?? '',
    so_item_name: '',
    so_item_taxable: 0,
    type: row.type ?? '',
    name: row.name ?? '',
    short_name: row.short_name ?? '',
    label: row.label ?? '',
    date: formatDateInput(row.date),
    invoice_number: row.invoice_number ?? '',
    is_taxable: row.is_taxable == null ? true : Boolean(row.is_taxable),
    gst_type: row.gst_type || GST_TYPE_OPTIONS[0].value,
    gst_rate: rateFromAmounts(row.taxable_amount, row.tax_amount),
    taxable_amount: row.taxable_amount == null ? '' : String(row.taxable_amount),
    tax_amount: row.tax_amount == null ? '' : String(row.tax_amount),
    document_note: row.document_note ?? '',
    self_audit_completed: Boolean(row.self_audit_completed),
    file_url: row.file_url ?? '',
    expanded: false,
  }
}

function buildPOHeaderPayload(form, totals, session) {
  return {
    order_number: form.order_number.trim(),
    crm_reference_id: form.crm_reference_id.trim() || null,
    company: form.vendor_name.trim(),
    order_client_fullname: form.vendor_name.trim() || null,
    order_type: form.order_type || null,
    order_date: form.order_date || null,
    campaign_start_date: form.campaign_start_date || null,
    campaign_end_date: form.campaign_end_date || null,
    brand_name: form.brand_name.trim() || null,
    order_color: form.order_color || null,
    order_status: form.order_status || null,
    approved_by: form.approved_by.trim() || null,
    approved_date: form.approved_date || null,
    complete_date: form.complete_date || null,
    payment_receipt_amount: form.payment_receipt_amount === '' ? null : round2(form.payment_receipt_amount),
    sub_total: totals.sub_total,
    tax_total: totals.tax_total,
    total: totals.total,
    created_by: sessionActor(session),
    multi_purpose_so: false,
    // vendor_address_id marks this salesorder row as a Purchase Order.
    // The purchaseorders Supabase view and SO list filter on this column.
    vendor_address_id: form.vendor_address_id ? Number(form.vendor_address_id) : null,
  }
}

function buildPOItemPayload(item, salesOrderId, purchaseOrderId) {
  return {
    sales_order_id: salesOrderId,
    purchase_order_id: purchaseOrderId,
    so_item_id: item.so_item_id ? Number(item.so_item_id) : null,
    type: (item.type || '').trim() || null,
    name: item.name.trim(),
    short_name: (item.short_name || '').trim() || null,
    label: (item.label || '').trim() || null,
    reference_type: 'Purchase Order',
    date: item.date || null,
    invoice_number: (item.invoice_number || '').trim() || null,
    is_taxable: Boolean(item.is_taxable),
    gst_type: item.is_taxable ? (item.gst_type || null) : null,
    document_note: (item.document_note || '').trim() || null,
    self_audit_completed: Boolean(item.self_audit_completed),
    file_url: (item.file_url || '').trim() || null,
    ...itemAmounts(item),
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   PO ITEM EDITOR
   ═══════════════════════════════════════════════════════════════════════ */

function POItemEditor({ item, index, onChange, onRemove, onToggle, canRemove, soItems, typeOptions }) {
  const amounts = itemAmounts(item)
  const field = (name) => ({ value: item[name], onChange: (event) => onChange(index, name, event.target.value) })
  const id = (name) => `po-item-${name}-${item.key}`
  const breakdown = gstBreakdown(amounts)

  const soItem = soItems.find((row) => String(row.id) === String(item.so_item_id))
  const margin = soItem ? round2(toAmount(soItem.taxable_amount) - amounts.taxable_amount) : null

  return (
    <div className="crm-item">
      <div className="crm-item-head">
        <span className="crm-item-index">{index + 1}</span>
        <span className={`crm-item-title${item.name.trim() ? '' : ' is-placeholder'}`} title={item.name}>{item.name.trim() || 'New item'}</span>
        <span className="crm-item-total">{formatRupees(amounts.after_tax_amount)}</span>
        <button type="button" className="crm-icon-btn" onClick={() => onRemove(index)} disabled={!canRemove}
          title={canRemove ? 'Remove item' : 'A purchase order needs at least one item'} aria-label={`Remove item ${index + 1}`}>
          <Icon name="trash" size={16} />
        </button>
      </div>

      <div className="crm-item-body">
        <div className="crm-grid crm-grid--4">
          <Field label="For sales order line" htmlFor={id('soitem')} className="crm-span-2"
            hint={soItems.length === 0 ? 'Pick the sales order first to link a line.' : null}>
            <select id={id('soitem')} className="crm-select" {...field('so_item_id')} disabled={soItems.length === 0}>
              <option value="">Not linked</option>
              {soItems.map((row) => <option key={row.id} value={row.id}>{row.name} ({formatRupees(row.taxable_amount)})</option>)}
            </select>
          </Field>
          <Field label="Item" htmlFor={id('name')} required className="crm-span-2">
            <input id={id('name')} className="crm-input" {...field('name')} />
          </Field>
          <Field label="Type" htmlFor={id('type')}>
            <select id={id('type')} className="crm-select" {...field('type')}>
              <option value="">Not set</option>
              {(item.type && !typeOptions.includes(item.type) ? [...typeOptions, item.type] : typeOptions).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
          <Field label="Cost before tax" htmlFor={id('taxable')}>
            <div className="crm-input-group">
              <span className="crm-addon">₹</span>
              <input id={id('taxable')} type="number" step="0.01" min="0" inputMode="decimal" className="crm-input crm-mono-input" {...field('taxable_amount')} />
            </div>
          </Field>
          <Field label="GST">
            <CheckToggle checked={item.is_taxable} onChange={(value) => onChange(index, 'is_taxable', value)}>Charged GST</CheckToggle>
          </Field>
          <Field label="GST type" htmlFor={id('gst-type')}>
            <select id={id('gst-type')} className="crm-select" {...field('gst_type')} disabled={!item.is_taxable}>
              {GST_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="GST rate" htmlFor={id('rate')}>
            <select id={id('rate')} className="crm-select" {...field('gst_rate')} disabled={!item.is_taxable}>
              {GST_RATES.map((rate) => <option key={rate} value={String(rate)}>{rate}%</option>)}
              <option value="custom">Custom amount</option>
            </select>
          </Field>
          <Field label="Tax" htmlFor={id('tax')} hint={item.is_taxable && item.gst_rate !== 'custom' ? 'Worked out from the rate' : null}>
            <div className="crm-input-group">
              <span className="crm-addon">₹</span>
              <input id={id('tax')} type="number" step="0.01" min="0" inputMode="decimal" className="crm-input crm-mono-input" {...field('tax_amount')}
                disabled={!item.is_taxable || item.gst_rate !== 'custom'} />
            </div>
          </Field>
        </div>

        <Disclosure open={item.expanded} onToggle={() => onToggle(index)} count="6 fields">
          <div className="crm-grid crm-grid--4">
            <Field label="Date" htmlFor={id('date')}>
              <input id={id('date')} type="date" className="crm-input" {...field('date')} />
            </Field>
            <Field label="Invoice number" htmlFor={id('invoice')}>
              <input id={id('invoice')} className="crm-input" {...field('invoice_number')} />
            </Field>
            <Field label="Short name" htmlFor={id('short')}>
              <input id={id('short')} className="crm-input" {...field('short_name')} />
            </Field>
            <Field label="Audit">
              <CheckToggle checked={item.self_audit_completed} onChange={(value) => onChange(index, 'self_audit_completed', value)}>Self audit done</CheckToggle>
            </Field>
            <Field label="Attachment link" htmlFor={id('file')} className="crm-span-2">
              <input id={id('file')} type="url" className="crm-input" {...field('file_url')} />
            </Field>
            <Field label="Note" htmlFor={id('note')} className="crm-span-2">
              <input id={id('note')} className="crm-input" {...field('document_note')} />
            </Field>
          </div>
        </Disclosure>
      </div>

      <div className="crm-item-foot">
        <span>Before tax <strong>{formatRupees(amounts.taxable_amount)}</strong></span>
        <span>Tax <strong>{formatRupees(amounts.tax_amount)}</strong></span>
        <span>{breakdown || (item.is_taxable ? 'No GST yet' : 'No GST')}</span>
        {margin != null && <span>Margin <strong>{formatRupees(margin)}</strong></span>}
        <span className="is-end">Total <strong>{formatRupees(amounts.after_tax_amount)}</strong></span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   PO DETAILS PANEL
   ═══════════════════════════════════════════════════════════════════════ */

function PurchaseOrderDetails({ order, items, itemsLoading, itemsError, onClose, onEdit }) {
  if (!order) return null

  const duration = campaignDays(order.campaign_start_date, order.campaign_end_date)
  const stored = storedItemTotals(items)
  const drifted = !itemsLoading && !itemsError && items.length > 0 && Math.abs(stored.total - toAmount(order.total)) > MONEY_EPSILON
  const requested = order.payment_receipt_amount
  const balance = requested == null ? null : round2(toAmount(order.total) - toAmount(requested))
  const place = [order.city, order.state, order.zipcode].filter(Boolean).join(', ')

  return (
    <DetailsPanel
      label="Purchase order details"
      title={order.order_number || `PO #${order.id}`}
      meta={<>
        {order.order_status && <StatusPill tone={statusTone(order.order_status)}>{order.order_status}</StatusPill>}
        <span>{order.vendor_name || 'No vendor'}</span>
      </>}
      onClose={onClose}
      actions={onEdit && (
        <button type="button" className="crm-btn crm-btn--secondary crm-btn--sm" onClick={onEdit}>
          <Icon name="edit" size={15} /> Edit
        </button>
      )}
    >
      <div className="crm-figures">
        <div className="crm-figures-total"><span>Total</span><strong className="crm-mono">{formatRupees(order.total)}</strong></div>
        <div className="crm-figures-row"><span>Before tax</span><strong className="crm-mono">{formatRupees(order.sub_total)}</strong></div>
        <div className="crm-figures-row"><span>Tax</span><strong className="crm-mono">{formatRupees(order.tax_total)}</strong></div>
        {requested != null && <div className="crm-figures-row"><span>Payment requested</span><strong className="crm-mono">{formatRupees(requested)}</strong></div>}
        {balance != null && <div className="crm-figures-row is-balance"><span>Still to request</span><strong className="crm-mono">{formatRupees(balance)}</strong></div>}
      </div>

      {drifted && (
        <div className="crm-note" role="status">
          <Icon name="alert" size={16} />
          <div>The items add up to {formatRupees(stored.total)}, not the stored total. Opening and saving the order recalculates it.</div>
        </div>
      )}

      <Section title={`Items${!itemsLoading && !itemsError ? ` (${items.length})` : ''}`}>
        {itemsLoading ? (
          <p className="crm-section-note">Loading items…</p>
        ) : itemsError ? (
          <div className="crm-note crm-note--danger" role="alert">{itemsError}</div>
        ) : items.length === 0 ? (
          <p className="crm-section-note">This purchase order has no items.</p>
        ) : (
          <div className="crm-lines">{items.map((row) => <SalesOrderItemCard key={row.id} row={row} forPurchaseOrder />)}</div>
        )}
      </Section>

      <Section title="Vendor">
        <KeyValues items={[
          { label: 'Vendor', value: order.vendor_name, wide: true, keep: true },
          { label: 'Contact person', value: order.contact_person },
          { label: 'Alias', value: order.alias },
          { label: 'Email', value: order.email, href: order.email ? `mailto:${order.email}` : null, wide: true },
          { label: 'GSTIN', value: order.gstin, mono: true },
          { label: 'PAN', value: order.pan_number, mono: true },
          { label: 'Address', value: [order.address, place, order.country].filter(Boolean).join(', '), wide: true },
        ]} />
      </Section>

      <Section title="Order">
        <KeyValues items={[
          { label: 'For sales order', value: [order.order_sales_number, order.so_company].filter(Boolean).join(' · '), wide: true, keep: true },
          { label: 'Order date', value: order.order_date && formatDisplayDate(order.order_date), keep: true },
          { label: 'Order type', value: order.order_type },
          { label: 'CRM reference', value: order.crm_reference_id, mono: true },
          { label: 'Brand', value: order.brand_name },
          { label: 'Campaign', value: formatDateRange(order.campaign_start_date, order.campaign_end_date), wide: true },
          { label: 'Duration', value: duration && `${duration} ${duration === 1 ? 'day' : 'days'}` },
        ]} />
      </Section>

      <Section title="History">
        <KeyValues items={[
          { label: 'Approved by', value: order.approved_by },
          { label: 'Approved on', value: order.approved_date && formatDisplayDate(order.approved_date) },
          { label: 'Completed on', value: order.complete_date && formatDisplayDate(order.complete_date) },
          { label: 'Created by', value: order.created_by, wide: true },
          { label: 'Created on', value: order.created_at && formatDisplayDate(order.created_at) },
          { label: 'Last changed', value: order.updated_at && formatDisplayDate(order.updated_at) },
        ]} />
      </Section>
    </DetailsPanel>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   ADD / EDIT FORM MODAL
   ═══════════════════════════════════════════════════════════════════════ */

function PurchaseOrderFormModal({ order, initial, session, onClose, onSaved }) {
  const isEdit = Boolean(order?.id)

  useSettings()
  const [form, setForm] = useState(() => isEdit ? poToForm(order) : { ...blankPOForm(), ...initial })
  const keyRef = useRef(1)
  const [items, setItems] = useState(() => isEdit ? [] : [blankPOItem('item-1')])
  const [removedItemIds, setRemovedItemIds] = useState([])
  const [itemsLoading, setItemsLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Lookup data
  const [salesOrders, setSalesOrders] = useState([])
  const [soItems, setSoItems] = useState([])
  const [vendors, setVendors] = useState([])
  const [vendorAddresses, setVendorAddresses] = useState([])

  function nextKey() { keyRef.current += 1; return `item-${keyRef.current}` }

  function update(name, value) {
    setForm(current => ({ ...current, [name]: value }))
  }

  // Load reference data on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      const [soRes, vRes] = await Promise.all([
        supabase.from('salesorder').select('id,order_number,company,crm_reference_id,campaign_start_date,campaign_end_date,brand_name').is('vendor_address_id', null).order('id', { ascending: false }).limit(1000),
        supabase.from('vendors').select('id,company_name,contact_person,alias,email,gstin,pan_number,vendor_type,media_id,sub_media_id').order('company_name', { ascending: true }).limit(1000),
      ])
      if (cancelled) return
      setSalesOrders(soRes.data || [])
      setVendors(vRes.data || [])
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Load existing items when editing
  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    async function loadItems() {
      setItemsLoading(true)
      const { data, error: err } = await supabase
        .from(PO_ITEM_TABLE)
        .select('*')
        .eq('purchase_order_id', order.id)
        .order('id', { ascending: true })
      if (cancelled) return
      if (err) {
        setError(err.message)
        setItems([blankPOItem(nextKey())])
      } else {
        const rows = (data || []).map(r => poItemToForm(r, `existing-${r.id}`))
        setItems(rows.length > 0 ? rows : [blankPOItem(nextKey())])

        // Determine the linked SO from items
        if (rows.length > 0 && data[0]?.sales_order_id) {
          const soId = data[0].sales_order_id
          setForm(f => ({ ...f, sales_order_id: String(soId) }))
        }
      }
      setRemovedItemIds([])
      setItemsLoading(false)
    }
    loadItems()
    return () => { cancelled = true }
  }, [isEdit, order?.id])

  // Load SO items when SO changes
  useEffect(() => {
    if (!form.sales_order_id) { setSoItems([]); return }
    let cancelled = false
    supabase.from(PO_ITEM_TABLE).select('*').eq('sales_order_id', Number(form.sales_order_id)).is('purchase_order_id', null).order('id', { ascending: true }).then(({ data }) => {
      if (!cancelled) setSoItems(data || [])
    })
    return () => { cancelled = true }
  }, [form.sales_order_id])

  // Load vendor addresses when vendor changes
  useEffect(() => {
    if (!form.vendor_id) { setVendorAddresses([]); return }
    let cancelled = false
    supabase.from('vendor_addresses').select('*').eq('vendor_id', Number(form.vendor_id)).then(({ data }) => {
      if (cancelled) return
      const rows = data || []
      setVendorAddresses(rows)
      // Most vendors have one address: pick it, or the default, so the PO
      // does not wait on a choice there is nothing to choose between.
      const pick = rows.length === 1 ? rows[0] : rows.find((row) => row.is_default)
      if (pick) setForm((current) => (current.vendor_address_id ? current : { ...current, vendor_address_id: String(pick.id) }))
    })
    return () => { cancelled = true }
  }, [form.vendor_id])

  // --- SO Selection ---
  function selectSO(soId) {
    const so = salesOrders.find(s => String(s.id) === String(soId))
    setForm(current => ({
      ...current,
      sales_order_id: soId,
      so_order_number: so?.order_number || '',
      so_company: so?.company || '',
      crm_reference_id: so?.crm_reference_id || current.crm_reference_id,
      campaign_start_date: so?.campaign_start_date ? formatDateInput(so.campaign_start_date) : current.campaign_start_date,
      campaign_end_date: so?.campaign_end_date ? formatDateInput(so.campaign_end_date) : current.campaign_end_date,
      brand_name: so?.brand_name || current.brand_name,
    }))
  }

  const soOptions = useMemo(() =>
    salesOrders.map(so => ({ value: String(so.id), label: `${so.order_number} — ${so.company}` })),
    [salesOrders]
  )

  // --- Vendor Selection ---
  function selectVendor(vendorId) {
    const v = vendors.find(vend => String(vend.id) === String(vendorId))
    setForm(current => ({
      ...current,
      vendor_id: vendorId,
      vendor_name: v?.company_name || '',
      vendor_address_id: '',
    }))
  }

  const vendorOptions = useMemo(() =>
    vendors.map(v => ({ value: String(v.id), label: v.company_name + (v.alias ? ` (${v.alias})` : '') })),
    [vendors]
  )

  const addressOptions = useMemo(() =>
    vendorAddresses.map(a => ({ value: String(a.id), label: [a.address, a.city, a.state].filter(Boolean).join(', ') })),
    [vendorAddresses]
  )

  // --- Item management ---
  function changeItem(index, name, value) {
    setItems(current => current.map((item, pos) => {
      if (pos !== index) return item
      const next = applyItemChange(item, name, value)
      // When selecting SO item, populate name
      if (name === 'so_item_id') {
        const si = soItems.find(s => String(s.id) === String(value))
        if (si) {
          next.name = si.name
          next.so_item_name = si.name
          next.so_item_taxable = toAmount(si.taxable_amount)
        }
      }
      return next
    }))
  }

  function toggleItem(index) {
    setItems(current => current.map((item, pos) => pos === index ? { ...item, expanded: !item.expanded } : item))
  }

  function addItem() {
    setItems(current => [...current, blankPOItem(nextKey())])
  }

  function removeItem(index) {
    const removed = items[index]
    if (removed?.id) setRemovedItemIds(ids => ids.includes(removed.id) ? ids : [...ids, removed.id])
    setItems(current => current.filter((_, pos) => pos !== index))
  }

  const itemTypeOptions = listValues('item_type', PO_ITEM_TYPE_OPTIONS)

  // --- Totals ---
  const totals = useMemo(() => {
    try { return { ...reconcilePOTotals(items), error: '' } }
    catch (err) { return { sub_total: 0, tax_total: 0, total: 0, error: err.message } }
  }, [items])

  // Profit summary
  const profitSummary = useMemo(() => {
    let soTotal = 0, poTotal = 0
    items.forEach(item => {
      if (item.so_item_id) {
        const si = soItems.find(s => String(s.id) === String(item.so_item_id))
        if (si) soTotal += toAmount(si.taxable_amount)
      }
      poTotal += toAmount(itemAmounts(item).taxable_amount)
    })
    return { so_before_tax: round2(soTotal), po_before_tax: round2(poTotal), profit: round2(soTotal - poTotal) }
  }, [items, soItems])

  const campaignInvalid = Boolean(form.campaign_start_date && form.campaign_end_date && form.campaign_end_date < form.campaign_start_date)
  const duration = campaignInvalid ? null : campaignDays(form.campaign_start_date, form.campaign_end_date)

  // In the order the form asks, so the first message is the first gap.
  function validate() {
    if (!form.sales_order_id) return 'Choose the sales order this purchase is for.'
    if (!form.order_number.trim()) return 'Enter a PO number.'
    if (!form.vendor_name.trim() && !form.vendor_id) return 'Choose the vendor.'
    // vendor_address_id is what marks this salesorder row as a purchase
    // order. Saved without it, the PO would turn into a sales order.
    if (!form.vendor_address_id) return 'Choose the vendor address this purchase order goes to.'
    if (campaignInvalid) return 'Campaign end date must be on or after start date.'
    if (items.length === 0) return 'Add at least one item.'
    const unnamed = items.findIndex(item => !item.name.trim())
    if (unnamed >= 0) return `Item ${unnamed + 1} needs a name.`
    return ''
  }

  async function saveItems(poId) {
    const soId = Number(form.sales_order_id)

    if (removedItemIds.length > 0) {
      const { error: delErr } = await supabase.from(PO_ITEM_TABLE).delete().in('id', removedItemIds)
      if (delErr) throw delErr
    }

    const stamp = new Date().toISOString()
    const existing = []
    const fresh = []
    items.forEach(item => {
      const payload = buildPOItemPayload(item, soId, poId)
      if (item.id) existing.push({ ...payload, id: item.id, updated_at: stamp })
      else fresh.push(payload)
    })

    if (existing.length > 0) {
      await writeRows(async (rows) => {
        for (const row of rows) {
          const { id, ...values } = row
          const { error: updErr } = await supabase.from(PO_ITEM_TABLE).update(values).eq('id', id)
          if (updErr) return { data: null, error: updErr }
        }
        return { data: rows, error: null }
      }, existing, PO_ITEM_FALLBACKS)
    }

    if (fresh.length > 0) {
      await writeRows(
        (rows) => supabase.from(PO_ITEM_TABLE).insert(rows).select('id'),
        fresh,
        PO_ITEM_FALLBACKS
      )
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const problem = validate()
    if (problem) { setError(problem); return }

    let payloadTotals
    try { payloadTotals = reconcilePOTotals(items) }
    catch (err) { setError(err.message); return }

    setSaving(true)
    setError('')

    try {
      const payload = buildPOHeaderPayload(form, payloadTotals, session)

      if (isEdit) {
        delete payload.created_by
        payload.updated_at = new Date().toISOString()
        const saved = await writeRows(
          (rows) => supabase.from(PO_HEADER_TABLE).update(rows[0]).eq('id', order.id).select('*').single(),
          [payload], PO_FALLBACKS
        )
        await saveItems(order.id)
        onSaved(saved || { ...order, ...payload })
      } else {
        const saved = await writeRows(
          (rows) => supabase.from(PO_HEADER_TABLE).insert(rows).select('*').single(),
          [payload], PO_FALLBACKS
        )
        if (!saved?.id) throw new Error('PO created but no ID returned.')
        try {
          await saveItems(saved.id)
        } catch (err) {
          await supabase.from(PO_HEADER_TABLE).delete().eq('id', saved.id)
          throw err
        }
        onSaved(saved)
      }
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Could not save the purchase order.')
    } finally {
      setSaving(false)
    }
  }

  const field = (name) => ({ value: form[name], onChange: (event) => update(name, event.target.value) })
  const moreFilled = [form.crm_reference_id, form.order_type, form.approved_by, form.approved_date, form.complete_date].filter(Boolean).length

  return (
    <FormModal
      wide
      title={isEdit ? `Edit ${order.order_number || `PO #${order.id}`}` : 'New purchase order'}
      subtitle={isEdit ? (order.vendor_name || order.company) : 'Pick the sales order and the vendor, add what you are buying, and save.'}
      onClose={onClose}
      onSubmit={handleSubmit}
      busy={saving}
      submitDisabled={itemsLoading}
      error={error}
      errorTitle="Could not save the purchase order"
      submitLabel={isEdit ? 'Save changes' : 'Create purchase order'}
      footerInfo={<>Total <strong>{formatRupees(totals.total)}</strong></>}
    >
      <FormSection title="Order">
        <div className="crm-grid crm-grid--3">
          <div className="crm-span-2">
            <SearchableSelect
              label="For sales order"
              required
              value={form.sales_order_id}
              onChange={selectSO}
              options={soOptions}
              placeholder={soOptions.length === 0 ? 'Loading sales orders…' : 'Choose a sales order'}
              searchPlaceholder="Search sales orders…"
            />
          </div>
          <Field label="PO number" htmlFor="po-order-number" required>
            <input id="po-order-number" className="crm-input crm-mono-input" {...field('order_number')} />
          </Field>
          <Field label="Client">
            <div className="crm-readout">{form.so_company || 'From the sales order'}</div>
          </Field>
          <Field label="Order date" htmlFor="po-order-date">
            <input id="po-order-date" type="date" className="crm-input" {...field('order_date')} />
          </Field>
          <Field label="Status" htmlFor="po-order-status">
            <select id="po-order-status" className="crm-select" {...field('order_status')}>
              <option value="">Not set</option>
              {listValues('order_status', ORDER_STATUS_OPTIONS, form.order_status).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Vendor">
        <div className="crm-grid">
          <SearchableSelect
            label="Vendor"
            required
            value={form.vendor_id}
            onChange={selectVendor}
            options={vendorOptions}
            placeholder={vendorOptions.length === 0 ? 'Loading vendors…' : 'Choose a vendor'}
            searchPlaceholder="Search vendors…"
          />
          <SearchableSelect
            label="Vendor address"
            required
            value={form.vendor_address_id}
            onChange={(value) => update('vendor_address_id', value)}
            options={addressOptions}
            placeholder={!form.vendor_id ? 'Choose the vendor first' : vendorAddresses.length === 0 ? 'This vendor has no address' : 'Choose an address'}
            searchPlaceholder="Search addresses…"
            disabled={!form.vendor_id}
          />
        </div>
      </FormSection>

      <FormSection title="Campaign" description="Filled in from the sales order. Change it if this purchase covers different dates.">
        <div className="crm-grid crm-grid--4">
          <Field label="Brand" htmlFor="po-brand">
            <input id="po-brand" className="crm-input" {...field('brand_name')} />
          </Field>
          <Field label="Starts" htmlFor="po-campaign-start">
            <input id="po-campaign-start" type="date" className="crm-input" {...field('campaign_start_date')} />
          </Field>
          <Field label="Ends" htmlFor="po-campaign-end">
            <input id="po-campaign-end" type="date" className="crm-input" {...field('campaign_end_date')} min={form.campaign_start_date || undefined} aria-invalid={campaignInvalid} />
          </Field>
          <Field label="Duration">
            <div className={`crm-readout${campaignInvalid ? ' is-invalid' : ''}`}>
              {campaignInvalid ? 'Ends before it starts' : duration ? `${duration} ${duration === 1 ? 'day' : 'days'}` : 'Set both dates'}
            </div>
          </Field>
        </div>
      </FormSection>

      <FormSection title={`Items (${items.length})`} description="Link each line to the sales order line it supplies to see the margin on it.">
        <div className="crm-items">
          {itemsLoading ? (
            <p className="crm-section-note">Loading items…</p>
          ) : (
            items.map((item, index) => (
              <POItemEditor
                key={item.key}
                item={item}
                index={index}
                onChange={changeItem}
                onRemove={removeItem}
                onToggle={toggleItem}
                canRemove={items.length > 1}
                soItems={soItems}
                typeOptions={itemTypeOptions}
              />
            ))
          )}
        </div>
        <button type="button" className="crm-btn crm-btn--secondary" onClick={addItem} disabled={itemsLoading}>
          <Icon name="plus" size={16} /> Add item
        </button>
      </FormSection>

      <FormSection title="Totals and payment">
        <div className="crm-totals">
          <div className="crm-total"><span>Before tax</span><strong>{formatRupees(totals.sub_total)}</strong></div>
          <div className="crm-total"><span>Tax</span><strong>{formatRupees(totals.tax_total)}</strong></div>
          <div className="crm-total is-grand"><span>Total</span><strong>{formatRupees(totals.total)}</strong></div>
        </div>
        {profitSummary.so_before_tax > 0 && (
          <div className="crm-totals">
            <div className="crm-total"><span>Sold for (before tax)</span><strong>{formatRupees(profitSummary.so_before_tax)}</strong></div>
            <div className="crm-total"><span>Bought for (before tax)</span><strong>{formatRupees(profitSummary.po_before_tax)}</strong></div>
            <div className="crm-total is-grand"><span>Margin</span><strong>{formatRupees(profitSummary.profit)}</strong></div>
          </div>
        )}
        {totals.error && <div className="crm-note crm-note--danger" role="alert" style={{ marginBottom: 14 }}>{totals.error}</div>}
        <div className="crm-grid crm-grid--3">
          <Field label="Payment requested" htmlFor="po-receipt">
            <div className="crm-input-group">
              <span className="crm-addon">₹</span>
              <input id="po-receipt" type="number" step="0.01" min="0" inputMode="decimal" className="crm-input crm-mono-input" {...field('payment_receipt_amount')} />
            </div>
          </Field>
        </div>
      </FormSection>

      <FormSection title="More details" description="References and approvals most purchase orders leave empty.">
        <Disclosure label="Show all fields" count={moreFilled ? `${moreFilled} filled` : '5 fields'}>
          <div className="crm-grid crm-grid--3">
            <Field label="CRM reference" htmlFor="po-crm">
              <input id="po-crm" className="crm-input crm-mono-input" {...field('crm_reference_id')} />
            </Field>
            <Field label="Order type" htmlFor="po-order-type">
              <select id="po-order-type" className="crm-select" {...field('order_type')}>
                <option value="">Not set</option>
                {listValues('order_type', ORDER_TYPE_OPTIONS, form.order_type).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Field>
            <Field label="Approved by" htmlFor="po-approved-by">
              <input id="po-approved-by" className="crm-input" {...field('approved_by')} />
            </Field>
            <Field label="Approved on" htmlFor="po-approved-date">
              <input id="po-approved-date" type="date" className="crm-input" {...field('approved_date')} />
            </Field>
            <Field label="Completed on" htmlFor="po-complete-date">
              <input id="po-complete-date" type="date" className="crm-input" {...field('complete_date')} />
            </Field>
          </div>
        </Disclosure>
      </FormSection>
    </FormModal>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════ */

export default function PurchaseOrdersPage({ session }) {
  const { can } = useAccess()
  const [formInitial, setFormInitial] = useState(null)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')

  const [orders, setOrders] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => preferredPageSize(PO_PAGE_SIZES))
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState({ key: 0, silent: false })

  const [selectedOrder, setSelectedOrder] = useState(null)
  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingOrder, setEditingOrder] = useState(null)
  const [notice, setNotice] = useState('')

  const searchColumnsRef = useRef(PO_SEARCH_COLUMNS)

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(searchInput.trim()); setPage(1) }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Load the page of purchase orders
  useEffect(() => {
    let cancelled = false
    const silent = refresh.silent

    async function loadOrders() {
      if (silent) setRefreshing(true)
      else setLoading(true)
      setError('')

      const from = (page - 1) * pageSize

      function runQuery(columns) {
        const request = supabase
          .from(PO_HEADER_TABLE)
          .select(PO_SELECT, { count: 'exact' })
          .not('vendor_address_id', 'is', null)
          .order('id', { ascending: false })
          .range(from, from + pageSize - 1)
        return poSearchFilter(request, query, columns)
      }

      let result = await runQuery(searchColumnsRef.current)

      if (result.error && query && isIlikeTypeError(result.error) && searchColumnsRef.current.length > 1) {
        searchColumnsRef.current = PO_SEARCH_FALLBACK
        result = await runQuery(PO_SEARCH_FALLBACK)
      }

      let rows = result.data || []
      if (!result.error) rows = await attachSalesOrders(rows)
      if (cancelled) return

      if (result.error) {
        setOrders([])
        setTotalCount(0)
        setError(result.error.message)
      } else {
        setOrders(rows)
        setTotalCount(result.count || 0)
        // Keep an open panel in step with what was just loaded.
        setSelectedOrder((current) => (current ? rows.find((row) => row.id === current.id) || current : current))
      }
      setLoading(false)
      setRefreshing(false)
    }

    loadOrders()
    return () => { cancelled = true }
  }, [page, pageSize, query, refresh])

  // Items of the open purchase order
  useEffect(() => {
    const orderId = selectedOrder?.id
    if (!orderId) { setItems([]); setItemsError(''); return undefined }
    let cancelled = false

    async function loadItems() {
      setItemsLoading(true)
      setItemsError('')
      const { data, error: err } = await supabase
        .from(PO_ITEM_TABLE)
        .select('*')
        .eq('purchase_order_id', orderId)
        .order('id', { ascending: true })
      if (cancelled) return
      if (err) { setItems([]); setItemsError(err.message) }
      else setItems(data || [])
      setItemsLoading(false)
    }

    loadItems()
    return () => { cancelled = true }
  }, [selectedOrder?.id, refresh.key])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalCount)

  function changePage(next) { setPage(Math.max(1, Math.min(next, totalPages))) }
  function openAddForm(initial = null) { setEditingOrder(null); setFormInitial(initial); setShowForm(true) }
  function openEditForm(order) { setEditingOrder(order); setShowForm(true) }
  function closeForm() { setShowForm(false); setEditingOrder(null); setFormInitial(null) }

  // "New PO" in a vendor's panel lands here with that vendor chosen; its
  // address is picked for you when it has only one. Cleared after use.
  const location = useLocation()
  const navigate = useNavigate()
  const startFrom = location.state?.newPoVendor
  useEffect(() => {
    if (!startFrom) return
    if (can('purchase_orders.create')) openAddForm({ vendor_id: String(startFrom.id), vendor_name: startFrom.name || '' })
    navigate(location.pathname, { replace: true, state: null })
  }, [startFrom]) // eslint-disable-line react-hooks/exhaustive-deps

  function afterSaved(saved) {
    const wasEdit = Boolean(editingOrder?.id)
    closeForm()
    if (saved?.id) {
      const row = normalizePO(saved)
      setOrders((current) => (current.some((existing) => existing.id === saved.id)
        ? current.map((existing) => (existing.id === saved.id ? { ...existing, ...saved } : existing))
        : [row, ...current].slice(0, pageSize)))
      setSelectedOrder((current) => (current?.id === saved.id ? { ...current, ...saved } : current))
      if (!wasEdit) setTotalCount((count) => count + 1)
    }
    // Reload quietly so vendor, address and SO number come back joined.
    setRefresh((current) => ({ key: current.key + 1, silent: Boolean(saved?.id) }))
    setNotice(wasEdit ? 'Purchase order saved' : 'Purchase order created')
  }

  const searchNarrowed = searchColumnsRef.current.length < PO_SEARCH_COLUMNS.length
  const canCreate = can('purchase_orders.create')

  return (
    <div className="crm-page">
      <PageHeader title="Purchase orders" subtitle="What you buy from vendors to deliver your sales orders.">
        {canCreate && (
          <button type="button" className="crm-btn crm-btn--primary" onClick={() => openAddForm()}>
            <Icon name="plus" size={17} /> New purchase order
          </button>
        )}
      </PageHeader>

      <div className="crm-toolbar">
        <SearchField
          value={searchInput}
          onChange={setSearchInput}
          placeholder={searchNarrowed ? 'Search by vendor' : 'Search by PO number, vendor, brand or CRM reference'}
          label="Search purchase orders"
        />
        {!loading && <ResultCount shown={totalCount} total={totalCount} noun="purchase order" filtered={Boolean(query)} />}
        {refreshing && <span className="crm-count" style={{ marginLeft: 0 }}>Updating…</span>}
      </div>

      {error && (
        <div className="crm-note crm-note--danger" role="alert">
          <Icon name="alert" size={17} />
          <div><strong>Could not load purchase orders.</strong> {error}</div>
        </div>
      )}

      <section className="crm-card">
        <div className="crm-table-scroll">
          <table className="crm-table">
            <thead>
              <tr>
                <th style={{ width: '15%' }}>Purchase order</th>
                <th className="crm-hide-sm" style={{ width: '24%' }}>Vendor</th>
                <th className="crm-hide-sm crm-hide-lg" style={{ width: '18%' }}>For sales order</th>
                <th className="crm-hide-sm" style={{ width: '17%' }}>Campaign</th>
                <th className="crm-hide-sm" style={{ width: '13%' }}>Status</th>
                <th className="crm-num" style={{ width: '14%' }}>Total</th>
                <th className="crm-col-tight" style={{ width: '36px' }} aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} columns={PO_COLUMN_COUNT} />
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={PO_COLUMN_COUNT} className="crm-empty-cell">
                    {query ? (
                      <EmptyState title="No purchase orders match your search">Try a PO number, a vendor, a brand or a CRM reference.</EmptyState>
                    ) : (
                      <EmptyState icon="file" title="No purchase orders yet"
                        action={canCreate && <button type="button" className="crm-btn crm-btn--primary" onClick={() => openAddForm()}><Icon name="plus" size={16} /> New purchase order</button>}>
                        A purchase order records what you buy from a vendor for a sales order, so you can see the margin on it.
                      </EmptyState>
                    )}
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order.id}
                    className={`crm-row${selectedOrder?.id === order.id ? ' is-selected' : ''}`}
                    onClick={() => setSelectedOrder(order)}
                  >
                    <td>
                      <div className="crm-cell">
                        <button type="button" className="crm-row-link crm-cell-main is-strong crm-mono" onClick={(event) => { event.stopPropagation(); setSelectedOrder(order) }}>
                          {order.order_color && <span className="crm-swatch" style={{ background: order.order_color, marginRight: 7 }} aria-hidden="true" />}
                          {order.order_number || `#${order.id}`}
                        </button>
                        <span className="crm-cell-sub crm-hide-sm">{order.order_date ? formatDisplayDate(order.order_date) : '—'}</span>
                        <span className="crm-cell-sub crm-show-sm">{order.vendor_name || '—'}</span>
                      </div>
                    </td>
                    <td className="crm-hide-sm"><Cell main={order.vendor_name} sub={[order.city, order.state].filter(Boolean).join(', ') || order.contact_person} title={order.vendor_name || ''} /></td>
                    <td className="crm-hide-sm crm-hide-lg"><Cell main={order.order_sales_number} sub={order.so_company} mono={false} /></td>
                    <td className="crm-hide-sm"><Cell main={formatDateRange(order.campaign_start_date, order.campaign_end_date)} sub={order.brand_name} /></td>
                    <td className="crm-hide-sm">
                      {order.order_status ? <StatusPill tone={statusTone(order.order_status)}>{order.order_status}</StatusPill> : <span className="crm-empty-value">—</span>}
                    </td>
                    <td className="crm-num">
                      <div className="crm-cell">
                        <span className="crm-cell-main is-strong crm-mono">{formatRupees(order.total)}</span>
                        <span className="crm-cell-sub crm-mono crm-hide-sm">{order.tax_total ? `${formatRupees(order.tax_total)} tax` : 'No tax'}</span>
                        <span className="crm-cell-sub crm-show-sm">{order.order_status || '—'}</span>
                      </div>
                    </td>
                    <td className="crm-col-tight"><RowChevron /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          start={pageStart}
          end={pageEnd}
          total={totalCount}
          pageSize={pageSize}
          pageSizes={PO_PAGE_SIZES}
          onPage={changePage}
          onPageSize={(size) => { setPageSize(size); setPage(1) }}
        />
      </section>

      {selectedOrder && (
        <PurchaseOrderDetails
          order={selectedOrder}
          items={items}
          itemsLoading={itemsLoading}
          itemsError={itemsError}
          onClose={() => setSelectedOrder(null)}
          onEdit={can('purchase_orders.edit') ? () => openEditForm(selectedOrder) : null}
        />
      )}

      {showForm && (
        <PurchaseOrderFormModal
          order={editingOrder}
          initial={formInitial}
          session={session}
          onClose={closeForm}
          onSaved={afterSaved}
        />
      )}

      <Toast message={notice} onDone={() => setNotice('')} />
    </div>
  )
}
