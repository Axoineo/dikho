import { fromBase64url } from './crypto.js'

// Verifies the OIDC token Google attaches to a Pub/Sub push (Authorization:
// Bearer <jwt>). This is the Gmail push endpoint's only authentication, so it
// fails closed: RS256 only, a key from Google's published set, issuer,
// audience (the push subscription's configured audience), the subscription's
// service account, a verified email and a live expiry.
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const SKEW_S = 60

let keyCache = { keys: null, until: 0 }

async function fetchGoogleKeys() {
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`certs ${res.status}`)
  const body = await res.json()
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '')?.[1]) || 3600
  return { keys: Array.isArray(body?.keys) ? body.keys : [], maxAge: Math.min(maxAge, 6 * 3600) }
}

async function keyFor(kid, fetchKeys, forceRefresh) {
  if (forceRefresh || !keyCache.keys || keyCache.until < Date.now()) {
    const { keys, maxAge } = await fetchKeys()
    keyCache = { keys, until: Date.now() + maxAge * 1000 }
  }
  return keyCache.keys.find((k) => k.kid === kid && k.kty === 'RSA') ?? null
}

/** For tests: forget cached keys. */
export function resetGoogleKeyCache() {
  keyCache = { keys: null, until: 0 }
}

function decodePart(part) {
  return JSON.parse(new TextDecoder().decode(fromBase64url(part)))
}

/** Returns the verified claims, or null. Never throws for a bad token. */
export async function verifyPushToken(env, authorization, { fetchKeys = fetchGoogleKeys, now = Date.now() } = {}) {
  const audience = env.GOOGLE_PUBSUB_AUDIENCE
  const account = (env.GOOGLE_PUBSUB_SERVICE_ACCOUNT || '').toLowerCase()
  if (!audience || !account) return null
  const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(authorization || '')
  if (!match) return null

  let header, claims
  try {
    header = decodePart(match[1])
    claims = decodePart(match[2])
  } catch {
    return null
  }
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') return null

  let jwk
  try {
    jwk = await keyFor(header.kid, fetchKeys, false) ?? await keyFor(header.kid, fetchKeys, true)
  } catch {
    return null
  }
  if (!jwk) return null

  let valid = false
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64url(match[3]),
      new TextEncoder().encode(`${match[1]}.${match[2]}`))
  } catch {
    return null
  }
  if (!valid) return null

  const t = Math.floor(now / 1000)
  if (!ISSUERS.has(claims?.iss)) return null
  if (claims.aud !== audience) return null
  if (String(claims.email || '').toLowerCase() !== account || claims.email_verified !== true) return null
  if (typeof claims.exp !== 'number' || claims.exp < t - SKEW_S) return null
  if (typeof claims.iat === 'number' && claims.iat > t + SKEW_S) return null
  return claims
}
