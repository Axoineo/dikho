// Pieces the dashboard and the campaign page share: a figure with its change, a
// card, a quality label and the funnel.
import { Icon } from '../../../components/Icon'
import { BarList } from './charts'
import { formatPercent, quality, rate } from './figures'

export function Card({ title, sub, action, foot, children, className = '' }) {
  return (
    <section className={`wa-card ${className}`} aria-label={title}>
      <div className="wa-card-head">
        <div>
          <h2 className="wa-card-title">{title}</h2>
          {sub && <p className="wa-card-sub">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="wa-card-body">{children}</div>
      {foot && <p className="wa-card-foot">{foot}</p>}
    </section>
  )
}

/** "↑ 12% vs previous 30 days", green when the move is good, red when bad, grey when neither. */
export function Delta({ change: c, period }) {
  if (!c) return null
  const arrow = c.direction === 'up' ? '↑' : c.direction === 'down' ? '↓' : ''
  const words = c.tone === 'good' ? 'better' : c.tone === 'bad' ? 'worse' : null
  return (
    <span className={`wa-delta is-${c.tone}`}>
      <span className="wa-delta-figure">
        {arrow && <span aria-hidden="true">{arrow} </span>}
        {c.direction === 'down' && <span className="wa-sr-only">down </span>}
        {c.direction === 'up' && <span className="wa-sr-only">up </span>}
        {c.text}
      </span>
      {period && <span className="wa-delta-period"> vs {period}</span>}
      {words && <span className="wa-sr-only">, {words}</span>}
    </span>
  )
}

export function Kpi({ label, value, sub, change, period, title }) {
  return (
    <div className="wa-kpi" title={title}>
      <span className="wa-kpi-label">{label}</span>
      <span className="wa-kpi-value">{value}</span>
      {sub && <span className="wa-kpi-sub">{sub}</span>}
      <Delta change={change} period={period} />
    </div>
  )
}

export function KpiSkeleton({ count = 6 }) {
  return (
    <div className="wa-kpis" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <div key={i} className="wa-skel" style={{ height: 92 }} />)}
    </div>
  )
}

/** Meta's quality rating as an icon and a word, never colour alone. */
export function QualityLabel({ value, prefix }) {
  const q = quality(value)
  return (
    <span className={`wa-status is-${q.tone}`}>
      {q.icon && <Icon name={q.icon} size={14} />}
      {prefix ? `${prefix} ${q.label.toLowerCase()}` : q.label}
    </span>
  )
}

/**
 * Each step against the one before it: Sent, then how many of those were
 * delivered, then read. Bars share one scale, the first step.
 */
export function Funnel({ steps, formatValue }) {
  const first = steps[0]?.value || 0
  return (
    <BarList
      label="Funnel"
      max={Math.max(1, first)}
      formatValue={formatValue}
      items={steps.map((step, i) => {
        // A step can measure against an earlier one: replies against delivered,
        // since people reply without read receipts switched on.
        const base = steps[step.of ?? i - 1]
        return {
          key: step.label,
          label: step.label,
          value: step.value,
          note: i === 0 ? step.note : `${formatPercent(rate(step.value, base.value))} of ${base.label.toLowerCase()}`,
        }
      })}
    />
  )
}

/**
 * Button taps: quick replies, counted exactly from the replies in our own records,
 * and links, which only Meta sees. Links show only while Meta's template insights
 * answer (`links` is null otherwise), so if the owner ever switches insights on, they
 * appear with no change here.
 */
export function TapLists({ replies, links, formatValue, linkLabel = 'Links' }) {
  return (
    <div className={links === null ? 'wa-taps is-single' : 'wa-taps'}>
      <div>
        <h3 className="wa-subhead">Quick replies</h3>
        {replies.length === 0 ? <p className="wa-note">No quick-reply taps.</p> : (
          <BarList label="Quick-reply taps" formatValue={formatValue}
            items={replies.map((r, i) => ({ key: `${r.label}-${r.detail ?? i}`, label: r.label, value: r.count, note: r.note, detail: r.detail }))} />
        )}
      </div>
      {links !== null && (
        <div>
          <h3 className="wa-subhead">{linkLabel}</h3>
          {links.length === 0 ? <p className="wa-note">No link taps.</p> : (
            <BarList label="Link taps" formatValue={formatValue}
              items={links.map((l, i) => ({ key: `${l.label}-${l.detail ?? i}`, label: l.label, value: l.count, note: l.note, detail: l.detail }))} />
          )}
        </div>
      )}
    </div>
  )
}
