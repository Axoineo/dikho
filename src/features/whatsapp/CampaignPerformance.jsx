import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { Segmented } from '../../components/crm/CrmUi'
import { apiGet } from '../../lib/api'
import { formatCount } from '../../lib/format'
import { CampaignUnsent } from './CampaignUnsent'
import { Alert, Badge, PageHeader } from './ui'
import { sentenceCase } from './labels'
import { BarList, ChartTable, Legend, LineChart } from './analytics/charts'
import { cumulativeTimeline, formatPercent, hoursPhrase, parseStamp, rate } from './analytics/figures'
import { Card, Funnel, Kpi, KpiSkeleton, TapLists } from './analytics/parts'

// One campaign on its own, at /whatsapp/campaigns/:id so it can be linked and
// Back returns to wherever it was opened from. Reads
// GET /api/whatsapp/analytics/campaigns/:id, which counts only this campaign's
// messages and caches the answer once its receipts have settled.

const STATUS_TONE = { completed: 'success', sending: 'info', stopped: 'warn', failed: 'danger', draft: 'neutral' }
const SERIES = [
  { key: 'delivered', label: 'Delivered', cls: 'wa-s2' },
  { key: 'read', label: 'Read', cls: 'wa-s3' },
]
const count = (n) => formatCount(n ?? 0)
const hourLabel = (hour, last) => (hour >= last && last >= 72 ? '72 h+' : hour === 0 ? 'Start' : `${hour} h`)

