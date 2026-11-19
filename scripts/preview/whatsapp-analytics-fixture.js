// Synthetic WhatsApp analytics for the preview harnesses (whatsapp-dashboard and crm).
// No real messages, numbers or names.

// A repeatable wobble, so every load draws the same synthetic numbers.
let seed = 7
const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }

function day(offset) {
  const date = new Date(Date.UTC(2026, 10, 9 - offset))
  return date.toISOString().slice(0, 10)
}

const TAPS = [
  [{ label: 'Interested', count: 312 }, { label: 'Not now', count: 41 }],
  [],
  [{ label: 'Send the price list', count: 64 }, { label: 'Stop promotions', count: 9 }],
  [],
]
const LINKS = [[{ label: 'View catalogue', count: 488 }], [], [{ label: 'Visit website', count: 72 }], []]
const COSTS = [3297.0, 41.8, 942.0, 31.4]

function withTaps(template, i, insightsOff) {
  const replyTaps = TAPS[i] ?? []
  const links = insightsOff ? [] : LINKS[i] ?? []
  return {
    ...template,
    replyTaps,
    replyTapTotal: replyTaps.reduce((sum, b) => sum + b.count, 0),
    links,
    linkTaps: insightsOff ? null : links.reduce((sum, b) => sum + b.count, 0),
    cost: insightsOff ? null : COSTS[i] ?? null,
  }
}

/** GET /api/whatsapp/analytics for `days`, synthetic. */
export function analyticsFixture(days, { empty: EMPTY = false, metaDown: META_DOWN = false, insightsOff = false } = {}) {
  seed = 7
  const daily = Array.from({ length: days }, (_, i) => {
    const campaignDay = !EMPTY && (days - i) % 6 === 2
    const base = EMPTY ? 0 : Math.round(30 + noise() * 40)
    const sent = base + (campaignDay ? 900 + Math.round(noise() * 300) : 0)
    const delivered = Math.round(sent * (0.86 + noise() * 0.08))
    const read = Math.round(delivered * (0.55 + noise() * 0.15))
    const failed = Math.round(sent * (0.02 + noise() * 0.05))
    return {
      day: day(days - 1 - i), sent, delivered, read, failed,
      inbound: EMPTY ? 0 : Math.round(20 + noise() * 60 + (campaignDay ? 80 : 0)),
      campaign: campaignDay ? sent - base : 0, replies: Math.round(base * 0.8), automatic: Math.round(base * 0.2),
    }
  })
  const sum = (key, rows) => rows.reduce((total, row) => total + (row[key] ?? 0), 0)
  const totals = Object.fromEntries(['sent', 'delivered', 'read', 'failed', 'inbound', 'campaign', 'replies', 'automatic'].map((k) => [k, sum(k, daily)]))
  totals.awaiting = Math.round(totals.sent * 0.01)
  const previous = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v * (0.8 + noise() * 0.3))]))
  return {
    range: { days, from: daily[0].day, to: daily.at(-1).day, previousFrom: day(days * 2 - 1), utcOffsetMinutes: 330 },
    totals,
    previous,
    daily,
    failures: EMPTY ? [] : [
      { code: '131049', count: Math.round(totals.failed * 0.62), reason: 'Held back by Meta to protect engagement (marketing limit per person)' },
      { code: '131026', count: Math.round(totals.failed * 0.25), reason: 'Not on WhatsApp, or cannot receive this message' },
      { code: '131047', count: Math.round(totals.failed * 0.09), reason: 'More than 24 hours since they last wrote: needs a template' },
      { code: null, count: Math.round(totals.failed * 0.04), reason: 'Error without a code' },
    ],
    templates: (EMPTY ? [] : [
      { name: 'diwali_corporate_gifting_offer', sent: 4200, delivered: 3790, read: 2401, failed: 160, quality: 'GREEN', status: 'APPROVED', category: 'MARKETING' },
      { name: 'client_conformation_', sent: 380, delivered: 371, read: 300, failed: 4, quality: 'GREEN', status: 'APPROVED', category: 'UTILITY' },
      { name: 'festive_offer_with_a_long_name_for_wrapping', sent: 1200, delivered: 980, read: 410, failed: 120, quality: 'YELLOW', status: 'APPROVED', category: 'MARKETING' },
      { name: 'old_promo', sent: 40, delivered: 30, read: 9, failed: 8, quality: 'RED', status: 'PAUSED', category: 'MARKETING' },
    ]).map((t, i) => withTaps(t, i, META_DOWN || insightsOff)),
    templateHealth: META_DOWN ? null : { GREEN: 6, YELLOW: 1, RED: 0, UNKNOWN: 2, paused: 1 },
    templateInsights: META_DOWN || insightsOff ? { available: false, reason: META_DOWN ? 'The WhatsApp access token has expired or was revoked.' : null } : { available: true },
    campaigns: EMPTY ? [] : [
      { id: 12, name: 'Diwali offers for corporate gifting buyers', template: 'diwali_corporate_gifting_offer', status: 'completed', audience: 1200, createdAt: '2026-11-03 04:30:00', sent: 1180, delivered: 1062, read: 701, failed: 52 },
      { id: 11, name: 'Short', template: 'welcome', status: 'sending', audience: 90, createdAt: '2026-11-08 06:10:00', sent: 12, delivered: 9, read: 2, failed: 0 },
      { id: 10, name: 'Re-engagement for buyers who went quiet after the last quote', template: 'festive_offer_with_a_long_name_for_wrapping', status: 'stopped', audience: 640, createdAt: '2026-10-27 09:00:00', sent: 410, delivered: 330, read: 120, failed: 44 },
    ],
    audience: { contacts: 5240, optedOut: 61, added: 312 },
    inbox: { open: 48, unread: 7 },
    account: META_DOWN ? null : {
      phone: '+91 00000 00000', verifiedName: 'Example Media', nameStatus: 'APPROVED', quality: 'GREEN', throughput: 'STANDARD', messagingLimit: 'TIER_2K',
    },
    spend: META_DOWN || EMPTY ? null : {
      currency: 'INR', total: 6412.35, volume: 9120,
      byCategory: [
        { category: 'MARKETING', volume: 7400, cost: 5809.0 },
        { category: 'UTILITY', volume: 1220, cost: 603.35 },
        { category: 'SERVICE', volume: 500, cost: 0 },
      ],
      daily: daily.filter((row) => row.campaign).map((row) => ({ day: row.day, cost: Math.round(row.campaign * 0.785 * 100) / 100 })),
    },
    metaErrors: META_DOWN ? ['Phone number: The WhatsApp access token has expired or was revoked.', 'Spend: The WhatsApp access token has expired or was revoked.'] : [],
    computedAt: '2026-11-09T06:00:00.000Z',
  }
}

