// Plain helpers behind the WhatsApp dashboard and campaign pages: rates, changes
// against the previous period and Meta's codes in words. No React, so tests can
// import them directly (tests/whatsapp-analytics-figures.test.js).

/** part / whole as a percentage, or null when there is nothing to divide by. */
export function rate(part, whole) {
  const p = Number(part)
  const w = Number(whole)
  return w > 0 && Number.isFinite(p) ? (p / w) * 100 : null
}

/** "92%" or "92.4%": one decimal only below 10% or when it matters (99.6%). */
export function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const rounded = Math.round(value)
  if ((value > 0 && value < 10) || (rounded === 100 && value < 100) || (rounded === 0 && value > 0)) {
    return `${(Math.floor(value * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
  }
  return `${rounded}%`
}

/**
 * How a figure moved against the previous period of the same length.
 * Counts compare as a percentage, rates as percentage points. `better` says
 * which way is good: 'up' (most), 'down' (failures, cost) or null (neutral).
 */
export function change(current, previous, { kind = 'count', better = 'up' } = {}) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null
  const now = Number(current)
  const before = Number(previous)
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null
  let amount
  let text
  if (kind === 'rate') {
    amount = now - before
    if (Math.abs(amount) < 0.05) return { direction: 'flat', tone: 'neutral', text: 'No change' }
    text = `${Math.abs(amount).toFixed(Math.abs(amount) < 10 ? 1 : 0)} pts`
  } else {
    if (before === 0) return now === 0 ? { direction: 'flat', tone: 'neutral', text: 'No change' } : { direction: 'up', tone: 'neutral', text: 'New this period' }
    amount = ((now - before) / before) * 100
    if (Math.abs(amount) < 0.5) return { direction: 'flat', tone: 'neutral', text: 'No change' }
    text = `${Math.abs(amount) >= 1000 ? '999+' : Math.round(Math.abs(amount))}%`
  }
  const direction = amount > 0 ? 'up' : 'down'
  const tone = better === null ? 'neutral' : direction === better ? 'good' : 'bad'
  return { direction, tone, text }
}

/** "1 Nov", from a YYYY-MM-DD day, without going through the viewer's timezone. */
export function shortDay(day) {
  const match = String(day ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return String(day ?? '')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(match[3])} ${months[Number(match[2]) - 1]}`
}

/** A D1 stamp ('YYYY-MM-DD HH:MM:SS' in UTC, or ISO) as a Date, or null. */
export function parseStamp(value) {
  if (!value) return null
  const text = String(value).trim().replace(' ', 'T')
  const date = new Date(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

const LIMITS = {
  TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10000, TIER_100K: 100000,
}

/** Meta's messaging limit in words: how many people the business may start chats with a day. */
export function messagingLimitLabel(tier, formatNumber = (n) => n.toLocaleString('en-IN')) {
  if (!tier) return null
  if (tier === 'TIER_UNLIMITED') return 'Unlimited'
  if (LIMITS[tier]) return `${formatNumber(LIMITS[tier])} people a day`
  return tier
}

export const QUALITY = {
  GREEN: { label: 'High', tone: 'good', icon: 'check' },
  YELLOW: { label: 'Medium', tone: 'warn', icon: 'alert' },
  RED: { label: 'Low', tone: 'bad', icon: 'alert' },
  UNKNOWN: { label: 'Not rated yet', tone: 'neutral', icon: null },
}

/** A quality rating or score as label, tone and icon; unknown values read as not rated. */
export function quality(value) {
  return QUALITY[String(value ?? '').toUpperCase()] ?? QUALITY.UNKNOWN
}

export const THROUGHPUT = { STANDARD: 'Standard (up to 80 messages a second)', HIGH: 'High (up to 1,000 messages a second)', NOT_APPLICABLE: 'Not applicable' }

export const CATEGORY = { MARKETING: 'Marketing', UTILITY: 'Utility', SERVICE: 'Service', AUTHENTICATION: 'Authentication', AUTHENTICATION_INTERNATIONAL: 'Authentication (international)', REFERRAL_CONVERSION: 'Free entry point', OTHER: 'Other' }

/** Spend in the account's currency: "₹1,234.50", "$12.00". */
export function formatMoneyIn(amount, currency, locale = 'en-IN') {
  const value = Number(amount)
  if (!Number.isFinite(value)) return '—'
  try {
    return value.toLocaleString(locale, { style: 'currency', currency: currency || 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } catch {
    return `${currency ?? ''} ${value.toFixed(2)}`.trim()
  }
}

/**
 * A campaign's hour-by-hour receipts as running totals, plus the hour by which
 * half of all deliveries (and reads) had arrived.
 */
export function cumulativeTimeline(timeline = []) {
  let delivered = 0
  let read = 0
  const points = timeline.map((row) => {
    delivered += row.delivered ?? 0
    read += row.read ?? 0
    return { hour: row.hour, delivered, read }
  })
  const half = (key, total) => {
    if (!total) return null
    return points.find((p) => p[key] >= total / 2)?.hour ?? null
  }
  return { points, halfDelivered: half('delivered', delivered), halfRead: half('read', read) }
}

/** "within the first hour", "within 3 hours", "after 3 days or more". */
export function hoursPhrase(hour, last = 72) {
  if (hour === null || hour === undefined) return null
  if (hour >= last) return 'after three days or more'
  if (hour === 0) return 'within the first hour'
  return `within ${hour + 1} hours`
}
