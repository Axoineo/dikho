import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '../../middleware/requireAuth.js'
import { ok } from '../../utils/response.js'
import { readBoundedJson } from '../../utils/body.js'
import { normalisePhone } from '../../utils/phone.js'
import { logError } from '../../utils/logger.js'
import {
  callUserRpc, logDenied, requestContext, createAuthAccount, deleteAuthAccount,
  setSignInBlocked, notifySignedOut,
} from '../../services/userAdmin.js'
import { sendWelcome, welcomeChannelFor } from '../../services/staffWelcome.js'

// User Management API. Mounted behind requireAuth (app.js), so c.get('user')
// is a verified, active staff member with their current permissions.
//
// The route guards below are the coarse gate. The fine rules (who may change
// whom, which roles and permissions an actor may hand out, the last Owner)
// live in the um_* database functions and run atomically with each change and
// its audit entry; see supabase/migrations/20261006150000_user_management.sql.
const users = new Hono()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/
const MAX_BODY = 32 * 1024

const PROFILE_FIELDS = [
  'full_name', 'employee_id', 'designation', 'department_id', 'team_id', 'reporting_manager_id',
  'joining_date', 'system_role', 'developer_level', 'template_id',
]

function idParam(c) {
  const id = c.req.param('id')
  if (!UUID.test(id)) throw new HTTPException(400, { message: 'Invalid user id' })
  return id.toLowerCase()
}

// Keeps only known profile fields, each a short string or null. The database
// validates meaning (roles, departments, dates); this bounds shape and size.
function profileFrom(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HTTPException(400, { message: 'Expected a JSON object' })
  }
  const out = {}
  for (const key of PROFILE_FIELDS) {
    if (!(key in body)) continue
    const value = body[key]
    if (value === null || value === '') { out[key] = null; continue }
    if (typeof value !== 'string' || value.length > 200) {
      throw new HTTPException(400, { message: `${key} must be text of at most 200 characters` })
    }
    out[key] = value.trim()
  }
  return out
}

// Runs a rule-checked database call; a refusal by the rules is also written
// to the audit log, since attempts to go beyond one's access are worth seeing.
async function guarded(c, action, targetId, fn, args) {
  try {
    return await callUserRpc(c, fn, args)
  } catch (err) {
    if (err.fromRule && err.status === 403) await logDenied(c, action, targetId, err.message)
    throw err
  }
}

const actor = (c) => c.get('user').id

// The database is called with the service role, so it cannot tell which of a
// person's sessions is the one making this request; the verified token can.
function markCurrentSession(c, member) {
  const current = c.get('user')?.sessionId
  if (!member || !Array.isArray(member.sessions)) return member
  return { ...member, sessions: member.sessions.map((s) => ({ ...s, current: Boolean(current) && s.session_id === current })) }
}

// ── Reads ──────────────────────────────────────────────────────────────────
users.get('/', requirePermission('users.view'), async (c) => {
  return ok(c, await callUserRpc(c, 'um_list_members', { p_actor: actor(c) }))
})

users.get('/catalog', requirePermission('users.view'), async (c) => {
  return ok(c, await callUserRpc(c, 'um_catalog', { p_actor: actor(c) }))
})

users.get('/audit', requirePermission('audit_logs.view'), async (c) => {
  const target = c.req.query('user')
  const before = c.req.query('before')
  if (target && !UUID.test(target)) throw new HTTPException(400, { message: 'Invalid user id' })
  if (before && !/^\d{1,18}$/.test(before)) throw new HTTPException(400, { message: 'Invalid cursor' })
  return ok(c, await callUserRpc(c, 'um_list_audit', {
    p_actor: actor(c), p_target: target || null, p_before: before ? Number(before) : null, p_limit: 50,
  }))
})

// Your own profile and sessions need no users.* permission.
users.get('/me', async (c) => {
  return ok(c, markCurrentSession(c, await callUserRpc(c, 'um_get_member', { p_actor: actor(c), p_target: actor(c) })))
})

