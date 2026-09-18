import { round2 } from '../../lib/money'
import { formatDateInput } from '../../lib/format'
import { todayIso } from '../../lib/dates'
import {
  ORDER_TYPE_OPTIONS, ORDER_STATUS_OPTIONS, PURCHASE_STATUS_OPTIONS,
  GST_TYPE_OPTIONS, GST_RATES, SO_ITEM_TYPE_OPTIONS,
  itemAmounts, rateFromAmounts, taxFromRate,
} from '../../lib/gst'

export const SALES_ORDER_FALLBACKS = {
  unique_id: () => `SO-${Date.now()}`,
  crm_reference_id: () => `SO-${Date.now()}`,
  order_type: () => ORDER_TYPE_OPTIONS[0],
  order_status: () => ORDER_STATUS_OPTIONS[0],
  purchase_status: () => PURCHASE_STATUS_OPTIONS[0],
  order_date: () => todayIso(),
  order_client_fullname: (row) => row.company || 'Client',
  brand_name: (row) => row.company || 'Brand',
  multi_purpose_so: () => false,
  payment_receipt_amount: () => 0,
  created_by: () => 'Dikho',
}

export const SALES_ORDER_ITEM_FALLBACKS = {
  type: () => SO_ITEM_TYPE_OPTIONS[0],
  short_name: (row) => row.name || 'Item',
  label: (row) => row.name || 'Item',
  reference_type: () => 'Sales Order',
  gst_type: () => GST_TYPE_OPTIONS[0].value,
  date: () => todayIso(),
  invoice_number: () => '',
  is_taxable: () => true,
  self_audit_completed: () => false,
}

export const SO_SEARCH_COLUMNS = ['order_number', 'company', 'crm_reference_id']
export const SO_SEARCH_FALLBACK_COLUMNS = ['company']

export function soSearchFilter(request, query, columns) {
  const safeQuery = query.replace(/[%_]/g, '').replace(/[(),]/g, ' ').trim()
  if (!safeQuery) return request
  return request.or(columns.map((column) => `${column}.ilike.%${safeQuery}%`).join(','))
}

export const SO_COLOR_OPTIONS = [
  { value: '', label: 'None' },
  { value: '#185494', label: 'Blue' },
  { value: '#f9af1b', label: 'Amber' },
  { value: '#2f9e6f', label: 'Green' },
  { value: '#b23b43', label: 'Red' },
  { value: '#6c4bb6', label: 'Purple' },
  { value: '#6b7684', label: 'Slate' },
]

export function blankSalesOrderForm() {
  return {
    crm_reference_id: '',
    company: '',
    order_client_fullname: '',
    order_type: ORDER_TYPE_OPTIONS[0],
    unique_id: '',
    order_number: '',
    order_date: todayIso(),
    invoice_date: '',
    campaign_start_date: '',
    campaign_end_date: '',
    brand_name: '',
    multi_purpose_so: false,
    invoice_courier: '',
    payment_receipt_amount: '',
    order_status: ORDER_STATUS_OPTIONS[0],
    purchase_status: PURCHASE_STATUS_OPTIONS[0],
    order_color: '',
    approved_by: '',
    approved_date: '',
    complete_date: '',
  }
}

export function salesOrderToForm(row) {
  return {
    crm_reference_id: row.crm_reference_id ?? '',
    company: row.company ?? '',
    order_client_fullname: row.order_client_fullname ?? '',
    order_type: row.order_type ?? '',
    unique_id: row.unique_id ?? '',
    order_number: row.order_number ?? '',
    order_date: formatDateInput(row.order_date),
    invoice_date: formatDateInput(row.invoice_date),
    campaign_start_date: formatDateInput(row.campaign_start_date),
    campaign_end_date: formatDateInput(row.campaign_end_date),
    brand_name: row.brand_name ?? '',
    multi_purpose_so: Boolean(row.multi_purpose_so),
    invoice_courier: row.invoice_courier ?? '',
    payment_receipt_amount: row.payment_receipt_amount == null ? '' : String(row.payment_receipt_amount),
    order_status: row.order_status ?? '',
    purchase_status: row.purchase_status ?? '',
    order_color: row.order_color ?? '',
    approved_by: row.approved_by ?? '',
    approved_date: formatDateInput(row.approved_date),
    complete_date: formatDateInput(row.complete_date),
  }
}

