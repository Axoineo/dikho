import { useState } from 'react'

// `type="whatsapp"` opens a wa.me chat with `value` (any formatting — spaces,
// +, dashes — stripped to bare digits, same as wa.me requires) and an
// optional pre-filled `waMessage`. `showValue=false` renders the button alone
// with no repeated phone/email text, for stacking a second action (e.g.
// WhatsApp) right after a `type="phone"` call that already showed the number —
// see src/features/leads/LeadsPage.jsx.
export function ContactHoverAction({ type, value, showValue = true, waMessage }) {
  const [touched, setTouched] = useState(false)
  if (!value) return null

  const isPhone = type === 'phone'
  const isWhatsapp = type === 'whatsapp'
  const href = isPhone
    ? `tel:${value.replace(/\s/g, '')}`
    : isWhatsapp
      ? `https://wa.me/${value.replace(/\D/g, '')}${waMessage ? `?text=${encodeURIComponent(waMessage)}` : ''}`
      : `mailto:${value}`
  const label = isPhone ? 'Call' : isWhatsapp ? 'WhatsApp' : 'Email'
  const colorClass = isPhone ? 'cd-action-btn--call' : isWhatsapp ? 'cd-action-btn--whatsapp' : 'cd-action-btn--email'

  const icon = isPhone ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.6 10.8a15.16 15.16 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1.02-.24 11.42 11.42 0 0 0 3.58.58 1 1 0 0 1 1 1V19a1 1 0 0 1-1 1A17 17 0 0 1 3 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.58 3.58a1 1 0 0 1-.25 1.02L6.6 10.8z"/></svg>
  ) : isWhatsapp ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2c-5.52 0-10 4.48-10 10 0 1.77.46 3.45 1.27 4.9L2 22l5.25-1.38a9.96 9.96 0 0 0 4.79 1.22h.01c5.52 0 10-4.48 10-10s-4.48-9.84-10.01-9.84zm5.84 14.3c-.25.7-1.45 1.34-2 1.42-.51.08-1.15.11-1.86-.12-.43-.14-.98-.32-1.68-.63-2.96-1.28-4.89-4.26-5.04-4.46-.15-.2-1.2-1.6-1.2-3.05 0-1.45.76-2.16 1.03-2.46.27-.3.59-.37.79-.37.2 0 .4 0 .57.01.18.01.43-.07.67.51.25.6.85 2.08.92 2.23.07.15.12.33.02.53-.1.2-.15.33-.3.5-.15.18-.31.4-.45.54-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.02 1.12 1 2.06 1.31 2.36 1.46.3.15.48.13.65-.08.18-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.73.82 2.02.97.3.15.5.22.57.35.07.13.07.75-.18 1.45z"/></svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 7l8.586 6.414a2 2 0 0 0 2.828 0L22 7"/></svg>
  )

  return (
    <div
      className={`contact-hover-wrap ${touched ? 'touched' : ''} ${!isPhone && showValue ? 'mt' : ''}`}
      onTouchStart={() => setTouched(true)}
      onTouchEnd={() => setTimeout(() => setTouched(false), 1200)}
    >
      {showValue && <span className={isPhone ? 'cell-primary' : 'cell-secondary'} title={value}>{value}</span>}
      <a
        href={href}
        className={`cd-action-btn ${colorClass} cd-action-btn--sm`}
        aria-label={`${label} ${value}`}
        target={isWhatsapp ? '_blank' : undefined}
        rel={isWhatsapp ? 'noopener noreferrer' : undefined}
        onClick={(e) => {
          e.stopPropagation()
          // Fallback if native href doesn't trigger
          if (href.startsWith('mailto:')) {
            window.location.href = href
          } else if (href.startsWith('tel:')) {
            window.open(href, '_self')
          }
          // wa.me opens fine via the plain href + target="_blank" above.
        }}
        tabIndex={0}
      >
        {icon}
        <span>{label}</span>
      </a>
    </div>
  )
}
