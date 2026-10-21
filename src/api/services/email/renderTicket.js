import { base64url, fromBase64url, hmacSha256, safeEqual, sha256Hex } from './crypto.js'

// Short-lived capabilities for showing one message in an iframe. The frame
// loads from the API origin (its own origin, its own CSP), so it cannot carry
// the dashboard's bearer token; the URL carries this ticket instead.
//
// A ticket names one person, one conversation and one message, lasts ten
// minutes, and is signed with a key derived from EMAIL_TOKEN_KEY. It is not a
// session: the render route still re-checks the person's mailbox membership
// in the database on every load, so removing someone takes effect at once.
// Like media tickets, it must not be logged or shared.
const TTL_S = 10 * 60

async function signingKey(env) {
  if (!env.EMAIL_TOKEN_KEY) return null
  return sha256Hex(`dikho-email-render:${env.EMAIL_TOKEN_KEY}`)
}

export async function issueRenderTicket(env, { userId, threadId, messageId }, now = Date.now()) {
  const key = await signingKey(env)
  if (!key) return null
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ u: userId, t: threadId, m: messageId, e: Math.floor(now / 1000) + TTL_S })))
  return `${payload}.${await hmacSha256(key, payload)}`
}

/** Returns { userId } when the ticket is genuine, unexpired and for this message. */
export async function verifyRenderTicket(env, ticket, { threadId, messageId }, now = Date.now()) {
  const key = await signingKey(env)
  const match = /^([A-Za-z0-9_-]{20,400})\.([A-Za-z0-9_-]{43})$/.exec(String(ticket ?? ''))
  if (!key || !match) return null
  if (!safeEqual(await hmacSha256(key, match[1]), match[2])) return null
  let claims
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64url(match[1])))
  } catch {
    return null
  }
  if (claims?.t !== threadId || claims?.m !== messageId || typeof claims?.u !== 'string') return null
  if (!(Number(claims.e) > Math.floor(now / 1000))) return null
  return { userId: claims.u }
}
