/**
 * Status display and PostgREST error classification utilities.
 * No React, no side effects.
 */

export function isActiveStatus(value) {
  return value === 1 || value === '1' || value === true || value === 'true' || value === 'active' || value === 'Active'
}

// Statuses are open text, so the pill is chosen from what the value reads like
// rather than from a fixed map — a status this module never writes still lands
// somewhere sensible.
export function statusTone(status) {
  const text = String(status ?? '').toLowerCase()
  if (!text) return 'neutral'
  if (/(cancel|reject|hold|fail|void)/.test(text)) return 'danger'
  if (/(complete|approved|closed|paid|done)/.test(text)) return 'active'
  if (/(pending|progress|partial|draft|await|open)/.test(text)) return 'pending'
  return 'neutral'
}

export function missingColumnFrom(error) {
  if (error?.code !== 'PGRST204') return null
  return (String(error.message || '').match(/'([^']+)' column/) || [])[1] || null
}

export function notNullColumnFrom(error) {
  if (error?.code !== '23502') return null
  const from = (text) => (String(text || '').match(/column "([^"]+)"/) || [])[1]
  return from(error.details) || from(error.message) || null
}

export function isIlikeTypeError(error) {
  return error?.code === '42883' || /\bilike\b/i.test(String(error?.message || ''))
}
