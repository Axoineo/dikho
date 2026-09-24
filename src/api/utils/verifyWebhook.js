// Standard Webhooks (https://www.standardwebhooks.com) signature verification,
// used for Supabase's "Send SMS" auth hook. Supabase signs each delivery with
// an HMAC over `${id}.${timestamp}.${body}` and hands you a secret shaped like
// `v1,whsec_<base64>`. We verify with Web Crypto — available in Workers — and
// reject stale timestamps so a captured request cannot be replayed later.

const DEFAULT_TOLERANCE_SECONDS = 5 * 60

function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// Length-independent, byte-for-byte compare that does not short-circuit on the
// first differing byte, so timing cannot leak how much of the signature matched.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// The stored secret is `v1,whsec_<base64key>`; strip the scheme/prefix and
// decode the remainder to the raw HMAC key bytes.
function decodeSecret(secret) {
  const withoutScheme = secret.includes(',') ? secret.slice(secret.indexOf(',') + 1) : secret
  const raw = withoutScheme.startsWith('whsec_') ? withoutScheme.slice('whsec_'.length) : withoutScheme
  return base64ToBytes(raw)
}

// Returns { ok: true } when the signature and timestamp check out, otherwise
// { ok: false, reason } — callers translate that into a 401 for Supabase.
export async function verifyStandardWebhook({
  secret,
  headers,
  body,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
}) {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')

  if (!secret) return { ok: false, reason: 'hook secret not configured' }
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: 'missing signature headers' }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid timestamp' }
  const skew = Math.abs(Date.now() / 1000 - ts)
  if (skew > toleranceSeconds) return { ok: false, reason: 'timestamp outside tolerance' }

  const key = await crypto.subtle.importKey(
    'raw',
    decodeSecret(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  const mac = await crypto.subtle.sign('HMAC', key, signed)
  const expected = bytesToBase64(new Uint8Array(mac))

  // The header may carry several space-delimited `<version>,<sig>` pairs; a
  // match against any current-version signature is a pass.
  for (const part of signatureHeader.split(' ')) {
    const comma = part.indexOf(',')
    const sig = comma === -1 ? part : part.slice(comma + 1)
    if (timingSafeEqual(sig, expected)) return { ok: true }
  }

  return { ok: false, reason: 'signature mismatch' }
}
