// WhatsApp analytics for the dashboard: what this business sent and received, how it
// landed, what failed and why, per campaign and template, plus what Meta reports about
// the number, the templates and the spend.
//
// Reading cost matters more than anything here. D1 allows 5M row reads a day, and a
// page that scans every message on each view took the inbox down once (2026-11-08).
// So the message counts are kept per day in analytics_cache (migration 0013): a day
// older than SETTLE_DAYS is computed once and never again, and recent days at most
// every DAY_FRESH_MS. A 90-day view then reads a few days of messages, not 90.
// Meta's figures are cached for META_FRESH_MS, so the dashboard costs a handful of
// Graph calls an hour at most.

import { failureReason } from './errorReasons.js'

const GRAPH = 'https://graph.facebook.com/v21.0'

export const RANGES = [7, 30, 90]
const SETTLE_DAYS = 3
const DAY_FRESH_MS = 10 * 60 * 1000
const LIVE_FRESH_MS = 10 * 60 * 1000
const META_FRESH_MS = 30 * 60 * 1000
const ACCEPTED = "('sent','delivered','read','failed')"

const pad = (n) => String(n).padStart(2, '0')
const isoDay = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

/** Local calendar days, oldest first, ending today, for an offset from UTC in minutes. */
export function localDays(count, now, offsetMinutes) {
  const today = new Date(now.getTime() + offsetMinutes * 60000)
  const days = []
  for (let i = count - 1; i >= 0; i -= 1) {
    days.push(isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))))
  }
  return days
}

