import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { formatValue, formatMoney, formatDate, formatDateInput, getValue } from '../../lib/format'
import { round2, toAmount } from '../../lib/money'
import { campaignDays, todayIso } from '../../lib/dates'
import {
  ORDER_TYPE_OPTIONS, ORDER_STATUS_OPTIONS, PURCHASE_STATUS_OPTIONS,
  GST_TYPE_OPTIONS, GST_RATES, SO_ITEM_TYPE_OPTIONS, SO_COURIER_STATUS_OPTIONS,
  itemAmounts, taxFromRate, reconcileSalesOrderTotals, applyItemChange,
  gstBreakdown, MONEY_EPSILON,
} from '../../lib/gst'
import { statusTone, isIlikeTypeError } from '../../lib/status'
import { writeRows } from '../../lib/writeRows'
import { Icon } from '../../components/Icon'
import { SearchableSelect } from '../../components/SearchableSelect'
import { generateTaxInvoice } from '../invoices/generateTaxInvoice'
import SalesOrderDetails from './SalesOrderDetails'
import {
  SO_COLOR_OPTIONS, blankSalesOrderForm, salesOrderToForm,
  blankSalesOrderItem, salesOrderItemToForm,
  buildSalesOrderPayload, buildSalesOrderItemPayload,
  sessionActor, SALES_ORDER_FALLBACKS, SALES_ORDER_ITEM_FALLBACKS,
  SO_SEARCH_COLUMNS, SO_SEARCH_FALLBACK_COLUMNS, soSearchFilter,
} from './salesOrderHelpers'

const SO_PAGE_SIZES = [25, 50, 75, 100]

// Define constants that were in App.jsx scope
const SALES_ORDER_TABLE = 'salesorder'
const SALES_ORDER_ITEM_TABLE = 'salesorderdocument'
const SO_COLUMN_COUNT = 8

function uniqueOptions(options) {
  return [...new Set(options)].map((opt) => (typeof opt === 'string' ? { label: opt, value: opt } : opt))
}

