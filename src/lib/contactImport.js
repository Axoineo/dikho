// Reads contacts out of an uploaded sheet, in the browser: which row holds the headers, which
// column is the phone number (and which are spare phone columns), and which are
// the name, email and company. Every cell is untrusted text.
//
// Phone numbers are checked with libphonenumber-js (Google's numbering rules),
// not a digit count, so a 12-digit order ID or a landline is not mistaken for a
// WhatsApp number. Numbers come back as E.164 digits without "+", the format
// the rest of the app stores and Meta expects.
import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import { normalizeKey } from './templateVars.js'

const DEFAULT_COUNTRY = 'IN'

// Number types that can hold WhatsApp. Landlines, toll-free and premium numbers
// are refused: a campaign to them fails (131026) and only costs a send.
const WHATSAPP_TYPES = new Set(['MOBILE', 'FIXED_LINE_OR_MOBILE', 'PERSONAL_NUMBER', 'VOIP', undefined])

/* ── Phone numbers ─────────────────────────────────────────────────────── */

// Excel and pandas exports mangle long numbers: 9876543210.0, 9.19876543210E+11,
// or 9.19877E+11 when the digits were rounded away on export. Returns the
// digits, or { lost: true } when they cannot be recovered.
function unmangleNumber(text) {
  if (/^\d+\.0+$/.test(text)) return { text: text.replace(/\.0+$/, '') }
  const sci = text.match(/^(\d)(?:\.(\d+))?e\+?(\d{1,2})$/i)
  if (!sci) return { text }
  const mantissa = sci[1] + (sci[2] ?? '')
  const width = Number(sci[3]) + 1
  if (mantissa.replace(/0+$/, '').length > width) return { text }
  // A spreadsheet that displayed the number as 9.19877E+11 saved only those
  // six digits; the rest are gone. A full-precision export keeps 8 or more.
  if (width >= 10 && mantissa.length <= 7) return { lost: true }
  return { text: mantissa.padEnd(width, '0') }
}

