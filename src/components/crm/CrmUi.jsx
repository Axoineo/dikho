// Building blocks for the CRM modules (Clients, Vendors, Sales Orders,
// Purchase Orders), so the four pages share one header, table, panel and form
// instead of each carrying its own copy. Styles: ./crm.css.
import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { formatCount } from '../../lib/format'
import './crm.css'

/* ── Small helpers ─────────────────────────────────────────────────────── */

// Words that say what kind of company it is rather than which one.
const LEGAL_WORDS = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'co', 'inc', 'the', 'and', '&', 'm/s'])

/** "Aarav Retail Group Pvt Ltd" → "AR" */
function initials(name) {
  const words = String(name || '')
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s.,/-]+/)
    .filter((word) => word && !LEGAL_WORDS.has(word.toLowerCase()))
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * Runs `handler` on Escape while `active`. Layers that sit on top (a form
 * over a details panel, a popover) pass `onTop`: they hear the key first and
 * claim it, so one press closes one layer rather than all of them.
 */
function useEscape(handler, active = true, onTop = false) {
  const saved = useRef(handler)
  useEffect(() => { saved.current = handler }, [handler])
  useEffect(() => {
    if (!active) return undefined
    function onKey(event) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (onTop) event.preventDefault()
      saved.current?.(event)
    }
    document.addEventListener('keydown', onKey, onTop)
    return () => document.removeEventListener('keydown', onKey, onTop)
  }, [active, onTop])
}

/* ── Page frame ────────────────────────────────────────────────────────── */

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="crm-header">
      <div>
        <h1 className="crm-title">{title}</h1>
        {subtitle && <p className="crm-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="crm-header-actions">{children}</div>}
    </header>
  )
}

export function SearchField({ value, onChange, placeholder, label, inputRef, children, ...inputProps }) {
  return (
    <div className="crm-search">
      <Icon name="search" size={17} />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck="false"
        {...inputProps}
      />
      {children}
      {value && (
        <button type="button" className="crm-icon-btn" onClick={() => onChange('')} aria-label="Clear search">
          <Icon name="close" size={15} />
        </button>
      )}
    </div>
  )
}

/** "42 clients", or "3 of 42 clients" when a search narrows the list. */
export function ResultCount({ shown, total, noun, plural, filtered }) {
  const word = total === 1 ? noun : (plural || `${noun}s`)
  if (filtered) return <span className="crm-count"><strong>{formatCount(shown)}</strong> matching {word}</span>
  return <span className="crm-count"><strong>{formatCount(total)}</strong> {word}</span>
}

export function Pagination({ page, totalPages, start, end, total, pageSize, pageSizes, onPage, onPageSize }) {
  const current = Math.min(page, totalPages)
  const numbers = [current - 2, current - 1, current, current + 1, current + 2].filter((n) => n >= 1 && n <= totalPages)
  return (
    <nav className="crm-pagination" aria-label="Pages">
      <span className="crm-pagination-summary">
        {total === 0 ? 'Nothing to show' : <>Showing <strong>{formatCount(start)}–{formatCount(end)}</strong> of {formatCount(total)}</>}
      </span>
      <div className="crm-pagination-controls">
        {pageSizes && onPageSize && (
          <select className="crm-page-size" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} aria-label="Rows per page">
            {pageSizes.map((size) => <option key={size} value={size}>{size} per page</option>)}
          </select>
        )}
        <button type="button" className="crm-icon-btn crm-flip" onClick={() => onPage(current - 1)} disabled={current <= 1} aria-label="Previous page">
          <Icon name="chevron" size={16} />
        </button>
        {numbers.map((number) => (
          <button
            type="button"
            key={number}
            className={`crm-page-btn${number === current ? ' is-current' : ''}`}
            onClick={() => onPage(number)}
            aria-current={number === current ? 'page' : undefined}
          >
            {number}
          </button>
        ))}
        <button type="button" className="crm-icon-btn" onClick={() => onPage(current + 1)} disabled={current >= totalPages} aria-label="Next page">
          <Icon name="chevron" size={16} />
        </button>
      </div>
    </nav>
  )
}

/* ── Table pieces ──────────────────────────────────────────────────────── */

export function StatusPill({ tone = 'neutral', children }) {
  return <span className={`crm-status crm-status--${tone}`}><span>{children}</span></span>
}

export function Monogram({ name, large }) {
  return <span className={`crm-monogram${large ? ' crm-monogram--lg' : ''}`} aria-hidden="true">{initials(name)}</span>
}

/** Title line plus a quieter second line; either may be empty. */
export function Cell({ main, sub, strong, mono, title }) {
  return (
    <div className="crm-cell" title={title}>
      <span className={`crm-cell-main${strong ? ' is-strong' : ''}${mono ? ' crm-mono' : ''}${main ? '' : ' crm-empty-value'}`}>{main || '—'}</span>
      {sub !== undefined && <span className={`crm-cell-sub${mono ? ' crm-mono' : ''}`}>{sub || '—'}</span>}
    </div>
  )
}