export default function CampaignPerformance() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('chart')
  const [showUnsent, setShowUnsent] = useState(false)

  const load = useCallback(() => {
    setError(null)
    return apiGet(`/whatsapp/analytics/campaigns/${encodeURIComponent(id)}`)
      .then(setData)
      .catch((err) => setError(err.status === 404 ? 'This campaign does not exist, or was deleted.' : err.message))
  }, [id])

  useEffect(() => { setData(null); load() }, [load])

  const c = data?.campaign
  const t = data?.totals
  const started = parseStamp(c?.createdAt)
  const { points, halfDelivered, halfRead } = cumulativeTimeline(data?.timeline)
  const last = points.at(-1)?.hour ?? 0
  const outstanding = t ? t.failed + t.notSent : 0

  return (
    <div className="wa-page">
      <Link to="/whatsapp/campaigns" className="wa-back"><Icon name="back" size={15} /> Campaigns</Link>
      <PageHeader
        title={c?.name ?? 'Campaign'}
        subtitle={c ? [
          `Template ${c.template}`,
          started ? `started ${started.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : null,
        ].filter(Boolean).join(', ') : 'Loading…'}
      >
        {c && <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{sentenceCase(c.status)}</Badge>}
      </PageHeader>

      <div className="wa-dash">
        {error && (
          <Alert tone="error">
            {error}{' '}
            {!/does not exist/.test(error) && (
              <button type="button" className="wa-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={load}>Try again</button>
            )}
          </Alert>
        )}

        {!data ? (!error && <KpiSkeleton count={7} />) : (
          <>
            <div className="wa-kpis" role="group" aria-label="Key figures">
              <Kpi label="Audience" value={count(c.audience)} sub="People chosen for it" />
              <Kpi label="Sent" value={count(t.sent)} sub={t.notSent ? `${count(t.notSent)} not sent yet` : 'Everyone was sent to'} />
              <Kpi label="Delivered" value={formatPercent(rate(t.delivered, t.sent))} sub={`${count(t.delivered)} reached a phone`} />
              <Kpi label="Read" value={formatPercent(rate(t.read, t.delivered))} sub={`${count(t.read)} of those delivered`} />
              <Kpi label="Replied" value={count(t.replied)} sub={`${formatPercent(rate(t.replied, t.delivered))} of delivered, within ${data.replyWindowDays} days`} />
              <Kpi label="Failed" value={count(t.failed)} sub={t.sent ? `${formatPercent(rate(t.failed, t.sent))} of sent` : 'None sent'} />
              <Kpi label="Opted out" value={count(t.optedOut)} sub="Recipients who have since said stop" />
            </div>

            <div className="wa-grid-2">
              <Card title="Funnel" sub="Each step against the one before it; replies against delivered"
                foot={t.awaiting ? `${count(t.awaiting)} still waiting for a receipt from the phone.` : undefined}>
                <Funnel formatValue={count} steps={[
                  { label: 'Audience', value: c.audience },
                  { label: 'Sent', value: t.sent },
                  { label: 'Delivered', value: t.delivered },
                  { label: 'Read', value: t.read },
                  { label: 'Replied', value: t.replied, of: 2 },
                ]} />
              </Card>
              <Card title="Why messages failed" sub="Meta's reason, most common first">
                {data.failures.length === 0 ? <p className="wa-quiet">No failures.</p> : (
                  <BarList label="Failure reasons" formatValue={count}
                    items={data.failures.map((f) => ({ key: f.code ?? 'none', label: f.reason, value: f.count, note: f.code ? `(${f.code})` : undefined }))} />
                )}
              </Card>
            </div>

            <Card
              title="How fast it landed"
              sub="Running total of deliveries and reads, by hours since the campaign started"
              action={points.length > 1 && <Segmented label="Show as" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}
              foot={[
                halfDelivered !== null && `Half the deliveries arrived ${hoursPhrase(halfDelivered)}.`,
                halfRead !== null && `Half the reads came ${hoursPhrase(halfRead)}.`,
                'Messages delivered or read after three days count in the last point.',
              ].filter(Boolean).join(' ')}
            >
              {points.length === 0 ? <p className="wa-quiet">No delivery receipts yet.</p>
                : view === 'chart' || points.length === 1 ? (
                  <>
                    <Legend series={SERIES} />
                    <div style={{ marginTop: 8 }}>
                      <LineChart data={points} x="hour" series={SERIES} label="Deliveries and reads by hours since the start" labelSteps={[1, 2, 3, 6, 12, 24]}
                        formatX={(h) => hourLabel(h, last)} formatTip={(h) => (h >= 72 ? 'After 72 hours' : `By hour ${h + 1}`)} formatValue={count} />
                    </div>
                  </>
                ) : (
                  <ChartTable data={points} caption="Deliveries and reads by hour" columns={[
                    { key: 'hour', label: 'Hours since start', format: (h) => (h >= 72 ? '72 or more' : `${h} to ${h + 1}`) },
                    { key: 'delivered', label: 'Delivered so far', numeric: true, format: count },
                    { key: 'read', label: 'Read so far', numeric: true, format: count },
                  ]} />
                )}
            </Card>

            {data.taps && (
              <Card title="Button taps" sub="What recipients tapped on this campaign's message"
                foot={data.taps.links === null
                  ? "Counted from the answers to this campaign's own messages."
                  : `Quick replies are counted from the answers to this campaign's own messages. Link taps come from Meta for the template as a whole: every send of ${c.template} in the ${data.replyWindowDays} days after the start counts.`}>
                <TapLists formatValue={count} linkLabel="Links (this template)"
                  replies={data.taps.replies.map((b) => ({ ...b, note: `by ${count(b.people)} ${b.people === 1 ? 'person' : 'people'}` }))}
                  links={data.taps.links} />
              </Card>
            )}

            {outstanding > 0 && (
              <Card title="Not received" sub={`${count(t.failed)} failed and ${count(t.notSent)} never sent`}
                action={(
                  <button type="button" className="secondary-button" aria-expanded={showUnsent} onClick={() => setShowUnsent((open) => !open)}>
                    {showUnsent ? 'Hide the list' : 'Show who'}
                  </button>
                )}>
                {showUnsent
                  ? <div style={{ margin: '0 -14px -14px' }}><CampaignUnsent campaign={{ id: c.id, status: c.status }} onChanged={load} /></div>
                  : <p className="wa-quiet" style={{ textAlign: 'left', padding: 0 }}>See each person who hasn&apos;t received it, and send to them again.</p>}
              </Card>
            )}

            <p className="wa-card-foot" style={{ padding: 0 }}>
              Replies count people from this campaign who wrote to you within {data.replyWindowDays} days of its start, whatever they wrote.
              Opted out counts recipients who have stopped messages since, whichever message they answered.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
