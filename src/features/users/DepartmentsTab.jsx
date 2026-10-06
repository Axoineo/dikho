import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { useAccess } from '../../lib/access'
import { usersApi } from './usersApi'

// Departments and their teams. Used to organise people today, and by the
// team and department permission scopes once those modules record owners.
// Nothing is deleted: archiving hides a unit from new assignments while the
// people already in it keep it.
export default function DepartmentsTab({ catalog, onCatalog }) {
  const { can } = useAccess()
  const canManage = can('departments.manage')
  const [editing, setEditing] = useState(null) // { kind, id?, department_id?, name }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  async function save(unit) {
    setBusy(true)
    setError('')
    try {
      onCatalog(await usersApi.saveOrgUnit(unit))
      setEditing(null)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  const departments = catalog.departments.filter((d) => showArchived || !d.archived)

  function nameForm(placeholder) {
    return (
      <form className="um-inline-form" onSubmit={(e) => { e.preventDefault(); save(editing) }}>
        <input
          autoFocus
          value={editing.name}
          maxLength={80}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
        />
        <button type="submit" className="primary-button" disabled={busy || !editing.name.trim()}>Save</button>
        <button type="button" className="secondary-button" onClick={() => { setEditing(null); setError('') }}>Cancel</button>
      </form>
    )
  }

  return (
    <div className="um-departments">
      <div className="um-toolbar">
        <label className="um-check-row">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          <span>Show archived</span>
        </label>
        {canManage && (
          <button type="button" className="primary-button add-button" onClick={() => setEditing({ kind: 'department', name: '' })}>
            <Icon name="plus" size={18} /> Add department
          </button>
        )}
      </div>

      {error && <p className="um-inline-error" role="alert">{error}</p>}
      {editing?.kind === 'department' && !editing.id && <section className="um-card">{nameForm('Department name')}</section>}

      <div className="um-dept-grid">
        {departments.map((d) => (
          <section key={d.id} className={`um-card um-dept${d.archived ? ' is-archived' : ''}`}>
            <header>
              {editing?.kind === 'department' && editing.id === d.id ? nameForm('Department name') : (
                <>
                  <h3>{d.name}{d.archived && <span className="um-badge">Archived</span>}</h3>
                  <span className="um-muted">{d.members} {d.members === 1 ? 'person' : 'people'}</span>
                </>
              )}
            </header>
            <ul className="um-team-list">
              {d.teams.filter((t) => showArchived || !t.archived).map((t) => (
                <li key={t.id}>
                  {editing?.kind === 'team' && editing.id === t.id ? nameForm('Team name') : (
                    <>
                      <span>{t.name}{t.archived && <span className="um-muted"> (archived)</span>}</span>
                      <span className="um-muted">{t.members}</span>
                      {canManage && (
                        <span className="um-row-actions">
                          <button type="button" className="um-text-button" onClick={() => setEditing({ kind: 'team', id: t.id, name: t.name })}>Rename</button>
                          <button type="button" className="um-text-button" onClick={() => save({ kind: 'team', id: t.id, name: t.name, archived: !t.archived })}>
                            {t.archived ? 'Restore' : 'Archive'}
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </li>
              ))}
              {d.teams.length === 0 && <li className="um-muted">No teams</li>}
              {editing?.kind === 'team' && !editing.id && editing.department_id === d.id && <li>{nameForm('Team name')}</li>}
            </ul>
            {canManage && !editing && (
              <footer className="um-row-actions">
                <button type="button" className="um-text-button" onClick={() => setEditing({ kind: 'team', department_id: d.id, name: '' })}><Icon name="plus" size={14} /> Team</button>
                <button type="button" className="um-text-button" onClick={() => setEditing({ kind: 'department', id: d.id, name: d.name })}>Rename</button>
                <button type="button" className="um-text-button" onClick={() => save({ kind: 'department', id: d.id, name: d.name, archived: !d.archived })}>
                  {d.archived ? 'Restore' : 'Archive'}
                </button>
              </footer>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
