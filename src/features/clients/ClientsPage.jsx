import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPhone } from '../../lib/format'
import { isActiveStatus } from '../../lib/status'
import { Icon } from '../../components/Icon'
import {
  PageHeader, SearchField, ResultCount, Pagination, StatusPill, Cell, RowTitle, RowChevron,
  SkeletonRows, EmptyState, ShareLink, Toast,
} from '../../components/crm/CrmUi'
import ClientDetails from './ClientDetails'
import ClientForm from './ClientForm'
import { useAccess } from '../../lib/access'
import { preferredPageSize } from '../../lib/settings'

const PAGE_SIZES = [25, 50, 100]
const COLUMNS = 6

export default function ClientsPage() {
  const { can } = useAccess()
  const [clients, setClients] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => preferredPageSize(PAGE_SIZES))
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  // `editing` is null when the form is closed, {} for a new client, or the
  // client being edited.
  const [editing, setEditing] = useState(null)
  const [selectedClient, setSelectedClient] = useState(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchInput.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false

    async function loadClients() {
      setLoading(true)
      setError('')

      const from = (page - 1) * pageSize
      let request = supabase
        .from('clients')
        .select('*', { count: 'exact' })
        .order('id', { ascending: false })
        .range(from, from + pageSize - 1)

      if (query) {
        const safeQuery = query.replace(/[%_]/g, '').replace(/[(),]/g, ' ').trim()
        if (safeQuery) {
          request = request.or(
            `company_name.ilike.%${safeQuery}%,contact_person.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%,gstin.ilike.%${safeQuery}%,pan_number.ilike.%${safeQuery}%`
          )
        }
      }

      const { data, count, error: fetchError } = await request
      if (cancelled) return

      if (fetchError) {
        console.error(fetchError)
        setClients([])
        setTotalCount(0)
        setError(fetchError.message)
      } else {
        setClients(data || [])
        setTotalCount(count || 0)
      }
      setLoading(false)
    }

    loadClients()
    return () => { cancelled = true }
  }, [page, pageSize, query, reloadKey])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalCount)

  function afterSaved(saved) {
    const wasEdit = Boolean(editing?.id)
    setEditing(null)
    if (wasEdit) {
      // Show the change at once; the row keeps its place in the list.
      setClients((current) => current.map((row) => (row.id === saved.id ? { ...row, ...saved } : row)))
      setSelectedClient((current) => (current?.id === saved.id ? { ...current, ...saved } : current))
      setNotice('Client saved')
    } else {
      // A new client is the newest row: back to the top of the full list.
      setSearchInput('')
      setQuery('')
      setPage(1)
      setReloadKey((key) => key + 1)
      setSelectedClient(saved?.id ? saved : null)
      setNotice('Client added')
    }
  }

  const canCreate = can('clients.create')
  const canEdit = can('clients.edit')

  return (
    <div className="crm-page">
      <PageHeader title="Clients" subtitle="Companies you sell to, with their contacts and tax details.">
        <ShareLink
          title="Corporate gifting link"
          description="Anyone with this link can send their details without signing in. Submissions arrive as leads for review."
          path="/CorporateGifting"
        />
        {canCreate && (
          <button type="button" className="crm-btn crm-btn--primary" onClick={() => setEditing({})}>
            <Icon name="plus" size={17} /> New client
          </button>
        )}
      </PageHeader>

      <div className="crm-toolbar">
        <SearchField
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Search by company, contact, email, GSTIN or PAN"
          label="Search clients"
        />
        {!loading && <ResultCount shown={totalCount} total={totalCount} noun="client" filtered={Boolean(query)} />}
      </div>

      {error && (
        <div className="crm-note crm-note--danger" role="alert">
          <Icon name="alert" size={17} />
          <div><strong>Could not load clients.</strong> {error}</div>
        </div>
      )}

      <section className="crm-card">
        <div className="crm-table-scroll">
          <table className="crm-table">
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Company</th>
                <th className="crm-hide-sm" style={{ width: '24%' }}>Contact</th>
                <th className="crm-hide-sm" style={{ width: '15%' }}>Location</th>
                <th className="crm-hide-sm crm-hide-lg" style={{ width: '17%' }}>GSTIN / PAN</th>
                <th style={{ width: '110px' }}>Status</th>
                <th className="crm-col-tight" style={{ width: '36px' }} aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} columns={COLUMNS} />
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS} className="crm-empty-cell">
                    {query ? (
                      <EmptyState title="No clients match your search">
                        Try part of the company name, a contact, an email address, a GSTIN or a PAN.
                      </EmptyState>
                    ) : (
                      <EmptyState icon="clients" title="No clients yet"
                        action={canCreate && <button type="button" className="crm-btn crm-btn--primary" onClick={() => setEditing({})}><Icon name="plus" size={16} /> New client</button>}>
                        Add the companies you sell to. Sales orders pick their client from this list.
                      </EmptyState>
                    )}
                  </td>
                </tr>
              ) : (
                clients.map((client) => {
                  const active = isActiveStatus(client.status)
                  const phone = formatPhone(client.country_dialcode, client.contact)
                  const place = [client.city, client.state].filter(Boolean)
                  return (
                    <tr
                      key={client.id}
                      className={`crm-row${selectedClient?.id === client.id ? ' is-selected' : ''}`}
                      onClick={() => setSelectedClient(client)}
                    >
                      <td>
                        <RowTitle name={client.company_name} sub={client.contact_person} onOpen={() => setSelectedClient(client)} />
                      </td>
                      <td className="crm-hide-sm"><Cell main={phone} sub={client.email} mono={false} title={client.email || ''} /></td>
                      <td className="crm-hide-sm"><Cell main={place[0]} sub={place[1] || client.country} /></td>
                      <td className="crm-hide-sm crm-hide-lg"><Cell main={client.gstin} sub={client.pan_number} mono /></td>
                      <td><StatusPill tone={active ? 'active' : 'inactive'}>{active ? 'Active' : 'Inactive'}</StatusPill></td>
                      <td className="crm-col-tight"><RowChevron /></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          start={pageStart}
          end={pageEnd}
          total={totalCount}
          pageSize={pageSize}
          pageSizes={PAGE_SIZES}
          onPage={(next) => setPage(Math.max(1, Math.min(next, totalPages)))}
          onPageSize={(size) => { setPageSize(size); setPage(1) }}
        />
      </section>

      {selectedClient && (
        <ClientDetails
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          onEdit={canEdit ? () => setEditing(selectedClient) : null}
        />
      )}

      {editing && (
        <ClientForm client={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={afterSaved} />
      )}

      <Toast message={notice} onDone={() => setNotice('')} />
    </div>
  )
}
