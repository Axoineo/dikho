// Pieces every Settings page uses: a heading, cards, label-and-control rows,
// and the save bar organization pages show while something is unsaved.

export function SectionHead({ title, children }) {
  return (
    <header className="set-head">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </header>
  )
}

export function SettingsCard({ title, description, children }) {
  return (
    <section className="set-card">
      {(title || description) && (
        <div className="set-card-head">
          {title && <h3 className="set-card-title">{title}</h3>}
          {description && <p className="set-card-copy">{description}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

/** A setting's name and a short hint on the left, its control on the right. */
export function SettingRow({ title, hint, children, id }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <div className="set-row-title" id={id}>{title}</div>
        {hint && <div className="set-row-hint">{hint}</div>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  )
}

/** Shown only while an organization page has changes that are not saved. */
export function SaveBar({ busy, onSave, onCancel, message = 'You have unsaved changes' }) {
  return (
    <div className="set-savebar" role="region" aria-label="Unsaved changes">
      <span className="set-savebar-text">{message}</span>
      <button type="button" className="crm-btn crm-btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn crm-btn--primary" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
    </div>
  )
}

/** One line under a page that says what just happened, read out by screen readers. */
export function StatusLine({ status }) {
  return (
    <p className={`set-status${status?.tone ? ` is-${status.tone}` : ''}`} role="status" aria-live="polite">
      {status?.text || ''}
    </p>
  )
}