/** The row's name: a real button, so a row opens from the keyboard too. */
export function RowTitle({ name, sub, onOpen, monogram = true }) {
  return (
    <div className="crm-entity">
      {monogram && <Monogram name={name} />}
      <div className="crm-cell">
        <button type="button" className="crm-row-link crm-cell-main is-strong" onClick={(event) => { event.stopPropagation(); onOpen() }} title={name || ''}>
          {name || '—'}
        </button>
        {sub !== undefined && <span className="crm-cell-sub" title={sub || ''}>{sub || '—'}</span>}
      </div>
    </div>
  )
}

/** Phone over email, each a link that does not also open the row. */
export function ContactCell({ phone, email }) {
  const stop = (event) => event.stopPropagation()
  return (
    <div className="crm-cell">
      {phone
        ? <a className="crm-cell-main crm-link crm-mono" href={`tel:${phone.replace(/\s+/g, '')}`} onClick={stop}>{phone}</a>
        : <span className="crm-cell-main crm-empty-value">—</span>}
      {email
        ? <a className="crm-cell-sub crm-link" href={`mailto:${email}`} onClick={stop} title={email}>{email}</a>
        : <span className="crm-cell-sub">—</span>}
    </div>
  )
}

export function RowChevron() {
  return <span className="crm-row-chevron"><Icon name="chevron" size={16} /></span>
}

export function SkeletonRows({ rows = 8, columns }) {
  return Array.from({ length: rows }).map((_, row) => (
    <tr key={`skeleton-${row}`}>
      {Array.from({ length: columns }).map((__, cell) => (
        <td key={cell}>
          <span className="crm-skeleton" style={{ width: `${cell === 0 ? 70 : 45 + ((row + cell) % 4) * 10}%` }} />
          {cell < columns - 1 && <span className="crm-skeleton" style={{ width: `${30 + ((row * 3 + cell) % 3) * 10}%` }} />}
        </td>
      ))}
    </tr>
  ))
}

export function EmptyState({ icon = 'search', title, children, action }) {
  return (
    <div className="crm-empty">
      <span className="crm-empty-icon"><Icon name={icon} size={20} /></span>
      <p className="crm-empty-title">{title}</p>
      {children && <p className="crm-empty-copy">{children}</p>}
      {action}
    </div>
  )
}

/* ── Details panel ─────────────────────────────────────────────────────── */

export function DetailsPanel({ label, title, meta, monogram, actions, onClose, children }) {
  useEscape(onClose)
  return (
    <aside className="crm-panel" aria-label={label}>
      <div className="crm-panel-head">
        {monogram && <Monogram name={monogram} large />}
        <div className="crm-panel-heading">
          <h2 className="crm-panel-title">{title}</h2>
          {meta && <div className="crm-panel-meta">{meta}</div>}
        </div>
        <div className="crm-panel-actions">
          {actions}
          <button type="button" className="crm-icon-btn" onClick={onClose} aria-label="Close details" title="Close (Esc)">
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
      <div className="crm-panel-body">{children}</div>
    </aside>
  )
}

export function Section({ title, action, note, children }) {
  return (
    <section className="crm-section">
      {(title || action) && (
        <div className="crm-section-head">
          {title && <h3 className="crm-section-title">{title}</h3>}
          {action}
        </div>
      )}
      {note && <p className="crm-section-note">{note}</p>}
      {children}
    </section>
  )
}

/**
 * Label/value pairs. Empty values are left out so a sparse record reads as
 * short rather than as a column of dashes; `keep` forces a row to show.
 */
