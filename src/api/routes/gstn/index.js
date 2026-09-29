import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok } from '../../utils/response.js'
import { logEvent } from '../../utils/logger.js'
import { fetchTaxpayer } from '../../services/apisetu/gstn.js'
import { ApiSetuError } from '../../services/apisetu/client.js'
import { isGstinFormatValid, normalizeGstin } from '../../../lib/gstin.js'

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
 *   2. Abuse has to cost something. Hence the format gate and the per-IP rate
 *      limit below, before any subrequest is spent.
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
  //
  // Only the SHAPE is checked. The check digit is not enforced here on purpose
  // (see gstinCheckDigit in src/lib/gstin.js) — the frontend warns about it and
  // looks the GSTIN up anyway, so a valid GSTIN is never refused by us.
  if (!isGstinFormatValid(gstin)) {
    throw new HTTPException(400, { message: 'That does not look like a valid GSTIN.' })
  }

  await enforceRateLimit(c)

  const cache = caches.default
  const cacheKey = new Request(new URL(`/api/gstn/${gstin}`, c.req.url).toString())

  const hit = await cache.match(cacheKey)
  if (hit) {
    const cachedBody = await hit.json().catch(() => null)
    if (cachedBody) return c.json(cachedBody)
  }

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
 * Per-IP throttle using the Workers Rate Limiting binding (GSTIN_RATE_LIMITER
 * in wrangler.api.jsonc) — no storage, no D1 writes. That matters: D1 on the
 * free plan caps row writes per day and the WhatsApp features depend on them,
 * so a rate limiter backed by D1 would trade one abuse problem for an outage.
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
