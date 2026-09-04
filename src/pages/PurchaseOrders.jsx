import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import {
  Icon, formatValue, getValue, uniqueOptions, SearchableSelect,
  ORDER_TYPE_OPTIONS, ORDER_STATUS_OPTIONS,
  GST_TYPE_OPTIONS, GST_RATES,
  round2, toAmount, formatMoney, formatDate, formatDateInput,
  campaignDays, todayIso,
  splitGst, itemAmounts, taxFromRate, rateFromAmounts, gstBreakdown,
  storedItemTotals, statusTone, sessionActor, applyItemChange,
  missingColumnFrom, notNullColumnFrom
} from '../App'

/* ─── Constants ────────────────────────────────────────────────────────── */

const PURCHASE_ORDER_VIEW = 'purchaseorders'
const PO_HEADER_TABLE     = 'salesorder'
const PO_ITEM_TABLE       = 'salesorderdocument'
const PO_PAGE_SIZES       = [25, 50, 75, 100]
const PO_COLUMN_COUNT     = 10
const PO_SEARCH_COLUMNS   = ['order_number', 'company', 'order_sales_number', 'crm_reference_id']
const PO_SEARCH_FALLBACK  = ['company']

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
    order_type: ORDER_TYPE_OPTIONS[0],
    order_date: todayIso(),
    order_status: ORDER_STATUS_OPTIONS[0],
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
    sales_order_id: '',
    so_order_number: row.order_sales_number ?? '',
    so_company: '',
    vendor_id: '',
    vendor_name: row.company ?? '',
    vendor_address_id: '',
  }
}

