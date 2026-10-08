import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { DEVELOPER_LABELS, ROLE_LABELS, canAssist, useAccess } from '../../lib/access'
import { usersApi } from './usersApi'
import PermissionMatrix from './PermissionMatrix'
import ConfirmDialog from './ConfirmDialog'
import EditProfileModal from './EditProfileModal'
import AuditTimeline from './AuditTimeline'
import { assignableRoles, templateWithinReach } from './permissionModel'
import { RoleBadges, StatusPill, UserAvatar } from './UserBits'
import {
  activityLabel, countryName, dateOnly, dateTime, deviceLabel, locationLabel, relativeTime, sectionLabel,
} from './userFormat'
import { useLiveAssist } from '../live-assist/liveAssistContext'
import './users.css'

const SCOPE_RANK = { own: 1, team: 2, department: 3, all: 4 }

export default function UserProfilePage() {
  const { userId } = useParams()
  const { access, can } = useAccess()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'overview'
  const [member, setMember] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')
  const isSelf = access?.user_id === userId
  const liveAssist = useLiveAssist()

  const load = useCallback(() => {
    usersApi.get(userId).then((m) => { setMember(m); setError('') }, (err) => setError(err.message))
  }, [userId])

  const canViewUsers = can('users.view')
  useEffect(() => {
    setMember(null)
    load()
    if (canViewUsers) usersApi.catalog().then(setCatalog, () => {})
  }, [load, canViewUsers])

  // Keep presence current while the page is open, so "Online" and the Live
  // Assist button follow the person coming and going. The Access tab only
  // resets when their access itself changes, so edits in progress survive.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') usersApi.get(userId).then(setMember, () => {})
    }, 30_000)
    return () => clearInterval(t)
  }, [userId])

  if (error && !member) {
    return (
      <div className="um-page">
        <Link to="/users" className="um-back"><Icon name="chevron" size={15} /> User Management</Link>
        <div className="page-error" role="alert">
          <span className="page-error-icon"><Icon name="alert" size={18} /></span>
          <div><strong>Could not open this user</strong><p>{error}</p></div>
        </div>
      </div>
    )
  }
  if (!member) return <div className="um-page"><div className="um-loading">Loading…</div></div>

  const manage = member.can_manage
  // Live Assist reaches colleagues at your own level too, not only those you manage.
  const assistable = Boolean(liveAssist?.canHelp) && member.status === 'active' && canAssist(access, member)
  const tabs = [
    ['overview', 'Overview'],
    ['access', 'Access & permissions'],
    ...(member.sessions ? [['sessions', 'Sessions']] : []),
    ...(can('audit_logs.view') ? [['activity', 'Activity']] : []),
  ]

  const actions = {
    signOutAll: () => setConfirm({
      title: `Sign ${member.full_name} out everywhere?`,
      confirmLabel: 'Sign out everywhere',
      body: <p>Every device they are signed in on is signed out immediately, including any open Dikho tab. They can sign in again with their usual code. To stop them signing in again, suspend them instead.</p>,
      run: async () => {
        const res = await usersApi.signOut(member.user_id)
        setNotice(`${res.sessions_ended} session${res.sessions_ended === 1 ? '' : 's'} ended.`)
      },
    }),
    suspend: () => setConfirm({
      title: `Suspend ${member.full_name}?`,
      confirmLabel: 'Suspend and sign out',
      askReason: true,
      body: (
        <ul className="um-consequences">
          <li>They are signed out of every device right away.</li>
          <li>They cannot sign in again until someone reactivates them.</li>
          <li>Their orders, records and history stay exactly as they are.</li>
        </ul>
      ),
      run: async (reason) => {
        const res = await usersApi.setStatus(member.user_id, 'suspended', reason)
        if (res.sign_in_updated === false) setNotice('Suspended. Blocking new sign-ins in the sign-in service did not go through; Dikho refuses them anyway. Try again later to complete it.')
      },
    }),
    reactivate: () => setConfirm({
      title: `Reactivate ${member.full_name}?`,
      confirmLabel: 'Reactivate',
      tone: 'primary',
      body: <p>They can sign in again and get the access their role, template and permissions give them.</p>,
      run: () => usersApi.setStatus(member.user_id, 'active'),
    }),
    archive: () => setConfirm({
      title: `Archive ${member.full_name}?`,
      confirmLabel: 'Archive',
      askReason: true,
      body: (
        <ul className="um-consequences">
          <li>Use this when someone has left the company.</li>
          <li>They are signed out and cannot sign in. They disappear from the user list unless you show archived users.</li>
          <li>Nothing is deleted: records they created still show their name, and the audit log keeps everything.</li>
        </ul>
      ),
      run: (reason) => usersApi.setStatus(member.user_id, 'archived', reason),
    }),
    welcome: async () => {
      setNotice('')
      try {
        const res = await usersApi.resendWelcome(member.user_id)
        setNotice(res.sent ? `Welcome message sent by ${res.channel === 'whatsapp' ? 'WhatsApp' : 'email'}.` : `Not sent: ${res.reason}`)
        load()
      } catch (err) {
        setNotice(err.message)
      }
    },
  }

  return (
    <div className="um-page">
      {canViewUsers
        ? <Link to="/users" className="um-back"><Icon name="chevron" size={15} /> User Management</Link>
        : <Link to="/settings" className="um-back"><Icon name="chevron" size={15} /> Settings</Link>}

      <header className="um-profile-head">
        <UserAvatar member={member} size={56} />
        <div className="um-profile-id">
          <h1>{member.full_name}{isSelf && <span className="um-you">You</span>}</h1>
          <div className="um-profile-meta">
            <RoleBadges member={member} />
            <StatusPill status={member.status} />
            <span className={`um-activity${member.online ? ' is-online' : ''}`}>
              {member.online && <i className="um-dot" aria-hidden="true" />}{activityLabel(member)}
            </span>
            {liveAssist?.helpRequestFor(member.user_id) && <span className="um-help-chip">Asking for help</span>}
          </div>
        </div>
        {(manage || assistable) && (
          <div className="um-profile-actions">
            {assistable && (
              <button
                type="button"
                className="primary-button um-assist-button"
                onClick={() => liveAssist.startAssist(member, liveAssist.helpRequestFor(member.user_id)?.id ?? null)}
                disabled={!member.online || liveAssist.busy}
                title={liveAssist.busy
                  ? 'Finish your current Live Assist session first'
                  : member.online ? `See ${member.full_name}'s Dikho tab, with their OK, and point at things` : `${member.full_name} is not online right now`}
              >
                Live Assist
              </button>
            )}
            {manage && member.status === 'invited' && can('users.create') && (
              <button type="button" className="secondary-button" onClick={actions.welcome}>Resend welcome</button>
            )}
            {manage && can('users.sessions') && member.active_sessions > 0 && (
              <button type="button" className="secondary-button" onClick={actions.signOutAll}>Sign out everywhere</button>
            )}
            {manage && can('users.suspend') && (member.status === 'suspended' || member.status === 'archived'
              ? <button type="button" className="primary-button" onClick={actions.reactivate}>Reactivate</button>
              : <button type="button" className="um-danger-button" onClick={actions.suspend}>Suspend</button>)}
            {manage && can('users.suspend') && member.status !== 'archived' && (
              <button type="button" className="um-text-button" onClick={actions.archive}>Archive</button>
            )}
          </div>
        )}
      </header>

      {notice && <p className="um-note" role="status">{notice}</p>}
      {!manage && !isSelf && (
        <p className="um-note">You can view {member.full_name}, but their role is at or above yours, so only someone higher can change their access.</p>
      )}

      <div className="um-tabs" role="tablist" aria-label="Profile sections">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`um-tab${tab === key ? ' is-active' : ''}`}
            onClick={() => setParams(key === 'overview' ? {} : { tab: key }, { replace: true })}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview member={member} canEdit={manage && can('users.edit')} onEdit={() => setEditing(true)} />}
      {tab === 'access' && (catalog
        ? <AccessTab member={member} catalog={catalog} readOnly={!manage} onSaved={setMember} />
        : <OwnAccessSummary member={member} />)}
      {tab === 'sessions' && member.sessions && (
        <SessionsTab member={member} isSelf={isSelf} canEnd={isSelf || (manage && can('users.sessions'))} onChanged={load} />
      )}
      {tab === 'activity' && <AuditTimeline catalog={catalog} userId={member.user_id} />}

      {editing && catalog && (
        <EditProfileModal member={member} catalog={catalog} onClose={() => setEditing(false)} onSaved={(m) => { setMember(m); setEditing(false) }} />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          confirmLabel={confirm.confirmLabel}
          tone={confirm.tone}
          askReason={confirm.askReason}
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            await confirm.run(reason)
            setConfirm(null)
            load()
          }}
        >
          {confirm.body}
        </ConfirmDialog>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="um-field">
      <dt>{label}</dt>
      <dd>{children ?? <span className="um-muted">Not set</span>}</dd>
    </div>
  )
}

