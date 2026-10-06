import { useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { DEVELOPER_LABELS, ROLE_LABELS } from '../../lib/access'
import { usersApi } from './usersApi'
import { assignableRoles, templateWithinReach } from './permissionModel'

export default function AddUserModal({ catalog, members, onClose, onAdded }) {
  const actor = catalog.actor
  const roles = assignableRoles(actor)
  const defaultTemplate = catalog.templates.find((t) => t.key === 'sales_executive' && templateWithinReach(t, actor))
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', employee_id: '', designation: '', department_id: '', team_id: '',
    reporting_manager_id: '', joining_date: '', system_role: 'staff', developer_level: '',
    template_id: defaultTemplate?.id ?? '',
  })
  const [customize, setCustomize] = useState(false)
  const [sendWelcome, setSendWelcome] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value, ...(field === 'department_id' ? { team_id: '' } : {}) }))
  const department = catalog.departments.find((d) => d.id === form.department_id)
  const teams = (department?.teams ?? []).filter((t) => !t.archived)
  const managers = useMemo(() => members.filter((m) => ['active', 'invited'].includes(m.status)), [members])
  const welcomeChannel = form.email.trim() ? 'email' : form.phone.trim() ? 'WhatsApp' : null

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!form.email.trim() && !form.phone.trim()) {
      setError('Enter an email address or a WhatsApp number. That is how they will sign in.')
      return
    }
    setSaving(true)
    const body = { send_welcome: sendWelcome }
    for (const [key, value] of Object.entries(form)) {
      if (key === 'developer_level' && !value) continue
      if (key === 'system_role' && value === 'staff') continue
      if (value !== '') body[key] = value
    }
    try {
      const created = await usersApi.create(body)
      const needsNote = created.reused_account || (sendWelcome && !created.welcome?.sent)
      if (needsNote) {
        setResult(created)
        setSaving(false)
      } else {
        onAdded(created.user, { customize })
      }
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  if (result) {
    return (
      <div className="modal-backdrop">
        <div className="modal-card um-modal" role="dialog" aria-modal="true" aria-labelledby="um-added-title">
          <div className="modal-header">
            <div>
              <span className="drawer-kicker">USER MANAGEMENT</span>
              <h2 id="um-added-title">{result.user.full_name} has been added</h2>
            </div>
          </div>
          {result.reused_account && (
            <p className="um-note">This email or number already had a sign-in account, so it was linked instead of creating a second one.</p>
          )}
          {sendWelcome && !result.welcome?.sent && (
            <p className="um-note is-warning">
              The welcome message was not sent: {result.welcome?.reason ?? 'unknown reason'} They can still sign in with their {result.user.email ? 'email' : 'WhatsApp number'}; you can resend it from their profile.
            </p>
          )}
          <div className="um-confirm-actions">
            <button type="button" className="primary-button" onClick={() => onAdded(result.user, { customize })}>Done</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!saving) onClose() }}>
      <div className="modal-card um-modal" role="dialog" aria-modal="true" aria-labelledby="um-add-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="drawer-kicker">USER MANAGEMENT</span>
            <h2 id="um-add-title">Add user</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close" disabled={saving}><Icon name="close" size={19} /></button>
        </div>

        {error && (
          <div className="form-error" role="alert">
            <Icon name="alert" size={17} />
            <div><strong>Could not add this person</strong><span>{error}</span></div>
          </div>
        )}

        <form className="um-form" onSubmit={submit}>
          <fieldset>
            <legend>Personal</legend>
            <div className="field field-wide">
              <label htmlFor="um-name">Full name</label>
              <input id="um-name" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} maxLength={120} required autoFocus />
            </div>
            <div className="field">
              <label htmlFor="um-email">Email</label>
              <input id="um-email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} maxLength={254} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="um-phone">WhatsApp number</label>
              <input id="um-phone" type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="+91 98xxx xxxxx" maxLength={20} autoComplete="off" />
            </div>
            <p className="um-hint field-wide">They sign in with a one-time code sent to this email or WhatsApp number. There is no password.</p>
          </fieldset>

          <fieldset>
            <legend>Employment</legend>
            <div className="field">
              <label htmlFor="um-empid">Employee ID</label>
              <input id="um-empid" value={form.employee_id} onChange={(e) => update('employee_id', e.target.value)} maxLength={40} />
            </div>
            <div className="field">
              <label htmlFor="um-designation">Designation</label>
              <input id="um-designation" value={form.designation} onChange={(e) => update('designation', e.target.value)} maxLength={80} placeholder="e.g. Sales Executive" />
            </div>
            <div className="field">
              <label htmlFor="um-dept">Department</label>
              <select id="um-dept" value={form.department_id} onChange={(e) => update('department_id', e.target.value)}>
                <option value="">None</option>
                {catalog.departments.filter((d) => !d.archived).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="um-team">Team</label>
              <select id="um-team" value={form.team_id} onChange={(e) => update('team_id', e.target.value)} disabled={!teams.length}>
                <option value="">{form.department_id ? (teams.length ? 'None' : 'No teams in this department') : 'Choose a department first'}</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="um-manager">Reporting manager</label>
              <select id="um-manager" value={form.reporting_manager_id} onChange={(e) => update('reporting_manager_id', e.target.value)}>
                <option value="">None</option>
                {managers.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="um-joined">Joining date</label>
              <input id="um-joined" type="date" value={form.joining_date} onChange={(e) => update('joining_date', e.target.value)} />
            </div>
          </fieldset>

          <fieldset>
            <legend>System access</legend>
            <div className="field">
              <label htmlFor="um-role">System role</label>
              <select id="um-role" value={form.system_role} onChange={(e) => update('system_role', e.target.value)}>
                {Object.keys(ROLE_LABELS).map((r) => <option key={r} value={r} disabled={!roles.includes(r)}>{ROLE_LABELS[r]}{roles.includes(r) ? '' : ' (above your role)'}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="um-template">Permission template</label>
              <select id="um-template" value={form.template_id} onChange={(e) => update('template_id', e.target.value)}>
                <option value="">Custom (no template)</option>
                {catalog.templates.map((t) => {
                  const ok = templateWithinReach(t, actor)
                  return <option key={t.id} value={t.id} disabled={!ok}>{t.name}{ok ? '' : ' (beyond your access)'}</option>
                })}
              </select>
            </div>
            {actor.system_role === 'owner' && (
              <div className="field">
                <label htmlFor="um-dev">Developer access</label>
                <select id="um-dev" value={form.developer_level} onChange={(e) => update('developer_level', e.target.value)}>
                  <option value="">None</option>
                  {Object.entries(DEVELOPER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            )}
            <p className="um-hint field-wide">
              {form.developer_level
                ? 'Developers can use everything in Dikho, including developer tools, and can manage everyone except Owners.'
                : form.system_role === 'owner'
                  ? 'Owners can use every business feature and manage everyone, including other Owners.'
                  : form.system_role === 'admin'
                    ? 'Admins manage Staff and Managers. Their business access comes from the template.'
                    : 'The template decides which modules they can see and change.'}
            </p>
          </fieldset>

          <fieldset>
            <legend>Permissions</legend>
            <label className="um-radio field-wide">
              <input type="radio" name="um-perm-mode" checked={!customize} onChange={() => setCustomize(false)} />
              <span><strong>Use the template as it is</strong><small>You can change individual permissions later on their profile.</small></span>
            </label>
            <label className="um-radio field-wide">
              <input type="radio" name="um-perm-mode" checked={customize} onChange={() => setCustomize(true)} />
              <span><strong>Adjust permissions after adding</strong><small>Opens their permission grid as soon as they are added.</small></span>
            </label>
          </fieldset>

          <fieldset>
            <legend>Welcome message</legend>
            <label className="um-check-row field-wide">
              <input type="checkbox" checked={sendWelcome} onChange={(e) => setSendWelcome(e.target.checked)} />
              <span>
                Send a welcome message {welcomeChannel ? `by ${welcomeChannel}` : ''}
                <small>Tells them they have been added and how to sign in. It contains no link or code.</small>
              </span>
            </label>
          </fieldset>

          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Adding…' : 'Add user'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
