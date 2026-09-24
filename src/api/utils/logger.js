// Redacts anything that looks like a secret before it reaches console output,
// since Workers logs (wrangler tail / dashboard) are not a safe place for
// access tokens, app secrets, or verify tokens.

const SECRET_KEYS = new Set([
  'access_token',
  'token',
  'verify_token',
  'app_secret',
  'authorization',
  'otp',
])

function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      out[key] = SECRET_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redact(val)
    }
    return out
  }
  return value
}

export function logEvent(label, payload) {
  console.log(`[${label}]`, JSON.stringify(redact(payload)))
}

export function logError(label, err) {
  console.error(`[${label}]`, err instanceof Error ? err.stack || err.message : err)
}
