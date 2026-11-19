import test from 'node:test'
import assert from 'node:assert/strict'
import { leadSearchFilter } from '../src/features/leads/leadSearch.js'

test('text is searched in the text columns only, never in the numeric mobile column', () => {
  const filter = leadSearchFilter('Pune')
  assert.equal(filter, 'company_name.ilike.%Pune%,name.ilike.%Pune%,email.ilike.%Pune%,city.ilike.%Pune%')
  assert.doesNotMatch(filter, /mobile\.ilike/)
})

test('a whole number finds the lead, with or without its country code', () => {
  assert.match(leadSearchFilter('9800000011'), /mobile\.in\.\(9800000011\)$/)
  assert.match(leadSearchFilter('+91 98000 00011'), /mobile\.in\.\(919800000011,9800000011\)$/)
})

test('characters that would break the filter are dropped', () => {
  const filter = leadSearchFilter('a,b(c)"d\\e%_')
  assert.equal(filter.includes('(c)'), false)
  assert.doesNotMatch(filter, /[%_]e|"|\\/)
  assert.equal(leadSearchFilter('%_'), null)
  assert.equal(leadSearchFilter('   '), null)
})
