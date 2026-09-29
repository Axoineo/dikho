import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok } from '../../utils/response.js'
import { logEvent, logError } from '../../utils/logger.js'
import { fetchTaxpayer } from '../../services/apisetu/gstn.js'
import { ApiSetuError } from '../../services/apisetu/client.js'
import { isGstinChecksumValid, isGstinFormatValid, normalizeGstin } from '../../../lib/gstin.js'

/**
 * GSTIN → taxpayer lookup, backing the GSTIN autofill on the public vendor
 * form (src/features/public/PublicVendorForm.jsx).
 *
 * Mounted UNAUTHENTICATED in app.js, which is deliberate and needs two things
 * to be true:
 *
 *   1. The data is already public. GST taxpayer details are searchable by
 *      anyone on gst.gov.in without a login, so this exposes nothing that was
 *      not already open. The thing actually worth protecting is our API Setu
 *      quota and key, and the key never leaves the Worker.
 *   2. Abuse has to cost something. Four gates, cheapest first: the format
 *      check, the CHECK DIGIT (which alone rejects ~35 of every 36 made-up
 *      GSTINs for free), the per-IP rate limit, and the edge cache. Only a
 *      request that survives all four reaches consumeDailyBudget, and only
 *      then does it spend a subrequest.
 *
 *      The per-IP limit is the weakest of these and must not be relied on —
 *      see enforceRateLimit below for the measurements. The GLOBAL DAILY
 *      BUDGET is what actually bounds our exposure, because it is the only one
 *      that survives an attacker rotating IPs (trivial over IPv6) or spreading
 *      across Cloudflare locations.
 *
 * The internal vendor / client / SO / PO forms are meant to reuse this exact
 * route rather than get their own: a signed-in user hitting it is strictly less
 * risky than an anonymous one, and duplicating it would mean two places to fix.
 */
const gstn = new Hono()

// Requests per IP per minute. Generous for a human filling in one form (the
// frontend debounces and dedupes, so a normal signup spends exactly one call),
// tight enough that a script cannot walk the GSTIN space on our subscription.
const RATE_LIMIT_PERIOD_S = 60

// Cached at Cloudflare's edge: taxpayer records change on the order of years,
// and the same handful of GSTINs get retyped across a session.
//
// NOTE: the Cache API is a no-op on *.workers.dev, which is where this Worker
// currently runs — so today this neither helps nor hurts. It starts working the
// moment the API moves to a custom domain (as manage.dikho.in already has).
const CACHE_TTL_S = 86_400

/**
 * GET /:gstin — returns the normalized taxpayer.
 *
 * Success: { success: true, data: { taxpayer, cached } }
 * Failure: the standard error envelope. Every failure is non-fatal by design —
 * the form falls back to manual entry, so nothing here should be phrased as a
 * dead end.
 */