/** A UTC lower bound safely before a local day starts, for the created_at index. */
function wideBound(firstDay) {
  const d = new Date(`${firstDay}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return isoDay(d)
}

const offsetModifier = (offsetMinutes) => `${offsetMinutes >= 0 ? '+' : ''}${offsetMinutes} minutes`

const emptyDay = (day) => ({
  day, sent: 0, delivered: 0, read: 0, failed: 0, awaiting: 0,
  campaign: 0, replies: 0, automatic: 0, inbound: 0, people: 0, failures: {}, templates: {}, taps: {},
})

/** Counts per local day, straight from messages. Two grouped reads for the whole span. */
async function computeDays(db, firstDay, lastDay, offsetMinutes) {
  const modifier = offsetModifier(offsetMinutes)
  const wide = wideBound(firstDay)
  const window = `created_at >= ?1 AND date(created_at, ?2) BETWEEN ?3 AND ?4`
  const [counts, failures, templates, taps] = await db.batch([
    db.prepare(
      `SELECT date(created_at, ?2) AS day,
         SUM(CASE WHEN direction = 'outbound' AND status IN ${ACCEPTED} THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN direction = 'outbound' AND status IN ('delivered','read') THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN direction = 'outbound' AND status = 'read' THEN 1 ELSE 0 END) AS read_count,
         SUM(CASE WHEN direction = 'outbound' AND status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN direction = 'outbound' AND status = 'sent' THEN 1 ELSE 0 END) AS awaiting,
         SUM(CASE WHEN direction = 'outbound' AND status IN ${ACCEPTED} AND campaign_id IS NOT NULL THEN 1 ELSE 0 END) AS campaign,
         SUM(CASE WHEN direction = 'outbound' AND status IN ${ACCEPTED} AND campaign_id IS NULL AND conversation_id IS NOT NULL THEN 1 ELSE 0 END) AS replies,
         SUM(CASE WHEN direction = 'outbound' AND status IN ${ACCEPTED} AND campaign_id IS NULL AND conversation_id IS NULL THEN 1 ELSE 0 END) AS automatic,
         SUM(CASE WHEN direction = 'inbound' AND type <> 'reaction' THEN 1 ELSE 0 END) AS inbound,
         COUNT(DISTINCT CASE WHEN direction = 'inbound' THEN phone END) AS people
       FROM messages WHERE ${window}
       GROUP BY day`,
    ).bind(wide, modifier, firstDay, lastDay),
    db.prepare(
      `SELECT date(created_at, ?2) AS day, COALESCE(error_code, '') AS code, MAX(error_message) AS message, COUNT(*) AS n
       FROM messages WHERE direction = 'outbound' AND status = 'failed' AND ${window}
       GROUP BY day, code`,
    ).bind(wide, modifier, firstDay, lastDay),
    // A template's name is on its campaign, or in the payload of one sent from a chat.
    db.prepare(
      `SELECT date(m.created_at, ?2) AS day,
         COALESCE(c.template_name, json_extract(m.payload, '$.name')) AS name,
         SUM(CASE WHEN m.status IN ${ACCEPTED} THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN m.status IN ('delivered','read') THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN m.status = 'read' THEN 1 ELSE 0 END) AS read_count,
         SUM(CASE WHEN m.status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM messages m LEFT JOIN campaigns c ON c.id = m.campaign_id
       WHERE m.direction = 'outbound' AND (m.campaign_id IS NOT NULL OR m.type = 'template')
         AND m.created_at >= ?1 AND date(m.created_at, ?2) BETWEEN ?3 AND ?4
       GROUP BY day, name`,
    ).bind(wide, modifier, firstDay, lastDay),
    // A quick-reply tap arrives as an inbound 'button' message whose context is the
    // template message it answers, so taps count by template from our own records.
    db.prepare(
      `SELECT date(r.created_at, ?2) AS day,
         COALESCE(c.template_name, json_extract(o.payload, '$.name')) AS name,
         r.body AS label, COUNT(*) AS n
       FROM messages r
       JOIN messages o ON o.meta_message_id = r.context_wamid
       LEFT JOIN campaigns c ON c.id = o.campaign_id
       WHERE r.direction = 'inbound' AND r.type = 'button'
         AND r.created_at >= ?1 AND date(r.created_at, ?2) BETWEEN ?3 AND ?4
       GROUP BY day, name, label`,
    ).bind(wide, modifier, firstDay, lastDay),
  ])

  const days = new Map()
  const at = (day) => {
    if (!days.has(day)) days.set(day, emptyDay(day))
    return days.get(day)
  }
  for (const row of counts.results ?? []) {
    Object.assign(at(row.day), {
      sent: row.sent ?? 0, delivered: row.delivered ?? 0, read: row.read_count ?? 0, failed: row.failed ?? 0,
      awaiting: row.awaiting ?? 0, campaign: row.campaign ?? 0, replies: row.replies ?? 0,
      automatic: row.automatic ?? 0, inbound: row.inbound ?? 0, people: row.people ?? 0,
    })
  }
  for (const row of failures.results ?? []) {
    at(row.day).failures[row.code] = { n: row.n ?? 0, message: row.message ? String(row.message).slice(0, 160) : null }
  }
  for (const row of taps.results ?? []) {
    if (!row.name) continue
    const name = String(row.name).slice(0, 512)
    const label = String(row.label ?? 'Button').slice(0, 100)
    const byLabel = (at(row.day).taps[name] ??= {})
    byLabel[label] = (byLabel[label] ?? 0) + (row.n ?? 0)
  }
  for (const row of templates.results ?? []) {
    if (!row.name) continue
    at(row.day).templates[String(row.name).slice(0, 512)] = {
      sent: row.sent ?? 0, delivered: row.delivered ?? 0, read: row.read_count ?? 0, failed: row.failed ?? 0,
    }
  }
  return days
}

async function readCache(db, keys) {
  if (!keys.length) return new Map()
  const found = new Map()
  // D1 allows 100 bound parameters a query.
  for (let i = 0; i < keys.length; i += 90) {
    const slice = keys.slice(i, i + 90)
    const { results } = await db.prepare(
      `SELECT key, body, computed_at FROM analytics_cache WHERE key IN (${slice.map((_, j) => `?${j + 1}`).join(',')})`,
    ).bind(...slice).all()
    for (const row of results ?? []) {
      try { found.set(row.key, { body: JSON.parse(row.body), at: Date.parse(row.computed_at) }) } catch { /* recompute it */ }
    }
  }
  return found
}

async function writeCache(db, entries, now) {
  if (!entries.length) return
  const stamp = now.toISOString()
  const statements = entries.map(([key, body]) => db.prepare(
    `INSERT INTO analytics_cache (key, body, computed_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET body = excluded.body, computed_at = excluded.computed_at`,
  ).bind(key, JSON.stringify(body), stamp))
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50))
}

/** Day counts for these days, from the cache where it is still good. */
export async function dayCounts(db, days, { now, offsetMinutes, cache = true }) {
  const settledBefore = localDays(SETTLE_DAYS + 1, now, offsetMinutes)[0]
  let cached = new Map()
  if (cache) {
    try { cached = await readCache(db, days.map((d) => `day:${d}`)) } catch { cache = false }
  }
  const stale = days.filter((day) => {
    const hit = cached.get(`day:${day}`)
    if (!hit) return true
    if (day < settledBefore) {
      // Settled: good for ever, once it was counted after the receipts stopped coming.
      const settledAt = Date.parse(`${day}T00:00:00Z`) - offsetMinutes * 60000 + (SETTLE_DAYS + 1) * 86400000
      return hit.at < settledAt
    }
    return now.getTime() - hit.at > DAY_FRESH_MS
  })
  const result = new Map()
  for (const day of days) {
    const hit = cached.get(`day:${day}`)
    if (hit && !stale.includes(day)) result.set(day, hit.body)
  }
  if (stale.length) {
    const computed = await computeDays(db, stale[0], stale.at(-1), offsetMinutes)
    const write = []
    for (const day of stale) {
      const body = computed.get(day) ?? emptyDay(day)
      result.set(day, body)
      write.push([`day:${day}`, body])
    }
    if (cache) await writeCache(db, write, now).catch(() => {})
  }
  return days.map((day) => result.get(day) ?? emptyDay(day))
}

const SUM_KEYS = ['sent', 'delivered', 'read', 'failed', 'awaiting', 'campaign', 'replies', 'automatic', 'inbound', 'people']

export function totalsOf(days) {
  const totals = Object.fromEntries(SUM_KEYS.map((k) => [k, 0]))
  for (const day of days) for (const key of SUM_KEYS) totals[key] += day[key] ?? 0
  return totals
}

/** Top failure reasons across the days, in plain words. */
export function failuresOf(days, limit = 8) {
  const byCode = new Map()
  for (const day of days) {
    for (const [code, { n, message }] of Object.entries(day.failures ?? {})) {
      const entry = byCode.get(code) ?? { code, count: 0, message: null }
      entry.count += n
      entry.message ??= message
      byCode.set(code, entry)
    }
  }
  return [...byCode.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ code, count, message }) => ({ code: code || null, count, reason: failureReason(code, message) }))
}

export function templatesOf(days) {
  const byName = new Map()
  const blank = (name) => ({ name, sent: 0, delivered: 0, read: 0, failed: 0, replyTaps: new Map() })
  for (const day of days) {
    for (const [name, counts] of Object.entries(day.templates ?? {})) {
      const entry = byName.get(name) ?? blank(name)
      for (const key of ['sent', 'delivered', 'read', 'failed']) entry[key] += counts[key] ?? 0
      byName.set(name, entry)
    }
    // Days counted before taps were tracked have none: they read as zero.
    for (const [name, labels] of Object.entries(day.taps ?? {})) {
      const entry = byName.get(name) ?? blank(name)
      for (const [label, n] of Object.entries(labels)) entry.replyTaps.set(label, (entry.replyTaps.get(label) ?? 0) + n)
      byName.set(name, entry)
    }
  }
  return [...byName.values()]
    .map(({ replyTaps, ...entry }) => ({ ...entry, ...tapSummary(replyTaps) }))
    .sort((a, b) => b.sent - a.sent || b.replyTapTotal - a.replyTapTotal)
}

/** Quick-reply taps as a total and the buttons, most tapped first. */
function tapSummary(byLabel) {
  const buttons = [...byLabel.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  return { replyTapTotal: buttons.reduce((sum, b) => sum + b.count, 0), replyTaps: buttons.slice(0, 6) }
}

/** Recent campaigns, the audience and the inbox: small reads, cached briefly. */
async function liveFigures(db, firstDay) {
  const wide = wideBound(firstDay)
  const [campaigns, audience, open, unread] = await db.batch([
    db.prepare(
      `SELECT id, name, template_name, status, total_count, created_at FROM campaigns
       WHERE created_at >= ?1 ORDER BY id DESC LIMIT 8`,
    ).bind(wide),
    db.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN opted_out = 1 THEN 1 ELSE 0 END) AS opted_out,
         SUM(CASE WHEN created_at >= ?1 THEN 1 ELSE 0 END) AS added
       FROM contacts`,
    ).bind(wide),
    db.prepare("SELECT COUNT(*) AS total FROM conversations WHERE status = 'open'"),
    db.prepare("SELECT COUNT(*) AS total FROM conversations WHERE status = 'open' AND unread_count > 0"),
  ])
  const rows = campaigns.results ?? []
  let counts = new Map()
  if (rows.length) {
    const ids = rows.map((r) => r.id)
    const { results } = await db.prepare(
      `SELECT campaign_id,
         SUM(CASE WHEN status IN ${ACCEPTED} THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status IN ('delivered','read') THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) AS read_count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM messages WHERE campaign_id IN (${ids.map((_, i) => `?${i + 1}`).join(',')}) AND direction = 'outbound'
       GROUP BY campaign_id`,
    ).bind(...ids).all()
    counts = new Map((results ?? []).map((r) => [r.campaign_id, r]))
  }
  const a = audience.results?.[0] ?? {}
  return {
    campaigns: rows.map((r) => {
      const c = counts.get(r.id) ?? {}
      return {
        id: r.id, name: r.name, template: r.template_name, status: r.status, audience: r.total_count ?? 0,
        createdAt: r.created_at, sent: c.sent ?? 0, delivered: c.delivered ?? 0, read: c.read_count ?? 0, failed: c.failed ?? 0,
      }
    }),
    audience: { contacts: a.total ?? 0, optedOut: a.opted_out ?? 0, added: a.added ?? 0 },
    inbox: { open: open.results?.[0]?.total ?? 0, unread: unread.results?.[0]?.total ?? 0 },
  }
}

