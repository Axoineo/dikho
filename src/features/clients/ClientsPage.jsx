import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatValue, getValue } from '../../lib/format'
import { Icon } from '../../components/Icon'
import ClientDetails from './ClientDetails'
import AddClientModal from './AddClientModal'

export default function ClientsPage() {
  const [clients, setClients] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [selectedClient, setSelectedClient] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [showSharePopover, setShowSharePopover] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

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
      const to = from + pageSize - 1

      let request = supabase
        .from('clients')
        .select('*', { count: 'exact' })
        .order('id', { ascending: false })
        .range(from, to)

      if (query) {
        const safeQuery = query
          .replace(/[%_]/g, '')
          .replace(/[(),]/g, ' ')
          .trim()

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

    return () => {
      cancelled = true
    }
  }, [page, pageSize, query])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalCount)

  const pageNumbers = useMemo(() => {
    const current = Math.min(page, totalPages)
    const candidates = [current - 2, current - 1, current, current + 1, current + 2]
    return candidates.filter((number) => number >= 1 && number <= totalPages)
  }, [page, totalPages])

  function changePage(nextPage) {
    const safePage = Math.max(1, Math.min(nextPage, totalPages))
    setPage(safePage)
  }

  function changePageSize(e) {
    setPageSize(Number(e.target.value))
    setPage(1)
  }

  function afterSaved() {
    setShowForm(false)
    setPage(1)
    setQuery('')
    setSearchInput('')
  }

  const currentPageIds = clients.map((client) => client.id)
  const allCurrentSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.includes(id))

  function toggleSelect(id) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  function toggleSelectPage() {
    setSelectedIds((current) => {
      if (allCurrentSelected) return current.filter((id) => !currentPageIds.includes(id))
      return [...new Set([...current, ...currentPageIds])]
    })
  }

  return (
    <div className={`clients-page ${selectedClient ? 'has-selection' : ''}`}>
      <div className="clients-main-content">
      <div className="page-header">
        <div>
          <span className="page-kicker">MASTER DATA</span>
          <h1>Clients</h1>
          <p>Manage your client database</p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
          {showSharePopover && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 300,
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 10, padding: '14px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              minWidth: 320,
            }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Corporate Gifting Welcome Link
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
                Share this link with clients — no login required. Submissions will appear as <strong>Inactive</strong> pending your review.
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  readOnly
                  value={`${window.location.origin}/CorporateGifting`}
                  style={{
                    flex: 1, fontSize: '0.82rem', padding: '7px 10px',
                    border: '1px solid var(--line)', borderRadius: 6,
                    background: 'var(--page)', color: 'var(--text)',
                    fontFamily: 'monospace', outline: 'none',
                  }}
                  onFocus={e => e.target.select()}
                />
                <button
                  className="primary-button"
                  style={{ padding: '7px 14px', fontSize: '0.82rem', flexShrink: 0 }}
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/CorporateGifting`)
                      .then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000) })
                  }}
                >
                  {shareCopied ? <><Icon name="check" size={14} /> Copied!</> : 'Copy'}
                </button>
              </div>
            </div>
          )}
          <button
            className="secondary-button"
            onClick={() => { setShowSharePopover(v => !v); setShareCopied(false) }}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            Share
          </button>
          <button className="primary-button add-button" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={18} />
            Add
          </button>
        </div>
      </div>

      <div className="list-toolbar">
        <div className="search-box">
          <Icon name="search" size={18} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search company, contact, email, GSTIN or PAN..."
            aria-label="Search clients"
          />
          {searchInput && (
            <button className="search-clear" onClick={() => setSearchInput('')} aria-label="Clear search">
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="page-error" role="alert">
          <span className="page-error-icon"><Icon name="alert" size={18} /></span>
          <div>
            <strong>Could not load clients</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <section className="table-card">
        <div className="table-topline">
          <div>
            <strong>All Clients</strong>
            <span className="result-count">{totalCount.toLocaleString()} records</span>
          </div>
          {query && <span className="search-state">Filtered by “{query}”</span>}
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th className="check-column"><button type="button" className={`checkbox-button ${allCurrentSelected ? 'checked' : ''}`} onClick={toggleSelectPage} aria-label="Select all clients on this page">{allCurrentSelected ? <Icon name="check" size={14} /> : null}</button></th>
                <th>ID</th>
                <th>Company Name</th>
                <th>GSTIN</th>
                <th>PAN Number</th>
                <th>Status</th>
                <th className="actions-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: Math.min(pageSize, 8) }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className="skeleton-row">
                    <td><span className="skeleton skeleton-check" /></td>
                    <td><span className="skeleton skeleton-id" /></td>
                    <td><span className="skeleton skeleton-company" /></td>
                    <td><span className="skeleton skeleton-gstin" /></td>
                    <td><span className="skeleton skeleton-pan" /></td>
                    <td><span className="skeleton skeleton-status" /></td>
                    <td><span className="skeleton skeleton-action" /></td>
                  </tr>
                ))
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-state">
                    <div className="empty-title">No clients found</div>
                    <div className="empty-copy">Try a different company name, GSTIN or PAN.</div>
                  </td>
                </tr>
              ) : (
                clients.map((client) => {
                  const status = getValue(client, ['status', 'is_active'])
                  const isActive = status === 1 || status === '1' || status === true || status === 'true' || status === 'active' || status === 'Active'

                  return (
                    <tr key={client.id} onDoubleClick={() => setSelectedClient(client)}>
                      <td className="check-column"><button type="button" className={`checkbox-button ${selectedIds.includes(client.id) ? 'checked' : ''}`} onClick={(e) => { e.stopPropagation(); toggleSelect(client.id) }} aria-label={`Select ${client.company_name}`}>{selectedIds.includes(client.id) ? <Icon name="check" size={14} /> : null}</button></td>
                      <td className="id-cell">{formatValue(client.id)}</td>
                      <td className="company-cell">{formatValue(client.company_name)}</td>
                      <td>{formatValue(client.gstin)}</td>
                      <td>{formatValue(getValue(client, ['pan_number', 'pan']))}</td>
                      <td>
                        <span className={`status-icon ${isActive ? 'active' : 'inactive'}`} title={isActive ? 'Active' : 'Inactive'}>
                          {isActive ? <Icon name="check" size={17} /> : '—'}
                        </span>
                      </td>
                      <td className="actions-column">
                        <button className="row-action" onClick={() => setSelectedClient(client)} aria-label={`Open client ${client.company_name}`}>
                          <Icon name="chevron" size={17} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination-bar">
          <div className="page-size-control">
            <span>Items per page</span>
            <select value={pageSize} onChange={changePageSize}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="75">75</option>
              <option value="100">100</option>
            </select>
          </div>

          <div className="pagination-meta">
            <span>{pageStart} – {pageEnd} of {totalCount.toLocaleString()}</span>
            <div className="pagination-buttons">
              <button onClick={() => changePage(1)} disabled={page <= 1} aria-label="First page"><Icon name="first" size={16} /></button>
              <button onClick={() => changePage(page - 1)} disabled={page <= 1} aria-label="Previous page"><Icon name="chevron" size={16} style={{ transform: 'rotate(180deg)' }} /></button>
              {pageNumbers.map((number) => (
                <button key={number} className={number === page ? 'current' : ''} onClick={() => changePage(number)}>{number}</button>
              ))}
              <button onClick={() => changePage(page + 1)} disabled={page >= totalPages} aria-label="Next page"><Icon name="chevron" size={16} /></button>
              <button onClick={() => changePage(totalPages)} disabled={page >= totalPages} aria-label="Last page"><Icon name="last" size={16} /></button>
            </div>
          </div>
        </div>
      </section>
      </div>

      {selectedClient && (
        <aside className="clients-side-panel"><ClientDetails client={selectedClient} onClose={() => setSelectedClient(null)} /></aside>
      )}

      {showForm && (
        <AddClientModal onClose={() => setShowForm(false)} onSaved={afterSaved} />
      )}
    </div>
  )
}