function parseOne(text, country) {
  const cleaned = text.replace(/^'+/, '').trim()
  if (!/\d/.test(cleaned)) return null
  let number = parsePhoneNumberFromString(cleaned, country)
  // "919876543210" without its "+" is usually caught above; anything else with
  // a country code but no plus gets one more try as international.
  if (!number?.isValid()) {
    const digits = cleaned.replace(/\D/g, '')
    if (digits.length >= 11 && digits.length <= 15) number = parsePhoneNumberFromString(`+${digits}`)
  }
  if (!number?.isValid()) return { reason: 'invalid' }
  // 9999999999 and friends: valid by the rules, never a real person.
  if (new Set(number.nationalNumber).size <= 2) return { reason: 'invalid' }
  if (!WHATSAPP_TYPES.has(number.getType())) return { reason: 'landline' }
  return { phone: number.number.slice(1) }
}

// { phone } for a WhatsApp-capable number, else { reason }: empty, invalid,
// landline, or scientific (Excel rounded the digits away). A cell holding two
// numbers ("98765 43210 / 91234 56789") yields the first usable one.
export function readPhone(value, country = DEFAULT_COUNTRY) {
  const raw = String(value ?? '').trim()
  if (!raw) return { reason: 'empty' }
  if (raw.length > 80) return { reason: 'invalid' }

  const fixed = unmangleNumber(raw.replace(/\s+/g, ' '))
  if (fixed.lost) return { reason: 'scientific' }

  const parts = fixed.text.split(/\s*(?:[/,;|&]|\bor\b)\s*/i).filter(Boolean)
  let firstFailure = null
  for (const part of parts.slice(0, 4)) {
    const result = parseOne(part, country)
    if (result?.phone) return result
    if (result && !firstFailure) firstFailure = result
  }
  return firstFailure ?? { reason: 'invalid' }
}

/* ── Header row ────────────────────────────────────────────────────────── */

const HEADER_WORDS = new Set([
  'name', 'names', 'phone', 'mobile', 'mob', 'whatsapp', 'number', 'no', 'num', 'contact', 'email', 'mail',
  'city', 'company', 'address', 'state', 'cell', 'tel', 'telephone', 'customer', 'client', 'first', 'last',
  'sr', 'sno', 'serial', 'id', 'date', 'amount', 'area', 'pincode', 'pin', 'gender', 'age', 'remarks',
  'notes', 'status', 'source', 'business', 'firm', 'party', 'person', 'designation', 'location', 'district',
])

function cells(row) {
  return (row ?? []).map((cell) => String(cell ?? '').trim()).filter(Boolean)
}

function looksLikeHeaderRow(row) {
  const filled = cells(row)
  return filled.length > 0 && filled.every((cell) =>
    cell.length <= 60 && !cell.includes('@') && (cell.match(/\d/g)?.length ?? 0) < 5)
}

// How much a row reads like column headers: the number of its cells holding a
// header word, plus the share of its cells that do. "Name, Phone, City" beats
// a title line ("Customer list 2026") and a contact whose number is blank.
function headerScore(row) {
  const filled = cells(row)
  const matching = filled.filter((cell) => cell.toLowerCase().split(/[^a-z]+/).some((word) => HEADER_WORDS.has(word))).length
  return filled.length ? matching + matching / filled.length : 0
}

// Index of the header row in a raw sheet, or -1 when the sheet has none (the
// first row is already a contact). Title lines above the headers are skipped,
// and a contact with a blank phone just under the headers is not mistaken for them.
export function pickHeaderRow(matrix) {
  const scan = Math.min(matrix.length, 20)
  let firstData = -1
  for (let i = 0; i < scan; i += 1) {
    if ((matrix[i] ?? []).some((cell) => readPhone(cell).phone)) { firstData = i; break }
  }
  if (firstData === -1) return 0
  if (firstData === 0) return -1
  let best = -1
  let bestScore = 0
  for (let r = 0; r < firstData; r += 1) {
    const score = looksLikeHeaderRow(matrix[r]) ? headerScore(matrix[r]) : 0
    if (score >= bestScore && score > 0) { best = r; bestScore = score }
  }
  if (best >= 0) return best
  return looksLikeHeaderRow(matrix[firstData - 1]) ? firstData - 1 : 0
}

/* ── Columns ───────────────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function sample(rows, column, limit = 500) {
  const values = []
  for (const row of rows) {
    const value = String(row[column] ?? '').trim()
    if (value) values.push(value)
    if (values.length >= limit) break
  }
  return values
}

function share(values, test) {
  return values.length ? values.filter(test).length / values.length : 0
}

// Header words that rank a phone column: the WhatsApp number first, then the
// main mobile, then anything that only says "number"; alternates rank last.
function phoneHint(norm) {
  let bonus = 0
  if (/whatsapp|^wa(no|number)?$/.test(norm)) bonus = 0.3
  else if (/mobile|phone|cell|^mob|contactno|contactnumber/.test(norm)) bonus = 0.2
  else if (/number|contact|tel|msisdn/.test(norm)) bonus = 0.1
  if (/alt|alternate|secondary|other|landline|office|fax|emergency|father|mother|guardian|parent|home/.test(norm)) bonus -= 0.15
  return bonus
}

// Words that make a "...name" header someone other than the contact.
const NOT_THE_CONTACT = /company|business|firm|shop|store|brand|org|agency|employer|user|file|product|item|father|mother|husband|wife|spouse|guardian|parent|city|town|state|country|area|district|village|branch|bank|account|plan|package|course|event|category|group|campaign|template|agent|executive|staff|employee|sales|manager|refer|source|school|college|hospital|street|road|building|society|project/

function nameScore(norm) {
  if (NOT_THE_CONTACT.test(norm)) return 0
  if (norm === 'name' || norm === 'names') return 100
  if (/^(full|contact|customer|client|person|party|lead|guest|member|student|recipient|buyer|owner|display)?names?$/.test(norm)) return 90
  if (['customer', 'client', 'contact', 'person', 'party', 'contactperson', 'nameofcustomer', 'nameofclient'].includes(norm)) return 85
  if (/name$|^name/.test(norm) && !/first|last|sur|middle/.test(norm)) return 70
  return 0
}

const looksLikeName = (value) =>
  value.length <= 80 && /\p{L}/u.test(value) && !value.includes('@') && (value.match(/\d/g)?.length ?? 0) <= value.length * 0.2

function companyScore(norm) {
  if (/phone|mobile|email|mail|address|gst|^pan|pan(no|number)?$|type|category|size|id$|number|no$/.test(norm)) return 0
  if (['company', 'companyname', 'business', 'businessname', 'firm', 'firmname', 'organisation', 'organization', 'organisationname', 'organizationname'].includes(norm)) return 100
  if (/company|organisation|organization|firm|business|brand|shop|store|employer|agency|enterprise|institution/.test(norm)) return 70
  return 0
}

function bestBy(columns, score) {
  let best = null
  let bestScore = 0
  for (const column of columns) {
    const value = score(column)
    if (value > bestScore) { best = column; bestScore = value }
  }
  return best
}

// Which column is which. `headerless` sheets carry generated names
// ("Column A"), so the name column is then found from the values alone.
export function detectColumns(columns, rows, { headerless = false } = {}) {
  // A column qualifies when most of its filled cells are numbers; it ranks by
  // how many of ALL rows it covers, so a mostly empty "Alternate No" stays a
  // spare behind the main mobile column.
  const sampled = Math.min(rows.length, 500) || 1
  const phoneColumns = columns
    .map((column) => {
      const values = sample(rows, column)
      const valid = values.filter((value) => Boolean(readPhone(value).phone)).length
      const ratio = values.length ? valid / values.length : 0
      return { column, ratio, rank: valid / sampled + phoneHint(normalizeKey(column)) }
    })
    .filter((candidate) => candidate.ratio >= 0.3)
    .sort((a, b) => b.rank - a.rank)
    .map((candidate) => candidate.column)

  const others = columns.filter((column) => !phoneColumns.includes(column))

  const emailColumn = bestBy(others, (column) => {
    const ratio = share(sample(rows, column), (value) => EMAIL_RE.test(value))
    return ratio >= 0.6 ? ratio + (/mail/.test(normalizeKey(column)) ? 0.5 : 0) : 0
  })

  const textColumns = others.filter((column) => column !== emailColumn)
  let nameColumn = bestBy(textColumns, (column) => {
    const score = nameScore(normalizeKey(column))
    return score && share(sample(rows, column), looksLikeName) >= 0.6 ? score : 0
  })

  let firstNameColumn = null
  let lastNameColumn = null
  if (!nameColumn) {
    firstNameColumn = textColumns.find((column) => /^(first|given)(name)?$|^fname$/.test(normalizeKey(column))) ?? null
    lastNameColumn = textColumns.find((column) => /^(last|sur|family)(name)?$|^lname$/.test(normalizeKey(column))) ?? null
    if (!firstNameColumn) lastNameColumn = null
  }

  if (!nameColumn && !firstNameColumn && headerless) {
    // No headers to go by: the column of short, mostly distinct, name-like text.
    nameColumn = bestBy(textColumns, (column) => {
      const values = sample(rows, column)
      const nameLike = share(values, (value) => looksLikeName(value) && value.split(/\s+/).length <= 4)
      const distinct = new Set(values).size / (values.length || 1)
      return nameLike >= 0.8 && distinct >= 0.5 ? nameLike + distinct : 0
    })
  }

  const companyColumn = bestBy(
    textColumns.filter((column) => ![nameColumn, firstNameColumn, lastNameColumn].includes(column)),
    (column) => {
      const score = companyScore(normalizeKey(column))
      return score && share(sample(rows, column), (value) => /\p{L}/u.test(value)) >= 0.6 ? score : 0
    },
  )

  return { phoneColumns, nameColumn, firstNameColumn, lastNameColumn, emailColumn, companyColumn }
}

/* ── One row ───────────────────────────────────────────────────────────── */

// Word by word: RAHUL SHARMA and priya nair become Rahul Sharma and Priya
// Nair; a word already in mixed case ("McDonald", "iPhone") is left as typed.
export function tidyName(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!text) return null
  return text.split(' ').map((word) => {
    const letters = word.replace(/[^\p{L}]/gu, '')
    if (letters && letters !== letters.toUpperCase() && letters !== letters.toLowerCase()) return word
    return word.toLowerCase().replace(/(^|[-'.])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase())
  }).join(' ')
}

function tidyEmail(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return text && text.length <= 254 && EMAIL_RE.test(text) ? text : null
}

// The contact in one row, or { reason } when it has no usable number. The
// main phone column is read first, then any spare phone columns; a sheet with
// no phone column at all is searched cell by cell.
export function readContactRow(row, columns, detected) {
  const tryColumns = detected.phoneColumns.length ? detected.phoneColumns : columns
  let phone = null
  let reason = 'empty'
  for (const column of tryColumns) {
    const result = readPhone(row[column])
    if (result.phone) { phone = result.phone; break }
    if (reason === 'empty' && result.reason !== 'empty') reason = result.reason
  }
  if (!phone) return { reason }

  const name = detected.nameColumn
    ? tidyName(row[detected.nameColumn])
    : detected.firstNameColumn
      ? tidyName([row[detected.firstNameColumn], detected.lastNameColumn ? row[detected.lastNameColumn] : ''].join(' '))
      : null

  return {
    phone,
    name,
    email: detected.emailColumn ? tidyEmail(row[detected.emailColumn]) : null,
    company: detected.companyColumn ? String(row[detected.companyColumn] ?? '').trim().slice(0, 160) || null : null,
  }
}