function SalesOrderItemEditor({ item, index, onChange, onRemove, onToggle, canRemove, typeOptions }) {
  const amounts = itemAmounts(item)
  const field = (name) => (event) => onChange(index, name, event.target.value)
  const breakdown = gstBreakdown(amounts)

  return (
    <div className="so-item-card">
      <div className="so-item-head">
        <span className="so-item-index">{index + 1}</span>
        {item.document_color && <span className="so-color-dot" style={{ background: item.document_color }} aria-hidden="true" />}
        <span className="so-item-title" title={item.name}>{item.name.trim() || 'Untitled item'}</span>
        <span className="so-item-amount mono-cell">{formatMoney(amounts.after_tax_amount)}</span>
        <button type="button" className="so-item-more" onClick={() => onToggle(index)} aria-expanded={item.expanded}>
          {item.expanded ? 'Fewer fields' : 'More fields'}
          <Icon name="chevronDown" size={14} />
        </button>
        <button
          type="button"
          className="icon-button small"
          onClick={() => onRemove(index)}
          disabled={!canRemove}
          title={canRemove ? 'Remove item' : 'An order needs at least one item'}
          aria-label={`Remove item ${index + 1}`}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>

      <div className="so-item-grid">
        <div className="field so-item-name">
          <label htmlFor={`so-item-name-${item.key}`}>Name *</label>
          <input id={`so-item-name-${item.key}`} value={item.name} onChange={field('name')} placeholder="What is being sold" />
        </div>

        <div className="field">
          <label htmlFor={`so-item-type-${item.key}`}>Type</label>
          <select id={`so-item-type-${item.key}`} value={item.type} onChange={field('type')}>
            <option value="">—</option>
            {typeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`so-item-date-${item.key}`}>Date</label>
          <input id={`so-item-date-${item.key}`} type="date" value={item.date} onChange={field('date')} />
        </div>

        <div className="field">
          <label htmlFor={`so-item-taxable-${item.key}`}>Taxable Amount</label>
          <input
            id={`so-item-taxable-${item.key}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={item.taxable_amount}
            onChange={field('taxable_amount')}
            placeholder="0.00"
          />
        </div>

        <div className="field so-check-field">
          <label>GST</label>
          <button
            type="button"
            className="so-check"
            onClick={() => onChange(index, 'is_taxable', !item.is_taxable)}
            aria-pressed={item.is_taxable}
          >
            <span className={`checkbox-button ${item.is_taxable ? 'checked' : ''}`}>
              {item.is_taxable ? <Icon name="check" size={13} /> : null}
            </span>
            Taxable
          </button>
        </div>

        <div className="field">
          <label htmlFor={`so-item-gst-type-${item.key}`}>GST Type</label>
          <select id={`so-item-gst-type-${item.key}`} value={item.gst_type} onChange={field('gst_type')} disabled={!item.is_taxable}>
            {GST_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`so-item-rate-${item.key}`}>GST Rate</label>
          <select id={`so-item-rate-${item.key}`} value={item.gst_rate} onChange={field('gst_rate')} disabled={!item.is_taxable}>
            {GST_RATES.map((rate) => <option key={rate} value={String(rate)}>{rate}%</option>)}
            <option value="custom">Custom</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor={`so-item-tax-${item.key}`}>Tax Amount</label>
          <input
            id={`so-item-tax-${item.key}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={item.tax_amount}
            onChange={field('tax_amount')}
            disabled={!item.is_taxable || item.gst_rate !== 'custom'}
            placeholder="0.00"
          />
        </div>
      </div>

      {item.expanded && (
        <div className="so-item-grid so-item-extra">
          <div className="field">
            <label htmlFor={`so-item-short-${item.key}`}>Short Name</label>
            <input id={`so-item-short-${item.key}`} value={item.short_name} onChange={field('short_name')} />
          </div>

          <div className="field">
            <label htmlFor={`so-item-label-${item.key}`}>Label</label>
            <input id={`so-item-label-${item.key}`} value={item.label} onChange={field('label')} />
          </div>

          <div className="field">
            <label htmlFor={`so-item-ref-${item.key}`}>Reference Type</label>
            <input id={`so-item-ref-${item.key}`} value={item.reference_type} onChange={field('reference_type')} />
          </div>

          <div className="field">
            <label htmlFor={`so-item-invoice-${item.key}`}>Invoice Number</label>
            <input id={`so-item-invoice-${item.key}`} value={item.invoice_number} onChange={field('invoice_number')} />
          </div>

          <div className="field">
            <label htmlFor={`so-item-courier-${item.key}`}>Document Courier</label>
            <input id={`so-item-courier-${item.key}`} value={item.document_courier} onChange={field('document_courier')} />
          </div>

          <div className="field">
            <label htmlFor={`so-item-courier-status-${item.key}`}>Courier Status</label>
            <select id={`so-item-courier-status-${item.key}`} value={item.courier_status} onChange={field('courier_status')}>
              <option value="">—</option>
              {SO_COURIER_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor={`so-item-color-${item.key}`}>Colour</label>
            <select id={`so-item-color-${item.key}`} value={item.document_color} onChange={field('document_color')}>
              {SO_COLOR_OPTIONS.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="field so-check-field">
            <label>Audit</label>
            <button
              type="button"
              className="so-check"
              onClick={() => onChange(index, 'self_audit_completed', !item.self_audit_completed)}
              aria-pressed={item.self_audit_completed}
            >
              <span className={`checkbox-button ${item.self_audit_completed ? 'checked' : ''}`}>
                {item.self_audit_completed ? <Icon name="check" size={13} /> : null}
              </span>
              Self audit done
            </button>
          </div>

          <div className="field field-wide">
            <label htmlFor={`so-item-file-${item.key}`}>Attachment URL</label>
            <input id={`so-item-file-${item.key}`} type="url" value={item.file_url} onChange={field('file_url')} placeholder="https://…" />
          </div>

          <div className="field field-wide">
            <label htmlFor={`so-item-note-${item.key}`}>Note</label>
            <textarea id={`so-item-note-${item.key}`} rows="2" value={item.document_note} onChange={field('document_note')} />
          </div>
        </div>
      )}

      <div className="so-item-foot">
        <span>Taxable <strong className="mono-cell">{formatMoney(amounts.taxable_amount)}</strong></span>
        <span>Tax <strong className="mono-cell">{formatMoney(amounts.tax_amount)}</strong></span>
        <span className="so-item-foot-gst">{breakdown || (item.is_taxable ? 'No GST yet' : 'Not taxable')}</span>
        <span className="so-item-foot-total">After tax <strong className="mono-cell">{formatMoney(amounts.after_tax_amount)}</strong></span>
      </div>
    </div>
  )
}

function SalesOrderFormModal({ order, session, facets, onClose, onSaved }) {
  const isEdit = Boolean(order?.id)

  const [form, setForm] = useState(() => (isEdit ? salesOrderToForm(order) : blankSalesOrderForm()))
  // Existing rows key off their database id, new ones off a counter, so the two
  // can never collide while a row is being added and removed.
  const keyRef = useRef(1)
  const [items, setItems] = useState(() => (isEdit ? [] : [blankSalesOrderItem('item-1')]))
  const [removedItemIds, setRemovedItemIds] = useState([])
  const [itemsLoading, setItemsLoading] = useState(isEdit)
  const [clients, setClients] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function nextKey() {
    keyRef.current += 1
    return `item-${keyRef.current}`
  }

  useEffect(() => {
    let cancelled = false
    async function loadClients() {
      const { data, error: fetchError } = await supabase
        .from('clients')
        .select('company_name,contact_person')
        .order('company_name', { ascending: true })
        .limit(1000)
      if (cancelled || fetchError) return
      setClients(data || [])
    }
    loadClients()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!isEdit) return undefined
    let cancelled = false

    async function loadItems() {
      setItemsLoading(true)
      const { data, error: fetchError } = await supabase
        .from(SALES_ORDER_ITEM_TABLE)
        .select('*')
        .eq('sales_order_id', order.id)
        .order('id', { ascending: true })
      if (cancelled) return

      if (fetchError) {
        setError(fetchError.message)
        setItems([blankSalesOrderItem(nextKey())])
      } else {
        const rows = (data || []).map((row) => salesOrderItemToForm(row, `existing-${row.id}`))
        setItems(rows.length > 0 ? rows : [blankSalesOrderItem(nextKey())])
      }
      setRemovedItemIds([])
      setItemsLoading(false)
    }

    loadItems()
    return () => { cancelled = true }
  }, [isEdit, order?.id])

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  // Picking a client fills both columns the parent stores: the company name and
  // that client's contact person. The contact stays editable afterwards, since
  // one client can have a different signatory per order.
  function selectClient(companyName) {
    const client = clients.find((row) => row.company_name === companyName)
    setForm((current) => ({
      ...current,
      company: companyName,
      order_client_fullname: client?.contact_person || current.order_client_fullname,
    }))
  }

  function changeItem(index, name, value) {
    setItems((current) => current.map((item, position) => (position === index ? applyItemChange(item, name, value) : item)))
  }

  function toggleItem(index) {
    setItems((current) => current.map((item, position) => (position === index ? { ...item, expanded: !item.expanded } : item)))
  }

  function addItem() {
    // The key is minted outside the updater: updaters run twice under StrictMode,
    // and bumping the counter in there would burn a key on every add.
    const blank = blankSalesOrderItem(nextKey())
    setItems((current) => [...current, blank])
  }

  function removeItem(index) {
    const removed = items[index]
    if (removed?.id) setRemovedItemIds((ids) => (ids.includes(removed.id) ? ids : [...ids, removed.id]))
    setItems((current) => current.filter((_, position) => position !== index))
  }

  const clientOptions = useMemo(() => {
    const names = clients.map((row) => row.company_name).filter(Boolean)
    // An order can name a company that is no longer in the client master; keep it
    // selectable so editing anything else does not silently rewrite the client.
    if (form.company && !names.includes(form.company)) names.unshift(form.company)
    return uniqueOptions(names.map(String))
  }, [clients, form.company])

  const orderTypeOptions = useMemo(() => uniqueOptions([...ORDER_TYPE_OPTIONS, ...(facets?.order_type || [])]), [facets])
  const orderStatusOptions = useMemo(() => uniqueOptions([...ORDER_STATUS_OPTIONS, ...(facets?.order_status || [])]), [facets])
  const purchaseStatusOptions = useMemo(() => uniqueOptions([...PURCHASE_STATUS_OPTIONS, ...(facets?.purchase_status || [])]), [facets])
  const itemTypeOptions = useMemo(() => uniqueOptions([...SO_ITEM_TYPE_OPTIONS, ...(facets?.item_type || [])]).map((option) => option.value), [facets])

  // The same function that guards the payload also produces the figures on
  // screen, so what the Summary shows is exactly what will be written — and a
  // disagreement between the two surfaces here instead of at submit time.
  const totals = useMemo(() => {
    try {
      return { ...reconcileSalesOrderTotals(items), error: '' }
    } catch (err) {
      return { sub_total: 0, tax_total: 0, total: 0, error: err.message }
    }
  }, [items])

  const campaignInvalid = Boolean(form.campaign_start_date && form.campaign_end_date && form.campaign_end_date < form.campaign_start_date)
  const duration = campaignInvalid ? null : campaignDays(form.campaign_start_date, form.campaign_end_date)
  const receiptBalance = form.payment_receipt_amount === '' ? null : round2(totals.total - toAmount(form.payment_receipt_amount))

  function validate() {
    if (!form.company.trim()) return 'Choose the client this order belongs to.'
    if (!form.order_number.trim()) return 'Enter an order number.'
    if (campaignInvalid) return 'The campaign end date must be on or after the campaign start date.'
    if (items.length === 0) return 'Add at least one order item.'
    const unnamed = items.findIndex((item) => !item.name.trim())
    if (unnamed >= 0) return `Item ${unnamed + 1} needs a name.`
    return ''
  }

  // Existing rows are updated, new rows inserted and removed rows deleted, rather
  // than clearing and re-inserting the lot: child ids are referenced elsewhere
  // (purchase_order_id, inv_id) and re-creating them would break those links.
  async function saveItems(salesOrderId) {
    if (removedItemIds.length > 0) {
      const { error: deleteError } = await supabase.from(SALES_ORDER_ITEM_TABLE).delete().in('id', removedItemIds)
      if (deleteError) throw deleteError
    }

    const stamp = new Date().toISOString()
    const existing = []
    const fresh = []
    items.forEach((item) => {
      const payload = buildSalesOrderItemPayload(item, salesOrderId)
      if (item.id) existing.push({ ...payload, id: item.id, updated_at: stamp })
      else fresh.push(payload)
    })

    if (existing.length > 0) {
      await writeRows(async (rows) => {
        for (const row of rows) {
          const { id, ...values } = row
          const { error: updateError } = await supabase.from(SALES_ORDER_ITEM_TABLE).update(values).eq('id', id)
          if (updateError) return { data: null, error: updateError }
        }
        return { data: rows, error: null }
      }, existing, SALES_ORDER_ITEM_FALLBACKS)
    }

    if (fresh.length > 0) {
      await writeRows(
        (rows) => supabase.from(SALES_ORDER_ITEM_TABLE).insert(rows).select('id'),
        fresh,
        SALES_ORDER_ITEM_FALLBACKS,
      )
    }
  }

  // `created_by_id` could be a uuid or an integer column and there is no way to
  // check from the browser, so it is stamped on its own after the order is safely
  // saved. A rejection here costs the provenance, not the order.
  async function stampCreator(salesOrderId) {
    const userId = session?.user?.id
    if (!userId) return
    const { error: stampError } = await supabase.from(SALES_ORDER_TABLE).update({ created_by_id: userId }).eq('id', salesOrderId)
    if (stampError) console.warn(`Sales order ${salesOrderId} saved, but created_by_id could not be set: ${stampError.message}`)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }

    let payloadTotals
    try {
      payloadTotals = reconcileSalesOrderTotals(items)
    } catch (err) {
      setError(err.message)
      return
    }

    setSaving(true)
    setError('')

    try {
      const payload = buildSalesOrderPayload(form, payloadTotals, session)

      if (isEdit) {
        delete payload.created_by
        payload.updated_at = new Date().toISOString()
        const saved = await writeRows(
          (rows) => supabase.from(SALES_ORDER_TABLE).update(rows[0]).eq('id', order.id).select('*').single(),
          [payload],
          SALES_ORDER_FALLBACKS,
        )
        // The parent is already committed at this point, so a failure below
        // leaves the order saved and its items partly applied. The error says so
        // and the form stays open on the same data, ready to be resubmitted.
        await saveItems(order.id)
        onSaved(saved || { ...order, ...payload })
      } else {
        const saved = await writeRows(
          (rows) => supabase.from(SALES_ORDER_TABLE).insert(rows).select('*').single(),
          [payload],
          SALES_ORDER_FALLBACKS,
        )
        if (!saved?.id) throw new Error('The sales order was created but no ID came back, so its items could not be linked to it.')

        try {
          await saveItems(saved.id)
        } catch (err) {
          // Nothing references the new order yet, so removing it is safer than
          // leaving an order behind with only some of its items.
          await supabase.from(SALES_ORDER_TABLE).delete().eq('id', saved.id)
          throw err
        }

        await stampCreator(saved.id)
        onSaved(saved)
      }
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Could not save the sales order.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card so-modal-card" onMouseDown={(event) => event.stopPropagation()}>

        <div className="modal-header">
          <div>
            <span className="drawer-kicker">SALES ORDER</span>
            <h2>{isEdit ? `Edit ${order.order_number || `order #${order.id}`}` : 'Add sales order'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={19} />
          </button>
        </div>

        {error && (
          <div className="form-error" role="alert">
            <Icon name="alert" size={17} />
            <div><strong>Could not save sales order</strong><span>{error}</span></div>
          </div>
        )}

        <form className="vendor-form so-form" onSubmit={handleSubmit}>

          {/* ── Order Info ──────────────────────────────────────────── */}
          <div className="form-section-title field-wide">Order Info</div>

          <div className="field">
            <label htmlFor="so-order-number">Order Number *</label>
            <input id="so-order-number" value={form.order_number} onChange={(event) => update('order_number', event.target.value)} required />
          </div>

          <div className="field">
            <label htmlFor="so-crm">CRM Reference ID</label>
            <input id="so-crm" value={form.crm_reference_id} onChange={(event) => update('crm_reference_id', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-unique">Unique ID</label>
            <input id="so-unique" value={form.unique_id} onChange={(event) => update('unique_id', event.target.value)} placeholder="Auto if left blank" />
          </div>

          <SearchableSelect
            label="Client"
            required
            value={form.company}
            onChange={selectClient}
            options={clientOptions}
            placeholder={clientOptions.length === 0 ? 'Loading clients…' : 'Select a client'}
            searchPlaceholder="Search clients..."
          />

          <div className="field">
            <label htmlFor="so-client-contact">Client Contact Person</label>
            <input id="so-client-contact" value={form.order_client_fullname} onChange={(event) => update('order_client_fullname', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-order-type">Order Type</label>
            <select id="so-order-type" value={form.order_type} onChange={(event) => update('order_type', event.target.value)}>
              <option value="">—</option>
              {orderTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="so-order-date">Order Date</label>
            <input id="so-order-date" type="date" value={form.order_date} onChange={(event) => update('order_date', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-invoice-date">Invoice Date</label>
            <input id="so-invoice-date" type="date" value={form.invoice_date} onChange={(event) => update('invoice_date', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-order-color">Row Colour</label>
            <select id="so-order-color" value={form.order_color} onChange={(event) => update('order_color', event.target.value)}>
              {SO_COLOR_OPTIONS.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="so-order-status">Order Status</label>
            <select id="so-order-status" value={form.order_status} onChange={(event) => update('order_status', event.target.value)}>
              <option value="">—</option>
              {orderStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="so-purchase-status">Purchase Status</label>
            <select id="so-purchase-status" value={form.purchase_status} onChange={(event) => update('purchase_status', event.target.value)}>
              <option value="">—</option>
              {purchaseStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="field so-check-field">
            <label>Scope</label>
            <button
              type="button"
              className="so-check"
              onClick={() => update('multi_purpose_so', !form.multi_purpose_so)}
              aria-pressed={form.multi_purpose_so}
            >
              <span className={`checkbox-button ${form.multi_purpose_so ? 'checked' : ''}`}>
                {form.multi_purpose_so ? <Icon name="check" size={13} /> : null}
              </span>
              Multi purpose SO
            </button>
          </div>

          <div className="field">
            <label htmlFor="so-approved-by">Approved By</label>
            <input id="so-approved-by" value={form.approved_by} onChange={(event) => update('approved_by', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-approved-date">Approved Date</label>
            <input id="so-approved-date" type="date" value={form.approved_date} onChange={(event) => update('approved_date', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-complete-date">Completed Date</label>
            <input id="so-complete-date" type="date" value={form.complete_date} onChange={(event) => update('complete_date', event.target.value)} />
          </div>

          {/* ── Campaign ────────────────────────────────────────────── */}
          <div className="form-section-title field-wide">Campaign</div>

          <div className="field">
            <label htmlFor="so-campaign-start">Campaign Start Date</label>
            <input id="so-campaign-start" type="date" value={form.campaign_start_date} onChange={(event) => update('campaign_start_date', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-campaign-end">Campaign End Date</label>
            <input
              id="so-campaign-end"
              type="date"
              value={form.campaign_end_date}
              min={form.campaign_start_date || undefined}
              onChange={(event) => update('campaign_end_date', event.target.value)}
              aria-invalid={campaignInvalid}
            />
          </div>

          <div className="field">
            <label>Duration</label>
            <div className={`so-readout ${campaignInvalid ? 'is-invalid' : ''}`}>
              {campaignInvalid
                ? 'End date is before the start date'
                : duration
                  ? `${duration} ${duration === 1 ? 'day' : 'days'}`
                  : 'Set both dates'}
            </div>
          </div>

          {/* ── Media / Brand ───────────────────────────────────────── */}
          <div className="form-section-title field-wide">Media / Brand</div>

          <div className="field">
            <label htmlFor="so-brand">Brand Name</label>
            <input id="so-brand" value={form.brand_name} onChange={(event) => update('brand_name', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-invoice-courier">Invoice Courier</label>
            <input id="so-invoice-courier" value={form.invoice_courier} onChange={(event) => update('invoice_courier', event.target.value)} />
          </div>

          {/* ── Order Items ─────────────────────────────────────────── */}
          <div className="form-section-title field-wide">
            Order Items
            <span className="so-item-count">{items.length}</span>
          </div>

          <div className="so-items field-wide">
            {itemsLoading ? (
              <div className="so-detail-items-state">Loading items…</div>
            ) : (
              items.map((item, index) => (
                <SalesOrderItemEditor
                  key={item.key}
                  item={item}
                  index={index}
                  onChange={changeItem}
                  onRemove={removeItem}
                  onToggle={toggleItem}
                  canRemove={items.length > 1}
                  typeOptions={itemTypeOptions}
                />
              ))
            )}

            <button type="button" className="secondary-button so-add-item" onClick={addItem}>
              <Icon name="plus" size={16} /> Add item
            </button>
          </div>

          {/* ── Summary ─────────────────────────────────────────────── */}
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

            {totals.error
              ? <div className="so-summary-note is-error">{totals.error}</div>
              : <div className="so-summary-note">These three figures are written to the order exactly as shown, recalculated from the {items.length} {items.length === 1 ? 'item' : 'items'} above.</div>}
          </div>

          <div className="field">
            <label htmlFor="so-receipt">Payment Receipt Amount</label>
            <input
              id="so-receipt"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={form.payment_receipt_amount}
              onChange={(event) => update('payment_receipt_amount', event.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="field">
            <label>Balance</label>
            <div className="so-readout">{receiptBalance == null ? 'No payment recorded' : formatMoney(receiptBalance)}</div>
          </div>

          <div className="form-actions field-wide">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving || itemsLoading}>
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Sales Order'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}

export default function SalesOrdersPage({ session }) {
  // ── Search: `searchInput` drives the UI, `query` drives the request ──────
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')

  const [orders, setOrders] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(SO_PAGE_SIZES[0])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  // Bumping `refresh` re-runs the loader when nothing else changed — a fresh
  // object every time so React cannot bail out of an identical update.
  const [refresh, setRefresh] = useState({ key: 0, silent: false })

  const [selectedOrder, setSelectedOrder] = useState(null)
  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingOrder, setEditingOrder] = useState(null)
  const [facets, setFacets] = useState(null)

  // Held in a ref rather than state: narrowing it happens *inside* the loader,
  // which retries immediately, so re-running the effect would only refetch what
  // the retry already has.
  const searchColumnsRef = useRef(SO_SEARCH_COLUMNS)

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchInput.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  /* ── Values already in the table ──────────────────────────────────────── */

  // `order_status`, `purchase_status` and the item `type` are open text columns,
  // so the form offers whatever this database already uses alongside this
  // module's own defaults instead of silently narrowing existing data to them.
  useEffect(() => {
    let cancelled = false

    async function loadFacets() {
      const [orderResult, itemResult] = await Promise.all([
        supabase.from(SALES_ORDER_TABLE).select('order_type,order_status,purchase_status').is('vendor_address_id', null).limit(1000),
        supabase.from(SALES_ORDER_ITEM_TABLE).select('type').limit(1000),
      ])
      if (cancelled) return

      const distinct = (rows, key) => [...new Set((rows || []).map((row) => row[key]).filter(Boolean).map(String))]
      setFacets({
        order_type: distinct(orderResult.data, 'order_type'),
        order_status: distinct(orderResult.data, 'order_status'),
        purchase_status: distinct(orderResult.data, 'purchase_status'),
        item_type: distinct(itemResult.data, 'type'),
      })
    }

    loadFacets()
    return () => { cancelled = true }
  }, [refresh.key])

  /* ── Sales order list ─────────────────────────────────────────────────── */

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
          .from(SALES_ORDER_TABLE)
          .select('*', { count: 'exact' })
          .is('vendor_address_id', null)   // exclude Purchase Orders (they have vendor_address_id set)
          .order('id', { ascending: false })
          .range(from, from + pageSize - 1)
        return soSearchFilter(request, query, columns)
      }

      let result = await runQuery(searchColumnsRef.current)

      // `ilike` only applies to text columns. `company` is the one confirmed to
      // be text, so a rejected wider filter narrows to it for the rest of the
      // session rather than leaving search broken.
      if (result.error && query && isIlikeTypeError(result.error) && searchColumnsRef.current.length > 1) {
        searchColumnsRef.current = SO_SEARCH_FALLBACK_COLUMNS
        result = await runQuery(SO_SEARCH_FALLBACK_COLUMNS)
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

  /* ── Child items for the open order ───────────────────────────────────── */

  useEffect(() => {
    const orderId = selectedOrder?.id
    if (!orderId) {
      setItems([])
      setItemsError('')
      return undefined
    }

    let cancelled = false

    async function loadItems() {
      setItemsLoading(true)
      setItemsError('')

      const { data, error: fetchError } = await supabase
        .from(SALES_ORDER_ITEM_TABLE)
        .select('*')
        .eq('sales_order_id', orderId)
        .order('id', { ascending: true })
      if (cancelled) return

      if (fetchError) {
        setItems([])
        setItemsError(fetchError.message)
      } else {
        setItems(data || [])
      }
      setItemsLoading(false)
    }

    loadItems()
    return () => { cancelled = true }
  }, [selectedOrder?.id, refresh.key])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalCount)

  const pageNumbers = useMemo(() => {
    const current = Math.min(page, totalPages)
    return [current - 2, current - 1, current, current + 1, current + 2]
      .filter((number) => number >= 1 && number <= totalPages)
  }, [page, totalPages])

  function changePage(nextPage) {
    setPage(Math.max(1, Math.min(nextPage, totalPages)))
  }

  function changePageSize(event) {
    setPageSize(Number(event.target.value))
    setPage(1)
  }

  function openAddForm() {
    setEditingOrder(null)
    setShowForm(true)
  }

  function openEditForm(order) {
    setEditingOrder(order)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingOrder(null)
  }

  // The saved row goes straight into the list so the change is visible without a
  // round trip, then a silent reload reconciles it with whatever the database
  // actually stored.
  function afterSaved(saved) {
    const wasEdit = Boolean(editingOrder?.id)
    closeForm()

    if (saved?.id) {
      setOrders((current) => (current.some((row) => row.id === saved.id)
        ? current.map((row) => (row.id === saved.id ? { ...row, ...saved } : row))
        : [saved, ...current].slice(0, pageSize)))
      setSelectedOrder((current) => (current?.id === saved.id ? { ...current, ...saved } : current))
      if (!wasEdit) setTotalCount((current) => current + 1)
    }

    setRefresh((current) => ({ key: current.key + 1, silent: Boolean(saved?.id) }))
  }

  const searchNarrowed = searchColumnsRef.current.length < SO_SEARCH_COLUMNS.length

  const emptyCopy = query
    ? 'No sales orders match this search. Try an order number, client or CRM reference.'
    : 'Add your first sales order to see it listed here.'

  // ── Tax Invoice Download ─────────────────────────────────────────────
  const TEMPLATE_PATH = '/Temps/SO_template.pdf'

  async function handleTIDownload(order) {
    try {
      await generateTaxInvoice(TEMPLATE_PATH, order)
    } catch (err) {
      console.error('[TI Download]', err)
      alert(`Could not generate Tax Invoice: ${err.message}`)
    }
  }

  return (
    <div className={`so-page ${selectedOrder ? 'has-selection' : ''}`}>
      <div className="so-main-content">
        <div className="page-header">
          <div>
            <span className="page-kicker">TRANSACTIONS</span>
            <h1>Sales Orders</h1>
            <p>{totalCount.toLocaleString()} {totalCount === 1 ? 'order' : 'orders'} in view · {pageSize} per page</p>
          </div>
          <button className="primary-button add-button" onClick={openAddForm}>
            <Icon name="plus" size={18} /> Add sales order
          </button>
        </div>

        {/* ── Search ───────────────────────────────────────────────────── */}
        <div className="vendors-toolbar">
          <div className="vendor-search">
            <span className="vendor-search-icon"><Icon name="search" size={17} /></span>
            <input
              className="vendor-search-input"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={searchNarrowed ? 'Search client company…' : 'Search order number, client or CRM reference…'}
              aria-label="Search sales orders"
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
              <strong>Could not load sales orders</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────────── */}
        <section className="table-card">
          <div className="table-topline">
            <div>
              <strong>All Sales Orders</strong>
              <span className="result-count">{totalCount.toLocaleString()} records</span>
              {refreshing && <span className="result-count">Updating…</span>}
              {query && <span className="search-state">Filtered by “{query}”</span>}
              {searchNarrowed && <span className="search-state">Searching client company only</span>}
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th className="so-total-column">Total</th>
                  <th className="actions-column">Actions</th>
                  <th className="download-column">Download</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: Math.min(pageSize, 10) }).map((_, index) => (
                    <tr key={`so-skeleton-${index}`}>
                      {Array.from({ length: SO_COLUMN_COUNT }).map((__, cell) => <td key={cell}><span className="skeleton skeleton-company" /></td>)}
                    </tr>
                  ))
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={SO_COLUMN_COUNT} className="empty-state">
                      <div className="empty-title">No sales orders found</div>
                      <div className="empty-copy">{emptyCopy}</div>
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => {
                    const duration = campaignDays(order.campaign_start_date, order.campaign_end_date)
                    const campaign = order.campaign_start_date || order.campaign_end_date
                      ? `${formatDate(order.campaign_start_date)} → ${formatDate(order.campaign_end_date)}`
                      : null

                    return (
                      <tr
                        key={order.id}
                        className={selectedOrder?.id === order.id ? 'is-open' : ''}
                        onDoubleClick={() => setSelectedOrder(order)}
                      >
                        <td>
                          <span className="cell-primary so-order-cell">
                            {order.order_color && <span className="so-color-dot" style={{ background: order.order_color }} aria-hidden="true" />}
                            {formatValue(order.order_number)}
                          </span>
                          <span className="cell-secondary" title={order.crm_reference_id || ''}>{formatValue(getValue(order, ['crm_reference_id', 'unique_id']))}</span>
                        </td>
                        <td>
                          <span className="cell-primary company-cell" title={order.company || ''}>{formatValue(order.company)}</span>
                          <span className="cell-secondary" title={order.order_client_fullname || ''}>{formatValue(order.order_client_fullname)}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatValue(order.order_type)}</span>
                          <span className="cell-secondary" title={order.brand_name || ''}>{formatValue(order.brand_name)}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatValue(campaign)}</span>
                          <span className="cell-secondary">{duration ? `${duration} ${duration === 1 ? 'day' : 'days'}` : '—'}</span>
                        </td>
                        <td>
                          <span className={`status-pill ${statusTone(order.order_status)}`}>
                            <span className="status-dot" />
                            {formatValue(order.order_status)}
                          </span>
                          <span className="cell-secondary">{formatValue(order.purchase_status)}</span>
                        </td>
                        <td className="so-total-column">
                          <span className="cell-primary mono-cell">{formatMoney(order.total)}</span>
                          <span className="cell-secondary mono-cell">Tax {formatMoney(order.tax_total)}</span>
                        </td>
                        <td className="actions-column">
                          <button className="row-action" onClick={() => setSelectedOrder(order)} aria-label={`Open sales order ${order.order_number || order.id}`}>
                            <Icon name="chevron" size={17} />
                          </button>
                        </td>
                        <td className="download-column">
                          <button
                            className="download-btn"
                            onClick={(e) => { e.stopPropagation(); handleTIDownload(order); }}
                            aria-label={`Download Tax Invoice for ${order.order_number || order.id}`}
                            title="Download Tax Invoice"
                          >
                            TI
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar">
            <div className="page-size-control">
              <span>Items per page</span>
              <select value={pageSize} onChange={changePageSize} aria-label="Sales orders per page">
                {SO_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </div>

            <div className="pagination-meta">
              <span className="pagination-page-label">
                {totalCount === 0 ? 'No records' : <>Showing <strong>{pageStart}–{pageEnd}</strong> of {totalCount.toLocaleString()}</>}
              </span>
              <div className="pagination-buttons">
                <button onClick={() => changePage(1)} disabled={page <= 1} aria-label="First page"><Icon name="first" size={16} /></button>
                <button onClick={() => changePage(page - 1)} disabled={page <= 1} aria-label="Previous page"><Icon name="chevron" size={16} /></button>
                {pageNumbers.map((number) => <button key={number} className={number === page ? 'current' : ''} onClick={() => changePage(number)} aria-current={number === page ? 'page' : undefined}>{number}</button>)}
                <button onClick={() => changePage(page + 1)} disabled={page >= totalPages} aria-label="Next page"><Icon name="chevron" size={16} /></button>
                <button onClick={() => changePage(totalPages)} disabled={page >= totalPages} aria-label="Last page"><Icon name="last" size={16} /></button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {selectedOrder && (
        <aside className="so-side-panel">
          <SalesOrderDetails
            order={selectedOrder}
            items={items}
            itemsLoading={itemsLoading}
            itemsError={itemsError}
            onClose={() => setSelectedOrder(null)}
            onEdit={() => openEditForm(selectedOrder)}
          />
        </aside>
      )}

      {showForm && (
        <SalesOrderFormModal
          order={editingOrder}
          session={session}
          facets={facets}
          onClose={closeForm}
          onSaved={afterSaved}
        />
      )}
    </div>
  )
}