/* ── Meta ───────────────────────────────────────────────────────────────── */

async function graphGet(env, path, fetcher) {
  const res = await fetcher(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // Meta's code says why: 190 token, 100 a field or id, 200 a missing permission.
    const code = body?.error?.code
    throw new Error(code === 190 ? 'The WhatsApp access token has expired or was revoked.'
      : code === 200 || code === 10 ? 'The WhatsApp access token is missing a permission this needs (whatsapp_business_management).'
        : `Meta answered ${res.status}${code ? ` (code ${code})` : ''}.`)
  }
  return body ?? {}
}

/** Number, templates and spend, as Meta reports them. Each part fails on its own. */
export async function metaFigures(env, { firstDay, lastDay, offsetMinutes, fetcher = fetch }) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_WABA_ID || !env.WHATSAPP_PHONE_NUMBER_ID) {
    return { errors: ['WhatsApp is not configured on the server.'] }
  }
  const start = Math.floor((Date.parse(`${firstDay}T00:00:00Z`) - offsetMinutes * 60000) / 1000)
  const end = Math.floor((Date.parse(`${lastDay}T00:00:00Z`) + 86400000 - offsetMinutes * 60000) / 1000)
  const phone = env.WHATSAPP_PHONE_NUMBER_ID
  const waba = env.WHATSAPP_WABA_ID
  const [number, limit, templates, pricing] = await Promise.allSettled([
    graphGet(env, `${phone}?fields=display_phone_number,verified_name,name_status,quality_rating,throughput`, fetcher),
    // The newer field first; older API versions only know the deprecated one.
    graphGet(env, `${phone}?fields=whatsapp_business_manager_messaging_limit`, fetcher)
      .catch(() => graphGet(env, `${phone}?fields=messaging_limit_tier`, fetcher)),
    graphGet(env, `${waba}/message_templates?fields=id,name,language,status,category,quality_score&limit=200`, fetcher),
    graphGet(env, `${waba}?fields=currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["PRICING_CATEGORY"])`, fetcher),
  ])
  const errors = []
  const note = (part, result) => { if (result.status === 'rejected') errors.push(`${part}: ${result.reason?.message ?? 'failed'}`) }
  note('Phone number', number)
  note('Templates', templates)
  note('Spend', pricing)

  let account = null
  if (number.status === 'fulfilled') {
    const n = number.value
    const lim = limit.status === 'fulfilled' ? limit.value : {}
    const rawLimit = lim.whatsapp_business_manager_messaging_limit ?? lim.messaging_limit_tier ?? null
    account = {
      phone: n.display_phone_number ?? null,
      verifiedName: n.verified_name ?? null,
      nameStatus: n.name_status ?? null,
      quality: n.quality_rating ?? null,
      throughput: n.throughput?.level ?? null,
      messagingLimit: typeof rawLimit === 'string' ? rawLimit : rawLimit?.current_limit ?? null,
    }
  }

  let templateQuality = null
  if (templates.status === 'fulfilled') {
    templateQuality = (templates.value.data ?? []).map((t) => ({
      id: t.id ?? null, name: t.name, language: t.language, status: t.status, category: t.category, quality: t.quality_score?.score ?? null,
    }))
  }

  let spend = null
  if (pricing.status === 'fulfilled') {
    const points = (pricing.value.pricing_analytics?.data ?? []).flatMap((group) => group.data_points ?? [])
    const daily = new Map()
    const byCategory = new Map()
    let total = 0
    let volume = 0
    for (const p of points) {
      const cost = Number(p.cost) || 0
      const count = Number(p.volume) || 0
      const day = isoDay(new Date((Number(p.start) + offsetMinutes * 60) * 1000))
      daily.set(day, (daily.get(day) ?? 0) + cost)
      const category = p.pricing_category ?? 'OTHER'
      const entry = byCategory.get(category) ?? { category, volume: 0, cost: 0 }
      entry.volume += count
      entry.cost += cost
      byCategory.set(category, entry)
      total += cost
      volume += count
    }
    spend = {
      currency: pricing.value.currency ?? null,
      total: Math.round(total * 100) / 100,
      volume,
      byCategory: [...byCategory.values()].sort((a, b) => b.cost - a.cost),
      daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, cost]) => ({ day, cost: Math.round(cost * 100) / 100 })),
    }
  }
  return { account, templateQuality, spend, errors }
}

