// Turns the `calls` webhook field into durable state, and owns the claim that
// decides which agent tab gets to answer a ringing call.
//
// Signalling only — no audio passes through the Worker. The browser is the
// WebRTC peer; this module just moves an SDP offer out to the agent and an SDP
// answer back to Meta.

import { broadcast } from './realtime.js'
import { sendCallAction } from './graph.js'

// Meta gives roughly 30-60s from the connect webhook before it gives up on an
// unanswered call. Rows still 'ringing' well past that were never terminated
// (a webhook we missed), so the claim below refuses them rather than letting an
// agent answer a call that is long dead.
const RING_TTL_MS = 90 * 1000

// The customer's number, which the two payload shapes Meta documents disagree
// about. On a terminate there is no `contacts` array at all, so `calls[].from`
// has to be the primary source — but Meta's own connect sample shows `from`
// holding the *business* number, and there the caller survives only in
// `contacts[].wa_id`. Comparing against the number the webhook says it is for
// settles it without having to guess which shape arrived.
export function callerPhone(value, call) {
  const business = value?.metadata?.display_phone_number ?? null
  const waId = value?.contacts?.[0]?.wa_id ?? null
  const from = call?.from ?? null
  if (from && from !== business) return from
  return waId ?? from
}

function isoFrom(timestamp) {
  return timestamp
    ? new Date(Number(timestamp) * 1000).toISOString()
    : new Date().toISOString()
}

// "2:05" / "0:41" — how WhatsApp itself labels a call in the thread.
function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Contact + conversation upsert for a caller we may never have messaged.
//
// Deliberately NOT the same upsert as inbound.js: a call must not touch
// last_inbound_at or unread_count. last_inbound_at is what gates free-form
// replies, and a voice call does not open the 24-hour messaging window — moving
// it here would make the composer offer sends that Meta then rejects.
async function ensureConversation(db, { phone, waName }) {
  await db.prepare(
    `INSERT INTO contacts (name, phone, source) VALUES (?1, ?2, 'inbound')
     ON CONFLICT(phone) DO UPDATE SET
       name = COALESCE(contacts.name, ?1),
       updated_at = datetime('now')`,
  ).bind(waName, phone).run()
  const contact = await db.prepare('SELECT id FROM contacts WHERE phone = ?').bind(phone).first()

  await db.prepare(
    `INSERT INTO conversations (contact_id, phone, wa_name, status)
     VALUES (?1, ?2, ?3, 'open')
     ON CONFLICT(phone) DO UPDATE SET
       contact_id = COALESCE(conversations.contact_id, ?1),
       wa_name = COALESCE(?3, conversations.wa_name),
       status = 'open',
       updated_at = datetime('now')`,
  ).bind(contact?.id ?? null, phone, waName).run()
  const conversation = await db.prepare('SELECT * FROM conversations WHERE phone = ?').bind(phone).first()

  return { contactId: contact?.id ?? null, conversation }
}

/* ── Webhook side ─────────────────────────────────────────────────────── */

// connect: the call is ringing. Records it so the agent routes below have
// something to claim. The ring itself is broadcast by the webhook's fast path
// before this runs — a ringing phone cannot wait on bookkeeping.
async function processConnect(c, event) {
  const db = c.env.DB
  const at = isoFrom(event.timestamp)
  const { contactId, conversation } = await ensureConversation(db, {
    phone: event.phone,
    waName: event.waName,
  })

  await db.prepare(
    `INSERT INTO calls
       (wacid, conversation_id, contact_id, phone, wa_name, direction, status, ring_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'inbound', 'ringing', ?6)
     ON CONFLICT(wacid) DO UPDATE SET
       conversation_id = COALESCE(calls.conversation_id, ?2),
       contact_id = COALESCE(calls.contact_id, ?3),
       phone = COALESCE(calls.phone, ?4),
       wa_name = COALESCE(?5, calls.wa_name),
       updated_at = datetime('now')`,
  ).bind(event.callId, conversation?.id ?? null, contactId, event.phone, event.waName, at).run()
}

