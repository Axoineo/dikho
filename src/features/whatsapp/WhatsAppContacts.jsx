import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { apiGet, apiUpload } from '../../lib/api'
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
        text: `Imported ${result.imported} of ${result.totalRows} rows. `
          + `${result.duplicates} duplicate(s) skipped, ${result.invalid} invalid.`,
      })
      load(search)
    } catch (err) {
      setNotice({ tone: 'error', text: err.message })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="The audience pool for every campaign. Import from Excel or CSV."
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
          {uploading ? 'Importing…' : 'Drop an Excel (.xlsx) or CSV file here'}
        </div>
        <div className="text-[12.5px] text-muted">
          Needs a <strong>phone</strong> column. Optional: name, email, company.
          Indian 10-digit numbers get the 91 country code automatically.
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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

        {loading ? (
          <EmptyState>Loading contacts…</EmptyState>
        ) : contacts.length === 0 ? (
          <EmptyState title="Nothing here yet">Import a spreadsheet to build your audience.</EmptyState>
        ) : (
          <Table
            head={
              <>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Company</Th>
                <Th>Email</Th>
                <Th tight>Status</Th>
              </>
            }
          >
            {contacts.map((contact) => (
              <tr key={contact.id} className="transition-colors hover:bg-brand-soft">
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