export function KeyValues({ items }) {
  const shown = items.filter((item) => item && (item.keep || (item.value !== null && item.value !== undefined && item.value !== '')))
  if (shown.length === 0) return <p className="crm-section-note">Nothing recorded yet.</p>
  return (
    <dl className="crm-kv">
      {shown.map((item) => (
        <div key={item.label} className={`crm-kv-item${item.wide ? ' is-wide' : ''}`}>
          <dt className="crm-kv-label">{item.label}</dt>
          <dd className={`crm-kv-value${item.mono ? ' crm-mono' : ''}`}>
            {item.href ? <a href={item.href}>{item.value}</a> : (item.value === null || item.value === undefined || item.value === '' ? '—' : item.value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* ── Forms ─────────────────────────────────────────────────────────────── */

/**
 * The modal every add/edit form sits in: a header, a scrolling body and a
 * footer that never scrolls away, so Save is always in reach.
 */
export function FormModal({ title, subtitle, wide, onClose, onSubmit, busy, submitDisabled, footerInfo, submitLabel, children, error, errorTitle }) {
  const bodyRef = useRef(null)
  useEscape(() => { if (!busy) onClose() }, true, true)

  // Land in the first field, and bring a new error into view.
  useEffect(() => {
    bodyRef.current?.querySelector('input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea')?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    if (error) bodyRef.current?.querySelector('.crm-form-error')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [error])

  return (
    <div className="crm-modal-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <form
        className={`crm-modal${wide ? ' crm-modal--wide' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="crm-modal-head">
          <div>
            <h2 className="crm-modal-title">{title}</h2>
            {subtitle && <p className="crm-modal-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="crm-icon-btn" onClick={onClose} disabled={busy} aria-label="Close" title="Close (Esc)">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="crm-modal-body" ref={bodyRef}>
          {error && (
            <div className="crm-form-error" role="alert">
              <Icon name="alert" size={17} />
              <div><strong>{errorTitle || 'Could not save'}</strong>{error}</div>
            </div>
          )}
          {children}
        </div>
        <div className="crm-modal-foot">
          {footerInfo && <div className="crm-modal-foot-info">{footerInfo}</div>}
          <button type="button" className="crm-btn crm-btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="crm-btn crm-btn--primary" disabled={busy || submitDisabled}>{busy ? 'Saving…' : (submitLabel || 'Save')}</button>
        </div>
      </form>
    </div>
  )
}

export function FormSection({ title, description, children }) {
  return (
    <section className="crm-form-section">
      {(title || description) && (
        <div className="crm-form-section-head">
          {title && <h3 className="crm-form-section-title">{title}</h3>}
          {description && <p className="crm-form-section-copy">{description}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({ label, htmlFor, required, optional, hint, hintTone, className = '', children }) {
  return (
    <div className={`crm-field ${className}`.trim()}>
      {label && (
        <label htmlFor={htmlFor}>
          {label}
          {required && <span className="crm-required" aria-hidden="true">*</span>}
          {optional && <span className="crm-optional">(optional)</span>}
        </label>
      )}
      {children}
      {hint && <span className={`crm-hint${hintTone ? ` is-${hintTone}` : ''}`}>{hint}</span>}
    </div>
  )
}

/** One control for every short single choice. */
export function Segmented({ value, options, onChange, label, block }) {
  return (
    <div className={`crm-segmented${block ? ' is-block' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function CheckToggle({ checked, onChange, children }) {
  return (
    <button type="button" className="crm-check" aria-pressed={checked} onClick={() => onChange(!checked)}>
      <span className="crm-check-box">{checked && <Icon name="check" size={13} strokeWidth={2.6} />}</span>
      {children}
    </button>
  )
}

/**
 * "More details": rarely used fields, one click away and never lost. Pass
 * `open` and `onToggle` to control it from outside (a line item keeps its
 * own open state); otherwise it remembers itself.
 */
export function Disclosure({ label = 'More details', count, defaultOpen = false, open: controlled, onToggle, children }) {
  const [own, setOwn] = useState(defaultOpen)
  const open = controlled ?? own
  const id = useId()
  return (
    <div className="crm-disclosure">
      <button type="button" className="crm-disclosure-toggle" aria-expanded={open} aria-controls={id} onClick={() => (onToggle ? onToggle() : setOwn((value) => !value))}>
        {open ? 'Fewer details' : label}
        {!open && count ? <span className="crm-disclosure-count">· {count}</span> : null}
        <Icon name="chevronDown" size={15} />
      </button>
      {open && <div className="crm-disclosure-body" id={id}>{children}</div>}
    </div>
  )
}

/* ── Header extras ─────────────────────────────────────────────────────── */

/** A public link people can copy, behind a "Share" button. */
export function ShareLink({ title, description, path }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef(null)
  const url = `${window.location.origin}${path}`
  useEscape(() => setOpen(false), open, true)

  useEffect(() => {
    if (!open) return undefined
    function onDown(event) { if (ref.current && !ref.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function copy() {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }, () => {})
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="crm-btn crm-btn--secondary" onClick={() => { setOpen((value) => !value); setCopied(false) }} aria-expanded={open}>
        <Icon name="share" size={16} /> Share
      </button>
      {open && (
        <div className="crm-popover" role="dialog" aria-label={title}>
          <p className="crm-popover-title">{title}</p>
          <p className="crm-popover-copy">{description}</p>
          <div className="crm-popover-row">
            <input className="crm-input" readOnly value={url} onFocus={(event) => event.target.select()} aria-label="Link" />
            <button type="button" className="crm-btn crm-btn--primary" onClick={copy}>
              <Icon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** A short confirmation after a save. */
export function Toast({ message, onDone }) {
  // Held in a ref so a parent re-rendering with a fresh callback does not
  // restart the timer and keep the toast up for ever.
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone }, [onDone])
  useEffect(() => {
    if (!message) return undefined
    const timer = setTimeout(() => done.current?.(), 2800)
    return () => clearTimeout(timer)
  }, [message])
  if (!message) return null
  return (
    <div className="crm-toast" role="status">
      <span className="crm-toast-icon"><Icon name="check" size={13} strokeWidth={2.6} /></span>
      {message}
    </div>
  )
}
