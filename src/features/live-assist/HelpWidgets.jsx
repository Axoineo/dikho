import { useEffect, useState } from 'react'
import { SECTION_LABELS } from '../../lib/access'
import { assistApi } from './assistApi'

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || name

function statusOf(person) {
  if (person.busy) return { label: 'In a session', tone: 'busy' }
  if (person.online) return { label: 'Online', tone: 'online' }
  return { label: 'Away', tone: 'away' }
}

// "Ask for help": the employee's side. Everyone who can help is told, or only
// the person chosen here (online people are listed first).
export function AskHelpDialog({ onClose, onSend, already }) {
  const [message, setMessage] = useState('')
  const [helpers, setHelpers] = useState(null) // null while loading
  const [listFailed, setListFailed] = useState(false)
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    assistApi.helpers().then(
      (list) => { if (!cancelled) setHelpers(Array.isArray(list) ? list : []) },
      () => { if (!cancelled) { setHelpers([]); setListFailed(true) } },
    )
    return () => { cancelled = true }
  }, [])

  const nobody = helpers !== null && helpers.length === 0 && !listFailed
  const chosen = helpers?.find((h) => h.user_id === choice) ?? null

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSend(message.trim(), choice || null)
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
          We will tell the people who can help you, or only the person you choose. When they are free,
          you will get a request to share this Dikho tab so they can show you.
        </p>
        {already && <p className="la-fineprint">You have already asked. Sending again just reminds you it is open.</p>}
        <label className="la-field">
          <span>What do you need help with? (optional)</span>
          <textarea value={message} maxLength={300} rows={3} onChange={(e) => setMessage(e.target.value)} placeholder="How do I add an item to a sales order?" />
        </label>

        {nobody ? (
          <p className="la-error" role="alert">Nobody can take Live Assist requests for your account yet. Ask an Owner to set it up.</p>
        ) : (
          <fieldset className="la-choose">
            <legend>Who should help?</legend>
            <div className="la-choose-list">
              <label className={`la-choice${choice === '' ? ' is-selected' : ''}`}>
                <input type="radio" name="la-helper" value="" checked={choice === ''} onChange={() => setChoice('')} />
                <span className="la-choice-name">Anyone who can help</span>
                {helpers?.length > 0 && <span className="la-choice-meta">{helpers.length === 1 ? '1 person' : `${helpers.length} people`}</span>}
              </label>
              {helpers === null && <p className="la-choice-note">Loading who can help…</p>}
              {listFailed && <p className="la-choice-note">The list could not be loaded. You can still ask everyone.</p>}
              {helpers?.map((person) => {
                const status = statusOf(person)
                return (
                  <label key={person.user_id} className={`la-choice${choice === person.user_id ? ' is-selected' : ''}`}>
                    <input type="radio" name="la-helper" value={person.user_id} checked={choice === person.user_id} onChange={() => setChoice(person.user_id)} />
                    <span className="la-choice-name">{person.full_name}</span>
                    <span className={`la-choice-meta is-${status.tone}`}><i aria-hidden="true" />{status.label}</span>
                  </label>
                )
              })}
            </div>
            {chosen && !chosen.online && (
              <p className="la-fineprint">{firstName(chosen.full_name)} is away. They will see your request if they come back within 15 minutes.</p>
            )}
            {chosen?.busy && (
              <p className="la-fineprint">{firstName(chosen.full_name)} is helping someone right now. They will see your request when they finish.</p>
            )}
          </fieldset>
        )}

        {error && <p className="la-error" role="alert">{error}</p>}
        <div className="la-dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>{nobody ? 'Close' : 'Cancel'}</button>
          {!nobody && (
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Sending…' : chosen ? `Ask ${firstName(chosen.full_name)}` : 'Ask for help'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

export function MyHelpPill({ helperName, onCancel }) {
  return (
    <div className="la-pill" role="status">
      <span className="la-banner-dot" aria-hidden="true" />
      <span>{helperName ? `You asked ${firstName(helperName)} for help.` : 'You asked for help. Someone will be with you shortly.'}</span>
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
          <strong>{r.for_you ? `${r.requester_name} asked you for help` : `${r.requester_name} needs help`}</strong>
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
