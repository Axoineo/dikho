import { Icon } from '../../components/Icon'
import { PageHeader as CrmPageHeader } from '../../components/crm/CrmUi'
import './whatsapp.css'

// Shared Tailwind primitives for the WhatsApp Marketing screens. Colours come
// from the token-backed palette in tailwind.config.js, so every one of these
// follows the dashboard's existing light/dark toggle automatically.

export function Panel({ className = '', children }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-line bg-surface ${className}`}>
      {children}
    </div>
  )
}

export function PanelHead({ title, subtitle, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3.5 py-3">
      <div>
        <h2 className="m-0 text-[13px] font-medium text-ink">{title}</h2>
        {subtitle && <p className="mb-0 mt-0.5 text-[12px] text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

const BADGE_TONES = {
  neutral: 'bg-line-soft text-muted',
  success: 'bg-tint-ok text-ok',
  info: 'bg-brand-soft text-brand-ink',
  warn: 'bg-tint-warn text-[#8a5a0b] dark:text-accent',
  danger: 'bg-tint-danger text-danger',
}

export function Badge({ tone = 'neutral', children }) {
  return (
    <span className={`inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full
      px-2 text-[11px] font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  )
}

const ALERT_TONES = {
  error: { cls: 'bg-tint-danger border-tint-danger-line text-danger', icon: 'alert' },
  success: { cls: 'bg-tint-ok border-tint-ok-line text-ok', icon: 'check' },
  info: { cls: 'bg-brand-soft border-tint-brand-line text-ink', icon: 'alert' },
  warn: { cls: 'bg-tint-warn border-tint-warn-line text-[#b8830f] dark:text-accent', icon: 'alert' },
}

export function Alert({ tone = 'info', children }) {
  const { cls, icon } = ALERT_TONES[tone]
  return (
    <div className={`mb-3.5 flex items-start gap-2.5 rounded-lg border border-transparent px-3 py-2.5
      text-[12px] leading-relaxed ${cls}`}>
      <span className="mt-px shrink-0"><Icon name={icon} size={16} /></span>
      <span>{children}</span>
    </div>
  )
}

export function EmptyState({ title, children }) {
  return (
    <div className="px-5 py-10 text-center text-[13px] text-muted">
      {title && <div className="mb-1 text-[15px] font-medium text-ink">{title}</div>}
      {children}
    </div>
  )
}

// Borders use currentColor so the spinner inherits whatever colour it sits in.
export function Spinner({ className = '' }) {
  return (
    <span className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2
      border-transparent border-r-current border-t-current ${className}`} />
  )
}

// `min-w` keeps columns readable on narrow screens by scrolling the table
// instead of crushing every column. `table-auto` overrides the global
// `table { table-layout: fixed }` rule in index.css, which would otherwise
// ignore content widths and collapse columns.
export function Table({ head, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] table-auto border-collapse text-[13px]">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Th({ tight = false, className = '', children }) {
  return (
    <th className={`wa-cell h-9 whitespace-nowrap border-b border-line bg-surface px-3 text-left
      text-[12px] font-normal normal-case tracking-normal text-muted
      ${tight ? 'wa-tight' : ''} ${className}`}>
      {children}
    </th>
  )
}

export function Td({ tight = false, className = '', children, ...rest }) {
  return (
    <td className={`wa-cell border-b border-line-soft px-3 py-2 align-middle [overflow-wrap:break-word]
      ${tight ? 'wa-tight whitespace-nowrap' : ''} ${className}`} {...rest}>
      {children}
    </td>
  )
}

export function Avatar({ name, phone }) {
  const label = (name || '').trim()
    ? name.trim().slice(0, 2).toUpperCase()
    : String(phone || '').slice(-2)
  return (
    <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full
      bg-brand-soft text-[11px] font-medium text-brand-ink">
      {label}
    </span>
  )
}

// The same header as every other page (docs/DESIGN.md): title, one line,
// actions on the right. No all-capitals label above it.
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-4">
      <CrmPageHeader title={title} subtitle={subtitle}>{children}</CrmPageHeader>
    </div>
  )
}

export const inputClass = `w-full min-h-[34px] rounded-lg border border-line bg-surface px-2.5 py-1.5
  text-[13px] text-ink outline-none transition
  focus:border-brand focus:ring-[3px] focus:ring-brand-soft`