/* ── Template insights (link taps, cost per template) ───────────────────── */

const INSIGHT_PAGES = 6
const INSIGHT_LOOKBACK_DAYS = 90

/**
 * Link-button taps and spend per template, from Meta's template insights. They only
 * exist once the owner switches insights on for the WhatsApp Business account (Meta
 * says that cannot be undone), so "not available" is a normal answer, not an error.
 * Quick-reply taps are not taken from here: they are counted exactly from our own
 * records, and Meta's count would double them.
 */
export async function templateInsights(env, { ids, firstDay, lastDay, now = new Date(), fetcher = fetch }) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_WABA_ID) return { available: false, reason: 'WhatsApp is not configured on the server.', byId: {} }
  const wanted = [...new Set(ids.filter((id) => /^\d{1,30}$/.test(String(id))))].slice(0, 10)
  if (!wanted.length) return { available: true, byId: {} }
  const oldest = now.getTime() - (INSIGHT_LOOKBACK_DAYS - 1) * 86400000
  const startMs = Math.max(Date.parse(`${firstDay}T00:00:00Z`), Date.parse(`${isoDay(new Date(oldest))}T00:00:00Z`))
  const endMs = Math.min(Date.parse(`${lastDay}T00:00:00Z`) + 86400000, Date.parse(`${isoDay(now)}T00:00:00Z`) + 86400000)
  if (!(endMs > startMs)) return { available: false, reason: 'Meta keeps button taps for 90 days.', byId: {} }
  const query = new URLSearchParams({
    start: String(Math.floor(startMs / 1000)),
    end: String(Math.floor(endMs / 1000)),
    granularity: 'DAILY',
    metric_types: JSON.stringify(['CLICKED', 'COST']),
    template_ids: JSON.stringify(wanted),
  })
  const byId = {}
  const add = (point) => {
    const id = String(point.template_id ?? '')
    if (!wanted.includes(id)) return
    const entry = (byId[id] ??= { clicks: {}, unique: {}, cost: null })
    for (const click of Array.isArray(point.clicked) ? point.clicked : []) {
      const type = String(click?.type ?? '')
      if (!type.includes('url')) continue
      const label = String(click?.button_content ?? 'Link').slice(0, 100)
      const bucket = type.startsWith('unique') ? entry.unique : entry.clicks
      bucket[label] = (bucket[label] ?? 0) + (Number(click?.count) || 0)
    }
    for (const cost of Array.isArray(point.cost) ? point.cost : []) {
      if (cost?.type === 'amount_spent') entry.cost = Math.round(((entry.cost ?? 0) + (Number(cost.value) || 0)) * 100) / 100
    }
  }
  try {
    let body = await graphGet(env, `${env.WHATSAPP_WABA_ID}/template_analytics?${query}`, fetcher)
    for (let page = 1; ; page += 1) {
      for (const group of Array.isArray(body.data) ? body.data : []) for (const point of group.data_points ?? []) add(point)
      const next = body.paging?.next
      // Follow Meta's own next-page link only, and only so far.
      if (!next || page >= INSIGHT_PAGES || !String(next).startsWith(`${GRAPH}/`)) break
      body = await graphGet(env, String(next).slice(GRAPH.length + 1), fetcher)
    }
  } catch (error) {
    return { available: false, reason: error.message, byId: {} }
  }
  // Total taps where Meta reports them, else the people who tapped.
  for (const entry of Object.values(byId)) {
    const source = Object.keys(entry.clicks).length ? entry.clicks : entry.unique
    entry.links = Object.entries(source).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
    entry.linkTaps = entry.links.reduce((sum, link) => sum + link.count, 0)
    delete entry.clicks
    delete entry.unique
  }
  return { available: true, byId }
}

