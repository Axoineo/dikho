import { useEffect, useRef, useState } from 'react'

// Explicit confirmation for sensitive changes (suspend, archive, sign out,
// role and developer changes). Says what will happen in plain words, can ask
// for a reason, and stays open with the error if the change is refused.
export default function ConfirmDialog({
  title, children, confirmLabel, tone = 'danger', askReason = false, reasonLabel = 'Reason (optional)',
  onConfirm, onClose,
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef(null)

  useEffect(() => {
    cancelRef.current?.focus()
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await onConfirm(reason.trim())
    } catch (err) {
      setError(err.message || 'That did not work. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <div
        className="modal-card um-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="um-confirm-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="um-confirm-title">{title}</h2>
        <div className="um-confirm-body">{children}</div>
        {askReason && (
          <div className="field">
            <label htmlFor="um-confirm-reason">{reasonLabel}</label>
            <input id="um-confirm-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {error && <p className="um-inline-error" role="alert">{error}</p>}
        <div className="um-confirm-actions">
          <button ref={cancelRef} type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={tone === 'danger' ? 'um-danger-button' : 'primary-button'} onClick={confirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
