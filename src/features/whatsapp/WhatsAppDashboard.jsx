import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { apiGet } from '../../lib/api'
import { Alert, EmptyState, PageHeader, Panel, PanelHead } from './ui'
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
      <PageHeader title="Overview" subtitle="Delivery performance across every campaign you have sent.">
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
        <PanelHead title="Delivery health" subtitle="Updated live from Meta delivery receipts." />
        <div className="p-3.5">
          {deliveryRate === null ? (
            <EmptyState title="No messages sent yet">
              Delivery and read rates appear here once your first campaign goes out.
            </EmptyState>
          ) : (
            // Capped width: full-bleed, each label sat ~1,300px from its value
            // on a desktop screen, too far for the eye to pair them.
            <div className="max-w-[560px] overflow-hidden rounded-xl border border-line">
              {[
                ['Delivery rate', `${deliveryRate}% of accepted`],
                ['Read rate', `${pct(stats.read, stats.delivered)}% of delivered`],
                ['Awaiting a receipt', count(stats.awaiting)],
                ['Failures', count(stats.failed)],
              ].map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-4 border-b
                  border-line-soft bg-surface px-3 py-2 text-[13px] last:border-b-0">
                  <span className="text-muted">{key}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
