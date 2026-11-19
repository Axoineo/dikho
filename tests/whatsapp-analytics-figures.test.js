import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  change, cumulativeTimeline, formatMoneyIn, formatPercent, hoursPhrase, messagingLimitLabel, parseStamp, quality, rate, shortDay,
} from '../src/features/whatsapp/analytics/figures.js'
import { scale } from '../src/features/whatsapp/analytics/scale.js'

// The dashboard's arithmetic and wording, without a browser.

test('rates and percentages never divide by zero and never round to a false 100%', () => {
  assert.equal(rate(5, 0), null)
  assert.equal(formatPercent(rate(5, 0)), '—')
  assert.equal(formatPercent(rate(92, 100)), '92%')
  assert.equal(formatPercent(rate(996, 1000)), '99.6%')
  assert.equal(formatPercent(rate(3, 1000)), '0.3%')
  assert.equal(formatPercent(rate(52, 1000)), '5.2%')
  assert.equal(formatPercent(100), '100%')
  assert.equal(formatPercent(0), '0%')
})

test('changes: counts in percent, rates in points, and which way is good', () => {
  assert.deepEqual(change(120, 100), { direction: 'up', tone: 'good', text: '20%' })
  assert.deepEqual(change(12, 10, { better: 'down' }), { direction: 'up', tone: 'bad', text: '20%' })
  assert.deepEqual(change(90.5, 92, { kind: 'rate' }), { direction: 'down', tone: 'bad', text: '1.5 pts' })
  assert.equal(change(5, 0).text, 'New this period')
  assert.equal(change(0, 0).text, 'No change')
  assert.equal(change(null, 3), null)
  assert.equal(change(80, null, { kind: 'rate' }), null, 'no rate before means nothing to compare')
  assert.equal(change(50000, 10).text, '999+%')
})

test('days, stamps and Meta codes read as words', () => {
  assert.equal(shortDay('2026-11-01'), '1 Nov')
  assert.equal(parseStamp('2026-11-01 04:30:00').toISOString(), '2026-11-01T04:30:00.000Z', 'D1 stamps are UTC')
  assert.equal(parseStamp('2026-11-01T04:30:00.000Z').toISOString(), '2026-11-01T04:30:00.000Z')
  assert.equal(parseStamp('nonsense'), null)
  assert.equal(messagingLimitLabel('TIER_1K', (n) => n.toLocaleString('en-IN')), '1,000 people a day')
  assert.equal(messagingLimitLabel('TIER_UNLIMITED'), 'Unlimited')
  assert.equal(messagingLimitLabel('TIER_NEW'), 'TIER_NEW', 'an unknown tier shows as Meta wrote it')
  assert.equal(quality('green').label, 'High')
  assert.equal(quality('RED').tone, 'bad')
  assert.equal(quality(undefined).label, 'Not rated yet')
  assert.equal(formatMoneyIn(1234.5, 'INR'), '₹1,234.50')
  assert.equal(formatMoneyIn('x', 'INR'), '—')
})

test('a campaign timeline as running totals, and when half had arrived', () => {
  const { points, halfDelivered, halfRead } = cumulativeTimeline([
    { hour: 0, delivered: 60, read: 10 }, { hour: 1, delivered: 30, read: 20 }, { hour: 2, delivered: 10, read: 40 },
  ])
  assert.deepEqual(points.at(-1), { hour: 2, delivered: 100, read: 70 })
  assert.equal(halfDelivered, 0)
  assert.equal(halfRead, 2)
  assert.equal(hoursPhrase(0), 'within the first hour')
  assert.equal(hoursPhrase(2), 'within 3 hours')
  assert.equal(hoursPhrase(72), 'after three days or more')
  assert.deepEqual(cumulativeTimeline([]), { points: [], halfDelivered: null, halfRead: null })
})

test('chart scales: round tops, whole-number ticks for counts', () => {
  assert.deepEqual(scale(0), { top: 4, ticks: [0, 1, 2, 3, 4] })
  assert.deepEqual(scale(7), { top: 8, ticks: [0, 2, 4, 6, 8] })
  assert.deepEqual(scale(950), { top: 1000, ticks: [0, 250, 500, 750, 1000] })
  assert.deepEqual(scale(3, { integer: false }).ticks, [0, 1, 2, 3])
  assert.deepEqual(scale(0.9, { integer: false }), { top: 1, ticks: [0, 0.25, 0.5, 0.75, 1] })
})
