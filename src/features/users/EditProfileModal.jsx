import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { usersApi } from './usersApi'

const FIELDS = ['full_name', 'employee_id', 'designation', 'department_id', 'team_id', 'reporting_manager_id', 'joining_date']

// Profile and organisation details. Role, template and permissions are on the
// Access tab, because they need stronger rights than editing a profile.
export default function EditProfileModal({ member, catalog, onClose, onSaved }) {
  const initial = Object.fromEntries(FIELDS.map((f) => [f, member[f] ?? '']))
  const [form, setForm] = useState(initial)
  const [members, setMembers] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { usersApi.list().then(setMembers, () => {}) }, [])

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value, ...(field === 'department_id' ? { team_id: '' } : {}) }))
  const teams = (catalog.departments.find((d) => d.id === form.department_id)?.teams ?? []).filter((t) => !t.archived || t.id === member.team_id)

  async function submit(e) {
    e.preventDefault()
    // Only what changed, so the audit log records exactly that.
    const patch = {}
    for (const f of FIELDS) if ((form[f] ?? '') !== (initial[f] ?? '')) patch[f] = form[f] === '' ? null : form[f]
    if (!Object.keys(patch).length) { onClose(); return }
    setSaving(true)
    setError('')
    try {
      onSaved(await usersApi.update(member.user_id, patch))
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!saving) onClose() }}>
      <div className="modal-card um-modal" role="dialog" aria-modal="true" aria-labelledby="um-edit-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="drawer-kicker">USER MANAGEMENT</span>
            <h2 id="um-edit-title">Edit {member.full_name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close" disabled={saving}><Icon name="close" size={19} /></button>
        </div>
        {error && (
          <div className="form-error" role="alert">
            <Icon name="alert" size={17} />
            <div><strong>Could not save</strong><span>{error}</span></div>
          </div>
        )}
        <form className="um-form" onSubmit={submit}>
          <fieldset>
            <div className="field field-wide">
              <label htmlFor="um-e-name">Full name</label>
              <input id="um-e-name" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} maxLength={120} required />
            </div>
            <div className="field">
              <label htmlFor="um-e-empid">Employee ID</label>
              <input id="um-e-empid" value={form.employee_id} onChange={(e) => update('employee_id', e.target.value)} maxLength={40} />
            </div>
            <div className="field">
              <label htmlFor="um-e-designation">Designation</label>
              <input id="um-e-designation" value={form.designation} onChange={(e) => update('designation', e.target.value)} maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="um-e-dept">Department</label>
              <select id="um-e-dept" value={form.department_id} onChange={(e) => update('department_id', e.target.value)}>
                <option value="">None</option>
                {catalog.departments.filter((d) => !d.archived || d.id === member.department_id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="um-e-team">Team</label>
              <select id="um-e-team" value={form.team_id} onChange={(e) => update('team_id', e.target.value)} disabled={!teams.length}>
                <option value="">{teams.length ? 'None' : 'No teams'}</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="um-e-manager">Reporting manager</label>
              <select id="um-e-manager" value={form.reporting_manager_id} onChange={(e) => update('reporting_manager_id', e.target.value)}>
                <option value="">None</option>
                {members.filter((m) => m.user_id !== member.user_id && m.status !== 'archived').map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="um-e-joined">Joining date</label>
              <input id="um-e-joined" type="date" value={form.joining_date} onChange={(e) => update('joining_date', e.target.value)} />
            </div>
          </fieldset>
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
