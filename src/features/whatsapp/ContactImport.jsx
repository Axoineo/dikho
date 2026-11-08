import { useEffect, useMemo, useState } from 'react'
import { apiPost } from '../../lib/api'
import { Alert, Panel, PanelHead, Spinner, inputClass } from './ui'

// Reads a contact sheet in the browser, shows which column it took for the
// phone, name, email and company, and lets the person correct any of them
// before anything is saved. Numbers are checked with libphonenumber-js
// (src/lib/contactImport.js); the Worker re-checks the clean rows it receives.

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_CONTACTS = 5000
const FIRST_LAST = '\u0000first+last'

const REASON = {
  invalid: 'not a valid phone number',
  landline: 'a landline, which cannot get WhatsApp',
  scientific: 'shortened by Excel (like 9.19877E+11)',
  empty: 'no phone number',
  duplicate: 'the same number appears again',
}

async function readFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('The file is larger than 5 MB. Split it into smaller files.')
  const [{ parseContactFile }, importer] = await Promise.all([
    import('../../lib/parseSheet.js'),
    import('../../lib/contactImport.js'),
  ])
  const table = await parseContactFile(file, { pickHeader: importer.pickHeaderRow })
  if (table.rows.length === 0) throw new Error('The file has no rows to import.')
  const detected = importer.detectColumns(table.columns, table.rows, { headerless: table.headerless })
  return { table, detected, importer }
}

function initialMapping(detected) {
  return {
    phone: detected.phoneColumns[0] ?? '',
    name: detected.nameColumn ?? (detected.firstNameColumn ? FIRST_LAST : ''),
    email: detected.emailColumn ?? '',
    company: detected.companyColumn ?? '',
  }
}

// Contacts ready to save, plus why each skipped row was skipped.
function buildContacts({ table, detected, importer }, mapping) {
  const { columns, rows } = table
  const spares = detected.phoneColumns.filter((column) => column !== mapping.phone)
  const plan = {
    phoneColumns: mapping.phone ? [mapping.phone, ...spares] : [],
    nameColumn: mapping.name && mapping.name !== FIRST_LAST ? mapping.name : null,
    firstNameColumn: mapping.name === FIRST_LAST ? detected.firstNameColumn : null,
    lastNameColumn: mapping.name === FIRST_LAST ? detected.lastNameColumn : null,
    emailColumn: mapping.email || null,
    companyColumn: mapping.company || null,
  }

  const byPhone = new Map()
  const skipped = { invalid: 0, landline: 0, scientific: 0, empty: 0, duplicate: 0 }
  const examples = []
  const note = (reason, row) => {
    skipped[reason] += 1
    if (examples.length < 5 && reason !== 'empty') {
      const label = (plan.nameColumn && row[plan.nameColumn]) || ''
      examples.push({ reason, value: String(row[mapping.phone] ?? '').slice(0, 40), label: String(label).slice(0, 40) })
    }
  }

  for (const row of rows) {
    const contact = importer.readContactRow(row, columns, plan)
    if (!contact.phone) { note(contact.reason, row); continue }
    if (byPhone.has(contact.phone)) note('duplicate', row)
    const attributes = {}
    for (const column of columns) {
      if (column === mapping.phone) continue
      const value = String(row[column] ?? '').trim()
      if (value) attributes[column] = value.slice(0, 2000)
    }
    byPhone.set(contact.phone, { ...contact, attributes })
  }
  return { contacts: [...byPhone.values()], skipped, examples }
}

function ColumnSelect({ id, label, value, onChange, columns, noneLabel, extra }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[12px] text-muted">{label}</label>
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{noneLabel}</option>
        {extra}
        {columns.map((column) => <option key={column} value={column}>{column}</option>)}
      </select>
    </div>
  )
}

