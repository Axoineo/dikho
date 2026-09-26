import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok, fail } from '../../utils/response.js'
import { answerCall, endCall } from '../../services/whatsapp/calls.js'

// Agent-facing signalling for inbound WhatsApp voice calls. Mounted behind
// requireAuth in ./index.js — these spend real call capacity and decide who
// picks up, so they are never reachable without a dashboard session.
//
// The audio path does not come through here. The browser holds the WebRTC peer
// connection and streams straight to Meta's media servers; this route only
// relays the SDP answer it produced.
const calls = new Hono()

// pre_accept and accept both carry the browser's SDP answer. Splitting them
// into their own verbs (rather than one `action` field) keeps the SDP-required
// actions apart from the SDP-less ones, so a missing body can be rejected here
// instead of by Meta.
const ANSWER_ACTIONS = { 'pre-accept': 'pre_accept', accept: 'accept' }
const END_ACTIONS = { reject: 'reject', terminate: 'terminate' }

// An SDP answer with the ICE candidates inlined runs ~2-6 KB. Anything far past
// that is not an SDP, and Meta would reject it after we had already claimed the
// call — cheaper to refuse it here.
const MAX_SDP_BYTES = 64 * 1024

function callId(c) {
  const wacid = c.req.param('wacid')
  if (!wacid || !wacid.startsWith('wacid.')) {
    throw new HTTPException(400, { message: 'Bad call id' })
  }
  return wacid
}

/* ── POST /api/whatsapp/calls/:wacid/pre-accept | /accept ──────────────────
   pre-accept answers the offer so ICE/DTLS can settle while the call is still
   ringing; accept is the actual pickup. Both are safe to call once each, in
   that order, from the tab that is answering. */
calls.post('/:wacid/:verb{pre-accept|accept}', async (c) => {
  const wacid = callId(c)
  const action = ANSWER_ACTIONS[c.req.param('verb')]

  const body = await c.req.json().catch(() => ({}))
  const sdp = typeof body?.sdp === 'string' ? body.sdp : null
  if (!sdp || !sdp.startsWith('v=')) {
    throw new HTTPException(400, { message: 'An SDP answer is required' })
  }
  if (sdp.length > MAX_SDP_BYTES) {
    throw new HTTPException(413, { message: 'SDP answer too large' })
  }

  const res = await answerCall(c, { wacid, action, sdp, phone: body?.phone ?? null })
  if (!res.ok) {
    // 409, not 500: losing the race to another tab is an ordinary outcome and
    // the UI dismisses its ringing card rather than showing an error.
    return fail(c, res.code, res.message, res.code === 'CALL_UNAVAILABLE' ? 409 : 502)
  }
  return ok(c, { ok: true })
})

/* ── POST /api/whatsapp/calls/:wacid/reject | /terminate ───────────────────
   reject declines a ringing call; terminate hangs up one that is already up.
   Both record the local outcome even when Meta says the call is already gone,
   so the thread never keeps a call stuck as ringing. */
calls.post('/:wacid/:verb{reject|terminate}', async (c) => {
  const wacid = callId(c)
  const action = END_ACTIONS[c.req.param('verb')]
  const res = await endCall(c, { wacid, action })
  return ok(c, res)
})

/* ── GET /api/whatsapp/calls — call history ──────────────────────────────
   ?conversationId=123  one thread's calls
   ?status=missed       the follow-up queue

   Each row carries who called and whether anyone has answered them since, so
   the missed-calls screen can rank by "still unhandled" rather than just by
   time. `followed_up` is an outbound message *after* the call ended — an
   agent's reply or the automatic acknowledgement both count, which is the
   point: either way the customer has heard from us. */
calls.get('/', async (c) => {
  const conversationId = Number(c.req.query('conversationId'))
  const status = c.req.query('status')

  const select = `
    SELECT calls.*,
           COALESCE(contacts.name, calls.wa_name) AS display_name,
           contacts.avatar_url AS avatar_url,
           EXISTS (
             SELECT 1 FROM messages m
             WHERE m.conversation_id = calls.conversation_id
               AND m.direction = 'outbound'
               AND m.created_at > COALESCE(calls.ended_at, calls.ring_at)
           ) AS followed_up
    FROM calls
    LEFT JOIN contacts ON contacts.id = calls.contact_id`

  let query
  if (Number.isInteger(conversationId) && conversationId > 0) {
    query = c.env.DB.prepare(`${select} WHERE calls.conversation_id = ?
      ORDER BY calls.created_at DESC LIMIT 100`).bind(conversationId)
  } else if (status) {
    query = c.env.DB.prepare(`${select} WHERE calls.status = ?
      ORDER BY calls.created_at DESC LIMIT 200`).bind(status)
  } else {
    query = c.env.DB.prepare(`${select} ORDER BY calls.created_at DESC LIMIT 100`)
  }

  const { results } = await query.all()
  return ok(c, { calls: results })
})

export default calls
