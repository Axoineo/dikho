import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { apiDelete, apiGet, apiUpload } from '../../lib/api'
import {
  Alert, Avatar, Badge, EmptyState, PageHeader, Panel, PanelHead, Spinner, Table, Td, Th, inputClass,
} from './ui'

export default function WhatsAppContacts() {
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
    <>
      <PageHeader
        title="Contacts"
        subtitle="The audience pool for every campaign. Import from Excel, CSV or JSON."
      />

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]) }}
        className={`cursor-pointer rounded-xl border-[1.5px] border-dashed px-6 py-[30px] text-center transition
          ${dragging
            ? 'scale-[1.008] border-brand bg-brand-soft'
            : 'border-line bg-line-soft hover:border-brand hover:bg-brand-soft'}`}
      >
        <div className="mx-auto mb-3 grid h-[46px] w-[46px] place-items-center rounded-xl
          bg-brand-soft text-brand dark:text-[#5ba0e0]">
          {uploading ? <Spinner /> : <Icon name="upload" size={21} />}
        </div>
        <div className="mb-1 text-sm font-semibold">
          {uploading ? 'Importing…' : 'Drop an Excel, CSV or JSON file here'}
        </div>
        <div className="text-[12.5px] text-muted">
          We auto-detect the phone column (any name works) and add <strong>+91</strong> when the
          country code is missing. Every other column is saved for use as a variable.
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".csv,.xlsx,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      <Panel className="mt-[18px]">
        <PanelHead
          title="All contacts"
          subtitle={`${contacts.length} record${contacts.length === 1 ? '' : 's'}`}
        >
          <input
            className={`${inputClass} max-w-[260px]`}
            placeholder="Search name, phone or company"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </PanelHead>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-line
            bg-brand-soft px-3.5 py-2.5 text-[12.8px]">
            <span><strong>{selected.size}</strong> selected</span>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => handleDelete('selected')}
                disabled={deleting}
                className="font-semibold text-red-400 underline hover:text-red-300"
              >
                {deleting ? 'Deleting…' : 'Delete selected'}
              </button>
              <button
                type="button"
                onClick={() => handleDelete('all')}
                disabled={deleting}
                className="font-semibold text-red-400 underline hover:text-red-300"
              >
                Delete all
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="font-semibold text-brand underline dark:text-[#5ba0e0]"
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
                className={`cursor-pointer transition-colors hover:bg-brand-soft
                  ${selected.has(contact.id) ? 'bg-brand-soft' : ''}`}
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
    </>
  )
}
