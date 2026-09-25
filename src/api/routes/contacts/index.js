import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok } from '../../utils/response.js'
import { parseContactFile } from '../../utils/parseSheet.js'
import { normalisePhone } from '../../utils/phone.js'
import { normalizeKey } from '../../../lib/templateVars.js'

const contacts = new Hono()

const MAX_IMPORT_ROWS = 5000

// Header hints. Detection does not depend on these — the phone column is found
// by which column actually holds phone numbers — but a matching name breaks ties
// and picks the display fields (name/email/company) out of the other columns.
const PHONE_HINTS = ['phone', 'mobile', 'whatsapp', 'number', 'contact', 'cell', 'tel', 'msisdn', 'wa']
const FIELD_ALIASES = {
  name: ['name', 'fullname', 'full name', 'contact name', 'customer name', 'client name', 'send list', 'person'],
  email: ['email', 'email id', 'e-mail', 'mail'],
  company: ['company', 'organisation', 'organization', 'firm', 'business', 'account'],
}

// The column whose values most look like phone numbers, requiring a clear
// majority so a stray numeric column isn't mistaken for it. Returns null when
// no column qualifies (the caller then scans each row cell-by-cell).
function detectPhoneColumn(columns, rows) {
  let best = null
  let bestScore = 0

  for (const column of columns) {
    let filled = 0
    let valid = 0
    for (const row of rows) {
      const value = row[column]
      if (value == null || String(value).trim() === '') continue
      filled += 1
      if (normalisePhone(value)) valid += 1
    }
    if (filled === 0) continue

    let score = valid / filled
    if (PHONE_HINTS.some((hint) => normalizeKey(column).includes(hint))) score += 0.15
    if (score > bestScore) { bestScore = score; best = column }
  }

  return bestScore >= 0.6 ? best : null
}

// Fallback for files with no clear phone column: first cell that normalises.
function phoneFromRow(row) {
  for (const value of Object.values(row)) {
    const phone = normalisePhone(value)
    if (phone) return phone
  }
  return null
}

// Best display column for a standard field, excluding the phone column.
function detectField(columns, field, phoneColumn) {
  const candidates = columns
    .filter((column) => column !== phoneColumn)
    .map((column) => [column, normalizeKey(column)])
  const aliases = FIELD_ALIASES[field].map(normalizeKey)

  for (const alias of aliases) {
    const exact = candidates.find(([, norm]) => norm === alias)
    if (exact) return exact[0]
  }
  for (const alias of aliases) {
    const partial = candidates.find(([, norm]) => norm.includes(alias))
    if (partial) return partial[0]
  }
  return null
}

/* ── GET /api/contacts ─────────────────────────────────────────────────── */

contacts.get('/', async (c) => {
  const search = (c.req.query('search') || '').trim()
  const limit = Math.min(Number(c.req.query('limit')) || 2000, 5000)

  const where = search ? 'WHERE name LIKE ?1 OR phone LIKE ?1 OR company LIKE ?1' : ''
  const statement = c.env.DB.prepare(
    `SELECT id, name, phone, email, company, attributes, opted_out, created_at
     FROM contacts ${where}
     ORDER BY created_at DESC
     LIMIT ${limit}`,
  )

  const { results } = await (search ? statement.bind(`%${search}%`) : statement).all()

  // attributes is JSON text in D1; hand the client a parsed object so the
  // campaign wizard can read variable keys and sample values directly.
  const parsed = results.map((row) => ({
    ...row,
    attributes: row.attributes ? safeParse(row.attributes) : null,
  }))

  return ok(c, { contacts: parsed })
})

function safeParse(text) {
  try { return JSON.parse(text) } catch { return null }
}

/* ── POST /api/contacts/import ─────────────────────────────────────────── */