function Overview({ member, canEdit, onEdit }) {
  return (
    <div className="um-grid">
      {(member.status === 'suspended' || member.status === 'archived') && (
        <section className="um-card um-card-alert">
          <h3>{member.status === 'archived' ? 'Archived' : 'Suspended'} {member.status_changed_at ? relativeTime(member.status_changed_at) : ''}</h3>
          <p>{member.status_reason || 'No reason was given.'}</p>
        </section>
      )}
      <section className="um-card">
        <header>
          <h3>Contact and sign-in</h3>
        </header>
        <dl>
          <Field label="Email">{member.email}</Field>
          <Field label="WhatsApp number">{member.phone ? `+${member.phone}` : null}</Field>
          <Field label="Last sign-in">{member.last_sign_in_at ? dateTime(member.last_sign_in_at) : 'Never signed in'}</Field>
          <Field label="Welcome message">
            {member.welcome_sent_at
              ? `Sent by ${member.welcome_channel === 'whatsapp' ? 'WhatsApp' : 'email'}, ${relativeTime(member.welcome_sent_at)}`
              : 'Not sent'}
          </Field>
          <Field label="Added">{dateOnly(member.created_at)}</Field>
        </dl>
      </section>
      <section className="um-card">
        <header>
          <h3>Organisation</h3>
          {canEdit && <button type="button" className="um-text-button" onClick={onEdit}><Icon name="edit" size={15} /> Edit</button>}
        </header>
        <dl>
          <Field label="Employee ID">{member.employee_id}</Field>
          <Field label="Designation">{member.designation}</Field>
          <Field label="Department">{member.department}</Field>
          <Field label="Team">{member.team}</Field>
          <Field label="Reporting manager">
            {member.reporting_manager_id ? <Link to={`/users/${member.reporting_manager_id}`}>{member.reporting_manager}</Link> : null}
          </Field>
          <Field label="Joining date">{member.joining_date ? dateOnly(member.joining_date) : null}</Field>
        </dl>
      </section>
    </div>
  )
}

