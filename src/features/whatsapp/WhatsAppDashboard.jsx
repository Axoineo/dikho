import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { Segmented } from '../../components/crm/CrmUi'
import { apiGet } from '../../lib/api'
import { useAccess } from '../../lib/access'
import { formatCount } from '../../lib/format'
import { Alert, Badge, PageHeader, Table, Td, Th } from './ui'
import { sentenceCase } from './labels'
import { BarList, ChartTable, ColumnChart, Legend, LineChart } from './analytics/charts'
import {
  CATEGORY, THROUGHPUT, change, formatMoneyIn, formatPercent, messagingLimitLabel, parseStamp, rate, shortDay,
} from './analytics/figures'
import { Card, Funnel, Kpi, KpiSkeleton, QualityLabel, TapLists } from './analytics/parts'

// The WhatsApp dashboard: how messages did over the last 7, 30 or 90 days,
// against the same length of time before, from our own message records (D1) and
// what Meta reports (number health, template quality, spend). One request:
// GET /api/whatsapp/analytics?days=N, cached on the server for about ten minutes.

const RANGES = [7, 30, 90]
const count = (n) => formatCount(n ?? 0)
const fullDay = (day) => {
  const date = parseStamp(`${day} 00:00:00`)
  return date ? date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : day
}

const SERIES = [
  { key: 'sent', label: 'Sent', cls: 'wa-s1' },
  { key: 'delivered', label: 'Delivered', cls: 'wa-s2' },
  { key: 'read', label: 'Read', cls: 'wa-s3' },
]

const STATUS_TONE = { completed: 'success', sending: 'info', stopped: 'warn', failed: 'danger', draft: 'neutral' }

