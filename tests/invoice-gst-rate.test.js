import assert from 'node:assert/strict'
import { test } from 'node:test'
import { invoiceGstRate, itemAmounts, rateFromAmounts } from '../src/lib/gst.js'

// The GST % the client tax invoice prints for a stored line. Synthetic amounts.

test('a standard slab prints that slab, whatever the GST type', () => {
  for (const gstType of ['Intra-State', 'Inter-State', 'Union Territory']) {
    const line = itemAmounts({ is_taxable: true, gst_type: gstType, taxable_amount: '10000', tax_amount: '1800' })
    assert.equal(invoiceGstRate(line.taxable_amount, line.tax_amount), '18')
  }
  assert.equal(invoiceGstRate(2000, 100), '5')
  assert.equal(invoiceGstRate(2500, 300), '12')
  assert.equal(invoiceGstRate(1000, 280), '28')
})

test('PostgREST strings read the same as numbers', () => {
  assert.equal(invoiceGstRate('45000.00', '8100.00'), '18')
  assert.equal(invoiceGstRate('45000.00', '0.00'), '0')
})

test('a line with no tax prints 0, never the form default of 18', () => {
  const notTaxable = itemAmounts({ is_taxable: false, gst_type: null, taxable_amount: '5000', tax_amount: '900' })
  assert.equal(notTaxable.tax_amount, 0)
  assert.equal(invoiceGstRate(notTaxable.taxable_amount, notTaxable.tax_amount), '0')
  assert.equal(invoiceGstRate(0, 0), '0')
  assert.equal(invoiceGstRate(null, null), '0')
  assert.equal(rateFromAmounts(0, 0), '18')
})

test('a custom tax prints the rate it works out to', () => {
  assert.equal(rateFromAmounts(10000, 1750), 'custom')
  assert.equal(invoiceGstRate(10000, 1750), '17.5')
  assert.equal(invoiceGstRate(12000, 1000), '8.33')
})

test('a slab rounded to the paisa on a small amount still prints the slab', () => {
  // 18% of 1.11 is 0.1998, stored as 0.20, which reads back as 18.02%.
  assert.equal(rateFromAmounts(1.11, 0.2), 'custom')
  assert.equal(invoiceGstRate(1.11, 0.2), '18')
})

test('a credit line keeps its slab', () => {
  assert.equal(invoiceGstRate(-1000, -180), '18')
})

test('tax on a zero taxable amount has no rate to print', () => {
  assert.equal(invoiceGstRate(0, 50), '-')
})
