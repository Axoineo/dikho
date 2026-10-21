import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '../../middleware/requireAuth.js'
import { ok } from '../../utils/response.js'
import { readBoundedJson, readJsonOr } from '../../utils/body.js'
import { gmailConfigured, pushConfigured, workspaceDomain } from '../../services/email/config.js'
import { randomToken, sha256Hex, pkceChallenge, decryptToken, encryptToken } from '../../services/email/crypto.js'
import { authorizationUrl, exchangeCode, gmail, revokeToken, forgetAccessToken, rememberAccessToken } from '../../services/email/google.js'
import { syncMailbox, stopWatch, maybeSyncForUser, inBackground } from '../../services/email/sync.js'
import { sanitizeHtml } from '../../services/email/sanitizeHtml.js'
import { deliveryStatus } from '../../services/email/delivery.js'
import { logError, logEvent } from '../../utils/logger.js'
import { callUserRpc } from '../../services/userAdmin.js'
import { actor, rpc, uuidParam, requestContext, withGmail, publicAccount, noStore } from './shared.js'

// Mailboxes, their members, and connecting them to Google. Mounted behind
// requireAuth. The em_* functions decide who may do what; these routes bound
// input and talk to Google.
const accounts = new Hono()
const MAX_BODY = 8 * 1024

// What is set up on this server, as yes/no. Never a value or an identifier.
accounts.get('/status', async (c) => {
  return ok(c, {
    gmail: { configured: await gmailConfigured(c.env), push: pushConfigured(c.env), workspace_domain: workspaceDomain(c.env) },
    delivery: deliveryStatus(c.env),
  })
})

accounts.get('/accounts', async (c) => {
  const data = await rpc(c, 'em_list_accounts', { p_actor: actor(c) })
  // Keeps this person's mailboxes fresh without a scheduler (see sync.js).
  if (data?.mailboxes?.length) maybeSyncForUser(c, actor(c))
  return ok(c, data)
})

accounts.post('/accounts/shared', requirePermission('email_mailboxes.manage'), async (c) => {
  const body = await readBoundedJson(c, MAX_BODY)
  const email = typeof body?.email_address === 'string' ? body.email_address.trim() : ''
  const name = typeof body?.display_name === 'string' ? body.display_name.trim().slice(0, 120) : ''
  if (!email || email.length > 254) throw new HTTPException(400, { message: 'Enter the shared mailbox\'s address.' })
  return ok(c, await rpc(c, 'em_create_shared', { p_actor: actor(c), p_email: email, p_display_name: name || null, p_ctx: requestContext(c) },
    { action: 'email.mailbox_create' }), 201)
})

accounts.get('/accounts/:id/members', async (c) => {
  return ok(c, await rpc(c, 'em_list_members', { p_actor: actor(c), p_account: uuidParam(c) }))
})

async function setMember(c, role) {
  const id = uuidParam(c)
  const target = uuidParam(c, 'userId', 'user id')
  return ok(c, await rpc(c, 'em_set_member',
    { p_actor: actor(c), p_account: id, p_target: target, p_role: role, p_ctx: requestContext(c) },
    { action: 'email.mailbox_member', target }))
}

accounts.put('/accounts/:id/members/:userId', async (c) => {
  const body = await readBoundedJson(c, MAX_BODY)
  if (!['viewer', 'responder', 'manager', 'admin'].includes(body?.role)) {
    throw new HTTPException(400, { message: 'Choose viewer, responder, manager or admin.' })
  }
  return setMember(c, body.role)
})

accounts.delete('/accounts/:id/members/:userId', (c) => setMember(c, null))

accounts.get('/directory', async (c) => {
  return ok(c, await rpc(c, 'em_directory', { p_actor: actor(c) }))
})

// Composer autocomplete: only addresses this person could already see.
accounts.get('/recipients', async (c) => {
  const query = String(c.req.query('q') ?? '').slice(0, 80)
  noStore(c)
  return ok(c, query.trim().length < 2 ? [] : await rpc(c, 'em_suggest_recipients', { p_actor: actor(c), p_query: query }))
})

// ── Connecting to Google ─────────────────────────────────────────────────────
// Returns Google's consent URL. The state is random, stored only as a hash,
// bound to this person (and, for a shared mailbox, to that mailbox), good for
// ten minutes and for one use, and only this person can finish it (below).
// PKCE binds the code to this server's verifier.
accounts.post('/oauth/google/start', async (c) => {
  if (!(await gmailConfigured(c.env))) {
    throw new HTTPException(503, { message: 'Google sign-in is not set up for Dikho yet. Ask an administrator.' })
  }
  const body = await readJsonOr(c, MAX_BODY, {})
  const accountId = body?.account_id ?? null
  if (accountId !== null && (typeof accountId !== 'string' || !/^[0-9a-f-]{36}$/i.test(accountId))) {
    throw new HTTPException(400, { message: 'Invalid mailbox id' })
  }
  const state = randomToken(32)
  const verifier = randomToken(48)
  const started = await rpc(c, 'em_begin_connect', {
    p_actor: actor(c), p_account: accountId, p_state_hash: await sha256Hex(state), p_verifier: verifier, p_ctx: requestContext(c),
  }, { action: 'email.mailbox_connect' })
  noStore(c)
  return ok(c, { url: authorizationUrl(c.env, { state, challenge: await pkceChallenge(verifier), loginHint: started?.login_hint }) })
})