/** Insights for template names, summed across each name's languages. */
function insightsFor(name, idsByName, insights) {
  if (!insights?.available) return { linkTaps: null, links: [], cost: null }
  let linkTaps = 0
  let cost = null
  const links = new Map()
  for (const id of idsByName.get(name) ?? []) {
    const entry = insights.byId[id]
    if (!entry) continue
    linkTaps += entry.linkTaps
    if (entry.cost !== null) cost = Math.round(((cost ?? 0) + entry.cost) * 100) / 100
    for (const link of entry.links) links.set(link.label, (links.get(link.label) ?? 0) + link.count)
  }
  return { linkTaps, links: [...links.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6), cost }
}

/* ── The whole answer ───────────────────────────────────────────────────── */

async function cachedPart(db, key, freshMs, now, compute) {
  let hit = null
  try { hit = (await readCache(db, [key])).get(key) } catch { /* no cache table yet */ }
  if (hit && now.getTime() - hit.at <= freshMs) return hit.body
  const body = await compute()
  await writeCache(db, [[key, body]], now).catch(() => {})
  return body
}

export async function buildAnalytics(env, { days: span, now = new Date(), fetcher = fetch }) {
  const offsetMinutes = Number.isFinite(Number(env.ANALYTICS_UTC_OFFSET_MINUTES)) ? Number(env.ANALYTICS_UTC_OFFSET_MINUTES) : 330
  const db = env.DB
  const all = localDays(span * 2, now, offsetMinutes)
  const previousDays = all.slice(0, span)
  const currentDays = all.slice(span)
  const counts = await dayCounts(db, all, { now, offsetMinutes })
  const previous = counts.slice(0, span)
  const current = counts.slice(span)
  const firstDay = currentDays[0]
  const lastDay = currentDays.at(-1)

  const [live, meta] = await Promise.all([
    cachedPart(db, `live:${span}`, LIVE_FRESH_MS, now, () => liveFigures(db, firstDay)),
    cachedPart(db, `meta:${span}:${lastDay}`, META_FRESH_MS, now, () => metaFigures(env, { firstDay, lastDay, offsetMinutes, fetcher })),
  ])

  const quality = new Map((meta.templateQuality ?? []).map((t) => [t.name, t]))
  const idsByName = new Map()
  for (const t of meta.templateQuality ?? []) if (t.id) idsByName.set(t.name, [...(idsByName.get(t.name) ?? []), String(t.id)])
  const ranked = templatesOf(current).slice(0, 12)
  const insightIds = ranked.flatMap((t) => idsByName.get(t.name) ?? []).slice(0, 10)
  const insights = meta.templateQuality
    ? await cachedPart(db, `insights:${span}:${lastDay}`, META_FRESH_MS, now, () => templateInsights(env, { ids: insightIds, firstDay, lastDay, now, fetcher }))
    : { available: false, reason: 'Meta did not list the templates.', byId: {} }
  const templates = ranked.map((t) => ({
    ...t, quality: quality.get(t.name)?.quality ?? null, status: quality.get(t.name)?.status ?? null,
    category: quality.get(t.name)?.category ?? null,
    ...insightsFor(t.name, idsByName, insights),
  }))
  const templateHealth = { GREEN: 0, YELLOW: 0, RED: 0, UNKNOWN: 0, paused: 0 }
  for (const t of meta.templateQuality ?? []) {
    if (t.status === 'PAUSED' || t.status === 'DISABLED') templateHealth.paused += 1
    else if (t.status === 'APPROVED') templateHealth[t.quality in templateHealth ? t.quality : 'UNKNOWN'] += 1
  }

  return {
    range: { days: span, from: firstDay, to: lastDay, previousFrom: previousDays[0], utcOffsetMinutes: offsetMinutes },
    totals: totalsOf(current),
    previous: totalsOf(previous),
    daily: current.map(({ day, sent, delivered, read, failed, inbound, campaign, replies, automatic }) => ({
      day, sent, delivered, read, failed, inbound, campaign, replies, automatic,
    })),
    failures: failuresOf(current),
    templates,
    templateHealth: meta.templateQuality ? templateHealth : null,
    templateInsights: insights.available ? { available: true } : { available: false, reason: insights.reason ?? null },
    campaigns: live.campaigns,
    audience: live.audience,
    inbox: live.inbox,
    account: meta.account ?? null,
    spend: meta.spend ?? null,
    metaErrors: meta.errors ?? [],
    computedAt: now.toISOString(),
  }
}

