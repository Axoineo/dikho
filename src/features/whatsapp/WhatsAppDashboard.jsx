import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { apiGet } from '../../lib/api'
import { Alert, EmptyState, PageHeader, Panel } from './ui'
import { Metrics, MetricTile } from '../../components/crm/CrmUi'
import { useAccess } from '../../lib/access'
import { formatCount } from '../../lib/format'

// Grouped in the organization's number style (Settings > Regional):
// 10320 reads as a string of digits, 10,320 reads as a number.
const count = (n) => (typeof n === 'number' ? formatCount(n) : n)

const CARDS = [
  { key: 'contacts', label: 'Contacts', hint: 'Subscribed audience' },
  { key: 'campaigns', label: 'Campaigns', hint: 'Total sends' },
  { key: 'accepted', label: 'Messages sent', hint: 'Accepted by Meta' },
  { key: 'delivered', label: 'Delivered', hint: 'Confirmed on device' },
  { key: 'read', label: 'Read', hint: 'Opened by recipient' },
  { key: 'failed', label: 'Failed', hint: 'Rejected or undeliverable', tone: 'danger' },
]

export default function WhatsAppDashboard() {
  const { can } = useAccess()
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiGet('/campaigns/stats').then(setStats).catch((err) => setError(err.message))
  }, [])

  // Denominators match Meta's own reporting so the two dashboards can be read
  // side by side: delivery is measured against what Meta accepted, and reads
  // against what actually reached a phone. Dividing reads by `accepted` — as
  // this did — reported 33% where Meta showed 63% on identical data.
  const pct = (part, whole) => (stats && whole > 0 ? Math.round((part / whole) * 100) : null)
  const deliveryRate = pct(stats?.delivered, stats?.accepted)

  return (
    <div className="wa-page">
      <PageHeader title="WhatsApp" subtitle="Delivery performance across every campaign you have sent.">
        {can('campaigns.send') && (
          <Link to="/whatsapp/campaigns" className="primary-button no-underline">
            <Icon name="plus" size={16} /> New campaign
          </Link>
        )}
      </PageHeader>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="mb-4">
        <Metrics label="Totals">
          {CARDS.map((card) => (
            <MetricTile
              key={card.key}
              label={card.label}
              hint={card.hint}
              tone={card.tone && stats?.[card.key] ? card.tone : undefined}
              value={stats ? count(stats[card.key] ?? 0) : '—'}
            />
          ))}
        </Metrics>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3.5 py-2.5">
          <h2 className="m-0 text-[13px] font-medium text-ink">Delivery health</h2>
          <span className="text-[12px] text-muted">Updated live from Meta receipts</span>
        </div>
        {deliveryRate === null ? (
          <EmptyState title="No messages sent yet">
            Delivery and read rates appear here once your first campaign goes out.
          </EmptyState>
        ) : (
          // Label left, value right, a hairline between rows so the eye can
          // follow each pair across a wide screen.
          [
            ['Delivery rate', `${deliveryRate}% of accepted`],
            ['Read rate', `${pct(stats.read, stats.delivered)}% of delivered`],
            ['Awaiting a receipt', count(stats.awaiting)],
            ['Failures', count(stats.failed)],
          ].map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-4 border-b
              border-line-soft px-3.5 py-2.5 text-[13px] last:border-b-0">
              <span className="text-muted">{key}</span>
              <span>{value}</span>
            </div>
          ))
        )}
      </Panel>
    </div>
  )
}
