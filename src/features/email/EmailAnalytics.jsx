import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { emailApi } from './emailApi'
import { Banner, EmptyState } from './emailUi'
import { CAMPAIGN_STATUS, campaignCounts, formatCount } from './emailFormat'
import './email.css'

// Delivery health from Amazon SES and campaign outcomes. Counts only: no
// opens or clicks, because Dikho adds no tracking pixels or redirected links.
const PERIODS = [7, 30, 90]

// Amazon SES reviews an account whose bounce rate reaches 5% or whose
// complaint rate reaches 0.1%; staying well under both keeps sending open.
const BOUNCE_LIMIT = 0.05
const COMPLAINT_LIMIT = 0.001

const EVENT_LABELS = {
  send: 'Accepted by SES', delivery: 'Delivered', bounce: 'Bounced', complaint: 'Marked as spam',
  reject: 'Rejected by SES', delivery_delay: 'Delayed', rendering_failure: 'Rendering failed', other: 'Other',
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(n && n / d < 0.01 ? 2 : 1)}%` : '–')

export default function EmailAnalytics() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    emailApi.analytics(days).then(
      (d) => { if (alive) { setData(d); setError('') } },
      (err) => { if (alive) setError(err.message || 'Could not load the numbers.') },
    )
    return () => { alive = false }
  }, [days])

  const c = campaignCounts(data?.campaign_recipients)
  const events = data?.events ?? {}
  const sesSent = Number(events.send ?? 0)
  const sesBounce = Number(events.bounce ?? 0)
  const sesComplaint = Number(events.complaint ?? 0)
  const bounceRate = sesSent ? sesBounce / sesSent : 0
  const complaintRate = sesSent ? sesComplaint / sesSent : 0

  const outcomes = [
    ['Delivered', c.delivered],
    ['Sent, not yet confirmed', c.sent - c.delivered - c.bounced - c.complained],
    ['Bounced', c.bounced],
    ['Marked as spam', c.complained],
    ['Failed', c.failed],
    ['Unconfirmed (not retried)', c.uncertain],
    ['Skipped (consent withdrawn or cancelled)', c.skipped],
    ['Waiting to send', c.queued],
  ].filter(([, n]) => n > 0)
  const outcomeMax = Math.max(1, ...outcomes.map(([, n]) => n))

  return (
    <div className="em-page" style={{ paddingBottom: 96 }}>
      <div className="page-header">
        <div>
          <span className="page-kicker">EMAIL</span>
          <h1>Email analytics</h1>
          <p>Delivery and consent, from Amazon SES and Dikho's own records.</p>
        </div>
        <div className="em-chips" role="tablist" aria-label="Period">
          {PERIODS.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={days === d} className={`em-chip${days === d ? ' is-active' : ''}`} onClick={() => setDays(d)}>
              Last {d} days
            </button>
          ))}
        </div>
      </div>

      {error && <Banner tone="danger" title="Could not load analytics">{error}</Banner>}
      {!data && !error && <div className="em-grid em-grid-4">{[0, 1, 2, 3].map((i) => <div key={i} className="em-card"><div className="em-skeleton" style={{ height: 52 }} /></div>)}</div>}

      {data && (
        <div className="em-grid" style={{ gap: 18 }}>
          <div className="em-grid em-grid-4">
            <Tile label="Campaign emails sent" value={formatCount(c.sent)} sub={`${formatCount(c.delivered)} confirmed delivered`} />
            <Tile label="Bounce rate" value={pct(sesBounce, sesSent)} sub={`${formatCount(sesBounce)} of ${formatCount(sesSent)} accepted by SES`}
              status={sesSent ? (bounceRate >= BOUNCE_LIMIT ? 'critical' : bounceRate >= BOUNCE_LIMIT / 2 ? 'warning' : 'good') : null} />
            <Tile label="Complaint rate" value={pct(sesComplaint, sesSent)} sub={`${formatCount(sesComplaint)} marked as spam`}
              status={sesSent ? (complaintRate >= COMPLAINT_LIMIT ? 'critical' : complaintRate >= COMPLAINT_LIMIT / 2 ? 'warning' : 'good') : null} />
            <Tile label="Unsubscribed" value={formatCount(data.unsubscribes)} sub="by link or spam report in this period" />
          </div>

          <div className="em-grid em-grid-2">
            <section className="em-card" aria-labelledby="em-outcomes-title">
              <div className="em-card-head"><div><h2 id="em-outcomes-title">Campaign recipients</h2><p>Where each campaign email ended up.</p></div></div>
              {outcomes.length === 0 ? (
                <EmptyState icon="send" title="No campaign email in this period">Numbers appear once an approved campaign starts sending.</EmptyState>
              ) : (
                <ul className="em-bars">
                  {outcomes.map(([label, n]) => (
                    <li key={label} title={`${label}: ${formatCount(n)} (${pct(n, c.total)})`}>
                      <span className="em-bar-label">{label}</span>
                      <span className="em-bar-track"><span className="em-bar" style={{ width: `${Math.max((n / outcomeMax) * 100, 1.5)}%` }} /></span>
                      <span className="em-bar-value">{formatCount(n)}<small>{pct(n, c.total)}</small></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="em-card" aria-labelledby="em-audience-title">
              <div className="em-card-head"><div><h2 id="em-audience-title">Audience today</h2><p>All addresses, not only this period.</p></div></div>
              <dl className="em-breakdown is-large">
                <div><dt>Agreed to marketing email</dt><dd>{formatCount(data.subscribed)}</dd></div>
                <div><dt>Suppressed (bounced or blocked)</dt><dd>{formatCount(data.suppressed)}</dd></div>
              </dl>
              <div className="em-card-head" style={{ marginTop: 18 }}><div><h2>Campaigns in this period</h2></div></div>
              {Object.keys(data.campaigns ?? {}).length === 0 ? <p className="em-help">None.</p> : (
                <dl className="em-breakdown">
                  {Object.entries(data.campaigns).map(([status, n]) => <div key={status}><dt>{CAMPAIGN_STATUS[status]?.label ?? status}</dt><dd>{formatCount(n)}</dd></div>)}
                </dl>
              )}
            </section>
          </div>

          <section className="em-card" aria-labelledby="em-ses-title">
            <div className="em-card-head"><div><h2 id="em-ses-title">All email through Amazon SES</h2><p>Campaigns, tests and system email (such as staff welcome messages).</p></div></div>
            {Object.keys(events).length === 0 ? (
              <p className="em-help">No delivery events received in this period. They arrive once SES event publishing to Dikho is set up.</p>
            ) : (
              <table className="em-table">
                <thead><tr><th scope="col">Event</th><th scope="col" className="em-num">Count</th><th scope="col" className="em-num">Share of accepted</th></tr></thead>
                <tbody>
                  {Object.entries(events).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
                    <tr key={type}><td>{EVENT_LABELS[type] ?? type}</td><td className="em-num">{formatCount(n)}</td><td className="em-num">{type === 'send' ? '' : pct(Number(n), sesSent)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="em-help" style={{ marginTop: 12 }}>
              <Icon name="eye" size={13} /> Opens and clicks are not tracked: Dikho adds no tracking pixels or redirected links.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}

const STATUS_TEXT = { good: 'Healthy', warning: 'Watch', critical: 'Too high' }
function Tile({ label, value, sub, status }) {
  return (
    <div className="em-card em-stat">
      <span className="em-stat-label">{label}</span>
      <span className="em-stat-value">{value}</span>
      <span className="em-stat-sub">{sub}</span>
      {status && (
        <span className={`em-pill is-${status === 'good' ? 'ok' : status === 'warning' ? 'warn' : 'danger'}`} style={{ justifySelf: 'start', marginTop: 4 }}>
          <Icon name={status === 'good' ? 'check' : 'alert'} size={12} /> {STATUS_TEXT[status]}
        </span>
      )}
    </div>
  )
}