const timeline = [70, 210, 260, 180, 90, 60, 40, 30, 22, 18, 15, 12, 10, 8, 6, 5, 4, 3, 3, 2, 2, 1, 1, 1].map((delivered, hour) => ({
  hour, delivered, read: Math.round(delivered * 0.55 + (hour > 2 ? 12 : 0)),
}))
// The API sends every hour up to the last one with receipts; the last bucket is 72 and later.
for (let hour = timeline.length; hour < 72; hour += 1) timeline.push({ hour, delivered: 0, read: hour < 48 ? 2 : 0 })
timeline.push({ hour: 72, delivered: 4, read: 30 })

/** GET /api/whatsapp/analytics/campaigns/12, synthetic. */
export const campaignFixture = {
  campaign: { id: 12, name: 'Diwali offers for corporate gifting buyers', template: 'diwali_corporate_gifting_offer', language: 'en', status: 'completed', audience: 1200, createdAt: '2026-11-03 04:30:00', completedAt: '2026-11-03 04:52:00' },
  totals: { sent: 1180, delivered: 1062, read: 701, failed: 52, awaiting: 66, notSent: 20, replied: 148, optedOut: 9 },
  failures: [
    { code: '131049', count: 38, reason: 'Held back by Meta to protect engagement (marketing limit per person)' },
    { code: '131026', count: 14, reason: 'Not on WhatsApp, or cannot receive this message' },
  ],
  timeline,
  replyWindowDays: 7,
  taps: {
    replies: [{ label: 'Interested', count: 131, people: 118 }, { label: 'Not now', count: 22, people: 22 }],
    replyTotal: 153,
    links: [{ label: 'View catalogue', count: 207 }],
    linkTotal: 207,
    linkCost: 912.4,
    insights: { available: true },
  },
  computedAt: '2026-11-09T06:00:00.000Z',
}
