import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatDisplayDate, formatDateRange, formatRupees } from '../../lib/format'
import { round2, toAmount } from '../../lib/money'
import { campaignDays } from '../../lib/dates'
import {
  ORDER_TYPE_OPTIONS, ORDER_STATUS_OPTIONS, PURCHASE_STATUS_OPTIONS,
  GST_TYPE_OPTIONS, GST_RATES, SO_ITEM_TYPE_OPTIONS, SO_COURIER_STATUS_OPTIONS,
  itemAmounts, reconcileSalesOrderTotals, applyItemChange, gstBreakdown,
} from '../../lib/gst'
import { statusTone, isIlikeTypeError } from '../../lib/status'
import { writeRows } from '../../lib/writeRows'
import { Icon } from '../../components/Icon'
import { SearchableSelect } from '../../components/SearchableSelect'
import {
  PageHeader, SearchField, ResultCount, Pagination, StatusPill, Cell, RowChevron, SkeletonRows, EmptyState, Toast,
  FormModal, FormSection, Field, CheckToggle, Disclosure,
} from '../../components/crm/CrmUi'
import SalesOrderDetails from './SalesOrderDetails'
import { useAccess } from '../../lib/access'
import { getSettings, listOptions, listValues, preferredPageSize, useSettings } from '../../lib/settings'
import {
  SO_COLOR_OPTIONS, blankSalesOrderForm, salesOrderToForm,
  blankSalesOrderItem, salesOrderItemToForm,
  buildSalesOrderPayload, buildSalesOrderItemPayload,
  SALES_ORDER_FALLBACKS, SALES_ORDER_ITEM_FALLBACKS,
  SO_SEARCH_COLUMNS, SO_SEARCH_FALLBACK_COLUMNS, soSearchFilter,
} from './salesOrderHelpers'

const SO_PAGE_SIZES = [25, 50, 75, 100]

// Define constants that were in App.jsx scope
const SALES_ORDER_TABLE = 'salesorder'
const SALES_ORDER_ITEM_TABLE = 'salesorderdocument'
const SO_COLUMN_COUNT = 7

function uniqueOptions(options) {
  return [...new Set(options)].map((opt) => (typeof opt === 'string' ? { label: opt, value: opt } : opt))
}

// Settings > Lists decides what a dropdown offers. Until that migration is
// applied, fall back to the built-in values plus whatever the data already uses.
function choiceValues(listKey, fallback, facetValues, current) {
  if (getSettings().lists.some((row) => row.list_key === listKey)) return listValues(listKey, fallback, current)
  return [...new Set([...fallback, ...(facetValues || []), ...(current ? [current] : [])])]
}

const colourChoices = (current) => [{ value: '', label: 'None' }, ...listOptions('row_color', SO_COLOR_OPTIONS.filter((option) => option.value), current)]

// A new order and a new line start on the first value each list offers.
function newOrderForm() {
  const form = blankSalesOrderForm()
  return {
    ...form,
    order_type: listValues('order_type', ORDER_TYPE_OPTIONS)[0] ?? form.order_type,
    order_status: listValues('order_status', ORDER_STATUS_OPTIONS)[0] ?? form.order_status,
    purchase_status: listValues('purchase_status', PURCHASE_STATUS_OPTIONS)[0] ?? form.purchase_status,
  }
}

function newOrderItem(key) {
  const item = blankSalesOrderItem(key)
  return { ...item, type: listValues('item_type', SO_ITEM_TYPE_OPTIONS)[0] ?? item.type }
}

