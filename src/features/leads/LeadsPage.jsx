import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { apiGet } from '../../lib/api'
import { formatValue } from '../../lib/format'
import { Icon } from '../../components/Icon'
import { ContactHoverAction } from '../../components/ContactHoverAction'
import './LeadsPage.css'

// The manual follow-up message staff send from this page's WhatsApp button —
// separate from the automatic "client_conformation_" confirmation template
// fired on submit (src/api/routes/public/index.js). This one opens a plain
// wa.me chat, so it is free-form text rather than an approved template, and
// only works inside Meta's 24-hour customer-service window like any other
// non-template WhatsApp message.
const FOLLOWUP_MESSAGE = "Hi! I'm reaching out from Dikho. We noticed you were exploring our catalogue, did you find what you were looking for? Let us know if you'd like a quick call from one of our representatives to assist you further."

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100]

// Every lead currently comes from the corporate-gifting form (the only
// source that writes to cg_leads), shown as a badge rather than hardcoded
// into the page copy: Leads is meant to grow into a module covering other
// intake forms later (e.g. outdoor advertising enquiries), each presumably
// its own Supabase table read the same way, all landing in this one list.
const LEAD_SOURCE = 'Corporate Gifting'

// Same digits-only join key the Worker builds when it sends
// (notifyCgLead in src/api/routes/public/index.js) — country_code + mobile,
// non-digits stripped. The two databases share no id, so phone is the only
// thing to join on.
function leadPhoneKey(lead) {
  return `${lead.country_code ?? ''}${lead.mobile ?? ''}`.replace(/\D/g, '')
}

