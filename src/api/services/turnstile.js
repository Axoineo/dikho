import { HTTPException } from 'hono/http-exception'
import { logEvent } from '../utils/logger.js'

// Server-side Cloudflare Turnstile verification for the unauthenticated public
// forms (src/features/public/*). The widget in the browser only produces a
// token — it proves nothing until this runs, which is why the public write
// routes call it before they touch Supabase.
//
// Widget: sitekey 0x4AAAAAAEnxgBvSPuBu7S85, "managed" mode. The matching secret
// lives only as a Worker secret (TURNSTILE_SECRET), never in the bundle:
//   npx wrangler turnstile widget get <sitekey> --json   # read it
//   npx wrangler secret put TURNSTILE_SECRET --name dikho-api
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

// Cloudflare documents tokens as at most 2048 characters. Rejecting longer
// input before the fetch keeps a bogus multi-megabyte body from costing us a
// subrequest — the Workers free plan caps those at 50 per invocation.
const MAX_TOKEN_LENGTH = 2048

// siteverify is a hard dependency of every public submit, so it gets a bounded
// wait rather than hanging until the Worker's own limit kills the request.
const TIMEOUT_MS = 10_000

// Turnstile tokens are single-use — a second siteverify call with the same
// token returns `timeout-or-duplicate`. The wording therefore tells the user to
// redo the check, and the forms reset their widget on any failed submit.
const FAILED_MESSAGE = 'Security check failed. Please complete it again and resubmit.'

// Used for anything that stopped us from reaching a verdict (network, timeout,
// a 5xx from Cloudflare) — as opposed to reaching one and not liking it.
const TRANSIENT_MESSAGE = 'Could not complete the security check. Please try again in a moment.'

/**
 * Verifies a Turnstile token and throws an HTTPException if it is not good.
 * Returns nothing on success — callers proceed only if this does not throw.
 *
 * @param c                Hono context (reads c.env and CF-Connecting-IP)
 * @param token            the widget's token, from `cf-turnstile-response`
 * @param expectedAction   the `action` the widget was rendered with, so a token
 *                         minted on one form cannot be replayed against another
 */
export async function verifyTurnstile(c, token, expectedAction) {
  const { TURNSTILE_SECRET, TURNSTILE_HOSTNAMES } = c.env

  const allowedHostnames = new Set(
    (TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean),
  )

  // Fail CLOSED on misconfiguration. If a deploy dropped the secret or the
  // hostname allowlist, the correct outcome is a broken form we notice — not a
  // silently unprotected public endpoint that writes to the database.
  if (!TURNSTILE_SECRET || allowedHostnames.size === 0) {
    logEvent('turnstile.misconfigured', {
      has_secret: Boolean(TURNSTILE_SECRET),
      hostname_count: allowedHostnames.size,
    })
    throw new HTTPException(500, { message: 'Security check is not configured on the server' })
  }

  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new HTTPException(403, { message: FAILED_MESSAGE })
  }

  const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token })

  // Set by Cloudflare's own edge on the way in, so it cannot be spoofed by the
  // caller the way an X-Forwarded-For header could.
  const remoteip = c.req.header('CF-Connecting-IP')
  if (remoteip) body.set('remoteip', remoteip)

  let res
  try {
    res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body,
    })
  } catch (err) {
    // Unreachable or slow siteverify also fails closed: better a retryable 503
    // than accepting an unverified write.
    logEvent('turnstile.unreachable', { error: String(err) })
    throw new HTTPException(503, { message: TRANSIENT_MESSAGE })
  }

  // A rejected token still comes back 200 with `success: false`, so a non-2xx
  // here means the REQUEST was wrong rather than the token — a malformed or
  // wrong secret answers 400, for instance. Those must not be reported as
  // retryable, or a misconfigured deploy looks like a passing blip forever.
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    logEvent('turnstile.siteverify_error', { status: res.status, body: detail.slice(0, 200) })
    if (res.status >= 400 && res.status < 500) {
      throw new HTTPException(500, { message: 'Security check is not configured correctly on the server' })
    }
    throw new HTTPException(503, { message: TRANSIENT_MESSAGE })
  }

  let result
  try {
    result = await res.json()
  } catch (err) {
    logEvent('turnstile.unparseable', { error: String(err) })
    throw new HTTPException(503, { message: TRANSIENT_MESSAGE })
  }

  // All three checks matter. `success` alone would accept a token solved
  // against our sitekey on an attacker's page (hostname), or one minted by the
  // other public form (action).
  const okSuccess = result.success === true
  const okAction = result.action === expectedAction
  const okHostname = allowedHostnames.has(result.hostname)

  if (!okSuccess || !okAction || !okHostname) {
    // Logged, not returned: the caller gets one generic message so a bot cannot
    // use our error text to work out which check it tripped. `wrangler tail`
    // has the detail when a real form breaks.
    logEvent('turnstile.rejected', {
      expected_action: expectedAction,
      action: result.action ?? null,
      hostname: result.hostname ?? null,
      codes: result['error-codes'] ?? [],
      failed: [
        !okSuccess && 'success',
        !okAction && 'action',
        !okHostname && 'hostname',
      ].filter(Boolean),
    })
    throw new HTTPException(403, { message: FAILED_MESSAGE })
  }
}
