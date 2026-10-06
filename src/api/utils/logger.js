// Structured logging with redaction. Workers logs (wrangler tail, the
// dashboard's observability view) are readable by anyone with access to the
// Cloudflare account and are retained by the platform, so they must not carry
// credentials or the personal data this system handles.
//
// Two layers, both applied to everything logged:
//   1. By key: secrets are replaced outright; personal fields (phone, email,
//      names, addresses, message text) are masked, keeping at most the last
//      four characters of an identifier so two log lines can still be matched.
//   2. By content: any string, including error messages and stacks, is
//      scrubbed of email addresses, phone-like digit runs, GSTINs and PANs,
//      because upstream error text (PostgREST, Meta) can echo submitted values.
// Neither layer is a reason to log a whole payload: log counts and ids.

const SECRET_KEYS = new Set([
  'access_token',
  'token',
  'verify_token',
  'app_secret',
  'authorization',
  'otp',
  'apikey',
  'secret',
  'password',
  'ticket',
  'signature',
])

// Identifiers: masked to their last four characters.
const IDENTIFIER_KEYS = new Set([
  'phone', 'mobile', 'contact', 'wa_id', 'from', 'to', 'recipient_id',
  'gstin', 'pan', 'pan_number', 'account_number', 'vendor_account_number',
])

// Free text and personal details: replaced with their length only.
const PERSONAL_KEYS = new Set([
  'email', 'name', 'contact_name', 'contact_person', 'profile', 'address',
  'body', 'text', 'caption', 'message_body',
])

function maskTail(value) {
  const text = String(value)
  return text.length <= 4 ? '[masked]' : `[masked …${text.slice(-4)}]`
}

// Order matters: emails before digit runs (an address can contain digits).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g
// A standalone run of 10-15 digits, optionally after a +. Phones are stored and
// submitted as bare digits, which is how upstream errors echo them. Separated
// groups are deliberately not matched, so dates and times stay readable.
const PHONE = /(?<!\d)\+?\d{10,15}(?!\d)/g

export function scrubText(text) {
  return String(text)
    .replace(EMAIL, '[email]')
    .replace(GSTIN, (m) => maskTail(m))
    .replace(PAN, (m) => maskTail(m))
    .replace(PHONE, (m) => maskTail(m.replace(/\D/g, '')))
}

export function redact(value, key = '') {
  const lower = key.toLowerCase()
  if (SECRET_KEYS.has(lower)) return '[REDACTED]'
  if (value === null || value === undefined) return value
  if (IDENTIFIER_KEYS.has(lower) && typeof value !== 'object') return maskTail(value)
  // Strings only: a key like `text` may also hold a count (message types).
  if (PERSONAL_KEYS.has(lower) && typeof value === 'string') return `[redacted ${value.length} chars]`

  if (Array.isArray(value)) return value.map((item) => redact(item, key))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k)
    return out
  }
  return typeof value === 'string' ? scrubText(value) : value
}

export function logEvent(label, payload) {
  console.log(`[${label}]`, JSON.stringify(redact(payload)))
}

export function logError(label, err) {
  const detail = err instanceof Error ? err.stack || err.message : String(err)
  console.error(`[${label}]`, scrubText(detail))
}
