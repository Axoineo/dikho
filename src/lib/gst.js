/**
 * Indian GST tax calculation utilities.
 * No React, no side effects.
 */

import { round2, toAmount } from './money'
import { formatMoney } from './format'

/* ── Constants ──────────────────────────────────────────────────────────── */

// The three advertising categories the rest of the product is organised around.
export const ORDER_TYPE_OPTIONS = ['ATL', 'TTL', 'BTL']

// `order_status` and `purchase_status` are open text in the database, so these
// are the values this module *writes* — not a set it can enforce. Whatever the
// table already holds is merged in at runtime and the list renders any value.
export const ORDER_STATUS_OPTIONS = ['Draft', 'Pending Approval', 'Approved', 'In Progress', 'Completed', 'Cancelled']
export const PURCHASE_STATUS_OPTIONS = ['Not Started', 'Partial', 'Completed']

// CGST + SGST within one state, IGST across states, CGST + UTGST in a union
// territory. These are the three shapes the four child tax columns can take.
export const GST_TYPE_OPTIONS = [
  { value: 'Intra-State', label: 'Intra-State (CGST + SGST)' },
  { value: 'Inter-State', label: 'Inter-State (IGST)' },
  { value: 'Union Territory', label: 'Union Territory (CGST + UTGST)' },
]

export const GST_RATES = [0, 5, 12, 18, 28]

export const SO_ITEM_TYPE_OPTIONS = ['Media', 'Production', 'Printing', 'Installation', 'Service', 'Other']

export const SO_COURIER_STATUS_OPTIONS = ['Not Sent', 'Dispatched', 'In Transit', 'Delivered', 'Returned']

/* ── Functions ──────────────────────────────────────────────────────────── */

// Splits one item's tax across the four columns the child table stores. The two
// halves are derived from each other rather than both from `tax`, so
// cgst + sgst adds back up to tax exactly even when tax has an odd last paisa.
export function splitGst(gstType, taxAmount, isTaxable) {
  const zero = { cgst_amount: 0, sgst_amount: 0, igst_amount: 0, utgst_amount: 0 }
  const tax = round2(taxAmount)
  if (!isTaxable || tax === 0) return zero
  if (gstType === 'Inter-State') return { ...zero, igst_amount: tax }
  const half = round2(tax / 2)
  if (gstType === 'Union Territory') return { ...zero, cgst_amount: half, utgst_amount: round2(tax - half) }
  return { ...zero, cgst_amount: half, sgst_amount: round2(tax - half) }
}

// One form row → every money column the child table stores. Nothing downstream
// has to recompute or guess: the split is applied here and after-tax is always
// taxable + tax.
export function itemAmounts(item) {
  const taxable = round2(toAmount(item.taxable_amount))
  const isTaxable = Boolean(item.is_taxable)
  const tax = isTaxable ? round2(toAmount(item.tax_amount)) : 0
  return {
    taxable_amount: taxable,
    tax_amount: tax,
    after_tax_amount: round2(taxable + tax),
    ...splitGst(item.gst_type, tax, isTaxable),
  }
}

export function taxFromRate(taxableAmount, rate) {
  return round2(toAmount(taxableAmount) * (toAmount(rate) / 100))
}

// The child table stores amounts, not the rate that produced them, so an item
// opened for editing has its rate read back out of the two amounts. Anything
// that is not one of the standard slabs comes back as a custom rate, which hands
// the tax field to the user instead of overwriting it.
export function rateFromAmounts(taxableAmount, taxAmount) {
  const taxable = toAmount(taxableAmount)
  if (taxable <= 0) return '18'
  const rate = round2((toAmount(taxAmount) / taxable) * 100)
  return GST_RATES.includes(rate) ? String(rate) : 'custom'
}

export function gstBreakdown(row) {
  return [
    ['CGST', row.cgst_amount],
    ['SGST', row.sgst_amount],
    ['IGST', row.igst_amount],
    ['UTGST', row.utgst_amount],
  ]
    .filter(([, value]) => toAmount(value) !== 0)
    .map(([label, value]) => `${label} ${formatMoney(value)}`)
    .join(' · ')
}

/* ── Totals reconciliation ──────────────────────────────────────────────── */

// Amounts arrive from text inputs, so equality is checked to within half a
// paisa rather than exactly.
export const MONEY_EPSILON = 0.005

// The parent's three totals are never taken from the form: they are recomputed
// from the child rows here, and every internal relationship is re-checked, in
// the same call that produces the numbers sent to Supabase. A failure means the
// UI and the items have drifted apart and nothing is written.
export function reconcileSalesOrderTotals(items) {
  let subTotal = 0
  let taxTotal = 0
  let grandTotal = 0

  items.forEach((item, index) => {
    const amounts = itemAmounts(item)
    const position = index + 1
    const splitSum = round2(amounts.cgst_amount + amounts.sgst_amount + amounts.igst_amount + amounts.utgst_amount)

    if (Math.abs(splitSum - amounts.tax_amount) > MONEY_EPSILON) {
      throw new Error(`Item ${position}: the CGST/SGST/IGST/UTGST split (${splitSum}) does not add up to the tax amount (${amounts.tax_amount}).`)
    }
    if (Math.abs(amounts.after_tax_amount - (amounts.taxable_amount + amounts.tax_amount)) > MONEY_EPSILON) {
      throw new Error(`Item ${position}: the after-tax amount does not equal taxable + tax.`)
    }

    subTotal += amounts.taxable_amount
    taxTotal += amounts.tax_amount
    grandTotal += amounts.after_tax_amount
  })

  const totals = {
    sub_total: round2(subTotal),
    tax_total: round2(taxTotal),
    total: round2(grandTotal),
  }

  if (Math.abs(totals.total - (totals.sub_total + totals.tax_total)) > MONEY_EPSILON) {
    throw new Error(`Order total (${totals.total}) does not equal sub total + tax total (${round2(totals.sub_total + totals.tax_total)}).`)
  }

  return totals
}

// The same three numbers for rows that are already in the database, so the
// details panel can flag a parent whose stored totals no longer match its items.
export function storedItemTotals(rows) {
  return rows.reduce((accumulator, row) => ({
    sub_total: round2(accumulator.sub_total + toAmount(row.taxable_amount)),
    tax_total: round2(accumulator.tax_total + toAmount(row.tax_amount)),
    total: round2(accumulator.total + toAmount(row.after_tax_amount)),
  }), { sub_total: 0, tax_total: 0, total: 0 })
}

// Rate → tax is the normal direction; choosing "Custom" hands the tax field back
// to the user, and clearing "Taxable" zeroes it whatever the rate says.
export function applyItemChange(item, field, value) {
  const next = { ...item, [field]: value }

  if (field === 'is_taxable') {
    if (!value) next.tax_amount = '0'
    else if (next.gst_rate !== 'custom') next.tax_amount = String(taxFromRate(next.taxable_amount, next.gst_rate))
    return next
  }

  if ((field === 'taxable_amount' || field === 'gst_rate') && next.is_taxable && next.gst_rate !== 'custom') {
    next.tax_amount = String(taxFromRate(next.taxable_amount, next.gst_rate))
  }

  return next
}