// Finishes a connection, from the dashboard page Google's return was handed
// to, with that person's session. The state must have been started by this
// same person (em_take_state refuses and audits anyone else before Google is
// asked for anything), so a consent link sent to a colleague connects nothing.
// Answers a fixed outcome code; no provider text, token or address.
const OUTCOMES = new Set([
  'connected', 'invalid', 'expired', 'cancelled', 'google_error', 'google_unreachable', 'exchange_failed', 'scope_missing',
  'no_refresh_token', 'identity_invalid', 'wrong_domain', 'conflict', 'forbidden', 'not_yours', 'failed', 'not_configured',
])
const outcome = (c, code) => { noStore(c); return ok(c, { outcome: OUTCOMES.has(code) ? code : 'failed' }) }

accounts.post('/oauth/google/complete', async (c) => {
  if (!(await gmailConfigured(c.env))) return outcome(c, 'not_configured')
  const body = await readBoundedJson(c, 4 * 1024)
  const { state, code, error } = body ?? {}
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(state)) return outcome(c, 'invalid')

  // Consumed before anything else, so a state is good for exactly one try,
  // whether Google said yes or no and whoever presents it.
  let taken
  try {
    taken = await callUserRpc(c, 'em_take_state', { p_state_hash: await sha256Hex(state), p_actor: actor(c) })
  } catch (err) {
    logError('email.oauth.state_failed', err)
    return outcome(c, 'failed')
  }
  if (!taken) return outcome(c, 'expired')
  if (taken.refused) {
    logEvent('email.oauth.refused', { reason: 'started_by_someone_else' })
    return outcome(c, 'not_yours')
  }
  if (error) return outcome(c, error === 'access_denied' ? 'cancelled' : 'google_error')
  if (typeof code !== 'string' || code.length < 10 || code.length > 2048) return outcome(c, 'invalid')

  let grant
  try {
    grant = await exchangeCode(c.env, { code, verifier: taken.code_verifier })
  } catch (err) {
    return outcome(c, err.code ?? 'exchange_failed')
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
    return outcome(c, 'connected')
  } catch (err) {
    // Refused (wrong address, someone else's mailbox, no longer allowed):
    // the grant Google just issued is revoked rather than left alive.
    inBackground(c, revokeToken(grant.refreshToken))
    if (!err.fromRule) logError('email.oauth.store_failed', err)
    return outcome(c, err.status === 409 ? 'conflict' : err.status === 403 ? 'forbidden' : 'failed')
  }
})

// Stops using a mailbox. The database forgets the grant first, so access ends
// even if Google cannot be reached; then Gmail push is stopped and the grant
// revoked at Google, in the background.
async function disconnect(c, remove) {
  const id = uuidParam(c)
  const result = await rpc(c, 'em_disconnect', { p_actor: actor(c), p_account: id, p_remove: remove, p_ctx: requestContext(c) },
    { action: remove ? 'email.mailbox_remove' : 'email.mailbox_disconnect' })
  forgetAccessToken(id)
  if (result?.token_enc) {
    inBackground(c, (async () => {
      const account = { id, email_address: result.email_address, token_enc: result.token_enc }
      try {
        await stopWatch(c.env, account)
        await revokeToken(await decryptToken(c.env, result.token_enc, result.email_address))
      } catch (err) {
        logError('email.disconnect.revoke_failed', err)
      } finally {
        forgetAccessToken(id)
      }
    })())
  }
  return ok(c, { disconnected: true, removed: remove })
}

accounts.post('/accounts/:id/disconnect', (c) => disconnect(c, false))
accounts.delete('/accounts/:id', (c) => disconnect(c, true))

accounts.post('/accounts/:id/sync', async (c) => {
  const id = uuidParam(c)
  const account = await rpc(c, 'em_access', { p_actor: actor(c), p_account: id, p_min_role: 'viewer' })
  if (account.status !== 'connected') throw new HTTPException(409, { message: 'This mailbox needs to be reconnected first.' })
  const result = await syncMailbox(c.env, id)
  return ok(c, { synced: Boolean(result.ok), busy: Boolean(result.skipped) })
})

// The mailbox's own labels (Gmail "user" labels), for filing conversations.
accounts.get('/accounts/:id/labels', async (c) => {
  const account = await rpc(c, 'em_access', { p_actor: actor(c), p_account: uuidParam(c), p_min_role: 'viewer' })
  const data = await withGmail(c, account, () => gmail(c.env, account, '/labels'))
  const labels = (data?.labels ?? [])
    .filter((l) => l?.type === 'user' && /^Label_[0-9]{1,20}$/.test(l.id ?? '') && typeof l.name === 'string')
    .map((l) => ({ id: l.id, name: l.name.slice(0, 100) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 200)
  return ok(c, { labels })
})

// Addresses this mailbox may send as (Gmail "Send mail as"), with signatures.
accounts.get('/accounts/:id/send-as', async (c) => {
  const account = await rpc(c, 'em_access', { p_actor: actor(c), p_account: uuidParam(c), p_min_role: 'responder' })
  const data = await withGmail(c, account, () => gmail(c.env, account, '/settings/sendAs'))
  const identities = (data?.sendAs ?? [])
    .filter((s) => typeof s?.sendAsEmail === 'string' && (s.isPrimary || s.verificationStatus === 'accepted'))
    .slice(0, 20)
    .map((s) => ({
      email: s.sendAsEmail.toLowerCase(),
      display_name: typeof s.displayName === 'string' ? s.displayName.slice(0, 120) : null,
      is_primary: Boolean(s.isPrimary),
      is_default: Boolean(s.isDefault),
      signature: s.signature ? sanitizeHtml(s.signature, { keepStyles: false, maxLength: 20_000 }).html : '',
    }))
  noStore(c)
  return ok(c, { account: publicAccount(account), identities })
})

export default accounts
