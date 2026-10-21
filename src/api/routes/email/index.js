import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireAuth } from '../../middleware/requireAuth.js'
import { readBoundedBytes } from '../../utils/body.js'
import { callUserRpc, requestContext } from '../../services/userAdmin.js'
import { emailHubEnabled, gmailConfigured, settingsUrl } from '../../services/email/config.js'
import { sha256Hex, encryptToken } from '../../services/email/crypto.js'
import { exchangeCode, revokeToken, rememberAccessToken } from '../../services/email/google.js'
import { verifyPushToken } from '../../services/email/googleJwt.js'
import { syncMailbox, inBackground } from '../../services/email/sync.js'
import { logError, logEvent } from '../../utils/logger.js'
import accounts from './accounts.js'
import threads from './threads.js'
import compose from './compose.js'

// /api/email — the Email Hub (docs/decisions/0009-email-hub.md).
//
// Off unless EMAIL_HUB_ENABLED=true: every route, public ones included,
// answers 404 so a half-configured module is invisible.
//
// Route classes:
//   provider callbacks (no session; each authenticates itself):
//     GET  /oauth/google/callback   one-time OAuth state + PKCE
//     POST /webhooks/google-pubsub  Google-signed OIDC token
//   everything else: requireAuth (live session, active staff), then the
//   em_* functions decide permission and mailbox membership.
const email = new Hono()

email.use('*', async (c, next) => {
  if (!emailHubEnabled(c.env)) throw new HTTPException(404, { message: 'Not found' })
  await next()
})

// ── Google sends the browser back here after consent ─────────────────────────
// The browser arrives by redirect, so there is no bearer token: the state
// (random, hashed in the database, bound to the person who started, one use,
// ten minutes) is what authenticates the request. Whatever happens, the
// browser is sent to the Email settings page with a fixed outcome code; no
// provider text, token or address appears in the URL.
const OUTCOMES = new Set([
  'connected', 'invalid', 'expired', 'cancelled', 'google_error', 'google_unreachable', 'exchange_failed',
  'scope_missing', 'no_refresh_token', 'identity_invalid', 'wrong_domain', 'conflict', 'forbidden', 'failed', 'not_configured',
])

function finishConnect(c, outcome) {
  const code = OUTCOMES.has(outcome) ? outcome : 'failed'
  c.header('Cache-Control', 'no-store')
  const url = settingsUrl(c.env, { connect: code })
  if (url) return c.redirect(url, 303)
  return c.html(`<!doctype html><meta charset="utf-8"><title>Dikho</title><p>${code === 'connected'
    ? 'Mailbox connected. You can close this tab and return to Dikho.'
    : 'The mailbox was not connected. Return to Dikho and try again.'}</p>`, code === 'connected' ? 200 : 400)
}

email.get('/oauth/google/callback', async (c) => {
  if (!(await gmailConfigured(c.env))) return finishConnect(c, 'not_configured')
  const { state, code, error } = c.req.query()
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(state)) return finishConnect(c, 'invalid')

  // Consumed before anything else, so a state is good for exactly one try,
  // whether Google said yes or no.
  let taken
  try {
    taken = await callUserRpc(c, 'em_take_state', { p_state_hash: await sha256Hex(state) })
  } catch (err) {
    logError('email.oauth.state_failed', err)
    return finishConnect(c, 'failed')
  }
  if (!taken) return finishConnect(c, 'expired')
  if (error) return finishConnect(c, error === 'access_denied' ? 'cancelled' : 'google_error')
  if (typeof code !== 'string' || code.length < 10 || code.length > 2048) return finishConnect(c, 'invalid')

  let grant
  try {
    grant = await exchangeCode(c.env, { code, verifier: taken.code_verifier })
  } catch (err) {
    return finishConnect(c, err.code ?? 'exchange_failed')
  }

  try {
    const account = await callUserRpc(c, 'em_store_connection', {
      p_actor: taken.user_id,
      p_account: taken.account_id ?? null,
      p_email: grant.email,
      p_subject: grant.subject,
      p_display_name: grant.name,
      p_token_enc: await encryptToken(c.env, grant.refreshToken, grant.email),
      p_scopes: grant.scopes,
      p_ctx: requestContext(c),
    })
    rememberAccessToken(account.id, grant.accessToken, grant.expiresIn)
    logEvent('email.oauth.connected', { kind: account.kind })
    inBackground(c, syncMailbox(c.env, account.id))
    return finishConnect(c, 'connected')
  } catch (err) {
    // Refused (wrong address, someone else's mailbox, no longer allowed):
    // the grant Google just issued is revoked rather than left alive.
    inBackground(c, revokeToken(grant.refreshToken))
    if (!err.fromRule) logError('email.oauth.store_failed', err)
    return finishConnect(c, err.status === 409 ? 'conflict' : err.status === 403 ? 'forbidden' : 'failed')
  }
})

// ── Gmail push (Cloud Pub/Sub) ───────────────────────────────────────────────
// Authenticated by the OIDC token Google signs for the push subscription.
// Acknowledged quickly (any 2xx); the sync runs after the response. Duplicate
// and stale pushes do nothing: em_push_target only answers for history the
// mailbox has not seen, and the sync lease stops parallel runs.
email.post('/webhooks/google-pubsub', async (c) => {
  const claims = await verifyPushToken(c.env, c.req.header('Authorization'))
  if (!claims) {
    logEvent('email.push.rejected', { reason: 'token' })
    return c.json({ success: false }, 401)
  }
  const bytes = await readBoundedBytes(c, 64 * 1024)
  let notice = null
  try {
    const envelope = JSON.parse(new TextDecoder().decode(bytes))
    const data = envelope?.message?.data
    if (typeof data === 'string' && data.length <= 4096) notice = JSON.parse(atob(data))
  } catch { /* malformed: acknowledged and ignored, Pub/Sub would only resend it */ }

  const address = typeof notice?.emailAddress === 'string' ? notice.emailAddress.slice(0, 254) : null
  const historyId = notice?.historyId !== undefined ? String(notice.historyId) : null
  if (address && historyId && /^[0-9]{1,20}$/.test(historyId)) {
    try {
      const target = await callUserRpc(c, 'em_push_target', { p_email: address, p_history_id: historyId })
      if (target) inBackground(c, syncMailbox(c.env, target))
    } catch (err) {
      // Not acknowledging lets Pub/Sub retry later.
      logError('email.push.lookup_failed', err)
      return c.json({ success: false }, 503)
    }
  }
  return c.body(null, 204)
})

// ── Staff routes ─────────────────────────────────────────────────────────────
email.use('*', requireAuth)
email.route('/', accounts)
email.route('/', threads)
email.route('/', compose)

export default email
