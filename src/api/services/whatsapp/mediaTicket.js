// Short-lived, media-scoped signed tickets so <img>/<video>/<iframe> can load
// re-hosted media directly (those elements cannot send an Authorization header).
//
// A ticket is `${exp}.${hmacHex}` where the HMAC is over `media.${exp}` keyed by
// the app secret. It grants read access to the media route until `exp`, nothing
// else — it is not the user's session token, so it is safe to put in a URL. The
// dashboard fetches one after login (auth'd) and appends it to media URLs.

const enc = new TextEncoder()

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

export async function signMediaTicket(secret, ttlSeconds = 6 * 60 * 60) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  return `${exp}.${await hmacHex(secret, `media.${exp}`)}`
}

export async function verifyMediaTicket(secret, ticket) {
  if (!secret || !ticket || !ticket.includes('.')) return false
  const [expStr, sig] = ticket.split('.')
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false
  return timingSafeEqual(sig, await hmacHex(secret, `media.${exp}`))
}