users.get('/:id', async (c) => {
  const id = idParam(c)
  return ok(c, markCurrentSession(c, await callUserRpc(c, 'um_get_member', { p_actor: actor(c), p_target: id })))
})

// ── Add someone ────────────────────────────────────────────────────────────
// Validates everything first (um_check_create), then creates or reuses the
// sign-in account, then the staff record. If the staff record is refused after
// a NEW account was created, that account is deleted again so nothing is left
// half-made. An existing account without a staff record is reused, never
// duplicated; one that already has a record is a conflict.
users.post('/', requirePermission('users.create'), async (c) => {
  const body = await readBoundedJson(c, MAX_BODY)
  const profile = profileFrom(body)
  if (!profile.full_name) throw new HTTPException(400, { message: 'Enter a name.' })

  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null
  const phone = typeof body.phone === 'string' && body.phone.trim() ? normalisePhone(body.phone) : null
  if (email && (email.length > 254 || !EMAIL.test(email))) throw new HTTPException(400, { message: 'Enter a valid email address.' })
  if (typeof body.phone === 'string' && body.phone.trim() && !phone) throw new HTTPException(400, { message: 'Enter a valid phone number.' })
  if (!email && !phone) throw new HTTPException(400, { message: 'Enter an email address or a WhatsApp number so they can sign in.' })

  await guarded(c, 'users.create', null, 'um_check_create', { p_actor: actor(c), p_profile: profile })

  const existing = await callUserRpc(c, 'um_find_account', { p_email: email, p_phone: phone })
  if (existing?.is_staff) {
    throw new HTTPException(409, { message: 'This person is already a user of the workspace.' })
  }
  // An account with a password was not made here (ours are passwordless), so
  // it may belong to whoever signed up with this address. Refuse to hand it
  // staff access; an Owner removes it in Supabase Auth first.
  if (existing?.has_password) {
    throw new HTTPException(409, {
      message: 'This email or number belongs to an account that was not created in Dikho. Ask an Owner to remove that account in Supabase Authentication, then add the person again.',
    })
  }

  let userId = existing?.user_id ?? null
  const createdAccount = !userId
  if (createdAccount) userId = await createAuthAccount(c.env, { email, phone, fullName: profile.full_name })

  let member
  try {
    member = await guarded(c, 'users.create', userId, 'um_create_member', {
      p_actor: actor(c), p_user: userId, p_profile: profile, p_ctx: requestContext(c),
    })
  } catch (err) {
    if (createdAccount) await deleteAuthAccount(c.env, userId)
    throw err
  }

  const welcome = body.send_welcome === false
    ? { sent: false, reason: 'not requested' }
    : await deliverWelcome(c, userId, { email, phone, fullName: profile.full_name })

  return ok(c, { user: member, welcome, reused_account: !createdAccount }, 201)
})

async function deliverWelcome(c, userId, person) {
  const channel = welcomeChannelFor(c.env, person)
  if (!channel) return { sent: false, reason: 'No email or WhatsApp welcome message is configured.' }

  try {
    await callUserRpc(c, 'um_claim_welcome', { p_actor: actor(c), p_target: userId, p_channel: channel, p_ctx: requestContext(c) })
  } catch (err) {
    return { sent: false, reason: err.message }
  }
  const result = await sendWelcome(c.env, channel, person)
  if (result.ok) return { sent: true, channel }

  try {
    await callUserRpc(c, 'um_welcome_failed', {
      p_actor: actor(c), p_target: userId, p_channel: channel, p_reason: result.reason, p_ctx: requestContext(c),
    })
  } catch (err) {
    logError('users.welcome.record_failed', err)
  }
  return { sent: false, channel, reason: 'The message could not be delivered.' }
}

