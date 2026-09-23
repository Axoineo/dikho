import { Icon } from '../../components/Icon'

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
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-[18px] py-[15px]">
      <div>
        <h2 className="m-0 text-[15px] font-semibold tracking-[-0.1px]">{title}</h2>
        {subtitle && <p className="mb-0 mt-[3px] text-[12.5px] text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

const BADGE_TONES = {
  neutral: 'bg-line-soft text-muted border-line',
  success: 'bg-tint-ok text-ok border-tint-ok-line',
  info: 'bg-brand-soft text-brand border-tint-brand-line dark:text-[#5ba0e0]',
  warn: 'bg-tint-warn text-[#b8830f] border-tint-warn-line dark:text-accent',
  danger: 'bg-tint-danger text-danger border-tint-danger-line',
}

export function Badge({ tone = 'neutral', children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border
      px-2.5 py-[3px] text-[11px] font-semibold tracking-[0.2px] ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  )
}

const ALERT_TONES = {
  error: { cls: 'bg-tint-danger border-tint-danger-line text-danger', icon: 'alert' },
  success: { cls: 'bg-tint-ok border-tint-ok-line text-ok', icon: 'check' },
  info: { cls: 'bg-brand-soft border-tint-brand-line text-ink', icon: 'alert' },
}

export function Alert({ tone = 'info', children }) {
  const { cls, icon } = ALERT_TONES[tone]
  return (
    <div className={`mb-3.5 flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3
      text-[12.8px] leading-relaxed ${cls}`}>
      <span className="mt-px shrink-0"><Icon name={icon} size={16} /></span>
      <span>{children}</span>
    </div>
  )
}

export function EmptyState({ title, children }) {
  return (
    <div className="px-5 py-11 text-center text-[13.5px] text-muted">
      {title && <div className="mb-1.5 text-[15px] font-semibold text-ink">{title}</div>}
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
    <th className={`whitespace-nowrap border-b border-line bg-line-soft px-3.5 py-2.5 text-left
      text-[10.5px] font-extrabold uppercase tracking-[0.8px] text-muted
      ${tight ? 'w-[1%]' : ''} ${className}`}>
      {children}
    </th>
  )
}

export function Td({ tight = false, className = '', children, ...rest }) {
  return (
    <td className={`border-b border-line-soft px-3.5 py-[11px] align-middle [overflow-wrap:break-word]
      ${tight ? 'w-[1%] whitespace-nowrap' : ''} ${className}`} {...rest}>
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
      bg-brand-soft text-[11.5px] font-bold text-brand dark:text-[#5ba0e0]">
      {label}
    </span>
  )
}

export function PageHeader({ kicker = 'WHATSAPP MARKETING', title, subtitle, children }) {
  return (
    <div className="mb-[18px] flex flex-wrap items-end justify-between gap-6">
      <div>
        <span className="mb-1.5 block text-[10px] font-extrabold tracking-[0.9px] text-muted">
          {kicker}
        </span>
        <h1 className="m-0 mb-1 text-[27px] leading-tight tracking-[-0.4px]">{title}</h1>
        {subtitle && <p className="m-0 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

export const inputClass = `w-full min-h-[38px] rounded-[9px] border border-line bg-surface px-3 py-2
  text-[13.5px] text-ink outline-none transition
  focus:border-brand focus:ring-[3px] focus:ring-brand-soft`