export function ContactImportReview({ file, onCancel, onImported }) {
  const [state, setState] = useState({ status: 'reading' })
  const [mapping, setMapping] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    setState({ status: 'reading' })
    setError(null)
    readFile(file)
      .then((loaded) => {
        if (!live) return
        setState({ status: 'ready', ...loaded })
        setMapping(initialMapping(loaded.detected))
      })
      .catch((err) => { if (live) setState({ status: 'failed', message: err.message || 'Could not read the file.' }) })
    return () => { live = false }
  }, [file])

  const preview = useMemo(
    () => (state.status === 'ready' && mapping ? buildContacts(state, mapping) : null),
    [state, mapping],
  )

  if (state.status === 'reading') {
    return (
      <Panel className="mb-[18px]">
        <div className="flex items-center gap-2.5 px-3.5 py-4 text-[13px] text-muted">
          <Spinner /> Reading {file.name}…
        </div>
      </Panel>
    )
  }
  if (state.status === 'failed') {
    return (
      <Alert tone="error">
        {state.message}{' '}
        <button type="button" className="font-medium underline" onClick={onCancel}>Close</button>
      </Alert>
    )
  }

  const { table, detected } = state
  const set = (key) => (value) => setMapping((prev) => ({ ...prev, [key]: value }))
  const ready = preview.contacts.length
  const skippedTotal = Object.values(preview.skipped).reduce((sum, n) => sum + n, 0)
  const tooMany = ready > MAX_CONTACTS
  const spares = detected.phoneColumns.filter((column) => column !== mapping.phone)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const result = await apiPost('/contacts/import-rows', { contacts: preview.contacts })
      onImported({ ...result, skipped: preview.skipped })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel className="mb-[18px]">
      <PanelHead
        title={`Check the columns in ${file.name}`}
        subtitle={`${table.rows.length} row${table.rows.length === 1 ? '' : 's'}${table.headerless ? ', no header row found' : ''}. Change any column that was picked wrongly.`}
      />
      <div className="grid gap-3 px-3.5 py-3.5 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        <ColumnSelect id="imp-phone" label="WhatsApp number" value={mapping.phone} onChange={set('phone')}
          columns={table.columns} noneLabel="Search every column" />
        <ColumnSelect id="imp-name" label="Name" value={mapping.name} onChange={set('name')}
          columns={table.columns} noneLabel="None"
          extra={detected.firstNameColumn && detected.lastNameColumn
            ? <option value={FIRST_LAST}>{`${detected.firstNameColumn} + ${detected.lastNameColumn}`}</option>
            : null} />
        <ColumnSelect id="imp-email" label="Email" value={mapping.email} onChange={set('email')}
          columns={table.columns} noneLabel="None" />
        <ColumnSelect id="imp-company" label="Company" value={mapping.company} onChange={set('company')}
          columns={table.columns} noneLabel="None" />
      </div>
      {spares.length > 0 && (
        <p className="m-0 px-3.5 pb-2 text-[12px] text-muted">
          When the WhatsApp number is blank or wrong, {spares.map((s) => `“${s}”`).join(', ')} is tried next.
        </p>
      )}
      <p className="m-0 px-3.5 pb-3 text-[12px] text-muted">
        Every other column is kept for template variables. Names in all capitals or all small letters are tidied
        (RAHUL SHARMA becomes Rahul Sharma).
      </p>

      <div className="border-t border-line px-3.5 py-3 text-[13px]">
        <div><strong>{ready}</strong> contact{ready === 1 ? '' : 's'} ready to import.</div>
        {skippedTotal > 0 && (
          <ul className="mb-0 mt-1.5 pl-5 text-[12.5px] text-muted">
            {Object.entries(preview.skipped).filter(([, n]) => n > 0).map(([reason, n]) => (
              <li key={reason}>{n} skipped: {REASON[reason]}</li>
            ))}
          </ul>
        )}
        {preview.examples.length > 0 && (
          <div className="mt-2 text-[12px] text-muted">
            Examples:{' '}
            {preview.examples.map((ex, i) => (
              <span key={i}>
                {i > 0 && '; '}
                {ex.label && `${ex.label}: `}<code className="text-ink">{ex.value || '(blank)'}</code> ({REASON[ex.reason]})
              </span>
            ))}
          </div>
        )}
        {preview.skipped.scientific > 0 && (
          <Alert tone="warn">
            Excel saved some numbers in a shortened form and the digits are lost. In Excel, format the phone
            column as Text (or Number with 0 decimal places), then save the file again.
          </Alert>
        )}
        {tooMany && <Alert tone="error">An import can hold up to {MAX_CONTACTS} contacts. Split the file.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
      </div>

      <div className="flex flex-wrap justify-end gap-2.5 border-t border-line bg-line-soft px-3.5 py-3">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="primary-button" onClick={save} disabled={saving || ready === 0 || tooMany}>
          {saving ? 'Importing…' : `Import ${ready} contact${ready === 1 ? '' : 's'}`}
        </button>
      </div>
    </Panel>
  )
}
