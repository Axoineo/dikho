// Short-lived signed tickets so <img>/<video>/<iframe> can load re-hosted media
// directly (those elements cannot send an Authorization header).
//
// A ticket is `${exp}.${userId}.${sessionId}.${hmacHex}`, the HMAC over
// `media2.${exp}.${userId}.${sessionId}`. It is not the session token, so it can sit
// in a URL, but it belongs to one person's one session: the media route refuses it
// once that session has ended or the person is suspended (holderIsLive), and it
// lasts an hour, not six. Pre-launch audit 4.3, 2026-11-22: the old ticket was
// `${exp}.${hmac}`, opened every file for six hours and survived sign-out.
//
// Signed with MEDIA_TICKET_SECRET, or the Meta app secret until that is set.

import { logError } from '../../utils/logger.js'

const enc = new TextEncoder()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** How long a ticket lasts. Clients fetch a new one well before this. */
export const MEDIA_TICKET_TTL_SECONDS = 60 * 60

export const mediaTicketSecret = (env) => env.MEDIA_TICKET_SECRET || env.WHATSAPP_APP_SECRET

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A ticket for this person's session. Throws without both ids: no anonymous tickets. */
export async function signMediaTicket(secret, { userId, sessionId }, ttlSeconds = MEDIA_TICKET_TTL_SECONDS) {
  const user = String(userId ?? '').toLowerCase()
  const session = String(sessionId ?? '').toLowerCase()
  if (!secret || !UUID.test(user) || !UUID.test(session)) throw new Error('A media ticket needs a signing secret, a user and a session')
  const body = `${Math.floor(Date.now() / 1000) + ttlSeconds}.${user}.${session}`
  return `${body}.${await hmacHex(secret, `media2.${body}`)}`
}

/** The ticket's holder ({ userId, sessionId }) while it is genuine and unexpired, else null. */
export async function verifyMediaTicket(secret, ticket) {
  if (!secret || typeof ticket !== 'string' || ticket.length > 200) return null
  const parts = ticket.split('.')
  if (parts.length !== 4) return null
  const [expStr, userId, sessionId, sig] = parts
  if (!/^\d{1,12}$/.test(expStr) || !UUID.test(userId) || !UUID.test(sessionId)) return null
  if (Number(expStr) < Date.now() / 1000) return null
  const expected = await hmacHex(secret, `media2.${expStr}.${userId}.${sessionId}`)
  return timingSafeEqual(sig, expected) ? { userId, sessionId } : null
}

// Answers kept for a minute per Worker instance: a chat loads many pictures at once,
// and a sign-out or suspension still closes the ticket within a minute.
const LIVE_FOR_MS = 60_000
const live = new Map()

/**
 * True while the ticket's person is active staff and that session has not been
 * ended (signed out, forced out, suspended, archived). Read with the service-role
 * key, which never leaves the Worker. Fails closed: no answer means no file.
 */
export async function holderIsLive(env, { userId, sessionId }) {
  const key = `${userId}:${sessionId}`
  const hit = live.get(key)
  if (hit && Date.now() - hit.at < LIVE_FOR_MS) return hit.ok
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return false

  const query = new URLSearchParams({
    select: 'status,staff_sessions(ended_at)',
    user_id: `eq.${userId}`,
    'staff_sessions.session_id': `eq.${sessionId}`,
  })
  let rows
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/staff_members?${query}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`staff lookup answered ${res.status}`)
    rows = await res.json()
  } catch (err) {
    logError('whatsapp.media_ticket.holder_check_failed', err)
    return false
  }
  const staff = Array.isArray(rows) ? rows[0] : null
  const ended = Array.isArray(staff?.staff_sessions) && staff.staff_sessions.some((s) => s?.ended_at)
  const ok = staff?.status === 'active' && !ended
  if (live.size > 500) live.clear()
  live.set(key, { ok, at: Date.now() })
  return ok
}

/** For tests: forget cached answers. */
export function forgetLiveHolders() {
  live.clear()
}
