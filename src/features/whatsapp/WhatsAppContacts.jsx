import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { apiDelete, apiGet, apiUpload } from '../../lib/api'
import { useAccess } from '../../lib/access'
import { ResultCount, SearchField } from '../../components/crm/CrmUi'
import {
  Alert, Avatar, Badge, EmptyState, PageHeader, Panel, Spinner, Table, Td, Th,
} from './ui'

export default function WhatsAppContacts() {
  const { can } = useAccess()
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const inputRef = useRef(null)

  const load = useCallback((term) => {
    setLoading(true)
    apiGet(`/contacts?search=${encodeURIComponent(term)}`)
      .then((data) => setContacts(data.contacts))
      .catch((err) => setNotice({ tone: 'error', text: err.message }))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => load(search), 250)
    return () => clearTimeout(timer)
  }, [search, load])

  async function handleFile(file) {
    if (!file) return
    setUploading(true)
    setNotice(null)
    try {
      const result = await apiUpload('/contacts/import', file)
      setNotice({
        tone: 'success',
        text: `Imported ${result.imported} new contact${result.imported === 1 ? '' : 's'}`
          + `${result.updated ? `, refreshed ${result.updated}` : ''} from ${result.totalRows} rows. `
          + `${result.invalid} had no usable phone. Phone read from "${result.phoneColumn}".`,
      })
      load(search)
    } catch (err) {
      setNotice({ tone: 'error', text: err.message })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id))

  async function handleDelete(mode) {
    const label = mode === 'all'
      ? `all ${contacts.length} contacts`
      : `${selected.size} selected contact${selected.size === 1 ? '' : 's'}`
    // eslint-disable-next-line no-restricted-globals
    if (!confirm(`Permanently delete ${label}? This cannot be undone.`)) return

    setDeleting(true)
    setNotice(null)
    try {
      const payload = mode === 'all' ? { all: true } : { contactIds: [...selected] }
      await apiDelete('/contacts', payload)
      setNotice({ tone: 'success', text: `Deleted ${label}.` })
      setSelected(new Set())
      load(search)
    } catch (err) {
      setNotice({ tone: 'error', text: err.message })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="wa-page">
      <PageHeader
        title="Contacts"
        subtitle="The audience pool for every campaign. Import from Excel, CSV or JSON."
      />

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {can('wa_contacts.import') && <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]) }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        className={`flex cursor-pointer flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border
          border-dashed px-4 py-3 text-center text-[13px] transition
          ${dragging
            ? 'border-brand bg-brand-soft text-ink'
            : 'border-line text-muted hover:border-brand hover:bg-brand-soft hover:text-ink'}`}
      >
        {uploading ? <Spinner /> : <Icon name="upload" size={16} />}
        <span>
          {uploading
            ? 'Importing…'
            : 'Drop an Excel, CSV or JSON file, or click to choose. The phone column is found for you, and +91 is added when missing.'}
        </span>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".csv,.xlsx,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>}

      <div className="crm-toolbar mb-2.5 mt-3.5">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search name, phone or company"
          label="Search contacts"
        />
        <ResultCount total={contacts.length} shown={contacts.length} noun="contact" filtered={!!search.trim()} />
      </div>

      <Panel>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-line
            bg-brand-soft px-3.5 py-2.5 text-[12.8px]">
            <span><strong>{selected.size}</strong> selected</span>
            <div className="flex items-center gap-2.5">
              {can('wa_contacts.delete') && <><button
                type="button"
                onClick={() => handleDelete('selected')}
                disabled={deleting}
                className="font-medium text-red-400 underline hover:text-red-300"
              >
                {deleting ? 'Deleting…' : 'Delete selected'}
              </button>
              <button
                type="button"
                onClick={() => handleDelete('all')}
                disabled={deleting}
                className="font-medium text-red-400 underline hover:text-red-300"
              >
                Delete all
              </button></>}
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="font-medium text-brand-ink underline dark:text-[#5ba0e0]"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <EmptyState>Loading contacts…</EmptyState>
        ) : contacts.length === 0 ? (
          <EmptyState title="Nothing here yet">Import a spreadsheet to build your audience.</EmptyState>
        ) : (
          <Table
            head={
              <>
                <Th tight>
                  <input
                    type="checkbox"
                    className="h-[15px] w-[15px] cursor-pointer accent-brand"
                    checked={allSelected}
                    onChange={(e) => setSelected(
                      e.target.checked ? new Set(contacts.map((c) => c.id)) : new Set(),
                    )}
                    aria-label="Select all contacts"
                  />
                </Th>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Company</Th>
                <Th>Email</Th>
                <Th tight>Status</Th>
              </>
            }
          >
            {contacts.map((contact) => (
              <tr
                key={contact.id}
                onClick={() => toggle(contact.id)}
                className={`cursor-pointer transition-colors
                  ${selected.has(contact.id) ? 'bg-brand-soft' : 'hover:bg-line-soft'}`}
              >
                <Td tight onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="h-[15px] w-[15px] cursor-pointer accent-brand"
                    checked={selected.has(contact.id)}
                    onChange={() => toggle(contact.id)}
                    aria-label={`Select ${contact.name || contact.phone}`}
                  />
                </Td>
                <Td>
                  <span className="flex items-center gap-2.5">
                    <Avatar name={contact.name} phone={contact.phone} />
                    {contact.name || <span className="text-muted">Unnamed</span>}
                  </span>
                </Td>
                <Td>+{contact.phone}</Td>
                <Td className="text-muted">{contact.company || '—'}</Td>
                <Td className="text-muted">{contact.email || '—'}</Td>
                <Td tight>
                  <Badge tone={contact.opted_out ? 'danger' : 'success'}>
                    {contact.opted_out ? 'Opted out' : 'Subscribed'}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  )
}