export default function WhatsAppDashboard() {
  const { can } = useAccess()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const days = RANGES.includes(Number(params.get('days'))) ? Number(params.get('days')) : 30
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('chart')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setLoading(true)
    setError(null)
    apiGet(`/whatsapp/analytics?days=${days}`)
      .then((answer) => { if (current) setData(answer) })
      .catch((err) => { if (current) setError(err.message) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [days, attempt])

  // The range is in the address, so a link or a reload keeps it; replacing the
  // entry means Back leaves the dashboard instead of stepping through ranges.
  const pickRange = (value) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    next.set('days', String(value))
    return next
  }, { replace: true })

  const period = `previous ${days} days`
  // While a new range loads, the last answer stays on screen under "Updating…".
  const showing = data
  const t = showing?.totals
  const p = showing?.previous
  const spend = showing?.spend
  const updated = parseStamp(showing?.computedAt)
  const hasCost = Boolean(showing?.templates?.some((t) => t.cost !== null && t.cost !== undefined))

  return (
    <div className="wa-page">
      <PageHeader title="WhatsApp" subtitle="How your messages are doing: delivery, reads, replies, failures and spend.">
        {can('campaigns.send') && (
          <Link to="/whatsapp/campaigns/new" className="primary-button no-underline">
            <Icon name="plus" size={16} /> New campaign
          </Link>
        )}
      </PageHeader>

      <div className="wa-dash">
        <div className="wa-toolbar">
          <Segmented label="Period" value={days} onChange={pickRange}
            options={RANGES.map((value) => ({ value, label: `${value} days` }))} />
          <span className="wa-updated" aria-live="polite">
            {loading ? 'Updating…' : showing ? `${shortDay(showing.range.from)} to ${shortDay(showing.range.to)}${updated ? `, updated ${updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}` : ''}
          </span>
        </div>

        {error && (
          <Alert tone="error">
            Couldn&apos;t load the dashboard: {error}{' '}
            <button type="button" className="wa-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </Alert>
        )}
        {showing?.metaErrors?.length > 0 && (
          <Alert tone="warn">
            Some figures from Meta are missing. {showing.metaErrors.join(' ')}
          </Alert>
        )}

        {!showing ? (
          !error && <KpiSkeleton />
        ) : (
          <>
            <div className="wa-kpis" role="group" aria-label="Key figures">
              <Kpi label="Messages sent" value={count(t.sent)} sub="Handed to Meta"
                change={change(t.sent, p.sent)} period={period} />
              <Kpi label="Delivered" value={formatPercent(rate(t.delivered, t.sent))} sub={`${count(t.delivered)} reached a phone`}
                change={change(rate(t.delivered, t.sent), rate(p.delivered, p.sent), { kind: 'rate' })} period={period} />
              <Kpi label="Read" value={formatPercent(rate(t.read, t.delivered))} sub={`${count(t.read)} of those delivered`}
                change={change(rate(t.read, t.delivered), rate(p.read, p.delivered), { kind: 'rate' })} period={period} />
              <Kpi label="Failed" value={count(t.failed)} sub={t.sent ? `${formatPercent(rate(t.failed, t.sent))} of sent` : 'None sent'}
                change={change(t.failed, p.failed, { better: 'down' })} period={period} />
              <Kpi label="Messages received" value={count(t.inbound)} sub="Written to you by customers"
                change={change(t.inbound, p.inbound)} period={period} />
              <Kpi label="Spend" value={spend ? formatMoneyIn(spend.total, spend.currency) : '—'}
                sub={spend ? `${count(spend.volume)} messages Meta priced` : 'Not available from Meta'} />
            </div>

            <Card
              title="Messages by day"
              sub="Each message counts on the day it was sent; its status is the latest receipt."
              action={<Segmented label="Show as" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}
              foot="Read counts only include people who have read receipts switched on, so the true read rate is higher."
            >
              {t.sent === 0 && t.inbound === 0 ? (
                <p className="wa-quiet">No messages in these {days} days.</p>
              ) : view === 'chart' ? (
                <>
                  <Legend series={SERIES} />
                  <div style={{ marginTop: 8 }}>
                    <LineChart data={showing.daily} x="day" series={SERIES} label="Messages sent, delivered and read by day"
                      formatX={shortDay} formatTip={fullDay} formatValue={count} />
                  </div>
                </>
              ) : (
                <ChartTable data={showing.daily} caption="Messages by day" columns={[
                  { key: 'day', label: 'Day', format: fullDay },
                  { key: 'sent', label: 'Sent', numeric: true, format: count },
                  { key: 'delivered', label: 'Delivered', numeric: true, format: count },
                  { key: 'read', label: 'Read', numeric: true, format: count },
                  { key: 'failed', label: 'Failed', numeric: true, format: count },
                  { key: 'inbound', label: 'Received', numeric: true, format: count },
                ]} />
              )}
            </Card>

            <div className="wa-grid-2">
              <Card title="Delivery funnel" sub={`Of the messages sent in the last ${days} days`}
                foot={t.awaiting ? `${count(t.awaiting)} still waiting for a receipt from the phone.` : undefined}>
                {t.sent === 0 ? <p className="wa-quiet">Nothing sent in this period.</p> : (
                  <Funnel formatValue={count} steps={[
                    { label: 'Sent', value: t.sent },
                    { label: 'Delivered', value: t.delivered },
                    { label: 'Read', value: t.read },
                  ]} />
                )}
              </Card>
              <Card title="Why messages failed" sub="Meta's reason, most common first">
                {showing.failures.length === 0 ? <p className="wa-quiet">No failures in this period.</p> : (
                  <BarList label="Failure reasons" formatValue={count}
                    items={showing.failures.map((f) => ({ key: f.code ?? 'none', label: f.reason, value: f.count, note: f.code ? `(${f.code})` : undefined }))} />
                )}
              </Card>
            </div>

            <div className="wa-grid-2">
              <Card title="Messages received by day" sub="Customers writing to you, reactions left out">
                {t.inbound === 0 ? <p className="wa-quiet">No messages received in this period.</p> : (
                  <ColumnChart data={showing.daily} x="day" value="inbound" label="Messages received by day" seriesLabel="Received"
                    formatX={shortDay} formatTip={fullDay} formatValue={count} />
                )}
              </Card>
              <Card title="What you sent" sub="Messages handed to Meta, by where they came from">
                {t.sent === 0 ? <p className="wa-quiet">Nothing sent in this period.</p> : (
                  <BarList label="Messages by source" formatValue={count} items={[
                    { key: 'campaign', label: 'Campaigns', value: t.campaign },
                    { key: 'replies', label: 'Inbox replies and chat templates', value: t.replies },
                    { key: 'automatic', label: 'Automatic (lead confirmations)', value: t.automatic },
                  ]} />
                )}
              </Card>
            </div>

            <div className="wa-grid-2">
              <Card title="Spend by day" sub={spend ? `What Meta charged, in ${spend.currency ?? 'the account currency'}` : 'From Meta'}
                foot={spend ? 'From Meta pricing analytics. Service replies inside 24 hours are free and count at zero.' : undefined}>
                {!spend ? <p className="wa-quiet">Meta did not return spend for this period.</p>
                  : spend.daily.length === 0 ? <p className="wa-quiet">No charges in this period.</p> : (
                    <ColumnChart data={fillDays(spend.daily, showing.daily)} x="day" value="cost" label="Spend by day" seriesLabel="Spend" integer={false}
                      formatX={shortDay} formatTip={fullDay} formatValue={(v) => formatMoneyIn(v, spend.currency)}
                      formatAxis={(v) => formatMoneyIn(v, spend.currency).replace(/\.00$/, '')} />
                  )}
              </Card>
              <Card title="Spend by category" sub="Meta prices each message by what it is for">
                {!spend ? <p className="wa-quiet">Meta did not return spend for this period.</p>
                  : spend.byCategory.length === 0 ? <p className="wa-quiet">No charges in this period.</p> : (
                  <BarList label="Spend by category" formatValue={(v) => formatMoneyIn(v, spend.currency)}
                    items={spend.byCategory.map((c) => ({ key: c.category, label: CATEGORY[c.category] ?? sentenceCase(c.category), value: c.cost, note: `${count(c.volume)} messages` }))} />
                )}
              </Card>
            </div>

            <Card title="Templates" sub="How each template did in this period, with Meta's quality rating">
              {showing.templates.length === 0 ? <p className="wa-quiet">No templates sent in this period.</p> : (<>
                <ul className="wa-list wa-only-narrow">
                  {showing.templates.map((row) => (
                    <li key={row.name}>
                      <div className="wa-list-main">
                        <span className="wa-list-name">{row.name}</span>
                        {(row.quality || row.status) && <QualityLabel value={row.quality} />}
                      </div>
                      <div className="wa-list-sub">
                        {count(row.sent)} sent, {formatPercent(rate(row.delivered, row.sent))} delivered, {formatPercent(rate(row.read, row.delivered))} read, {count(row.failed)} failed, {count(tapsOf(row))} taps
                        {row.cost !== null && row.cost !== undefined && spend && <>, {formatMoneyIn(row.cost, spend.currency)}</>}
                        {row.status && row.status !== 'APPROVED' && <> <Badge tone="warn">{sentenceCase(row.status)}</Badge></>}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="wa-only-wide">
                <Table head={<>
                  <Th>Template</Th><Th tight>Quality</Th><Th tight>Sent</Th><Th tight>Delivered</Th><Th tight>Read</Th><Th tight>Failed</Th><Th tight>Taps</Th>
                  {hasCost && <Th tight>Cost</Th>}
                </>}>
                  {showing.templates.map((row) => (
                    <tr key={row.name}>
                      <Td className="font-medium">
                        {row.name}
                        {row.status && row.status !== 'APPROVED' && <> <Badge tone="warn">{sentenceCase(row.status)}</Badge></>}
                      </Td>
                      <Td tight>{row.quality || row.status ? <QualityLabel value={row.quality} /> : <span className="text-muted">Not listed</span>}</Td>
                      <Td tight>{count(row.sent)}</Td>
                      <Td tight>{formatPercent(rate(row.delivered, row.sent))}</Td>
                      <Td tight>{formatPercent(rate(row.read, row.delivered))}</Td>
                      <Td tight className={row.failed ? 'text-danger' : 'text-muted'}>{count(row.failed)}</Td>
                      <Td tight title={tapBreakdown(row)}>{count(tapsOf(row))}</Td>
                      {hasCost && <Td tight>{row.cost === null || row.cost === undefined ? '—' : formatMoneyIn(row.cost, spend?.currency)}</Td>}
                    </tr>
                  ))}
                </Table>
                </div>
              </>)}
            </Card>

            <Card title="Button taps" sub="What people tapped on your templates in this period"
              foot={showing.templateInsights?.available
                ? "Quick replies are counted from the answers in your own records. Link taps come from Meta's template insights."
                : 'Counted from the answers in your own records.'}>
              <TapLists formatValue={count}
                replies={showing.templates.flatMap((t) => (t.replyTaps ?? []).map((b) => ({ ...b, detail: t.name })))
                  .sort((a, b) => b.count - a.count).slice(0, 8)}
                links={showing.templateInsights?.available
                  ? showing.templates.flatMap((t) => (t.links ?? []).map((b) => ({ ...b, detail: t.name }))).sort((a, b) => b.count - a.count).slice(0, 8)
                  : null} />
            </Card>

            <Card title="Campaigns" sub="Started in this period. Open one to see its own performance."
              action={<Link to="/whatsapp/campaigns" className="wa-link">All campaigns</Link>}>
              {showing.campaigns.length === 0 ? <p className="wa-quiet">No campaigns started in this period.</p> : (<>
                <ul className="wa-list wa-only-narrow">
                  {showing.campaigns.map((c) => (
                    <li key={c.id}>
                      <div className="wa-list-main">
                        <Link to={`/whatsapp/campaigns/${c.id}`} className="wa-link">{c.name}</Link>
                        <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{sentenceCase(c.status)}</Badge>
                      </div>
                      <div className="wa-list-sub">
                        {formatStamp(c.createdAt)}: {count(c.sent)} of {count(c.audience)} sent, {formatPercent(rate(c.delivered, c.sent))} delivered, {formatPercent(rate(c.read, c.delivered))} read
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="wa-only-wide">
                <Table head={<>
                  <Th>Campaign</Th><Th tight>Started</Th><Th tight>Status</Th><Th tight>Sent</Th><Th tight>Delivered</Th><Th tight>Read</Th><Th tight>Failed</Th>
                </>}>
                  {showing.campaigns.map((c) => (
                    <tr key={c.id} className="wa-row-link transition-colors hover:bg-line-soft" onClick={(event) => {
                      if (event.target.closest('a')) return
                      navigate(`/whatsapp/campaigns/${c.id}`)
                    }}>
                      <Td>
                        <Link to={`/whatsapp/campaigns/${c.id}`} className="wa-link">{c.name}</Link>
                        <div className="text-[12px] text-muted">{c.template}</div>
                      </Td>
                      <Td tight className="text-muted">{formatStamp(c.createdAt)}</Td>
                      <Td tight><Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{sentenceCase(c.status)}</Badge></Td>
                      <Td tight>{count(c.sent)} / {count(c.audience)}</Td>
                      <Td tight>{formatPercent(rate(c.delivered, c.sent))}</Td>
                      <Td tight>{formatPercent(rate(c.read, c.delivered))}</Td>
                      <Td tight className={c.failed ? 'text-danger' : 'text-muted'}>{count(c.failed)}</Td>
                    </tr>
                  ))}
                </Table>
                </div>
              </>)}
            </Card>

            <div className="wa-grid-2">
              <Card title="Account health" sub="Your WhatsApp Business number, as Meta rates it"
                foot="Quality drops when people block or report your messages. Low quality can pause templates and lower the messaging limit.">
                {!showing.account ? <p className="wa-quiet">Meta did not return the number&apos;s details.</p> : (
                  <ul className="wa-rows">
                    <Row label="Business name">
                      {showing.account.verifiedName ?? '—'}
                      {showing.account.nameStatus && showing.account.nameStatus !== 'APPROVED' && <> <Badge tone="warn">{sentenceCase(showing.account.nameStatus)}</Badge></>}
                    </Row>
                    <Row label="Number">{showing.account.phone ?? '—'}</Row>
                    <Row label="Quality rating"><QualityLabel value={showing.account.quality} /></Row>
                    <Row label="Messaging limit">{messagingLimitLabel(showing.account.messagingLimit, formatCount) ?? '—'}</Row>
                    <Row label="Throughput">{THROUGHPUT[showing.account.throughput] ?? showing.account.throughput ?? '—'}</Row>
                    {showing.templateHealth && (
                      <Row label="Approved templates">{templateHealthText(showing.templateHealth)}</Row>
                    )}
                  </ul>
                )}
              </Card>
              <Card title="Audience and inbox" sub="Right now">
                <ul className="wa-rows">
                  <Row label="Contacts">{count(showing.audience.contacts)}</Row>
                  <Row label="Opted out">
                    {count(showing.audience.optedOut)}
                    {showing.audience.contacts > 0 && <span className="text-muted"> ({formatPercent(rate(showing.audience.optedOut, showing.audience.contacts))})</span>}
                  </Row>
                  <Row label={`Added in the last ${days} days`}>{count(showing.audience.added)}</Row>
                  <Row label="Open chats">{count(showing.inbox.open)}</Row>
                  <Row label="Chats with unread messages">
                    {showing.inbox.unread > 0 ? <Link to="/whatsapp/inbox" className="wa-link">{count(showing.inbox.unread)}</Link> : '0'}
                  </Row>
                </ul>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <li>
      <span className="wa-row-key">{label}</span>
      <span className="wa-row-value">{children}</span>
    </li>
  )
}

/** Quick-reply taps plus link taps, where Meta reports them. */
const tapsOf = (row) => (row.replyTapTotal ?? 0) + (row.linkTaps ?? 0)

function tapBreakdown(row) {
  const parts = [`${formatCount(row.replyTapTotal ?? 0)} quick replies`]
  if (row.linkTaps !== null && row.linkTaps !== undefined) parts.push(`${formatCount(row.linkTaps)} link taps`)
  return parts.join(', ')
}

function templateHealthText(health) {
  const parts = []
  if (health.GREEN) parts.push(`${health.GREEN} high`)
  if (health.YELLOW) parts.push(`${health.YELLOW} medium`)
  if (health.RED) parts.push(`${health.RED} low`)
  if (health.UNKNOWN) parts.push(`${health.UNKNOWN} not rated`)
  if (health.paused) parts.push(`${health.paused} paused or disabled`)
  return parts.length ? parts.join(', ') : 'None'
}

function formatStamp(value) {
  const date = parseStamp(value)
  return date ? date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
}

/** Spend has a row only for days with charges; the chart wants every day of the period. */
function fillDays(points, daily) {
  const byDay = new Map(points.map((p) => [p.day, p.cost]))
  return daily.map(({ day }) => ({ day, cost: byDay.get(day) ?? 0 }))
}
