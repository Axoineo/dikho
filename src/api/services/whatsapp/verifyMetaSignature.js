// Verifies Meta's X-Hub-Signature-256 header on inbound webhook deliveries.
//
// Meta signs the *raw* request body with HMAC-SHA256 keyed by the app secret and
// sends it as `sha256=<hex>`. Now that inbound message content is stored in D1
// and shown to agents, this check is what stops a forged POST from injecting
// messages into the inbox. Uses Web Crypto (available in Workers).

// Length-independent, byte-for-byte compare that never short-circuits, so timing
// cannot leak how much of the signature matched.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyMetaSignature(rawBody, header, appSecret) {
  if (!appSecret) return false
  if (!header || !header.startsWith('sha256=')) return false
  const provided = header.slice('sha256='.length)

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')

  return timingSafeEqual(provided, expected)
}