function SalesOrderItemEditor({ item, index, onChange, onRemove, onToggle, canRemove, typeOptions }) {
  const amounts = itemAmounts(item)
  const field = (name) => ({ value: item[name], onChange: (event) => onChange(index, name, event.target.value) })
  const id = (name) => `so-item-${name}-${item.key}`
  const breakdown = gstBreakdown(amounts)

  return (
    <div className="crm-item">
      <div className="crm-item-head">
        <span className="crm-item-index">{index + 1}</span>
        {item.document_color && <span className="crm-swatch" style={{ background: item.document_color }} aria-hidden="true" />}
        <span className={`crm-item-title${item.name.trim() ? '' : ' is-placeholder'}`} title={item.name}>{item.name.trim() || 'New item'}</span>
        <span className="crm-item-total">{formatRupees(amounts.after_tax_amount)}</span>
        <button
          type="button"
          className="crm-icon-btn"
          onClick={() => onRemove(index)}
          disabled={!canRemove}
          title={canRemove ? 'Remove item' : 'An order needs at least one item'}
          aria-label={`Remove item ${index + 1}`}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>

      <div className="crm-item-body">
        <div className="crm-grid crm-grid--4">
          <Field label="Item" htmlFor={id('name')} required className="crm-span-2">
            <input id={id('name')} className="crm-input" {...field('name')} />
          </Field>
          <Field label="Type" htmlFor={id('type')}>
            <select id={id('type')} className="crm-select" {...field('type')}>
              <option value="">Not set</option>
              {(item.type && !typeOptions.includes(item.type) ? [...typeOptions, item.type] : typeOptions).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
          <Field label="Amount before tax" htmlFor={id('taxable')}>
            <div className="crm-input-group">
              <span className="crm-addon">₹</span>
              <input id={id('taxable')} type="number" step="0.01" min="0" inputMode="decimal" className="crm-input crm-mono-input" {...field('taxable_amount')} />
            </div>
          </Field>
          <Field label="GST">
            <CheckToggle checked={item.is_taxable} onChange={(value) => onChange(index, 'is_taxable', value)}>Charge GST</CheckToggle>
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

        <Disclosure open={item.expanded} onToggle={() => onToggle(index)} count="10 fields">
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
            <Field label="Label" htmlFor={id('label')}>
              <input id={id('label')} className="crm-input" {...field('label')} />
            </Field>
            <Field label="Reference type" htmlFor={id('ref')}>
              <input id={id('ref')} className="crm-input" {...field('reference_type')} />
            </Field>
            <Field label="Document courier" htmlFor={id('courier')}>
              <input id={id('courier')} className="crm-input" {...field('document_courier')} />
            </Field>
            <Field label="Courier status" htmlFor={id('courier-status')}>
              <select id={id('courier-status')} className="crm-select" {...field('courier_status')}>
                <option value="">Not set</option>
                {listValues('courier_status', SO_COURIER_STATUS_OPTIONS, item.courier_status).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Field>
            <Field label="Colour" htmlFor={id('color')}>
              <select id={id('color')} className="crm-select" {...field('document_color')}>
                {colourChoices(item.document_color).map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Attachment link" htmlFor={id('file')} className="crm-span-2">
              <input id={id('file')} type="url" className="crm-input" {...field('file_url')} />
            </Field>
            <Field label="Audit" className="crm-span-2">
              <CheckToggle checked={item.self_audit_completed} onChange={(value) => onChange(index, 'self_audit_completed', value)}>Self audit done</CheckToggle>
            </Field>
            <Field label="Note" htmlFor={id('note')} className="crm-span-all">
              <textarea id={id('note')} rows={2} className="crm-textarea" {...field('document_note')} />
            </Field>
          </div>
        </Disclosure>
      </div>

      <div className="crm-item-foot">
        <span>Before tax <strong>{formatRupees(amounts.taxable_amount)}</strong></span>
        <span>Tax <strong>{formatRupees(amounts.tax_amount)}</strong></span>
        <span>{breakdown || (item.is_taxable ? 'No GST yet' : 'No GST')}</span>
        <span className="is-end">Total <strong>{formatRupees(amounts.after_tax_amount)}</strong></span>
      </div>
    </div>
  )
}

function SalesOrderFormModal({ order, initial, session, facets, onClose, onSaved }) {
  const isEdit = Boolean(order?.id)

  useSettings()
  const [form, setForm] = useState(() => (isEdit ? salesOrderToForm(order) : { ...newOrderForm(), ...initial }))
  // Existing rows key off their database id, new ones off a counter, so the two
  // can never collide while a row is being added and removed.
  const keyRef = useRef(1)
  const [items, setItems] = useState(() => (isEdit ? [] : [newOrderItem('item-1')]))
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
        setItems([newOrderItem(nextKey())])
      } else {
        const rows = (data || []).map((row) => salesOrderItemToForm(row, `existing-${row.id}`))
        setItems(rows.length > 0 ? rows : [newOrderItem(nextKey())])
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
    const blank = newOrderItem(nextKey())
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

  const orderTypeOptions = uniqueOptions(choiceValues('order_type', ORDER_TYPE_OPTIONS, facets?.order_type, form.order_type))
  const orderStatusOptions = uniqueOptions(choiceValues('order_status', ORDER_STATUS_OPTIONS, facets?.order_status, form.order_status))
  const purchaseStatusOptions = uniqueOptions(choiceValues('purchase_status', PURCHASE_STATUS_OPTIONS, facets?.purchase_status, form.purchase_status))
  const itemTypeOptions = choiceValues('item_type', SO_ITEM_TYPE_OPTIONS, facets?.item_type)

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

  const field = (name) => ({ value: form[name], onChange: (event) => update(name, event.target.value) })
  const moreFilled = [form.crm_reference_id, form.unique_id, form.order_client_fullname, form.invoice_date, form.purchase_status,
    form.approved_by, form.approved_date, form.complete_date, form.order_color, form.invoice_courier, form.multi_purpose_so].filter(Boolean).length

  return (
    <FormModal
      wide
      title={isEdit ? `Edit ${order.order_number || `order #${order.id}`}` : 'New sales order'}
      subtitle={isEdit ? order.company : 'Pick the client, add what is being sold, and save. Totals work themselves out.'}
      onClose={onClose}
      onSubmit={handleSubmit}
      busy={saving}
      submitDisabled={itemsLoading}
      error={error}
      errorTitle="Could not save the sales order"
      submitLabel={isEdit ? 'Save changes' : 'Create order'}
      footerInfo={<>Total <strong>{formatRupees(totals.total)}</strong></>}
    >
      <FormSection title="Order">
        <div className="crm-grid crm-grid--3">
          <div className="crm-span-2">
            <SearchableSelect
              label="Client"
              required
              value={form.company}
              onChange={selectClient}
              options={clientOptions}
              placeholder={clientOptions.length === 0 ? 'Loading clients…' : 'Choose a client'}
              searchPlaceholder="Search clients…"
            />
          </div>
          <Field label="Order number" htmlFor="so-order-number" required>
            <input id="so-order-number" className="crm-input crm-mono-input" {...field('order_number')} />
          </Field>
          <Field label="Order date" htmlFor="so-order-date">
            <input id="so-order-date" type="date" className="crm-input" {...field('order_date')} />
          </Field>
          <Field label="Order type" htmlFor="so-order-type">
            <select id="so-order-type" className="crm-select" {...field('order_type')}>
              <option value="">Not set</option>
              {orderTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Status" htmlFor="so-order-status">
            <select id="so-order-status" className="crm-select" {...field('order_status')}>
              <option value="">Not set</option>
              {orderStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Campaign">
        <div className="crm-grid crm-grid--4">
          <Field label="Brand" htmlFor="so-brand">
            <input id="so-brand" className="crm-input" {...field('brand_name')} />
          </Field>
          <Field label="Starts" htmlFor="so-campaign-start">
            <input id="so-campaign-start" type="date" className="crm-input" {...field('campaign_start_date')} />
          </Field>
          <Field label="Ends" htmlFor="so-campaign-end">
            <input id="so-campaign-end" type="date" className="crm-input" {...field('campaign_end_date')}
              min={form.campaign_start_date || undefined} aria-invalid={campaignInvalid} />
          </Field>
          <Field label="Duration">
            <div className={`crm-readout${campaignInvalid ? ' is-invalid' : ''}`}>
              {campaignInvalid ? 'Ends before it starts' : duration ? `${duration} ${duration === 1 ? 'day' : 'days'}` : 'Set both dates'}
            </div>
          </Field>
        </div>
      </FormSection>

      <FormSection title={`Items (${items.length})`} description="Each line's GST is worked out from its rate. Open “More details” on a line for courier, audit and attachments.">
        <div className="crm-items">
          {itemsLoading ? (
            <p className="crm-section-note">Loading items…</p>
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
        {totals.error && <div className="crm-note crm-note--danger" role="alert" style={{ marginBottom: 14 }}>{totals.error}</div>}
        <div className="crm-grid crm-grid--3">
          <Field label="Payment received" htmlFor="so-receipt">
            <div className="crm-input-group">
              <span className="crm-addon">₹</span>
              <input id="so-receipt" type="number" step="0.01" min="0" inputMode="decimal" className="crm-input crm-mono-input" {...field('payment_receipt_amount')} />
            </div>
          </Field>
          <Field label="Balance due">
            <div className="crm-readout">{receiptBalance == null ? 'No payment yet' : formatRupees(receiptBalance)}</div>
          </Field>
        </div>
      </FormSection>

      <FormSection title="More details" description="References, approvals and other fields most orders leave empty.">
        <Disclosure label="Show all fields" count={moreFilled ? `${moreFilled} filled` : '11 fields'} defaultOpen={false}>
          <div className="crm-grid crm-grid--3">
            <Field label="CRM reference" htmlFor="so-crm">
              <input id="so-crm" className="crm-input crm-mono-input" {...field('crm_reference_id')} />
            </Field>
            <Field label="Unique ID" htmlFor="so-unique" hint="Made for you if left empty.">
              <input id="so-unique" className="crm-input crm-mono-input" {...field('unique_id')} />
            </Field>
            <Field label="Client contact" htmlFor="so-client-contact" hint="Filled in from the client; change it for this order if needed.">
              <input id="so-client-contact" className="crm-input" {...field('order_client_fullname')} />
            </Field>
            <Field label="Invoice date" htmlFor="so-invoice-date">
              <input id="so-invoice-date" type="date" className="crm-input" {...field('invoice_date')} />
            </Field>
            <Field label="Purchase status" htmlFor="so-purchase-status">
              <select id="so-purchase-status" className="crm-select" {...field('purchase_status')}>
                <option value="">Not set</option>
                {purchaseStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Invoice courier" htmlFor="so-invoice-courier">
              <input id="so-invoice-courier" className="crm-input" {...field('invoice_courier')} />
            </Field>
            <Field label="Approved by" htmlFor="so-approved-by">
              <input id="so-approved-by" className="crm-input" {...field('approved_by')} />
            </Field>
            <Field label="Approved on" htmlFor="so-approved-date">
              <input id="so-approved-date" type="date" className="crm-input" {...field('approved_date')} />
            </Field>
            <Field label="Completed on" htmlFor="so-complete-date">
              <input id="so-complete-date" type="date" className="crm-input" {...field('complete_date')} />
            </Field>
            <Field label="Row colour" htmlFor="so-order-color" hint="Marks the order in the list.">
              <select id="so-order-color" className="crm-select" {...field('order_color')}>
                {colourChoices(form.order_color).map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Scope" className="crm-span-2">
              <CheckToggle checked={form.multi_purpose_so} onChange={(value) => update('multi_purpose_so', value)}>Multi-purpose sales order</CheckToggle>
            </Field>
          </div>
        </Disclosure>
      </FormSection>
    </FormModal>
  )
}

export default function SalesOrdersPage({ session }) {
  // 'own' edit scope covers only orders this person created; the database
  // enforces the same rule (RLS on public.salesorder).
  const { can, scope } = useAccess()
  const canEditOrder = (order) => scope('sales_orders.edit') === 'all'
    || (scope('sales_orders.edit') === 'own' && order?.created_by_id === session?.user?.id)
  // ── Search: `searchInput` drives the UI, `query` drives the request ──────
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  // '' shows every status.
  const [statusFilter, setStatusFilter] = useState('')
  useSettings()

  const [orders, setOrders] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => preferredPageSize(SO_PAGE_SIZES))
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
  // Prefilled fields when a new order starts from a client's panel.
  const [formInitial, setFormInitial] = useState(null)
  const [facets, setFacets] = useState(null)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

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
        return soSearchFilter(statusFilter ? request.eq('order_status', statusFilter) : request, query, columns)
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
  }, [page, pageSize, query, statusFilter, refresh])

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

  function changePage(nextPage) {
    setPage(Math.max(1, Math.min(nextPage, totalPages)))
  }

  function openAddForm(initial = null) {
    setEditingOrder(null)
    setFormInitial(initial)
    setShowForm(true)
  }

  // "New order" in a client's panel lands here with that client chosen. The
  // state is cleared so going back or reloading does not open it again.
  const location = useLocation()
  const navigate = useNavigate()
  const startFrom = location.state?.newOrderFor
  useEffect(() => {
    if (!startFrom) return
    if (can('sales_orders.create')) openAddForm({ company: startFrom.company || '', order_client_fullname: startFrom.contact || '' })
    navigate(location.pathname, { replace: true, state: null })
  }, [startFrom]) // eslint-disable-line react-hooks/exhaustive-deps

  function openEditForm(order) {
    setEditingOrder(order)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingOrder(null)
    setFormInitial(null)
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
    setNotice(wasEdit ? 'Sales order saved' : 'Sales order created')
  }

  const searchNarrowed = searchColumnsRef.current.length < SO_SEARCH_COLUMNS.length

  // ── Tax invoice PDF ──────────────────────────────────────────────────
  const TEMPLATE_PATH = '/Temps/SO_template.pdf'

  async function handleTIDownload(order) {
    setActionError('')
    try {
      // pdf-lib + fontkit are ~1.1 MB and only this action needs them, so
      // they load on the click rather than with the page.
      const { generateTaxInvoice } = await import('../invoices/generateTaxInvoice')
      await generateTaxInvoice(TEMPLATE_PATH, order)
    } catch (err) {
      console.error('[TI Download]', err)
      setActionError(`Could not make the tax invoice for ${order.order_number || `order #${order.id}`}: ${err.message}`)
    }
  }

  const canCreate = can('sales_orders.create')
  // Every status the list can hold: the ones Settings offers plus any already in the data.
  const statusFilterOptions = uniqueOptions([...listValues('order_status', ORDER_STATUS_OPTIONS), ...(facets?.order_status || [])])
  const filtered = Boolean(query || statusFilter)

  return (
    <div className="crm-page">
      <PageHeader title="Sales orders" subtitle="What clients have ordered: campaigns, line items, invoices and payments.">
        {canCreate && (
          <button type="button" className="crm-btn crm-btn--primary" onClick={() => openAddForm()}>
            <Icon name="plus" size={17} /> New sales order
          </button>
        )}
      </PageHeader>

      <div className="crm-toolbar">
        <SearchField
          value={searchInput}
          onChange={setSearchInput}
          placeholder={searchNarrowed ? 'Search by client' : 'Search by order number, client or CRM reference'}
          label="Search sales orders"
        />
        <select className="crm-select crm-toolbar-select" value={statusFilter} aria-label="Show orders with this status"
          onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          {statusFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {!loading && <ResultCount shown={totalCount} total={totalCount} noun="order" filtered={filtered} />}
        {refreshing && <span className="crm-count" style={{ marginLeft: 0 }}>Updating…</span>}
      </div>

      {(error || actionError) && (
        <div className="crm-note crm-note--danger" role="alert">
          <Icon name="alert" size={17} />
          <div><strong>{error ? 'Could not load sales orders.' : 'That did not work.'}</strong> {error || actionError}</div>
        </div>
      )}

      <section className="crm-card">
        <div className="crm-table-scroll">
          <table className="crm-table">
            <thead>
              <tr>
                <th style={{ width: '16%' }}>Order</th>
                <th className="crm-hide-sm" style={{ width: '25%' }}>Client</th>
                <th className="crm-hide-sm" style={{ width: '22%' }}>Campaign</th>
                <th className="crm-hide-sm" style={{ width: '15%' }}>Status</th>
                <th className="crm-num" style={{ width: '15%' }}>Total</th>
                <th className="crm-col-tight crm-hide-sm" style={{ width: '48px' }} aria-label="Tax invoice" />
                <th className="crm-col-tight" style={{ width: '36px' }} aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} columns={SO_COLUMN_COUNT} />
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={SO_COLUMN_COUNT} className="crm-empty-cell">
                    {filtered ? (
                      <EmptyState title="No sales orders match">
                        {statusFilter && !query ? `No order is ${statusFilter} right now. Choose another status, or All statuses.` : 'Try an order number, a client or a CRM reference, or another status.'}
                      </EmptyState>
                    ) : (
                      <EmptyState icon="file" title="No sales orders yet"
                        action={canCreate && <button type="button" className="crm-btn crm-btn--primary" onClick={() => openAddForm()}><Icon name="plus" size={16} /> New sales order</button>}>
                        A sales order records what a client bought, for which campaign, and what they have paid.
                      </EmptyState>
                    )}
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const brandAndType = [order.brand_name, order.order_type].filter(Boolean).join(' · ')
                  return (
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
                          <span className="crm-cell-sub crm-hide-sm">{order.order_date ? formatDisplayDate(order.order_date) : (order.crm_reference_id || '—')}</span>
                          <span className="crm-cell-sub crm-show-sm">{order.company || '—'}</span>
                        </div>
                      </td>
                      <td className="crm-hide-sm"><Cell main={order.company} sub={order.order_client_fullname} title={order.company || ''} /></td>
                      <td className="crm-hide-sm"><Cell main={formatDateRange(order.campaign_start_date, order.campaign_end_date)} sub={brandAndType} /></td>
                      <td className="crm-hide-sm">
                        <div className="crm-cell">
                          <span>{order.order_status ? <StatusPill tone={statusTone(order.order_status)}>{order.order_status}</StatusPill> : <span className="crm-empty-value">—</span>}</span>
                          {order.purchase_status && <span className="crm-cell-sub">Purchase: {order.purchase_status}</span>}
                        </div>
                      </td>
                      <td className="crm-num">
                        <div className="crm-cell">
                          <span className="crm-cell-main is-strong crm-mono">{formatRupees(order.total)}</span>
                          <span className="crm-cell-sub crm-mono crm-hide-sm">{order.tax_total ? `${formatRupees(order.tax_total)} tax` : 'No tax'}</span>
                          <span className="crm-cell-sub crm-show-sm">{order.order_status || '—'}</span>
                        </div>
                      </td>
                      <td className="crm-col-tight crm-hide-sm">
                        <button
                          type="button"
                          className="crm-icon-btn"
                          onClick={(event) => { event.stopPropagation(); handleTIDownload(order) }}
                          aria-label={`Download the tax invoice for ${order.order_number || order.id}`}
                          title="Download tax invoice"
                        >
                          <Icon name="invoice" size={17} />
                        </button>
                      </td>
                      <td className="crm-col-tight"><RowChevron /></td>
                    </tr>
                  )
                })
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
          pageSizes={SO_PAGE_SIZES}
          onPage={changePage}
          onPageSize={(size) => { setPageSize(size); setPage(1) }}
        />
      </section>

      {selectedOrder && (
        <SalesOrderDetails
          order={selectedOrder}
          items={items}
          itemsLoading={itemsLoading}
          itemsError={itemsError}
          onClose={() => setSelectedOrder(null)}
          onEdit={canEditOrder(selectedOrder) ? () => openEditForm(selectedOrder) : null}
          onDownloadInvoice={() => handleTIDownload(selectedOrder)}
        />
      )}

      {showForm && (
        <SalesOrderFormModal
          order={editingOrder}
          initial={formInitial}
          session={session}
          facets={facets}
          onClose={closeForm}
          onSaved={afterSaved}
        />
      )}

      <Toast message={notice} onDone={() => setNotice('')} />
    </div>
  )
}
