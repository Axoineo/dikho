import { HTTPException } from 'hono/http-exception'
import { logError } from '../utils/logger.js'

// Server side of User Management. Two privileged surfaces, both reached only
// with the SERVICE-ROLE key, which never leaves this Worker:
//
//   - the um_* database functions (supabase/migrations/20261006150000_user_management.sql),
//     which hold every authorization rule and write the audit log in the same
//     transaction as the change. The Worker passes the actor it verified in
//     requireAuth; the functions re-check that actor against the database.
//   - Supabase Auth's admin API, for what only Auth can do: create a sign-in
//     account and ban or unban one.
//
// Plain fetch, consistent with the rest of the Worker (no supabase-js).
const TIMEOUT_MS = 10_000

function serviceHeaders(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HTTPException(500, { message: 'User management is not configured on the server' })
  }
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

/** Audit context for a request: where it came from, never what it carried. */
export function requestContext(c) {
  return {
    ip: c.req.header('CF-Connecting-IP') ?? null,
    user_agent: (c.req.header('User-Agent') ?? '').slice(0, 300),
  }
}

// Calls a um_* function. Their messages are written for the person at the
// dashboard and carry the HTTP status in PostgREST's PTxxx code, so they are
// passed through as they are. Any other database error is logged and becomes
// a generic failure, because it may quote submitted values.
export async function callUserRpc(c, fn, args) {
  let res
  try {
    res = await fetch(`${c.env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: serviceHeaders(c.env),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    logError(`users.${fn}.unreachable`, err)
    throw new HTTPException(503, { message: 'Could not reach the database. Please try again.' })
  }

  const text = await res.text()
  if (res.ok) {
    try {
      return text ? JSON.parse(text) : null
    } catch {
      return null
    }
  }

  let body = null
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  const code = typeof body?.code === 'string' ? body.code : ''
  if (/^PT\d{3}$/.test(code) && typeof body.message === 'string') {
    const err = new HTTPException(Number(code.slice(2)), { message: body.message.slice(0, 300) })
    err.fromRule = true
    throw err
  }
  logError(`users.${fn}.failed`, `${res.status} ${code} ${String(body?.message ?? text).slice(0, 200)}`)
  throw new HTTPException(res.status === 409 ? 409 : 500, {
    message: res.status === 409 ? 'That conflicts with an existing record.' : 'The change could not be saved. Please try again.',
  })
}

// Records a refused user-management request. It cannot be written inside the
// refused call (the refusal rolls that transaction back), so it is a second,
// best-effort call that never changes the response.
export async function logDenied(c, action, targetId, message) {
  try {
    await callUserRpc(c, 'um_log_denied', {
      p_actor: c.get('user')?.id ?? null,
      p_target: targetId ?? null,
      p_action: action,
      p_message: message,
      p_ctx: requestContext(c),
    })
  } catch (err) {
    logError('users.log_denied.failed', err)
  }
}

async function authAdmin(env, method, path, body) {
  let res
  try {
    res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin${path}`, {
      method,
      headers: serviceHeaders(env),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    logError('users.auth_admin.unreachable', err)
    throw new HTTPException(503, { message: 'Could not reach the sign-in service. Please try again.' })
  }
  const data = await res.json().catch(() => null)
  return { status: res.status, ok: res.ok, data }
}

// Creates a confirmed sign-in account with no password. The person signs in
// with the usual email or WhatsApp code; there is no invitation token to leak.
export async function createAuthAccount(env, { email, phone, fullName }) {
  const res = await authAdmin(env, 'POST', '/users', {
    email: email || undefined,
    phone: phone || undefined,
    email_confirm: Boolean(email),
    phone_confirm: Boolean(phone),
    user_metadata: { full_name: fullName },
  })
  if (res.ok && res.data?.id) return res.data.id
  if (res.status === 422 || res.status === 409) {
    throw new HTTPException(409, { message: 'That email or phone number already belongs to another account.' })
  }
  logError('users.auth_admin.create_failed', `${res.status} ${res.data?.error_code ?? ''}`)
  throw new HTTPException(502, { message: 'The sign-in account could not be created. Please try again.' })
}

/** Undo for a create that failed after the account was made. Best effort. */
export async function deleteAuthAccount(env, userId) {
  const res = await authAdmin(env, 'DELETE', `/users/${userId}`)
  if (!res.ok) logError('users.auth_admin.delete_failed', `${res.status}`)
}

// A ban stops new sign-ins and token refreshes in Supabase Auth itself. The
// database already refuses a suspended person; this closes the door in front
// of it too. Roughly a century, i.e. until an administrator reactivates them.
export async function setSignInBlocked(env, userId, blocked) {
  const res = await authAdmin(env, 'PUT', `/users/${userId}`, { ban_duration: blocked ? '876000h' : 'none' })
  if (!res.ok) {
    logError('users.auth_admin.ban_failed', `${res.status}`)
    return false
  }
  return true
}

// Tells an open dashboard, over the person's private Realtime channel, that
// their session was ended, so it signs out at once instead of on its next
// request. Best effort: the database already refuses the session.
export async function notifySignedOut(env, userId, { reason, sessionId = null }) {
  await notifyStaff(env, [{ userId, event: 'signed_out', payload: { reason, session_id: sessionId } }], 'users.notify_signed_out')
}

// Sends events to people's private `staff:<user id>` channels in ONE request
// (the Free plan allows 50 outbound requests per call). Only that person may
// listen on their channel and only the service role may publish to it
// (Realtime policies in the user-management and live-assist migrations).
// Best effort: a notice that does not arrive never changes what the database
// already decided.
export async function notifyStaff(env, notices, label = 'staff.notify') {
  const messages = notices
    .filter((n) => typeof n.userId === 'string' && n.userId)
    .slice(0, 30)
    .map((n) => ({ topic: `staff:${n.userId}`, event: n.event, payload: n.payload ?? {}, private: true }))
  if (messages.length === 0) return
  try {
    const res = await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: serviceHeaders(env),
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) logError(`${label}.failed`, `HTTP ${res.status}`)
  } catch (err) {
    logError(`${label}.failed`, err)
  }
}
