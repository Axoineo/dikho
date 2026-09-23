import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ok } from '../../utils/response.js'
import { parseContactFile } from '../../utils/parseSheet.js'
import { normalisePhone } from '../../utils/phone.js'

const contacts = new Hono()

const MAX_IMPORT_ROWS = 5000

// Spreadsheets in the wild label the same column a dozen ways.
const COLUMN_ALIASES = {
  name: ['name', 'full name', 'contact name', 'customer name', 'client name'],
  phone: ['phone', 'mobile', 'whatsapp', 'number', 'phone number', 'mobile number', 'contact'],
  email: ['email', 'email id', 'e-mail', 'mail'],
  company: ['company', 'organisation', 'organization', 'firm', 'business'],
}

function pick(record, field) {
  for (const alias of COLUMN_ALIASES[field]) {
    if (record[alias]) return record[alias]
  }
  return ''
}

/* ── GET /api/contacts ─────────────────────────────────────────────────── */

contacts.get('/', async (c) => {
  const search = (c.req.query('search') || '').trim()
  const limit = Math.min(Number(c.req.query('limit')) || 200, 1000)

  const where = search ? 'WHERE name LIKE ?1 OR phone LIKE ?1 OR company LIKE ?1' : ''
  const statement = c.env.DB.prepare(
    `SELECT id, name, phone, email, company, opted_out, created_at
     FROM contacts ${where}
     ORDER BY created_at DESC
     LIMIT ${limit}`,
  )

  const { results } = await (search ? statement.bind(`%${search}%`) : statement).all()
  return ok(c, { contacts: results })
})

/* ── POST /api/contacts/import ─────────────────────────────────────────── */

contacts.post('/import', async (c) => {
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new HTTPException(400, { message: 'No file uploaded under the "file" field' })
  }

  let records
  try {
    records = await parseContactFile(file)
  } catch (err) {
    throw new HTTPException(400, { message: `Could not read the file: ${err.message}` })
  }

  if (records.length === 0) {
    throw new HTTPException(400, { message: 'The file has no data rows' })
  }
  if (records.length > MAX_IMPORT_ROWS) {
    throw new HTTPException(400, {
      message: `File has ${records.length} rows; the limit per import is ${MAX_IMPORT_ROWS}`,
    })
  }

  // Validate and de-duplicate within the file before touching the database,
  // so one upload cannot fight itself over the UNIQUE(phone) constraint.
  const seen = new Set()
  const valid = []
  let invalid = 0

  for (const record of records) {
    const phone = normalisePhone(pick(record, 'phone'))
    if (!phone) { invalid += 1; continue }
    if (seen.has(phone)) continue
    seen.add(phone)

    valid.push({
      name: pick(record, 'name') || null,
      phone,
      email: pick(record, 'email') || null,
      company: pick(record, 'company') || null,
    })
  }

  if (valid.length === 0) {
    throw new HTTPException(400, {
      message: 'No rows had a usable phone number. Check that a "phone" column exists.',
    })
  }

  // INSERT OR IGNORE lets the UNIQUE(phone) index absorb contacts that are
  // already in the database; meta.changes tells us which ones actually landed.
  const insert = c.env.DB.prepare(
    `INSERT OR IGNORE INTO contacts (name, phone, email, company, source)
     VALUES (?, ?, ?, ?, 'import')`,
  )
  const results = await c.env.DB.batch(
    valid.map((row) => insert.bind(row.name, row.phone, row.email, row.company)),
  )

  const imported = results.reduce((total, result) => total + (result.meta?.changes ?? 0), 0)

  return ok(c, {
    totalRows: records.length,
    imported,
    duplicates: valid.length - imported,
    invalid,
  })
})

export default contacts
