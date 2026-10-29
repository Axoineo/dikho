import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { apiGet } from '../../lib/api'
import { formatCount, formatDisplayDate } from '../../lib/format'
import { preferredPageSize } from '../../lib/settings'
import { Icon } from '../../components/Icon'
import {
  PageHeader, SearchField, ResultCount, Pagination, StatusPill, Cell, SkeletonRows, EmptyState, Metrics, MetricTile,
} from '../../components/crm/CrmUi'

// The manual follow-up message staff send from this page's WhatsApp button —
// separate from the automatic "client_conformation_" confirmation template
// fired on submit (src/api/routes/public/index.js). This one opens a plain
// wa.me chat, so it is free-form text rather than an approved template, and
// only works inside Meta's 24-hour customer-service window like any other
// non-template WhatsApp message.
const FOLLOWUP_MESSAGE = "Hi! I'm reaching out from Dikho. We noticed you were exploring our catalogue, did you find what you were looking for? Let us know if you'd like a quick call from one of our representatives to assist you further."

const PAGE_SIZES = [25, 50, 75, 100]

// Every lead currently comes from the corporate-gifting form (the only
// source that writes to cg_leads), shown as a badge rather than hardcoded
// into the page copy: Leads is meant to grow into a module covering other
// intake forms later (e.g. outdoor advertising enquiries), each presumably
// its own Supabase table read the same way, all landing in this one list.
const LEAD_SOURCE = 'Corporate gifting'

// Same digits-only join key the Worker builds when it sends
// (notifyCgLead in src/api/routes/public/index.js) — country_code + mobile,
// non-digits stripped. The two databases share no id, so phone is the only
// thing to join on.
function leadPhoneKey(lead) {
  return `${lead.country_code ?? ''}${lead.mobile ?? ''}`.replace(/\D/g, '')
}

/* Row actions: small icon links beside the number and the address. */
const ActIcon = {
  call: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.6 10.8a15.16 15.16 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1.02-.24 11.42 11.42 0 0 0 3.58.58 1 1 0 0 1 1 1V19a1 1 0 0 1-1 1A17 17 0 0 1 3 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.58 3.58a1 1 0 0 1-.25 1.02L6.6 10.8z"/></svg>
  ),
  wa: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2c-5.52 0-10 4.48-10 10 0 1.77.46 3.45 1.27 4.9L2 22l5.25-1.38a9.96 9.96 0 0 0 4.79 1.22h.01c5.52 0 10-4.48 10-10s-4.48-9.84-10.01-9.84zm5.84 14.3c-.25.7-1.45 1.34-2 1.42-.51.08-1.15.11-1.86-.12-.43-.14-.98-.32-1.68-.63-2.96-1.28-4.89-4.26-5.04-4.46-.15-.2-1.2-1.6-1.2-3.05 0-1.45.76-2.16 1.03-2.46.27-.3.59-.37.79-.37.2 0 .4 0 .57.01.18.01.43-.07.67.51.25.6.85 2.08.92 2.23.07.15.12.33.02.53-.1.2-.15.33-.3.5-.15.18-.31.4-.45.54-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.02 1.12 1 2.06 1.31 2.36 1.46.3.15.48.13.65-.08.18-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.73.82 2.02.97.3.15.5.22.57.35.07.13.07.75-.18 1.45z"/></svg>
  ),
  mail: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 7l8.586 6.414a2 2 0 0 0 2.828 0L22 7"/></svg>
  ),
}

function RowAction({ kind, href, label, external }) {
  return (
    <a
      className="crm-act"
      href={href}
      title={label}
      aria-label={label}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
    >
      {ActIcon[kind]}
    </a>
  )
}

