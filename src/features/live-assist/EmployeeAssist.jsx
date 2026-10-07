import { useEffect, useState } from 'react'

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Your colleague'

function secondsLeft(iso) {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 1000))
}

// "Arjun wants to help you": the employee's choice, every time. Accepting
// opens the browser's own share picker for this tab.
export function IncomingDialog({ session, onAccept, onDecline }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [left, setLeft] = useState(() => secondsLeft(session.expires_at))
  const supported = Boolean(navigator.mediaDevices?.getDisplayMedia)
  const who = firstName(session.helper_name)

  useEffect(() => {
    const t = setInterval(() => setLeft(secondsLeft(session.expires_at)), 1000)
    return () => clearInterval(t)
  }, [session.expires_at])

  async function accept() {
    setBusy(true)
    setError('')
    const result = await onAccept()
    if (!result?.ok) {
      setError(result?.message ?? 'Live Assist could not start.')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop la-backdrop">
      <div className="modal-card la-dialog" role="alertdialog" aria-modal="true" aria-labelledby="la-incoming-title" aria-describedby="la-incoming-copy">
        <span className="la-dialog-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16v4" /><path d="m10 8.5 4 2-4 2z" />
          </svg>
        </span>
        <h2 id="la-incoming-title">{session.helper_name} wants to help you</h2>
        {supported ? (
          <p id="la-incoming-copy">
            {who} will see this Dikho tab, nothing else, and can point at things on your screen.
            They cannot click or type for you. You can stop at any time. Nothing is recorded.
          </p>
        ) : (
          <p id="la-incoming-copy">
            {who} wants to see your screen, but sharing needs Chrome or Edge on a computer.
            Open Dikho there to get help this way.
          </p>
        )}
        {error && <p className="la-error" role="alert">{error}</p>}
        <div className="la-dialog-actions">
          <button type="button" className="secondary-button" onClick={onDecline} disabled={busy}>Not now</button>
          {supported && (
            <button type="button" className="primary-button" onClick={accept} disabled={busy} autoFocus>
              {busy ? 'Waiting for the browser…' : 'Share this tab'}
            </button>
          )}
        </div>
        <p className="la-fineprint">
          {supported ? 'Your browser will ask you to confirm. Choose this tab. ' : ''}
          {left > 0 ? `This request closes in ${left} s.` : 'This request has closed.'}
        </p>
      </div>
    </div>
  )
}

// Finds what the helper pointed at, so the ring can hug a button or field
// rather than float at a coordinate. The overlays never take pointer events,
// so they are not what this finds.
function highlightBox(x, y) {
  const px = x * window.innerWidth
  const py = y * window.innerHeight
  const hit = document.elementFromPoint(px, py)
  const target = hit?.closest?.('button, a, input, select, textarea, label, [role="button"], [role="tab"], th, td, li, .nav-item, .field') ?? hit
  const r = target?.getBoundingClientRect?.()
  if (!r || r.width * r.height > window.innerWidth * window.innerHeight * 0.35) {
    return { left: px - 26, top: py - 26, width: 52, height: 52, round: true }
  }
  return { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10, round: false }
}

export function EmployeeOverlay({ session, phase, overlay, onStop, onGo, onDismissSuggestion, onHighlightDone }) {
  const who = firstName(session.helper_name)
  const [box, setBox] = useState(null)
  const [pointerVisible, setPointerVisible] = useState(false)

  useEffect(() => {
    if (!overlay.highlight) { setBox(null); return }
    setBox(highlightBox(overlay.highlight.x, overlay.highlight.y))
    const t = setTimeout(onHighlightDone, 4000)
    return () => clearTimeout(t)
  }, [overlay.highlight, onHighlightDone])

  // The pointer fades when the helper stops moving it.
  useEffect(() => {
    if (!overlay.pointer) { setPointerVisible(false); return }
    setPointerVisible(true)
    const t = setTimeout(() => setPointerVisible(false), 4000)
    return () => clearTimeout(t)
  }, [overlay.pointer])

  return (
    <>
      <div className={`la-banner${phase === 'live' ? ' is-live' : ''}`} role="status">
        <span className="la-banner-dot" aria-hidden="true" />
        <span>{phase === 'live' ? `${session.helper_name} is viewing your screen` : `Connecting to ${who}…`}</span>
        <button type="button" onClick={onStop}>Stop sharing</button>
      </div>

      {overlay.pointer && pointerVisible && (
        <div
          className="la-pointer"
          style={{ transform: `translate(${overlay.pointer.x * window.innerWidth}px, ${overlay.pointer.y * window.innerHeight}px)` }}
          aria-hidden="true"
        >
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2.5 20 12l-7.2 1.6L9 21z" /></svg>
          <span>{who}</span>
        </div>
      )}

      {box && (
        <div
          className={`la-highlight${box.round ? ' is-round' : ''}`}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          aria-hidden="true"
        />
      )}

      {overlay.suggestion && (
        <div className="la-suggestion" role="status">
          <span>{who} suggests opening <strong>{overlay.suggestion.label}</strong></span>
          <button type="button" className="primary-button" onClick={() => onGo(overlay.suggestion.path)}>Go</button>
          <button type="button" className="la-link" onClick={onDismissSuggestion}>Not now</button>
        </div>
      )}
    </>
  )
}
