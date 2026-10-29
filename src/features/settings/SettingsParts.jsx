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

/** A card of rows, its name and note in small grey type above it. */
export function SettingsCard({ title, description, children }) {
  if (!title && !description) return <section className="set-card">{children}</section>
  return (
    <section className="set-group">
      <div className="set-group-head">
        {title && <h3 className="set-group-title">{title}</h3>}
        {description && <p className="set-group-copy">{description}</p>}
      </div>
      <div className="set-card">{children}</div>
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

/** An editable setting: its label (and hint, or what is wrong) on the left, the input on the right. */
export function FieldRow({ label, htmlFor, required, optional, hint, error, children }) {
  const noteId = htmlFor ? `${htmlFor}-note` : undefined
  return (
    <div className="set-row set-field-row">
      <div className="set-row-text">
        <label className="set-row-title" htmlFor={htmlFor}>
          {label}
          {required && <span className="crm-required" aria-hidden="true">*</span>}
          {optional && <span className="crm-optional">(optional)</span>}
        </label>
        {(error || hint) && <div id={noteId} className={`set-row-hint${error ? ' is-error' : ''}`} role={error ? 'alert' : undefined}>{error || hint}</div>}
      </div>
      <div className="set-row-control set-field-control">{children}</div>
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