gstn.get('/:gstin', async (c) => {
  const gstin = normalizeGstin(c.req.param('gstin'))

  // Cheapest gate first: a malformed GSTIN can never exist upstream, so it is
  // rejected before it costs a rate-limit slot or a subrequest.
  if (!isGstinFormatValid(gstin)) {
    throw new HTTPException(400, { message: 'That does not look like a valid GSTIN.' })
  }

  // The check digit IS enforced, and this is the cheapest abuse control we
  // have. A GSTIN's last character is derived from the other fourteen, so a
  // made-up string passes only about 1 time in 36 — walking the GSTIN space to
  // drain our API Setu subscription therefore costs an attacker ~36x more
  // attempts for the same number of real lookups, and every rejection here is
  // pure local arithmetic: no rate-limit slot, no subrequest, no quota.
  //
  // This was previously left unenforced on the grounds that the frontend warns
  // and looks the GSTIN up anyway, so we would never refuse a valid one. That
  // traded a real control for a hypothetical risk: the algorithm is fixed and
  // well defined, and all five GSTINs confirmed real during this integration
  // pass our implementation. A false rejection would also be loud rather than
  // silent — it logs below, and the message tells the user to re-check.
  if (!isGstinChecksumValid(gstin)) {
    logEvent('gstn.checksum_rejected', { gstin })
    throw new HTTPException(400, {
      message: 'That GSTIN does not look right — please check it for a typo.',
    })
  }

  await enforceRateLimit(c)

  const cache = caches.default
  const cacheKey = new Request(new URL(`/api/gstn/${gstin}`, c.req.url).toString())

  const hit = await cache.match(cacheKey)
  if (hit) {
    const cachedBody = await hit.json().catch(() => null)
    if (cachedBody) return c.json(cachedBody)
  }

  // Charged only here, AFTER the cache miss, so the ceiling counts real
  // upstream calls rather than requests. Repeat lookups of the same GSTIN cost
  // nothing.
  await consumeDailyBudget(c)

  let taxpayer
  try {
    taxpayer = await fetchTaxpayer(c.env, gstin)
  } catch (err) {
    throw toHttpException(err, gstin)
  }

  // A GSTIN that resolves but carries no legal name is not useful to autofill
  // from, and is a strong sign the response shape drifted. Surface it as a
  // clean "not found" and log the shape so it can be diagnosed.
  if (!taxpayer.legalName && !taxpayer.tradeName) {
    // fetchTaxpayer has already logged `gstn.nameless_record` with the upstream
    // field names, which is the diagnostic that matters. Nothing to add here.
    logEvent('gstn.empty_record', { gstin })
    throw new HTTPException(404, { message: 'No details found for this GSTIN.' })
  }

  logEvent('gstn.lookup', { gstin, status: taxpayer.status, has_address: Boolean(taxpayer.address.street) })

  // Stored with `cached: true` so a later hit is distinguishable in the logs
  // and the client, while the response being returned right now says false.
  const cacheable = new Response(JSON.stringify({ success: true, data: { taxpayer, cached: true } }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_TTL_S}` },
  })
  c.executionCtx.waitUntil(cache.put(cacheKey, cacheable))

  return ok(c, { taxpayer, cached: false })
})

/**
 * Global ceiling on upstream lookups per UTC day — the one control that is not
 * defeated by rotating IPs or by Cloudflare's per-colo rate-limit counters,
 * because it bounds TOTAL calls regardless of who makes them or where they
 * land. See migrations/0007_gstn_lookup_budget.sql for why this lives in D1
 * when the per-IP limiter deliberately does not.
 *
 * Fails OPEN on a missing binding or an unset cap, and on any D1 error: the
 * cost of being wrong is a lookup of already-public data, whereas failing
 * closed would break vendor onboarding over a database hiccup. Contrast
 * services/turnstile.js, which guards a WRITE and so must fail closed.
 */
async function consumeDailyBudget(c) {
  const cap = Number(c.env.GSTN_DAILY_CAP)
  if (!c.env.DB || !Number.isFinite(cap) || cap <= 0) {
    logEvent('gstn.budget_disabled', { has_db: Boolean(c.env.DB), cap: c.env.GSTN_DAILY_CAP ?? null })
    return
  }

  const day = new Date().toISOString().slice(0, 10)

  let row
  try {
    // One statement, one row, one write — and no write at all once the ceiling
    // is reached, because the guard on DO UPDATE stops the row from changing.
    // That is what keeps this from being able to burn through D1's free-tier
    // write budget the way an uncapped counter could (see migration 0006).
    //
    // RETURNING is what reports the outcome: under the cap the UPDATE runs and
    // hands back the new total, at the cap it matches nothing and returns no
    // row at all. So a null here means "over budget", not "query failed" —
    // a genuine failure throws instead and is caught below.
    row = await c.env.DB.prepare(
      `INSERT INTO gstn_lookup_budget (day, lookups) VALUES (?1, 1)
         ON CONFLICT(day) DO UPDATE SET lookups = lookups + 1
           WHERE gstn_lookup_budget.lookups < ?2
       RETURNING lookups`,
    ).bind(day, cap).first()
  } catch (err) {
    logError('gstn.budget_unavailable', err)
    return
  }

  if (!row) {
    // Deliberately loud: this is the signal that either the form is being
    // abused or the cap is set too low for real traffic, and nothing else
    // reports it — API Setu shows us no usage counter.
    logEvent('gstn.daily_cap_reached', { day, cap })
    throw new HTTPException(503, {
      message: 'GSTIN lookup has reached its daily limit. Please fill the form in manually.',
    })
  }

  // Cheap early warning while there is still room to react.
  if (row.lookups === Math.floor(cap * 0.8)) {
    logEvent('gstn.budget_80pct', { day, cap, lookups: row.lookups })
  }
}

/**
 * Per-IP throttle using the Workers Rate Limiting binding (GSTIN_RATE_LIMITER
 * in wrangler.api.jsonc) — no storage, no D1 writes. An UNCAPPED per-IP counter
 * in D1 would trade one abuse problem for an outage: the free tier caps row
 * writes per day and the WhatsApp features depend on them (migration 0006
 * records a campaign dying that way). consumeDailyBudget above does use D1,
 * which is not a contradiction — being capped, it bounds its own write cost.
 *
 * Do not mistake this for a quota. Measured 2026-09-29: at 12/60s, 82 requests
 * from one IP with 56 in a single colo drew zero denials, because Cloudflare
 * counts per data centre and documents the binding as permissive and
 * eventually consistent. It brakes runaway loops; the daily budget is what
 * actually protects the subscription.
 *
 * Fails OPEN when the binding is absent (local `wrangler dev` without it) —
 * unlike the Turnstile check, which must fail closed. The worst case here is a
 * wasted lookup of already-public data, not an unauthenticated write.
 */
async function enforceRateLimit(c) {
  const limiter = c.env.GSTIN_RATE_LIMITER
  if (!limiter) {
    logEvent('gstn.rate_limiter_missing', {})
    return
  }

  // Set by Cloudflare's own edge, so it cannot be spoofed the way an
  // X-Forwarded-For header could. Falls back to a shared bucket rather than no
  // bucket when it is absent.
  const key = c.req.header('CF-Connecting-IP') || 'unknown'

  const { success } = await limiter.limit({ key })
  if (!success) {
    logEvent('gstn.rate_limited', {})
    // Cause only — useGstinLookup adds the manual-entry half of the sentence.
    throw new HTTPException(429, {
      message: `Too many GSTIN lookups — please wait ${RATE_LIMIT_PERIOD_S} seconds.`,
    })
  }
}

/**
 * ApiSetuError → the HTTP status and user-facing wording the form should show.
 *
 * These messages state the CAUSE only. The "you can still fill this in by
 * hand" half is added once by the caller (useGstinLookup), so saying it here
 * too produces a doubled sentence.
 *
 * Our own misconfiguration (missing key, unapproved subscription) deliberately
 * does NOT tell the visitor that anything is wrong on our side — they cannot
 * act on it, and it advertises a gap. They get the same generic outage wording;
 * the real cause is in the Worker logs.
 */
function toHttpException(err, gstin) {
  if (!(err instanceof ApiSetuError)) return err

  switch (err.kind) {
    case 'not_found':
      return new HTTPException(404, { message: 'No details found for this GSTIN.' })
    case 'rate_limit':
      return new HTTPException(503, { message: 'The GST directory is busy.' })
    case 'auth':
      logEvent('gstn.lookup_unavailable', { gstin, reason: err.kind })
      return new HTTPException(503, { message: 'GSTIN lookup is unavailable right now.' })
    default:
      return new HTTPException(503, { message: 'Could not reach the GST directory.' })
  }
}

export default gstn
