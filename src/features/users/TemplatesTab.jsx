import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { useAccess } from '../../lib/access'
import { usersApi } from './usersApi'
import PermissionMatrix from './PermissionMatrix'
import ConfirmDialog from './ConfirmDialog'

// Reusable starting points for people's access. Built-in templates are kept
// as shipped (copy one to change it); custom templates can be edited and,
// once nobody uses them, deleted. A template change reaches everyone on it.
export default function TemplatesTab({ catalog, onCatalog }) {
  const { can } = useAccess()
  const canManage = can('templates.manage')
  const [selectedId, setSelectedId] = useState(catalog.templates[0]?.id ?? null)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const selected = catalog.templates.find((t) => t.id === selectedId)
  // Selecting a saved template loads it; a new, unsaved draft (no selection)
  // is left alone.
  useEffect(() => {
    if (!selected) return
    setDraft({ id: selected.id, name: selected.name, description: selected.description ?? '', permissions: selected.permissions })
    setError('')
  }, [selected])

  const editable = canManage && draft && (!draft.id || !selected?.built_in)
  const dirty = draft && (!draft.id || draft.name !== selected?.name || (draft.description ?? '') !== (selected?.description ?? '')
    || JSON.stringify(draft.permissions) !== JSON.stringify(selected?.permissions))

  function startNew(from) {
    setSelectedId(null)
    setDraft({ id: null, name: from ? `${from.name} (copy)` : '', description: from?.description ?? '', permissions: from ? { ...from.permissions } : {} })
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const next = await usersApi.saveTemplate(draft)
      onCatalog(next)
      const saved = next.templates.find((t) => t.name.toLowerCase() === draft.name.trim().toLowerCase())
      setSelectedId(saved?.id ?? null)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  return (
    <div className="um-split">
      <aside className="um-split-list" aria-label="Templates">
        {canManage && (
          <button type="button" className="secondary-button um-new" onClick={() => startNew(null)}>
            <Icon name="plus" size={16} /> New template
          </button>
        )}
        <ul>
          {catalog.templates.map((t) => (
            <li key={t.id}>
              <button type="button" className={t.id === selectedId ? 'is-active' : ''} onClick={() => setSelectedId(t.id)}>
                <strong>{t.name}</strong>
                <span>{t.members} {t.members === 1 ? 'person' : 'people'}{t.built_in ? ' · Built-in' : ''}</span>
              </button>
            </li>
          ))}
          {draft && !draft.id && <li><button type="button" className="is-active"><strong>{draft.name || 'New template'}</strong><span>Not saved yet</span></button></li>}
        </ul>
      </aside>

      {draft && (
        <section className="um-split-detail">
          <div className="um-template-head">
            {editable ? (
              <div className="um-template-fields">
                <div className="field">
                  <label htmlFor="um-t-name">Name</label>
                  <input id="um-t-name" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="um-t-desc">Description</label>
                  <input id="um-t-desc" value={draft.description} maxLength={300} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                </div>
              </div>
            ) : (
              <div>
                <h2>{selected?.name}</h2>
                <p className="um-muted">{selected?.description}</p>
              </div>
            )}
            <div className="um-template-actions">
              {canManage && selected && <button type="button" className="secondary-button" onClick={() => startNew(selected)}>Duplicate</button>}
              {canManage && selected && !selected.built_in && (
                <button type="button" className="um-text-button is-danger" onClick={() => setConfirmDelete(true)} disabled={selected.members > 0} title={selected.members > 0 ? 'Move everyone off this template first' : undefined}>
                  Delete
                </button>
              )}
            </div>
          </div>

          {selected?.built_in && <p className="um-note">Built-in template. Duplicate it to make a version you can change.</p>}
          {editable && selected?.members > 0 && (
            <p className="um-note is-warning">Saving changes the access of the {selected.members} {selected.members === 1 ? 'person' : 'people'} on this template straight away.</p>
          )}

          <PermissionMatrix
            catalog={catalog}
            mode="template"
            value={draft.permissions}
            onChange={(permissions) => setDraft({ ...draft, permissions })}
            grantable={catalog.actor.permissions}
            readOnly={!editable}
          />

          {error && <p className="um-inline-error" role="alert">{error}</p>}
          {editable && dirty && (
            <div className="um-savebar">
              <span>{draft.id ? 'Unsaved changes to this template.' : 'New template, not saved yet.'}</span>
              <button type="button" className="secondary-button" onClick={() => (draft.id ? setDraft({ ...draft, ...selected, description: selected.description ?? '' }) : setSelectedId(catalog.templates[0]?.id ?? null))} disabled={saving}>Discard</button>
              <button type="button" className="primary-button" onClick={save} disabled={saving || !draft.name.trim()}>{saving ? 'Saving…' : 'Save template'}</button>
            </div>
          )}
        </section>
      )}

      {confirmDelete && selected && (
        <ConfirmDialog
          title={`Delete the ${selected.name} template?`}
          confirmLabel="Delete template"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            const next = await usersApi.deleteTemplate(selected.id)
            onCatalog(next)
            setConfirmDelete(false)
            setSelectedId(next.templates[0]?.id ?? null)
          }}
        >
          <p>Nobody uses it, so no one's access changes. This is recorded in the audit log.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