// terminate: the call is over, however it ended. Writes the final status, drops
// a row into the thread so the call is visible in the conversation history, and
// tells open tabs to tear down their peer connection.
async function processTerminate(c, event) {
  const db = c.env.DB
  const call = event.raw
  const endedAt = isoFrom(event.timestamp)
  const duration = Number(call.duration) || 0
  // Meta sends "Completed" / "Failed"; normalise so the column is queryable.
  const reason = (call.status ?? '').toLowerCase() || null

  // A call we never saw ring (webhook missed, or the row write failed) still
  // gets a row here — otherwise the thread silently loses the call entirely.
  await db.prepare(
    `INSERT INTO calls (wacid, phone, direction, status, ended_at, duration_seconds, end_reason)
     VALUES (?1, ?2, 'inbound', 'missed', ?3, ?4, ?5)
     ON CONFLICT(wacid) DO UPDATE SET
       status = CASE
         -- An agent's explicit decline is the one verdict Meta's terminate
         -- must not overwrite: to Meta a rejected call is simply not answered.
         WHEN calls.status = 'rejected' THEN 'rejected'
         WHEN calls.answered_at IS NOT NULL THEN 'completed'
         WHEN ?5 = 'failed' THEN 'failed'
         ELSE 'missed' END,
       ended_at = COALESCE(calls.ended_at, ?3),
       duration_seconds = COALESCE(?4, calls.duration_seconds),
       end_reason = COALESCE(?5, calls.end_reason),
       updated_at = datetime('now')`,
  ).bind(event.callId, event.phone, endedAt, duration || null, reason).run()

  const row = await db.prepare('SELECT * FROM calls WHERE wacid = ?').bind(event.callId).first()
  if (!row) return

  // Backfill the thread link for a call whose connect webhook never landed.
  let conversationId = row.conversation_id
  if (!conversationId && row.phone) {
    const { conversation } = await ensureConversation(db, { phone: row.phone, waName: row.wa_name })
    conversationId = conversation?.id ?? null
    if (conversationId) {
      await db.prepare('UPDATE calls SET conversation_id = ?1, contact_id = COALESCE(contact_id, ?2) WHERE id = ?3')
        .bind(conversationId, conversation?.contact_id ?? null, row.id).run()
    }
  }

  const answered = row.status === 'completed'
  const label = answered
    ? `Voice call · ${formatDuration(row.duration_seconds)}`
    : row.status === 'rejected' ? 'Voice call declined' : 'Missed voice call'
  const preview = `📞 ${label}`

  if (conversationId) {
    // Reuses meta_message_id to hold the wacid: the existing UNIQUE index then
    // makes a redelivered terminate a no-op instead of a duplicate bubble.
    await db.prepare(
      `INSERT INTO messages
         (conversation_id, contact_id, phone, meta_message_id, direction, type,
          body, status, wa_timestamp, created_at)
       VALUES (?1, ?2, ?3, ?4, 'inbound', 'call', ?5, ?6, ?7, ?7)
       ON CONFLICT(meta_message_id) DO NOTHING`,
    ).bind(
      conversationId, row.contact_id, row.phone, row.wacid, label,
      answered ? 'received' : row.status, endedAt,
    ).run()

    // Only nudge the chat-list row — not unread_count or last_inbound_at, for
    // the same session-window reason as ensureConversation above.
    await db.prepare(
      `UPDATE conversations
       SET last_message_at = ?1, last_message_preview = ?2,
           last_message_direction = 'inbound', updated_at = datetime('now')
       WHERE id = ?3 AND (last_message_at IS NULL OR last_message_at < ?1)`,
    ).bind(endedAt, preview, conversationId).run()

    const message = await db.prepare('SELECT * FROM messages WHERE meta_message_id = ?')
      .bind(row.wacid).first()
    const conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?')
      .bind(conversationId).first()
    if (message && conversation) {
      await broadcast(c.env, 'message:new', { conversation, message })
    }
  }

  await broadcast(c.env, 'call:ended', {
    callId: row.wacid,
    status: row.status,
    durationSeconds: row.duration_seconds,
    endedAt,
  })
}

