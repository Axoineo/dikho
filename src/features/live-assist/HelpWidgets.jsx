import { useEffect, useState } from 'react'
import { SECTION_LABELS } from '../../lib/access'

// "Ask for help": the employee's side.
export function AskHelpDialog({ onClose, onSend, already }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSend(message.trim())
    } catch (err) {
      setError(err.message || 'Your request could not be sent. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop la-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <form className="modal-card la-dialog" role="dialog" aria-modal="true" aria-labelledby="la-ask-title" onMouseDown={(e) => e.stopPropagation()} onSubmit={send}>
        <h2 id="la-ask-title">Ask for help</h2>
        <p>
          We will tell the people who can help you. When one of them is free, you will get a
          request to share this Dikho tab so they can show you.
        </p>
        {already && <p className="la-fineprint">You have already asked. Sending again just reminds you it is open.</p>}
        <label className="la-field">
          <span>What do you need help with? (optional)</span>
          <textarea value={message} maxLength={300} rows={3} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. How do I add an item to a sales order?" />
        </label>
        {error && <p className="la-error" role="alert">{error}</p>}
        <div className="la-dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Sending…' : 'Ask for help'}</button>
        </div>
      </form>
    </div>
  )
}

export function MyHelpPill({ onCancel }) {
  return (
    <div className="la-pill" role="status">
      <span className="la-banner-dot" aria-hidden="true" />
      <span>You asked for help. Someone will be with you shortly.</span>
      <button type="button" className="la-link" onClick={onCancel}>Cancel</button>
    </div>
  )
}

// Helpers: one card per open request from someone they may help.
export function HelpToasts({ requests, onHelp, onDismiss }) {
  return (
    <div className="la-toasts" aria-live="polite">
      {requests.slice(0, 3).map((r) => (
        <div key={r.id} className="la-toast">
          <strong>{r.requester_name} needs help</strong>
          {r.section && <span className="la-toast-sub">in {SECTION_LABELS[r.section] ?? r.section}</span>}
          {r.message && <p>“{r.message}”</p>}
          <div className="la-toast-actions">
            <button type="button" className="primary-button" onClick={() => onHelp(r)}>Help now</button>
            <button type="button" className="la-link" onClick={() => onDismiss(r.id)}>Later</button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function Notice({ text, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 6000)
    return () => clearTimeout(t)
  }, [onDone])
  return <div className="la-notice" role="status">{text}</div>
}
