import { useContext } from 'react'
import { Link } from 'react-router-dom'
import { AccessContext, landingPath, pageFor, SECTION_LABELS } from '../lib/access'

// Shown in place of a page this person's permissions do not cover (a typed
// URL, an old bookmark, or access removed while the page was open). The data
// behind it is refused by the API and the database regardless.
export default function AccessDenied() {
  const access = useContext(AccessContext)
  const home = landingPath(access)
  const homeLabel = SECTION_LABELS[pageFor(home)?.section] ?? 'Settings'
  return (
    <div className="access-denied" role="alert">
      <span className="access-denied-icon" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
          <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
        </svg>
      </span>
      <h1>You don't have access to this page</h1>
      <p>Your account doesn't include this part of Dikho. If you need it for your work, ask an administrator to add it.</p>
      <Link className="primary-button" to={home}>Go to {homeLabel}</Link>
    </div>
  )
}