contacts.post('/import', async (c) => {
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new HTTPException(400, { message: 'No file uploaded under the "file" field' })
  }

  let table
  try {
    table = await parseContactFile(file)
  } catch (err) {
    throw new HTTPException(400, { message: `Could not read the file: ${err.message}` })
  }

  const { columns, rows } = table
  if (rows.length === 0) throw new HTTPException(400, { message: 'The file has no data rows' })
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new HTTPException(400, {
      message: `File has ${rows.length} rows; the limit per import is ${MAX_IMPORT_ROWS}`,
    })
  }

  const phoneColumn = detectPhoneColumn(columns, rows)
  const nameColumn = detectField(columns, 'name', phoneColumn)
  const emailColumn = detectField(columns, 'email', phoneColumn)
  const companyColumn = detectField(columns, 'company', phoneColumn)

  // Validate and de-duplicate within the file first, so one upload cannot fight
  // itself over the UNIQUE(phone) constraint. Later rows win for a repeated phone.
  const byPhone = new Map()
  let invalid = 0

  for (const row of rows) {
    const phone = phoneColumn ? normalisePhone(row[phoneColumn]) : phoneFromRow(row)
    if (!phone) { invalid += 1; continue }

    // Every column except the detected phone column is retained as an attribute,
    // keyed by its original header, so any template variable can resolve later.
    const attributes = {}
    for (const column of columns) {
      if (column === phoneColumn) continue
      const value = row[column]
      if (value != null && String(value).trim() !== '') attributes[column] = String(value).trim()
    }

    byPhone.set(phone, {
      name: (nameColumn && row[nameColumn]) || null,
      phone,
      email: (emailColumn && row[emailColumn]) || null,
      company: (companyColumn && row[companyColumn]) || null,
      attributes: Object.keys(attributes).length ? JSON.stringify(attributes) : null,
    })
  }

  const valid = [...byPhone.values()]
  if (valid.length === 0) {
    throw new HTTPException(400, {
      message: 'No rows had a usable phone number. Every column was checked; none held valid numbers.',
    })
  }

  // Upsert: a re-uploaded list refreshes attributes and fills any blank fields
  // without clobbering a name/email/company already on record.
  const insert = c.env.DB.prepare(
    `INSERT INTO contacts (name, phone, email, company, attributes, source)
     VALUES (?, ?, ?, ?, ?, 'import')
     ON CONFLICT(phone) DO UPDATE SET
       name = COALESCE(excluded.name, contacts.name),
       email = COALESCE(excluded.email, contacts.email),
       company = COALESCE(excluded.company, contacts.company),
       attributes = excluded.attributes,
       updated_at = datetime('now')`,
  )

  // Count new vs updated by the change in total rows — an upsert reports one
  // change whether it inserted or updated, so a before/after count is exact.
  const before = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM contacts').first()
  await c.env.DB.batch(
    valid.map((row) => insert.bind(row.name, row.phone, row.email, row.company, row.attributes)),
  )
  const after = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM contacts').first()

  const imported = (after?.n ?? 0) - (before?.n ?? 0)

  return ok(c, {
    totalRows: rows.length,
    imported,
    updated: valid.length - imported,
    invalid,
    phoneColumn: phoneColumn || 'auto-detected per row',
  })
})
/* ── DELETE /api/contacts ───────────────────────────────────────────────── */

// Accepts { contactIds: [1, 2, 3] } for selective deletion, or { all: true }
// to wipe the entire contacts pool. Conversations/messages keep their history
// (contact_id is SET NULL by the FK, but we also do it explicitly here for
// safety in case the FK isn't enforced).
contacts.delete('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) throw new HTTPException(400, { message: 'Invalid JSON body' })

  const { contactIds, all } = body

  if (all === true) {
    // Unlink conversations/messages first, then wipe contacts + reset autoincrement.
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE conversations SET contact_id = NULL WHERE contact_id IS NOT NULL'),
      c.env.DB.prepare('UPDATE messages SET contact_id = NULL WHERE contact_id IS NOT NULL AND conversation_id IS NOT NULL'),
      c.env.DB.prepare('DELETE FROM contacts'),
      c.env.DB.prepare("DELETE FROM sqlite_sequence WHERE name = 'contacts'"),
    ])
    return ok(c, { deleted: 'all' })
  }

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    throw new HTTPException(400, { message: 'Provide contactIds (array) or { all: true }' })
  }

  const ids = contactIds.map(Number).filter(Number.isInteger)
  if (ids.length === 0) {
    throw new HTTPException(400, { message: 'No valid contact IDs provided' })
  }

  // D1 caps bound parameters at 100 per query, so large selections are
  // deleted in chunks rather than one IN (...) list.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const placeholders = chunk.map(() => '?').join(',')
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE conversations SET contact_id = NULL WHERE contact_id IN (${placeholders})`).bind(...chunk),
      c.env.DB.prepare(`UPDATE messages SET contact_id = NULL WHERE contact_id IN (${placeholders}) AND conversation_id IS NOT NULL`).bind(...chunk),
      c.env.DB.prepare(`DELETE FROM contacts WHERE id IN (${placeholders})`).bind(...chunk),
    ])
  }

  return ok(c, { deleted: ids.length })
})

export default contacts