/* ── One campaign ───────────────────────────────────────────────────────── */

const TIMELINE_HOURS = 72
const REPLY_WINDOW_DAYS = 7

/** Link taps on the campaign's template in its reply window, from Meta's insights. */
async function campaignLinkTaps(env, campaign, started, now, fetcher) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_WABA_ID) return { available: false, reason: 'WhatsApp is not configured on the server.' }
  if (!Number.isFinite(started) || !campaign.template_name) return { available: false, reason: null }
  try {
    const list = await graphGet(env, `${env.WHATSAPP_WABA_ID}/message_templates?name=${encodeURIComponent(campaign.template_name)}&fields=id,name,language&limit=20`, fetcher)
    const ids = (list.data ?? [])
      .filter((t) => t.name === campaign.template_name && (!campaign.template_language || t.language === campaign.template_language))
      .map((t) => String(t.id))
    if (!ids.length) return { available: false, reason: 'Meta no longer lists this template.' }
    const firstDay = isoDay(new Date(started))
    const lastDay = isoDay(new Date(Math.min(started + REPLY_WINDOW_DAYS * 86400000, now.getTime())))
    const insights = await templateInsights(env, { ids, firstDay, lastDay, now, fetcher })
    return insights.available ? { available: true, ...insightsFor(campaign.template_name, new Map([[campaign.template_name, ids]]), insights) } : insights
  } catch (error) {
    return { available: false, reason: error.message }
  }
}

