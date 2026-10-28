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

/* ── Display forms for screens (never for exports, PDFs or inputs) ──────── */

// Set from Settings > Regional (lib/settings.js). The defaults are what the
// screens showed before those settings existed.
const displayFormats = { date: 'd MMM yyyy', number: 'en-IN' }
const DATE_FORMATS = ['d MMM yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd']
const NUMBER_FORMATS = ['en-IN', 'en-US']

export function setDisplayFormats({ date, number } = {}) {
  if (DATE_FORMATS.includes(date)) displayFormats.date = date
  if (NUMBER_FORMATS.includes(number)) displayFormats.number = number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (number) => String(number).padStart(2, '0')

// Read the calendar day straight from the text: going through `new Date()`
// would shift a `date` column by the viewer's timezone offset.
function dayParts(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const [, year, month, day] = match.map(Number)
  return month >= 1 && month <= 12 ? { year, month, day } : null
}

function writeDay({ year, month, day }, format = displayFormats.date) {
  if (format === 'dd/MM/yyyy') return `${pad(day)}/${pad(month)}/${year}`
  if (format === 'yyyy-MM-dd') return `${year}-${pad(month)}-${pad(day)}`
  return `${day} ${MONTHS[month - 1]} ${year}`
}

/** A local date written in one of the date formats, so Settings can show each choice. */
export function formatDayAs(format, date) {
  return writeDay({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }, format)
}

/** "13 Apr 2026" (or 13/04/2026, 2026-04-13, per Settings) */
export function formatDisplayDate(value) {
  if (!value) return '—'
  const parts = dayParts(value)
  return parts ? writeDay(parts) : String(value)
}

/** "1–27 Apr 2026", "28 Mar – 4 Apr 2026", or null when neither date is set. */
export function formatDateRange(start, end) {
  const from = start && dayParts(start)
  const to = end && dayParts(end)
  if (!from && !to) return null
  if (!to) return `From ${formatDisplayDate(start)}`
  if (!from) return `Until ${formatDisplayDate(end)}`
  if (from.year === to.year && from.month === to.month && from.day === to.day) return writeDay(from)
  // Numeric formats read best written out in full.
  if (displayFormats.date !== 'd MMM yyyy' || from.year !== to.year) return `${writeDay(from)} – ${writeDay(to)}`
  if (from.month !== to.month) return `${from.day} ${MONTHS[from.month - 1]} – ${to.day} ${MONTHS[to.month - 1]} ${to.year}`
  return `${from.day}–${to.day} ${MONTHS[to.month - 1]} ${to.year}`
}

/** "₹1,47,500.00" (or ₹147,500.00, per Settings), or "—" when there is no amount. */
export function formatRupees(value) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return formatValue(value)
  return `₹${number.toLocaleString(displayFormats.number, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** A count grouped the way Settings says: 10,320 or 1,00,000. */
export function formatCount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString(displayFormats.number) : String(value ?? '')
}

/** "+91 9876543210" from a dial code stored as 91, "91" or "+91". */
export function formatPhone(dialCode, number) {
  if (number === null || number === undefined || number === '') return null
  const dial = dialCode === null || dialCode === undefined || dialCode === '' ? '' : `+${String(dialCode).replace(/^\+/, '')}`
  return `${dial} ${number}`.trim()
}