const STATUS_LABEL = { sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed' }
const STATUS_PILL_CLASS = { sent: 'pending', delivered: 'active', read: 'active', failed: 'danger' }

function WhatsAppStatusPill({ entry }) {
  if (!entry) {
    return <span className="status-pill neutral"><span className="status-dot" />Not sent</span>
  }
  const cls = STATUS_PILL_CLASS[entry.status] || 'neutral'
  const label = STATUS_LABEL[entry.status] || entry.status
  const title = entry.status === 'failed' ? (entry.error_message || 'Send failed') : undefined
  return (
    <span className={`status-pill ${cls}`} title={title}>
      <span className="status-dot" />{label}
    </span>
  )
}

export default function LeadsPage() {
  const [leads, setLeads] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // WhatsApp confirmation status, keyed by the same digits-only phone the
  // Worker sent to. Fetched once (not per page/search) — it's a small, D1-
  // backed lookup (routes/cgLeads/index.js) independent of Supabase paging,
  // and also feeds the summary tiles above the table.
  const [statusByPhone, setStatusByPhone] = useState(new Map())

  useEffect(() => {
    let cancelled = false
    apiGet('/cg-leads/whatsapp-status')
      .then(({ statuses }) => {
        if (cancelled) return
        const map = new Map()
        // Server returns most-recent-first; keep only the first (latest) row
        // per phone, so a lead that resubmitted weeks apart shows its
        // CURRENT status, not a stale earlier attempt.
        for (const row of statuses || []) {
          if (!map.has(row.phone)) map.set(row.phone, row)
        }
        setStatusByPhone(map)
      })
      .catch((err) => {
        // Non-fatal: the lead list itself is unaffected, every status pill
        // and the summary tiles just fall back to zero/"Not sent" until this
        // loads or is retried.
        console.error('Failed to load WhatsApp status', err)
      })
    return () => { cancelled = true }
  }, [])

  const statusCounts = useMemo(() => {
    const counts = { sent: 0, delivered: 0, read: 0, failed: 0 }
    for (const entry of statusByPhone.values()) {
      if (counts[entry.status] !== undefined) counts[entry.status] += 1
    }
    return counts
  }, [statusByPhone])

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchInput.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false

    async function loadLeads() {
      setLoading(true)
      setError('')

      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let request = supabase
        .from('cg_leads')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (query) {
        const safeQuery = query.replace(/[%_]/g, '').replace(/[(),]/g, ' ').trim()
        if (safeQuery) {
          request = request.or(
            `company_name.ilike.%${safeQuery}%,name.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%,city.ilike.%${safeQuery}%,mobile.ilike.%${safeQuery}%`
          )
        }
      }

      const { data, count, error: fetchError } = await request

      if (cancelled) return

      if (fetchError) {
        console.error(fetchError)
        setLeads([])
        setTotalCount(0)
        setError(fetchError.message)
      } else {
        setLeads(data || [])
        setTotalCount(count || 0)
      }
      setLoading(false)
    }

    loadLeads()
    return () => { cancelled = true }
  }, [page, pageSize, query])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalCount)

  const pageNumbers = useMemo(() => {
    const current = Math.min(page, totalPages)
    const candidates = [current - 2, current - 1, current, current + 1, current + 2]
    return candidates.filter((n) => n >= 1 && n <= totalPages)
  }, [page, totalPages])

  function changePage(next) {
    setPage(Math.max(1, Math.min(next, totalPages)))
  }

  function changePageSize(e) {
    setPageSize(Number(e.target.value))
    setPage(1)
  }

  return (
    <div className="clients-page leads-page">
      <div className="clients-main-content">
        <div className="page-header">
          <div>
            <span className="page-kicker">LEADS</span>
            <h1>Leads</h1>
            <p>Everyone who submitted an intake form, across every source</p>
          </div>
        </div>

        <div className="leads-stats">
          <div className="leads-stat-tile leads-stat-tile--sent">
            <div className="leads-stat-label">WhatsApp Sent</div>
            <div className="leads-stat-value">{statusCounts.sent}</div>
          </div>
          <div className="leads-stat-tile leads-stat-tile--delivered">
            <div className="leads-stat-label">Delivered</div>
            <div className="leads-stat-value">{statusCounts.delivered}</div>
          </div>
          <div className="leads-stat-tile leads-stat-tile--read">
            <div className="leads-stat-label">Read</div>
            <div className="leads-stat-value">{statusCounts.read}</div>
          </div>
          <div className="leads-stat-tile leads-stat-tile--failed">
            <div className="leads-stat-label">Failed</div>
            <div className="leads-stat-value">{statusCounts.failed}</div>
          </div>
        </div>

        <div className="list-toolbar">
          <div className="search-box">
            <Icon name="search" size={18} />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search company, name, email, city or mobile..."
              aria-label="Search leads"
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
              <strong>Could not load leads</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        <section className="table-card">
          <div className="table-topline">
            <div>
              <strong>All Leads</strong>
              <span className="result-count">{totalCount.toLocaleString()} records</span>
            </div>
            {query && <span className="search-state">Filtered by "{query}"</span>}
          </div>

          <div className="leads-table-wrapper">
            <table className="leads-table">
              <thead>
                <tr>
                  <th className="lt-col-lead">Lead</th>
                  <th className="lt-col-source">Source</th>
                  <th className="lt-col-contact">Contact</th>
                  <th className="lt-col-city">City</th>
                  <th className="lt-col-status">WhatsApp Confirmation</th>
                  <th className="lt-col-date">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: Math.min(pageSize, 8) }).map((_, index) => (
                    <tr key={`skeleton-${index}`} className="skeleton-row">
                      <td><span className="skeleton skeleton-company" /></td>
                      <td><span className="skeleton skeleton-id" /></td>
                      <td><span className="skeleton skeleton-company" /></td>
                      <td><span className="skeleton skeleton-id" /></td>
                      <td><span className="skeleton skeleton-status" /></td>
                      <td><span className="skeleton skeleton-id" /></td>
                    </tr>
                  ))
                ) : leads.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="empty-state">
                      <div className="empty-title">No leads found</div>
                      <div className="empty-copy">Try a different company, name, email or city.</div>
                    </td>
                  </tr>
                ) : (
                  leads.map((lead) => {
                    const phone = lead.mobile ? `${lead.country_code || ''} ${lead.mobile}`.trim() : null
                    const statusEntry = statusByPhone.get(leadPhoneKey(lead))

                    return (
                      <tr key={lead.id}>
                        <td className="lt-col-lead">
                          <span className="cell-primary" title={lead.company_name || ''}>{formatValue(lead.company_name)}</span>
                          <span className="cell-secondary" title={lead.name || ''}>{formatValue(lead.name)}</span>
                        </td>
                        <td className="lt-col-source"><span className="lt-source-chip">{LEAD_SOURCE}</span></td>
                        <td className="lt-col-contact">
                          {phone ? (
                            <div className="lt-phone-row">
                              <ContactHoverAction type="phone" value={phone} />
                              <ContactHoverAction type="whatsapp" value={phone} showValue={false} waMessage={FOLLOWUP_MESSAGE} />
                            </div>
                          ) : <span className="cell-primary">-</span>}
                          {lead.email ? <ContactHoverAction type="email" value={lead.email} /> : <span className="cell-secondary">-</span>}
                        </td>
                        <td className="lt-col-city">{formatValue(lead.city)}</td>
                        <td className="lt-col-status"><WhatsAppStatusPill entry={statusEntry} /></td>
                        <td className="lt-col-date cell-secondary">{formatValue(String(lead.created_at || '').slice(0, 10))}</td>
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
                {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
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
    </div>
  )
}