const STATUS_LABEL = { sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed' }
const STATUS_TONE = { sent: 'pending', delivered: 'active', read: 'active', failed: 'danger' }

function WhatsAppStatusPill({ entry }) {
  if (!entry) return <StatusPill tone="neutral">Not sent</StatusPill>
  const title = entry.status === 'failed' ? (entry.error_message || 'Send failed') : undefined
  return (
    <span title={title}>
      <StatusPill tone={STATUS_TONE[entry.status] || 'neutral'}>{STATUS_LABEL[entry.status] || entry.status}</StatusPill>
    </span>
  )
}

const COLUMNS = 5

export default function LeadsPage() {
  const [leads, setLeads] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => preferredPageSize(PAGE_SIZES))
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

  function changePage(next) {
    setPage(Math.max(1, Math.min(next, totalPages)))
  }

  return (
    <div className="crm-page">
      <PageHeader title="Leads" subtitle="Everyone who submitted an intake form, from every source." />

      <p className="crm-metrics-note">WhatsApp confirmations, counted once per number per week</p>
      <Metrics label="WhatsApp confirmations">
        <MetricTile label="Sent" value={formatCount(statusCounts.sent)} />
        <MetricTile label="Delivered" value={formatCount(statusCounts.delivered)} />
        <MetricTile label="Read" value={formatCount(statusCounts.read)} />
        <MetricTile label="Failed" value={formatCount(statusCounts.failed)} tone={statusCounts.failed ? 'danger' : undefined} />
      </Metrics>

      <div className="crm-toolbar">
        <SearchField
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Search company, name, email, city or mobile"
          label="Search leads"
        />
        {!loading && <ResultCount shown={totalCount} total={totalCount} noun="lead" filtered={Boolean(query)} />}
      </div>

      {error && (
        <div className="crm-note crm-note--danger" role="alert">
          <Icon name="alert" size={17} />
          <div><strong>Could not load leads.</strong> {error}</div>
        </div>
      )}

      <section className="crm-card">
        <div className="crm-table-scroll">
          <table className="crm-table">
            <thead>
              <tr>
                <th style={{ width: '28%' }}>Lead</th>
                <th className="crm-hide-sm" style={{ width: '32%' }}>Contact</th>
                <th className="crm-hide-sm" style={{ width: '14%' }}>City</th>
                <th style={{ width: '120px' }}>WhatsApp</th>
                <th className="crm-hide-sm" style={{ width: '120px' }}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} columns={COLUMNS} />
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS} className="crm-empty-cell">
                    {query ? (
                      <EmptyState title="No leads match your search">Try a different company, name, email or city.</EmptyState>
                    ) : (
                      <EmptyState icon="filter" title="No leads yet">Leads arrive here when someone fills in an intake form, such as the corporate gifting page.</EmptyState>
                    )}
                  </td>
                </tr>
              ) : (
                leads.map((lead) => {
                  const phone = lead.mobile ? `${lead.country_code || ''} ${lead.mobile}`.trim() : null
                  const statusEntry = statusByPhone.get(leadPhoneKey(lead))
                  return (
                    <tr key={lead.id}>
                      <td>
                        <Cell main={lead.company_name} sub={[lead.name, LEAD_SOURCE].filter(Boolean).join(' · ')} strong title={lead.company_name || ''} />
                      </td>
                      <td className="crm-hide-sm">
                        <div className="crm-cell">
                          {phone ? (
                            <div className="crm-acts crm-cell-main">
                              <span className="crm-mono" title={phone}>{phone}</span>
                              <RowAction kind="call" href={`tel:${phone.replace(/\s/g, '')}`} label={`Call ${phone}`} />
                              <RowAction kind="wa" href={`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(FOLLOWUP_MESSAGE)}`} label={`WhatsApp ${phone}`} external />
                            </div>
                          ) : <span className="crm-cell-main crm-empty-value">—</span>}
                          {lead.email ? (
                            <div className="crm-acts crm-cell-sub">
                              <span title={lead.email}>{lead.email}</span>
                              <RowAction kind="mail" href={`mailto:${lead.email}`} label={`Email ${lead.email}`} />
                            </div>
                          ) : <span className="crm-cell-sub">—</span>}
                        </div>
                      </td>
                      <td className="crm-hide-sm"><Cell main={lead.city} /></td>
                      <td><WhatsAppStatusPill entry={statusEntry} /></td>
                      <td className="crm-hide-sm"><Cell main={lead.created_at ? formatDisplayDate(lead.created_at) : null} /></td>
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
          onPage={changePage}
          onPageSize={(size) => { setPageSize(size); setPage(1) }}
        />
      </section>
    </div>
  )
}
