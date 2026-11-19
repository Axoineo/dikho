import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildAnalytics, campaignPerformance, dayCounts, failuresOf, localDays, metaFigures, templateInsights, templatesOf, totalsOf,
} from '../src/api/services/whatsapp/analytics.js'
import { failureReason } from '../src/api/services/whatsapp/errorReasons.js'

// The WhatsApp dashboard's numbers. A fake D1 answers by the SQL it sees and keeps
// analytics_cache in memory, so these check what is read, what is cached and for
// how long. The SQL itself was run against real SQLite built from every migration.
// Synthetic data only.

const IST = 330

function fakeDb({ dayRows = [], failureRows = [], templateRows = [], tapRows = [] } = {}) {
  const cache = new Map()
  const log = []
  const answer = (sql, args) => {
    log.push(sql.replace(/\s+/g, ' ').trim())
    if (/FROM analytics_cache/.test(sql)) {
      return { results: args.filter((k) => cache.has(k)).map((k) => ({ key: k, ...cache.get(k) })) }
    }
    if (/INSERT INTO analytics_cache/.test(sql)) {
      cache.set(args[0], { body: args[1], computed_at: args[2] })
      return { results: [] }
    }
    if (/MAX\(error_message\)/.test(sql)) return { results: failureRows }
    if (/type = 'button'/.test(sql)) return { results: tapRows }
    if (/LEFT JOIN campaigns/.test(sql)) return { results: templateRows }
    if (/COUNT\(DISTINCT/.test(sql)) return { results: dayRows }
    if (/FROM campaigns/.test(sql)) return { results: [] }
    if (/FROM contacts/.test(sql)) return { results: [{ total: 10, opted_out: 2, added: 3 }] }
    if (/FROM conversations/.test(sql)) return { results: [{ total: 4 }] }
    return { results: [] }
  }
  const statement = (sql) => {
    let args = []
    const s = {
      bind: (...a) => { args = a; return s },
      all: async () => answer(sql, args),
      first: async () => answer(sql, args).results[0] ?? null,
      run: async () => answer(sql, args),
    }
    return s
  }
  return { prepare: statement, batch: async (list) => Promise.all(list.map((s) => s.all())), log, cache }
}

const countReads = (db) => db.log.filter((sql) => /FROM messages/.test(sql) && /COUNT\(DISTINCT/.test(sql)).length

test('days are local days, cut at local midnight, oldest first', () => {
  // 20:00 UTC on 8 November is already 9 November in India.
  assert.deepEqual(localDays(3, new Date('2026-11-08T20:00:00Z'), IST), ['2026-11-07', '2026-11-08', '2026-11-09'])
  assert.deepEqual(localDays(1, new Date('2026-11-08T18:00:00Z'), IST), ['2026-11-08'])
  assert.deepEqual(localDays(2, new Date('2026-03-01T01:00:00Z'), 0), ['2026-02-28', '2026-03-01'])
})

test('the first view counts every day once; a view minutes later reads only the cache', async () => {
  const db = fakeDb({ dayRows: [{ day: '2026-11-09', sent: 5, delivered: 4, read_count: 2, failed: 1, awaiting: 0, inbound: 3, people: 2 }] })
  const now = new Date('2026-11-09T06:00:00Z')
  const days = localDays(7, now, IST)
  const first = await dayCounts(db, days, { now, offsetMinutes: IST })
  assert.equal(countReads(db), 1, 'one grouped read for all seven days')
  assert.equal(first.at(-1).sent, 5)
  assert.equal(db.cache.size, 7)
  const before = countReads(db)
  await dayCounts(db, days, { now: new Date(now.getTime() + 5 * 60000), offsetMinutes: IST })
  assert.equal(countReads(db), before, 'no message read five minutes later')
})

test('recent days are recounted after ten minutes, settled days never', async () => {
  const db = fakeDb()
  const now = new Date('2026-11-09T06:00:00Z')
  const days = localDays(30, now, IST)
  await dayCounts(db, days, { now, offsetMinutes: IST })
  const later = new Date(now.getTime() + 11 * 60000)
  await dayCounts(db, days, { now: later, offsetMinutes: IST })
  const recount = db.log.filter((sql) => /COUNT\(DISTINCT/.test(sql)).length
  assert.equal(recount, 2, 'recounted once')
  // Only the last few days were stale: the bound covers them alone.
  const lastWrite = [...db.cache.entries()].filter(([, v]) => v.computed_at === later.toISOString()).map(([k]) => k).sort()
  assert.deepEqual(lastWrite, ['day:2026-11-06', 'day:2026-11-07', 'day:2026-11-08', 'day:2026-11-09'])
})

test('a day counted before its receipts settled is counted again once, then kept', async () => {
  const db = fakeDb()
  const early = new Date('2026-11-01T06:00:00Z')
  await dayCounts(db, ['2026-11-01'], { now: early, offsetMinutes: IST })
  const weekLater = new Date('2026-11-09T06:00:00Z')
  await dayCounts(db, ['2026-11-01'], { now: weekLater, offsetMinutes: IST })
  await dayCounts(db, ['2026-11-01'], { now: new Date('2026-11-20T06:00:00Z'), offsetMinutes: IST })
  assert.equal(countReads(db), 2, 'counted at first, recounted once settled, never again')
})

test('with no cache table yet, it still answers, by counting', async () => {
  const db = fakeDb()
  const broken = { ...db, prepare: (sql) => (/analytics_cache/.test(sql) ? { bind: () => ({ all: async () => { throw new Error('no such table') } }) } : db.prepare(sql)) }
  const result = await dayCounts(broken, ['2026-11-09'], { now: new Date('2026-11-09T06:00:00Z'), offsetMinutes: IST })
  assert.equal(result.length, 1)
})

test('totals, failures and templates add up across days, worst failures first in plain words', () => {
  const days = [
    { sent: 3, delivered: 2, read: 1, failed: 1, inbound: 4, failures: { 131049: { n: 1, message: 'x' } }, templates: { a: { sent: 3, delivered: 2, read: 1, failed: 1 } } },
    { sent: 2, delivered: 2, read: 2, failed: 3, inbound: 0, failures: { 131026: { n: 2, message: null }, 999999: { n: 1, message: 'Something new' } }, templates: { a: { sent: 1 }, b: { sent: 5 } } },
  ]
  const totals = totalsOf(days)
  assert.equal(totals.sent, 5)
  assert.equal(totals.failed, 4)
  assert.equal(totals.inbound, 4)
  assert.deepEqual(failuresOf(days).map((f) => [f.code, f.count]), [['131026', 2], ['131049', 1], ['999999', 1]])
  assert.match(failuresOf(days)[0].reason, /Not on WhatsApp/)
  assert.equal(failuresOf(days)[2].reason, 'Something new')
  assert.deepEqual(templatesOf(days).map((t) => [t.name, t.sent]), [['b', 5], ['a', 4]])
  assert.equal(failureReason(undefined, ''), 'Error without a code')
})

const graph = (bodies, calls = []) => async (url) => {
  calls.push(url)
  const match = bodies.find(([pattern]) => pattern.test(url))
  if (!match) return new Response('{}', { status: 404 })
  const [, body, status = 200] = match
  return new Response(JSON.stringify(body), { status })
}

const env = { WHATSAPP_ACCESS_TOKEN: 'synthetic', WHATSAPP_WABA_ID: '1', WHATSAPP_PHONE_NUMBER_ID: '2' }

test('Meta: number health, quality per template, and spend by category and day', async () => {
  const fetcher = graph([
    [/pricing_analytics/, { currency: 'INR', pricing_analytics: { data: [{ data_points: [
      { start: Date.parse('2026-11-07T18:30:00Z') / 1000, pricing_category: 'MARKETING', volume: 10, cost: 7.85 },
      { start: Date.parse('2026-11-08T18:30:00Z') / 1000, pricing_category: 'MARKETING', volume: 2, cost: 1.57 },
      { start: Date.parse('2026-11-08T18:30:00Z') / 1000, pricing_category: 'SERVICE', volume: 5, cost: 0 },
    ] }] } }],
    [/message_templates/, { data: [{ name: 'a', status: 'APPROVED', quality_score: { score: 'GREEN' } }] }],
    [/whatsapp_business_manager_messaging_limit/, { error: { code: 100 } }, 400],
    [/messaging_limit_tier/, { messaging_limit_tier: 'TIER_1K' }],
    [/display_phone_number/, { verified_name: 'Example', quality_rating: 'YELLOW', throughput: { level: 'STANDARD' } }],
  ])
  const meta = await metaFigures(env, { firstDay: '2026-11-08', lastDay: '2026-11-09', offsetMinutes: IST, fetcher })
  assert.deepEqual(meta.errors, [])
  assert.equal(meta.account.quality, 'YELLOW')
  assert.equal(meta.account.messagingLimit, 'TIER_1K', 'falls back to the older field')
  assert.equal(meta.templateQuality[0].quality, 'GREEN')
  assert.equal(meta.spend.total, 9.42)
  assert.equal(meta.spend.volume, 17)
  assert.deepEqual(meta.spend.daily, [{ day: '2026-11-08', cost: 7.85 }, { day: '2026-11-09', cost: 1.57 }])
  assert.deepEqual(meta.spend.byCategory.map((c) => c.category), ['MARKETING', 'SERVICE'])
})

test('Meta: a missing permission or token is said plainly, and the rest still comes back', async () => {
  const fetcher = graph([
    [/pricing_analytics/, { error: { code: 200 } }, 403],
    [/message_templates/, { error: { code: 190 } }, 401],
    [/display_phone_number/, { quality_rating: 'GREEN' }],
  ])
  const meta = await metaFigures(env, { firstDay: '2026-11-08', lastDay: '2026-11-09', offsetMinutes: IST, fetcher })
  assert.equal(meta.account.quality, 'GREEN')
  assert.equal(meta.spend, null)
  assert.ok(meta.errors.some((e) => /permission/.test(e)))
  assert.ok(meta.errors.some((e) => /expired or was revoked/.test(e)))
  assert.ok(!meta.errors.join(' ').includes('synthetic'), 'no token in any message')
  assert.deepEqual(await metaFigures({}, { firstDay: 'x', lastDay: 'x', offsetMinutes: 0, fetcher }), { errors: ['WhatsApp is not configured on the server.'] })
})

test('the whole answer compares with the previous period and asks Meta at most every half hour', async () => {
  const db = fakeDb({ dayRows: [{ day: '2026-11-09', sent: 4, delivered: 3, read_count: 1, failed: 1, awaiting: 0, inbound: 2, people: 1 }] })
  const calls = []
  const fetcher = graph([[/./, {}]], calls)
  const now = new Date('2026-11-09T06:00:00Z')
  const a = await buildAnalytics({ ...env, DB: db }, { days: 7, now, fetcher })
  assert.equal(a.range.from, '2026-11-03')
  assert.equal(a.range.previousFrom, '2026-10-27')
  assert.equal(a.daily.length, 7)
  assert.equal(a.totals.sent, 4)
  assert.equal(a.previous.sent, 0)
  assert.deepEqual(a.audience, { contacts: 10, optedOut: 2, added: 3 })
  const asked = calls.length
  await buildAnalytics({ ...env, DB: db }, { days: 7, now: new Date(now.getTime() + 20 * 60000), fetcher })
  assert.equal(calls.length, asked, 'Meta not asked again within the half hour')
  await buildAnalytics({ ...env, DB: db }, { days: 7, now: new Date(now.getTime() + 31 * 60000), fetcher })
  assert.ok(calls.length > asked, 'asked again after it')
})

/* ── One campaign ───────────────────────────────────────────────────────── */

function campaignDb(campaign, { counts = {}, failures = [], delivered = [], read = [], replied = 0, optedOut = 0, taps = [] } = {}) {
  const cache = new Map()
  const log = []
  const answer = (sql, args) => {
    const flat = sql.replace(/\s+/g, ' ').trim()
    log.push({ sql: flat, args })
    if (/FROM analytics_cache/.test(flat)) return { results: args.filter((k) => cache.has(k)).map((k) => ({ key: k, ...cache.get(k) })) }
    if (/INSERT INTO analytics_cache/.test(flat)) { cache.set(args[0], { body: args[1], computed_at: args[2] }); return { results: [] } }
    if (/FROM campaigns WHERE id/.test(flat)) return { results: campaign && args[0] === campaign.id ? [campaign] : [] }
    if (/MAX\(error_message\)/.test(flat)) return { results: failures }
    if (/julianday\(delivered_at\)/.test(flat)) return { results: delivered }
    if (/julianday\(read_at\)/.test(flat)) return { results: read }
    if (/type = 'button'/.test(flat)) return { results: taps }
    if (/direction = 'inbound'/.test(flat)) return { results: [{ n: replied }] }
    if (/FROM contacts/.test(flat)) return { results: [{ n: optedOut }] }
    if (/FROM messages WHERE campaign_id/.test(flat)) return { results: [counts] }
    return { results: [] }
  }
  const statement = (sql) => {
    let args = []
    const s = {
      bind: (...a) => { args = a; return s },
      all: async () => answer(sql, args),
      first: async () => answer(sql, args).results[0] ?? null,
      run: async () => answer(sql, args),
    }
    return s
  }
  return { prepare: statement, batch: async (list) => Promise.all(list.map((s) => s.all())), log, cache }
}

const campaignRow = {
  id: 7, name: 'Diwali offer', template_name: 'diwali', template_language: 'en', status: 'completed',
  total_count: 100, sent_count: 90, failed_count: 6, created_at: '2026-11-01 04:30:00', completed_at: '2026-11-01 04:41:00',
}
const campaignReads = (db) => db.log.filter((e) => /FROM messages WHERE campaign_id = \?1 AND direction = 'outbound'/.test(e.sql)).length

test('a campaign on its own: funnel, failures in plain words, replies and opt-outs', async () => {
  const db = campaignDb(campaignRow, {
    counts: { sent: 90, delivered: 80, read_count: 50, failed: 6, awaiting: 4 },
    failures: [{ code: '131049', message: 'x', n: 5 }, { code: '', message: null, n: 1 }],
    delivered: [{ hour: 0, n: 70 }, { hour: 2, n: 9 }, { hour: 72, n: 1 }],
    read: [{ hour: 0, n: 30 }, { hour: 5, n: 20 }],
    replied: 12,
    optedOut: 2,
  })
  const r = await campaignPerformance({ DB: db }, 7, { now: new Date('2026-11-09T06:00:00Z') })
  assert.equal(r.campaign.name, 'Diwali offer')
  assert.equal(r.campaign.audience, 100)
  assert.deepEqual(r.totals, { sent: 90, delivered: 80, read: 50, failed: 6, awaiting: 4, notSent: 10, replied: 12, optedOut: 2 })
  assert.match(r.failures[0].reason, /marketing limit/)
  assert.equal(r.failures[1].code, null)
  assert.equal(r.failures[1].reason, 'Error without a code')
  assert.equal(r.timeline.length, 73, 'the last bucket holds everything after three days')
  assert.deepEqual(r.timeline[0], { hour: 0, delivered: 70, read: 30 })
  assert.equal(r.timeline[72].delivered, 1)
  assert.equal(r.replyWindowDays, 7)
  // Every message read is scoped to this campaign; replies only over a bounded week.
  const inbound = db.log.find((e) => /direction = 'inbound'/.test(e.sql))
  assert.deepEqual(inbound.args, [7, '2026-11-01 04:30:00', '2026-10-31', '2026-11-10'])
})

test('a campaign timeline stops at the last hour with anything in it', async () => {
  const db = campaignDb(campaignRow, { delivered: [{ hour: 0, n: 3 }, { hour: 4, n: 1 }], read: [{ hour: 1, n: 2 }] })
  const r = await campaignPerformance({ DB: db }, 7, { now: new Date('2026-11-09T06:00:00Z') })
  assert.equal(r.timeline.length, 5)
})

test('an unknown campaign is null, so the route answers 404', async () => {
  assert.equal(await campaignPerformance({ DB: campaignDb(campaignRow) }, 8), null)
})

test('a settled campaign is counted once; a recent one every ten minutes; a retry recounts', async () => {
  const db = campaignDb(campaignRow, { counts: { sent: 90 } })
  const settled = new Date('2026-11-09T06:00:00Z')
  await campaignPerformance({ DB: db }, 7, { now: settled })
  await campaignPerformance({ DB: db }, 7, { now: new Date('2026-11-20T06:00:00Z') })
  assert.equal(campaignReads(db), 1, 'kept once counted after it settled')

  // A retry raises sent_count: the cached answer no longer matches.
  const retried = campaignDb({ ...campaignRow, sent_count: 94 }, { counts: { sent: 94 } })
  retried.cache.set(...[...db.cache.entries()][0])
  const again = await campaignPerformance({ DB: retried }, 7, { now: new Date('2026-11-20T06:00:00Z') })
  assert.equal(campaignReads(retried), 1)
  assert.equal(again.totals.sent, 94)

  const fresh = { ...campaignRow, id: 9, created_at: '2026-11-09 05:00:00', completed_at: null, status: 'sending' }
  const live = campaignDb(fresh)
  const now = new Date('2026-11-09T06:00:00Z')
  await campaignPerformance({ DB: live }, 9, { now })
  await campaignPerformance({ DB: live }, 9, { now: new Date(now.getTime() + 5 * 60000) })
  assert.equal(campaignReads(live), 1, 'cached for ten minutes while receipts arrive')
  await campaignPerformance({ DB: live }, 9, { now: new Date(now.getTime() + 11 * 60000) })
  assert.equal(campaignReads(live), 2)
})

/* ── Button taps ────────────────────────────────────────────────────────── */

test('quick-reply taps count per template from our own records, most tapped first', async () => {
  const db = fakeDb({
    templateRows: [{ day: '2026-11-09', name: 'offer', sent: 10, delivered: 9, read_count: 5, failed: 0 }],
    tapRows: [
      { day: '2026-11-09', name: 'offer', label: 'Interested', n: 4 },
      { day: '2026-11-09', name: 'offer', label: 'Not now', n: 1 },
      { day: '2026-11-09', name: 'offer', label: 'Interested', n: 2 },
    ],
  })
  const now = new Date('2026-11-09T06:00:00Z')
  const days = await dayCounts(db, ['2026-11-09'], { now, offsetMinutes: IST })
  const [offer] = templatesOf(days)
  assert.equal(offer.replyTapTotal, 7)
  assert.deepEqual(offer.replyTaps, [{ label: 'Interested', count: 6 }, { label: 'Not now', count: 1 }])
  // A day cached before taps were tracked has none, and reads as zero.
  assert.equal(templatesOf([{ templates: { old: { sent: 3 } } }])[0].replyTapTotal, 0)
})

const insightsEnv = { ...env, WHATSAPP_WABA_ID: '55' }

test('Meta link taps and cost per template; quick replies left to our records; pages followed', async () => {
  const calls = []
  const fetcher = graph([
    [/after=page2/, { data: [{ data_points: [
      { template_id: '901', clicked: [{ type: 'url_button', button_content: 'View catalogue', count: 3 }], cost: [{ type: 'amount_spent', value: 1.25 }] },
    ] }] }],
    [/template_analytics/, { data: [{ data_points: [
      { template_id: '901', clicked: [
        { type: 'url_button', button_content: 'View catalogue', count: 5 },
        { type: 'unique_url_button', button_content: 'View catalogue', count: 4 },
        { type: 'quick_reply_button', button_content: 'Interested', count: 9 },
      ], cost: [{ type: 'amount_spent', value: 2.5 }, { type: 'cost_per_delivered', value: 0.1 }] },
      { template_id: '999', clicked: [{ type: 'url_button', button_content: 'Not asked for', count: 50 }] },
    ] }], paging: { next: 'https://graph.facebook.com/v21.0/55/template_analytics?after=page2' } }],
  ], calls)
  const result = await templateInsights(insightsEnv, { ids: ['901', 'bad id', '901'], firstDay: '2026-11-03', lastDay: '2026-11-09', now: new Date('2026-11-09T06:00:00Z'), fetcher })
  assert.equal(result.available, true)
  assert.deepEqual(result.byId['901'].links, [{ label: 'View catalogue', count: 8 }], 'total taps, quick replies left out')
  assert.equal(result.byId['901'].cost, 3.75)
  assert.equal(result.byId['999'], undefined, 'a template not asked for is ignored')
  const first = new URL(calls[0])
  assert.equal(first.searchParams.get('template_ids'), '["901"]', 'ids checked and de-duplicated')
  assert.equal(first.searchParams.get('granularity'), 'DAILY')
  assert.equal(calls.length, 2)
})

test('Meta insights switched off: a plain "not available", never a thrown error', async () => {
  const fetcher = graph([[/template_analytics/, { error: { code: 100, message: 'insights not enabled' } }, 400]])
  const off = await templateInsights(insightsEnv, { ids: ['901'], firstDay: '2026-11-03', lastDay: '2026-11-09', now: new Date('2026-11-09T06:00:00Z'), fetcher })
  assert.equal(off.available, false)
  assert.match(off.reason, /Meta answered 400/)
  const old = await templateInsights(insightsEnv, { ids: ['901'], firstDay: '2026-01-01', lastDay: '2026-02-01', now: new Date('2026-11-09T06:00:00Z'), fetcher })
  assert.equal(old.reason, 'Meta keeps button taps for 90 days.')
  assert.equal((await templateInsights({}, { ids: ['901'], firstDay: 'x', lastDay: 'x', fetcher })).available, false)
})

test('the dashboard puts link taps and cost on each template, summed across languages', async () => {
  const db = fakeDb({ templateRows: [{ day: '2026-11-09', name: 'offer', sent: 10, delivered: 9, read_count: 5, failed: 0 }] })
  const fetcher = graph([
    [/template_analytics/, { data: [{ data_points: [
      { template_id: '1', clicked: [{ type: 'url_button', button_content: 'Visit', count: 2 }], cost: [{ type: 'amount_spent', value: 1 }] },
      { template_id: '2', clicked: [{ type: 'url_button', button_content: 'Visit', count: 3 }], cost: [{ type: 'amount_spent', value: 0.5 }] },
    ] }] }],
    [/message_templates/, { data: [{ id: '1', name: 'offer', language: 'en', status: 'APPROVED' }, { id: '2', name: 'offer', language: 'hi', status: 'APPROVED' }] }],
    [/./, {}],
  ])
  const a = await buildAnalytics({ ...insightsEnv, DB: db }, { days: 7, now: new Date('2026-11-09T06:00:00Z'), fetcher })
  assert.deepEqual(a.templateInsights, { available: true })
  assert.equal(a.templates[0].linkTaps, 5)
  assert.deepEqual(a.templates[0].links, [{ label: 'Visit', count: 5 }])
  assert.equal(a.templates[0].cost, 1.5)
})

test('a campaign: exact quick-reply taps on its messages, and Meta link taps for its template', async () => {
  const db = campaignDb(campaignRow, {
    counts: { sent: 90 },
    taps: [{ label: 'Interested', n: 12, people: 11 }, { label: 'Stop', n: 2, people: 2 }],
  })
  const calls = []
  const fetcher = graph([
    [/template_analytics/, { data: [{ data_points: [{ template_id: '77', clicked: [{ type: 'url_button', button_content: 'Shop now', count: 30 }] }] }] }],
    [/message_templates/, { data: [{ id: '77', name: 'diwali', language: 'en' }, { id: '78', name: 'diwali', language: 'hi' }] }],
  ], calls)
  const r = await campaignPerformance({ ...insightsEnv, DB: db }, 7, { now: new Date('2026-11-09T06:00:00Z'), fetcher })
  assert.equal(r.taps.replyTotal, 14)
  assert.deepEqual(r.taps.replies[0], { label: 'Interested', count: 12, people: 11 })
  assert.equal(r.taps.linkTotal, 30)
  assert.deepEqual(r.taps.links, [{ label: 'Shop now', count: 30 }])
  assert.equal(new URL(calls.find((c) => c.includes('template_analytics'))).searchParams.get('template_ids'), '["77"]', 'only the language it was sent in')
  const tapRead = db.log.find((e) => /type = 'button'/.test(e.sql))
  assert.deepEqual(tapRead.args, [7, '2026-10-31', '2026-11-10'], 'bounded to the reply window')
  // Without Meta configured the page still answers, with the reason.
  const plain = await campaignPerformance({ DB: campaignDb(campaignRow) }, 7, { now: new Date('2026-11-09T06:00:00Z') })
  assert.equal(plain.taps.insights.available, false)
  assert.equal(plain.taps.links, null)
})
