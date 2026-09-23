import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { apiGet } from '../../lib/api'
import { Alert, EmptyState, PageHeader, Panel, PanelHead } from './ui'

const CARDS = [
  { key: 'contacts', label: 'Contacts', accent: 'var(--brand-blue)', hint: 'Subscribed audience' },
  { key: 'campaigns', label: 'Campaigns', accent: '#f9af1b', hint: 'Total sends' },
  { key: 'sent', label: 'Messages sent', accent: '#4a8f6a', hint: 'Accepted by Meta' },
  { key: 'delivered', label: 'Delivered', accent: '#53bdeb', hint: 'Confirmed on device' },
  { key: 'read', label: 'Read', accent: '#5ba0e0', hint: 'Opened by recipient' },
  { key: 'failed', label: 'Failed', accent: '#d9534f', hint: 'Rejected or undeliverable' },
]

function StatCard({ label, value, hint, accent }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface px-[17px] py-4">
      {/* Accent rail — inline style because the colour varies per card. */}
      <span className="absolute inset-y-0 left-0 w-[3px] opacity-85" style={{ background: accent }} />
      <span className="mb-2 block text-[10.5px] font-extrabold uppercase tracking-[0.9px] text-muted">
        {label}
      </span>
      <div className="text-[26px] font-bold leading-none tracking-[-0.6px]">{value}</div>
      <div className="mt-1.5 text-[11.5px] text-muted">{hint}</div>
    </div>
  )
}

export default function WhatsAppDashboard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiGet('/campaigns/stats').then(setStats).catch((err) => setError(err.message))
  }, [])

  const rate = (part) => (stats && stats.sent > 0 ? Math.round((part / stats.sent) * 100) : null)
  const deliveryRate = rate(stats?.delivered)

  return (
    <>
      <PageHeader title="Overview" subtitle="Delivery performance across every campaign you have sent.">
        <Link to="/whatsapp/campaigns" className="primary-button no-underline">
          <Icon name="plus" size={16} /> New campaign
        </Link>
      </PageHeader>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="mb-[18px] grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        {CARDS.map((card) => (
          <StatCard
            key={card.key}
            label={card.label}
            hint={card.hint}
            accent={card.accent}
            value={stats ? stats[card.key] ?? 0 : '—'}
          />
        ))}
      </div>

      <Panel>
        <PanelHead title="Delivery health" subtitle="Updated live from Meta delivery receipts." />
        <div className="p-[18px]">
          {deliveryRate === null ? (
            <EmptyState title="No messages sent yet">
              Delivery and read rates appear here once your first campaign goes out.
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-[10px] border border-line">
              {[
                ['Delivery rate', `${deliveryRate}%`],
                ['Read rate', `${rate(stats.read)}%`],
                ['Failures', stats.failed],
              ].map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-4 border-b
                  border-line-soft bg-surface px-3.5 py-3 text-[13px] last:border-b-0">
                  <span className="text-[12.5px] text-muted">{key}</span>
                  <span className="font-semibold">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </>
  )
}
