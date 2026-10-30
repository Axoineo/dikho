import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useAccess } from '../../lib/access'
import { emailApi } from './emailApi'
import { Banner, EmptyState, StatusPill } from './emailUi'
import { useToast } from './emailHooks'
import CampaignEditor from './CampaignEditor'
import { CAMPAIGN_STATUS, campaignCounts, formatCount, listTime } from './emailFormat'
import './email.css'

// Email campaigns: the list, and one campaign at /email/campaigns/:id.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'review', label: 'Awaiting approval', match: ['pending_approval'] },
  { key: 'drafts', label: 'Drafts', match: ['draft', 'rejected'] },
  { key: 'live', label: 'Scheduled & sending', match: ['approved', 'sending', 'paused'] },
  { key: 'done', label: 'Sent', match: ['sent', 'cancelled'] },
]

export default function EmailCampaigns() {
  const { campaignId } = useParams()
  const navigate = useNavigate()
  const { can } = useAccess()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [toastNode, toast] = useToast()

  const reload = useCallback(async () => {
    try {
      setData(await emailApi.campaigns())
      setError('')
    } catch (err) {
      setError(err.message || 'Could not load campaigns.')
    }
  }, [])
  useEffect(() => { reload() }, [reload])

  const meta = useMemo(() => (data ? { readiness: data.readiness, senders: data.senders, sender_mailboxes: data.sender_mailboxes ?? [], variables: data.variables, max: data.max_recipients } : null), [data])
  const campaigns = useMemo(() => data?.campaigns ?? [], [data])
  const awaiting = campaigns.filter((c) => c.status === 'pending_approval').length
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)
    return f?.match ? campaigns.filter((c) => f.match.includes(c.status)) : campaigns
  }, [campaigns, filter])

  if (campaignId) {
    if (error) return <div className="em-page em-campaign"><Banner tone="danger" title="Could not load campaigns">{error}</Banner></div>
    if (!meta) return <div className="em-page em-campaign"><div className="em-skeleton" style={{ height: 320 }} aria-hidden="true" /></div>
    return (
      <>
        <CampaignEditor key={campaignId} id={campaignId} meta={meta} onChanged={reload} toast={toast} />
        {toastNode}
      </>
    )
  }

  const canCreate = can('email_campaigns.create')
  return (
    <div className="em-page" style={{ paddingBottom: 96 }}>
      <div className="page-header">
        <div>
          <h1>Campaigns</h1>
          <p>Marketing email to clients, vendors and leads who agreed to receive it, approved by a second person before it goes out.</p>
        </div>
        {canCreate && (
          <button type="button" className="em-btn em-btn-primary" onClick={() => navigate('/email/campaigns/new')}>
            <Icon name="plus" size={16} /> New campaign
          </button>
        )}
      </div>

      {error && <Banner tone="danger" title="Could not load campaigns">{error}</Banner>}
      {data && !data.readiness?.ready && (
        <Banner tone="warn" title="Sending is not switched on yet">
          Campaigns can be written, reviewed and approved, but nothing is sent until an administrator sets up {data.readiness.missing.join(', ')}.
        </Banner>
      )}

      {!data && !error && <div className="em-card"><div className="em-skeleton" style={{ height: 180 }} aria-hidden="true" /></div>}

      {data && (
        <section className="em-card em-table-card">
          <div className="em-table-tools">
            <div className="em-chips" role="tablist" aria-label="Filter campaigns">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`em-chip${filter === f.key ? ' is-active' : ''}`} onClick={() => setFilter(f.key)}>
                  {f.label}{f.key === 'review' && awaiting > 0 ? ` (${awaiting})` : ''}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <EmptyState icon="send" title={campaigns.length ? 'Nothing here' : 'No campaigns yet'}
              action={!campaigns.length && canCreate ? <button type="button" className="em-btn em-btn-primary" onClick={() => navigate('/email/campaigns/new')}>Write the first one</button> : null}>
              {campaigns.length ? 'No campaign matches this filter.' : 'A campaign is written, checked against consent, approved by someone else, then sent from a connected mailbox within its daily limit.'}
            </EmptyState>
          ) : (
            <ul className="em-camp-list">
              <li className="em-camp-row em-camp-headrow" aria-hidden="true">
                <span>Campaign</span><span>Status</span><span className="em-num">Recipients</span><span>Progress</span><span>Updated</span>
              </li>
              {shown.map((c) => {
                const counts = campaignCounts(c.stats)
                const total = counts.total || c.recipient_count
                const pct = total ? Math.round((counts.sent / total) * 100) : 0
                return (
                  <li key={c.id}>
                    <button type="button" className="em-camp-row" onClick={() => navigate(`/email/campaigns/${c.id}`)}>
                      <span className="em-camp-name">
                        <strong>{c.name}</strong>
                        <small>{c.subject || 'No subject yet'}</small>
                      </span>
                      <span><StatusPill status={c.status} map={CAMPAIGN_STATUS} /></span>
                      <span className="em-num">{c.recipient_count ? formatCount(c.recipient_count) : '–'}</span>
                      <span className="em-camp-progress">
                        {c.started_at || counts.sent ? (
                          <>
                            <span className="em-meter is-small" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                            <small>{pct}% sent{counts.bounced ? ` · ${formatCount(counts.bounced)} bounced` : ''}</small>
                          </>
                        ) : <small>{c.send_at ? `Scheduled ${listTime(c.send_at)}` : '—'}</small>}
                      </span>
                      <span className="em-camp-updated"><small>{listTime(c.updated_at)}</small><small>{c.created_by_name ?? ''}</small></span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
      {toastNode}
    </div>
  )
}
