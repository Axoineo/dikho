import { HTTPException } from 'hono/http-exception'
import { callUserRpc, logDenied, requestContext } from '../../services/userAdmin.js'
import { GmailError, GmailUncertainError, GoogleAuthError } from '../../services/email/google.js'
import { TokenKeyError } from '../../services/email/crypto.js'
import { logError } from '../../utils/logger.js'

// Helpers shared by the Email Hub routes.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const GMAIL_ID = /^[0-9a-f]{1,32}$/
export const ATTACHMENT_ID = /^[A-Za-z0-9_-]{1,1024}$/
export const DRAFT_ID = /^r-?[0-9]{1,24}$/

export const actor = (c) => c.get('user').id
export { requestContext }

export function uuidParam(c, name = 'id', label = 'id') {
  const value = c.req.param(name)
  if (!UUID.test(value ?? '')) throw new HTTPException(400, { message: `Invalid ${label}` })
  return value.toLowerCase()
}

export function patternParam(c, name, pattern, label) {
  const value = c.req.param(name)
  if (!pattern.test(value ?? '')) throw new HTTPException(400, { message: `Invalid ${label}` })
  return value
}

/** em_* call; a refusal by the rules is also written to the audit log. */
export async function rpc(c, fn, args, audit) {
  try {
    return await callUserRpc(c, fn, args)
  } catch (err) {
    if (audit && err.fromRule && err.status === 403) await logDenied(c, audit.action, audit.target ?? null, err.message)
    throw err
  }
}

/** What the browser may see of a mailbox: never the token or the cursor. */
export function publicAccount(account) {
  if (!account) return null
  const { token_enc: _token, history_id: _history, ...rest } = account
  return rest
}

export function noStore(c) {
  c.header('Cache-Control', 'no-store')
  c.header('Pragma', 'no-cache')
}

/**
 * Runs Gmail work for a mailbox and turns provider failures into answers the
 * person can act on. A grant Google refuses marks the mailbox "reconnect".
 */
export async function withGmail(c, account, fn) {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      try {
        await callUserRpc(c, 'em_mark_account', {
          p_account: account.id, p_state: 'reauth_required',
          p_error: 'Google no longer accepts Dikho\'s access to this mailbox. Reconnect it.',
        })
      } catch (inner) {
        logError('email.mark_reauth_failed', inner)
      }
      throw new HTTPException(409, { message: 'This mailbox needs to be reconnected to Google before it can be used.' })
    }
    if (err instanceof TokenKeyError) {
      logError('email.token_key', err.message)
      throw new HTTPException(500, { message: 'This mailbox\'s stored sign-in cannot be read. An administrator needs to check the server configuration.' })
    }
    if (err instanceof GmailUncertainError) throw err
    if (err instanceof GmailError) throw new HTTPException(err.status === 404 ? 404 : err.status === 429 ? 429 : 502, { message: err.message })
    throw err
  }
}
