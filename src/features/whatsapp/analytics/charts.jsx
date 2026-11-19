// Small hand-written SVG charts for the WhatsApp dashboard. No chart library:
// three forms cover every figure here (lines over time, columns over time, ranked
// bars), and owning them keeps the bundle small and the look on our tokens.
//
// Rules they follow (the dataviz method): one axis, thin 2px lines, columns with
// 4px rounded tops on the baseline and a 2px gap, recessive grid, a legend for
// two or more series plus direct labels at the line ends, a hover crosshair with
// a tooltip, arrow keys for the same readout, and a table view beside every
// time chart. Series colours are CSS variables (analytics.css) with their own
// dark-mode steps, validated against both surfaces.
import { useEffect, useId, useRef, useState } from 'react'
import './analytics.css'
import { scale } from './scale'

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** Width of an element, kept current as the layout changes. */
function useWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const update = () => setWidth(Math.floor(element.getBoundingClientRect().width))
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/**
 * Indices for at most `room` x labels at an even step, counted back from the
 * last point so the most recent day is always labelled.
 */
function labelIndices(n, room, steps) {
  if (n <= 0) return []
  if (steps) {
    // Round steps for a regular x (hours: every 6, 12 or 24), counted from the start.
    const step = steps.find((s) => Math.ceil(n / s) <= room) ?? steps.at(-1)
    const picked = []
    for (let i = 0; i < n; i += step) picked.push(i)
    if (picked.at(-1) !== n - 1 && n - 1 - picked.at(-1) >= step / 2) picked.push(n - 1)
    return picked
  }
  const step = Math.max(1, Math.ceil(n / Math.max(1, room)))
  const picked = []
  for (let i = n - 1; i >= 0; i -= step) picked.push(i)
  return picked.reverse()
}

const textWidth = (text) => String(text).length * 6.6 + 4

/** Spreads direct labels apart so none overlap: keeps order, moves the fewest pixels. */
function spread(items, gap, min, max) {
  const sorted = [...items].sort((a, b) => a.y - b.y)
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].y - sorted[i - 1].y < gap) sorted[i].y = sorted[i - 1].y + gap
  }
  const overflow = sorted.length ? sorted.at(-1).y - max : 0
  if (overflow > 0) for (const item of sorted) item.y -= overflow
  if (sorted.length && sorted[0].y < min) {
    const shift = min - sorted[0].y
    for (const item of sorted) item.y += shift
  }
  return sorted
}