function blankPOItem(key) {
  return {
    key,
    id: null,
    so_item_id: '',
    so_item_name: '',
    so_item_taxable: 0,
    type: PO_ITEM_TYPE_OPTIONS[0],
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
  const field = (name) => (event) => onChange(index, name, event.target.value)
  const breakdown = gstBreakdown(amounts)

  const soItem = soItems.find(si => String(si.id) === String(item.so_item_id))
  const profit = soItem ? round2(toAmount(soItem.taxable_amount) - amounts.taxable_amount) : null

  return (
    <div className="so-item-card">
      <div className="so-item-head">
        <span className="so-item-index">{index + 1}</span>
        <span className="so-item-title" title={item.name}>{item.name.trim() || 'Untitled item'}</span>
        <span className="so-item-amount mono-cell">{formatMoney(amounts.after_tax_amount)}</span>
        <button type="button" className="so-item-more" onClick={() => onToggle(index)} aria-expanded={item.expanded}>
          {item.expanded ? 'Fewer fields' : 'More fields'}
          <Icon name="chevronDown" size={14} />
        </button>
        <button type="button" className="icon-button small" onClick={() => onRemove(index)} disabled={!canRemove} title={canRemove ? 'Remove item' : 'At least one item required'} aria-label={`Remove item ${index + 1}`}>
          <Icon name="trash" size={16} />
        </button>
      </div>

      <div className="so-item-grid">
        <div className="field">
          <label htmlFor={`po-item-soitem-${item.key}`}>SO Item</label>
          <select id={`po-item-soitem-${item.key}`} value={item.so_item_id} onChange={field('so_item_id')}>
            <option value="">— Select —</option>
            {soItems.map(si => (
              <option key={si.id} value={si.id}>{si.name} ({formatMoney(si.taxable_amount)})</option>
            ))}
          </select>
        </div>

        <div className="field so-item-name">
          <label htmlFor={`po-item-name-${item.key}`}>Name *</label>
          <input id={`po-item-name-${item.key}`} value={item.name} onChange={field('name')} placeholder="What is being purchased" />
        </div>

        <div className="field">
          <label htmlFor={`po-item-type-${item.key}`}>Type</label>
          <select id={`po-item-type-${item.key}`} value={item.type} onChange={field('type')}>
            <option value="">—</option>
            {typeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`po-item-taxable-${item.key}`}>PO Cost (Taxable)</label>
          <input id={`po-item-taxable-${item.key}`} type="number" step="0.01" min="0" inputMode="decimal" value={item.taxable_amount} onChange={field('taxable_amount')} placeholder="0.00" />
        </div>

        <div className="field so-check-field">
          <label>GST</label>
          <button type="button" className="so-check" onClick={() => onChange(index, 'is_taxable', !item.is_taxable)} aria-pressed={item.is_taxable}>
            <span className={`checkbox-button ${item.is_taxable ? 'checked' : ''}`}>
              {item.is_taxable ? <Icon name="check" size={13} /> : null}
            </span>
            Taxable
          </button>
        </div>

        <div className="field">
          <label htmlFor={`po-item-gst-type-${item.key}`}>GST Type</label>
          <select id={`po-item-gst-type-${item.key}`} value={item.gst_type} onChange={field('gst_type')} disabled={!item.is_taxable}>
            {GST_TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`po-item-rate-${item.key}`}>GST Rate</label>
          <select id={`po-item-rate-${item.key}`} value={item.gst_rate} onChange={field('gst_rate')} disabled={!item.is_taxable}>
            {GST_RATES.map(rate => <option key={rate} value={String(rate)}>{rate}%</option>)}
            <option value="custom">Custom</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor={`po-item-tax-${item.key}`}>Tax Amount</label>
          <input id={`po-item-tax-${item.key}`} type="number" step="0.01" min="0" inputMode="decimal" value={item.tax_amount} onChange={field('tax_amount')} disabled={!item.is_taxable || item.gst_rate !== 'custom'} placeholder="0.00" />
        </div>
      </div>

      {item.expanded && (
        <div className="so-item-grid so-item-extra">
          <div className="field">
            <label htmlFor={`po-item-date-${item.key}`}>Date</label>
            <input id={`po-item-date-${item.key}`} type="date" value={item.date} onChange={field('date')} />
          </div>
          <div className="field">
            <label htmlFor={`po-item-short-${item.key}`}>Short Name</label>
            <input id={`po-item-short-${item.key}`} value={item.short_name} onChange={field('short_name')} />
          </div>
          <div className="field">
            <label htmlFor={`po-item-invoice-${item.key}`}>Invoice Number</label>
            <input id={`po-item-invoice-${item.key}`} value={item.invoice_number} onChange={field('invoice_number')} />
          </div>
          <div className="field so-check-field">
            <label>Audit</label>
            <button type="button" className="so-check" onClick={() => onChange(index, 'self_audit_completed', !item.self_audit_completed)} aria-pressed={item.self_audit_completed}>
              <span className={`checkbox-button ${item.self_audit_completed ? 'checked' : ''}`}>
                {item.self_audit_completed ? <Icon name="check" size={13} /> : null}
              </span>
              Self audit done
            </button>
          </div>
          <div className="field field-wide">
            <label htmlFor={`po-item-file-${item.key}`}>Attachment URL</label>
            <input id={`po-item-file-${item.key}`} type="url" value={item.file_url} onChange={field('file_url')} placeholder="https://…" />
          </div>
          <div className="field field-wide">
            <label htmlFor={`po-item-note-${item.key}`}>Note</label>
            <textarea id={`po-item-note-${item.key}`} rows="2" value={item.document_note} onChange={field('document_note')} />
          </div>
        </div>
      )}

      <div className="so-item-foot">
        <span>Taxable <strong className="mono-cell">{formatMoney(amounts.taxable_amount)}</strong></span>
        <span>Tax <strong className="mono-cell">{formatMoney(amounts.tax_amount)}</strong></span>
        <span className="so-item-foot-gst">{breakdown || (item.is_taxable ? 'No GST yet' : 'Not taxable')}</span>
        <span className="so-item-foot-total">After tax <strong className="mono-cell">{formatMoney(amounts.after_tax_amount)}</strong></span>
        {profit != null && <span className="so-item-foot-total">Profit <strong className="mono-cell">{formatMoney(profit)}</strong></span>}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   PO DETAILS PANEL
   ═══════════════════════════════════════════════════════════════════════ */

function POItemCard({ row }) {
  const breakdown = gstBreakdown(row)
  return (
    <div className="so-detail-item">
      <div className="so-detail-item-head">
        <span className="so-detail-item-name" title={row.name || ''}>{formatValue(row.name)}</span>
        <span className="so-detail-item-total">{formatMoney(row.after_tax_amount)}</span>
      </div>
      <div className="so-detail-item-meta">
        <span>{formatValue(getValue(row, ['type', 'label']))}</span>
        {row.date && <span>{formatDate(row.date)}</span>}
        {row.invoice_number && <span>Inv {row.invoice_number}</span>}
        {row.self_audit_completed && <span className="so-detail-item-flag">Self-audited</span>}
      </div>
      <div className="so-detail-item-money">
        <span>Taxable <strong>{formatMoney(row.taxable_amount)}</strong></span>
        <span>Tax <strong>{formatMoney(row.tax_amount)}</strong></span>
      </div>
      {(breakdown || row.gst_type) && (
        <div className="so-detail-item-gst">{[row.is_taxable === false ? 'Not taxable' : row.gst_type, breakdown].filter(Boolean).join(' · ')}</div>
      )}
      {row.document_note && <div className="so-detail-item-note">{row.document_note}</div>}
      {row.file_url && (
        <a className="so-detail-item-link" href={row.file_url} target="_blank" rel="noopener noreferrer">
          <Icon name="file" size={14} /> Open attachment
        </a>
      )}
    </div>
  )
}

function PurchaseOrderDetails({ order, items, itemsLoading, itemsError, onClose, onEdit }) {
  if (!order) return null

  const duration = campaignDays(order.campaign_start_date, order.campaign_end_date)
  const stored = storedItemTotals(items)
  const drifted = !itemsLoading && !itemsError && items.length > 0 && Math.abs(stored.total - toAmount(order.total)) > MONEY_EPSILON
  const receipt = toAmount(order.payment_request_amount || order.payment_receipt_amount)
  const balance = (order.payment_request_amount != null || order.payment_receipt_amount != null) ? round2(toAmount(order.total) - receipt) : null

  const sections = [
    { title: 'Order Info', fields: [
      ['PO Number', order.order_number],
      ['CRM Reference', order.crm_reference_id],
      ['Order Type', order.order_type],
      ['Order Date', order.order_date && formatDate(order.order_date)],
      ['Order Status', order.order_status],
    ]},
    { title: 'Sales Order', fields: [
      ['SO Number', order.order_sales_number],
    ]},
    { title: 'Vendor', fields: [
      ['Company', order.company],
      ['Contact Person', order.order_vendor_fullname || order.contact_person],
      ['Alias', order.alias],
      ['Email', order.email],
      ['GSTIN', order.gstin],
      ['PAN', order.pan_number],
      ['Vendor Type', order.vendor_type],
    ]},
    { title: 'Address', fields: [
      ['Address', order.address],
      ['City', order.city],
      ['State', order.state],
      ['Country', order.country],
      ['Zipcode', order.zipcode],
    ]},
    { title: 'Campaign', fields: [
      ['Start Date', order.campaign_start_date && formatDate(order.campaign_start_date)],
      ['End Date', order.campaign_end_date && formatDate(order.campaign_end_date)],
      ['Duration', duration && `${duration} ${duration === 1 ? 'day' : 'days'}`],
    ]},
    { title: 'Media / Brand', fields: [
      ['Brand Name', order.brand_name],
    ]},
    { title: 'Approval', fields: [
      ['Approved By', order.approved_by],
      ['Approved Date', order.approved_date && formatDate(order.approved_date)],
      ['Completed Date', order.complete_date && formatDate(order.complete_date)],
      ['Created By', order.created_by],
      ['Created At', order.created_at && formatDate(order.created_at)],
      ['Last Updated', order.updated_at && formatDate(order.updated_at)],
    ]},
  ]

  return (
    <aside className="details-drawer" aria-label="Purchase order details">
      <div className="drawer-header">
        <div>
          <span className="drawer-kicker">PURCHASE ORDER</span>
          <h2>{formatValue(order.order_number)}</h2>
        </div>
        <div className="drawer-header-actions">
          <button className="icon-button" onClick={onEdit} aria-label="Edit purchase order" title="Edit">
            <Icon name="edit" size={18} />
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={19} />
          </button>
        </div>
      </div>
      <div className="drawer-divider" />

      {/* Financial totals */}
      <div className="so-total-panel">
        <div className="so-total-row">
          <span>Sub Total</span>
          <span className="mono-cell">{formatMoney(order.sub_total)}</span>
        </div>
        <div className="so-total-row">
          <span>Tax Total</span>
          <span className="mono-cell">{formatMoney(order.tax_total)}</span>
        </div>
        <div className="so-total-row is-grand">
          <span>Total</span>
          <span className="mono-cell">{formatMoney(order.total)}</span>
        </div>
        {receipt > 0 && (
          <>
            <div className="so-total-row">
              <span>Payment Request</span>
              <span className="mono-cell">{formatMoney(receipt)}</span>
            </div>
            {balance != null && (
              <div className="so-total-row">
                <span>Balance</span>
                <span className="mono-cell">{formatMoney(balance)}</span>
              </div>
            )}
          </>
        )}
      </div>

      {drifted && (
        <div className="so-drift-note" role="status">
          Items add up to {formatMoney(stored.total)}, which differs from the stored total. Saving again will recalculate.
        </div>
      )}

      {/* Child items */}
      <div className="details-list">
        <div className="details-section-title">
          Order Items
          {!itemsLoading && !itemsError && <span className="so-item-count">{items.length}</span>}
        </div>

        {itemsLoading ? (
          <div className="so-detail-items-state">Loading items…</div>
        ) : itemsError ? (
          <div className="so-detail-items-state is-error">{itemsError}</div>
        ) : items.length === 0 ? (
          <div className="so-detail-items-state">No items on this order.</div>
        ) : (
          <div className="so-detail-items">
            {items.map(row => <POItemCard key={row.id} row={row} />)}
          </div>
        )}

        {sections.map(section => (
          <div key={section.title}>
            <div className="details-section-title">{section.title}</div>
            {section.fields.map(([label, value]) => (
              <div className="detail-row" key={label}>
                <span className="detail-label">{label}</span>
                <span className="detail-value">{formatValue(value)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   ADD / EDIT FORM MODAL
   ═══════════════════════════════════════════════════════════════════════ */

function PurchaseOrderFormModal({ order, session, onClose, onSaved }) {
  const isEdit = Boolean(order?.id)

  const [form, setForm] = useState(() => isEdit ? poToForm(order) : blankPOForm())
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
  const [mediaOptions, setMediaOptions] = useState([])
  const [subMediaOptions, setSubMediaOptions] = useState([])

  function nextKey() { keyRef.current += 1; return `item-${keyRef.current}` }

  function update(name, value) {
    setForm(current => ({ ...current, [name]: value }))
  }

  // Load reference data on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      const [soRes, vRes, mRes, smRes] = await Promise.all([
        supabase.from('salesorder').select('id,order_number,company,crm_reference_id,campaign_start_date,campaign_end_date,brand_name').order('id', { ascending: false }).limit(1000),
        supabase.from('vendors').select('id,company_name,contact_person,alias,email,gstin,pan_number,vendor_type,media_id,sub_media_id').order('company_name', { ascending: true }).limit(1000),
        supabase.from('media').select('id,name').order('name', { ascending: true }),
        supabase.from('sub_media').select('id,name,media_id').order('name', { ascending: true }),
      ])
      if (cancelled) return
      setSalesOrders(soRes.data || [])
      setVendors(vRes.data || [])
      setMediaOptions(mRes.data || [])
      setSubMediaOptions(smRes.data || [])
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
      if (!cancelled) setVendorAddresses(data || [])
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

  const itemTypeOptions = useMemo(() => [...PO_ITEM_TYPE_OPTIONS], [])

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

  function validate() {
    if (!form.vendor_name.trim() && !form.vendor_id) return 'Select a vendor.'
    if (!form.order_number.trim()) return 'Enter a PO number.'
    if (!form.sales_order_id) return 'Select a Sales Order.'
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

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card so-modal-card" onMouseDown={e => e.stopPropagation()}>

        <div className="modal-header">
          <div>
            <span className="drawer-kicker">PURCHASE ORDER</span>
            <h2>{isEdit ? `Edit ${order.order_number || `PO #${order.id}`}` : 'Add purchase order'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={19} />
          </button>
        </div>

        {error && (
          <div className="form-error" role="alert">
            <Icon name="alert" size={17} />
            <div><strong>Could not save purchase order</strong><span>{error}</span></div>
          </div>
        )}

        <form className="vendor-form so-form" onSubmit={handleSubmit}>

          {/* ── Order Info ─────────────────────────────────── */}
          <div className="form-section-title field-wide">Order Info</div>

          <div className="field">
            <label htmlFor="po-order-number">PO Number *</label>
            <input id="po-order-number" value={form.order_number} onChange={e => update('order_number', e.target.value)} required />
          </div>

          <SearchableSelect
            label="Sales Order"
            required
            value={form.sales_order_id}
            onChange={selectSO}
            options={soOptions}
            placeholder={soOptions.length === 0 ? 'Loading…' : 'Select a sales order'}
            searchPlaceholder="Search orders…"
          />

          {form.so_company && (
            <div className="field">
              <label>Client</label>
              <div className="so-readout">{form.so_company}</div>
            </div>
          )}

          <div className="field">
            <label htmlFor="po-crm">CRM Reference ID</label>
            <input id="po-crm" value={form.crm_reference_id} onChange={e => update('crm_reference_id', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="po-order-type">Order Type</label>
            <select id="po-order-type" value={form.order_type} onChange={e => update('order_type', e.target.value)}>
              <option value="">—</option>
              {ORDER_TYPE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="po-order-date">Order Date</label>
            <input id="po-order-date" type="date" value={form.order_date} onChange={e => update('order_date', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="po-order-status">Order Status</label>
            <select id="po-order-status" value={form.order_status} onChange={e => update('order_status', e.target.value)}>
              <option value="">—</option>
              {ORDER_STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="po-approved-by">Approved By</label>
            <input id="po-approved-by" value={form.approved_by} onChange={e => update('approved_by', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="po-approved-date">Approved Date</label>
            <input id="po-approved-date" type="date" value={form.approved_date} onChange={e => update('approved_date', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="po-complete-date">Completed Date</label>
            <input id="po-complete-date" type="date" value={form.complete_date} onChange={e => update('complete_date', e.target.value)} />
          </div>

          {/* ── Campaign ──────────────────────────────────── */}
          <div className="form-section-title field-wide">Campaign</div>

          <div className="field">
            <label htmlFor="po-campaign-start">Campaign Start Date</label>
            <input id="po-campaign-start" type="date" value={form.campaign_start_date} onChange={e => update('campaign_start_date', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="po-campaign-end">Campaign End Date</label>
            <input id="po-campaign-end" type="date" value={form.campaign_end_date} min={form.campaign_start_date || undefined} onChange={e => update('campaign_end_date', e.target.value)} aria-invalid={campaignInvalid} />
          </div>

          <div className="field">
            <label>Duration</label>
            <div className={`so-readout ${campaignInvalid ? 'is-invalid' : ''}`}>
              {campaignInvalid ? 'End date before start' : duration ? `${duration} ${duration === 1 ? 'day' : 'days'}` : 'Set both dates'}
            </div>
          </div>

          {/* ── Vendor ────────────────────────────────────── */}
          <div className="form-section-title field-wide">Vendor</div>

          <SearchableSelect
            label="Vendor"
            required
            value={form.vendor_id}
            onChange={selectVendor}
            options={vendorOptions}
            placeholder={vendorOptions.length === 0 ? 'Loading…' : 'Select a vendor'}
            searchPlaceholder="Search vendors…"
          />

          <SearchableSelect
            label="Vendor Address"
            value={form.vendor_address_id}
            onChange={(val) => update('vendor_address_id', val)}
            options={addressOptions}
            placeholder={vendorAddresses.length === 0 ? (form.vendor_id ? 'No addresses' : 'Select vendor first') : 'Select address'}
            searchPlaceholder="Search addresses…"
            disabled={!form.vendor_id}
          />

          {/* ── Media / Brand ─────────────────────────────── */}
          <div className="form-section-title field-wide">Media / Brand</div>

          <div className="field">
            <label htmlFor="po-brand">Brand Name</label>
            <input id="po-brand" value={form.brand_name} onChange={e => update('brand_name', e.target.value)} />
          </div>

          {/* ── PO Items ──────────────────────────────────── */}
          <div className="form-section-title field-wide">
            PO Items
            <span className="so-item-count">{items.length}</span>
          </div>

          <div className="so-items field-wide">
            {itemsLoading ? (
              <div className="so-detail-items-state">Loading items…</div>
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

            <button type="button" className="secondary-button so-add-item" onClick={addItem}>
              <Icon name="plus" size={16} /> Add item
            </button>
          </div>

          {/* ── Summary ───────────────────────────────────── */}
          <div className="form-section-title field-wide">Summary</div>

          <div className="so-summary field-wide">
            <div className="so-summary-figures">
              <div className="so-summary-cell">
                <span>Sub Total</span>
                <strong className="mono-cell">{formatMoney(totals.sub_total)}</strong>
                <small>Sum of taxable amounts</small>
              </div>
              <div className="so-summary-cell">
                <span>Tax Total</span>
                <strong className="mono-cell">{formatMoney(totals.tax_total)}</strong>
                <small>Sum of item tax</small>
              </div>
              <div className="so-summary-cell is-grand">
                <span>Total</span>
                <strong className="mono-cell">{formatMoney(totals.total)}</strong>
                <small>Sum of after-tax amounts</small>
              </div>
            </div>

            {profitSummary.so_before_tax > 0 && (
              <div className="so-summary-figures" style={{ marginTop: '8px' }}>
                <div className="so-summary-cell">
                  <span>SO Before Tax</span>
                  <strong className="mono-cell">{formatMoney(profitSummary.so_before_tax)}</strong>
                </div>
                <div className="so-summary-cell">
                  <span>PO Before Tax</span>
                  <strong className="mono-cell">{formatMoney(profitSummary.po_before_tax)}</strong>
                </div>
                <div className="so-summary-cell is-grand">
                  <span>Profit</span>
                  <strong className="mono-cell">{formatMoney(profitSummary.profit)}</strong>
                </div>
              </div>
            )}

            {totals.error
              ? <div className="so-summary-note is-error">{totals.error}</div>
              : <div className="so-summary-note">Recalculated from the {items.length} {items.length === 1 ? 'item' : 'items'} above.</div>}
          </div>

          <div className="field">
            <label htmlFor="po-receipt">Payment Request Amount</label>
            <input id="po-receipt" type="number" step="0.01" min="0" inputMode="decimal" value={form.payment_receipt_amount} onChange={e => update('payment_receipt_amount', e.target.value)} placeholder="0.00" />
          </div>

          <div className="form-actions field-wide">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving || itemsLoading}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Purchase Order'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════ */

export default function PurchaseOrdersPage({ session }) {
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')

  const [orders, setOrders] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PO_PAGE_SIZES[0])
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

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const searchColumnsRef = useRef(PO_SEARCH_COLUMNS)

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(searchInput.trim()); setPage(1) }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Load PO list
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
          .from(PURCHASE_ORDER_VIEW)
          .select('*', { count: 'exact' })
          .order('id', { ascending: false })
          .range(from, from + pageSize - 1)
        return poSearchFilter(request, query, columns)
      }

      let result = await runQuery(searchColumnsRef.current)

      if (result.error && query && isIlikeTypeError(result.error) && searchColumnsRef.current.length > 1) {
        searchColumnsRef.current = PO_SEARCH_FALLBACK
        result = await runQuery(PO_SEARCH_FALLBACK)
      }

      if (cancelled) return

      if (result.error) {
        setOrders([])
        setTotalCount(0)
        setError(result.error.message)
      } else {
        setOrders(result.data || [])
        setTotalCount(result.count || 0)
      }
      setLoading(false)
      setRefreshing(false)
    }

    loadOrders()
    return () => { cancelled = true }
  }, [page, pageSize, query, refresh])

  // Load child items for selected order
  useEffect(() => {
    const orderId = selectedOrder?.id
    if (!orderId) { setItems([]); setItemsError(''); return }
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

  // Pagination
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalCount)

  const pageNumbers = useMemo(() => {
    const current = Math.min(page, totalPages)
    return [current - 2, current - 1, current, current + 1, current + 2].filter(n => n >= 1 && n <= totalPages)
  }, [page, totalPages])

  function changePage(n) { setPage(Math.max(1, Math.min(n, totalPages))) }
  function changePageSize(e) { setPageSize(Number(e.target.value)); setPage(1) }

  // Actions
  function openAddForm() { setEditingOrder(null); setShowForm(true) }
  function openEditForm(ord) { setEditingOrder(ord); setShowForm(true) }
  function closeForm() { setShowForm(false); setEditingOrder(null) }

  function afterSaved(saved) {
    const wasEdit = Boolean(editingOrder?.id)
    closeForm()
    if (saved?.id) {
      setOrders(current => current.some(r => r.id === saved.id)
        ? current.map(r => r.id === saved.id ? { ...r, ...saved } : r)
        : [saved, ...current].slice(0, pageSize))
      setSelectedOrder(current => current?.id === saved.id ? { ...current, ...saved } : current)
      if (!wasEdit) setTotalCount(c => c + 1)
    }
    setRefresh(c => ({ key: c.key + 1, silent: Boolean(saved?.id) }))
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      // Delete child items first
      await supabase.from(PO_ITEM_TABLE).delete().eq('purchase_order_id', deleteTarget.id)
      const { error: delErr } = await supabase.from(PO_HEADER_TABLE).delete().eq('id', deleteTarget.id)
      if (delErr) throw delErr
      setOrders(current => current.filter(r => r.id !== deleteTarget.id))
      setTotalCount(c => Math.max(0, c - 1))
      if (selectedOrder?.id === deleteTarget.id) setSelectedOrder(null)
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Could not delete purchase order.')
    }
    setDeleting(false)
    setDeleteTarget(null)
  }

  const searchNarrowed = searchColumnsRef.current.length < PO_SEARCH_COLUMNS.length
  const emptyCopy = query
    ? 'No purchase orders match this search. Try a PO number, vendor or SO number.'
    : 'Add your first purchase order to see it listed here.'

  return (
    <div className={`so-page ${selectedOrder ? 'has-selection' : ''}`}>
      <div className="so-main-content">
        <div className="page-header">
          <div>
            <span className="page-kicker">PROCUREMENT</span>
            <h1>Purchase Orders</h1>
            <p>{totalCount.toLocaleString()} {totalCount === 1 ? 'order' : 'orders'} in view · {pageSize} per page</p>
          </div>
          <button className="primary-button add-button" onClick={openAddForm}>
            <Icon name="plus" size={18} /> Add purchase order
          </button>
        </div>

        {/* Search */}
        <div className="vendors-toolbar">
          <div className="vendor-search">
            <span className="vendor-search-icon"><Icon name="search" size={17} /></span>
            <input
              className="vendor-search-input"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder={searchNarrowed ? 'Search vendor company…' : 'Search PO number, vendor, SO number or CRM reference…'}
              aria-label="Search purchase orders"
              autoComplete="off"
              spellCheck="false"
            />
            {searchInput && (
              <button type="button" className="search-clear" onClick={() => setSearchInput('')} aria-label="Clear search">
                <Icon name="close" size={15} />
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="page-error" role="alert">
            <span className="page-error-icon"><Icon name="alert" size={18} /></span>
            <div>
              <strong>Could not load purchase orders</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Table */}
        <section className="table-card">
          <div className="table-topline">
            <div>
              <strong>All Purchase Orders</strong>
              <span className="result-count">{totalCount.toLocaleString()} records</span>
              {refreshing && <span className="result-count">Updating…</span>}
              {query && <span className="search-state">Filtered by "{query}"</span>}
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>PO #</th>
                  <th>Vendor</th>
                  <th>SO #</th>
                  <th>Order Date</th>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th className="so-total-column">Total</th>
                  <th className="actions-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: Math.min(pageSize, 10) }).map((_, i) => (
                    <tr key={`po-skeleton-${i}`}>
                      {Array.from({ length: 8 }).map((__, c) => <td key={c}><span className="skeleton skeleton-company" /></td>)}
                    </tr>
                  ))
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      <div className="empty-title">No purchase orders found</div>
                      <div className="empty-copy">{emptyCopy}</div>
                    </td>
                  </tr>
                ) : (
                  orders.map(order => {
                    const campaign = order.campaign_start_date || order.campaign_end_date
                      ? `${formatDate(order.campaign_start_date)} → ${formatDate(order.campaign_end_date)}`
                      : null
                    const dur = campaignDays(order.campaign_start_date, order.campaign_end_date)

                    return (
                      <tr key={order.id} className={selectedOrder?.id === order.id ? 'is-open' : ''} onDoubleClick={() => setSelectedOrder(order)}>
                        <td>
                          <span className="cell-primary so-order-cell">
                            {order.order_color && <span className="so-color-dot" style={{ background: order.order_color }} aria-hidden="true" />}
                            {formatValue(order.order_number)}
                          </span>
                          <span className="cell-secondary" title={order.crm_reference_id || ''}>{formatValue(getValue(order, ['crm_reference_id', 'unique_id']))}</span>
                        </td>
                        <td>
                          <span className="cell-primary company-cell" title={order.company || ''}>{formatValue(order.company)}</span>
                          <span className="cell-secondary" title={order.order_vendor_fullname || ''}>{formatValue(order.order_vendor_fullname || order.contact_person)}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatValue(order.order_sales_number)}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatDate(order.order_date)}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatValue(campaign)}</span>
                          <span className="cell-secondary">{dur ? `${dur} ${dur === 1 ? 'day' : 'days'}` : '—'}</span>
                        </td>
                        <td>
                          <span className={`status-pill ${statusTone(order.order_status)}`}>
                            <span className="status-dot" />
                            {formatValue(order.order_status)}
                          </span>
                        </td>
                        <td className="so-total-column">
                          <span className="cell-primary mono-cell">{formatMoney(order.total)}</span>
                          <span className="cell-secondary mono-cell">Tax {formatMoney(order.tax_total)}</span>
                        </td>
                        <td className="actions-column">
                          <button className="row-action" onClick={() => setSelectedOrder(order)} aria-label={`Open PO ${order.order_number || order.id}`}>
                            <Icon name="chevron" size={17} />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pagination-bar">
            <div className="page-size-control">
              <span>Items per page</span>
              <select value={pageSize} onChange={changePageSize} aria-label="Purchase orders per page">
                {PO_PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
              </select>
            </div>

            <div className="pagination-meta">
              <span className="pagination-page-label">
                {totalCount === 0 ? 'No records' : <>Showing <strong>{pageStart}–{pageEnd}</strong> of {totalCount.toLocaleString()}</>}
              </span>
              <div className="pagination-buttons">
                <button onClick={() => changePage(1)} disabled={page <= 1} aria-label="First page"><Icon name="first" size={16} /></button>
                <button onClick={() => changePage(page - 1)} disabled={page <= 1} aria-label="Previous page"><Icon name="chevron" size={16} /></button>
                {pageNumbers.map(n => <button key={n} className={n === page ? 'current' : ''} onClick={() => changePage(n)} aria-current={n === page ? 'page' : undefined}>{n}</button>)}
                <button onClick={() => changePage(page + 1)} disabled={page >= totalPages} aria-label="Next page"><Icon name="chevron" size={16} /></button>
                <button onClick={() => changePage(totalPages)} disabled={page >= totalPages} aria-label="Last page"><Icon name="last" size={16} /></button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Side panel */}
      {selectedOrder && (
        <aside className="so-side-panel">
          <PurchaseOrderDetails
            order={selectedOrder}
            items={items}
            itemsLoading={itemsLoading}
            itemsError={itemsError}
            onClose={() => setSelectedOrder(null)}
            onEdit={() => openEditForm(selectedOrder)}
          />
        </aside>
      )}

      {/* Form modal */}
      {showForm && (
        <PurchaseOrderFormModal
          order={editingOrder}
          session={session}
          onClose={closeForm}
          onSaved={afterSaved}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="modal-backdrop" onMouseDown={() => !deleting && setDeleteTarget(null)}>
          <div className="modal-card" onMouseDown={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div>
                <span className="drawer-kicker">CONFIRM</span>
                <h2>Delete Purchase Order</h2>
              </div>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <p>Are you sure you want to delete <strong>{deleteTarget.order_number}</strong>? This will also remove all related PO items.</p>
            </div>
            <div className="form-actions" style={{ padding: '12px 24px 20px' }}>
              <button className="secondary-button" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
              <button className="primary-button" onClick={confirmDelete} disabled={deleting} style={{ background: 'var(--danger)' }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