users.post('/:id/welcome', requirePermission('users.create'), async (c) => {
  const id = idParam(c)
  const member = await callUserRpc(c, 'um_get_member', { p_actor: actor(c), p_target: id })
  const phone = member.phone ? normalisePhone(member.phone) : null
  return ok(c, await deliverWelcome(c, id, { email: member.email, phone, fullName: member.full_name }))
})

// ── Change someone ─────────────────────────────────────────────────────────
users.patch('/:id', requirePermission('users.edit'), async (c) => {
  const id = idParam(c)
  const patch = profileFrom(await readBoundedJson(c, MAX_BODY))
  if (Object.keys(patch).length === 0) throw new HTTPException(400, { message: 'Nothing to change.' })
  return ok(c, await guarded(c, 'users.edit', id, 'um_update_member', {
    p_actor: actor(c), p_target: id, p_patch: patch, p_ctx: requestContext(c),
  }))
})

users.put('/:id/permissions', requirePermission('users.permissions'), async (c) => {
  const id = idParam(c)
  const body = await readBoundedJson(c, MAX_BODY)
  const overrides = body?.overrides
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new HTTPException(400, { message: 'overrides must be an object' })
  }
  return ok(c, await guarded(c, 'users.permissions', id, 'um_set_overrides', {
    p_actor: actor(c), p_target: id, p_overrides: overrides, p_ctx: requestContext(c),
  }))
})

// Suspend / reactivate / archive. The database change ends every session and
// refuses the person at once; the Auth ban then stops them signing in again.
users.post('/:id/status', requirePermission('users.suspend'), async (c) => {
  const id = idParam(c)
  const body = await readBoundedJson(c, MAX_BODY)
  const status = body?.status
  if (!['active', 'suspended', 'archived'].includes(status)) {
    throw new HTTPException(400, { message: 'status must be active, suspended or archived' })
  }
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null

  const member = await guarded(c, 'users.suspend', id, 'um_set_status', {
    p_actor: actor(c), p_target: id, p_status: status, p_reason: reason, p_ctx: requestContext(c),
  })
  const signInBlocked = await setSignInBlocked(c.env, id, status !== 'active')
  if (status !== 'active') await notifySignedOut(c.env, id, { reason: status })
  return ok(c, { user: member, sign_in_updated: signInBlocked })
})

// Force sign-out: every session, or one (session_id), which you may also do
// to your own other devices.
users.post('/:id/sign-out', async (c) => {
  const id = idParam(c)
  const body = await readBoundedJson(c, MAX_BODY)
  const sessionId = body?.session_id ?? null
  if (sessionId !== null && (typeof sessionId !== 'string' || !UUID.test(sessionId))) {
    throw new HTTPException(400, { message: 'Invalid session id' })
  }
  const ended = await guarded(c, 'users.sessions', id, 'um_revoke_sessions', {
    p_actor: actor(c), p_target: id, p_session: sessionId, p_ctx: requestContext(c),
  })
  await notifySignedOut(c.env, id, { reason: 'forced', sessionId })
  return ok(c, { sessions_ended: ended })
})

// ── Templates, departments and teams ───────────────────────────────────────
users.post('/templates', requirePermission('templates.manage'), async (c) => {
  const body = await readBoundedJson(c, MAX_BODY)
  return ok(c, await guarded(c, 'templates.manage', null, 'um_save_template', {
    p_actor: actor(c), p_template: body, p_ctx: requestContext(c),
  }))
})

users.delete('/templates/:id', requirePermission('templates.manage'), async (c) => {
  const id = idParam(c)
  return ok(c, await guarded(c, 'templates.manage', null, 'um_delete_template', {
    p_actor: actor(c), p_template: id, p_ctx: requestContext(c),
  }))
})

users.post('/org-units', requirePermission('departments.manage'), async (c) => {
  const body = await readBoundedJson(c, MAX_BODY)
  return ok(c, await guarded(c, 'departments.manage', null, 'um_save_org_unit', {
    p_actor: actor(c), p_unit: body, p_ctx: requestContext(c),
  }))
})

export default users
