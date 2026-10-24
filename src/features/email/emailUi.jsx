import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { STATUS } from './emailFormat'

// Small pieces shared by the Email Hub screens.

export function StatusPill({ status, map = STATUS }) {
  const s = map[status] ?? { label: status, tone: '' }
  return <span className={`em-pill${s.tone ? ` is-${s.tone}` : ''}`}><span className={`em-dot${s.tone ? ` is-${s.tone}` : ''}`} />{s.label}</span>
}

export function Banner({ tone = '', title, children, icon = tone === 'ok' ? 'check' : 'alert', action }) {
  return (
    <div className={`em-banner${tone ? ` is-${tone}` : ''}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="em-banner-icon"><Icon name={icon} size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <strong>{title}</strong>}
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ icon = 'mail', title, children, action }) {
  return (
    <div className="em-empty">
      <span className="em-empty-icon"><Icon name={icon} size={24} /></span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

/** Confirmation for actions that stop access or delete something. */
export function ConfirmDialog({ title, children, confirmLabel, tone = 'danger', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (err) {
      setError(err.message || 'That did not work. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <div className="modal-card em-dialog em-page" role="alertdialog" aria-modal="true" aria-labelledby="em-confirm-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="em-confirm-title">{title}</h2>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--muted)' }}>{children}</div>
        {error && <div style={{ marginTop: 12 }}><Banner tone="danger">{error}</Banner></div>}
        <div className="em-dialog-actions">
          <button ref={cancelRef} type="button" className="em-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={`em-btn ${tone === 'danger' ? 'em-btn-danger' : 'em-btn-primary'}`} onClick={confirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