/** D1 stamps are 'YYYY-MM-DD HH:MM:SS' in UTC or ISO strings; NaN for anything else. */
const utcTime = (value) => {
  if (!value) return NaN
  const text = String(value).trim().replace(' ', 'T')
  return Date.parse(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`)
}

/**
 * One campaign on its own: how its messages landed, how fast, why some failed, and
 * who wrote back. Reads only that campaign's rows (idx_messages_campaign) and, for
 * replies, a week of inbound messages. Cached like a day: briefly while receipts can
 * still arrive, then for good.
 */
export async function campaignPerformance(env, id, { now = new Date(), fetcher = fetch } = {}) {
  const db = env.DB
  const campaign = await db.prepare(
    `SELECT id, name, template_name, template_language, status, total_count, sent_count, failed_count, created_at, completed_at
     FROM campaigns WHERE id = ?1`,
  ).bind(id).first()
  if (!campaign) return null

  const started = utcTime(campaign.created_at)
  // Receipts settle a few days after the last send, and a retry sends again later.
  const lastSend = Math.max(started, utcTime(campaign.completed_at) || 0)
  const settleMs = (SETTLE_DAYS + 1) * 86400000
  const settled = Number.isFinite(lastSend) && now.getTime() - lastSend > settleMs
  // A retry or a status change since the cached answer means it is out of date.
  const version = [campaign.status, campaign.sent_count, campaign.failed_count, campaign.completed_at].join('|')
  const key = `campaign:${id}`
  let hit = null
  try { hit = (await readCache(db, [key])).get(key) } catch { /* no cache table yet */ }
  if (hit && hit.body?.version === version && (settled ? hit.at - lastSend > settleMs : now.getTime() - hit.at <= DAY_FRESH_MS)) {
    return hit.body
  }

  const since = campaign.created_at
  // Plain-text bounds on created_at so the reply count can use idx_messages_created
  // (rows mix 'YYYY-MM-DD HH:MM:SS' and ISO stamps; both sort as text by day).
  const wide = Number.isFinite(started) ? isoDay(new Date(started - 86400000)) : '0000'
  const wideEnd = Number.isFinite(started) ? isoDay(new Date(started + (REPLY_WINDOW_DAYS + 2) * 86400000)) : '9999'
  const [counts, failures, delivered, read, replies, optedOut, taps] = await db.batch([
    db.prepare(
      `SELECT SUM(CASE WHEN status IN ${ACCEPTED} THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status IN ('delivered','read') THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) AS read_count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS awaiting
       FROM messages WHERE campaign_id = ?1 AND direction = 'outbound'`,
    ).bind(id),
    db.prepare(
      `SELECT COALESCE(error_code, '') AS code, MAX(error_message) AS message, COUNT(*) AS n
       FROM messages WHERE campaign_id = ?1 AND status = 'failed'
       GROUP BY code ORDER BY n DESC LIMIT 8`,
    ).bind(id),
    // Hours after the campaign started, for how fast messages landed and were read.
    db.prepare(
      `SELECT MIN(CAST((julianday(delivered_at) - julianday(?2)) * 24 AS INTEGER), ${TIMELINE_HOURS}) AS hour, COUNT(*) AS n
       FROM messages WHERE campaign_id = ?1 AND delivered_at IS NOT NULL GROUP BY hour`,
    ).bind(id, since),
    db.prepare(
      `SELECT MIN(CAST((julianday(read_at) - julianday(?2)) * 24 AS INTEGER), ${TIMELINE_HOURS}) AS hour, COUNT(*) AS n
       FROM messages WHERE campaign_id = ?1 AND read_at IS NOT NULL GROUP BY hour`,
    ).bind(id, since),
    // Recipients who wrote back within a week of the campaign.
    db.prepare(
      `SELECT COUNT(DISTINCT phone) AS n FROM messages
       WHERE direction = 'inbound' AND created_at >= ?3 AND created_at < ?4
         AND julianday(created_at) BETWEEN julianday(?2) AND julianday(?2) + ${REPLY_WINDOW_DAYS}
         AND phone IN (SELECT phone FROM messages WHERE campaign_id = ?1)`,
    ).bind(id, since, wide, wideEnd),
    db.prepare(
      `SELECT COUNT(*) AS n FROM contacts
       WHERE opted_out = 1 AND phone IN (SELECT phone FROM messages WHERE campaign_id = ?1)`,
    ).bind(id),
    // Quick-reply taps on this campaign's own messages: each answers one of them.
    db.prepare(
      `SELECT r.body AS label, COUNT(*) AS n, COUNT(DISTINCT r.phone) AS people
       FROM messages r
       WHERE r.direction = 'inbound' AND r.type = 'button' AND r.created_at >= ?2 AND r.created_at < ?3
         AND r.context_wamid IN (SELECT meta_message_id FROM messages WHERE campaign_id = ?1 AND meta_message_id IS NOT NULL)
       GROUP BY r.body ORDER BY n DESC LIMIT 6`,
    ).bind(id, wide, wideEnd),
  ])

  const c = counts.results?.[0] ?? {}
  const hours = Array.from({ length: TIMELINE_HOURS + 1 }, (_, hour) => ({ hour, delivered: 0, read: 0 }))
  for (const row of delivered.results ?? []) if (row.hour >= 0) hours[row.hour].delivered += row.n ?? 0
  for (const row of read.results ?? []) if (row.hour >= 0) hours[row.hour].read += row.n ?? 0
  // Trailing hours with nothing in them say nothing.
  let last = hours.length - 1
  while (last > 0 && !hours[last].delivered && !hours[last].read) last -= 1

  const replyButtons = (taps.results ?? []).map((row) => ({ label: String(row.label ?? 'Button').slice(0, 100), count: row.n ?? 0, people: row.people ?? 0 }))
  const links = await campaignLinkTaps(env, campaign, started, now, fetcher)
  const body = {
    campaign: {
      id: campaign.id, name: campaign.name, template: campaign.template_name, language: campaign.template_language,
      status: campaign.status, audience: campaign.total_count ?? 0, createdAt: campaign.created_at, completedAt: campaign.completed_at,
    },
    totals: {
      sent: c.sent ?? 0, delivered: c.delivered ?? 0, read: c.read_count ?? 0, failed: c.failed ?? 0, awaiting: c.awaiting ?? 0,
      // Never handed to Meta: still queued, or no message row at all.
      notSent: Math.max(0, (campaign.total_count ?? 0) - (c.sent ?? 0)),
      replied: replies.results?.[0]?.n ?? 0,
      optedOut: optedOut.results?.[0]?.n ?? 0,
    },
    failures: (failures.results ?? []).map((row) => ({ code: row.code || null, count: row.n ?? 0, reason: failureReason(row.code, row.message) })),
    timeline: hours.slice(0, last + 1),
    replyWindowDays: REPLY_WINDOW_DAYS,
    taps: {
      replies: replyButtons,
      replyTotal: replyButtons.reduce((sum, b) => sum + b.count, 0),
      // Meta counts link taps per template, not per campaign: every send of this
      // template in the week after the start counts.
      links: links.available ? links.links : null,
      linkTotal: links.available ? links.linkTaps : null,
      linkCost: links.available ? links.cost : null,
      insights: links.available ? { available: true } : { available: false, reason: links.reason ?? null },
    },
    version,
    computedAt: now.toISOString(),
  }
  await writeCache(db, [[key, body]], now).catch(() => {})
  return body
}
