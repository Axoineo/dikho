import { useState } from 'react'

export function ContactHoverAction({ type, value }) {
  const [touched, setTouched] = useState(false)
  if (!value) return null
  
  const isPhone = type === 'phone'
  const href = isPhone ? `tel:${value.replace(/\s/g, '')}` : `mailto:${value}`
  const label = isPhone ? 'Call' : 'Email'
  const colorClass = isPhone ? 'cd-action-btn--call' : 'cd-action-btn--email'
  
  const icon = isPhone ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.6 10.8a15.16 15.16 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1.02-.24 11.42 11.42 0 0 0 3.58.58 1 1 0 0 1 1 1V19a1 1 0 0 1-1 1A17 17 0 0 1 3 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.58 3.58a1 1 0 0 1-.25 1.02L6.6 10.8z"/></svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 7l8.586 6.414a2 2 0 0 0 2.828 0L22 7"/></svg>
  )

  return (
    <div 
      className={`contact-hover-wrap ${touched ? 'touched' : ''} ${!isPhone ? 'mt' : ''}`}
      onTouchStart={() => setTouched(true)}
      onTouchEnd={() => setTimeout(() => setTouched(false), 1200)}
    >
      <span className={isPhone ? 'cell-primary' : 'cell-secondary'} title={value}>{value}</span>
      <a
        href={href}
        className={`cd-action-btn ${colorClass} cd-action-btn--sm`}
        aria-label={`${label} ${value}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={0}
      >
        {icon}
        <span>{label}</span>
      </a>
    </div>
  )
}
