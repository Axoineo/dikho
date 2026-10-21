// Small cryptographic helpers for the Email Hub, on WebCrypto only (the same
// API in the Worker and in Node's test runner).
//
// Refresh tokens are encrypted here, in the Worker, before they reach the
// database: AES-256-GCM with a key that exists only as a Worker secret
// (EMAIL_TOKEN_KEY, 32 random bytes, base64). The mailbox address is bound in
// as associated data, so a ciphertext copied onto another mailbox's row does
// not decrypt. Stored form: `k<key id>.<iv>.<ciphertext>`, base64url parts;
// the key id (first 8 hex of the key's SHA-256) lets a rotation keep the
// previous key (EMAIL_TOKEN_KEY_PREVIOUS) for decryption only.

const enc = new TextEncoder()
const dec = new TextDecoder()

export function base64url(bytes) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(text) {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function fromBase64(text) {
  return fromBase64url(String(text).replace(/\+/g, '-').replace(/\//g, '_'))
}

export function randomToken(byteLength = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', typeof text === 'string' ? enc.encode(text) : text)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** RFC 7636 S256 code challenge for a PKCE verifier. */
export async function pkceChallenge(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))))
}

/** Constant-time comparison of two strings. */
export function safeEqual(a, b) {
  const x = enc.encode(String(a))
  const y = enc.encode(String(b))
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message))))
}

// ── Token encryption ───────────────────────────────────────────────────────
const keyCache = new Map()

async function loadKey(material) {
  if (!material) return null
  if (keyCache.has(material)) return keyCache.get(material)
  let raw
  try {
    raw = fromBase64(material.trim())
  } catch {
    return null
  }
  if (raw.length !== 32) return null
  const key = {
    id: (await sha256Hex(raw)).slice(0, 8),
    cryptoKey: await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']),
  }
  keyCache.set(material, key)
  return key
}

/** True when EMAIL_TOKEN_KEY is a usable 32-byte key. */
export async function tokenKeyConfigured(env) {
  return Boolean(await loadKey(env.EMAIL_TOKEN_KEY))
}

export class TokenKeyError extends Error {}

export async function encryptToken(env, plaintext, mailboxAddress) {
  const key = await loadKey(env.EMAIL_TOKEN_KEY)
  if (!key) throw new TokenKeyError('EMAIL_TOKEN_KEY is missing or is not 32 bytes of base64')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(`mailbox:${mailboxAddress}`) },
    key.cryptoKey,
    enc.encode(plaintext),
  )
  return `k${key.id}.${base64url(iv)}.${base64url(new Uint8Array(ct))}`
}

export async function decryptToken(env, stored, mailboxAddress) {
  const match = /^k([0-9a-f]{8})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{16,})$/.exec(String(stored ?? ''))
  if (!match) throw new TokenKeyError('stored token is not in the expected format')
  const candidates = [await loadKey(env.EMAIL_TOKEN_KEY), await loadKey(env.EMAIL_TOKEN_KEY_PREVIOUS)].filter(Boolean)
  const key = candidates.find((k) => k.id === match[1])
  if (!key) throw new TokenKeyError('no configured key matches the stored token')
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64url(match[2]), additionalData: enc.encode(`mailbox:${mailboxAddress}`) },
      key.cryptoKey,
      fromBase64url(match[3]),
    )
    return dec.decode(pt)
  } catch {
    throw new TokenKeyError('stored token could not be decrypted for this mailbox')
  }
}
