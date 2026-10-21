import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { emailApi } from './emailApi'
import './email.css'

// Google's return lands here (handed on by the API). The connection is
// finished with this person's own session, and the API accepts it only from
// the person who started it, so a consent link forwarded to someone else
// connects nothing. The one-use code leaves the address bar at once.
export default function EmailConnect() {
  const navigate = useNavigate()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const params = new URLSearchParams(window.location.search)
    const body = { state: params.get('state') ?? '', code: params.get('code') ?? undefined, error: params.get('error') ?? undefined }
    window.history.replaceState(null, '', '/email/connect')
    emailApi.completeConnect(body)
      .then((r) => r.outcome, () => 'failed')
      .then((outcome) => navigate(`/email/settings?connect=${encodeURIComponent(outcome)}`, { replace: true }))
  }, [navigate])

  return (
    <div className="em-page" style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
      <div role="status" aria-live="polite" style={{ display: 'grid', gap: 10, justifyItems: 'center', color: 'var(--muted)', fontSize: 14 }}>
        <div className="em-skeleton" style={{ width: 180, height: 10 }} aria-hidden="true" />
        Finishing the connection…
      </div>
    </div>
  )
}
