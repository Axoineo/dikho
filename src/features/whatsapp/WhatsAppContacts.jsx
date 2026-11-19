import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { apiDelete, apiGet } from '../../lib/api'
import { ContactImportReview } from './ContactImport'
import { importSummary } from './labels'
import { useAccess } from '../../lib/access'
import { ResultCount, SearchField } from '../../components/crm/CrmUi'
import {
  Alert, Avatar, Badge, EmptyState, PageHeader, Panel, Table, Td, Th,
} from './ui'

// A page at a time: lists run to thousands, and all of them in the document at
// once froze phones for seconds. The next page loads as the list's end nears.
const PAGE_SIZE = 30
const SEARCH_DELAY_MS = 300
const LOAD_MORE_WITHIN = '200px'
const PHONE_WIDTH = '(max-width: 767px)'

function useIsPhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_WIDTH).matches)
  useEffect(() => {
    const query = window.matchMedia(PHONE_WIDTH)
    const update = () => setPhone(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return phone
}

function ContactCard({ contact, selected, onToggle }) {
  return (
    <label className={`flex min-h-[64px] cursor-pointer items-center gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-b-0
      ${selected ? 'bg-brand-soft' : ''}`}>
      <input
        type="checkbox"
        className="h-5 w-5 shrink-0 cursor-pointer accent-brand"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select ${contact.name || contact.phone}`}
      />
      <Avatar name={contact.name} phone={contact.phone} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-ink">{contact.name || <span className="text-muted">Unnamed</span>}</span>
        <span className="block truncate text-[12.5px] text-muted">+{contact.phone}{contact.company ? ` · ${contact.company}` : ''}</span>
      </span>
      <Badge tone={contact.opted_out ? 'danger' : 'success'}>
        {contact.opted_out ? 'Opted out' : 'Subscribed'}
      </Badge>
    </label>
  )
}

export default function WhatsAppContacts() {
  const { can } = useAccess()
  const phone = useIsPhone()
  const [contacts, setContacts] = useState([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [pendingFile, setPendingFile] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const inputRef = useRef(null)
  const sentinelRef = useRef(null)
  // Only the latest search may land: an older reply arriving last must not win.
  const requestRef = useRef(0)

  const load = useCallback((term) => {
    const request = ++requestRef.current
    setLoading(true)
    apiGet(`/contacts?limit=${PAGE_SIZE}&search=${encodeURIComponent(term)}`)
      .then((data) => {
        if (request !== requestRef.current) return
        setContacts(data.contacts)
        setTotal(data.total ?? data.contacts.length)
        setNextCursor(data.nextCursor ?? null)
      })
      .catch((err) => { if (request === requestRef.current) setNotice({ tone: 'error', text: err.message }) })
      .finally(() => { if (request === requestRef.current) setLoading(false) })
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => load(search), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [search, load])

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return
    const request = requestRef.current
    setLoadingMore(true)
    apiGet(`/contacts?limit=${PAGE_SIZE}&search=${encodeURIComponent(search)}&cursor=${encodeURIComponent(nextCursor)}`)
      .then((data) => {
        if (request !== requestRef.current) return
        setContacts((prev) => [...prev, ...data.contacts])
        setNextCursor(data.nextCursor ?? null)
      })
      .catch((err) => { if (request === requestRef.current) setNotice({ tone: 'error', text: err.message }) })
      .finally(() => setLoadingMore(false))
  }, [nextCursor, loadingMore, search])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !nextCursor) return undefined
    const watcher = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMore() },
      { root: sentinel.closest('.workspace'), rootMargin: `0px 0px ${LOAD_MORE_WITHIN} 0px` },
    )
    watcher.observe(sentinel)
    return () => watcher.disconnect()
  }, [nextCursor, loadMore])

  // The file is read and its columns checked in ContactImportReview, which
  // saves only after the person confirms the columns.
  function handleFile(file) {
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setNotice(null)
    setPendingFile(file)
  }

  function handleImported(result) {
    setPendingFile(null)
    setNotice({ tone: 'success', text: importSummary(result) })
    load(search)
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
      ? `all ${total} contacts`
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

      {pendingFile && (
        <ContactImportReview file={pendingFile} onCancel={() => setPendingFile(null)} onImported={handleImported} />
      )}

      {can('wa_contacts.import') && !pendingFile && <div
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
        <Icon name="upload" size={16} />
        <span>
          Drop an Excel, CSV or JSON file, or click to choose. The columns are found for you and every number is
          checked; you can correct the columns before saving.
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
        <ResultCount total={total} shown={total} noun="contact" filtered={!!search.trim()} />
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
        ) : phone ? (
          <div>
            {contacts.map((contact) => (
              <ContactCard key={contact.id} contact={contact} selected={selected.has(contact.id)} onToggle={() => toggle(contact.id)} />
            ))}
          </div>
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
        {nextCursor && !loading && (
          <div ref={sentinelRef} className="flex justify-center border-t border-line-soft py-3">
            {loadingMore ? <Spinner /> : (
              <button type="button" onClick={loadMore} className="min-h-[44px] rounded-full px-4 text-[13px] font-medium text-brand-ink">
                Load more
              </button>
            )}
          </div>
        )}
      </Panel>
    </div>
  )
}
