/**
 * ContactDetails – agency contact info with animated Call / Email action buttons.
 *
 * Hover (or focus/tap on touch) over either row to reveal a pill button that
 * launches the appropriate tel: or mailto: link. Hidden by default; fades in
 * smoothly via CSS opacity + @starting-style so no JS animation state is needed.
 */

import { useState } from 'react'
import './ContactDetails.css'

/* ---------- Inline SVG icons ---------- */

/** Minimal telephone-receiver silhouette (native-app feel) */
function PhoneIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.6 10.8a15.16 15.16 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1.02-.24 11.42 11.42 0 0 0 3.58.58 1 1 0 0 1 1 1V19a1 1 0 0 1-1 1A17 17 0 0 1 3 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.58 3.58a1 1 0 0 1-.25 1.02L6.6 10.8z" />
    </svg>
  )
}

/** Stylised envelope silhouette */
function EnvelopeIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="M2 7l8.586 6.414a2 2 0 0 0 2.828 0L22 7" />
    </svg>
  )
}

/* ---------- Individual contact row ---------- */

/**
 * @param {{ label: string, value: string, href: string, icon: React.ReactNode,
 *           buttonLabel: string, colorClass: string }} props
 */
function ContactRow({ label, value, href, icon, buttonLabel, colorClass }) {
  // Touch devices: toggle hover state on tap since :hover is sticky on some browsers
  const [touched, setTouched] = useState(false)

  return (
    <div
      className={`cd-row${touched ? ' cd-row--touched' : ''}`}
      onTouchStart={() => setTouched(true)}
      onTouchEnd={() => setTimeout(() => setTouched(false), 1200)}
    >
      <div className="cd-row__info">
        <span className="cd-row__label">{label}</span>
        <span className="cd-row__value">{value}</span>
      </div>

      {/* Action button – hidden by default, fades in on hover/touch */}
      <a
        href={href}
        className={`cd-action-btn ${colorClass}`}
        aria-label={`${buttonLabel} ${value}`}
        tabIndex={0}
      >
        {icon}
        <span>{buttonLabel}</span>
      </a>
    </div>
  )
}

/* ---------- Public component ---------- */

/**
 * @param {{ phone: string, email: string }} props
 */
export default function ContactDetails({ phone, email }) {
  return (
    <section className="cd-card" aria-label="Contact details">
      <h2 className="cd-card__heading">Contact Us</h2>

      <div className="cd-list">
        <ContactRow
          label="Phone"
          value={phone}
          href={`tel:${phone.replace(/\s/g, '')}`}
          icon={<PhoneIcon />}
          buttonLabel="Call"
          colorClass="cd-action-btn--call"
        />

        <div className="cd-divider" role="separator" />

        <ContactRow
          label="Email"
          value={email}
          href={`mailto:${email}`}
          icon={<EnvelopeIcon />}
          buttonLabel="Email"
          colorClass="cd-action-btn--email"
        />
      </div>
    </section>
  )
}