/** The tooltip, kept inside the chart and flipped to the other side of the pointer near the edge. */
function Tooltip({ x, width, title, rows }) {
  const flip = x > width * 0.6
  return (
    <div className={`wa-tooltip${flip ? ' is-flipped' : ''}`} style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined }} role="presentation">
      <div className="wa-tooltip-title">{title}</div>
      {rows.map((row) => (
        <div key={row.label} className="wa-tooltip-row">
          {row.cls && <span className={`wa-swatch ${row.cls}`} aria-hidden="true" />}
          <span className="wa-tooltip-label">{row.label}</span>
          <span className="wa-tooltip-value">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ series }) {
  return (
    <ul className="wa-legend" aria-label="Legend">
      {series.map((s) => (
        <li key={s.key}><span className={`wa-swatch ${s.cls}`} aria-hidden="true" />{s.label}</li>
      ))}
    </ul>
  )
}

/** Arrow keys move a readout across the chart, for keyboard and screen-reader users. */
function useKeyboardIndex(n, setIndex) {
  return (event) => {
    const keys = { ArrowLeft: -1, ArrowRight: 1 }
    if (event.key === 'Home') { setIndex(0); event.preventDefault(); return }
    if (event.key === 'End') { setIndex(n - 1); event.preventDefault(); return }
    if (event.key === 'Escape') { setIndex(null); return }
    if (!(event.key in keys)) return
    event.preventDefault()
    setIndex((current) => Math.max(0, Math.min(n - 1, (current ?? n - 1) + keys[event.key])))
  }
}

/* ── Lines over time ───────────────────────────────────────────────────── */

/**
 * One line per series over the same x. `series`: [{ key, label, cls }], where cls
 * names the colour class (wa-s1, wa-s2, wa-s3).
 */
export function LineChart({ data, x, series, height = 240, formatValue = String, formatAxis = formatValue, formatX = String, formatTip = formatX, label, integer = true, labelSteps }) {
  const [ref, width] = useWidth()
  const [index, setIndex] = useState(null)
  const liveId = useId()
  const n = data.length
  const max = Math.max(0, ...data.flatMap((row) => series.map((s) => Number(row[s.key]) || 0)))
  const { top, ticks } = scale(max, { integer })
  const leftPad = Math.max(...ticks.map((t) => textWidth(formatAxis(t)))) + 6
  const directLabels = width >= 520
  const rightPad = directLabels ? Math.max(...series.map((s) => textWidth(s.label))) + 14 : 10
  const plot = { left: leftPad, right: Math.max(leftPad + 10, width - rightPad), top: 10, bottom: height - 26 }
  const xAt = (i) => (n <= 1 ? (plot.left + plot.right) / 2 : plot.left + (i * (plot.right - plot.left)) / (n - 1))
  const yAt = (v) => plot.bottom - ((Number(v) || 0) / top) * (plot.bottom - plot.top)

  const paths = series.map((s) => ({
    ...s,
    d: data.map((row, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(row[s.key]).toFixed(1)}`).join(''),
  }))

  const ends = directLabels && n
    ? spread(series.map((s) => ({ key: s.key, label: s.label, y: yAt(data[n - 1][s.key]) })), 14, plot.top + 4, plot.bottom)
    : []
  const xLabels = labelIndices(n, Math.floor((plot.right - plot.left) / 64) + 1, labelSteps)
  const onKeyDown = useKeyboardIndex(n, setIndex)

  const pick = (event) => {
    if (!n) return
    const box = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - box.left
    const i = n <= 1 ? 0 : Math.round(((px - plot.left) / (plot.right - plot.left)) * (n - 1))
    setIndex(Math.max(0, Math.min(n - 1, i)))
  }
  const active = index !== null && index < n ? data[index] : null

  return (
    <div className="wa-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <div
          className="wa-chart-focus"
          tabIndex={0}
          role="group"
          aria-label={`${label}. Use the left and right arrow keys to read each day.`}
          aria-describedby={liveId}
          onKeyDown={onKeyDown}
          onBlur={() => setIndex(null)}
        >
          <svg width={width} height={height} aria-hidden="true" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setIndex(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="wa-grid" x1={plot.left} x2={plot.right} y1={yAt(t)} y2={yAt(t)} />
                <text className="wa-axis" x={plot.left - 6} y={yAt(t)} dy="0.32em" textAnchor="end">{formatAxis(t)}</text>
              </g>
            ))}
            {xLabels.map((i) => (
              <text key={i} className="wa-axis" x={xAt(i)} y={plot.bottom + 18}
                textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}>
                {formatX(data[i][x])}
              </text>
            ))}
            {paths.map((p) => <path key={p.key} className={`wa-line ${p.cls}`} d={p.d} />)}
            {n === 1 && series.map((s) => <circle key={s.key} className={`wa-dot ${s.cls}`} cx={xAt(0)} cy={yAt(data[0][s.key])} r="4" />)}
            {ends.map((e) => (
              <text key={e.key} className="wa-direct" x={plot.right + 8} y={e.y} dy="0.32em">{e.label}</text>
            ))}
            {active && (
              <g>
                <line className="wa-crosshair" x1={xAt(index)} x2={xAt(index)} y1={plot.top} y2={plot.bottom} />
                {series.map((s) => <circle key={s.key} className={`wa-dot ${s.cls}`} cx={xAt(index)} cy={yAt(active[s.key])} r="4" />)}
              </g>
            )}
            {/* Bigger than the marks, so the readout follows the pointer anywhere over the plot. */}
            <rect x={0} y={0} width={width} height={height} fill="transparent" />
          </svg>
          {active && (
            <Tooltip x={xAt(index)} width={width} title={formatTip(active[x])}
              rows={series.map((s) => ({ label: s.label, cls: s.cls, value: formatValue(active[s.key] ?? 0) }))} />
          )}
        </div>
      )}
      <div id={liveId} className="wa-sr-only" aria-live="polite">
        {active ? `${formatTip(active[x])}: ${series.map((s) => `${s.label} ${formatValue(active[s.key] ?? 0)}`).join(', ')}` : ''}
      </div>
    </div>
  )
}

/* ── Columns over time ─────────────────────────────────────────────────── */

/** One series as columns, one per x. The chart's title names the series, so no legend. */
export function ColumnChart({ data, x, value, cls = 'wa-s1', height = 180, formatValue = String, formatAxis = formatValue, formatX = String, formatTip = formatX, label, integer = true, seriesLabel }) {
  const [ref, width] = useWidth()
  const [index, setIndex] = useState(null)
  const liveId = useId()
  const n = data.length
  const max = Math.max(0, ...data.map((row) => Number(row[value]) || 0))
  const { top, ticks } = scale(max, { integer })
  const leftPad = Math.max(...ticks.map((t) => textWidth(formatAxis(t)))) + 6
  const plot = { left: leftPad, right: Math.max(leftPad + 10, width - 4), top: 10, bottom: height - 26 }
  const band = n ? (plot.right - plot.left) / n : 0
  const barWidth = Math.max(1, Math.min(32, band - 2))
  const yAt = (v) => plot.bottom - ((Number(v) || 0) / top) * (plot.bottom - plot.top)
  const center = (i) => plot.left + band * i + band / 2
  const xLabels = labelIndices(n, Math.floor((plot.right - plot.left) / 64) + 1)
  const onKeyDown = useKeyboardIndex(n, setIndex)
  const active = index !== null && index < n ? data[index] : null

  const pick = (event) => {
    if (!n) return
    const box = event.currentTarget.getBoundingClientRect()
    const i = Math.floor((event.clientX - box.left - plot.left) / band)
    setIndex(Math.max(0, Math.min(n - 1, i)))
  }

  // Rounded top corners only: the column stands on the baseline.
  const column = (i, v) => {
    const h = plot.bottom - yAt(v)
    if (h <= 0) return null
    const r = Math.min(4, h, barWidth / 2)
    const left = center(i) - barWidth / 2
    const right = left + barWidth
    const top = plot.bottom - h
    return `M${left},${plot.bottom}V${top + r}Q${left},${top} ${left + r},${top}H${right - r}Q${right},${top} ${right},${top + r}V${plot.bottom}Z`
  }

  return (
    <div className="wa-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <div className="wa-chart-focus" tabIndex={0} role="group"
          aria-label={`${label}. Use the left and right arrow keys to read each column.`}
          aria-describedby={liveId} onKeyDown={onKeyDown} onBlur={() => setIndex(null)}>
          <svg width={width} height={height} aria-hidden="true" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setIndex(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="wa-grid" x1={plot.left} x2={plot.right} y1={yAt(t)} y2={yAt(t)} />
                <text className="wa-axis" x={plot.left - 6} y={yAt(t)} dy="0.32em" textAnchor="end">{formatAxis(t)}</text>
              </g>
            ))}
            {xLabels.map((i) => (
              <text key={i} className="wa-axis" x={center(i)} y={plot.bottom + 18}
                textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}>
                {formatX(data[i][x])}
              </text>
            ))}
            {active && <rect className="wa-band" x={center(index) - band / 2} y={plot.top} width={band} height={plot.bottom - plot.top} />}
            {data.map((row, i) => {
              const d = column(i, row[value])
              return d ? <path key={row[x]} className={`wa-column ${cls}`} d={d} /> : null
            })}
            <rect x={0} y={0} width={width} height={height} fill="transparent" />
          </svg>
          {active && (
            <Tooltip x={center(index)} width={width} title={formatTip(active[x])}
              rows={[{ label: seriesLabel ?? label, cls, value: formatValue(active[value] ?? 0) }]} />
          )}
        </div>
      )}
      <div id={liveId} className="wa-sr-only" aria-live="polite">
        {active ? `${formatTip(active[x])}: ${formatValue(active[value] ?? 0)}` : ''}
      </div>
    </div>
  )
}

/* ── Ranked bars ───────────────────────────────────────────────────────── */

/**
 * Horizontal bars, largest first, each with its label and value written out, so
 * nothing depends on reading the bar's length or colour.
 * items: [{ key, label, value, note, detail }]: note beside the value, detail under the label.
 */
export function BarList({ items, formatValue = String, cls = 'wa-s1', max: fixedMax, label }) {
  const max = fixedMax ?? Math.max(1, ...items.map((item) => item.value || 0))
  return (
    <ul className="wa-bars" aria-label={label}>
      {items.map((item) => {
        const share = Math.max(0, Math.min(1, (item.value || 0) / max))
        return (
          <li key={item.key ?? item.label} className="wa-bar-row" title={`${item.label}: ${formatValue(item.value)}`}>
            <div className="wa-bar-text">
              <span className="wa-bar-label">
                {item.label}
                {item.detail && <span className="wa-bar-detail">{item.detail}</span>}
              </span>
              <span className="wa-bar-value">{formatValue(item.value)}{item.note && <span className="wa-bar-note"> {item.note}</span>}</span>
            </div>
            <div className="wa-bar-track" aria-hidden="true">
              {share > 0 && <div className={`wa-bar-fill ${cls}`} style={{ width: `max(${(share * 100).toFixed(2)}%, 4px)` }} />}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ── Table view ────────────────────────────────────────────────────────── */

/** The numbers behind a time chart, for reading exact values or copying them out. */
export function ChartTable({ data, columns, caption }) {
  return (
    <div className="wa-chart-table">
      <table>
        <caption className="wa-sr-only">{caption}</caption>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={c.numeric ? 'is-num' : ''}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {[...data].reverse().map((row, i) => (
            <tr key={i}>
              {columns.map((c) => <td key={c.key} className={c.numeric ? 'is-num' : ''}>{c.format ? c.format(row[c.key], row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