export function blankSalesOrderItem(key) {
  return {
    key,
    id: null,
    type: SO_ITEM_TYPE_OPTIONS[0],
    name: '',
    short_name: '',
    label: '',
    reference_type: 'Sales Order',
    date: '',
    invoice_number: '',
    is_taxable: true,
    gst_type: GST_TYPE_OPTIONS[0].value,
    gst_rate: '18',
    taxable_amount: '',
    tax_amount: '',
    document_color: '',
    document_note: '',
    self_audit_completed: false,
    file_url: '',
    document_courier: '',
    courier_status: '',
    expanded: false,
  }
}

export function salesOrderItemToForm(row, key) {
  return {
    key,
    id: row.id ?? null,
    type: row.type ?? '',
    name: row.name ?? '',
    short_name: row.short_name ?? '',
    label: row.label ?? '',
    reference_type: row.reference_type ?? '',
    date: formatDateInput(row.date),
    invoice_number: row.invoice_number ?? '',
    is_taxable: row.is_taxable === null || row.is_taxable === undefined ? true : Boolean(row.is_taxable),
    gst_type: row.gst_type || GST_TYPE_OPTIONS[0].value,
    gst_rate: rateFromAmounts(row.taxable_amount, row.tax_amount),
    taxable_amount: row.taxable_amount == null ? '' : String(row.taxable_amount),
    tax_amount: row.tax_amount == null ? '' : String(row.tax_amount),
    document_color: row.document_color ?? '',
    document_note: row.document_note ?? '',
    self_audit_completed: Boolean(row.self_audit_completed),
    file_url: row.file_url ?? '',
    document_courier: row.document_courier ?? '',
    courier_status: row.courier_status ?? '',
    expanded: false,
  }
}

export function buildSalesOrderPayload(form, totals, session) {
  return {
    crm_reference_id: form.crm_reference_id.trim() || null,
    company: form.company.trim(),
    order_client_fullname: form.order_client_fullname.trim() || null,
    order_type: form.order_type || null,
    unique_id: form.unique_id.trim() || null,
    order_number: form.order_number.trim(),
    order_date: form.order_date || null,
    invoice_date: form.invoice_date || null,
    campaign_start_date: form.campaign_start_date || null,
    campaign_end_date: form.campaign_end_date || null,
    brand_name: form.brand_name.trim() || null,
    multi_purpose_so: Boolean(form.multi_purpose_so),
    invoice_courier: form.invoice_courier.trim() || null,
    payment_receipt_amount: form.payment_receipt_amount === '' ? null : round2(form.payment_receipt_amount),
    order_status: form.order_status || null,
    purchase_status: form.purchase_status || null,
    order_color: form.order_color || null,
    approved_by: form.approved_by.trim() || null,
    approved_date: form.approved_date || null,
    complete_date: form.complete_date || null,
    sub_total: totals.sub_total,
    tax_total: totals.tax_total,
    total: totals.total,
    created_by: sessionActor(session),
  }
}

export function sessionActor(session) {
  const user = session?.user
  return user?.user_metadata?.full_name || user?.email || null
}

export function buildSalesOrderItemPayload(item, salesOrderId) {
  return {
    sales_order_id: salesOrderId,
    type: item.type.trim() || null,
    name: item.name.trim(),
    short_name: item.short_name.trim() || null,
    label: item.label.trim() || null,
    reference_type: item.reference_type.trim() || null,
    date: item.date || null,
    invoice_number: item.invoice_number.trim() || null,
    is_taxable: Boolean(item.is_taxable),
    gst_type: item.is_taxable ? (item.gst_type || null) : null,
    document_color: item.document_color || null,
    document_note: item.document_note.trim() || null,
    self_audit_completed: Boolean(item.self_audit_completed),
    file_url: item.file_url.trim() || null,
    document_courier: item.document_courier.trim() || null,
    courier_status: item.courier_status || null,
    ...itemAmounts(item),
  }
}
