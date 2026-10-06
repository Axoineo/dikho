import { logEvent, logError } from '../../utils/logger.js'

/**
 * Generic client for API Setu (https://apisetu.gov.in), the Government of
 * India's open API gateway. Knows about auth, timeouts and status mapping —
 * nothing about any individual API.
 *
 * Deliberately API-agnostic so the GSTN lookup is not the last thing built on
 * it: PAN verification, Udyam, DigiLocker issuers and the rest all authenticate
 * exactly the same way. Add a thin wrapper next to ./gstn.js per API rather
 * than re-implementing this.
 *
 * Auth is two headers, both mandatory:
 *   X-APISETU-CLIENTID   the organisation's client id ("in.dikho"). Not secret
 *                        — it is printed in the API Setu console sidebar — so
 *                        it lives as a plain var in wrangler.api.jsonc.
 *   X-APISETU-APIKEY     generated per subscription under Consume APIs > API
 *                        Keys, AFTER the publisher approves the subscription.
 *                        Secret. Worker secret only, never in the bundle:
 *                          npx wrangler secret put APISETU_API_KEY --name dikho-api
 *
 * The key is why this runs in the Worker at all: the browser must never hold
 * it, or anyone could drain the quota on our subscription.
 */

const BASE_URL = 'https://apisetu.gov.in'

// Bounded so a slow government endpoint cannot hold a Worker invocation open.
// These lookups sit in front of a user typing into a form, so the wait has to
// stay shorter than their patience, not just shorter than the platform limit.
const TIMEOUT_MS = 8_000

/**
 * Error thrown for anything API Setu says or does that the caller may want to
 * distinguish. `kind` is the decision-grade bit:
 *
 *   'not_found'   the identifier does not exist upstream (HTTP 404)
 *   'auth'        our client id / key is wrong, missing or unsubscribed
 *   'rate_limit'  API Setu is throttling us
 *   'upstream'    API Setu or the publisher returned an error
 *   'unreachable' network failure or timeout — no verdict was reached
 */
export class ApiSetuError extends Error {
  constructor(kind, message, status) {
    super(message)
    this.name = 'ApiSetuError'
    this.kind = kind
    this.status = status ?? null
  }
}

/**
 * GETs an API Setu path and returns the parsed JSON body.
 *
 * @param env   Worker env (reads APISETU_CLIENT_ID / APISETU_API_KEY)
 * @param path  path below the gateway root, e.g. '/gstn/v1/taxpayers/27AAA...'
 * @param label short event name for logs, e.g. 'gstn.taxpayer'
 * @throws ApiSetuError
 */
export async function apiSetuGet(env, path, label) {
  const clientId = env.APISETU_CLIENT_ID
  const apiKey = env.APISETU_API_KEY

  // Fail as a configuration error, not as "vendor not found". A dropped secret
  // after a deploy must look like a broken integration in the logs rather than
  // every GSTIN in the country quietly appearing not to exist.
  if (!clientId || !apiKey) {
    logEvent('apisetu.misconfigured', {
      label,
      has_client_id: Boolean(clientId),
      has_api_key: Boolean(apiKey),
    })
    throw new ApiSetuError('auth', 'GSTIN lookup is not configured on the server')
  }

  const headers = {
    'X-APISETU-CLIENTID': clientId,
    'X-APISETU-APIKEY': apiKey,
    Accept: 'application/json',
  }

  // API Setu's per-key "Whitelist Domain/Url" restriction is designed for keys
  // used from browser JS: it matches the caller against Origin/Referer, neither
  // of which a Worker's server-to-server fetch sends on its own. Declaring our
  // own origin explicitly is what lets a domain-restricted key work here at
  // all. Truthful, not a spoof — this is the host making the request.
  //
  // Unset when APISETU_REFERER is empty, so an unrestricted key sends nothing.
  if (env.APISETU_REFERER) headers.Referer = env.APISETU_REFERER

  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    logError(`apisetu.${label}.unreachable`, err)
    throw new ApiSetuError('unreachable', 'Could not reach the GST directory')
  }

  if (res.status === 404) {
    throw new ApiSetuError('not_found', 'No record found', 404)
  }

  if (res.status === 401 || res.status === 403) {
    // Also what an unapproved or expired subscription looks like, which is the
    // likeliest cause the first time this runs against a new API.
    const detail = await res.text().catch(() => '')
    logEvent('apisetu.unauthorized', { label, status: res.status, upstream_error: detail.slice(0, 200) })
    throw new ApiSetuError('auth', 'GSTIN lookup is not authorised on the server', res.status)
  }

  if (res.status === 429) {
    logEvent('apisetu.throttled', { label })
    throw new ApiSetuError('rate_limit', 'GST directory is busy. Please try again shortly.', 429)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    logEvent('apisetu.upstream_error', { label, status: res.status, upstream_error: detail.slice(0, 200) })
    throw new ApiSetuError('upstream', 'GST directory could not answer right now', res.status)
  }

  try {
    return await res.json()
  } catch (err) {
    logError(`apisetu.${label}.unparseable`, err)
    throw new ApiSetuError('upstream', 'GST directory returned an unreadable response', res.status)
  }
}