// For someone viewing their own profile without users.view: a plain list of
// what they can do, without the editing grid.
function OwnAccessSummary({ member }) {
  const keys = Object.keys(member.permissions ?? {}).sort()
  return (
    <section className="um-card">
      <header><h3>What you can do in Dikho</h3></header>
      <p className="um-muted">Role: {ROLE_LABELS[member.system_role]}{member.template ? ` · Template: ${member.template}` : ''}</p>
      <ul className="um-plain-list">
        {keys.map((k) => <li key={k}>{k} <span className="um-muted">({member.permissions[k].scope})</span></li>)}
      </ul>
    </section>
  )
}

function inheritedFor(catalog, templateId, role) {
  const out = {}
  const template = catalog.templates.find((t) => t.id === templateId)
  for (const [key, scope] of Object.entries(template?.permissions ?? {})) out[key] = scope
  for (const [key, scope] of Object.entries(catalog.role_permissions?.[role] ?? {})) {
    if (!out[key] || SCOPE_RANK[scope] > SCOPE_RANK[out[key]]) out[key] = scope
  }
  return out
}

const sameJson = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
function sortKeys(o) {
  return Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v && typeof v === 'object' ? sortKeys(v) : v]))
}

function AccessTab({ member, catalog, readOnly, onSaved }) {
  const actor = catalog.actor
  const [role, setRole] = useState(member.system_role)
  const [dev, setDev] = useState(member.developer_level ?? '')
  const [templateId, setTemplateId] = useState(member.template_id ?? '')
  const [overrides, setOverrides] = useState(member.overrides ?? {})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null)

  // Reset the form only when the saved access changes, not on every refresh
  // of the profile (presence updates every 30 seconds).
  const savedAccess = JSON.stringify([member.system_role, member.developer_level, member.template_id, sortKeys(member.overrides)])
  useEffect(() => {
    const [role0, dev0, template0, overrides0] = JSON.parse(savedAccess)
    setRole(role0)
    setDev(dev0 ?? '')
    setTemplateId(template0 ?? '')
    setOverrides(overrides0 ?? {})
  }, [savedAccess])

  const inherited = useMemo(() => inheritedFor(catalog, templateId, role), [catalog, templateId, role])
  const superuser = role === 'owner' || Boolean(dev)
  const roleChanged = role !== member.system_role
  const devChanged = (dev || null) !== (member.developer_level ?? null)
  const templateChanged = (templateId || null) !== (member.template_id ?? null)
  const overridesChanged = !sameJson(overrides, member.overrides ?? {})
  const dirty = roleChanged || devChanged || templateChanged || overridesChanged
  const roles = assignableRoles(actor)

  const effective = useMemo(() => {
    if (!roleChanged && !devChanged) return member.permissions
    return Object.fromEntries(catalog.permissions
      .filter((p) => dev || !p.developer_only)
      .map((p) => [p.key, { scope: 'all', source: dev ? 'developer' : 'owner' }]))
  }, [roleChanged, devChanged, member.permissions, catalog.permissions, dev])

  async function save() {
    setSaving(true)
    setError('')
    try {
      let next = member
      const patch = {}
      if (roleChanged) patch.system_role = role
      if (devChanged) patch.developer_level = dev || null
      if (templateChanged) patch.template_id = templateId || null
      if (Object.keys(patch).length) next = await usersApi.update(member.user_id, patch)
      if (overridesChanged && !superuser) next = await usersApi.setOverrides(member.user_id, overrides)
      onSaved(next)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  // Raising or lowering someone across the Admin line, or touching developer
  // access, is asked about first; ordinary permission edits are not.
  function requestSave() {
    const crossesAdmin = roleChanged && ['admin', 'owner'].some((r) => r === role || r === member.system_role)
    if (!crossesAdmin && !devChanged) return save()
    const lines = []
    if (roleChanged) lines.push(`System role: ${ROLE_LABELS[member.system_role]} → ${ROLE_LABELS[role]}`)
    if (devChanged) lines.push(`Developer access: ${DEVELOPER_LABELS[member.developer_level] ?? 'None'} → ${DEVELOPER_LABELS[dev] ?? 'None'}`)
    setConfirm({
      title: `Change ${member.full_name}'s access level?`,
      body: (
        <>
          <ul className="um-consequences">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
          {(role === 'owner' || dev) && <p>{role === 'owner' ? 'Owners' : 'Developers'} can use everything and manage {role === 'owner' ? 'everyone' : 'everyone except Owners'}.</p>}
        </>
      ),
    })
  }

  return (
    <div className="um-access">
      {readOnly && <p className="um-note">You can't change {member.user_id === actor.user_id ? 'your own access. Ask another administrator.' : 'this person\'s access.'}</p>}

      <section className="um-card um-access-controls">
        <div className="field">
          <label htmlFor="um-acc-role">System role</label>
          <select id="um-acc-role" value={role} onChange={(e) => setRole(e.target.value)} disabled={readOnly}>
            {Object.keys(ROLE_LABELS).map((r) => (
              <option key={r} value={r} disabled={r !== member.system_role && !roles.includes(r)}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="um-acc-template">Permission template</label>
          <select id="um-acc-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={readOnly || superuser}>
            <option value="">Custom (no template)</option>
            {catalog.templates.map((t) => {
              const ok = t.id === member.template_id || templateWithinReach(t, actor)
              return <option key={t.id} value={t.id} disabled={!ok}>{t.name}{ok ? '' : ' (beyond your access)'}</option>
            })}
          </select>
        </div>
        {(actor.system_role === 'owner' || member.developer_level) && (
          <div className="field">
            <label htmlFor="um-acc-dev">Developer access</label>
            <select id="um-acc-dev" value={dev} onChange={(e) => setDev(e.target.value)} disabled={readOnly || actor.system_role !== 'owner'}>
              <option value="">None</option>
              {Object.entries(DEVELOPER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        )}
      </section>

      {superuser && (
        <p className="um-note">
          {dev
            ? 'Developers hold every permission, including developer tools, and are not limited by templates or individual changes.'
            : 'Owners hold every business permission and are not limited by templates or individual changes.'}
        </p>
      )}

      <PermissionMatrix
        catalog={catalog}
        mode="user"
        inherited={inherited}
        value={overrides}
        onChange={setOverrides}
        grantable={actor.permissions}
        readOnly={readOnly}
        superuser={superuser}
        effective={effective}
      />

      {error && <p className="um-inline-error" role="alert">{error}</p>}

      {!readOnly && dirty && (
        <div className="um-savebar" role="region" aria-label="Unsaved changes">
          <span>You have unsaved changes to {member.full_name}'s access.</span>
          <button
            type="button"
            className="secondary-button"
            disabled={saving}
            onClick={() => { setRole(member.system_role); setDev(member.developer_level ?? ''); setTemplateId(member.template_id ?? ''); setOverrides(member.overrides ?? {}); setError('') }}
          >
            Discard
          </button>
          <button type="button" className="primary-button" onClick={requestSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          confirmLabel="Change access"
          tone="primary"
          onClose={() => setConfirm(null)}
          onConfirm={async () => { setConfirm(null); await save() }}
        >
          {confirm.body}
        </ConfirmDialog>
      )}
    </div>
  )
}

function SessionsTab({ member, isSelf, canEnd, onChanged }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  async function end(sessionId) {
    setBusy(sessionId)
    setError('')
    try {
      await usersApi.signOut(member.user_id, sessionId)
      onChanged()
    } catch (err) {
      setError(err.message)
    }
    setBusy(null)
  }

  return (
    <div className="um-sessions">
      <section className="um-card">
        <header>
          <h3>Signed in now</h3>
          <span className="um-muted">{member.sessions.length} device{member.sessions.length === 1 ? '' : 's'}</span>
        </header>
        {member.sessions.length === 0 ? (
          <p className="um-muted">Not signed in on any device.</p>
        ) : (
          <ul className="um-session-list">
            {member.sessions.map((s) => {
              const where = locationLabel(s)
              const section = sectionLabel(s.section)
              return (
                <li key={s.session_id}>
                  <span className="um-device-icon" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      {/Android|iPhone|iOS/.test(deviceLabel(s.user_agent))
                        ? <><rect x="7" y="2.8" width="10" height="18.4" rx="2.2" /><path d="M11 18h2" /></>
                        : <><rect x="3" y="4.5" width="18" height="12" rx="1.8" /><path d="M8.5 20h7M12 16.5V20" /></>}
                    </svg>
                  </span>
                  <div className="um-session-main">
                    <strong>{deviceLabel(s.user_agent)}{s.current && <span className="um-you">This device</span>}</strong>
                    <span className="um-sub">
                      {where ? `Near ${where}` : 'Location unknown'}
                      {s.country && !s.city ? ` (${countryName(s.country)})` : ''}
                      {s.ip ? ` · ${s.ip}` : ''}
                    </span>
                    <span className="um-sub">
                      Signed in {dateTime(s.signed_in_at)} · Active {relativeTime(s.last_seen_at) ?? 'unknown'}{section ? ` in ${section}` : ''}
                    </span>
                  </div>
                  {canEnd && !s.current && (
                    <button type="button" className="secondary-button" disabled={busy === s.session_id} onClick={() => end(s.session_id)}>
                      {busy === s.session_id ? 'Ending…' : 'End session'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {error && <p className="um-inline-error" role="alert">{error}</p>}
        <p className="um-hint">
          Locations are estimated from the internet connection and can be wrong by a city or more, especially on mobile data or a VPN.
          {isSelf ? ' Ending a session signs that device out immediately.' : ''}
        </p>
      </section>

      <section className="um-card">
        <header><h3>Recent sign-ins</h3></header>
        {member.recent_sign_ins?.length ? (
          <div className="table-wrapper">
            <table className="um-history">
              <thead><tr><th>When</th><th>Device</th><th>Approximate location</th><th>Ended</th></tr></thead>
              <tbody>
                {member.recent_sign_ins.map((r) => (
                  <tr key={r.signed_in_at}>
                    <td>{dateTime(r.signed_in_at)}</td>
                    <td>{deviceLabel(r.user_agent)}</td>
                    <td>{locationLabel(r) ?? <span className="um-muted">Unknown</span>}</td>
                    <td>
                      {r.ended_at
                        ? `${relativeTime(r.ended_at)}${r.ended_reason === 'forced' ? ' (signed out by an admin)' : r.ended_reason === 'suspended' ? ' (suspended)' : r.ended_reason === 'archived' ? ' (archived)' : ''}`
                        : <span className="um-muted">Still open or expired</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="um-muted">No sign-ins recorded yet.</p>}
      </section>
    </div>
  )
}
