import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '../../middleware/requireAuth.js'
import { ok } from '../../utils/response.js'
import { readBoundedJson } from '../../utils/body.js'
import { callUserRpc, logDenied, notifyStaff, requestContext } from '../../services/userAdmin.js'

// Live Assist: with an employee's OK, a helper watches their Dikho tab and
// points at things. Mounted behind requireAuth (app.js).
//
// The video, chat and pinned notes never touch this Worker or the database:
// they go browser to browser (WebRTC), set up over a private Realtime channel
// that only the two participants may use. This route records who helps whom
// and tells each side's dashboard what happened, over their private
// `staff:<id>` channels. Every rule (who may help whom, one session per
// person, time limits, rate limits) is enforced by the la_* functions in
// supabase/migrations/20261007114458_live_assist.sql and
// 20261008040426_live_assist_peer_help.sql.
const assist = new Hono()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SECTION = /^[a-z][a-z0-9-]{0,39}$/
const MAX_BODY = 4 * 1024

const actor = (c) => c.get('user').id

function uuidOrNull(value, label) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !UUID.test(value)) throw new HTTPException(400, { message: `Invalid ${label}` })
  return value.toLowerCase()
}

function idParam(c) {
  return uuidOrNull(c.req.param('id'), 'id')
}

async function guarded(c, action, targetId, fn, args) {
  try {
    return await callUserRpc(c, fn, args)
  } catch (err) {
    if (err.fromRule && err.status === 403) await logDenied(c, action, targetId, err.message)
    throw err
  }
}

const sessionNotice = (session) => ({
  id: session.id,
  status: session.status,
  helper_id: session.helper_id,
  helper_name: session.helper_name,
  employee_id: session.employee_id,
  employee_name: session.employee_name,
  expires_at: session.expires_at,
  end_reason: session.end_reason,
  from_help_request: Boolean(session.help_request_id),
})

// Everything a dashboard needs when it loads (an unanswered request, a live
// session, open help requests). Any staff member: it only covers themselves.
assist.get('/state', async (c) => {
  return ok(c, await callUserRpc(c, 'la_state', { p_actor: actor(c) }))
})

assist.post('/sessions', requirePermission('live_assist.use'), async (c) => {
  const body = await readBoundedJson(c, MAX_BODY)
  const employeeId = uuidOrNull(body?.employee_id, 'employee')
  if (!employeeId) throw new HTTPException(400, { message: 'Choose who to help.' })
  const requestId = uuidOrNull(body?.help_request_id, 'help request')

  const session = await guarded(c, 'live_assist.use', employeeId, 'la_start', {
    p_actor: actor(c), p_employee: employeeId, p_request: requestId, p_ctx: requestContext(c),
  })

  const notices = [{ userId: employeeId, event: 'assist_request', payload: sessionNotice(session) }]
  if (session.claimed_request) {
    for (const helper of session.helpers ?? []) {
      if (helper !== actor(c)) notices.push({ userId: helper, event: 'help_closed', payload: { request_id: requestId } })
    }
  }
  await notifyStaff(c.env, notices, 'assist.start_notify')
  return ok(c, sessionNotice(session), 201)
})

assist.post('/sessions/:id/respond', async (c) => {
  const id = idParam(c)
  const body = await readBoundedJson(c, MAX_BODY)
  if (typeof body?.accept !== 'boolean') throw new HTTPException(400, { message: 'accept must be true or false' })

  const session = await callUserRpc(c, 'la_respond', {
    p_actor: actor(c), p_session: id, p_accept: body.accept, p_ctx: requestContext(c),
  })
  if (session.stale) {
    throw new HTTPException(409, { message: 'This request is no longer waiting. Ask them to start Live Assist again.' })
  }
  await notifyStaff(c.env, [{ userId: session.helper_id, event: 'assist_response', payload: sessionNotice(session) }], 'assist.respond_notify')
  return ok(c, sessionNotice(session))
})

// Either side ends it. `connection_lost` is what a browser sends when the
// direct connection drops; anything else is a deliberate stop.
assist.post('/sessions/:id/end', async (c) => {
  const id = idParam(c)
  const body = await readBoundedJson(c, MAX_BODY)
  const reason = body?.reason === 'connection_lost' ? 'connection_lost' : null
  const session = await callUserRpc(c, 'la_end', { p_actor: actor(c), p_session: id, p_reason: reason, p_ctx: requestContext(c) })
  await notifyStaff(c.env, [session.helper_id, session.employee_id].map((userId) => ({
    userId, event: 'assist_ended', payload: sessionNotice(session),
  })), 'assist.end_notify')
  return ok(c, sessionNotice(session))
})

// Who may help the caller, online first, for the "Who should help?" choice.
// Any staff member: it only covers themselves.
assist.get('/helpers', async (c) => {
  return ok(c, await callUserRpc(c, 'la_my_helpers', { p_actor: actor(c) }))
})

// "Ask for help": tells everyone who may help this person (at most 25), or
// only the one person they chose.
assist.post('/help', async (c) => {
  const body = await readBoundedJson(c, MAX_BODY)
  const message = body?.message
  if (message !== undefined && message !== null && (typeof message !== 'string' || message.length > 300)) {
    throw new HTTPException(400, { message: 'Keep the message under 300 characters.' })
  }
  const section = typeof body?.section === 'string' && SECTION.test(body.section) ? body.section : null
  const helperId = uuidOrNull(body?.helper_id, 'helper')

  const args = { p_actor: actor(c), p_message: message ?? null, p_section: section, p_ctx: requestContext(c) }
  // Sent only when someone was chosen, so asking everyone keeps working on a
  // database without migration 20261008040426 (which added p_helper).
  if (helperId) args.p_helper = helperId
  const result = await callUserRpc(c, 'la_request_help', args)
  const helpers = result.helpers ?? []
  if (!result.already_open && helpers.length) {
    const request = {
      id: result.request_id, requester_id: actor(c), requester_name: result.requester_name,
      message: result.message, section: result.section, created_at: new Date().toISOString(),
      for_you: Boolean(result.helper_id),
    }
    await notifyStaff(c.env, helpers.map((userId) => ({ userId, event: 'help_request', payload: request })), 'assist.help_notify')
  }
  return ok(c, {
    request_id: result.request_id,
    already_open: result.already_open,
    expires_at: result.expires_at,
    helper_id: result.helper_id ?? null,
    helper_name: result.helper_name ?? null,
    helpers_notified: result.already_open ? null : helpers.length,
  }, result.already_open ? 200 : 201)
})

assist.post('/help/:id/cancel', async (c) => {
  const id = idParam(c)
  const result = await callUserRpc(c, 'la_cancel_help', { p_actor: actor(c), p_request: id, p_ctx: requestContext(c) })
  if (result.cancelled) {
    await notifyStaff(c.env, (result.helpers ?? []).map((userId) => ({
      userId, event: 'help_closed', payload: { request_id: id },
    })), 'assist.help_cancel_notify')
  }
  return ok(c, { cancelled: result.cancelled })
})

export default assist
