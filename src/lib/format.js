/**
 * Display formatting utilities — values, money, dates.
 * No React, no side effects.
 */

export function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

export function getValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
      return row[key]
    }
  }
  return null
}

export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return formatValue(value)
  return number.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Dates come back from PostgREST as `date` or `timestamptz` strings. The rest of
// the app shows them as stored rather than reformatting, so this only trims a
// timestamp down to its day.
export function formatDate(value) {
  if (!value) return '—'
  return String(value).slice(0, 10)
}

// `<input type="date">` only accepts YYYY-MM-DD, so a timestamp column is
// trimmed to its day rather than silently rejected.
export function formatDateInput(value) {
  return value ? String(value).slice(0, 10) : ''
}
