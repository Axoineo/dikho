// Normalises to bare E.164 digits (no "+"), which is what the Meta Cloud API
// expects in the `to` field and what we store so webhook lookups match.

const DEFAULT_COUNTRY_CODE = '91'

export function normalisePhone(input, defaultCountryCode = DEFAULT_COUNTRY_CODE) {
  const digits = String(input ?? '').replace(/\D/g, '')
  if (!digits) return null

  // A local 10-digit number, or one written as 0XXXXXXXXXX.
  if (digits.length === 10) return defaultCountryCode + digits
  if (digits.length === 11 && digits.startsWith('0')) return defaultCountryCode + digits.slice(1)

  // Already carries a country code.
  if (digits.length >= 11 && digits.length <= 15) return digits

  return null
}