export async function processCallEvent(c, event) {
  if (event.event === 'connect') return processConnect(c, event)
  if (event.event === 'terminate') return processTerminate(c, event)
  // Meta may add further call events; the ledger row keeps the payload so an
  // unhandled shape is replayable rather than lost.
}

/* ── Agent side ───────────────────────────────────────────────────────── */

// Claims a ringing call for one agent. Every dashboard tab rings, so without
// this two agents would both POST an accept and Meta would answer with whichever
// SDP arrived second — cutting the first agent's audio dead. The conditional
// UPDATE is the whole lock: exactly one caller gets a row back.
//
// Reaching rows that are already 'connecting' for the *same* agent is
// deliberate: the answer flow sends pre_accept and then accept, and the second
// call must not be refused as a double-claim.
async function claimCall(db, { wacid, userId, phone }) {
  const cutoff = new Date(Date.now() - RING_TTL_MS).toISOString()
  const at = new Date().toISOString()

  return db.prepare(
    `INSERT INTO calls (wacid, phone, direction, status, answered_by, answered_at, ring_at)
     VALUES (?1, ?2, 'inbound', 'connecting', ?3, ?4, ?4)
     ON CONFLICT(wacid) DO UPDATE SET
       status = 'connecting',
       answered_by = ?3,
       answered_at = COALESCE(calls.answered_at, ?4),
       updated_at = datetime('now')
     WHERE (calls.status = 'ringing' OR (calls.status IN ('connecting', 'active') AND calls.answered_by = ?3))
       AND calls.ended_at IS NULL
       AND COALESCE(calls.ring_at, calls.created_at) > ?5
     RETURNING *`,
  ).bind(wacid, phone ?? null, userId, at, cutoff).first()
}

// pre_accept / accept. Returns { ok } or { ok:false, code, message } where code
// is 'CALL_UNAVAILABLE' when another tab won the race or the call already ended.
export async function answerCall(c, { wacid, action, sdp, phone }) {
  const db = c.env.DB
  const userId = c.get('user')?.id ?? null

  const claimed = await claimCall(db, { wacid, userId, phone })
  if (!claimed) {
    return { ok: false, code: 'CALL_UNAVAILABLE', message: 'This call was answered elsewhere or has ended' }
  }

  const res = await sendCallAction(c.env, { callId: wacid, action, sdp })
  if (!res.ok) {
    // Release the claim so the call is not stranded in 'connecting' — another
    // tab (or the same agent retrying) can still take it inside the ring TTL.
    await db.prepare(
      `UPDATE calls SET status = 'ringing', answered_by = NULL, answered_at = NULL,
         updated_at = datetime('now')
       WHERE wacid = ?1 AND answered_by = ?2 AND status = 'connecting'`,
    ).bind(wacid, userId).run()
    return { ok: false, code: 'CALL_ACTION_FAILED', message: res.errorMessage }
  }

  if (action === 'accept') {
    await db.prepare(
      `UPDATE calls SET status = 'active', updated_at = datetime('now')
       WHERE wacid = ?1 AND ended_at IS NULL`,
    ).bind(wacid).run()
    await broadcast(c.env, 'call:claimed', { callId: wacid, answeredBy: userId })
  }

  return { ok: true }
}

// reject / terminate. Both are idempotent: Meta refusing an action on a call
// that already ended is not an error worth showing the agent, so the local row
// is written either way and the UI always gets to tear down.
export async function endCall(c, { wacid, action }) {
  const db = c.env.DB
  const res = await sendCallAction(c.env, { callId: wacid, action })

  await db.prepare(
    `UPDATE calls
     SET status = CASE WHEN ?2 = 'reject' THEN 'rejected'
                       WHEN calls.answered_at IS NOT NULL THEN 'completed'
                       ELSE 'missed' END,
         ended_at = COALESCE(calls.ended_at, ?3),
         updated_at = datetime('now')
     WHERE wacid = ?1 AND calls.ended_at IS NULL`,
  ).bind(wacid, action, new Date().toISOString()).run()

  await broadcast(c.env, 'call:ended', { callId: wacid, status: action === 'reject' ? 'rejected' : 'completed' })

  return { ok: true, metaOk: res.ok, message: res.ok ? null : res.errorMessage }
}
