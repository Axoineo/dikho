import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useAccess } from '../../lib/access'
import { usersApi } from './usersApi'
import AddUserModal from './AddUserModal'
import TemplatesTab from './TemplatesTab'
import DepartmentsTab from './DepartmentsTab'
import AuditTimeline from './AuditTimeline'
import { UserAvatar, RoleBadges, StatusPill } from './UserBits'
import { activityLabel, STATUS_LABELS } from './userFormat'
import { useLiveAssist } from '../live-assist/liveAssistContext'
import './users.css'

// While this page is open, the list refreshes on this interval so "Online"
// stays truthful without a reload.
const REFRESH_MS = 30_000

export default function UsersPage() {
  const { can } = useAccess()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'people'
  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState('')

  const loadCatalog = useCallback(() => {
    usersApi.catalog().then(setCatalog, (err) => setCatalogError(err.message))
  }, [])
  useEffect(() => { loadCatalog() }, [loadCatalog])

  const tabs = [
    ['people', 'People'],
    ['templates', 'Permission templates'],
    ['departments', 'Departments & teams'],
    ...(can('audit_logs.view') ? [['audit', 'Audit log']] : []),
  ]

  return (
    <div className="um-page">
      <div className="page-header">
        <div>
          <span className="page-kicker">ADMINISTRATION</span>
          <h1>User Management</h1>
          <p>Who can use Dikho, and what each person can see and change.</p>
        </div>
      </div>

      <div className="um-tabs" role="tablist" aria-label="User Management sections">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`um-tab${tab === key ? ' is-active' : ''}`}
            onClick={() => setParams(key === 'people' ? {} : { tab: key }, { replace: true })}
          >
            {label}
          </button>
        ))}
      </div>

      {catalogError && (
        <div className="page-error" role="alert">
          <span className="page-error-icon"><Icon name="alert" size={18} /></span>
          <div><strong>Could not load roles and templates</strong><p>{catalogError}</p></div>
        </div>
      )}

      {tab === 'people' && <PeopleTab catalog={catalog} />}
      {tab === 'templates' && catalog && <TemplatesTab catalog={catalog} onCatalog={setCatalog} />}
      {tab === 'departments' && catalog && <DepartmentsTab catalog={catalog} onCatalog={setCatalog} />}
      {tab === 'audit' && can('audit_logs.view') && <AuditTimeline catalog={catalog} />}
    </div>
  )
}

const FILTERS = {
  status: ['active', 'invited', 'suspended', 'archived'],
  role: ['owner', 'admin', 'manager', 'staff', 'developer'],
}

function PeopleTab({ catalog }) {
  const { can } = useAccess()
  const liveAssist = useLiveAssist()
  const navigate = useNavigate()
  const [members, setMembers] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('current')
  const [role, setRole] = useState('')
  const [department, setDepartment] = useState('')
  const [template, setTemplate] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    usersApi.list().then((rows) => { setMembers(rows); setError('') }, (err) => setError(err.message))
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const counts = useMemo(() => {
    const list = members ?? []
    return {
      total: list.filter((m) => m.status !== 'archived').length,
      online: list.filter((m) => m.online).length,
      invited: list.filter((m) => m.status === 'invited').length,
      suspended: list.filter((m) => m.status === 'suspended').length,
      admins: list.filter((m) => ['admin', 'owner'].includes(m.system_role) && m.status !== 'archived').length,
      developers: list.filter((m) => m.developer_level && m.status !== 'archived').length,
    }
  }, [members])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (members ?? []).filter((m) => {
      if (status === 'current' ? m.status === 'archived' : status && m.status !== status) return false
      if (role === 'developer' ? !m.developer_level : role && m.system_role !== role) return false
      if (department && m.department_id !== department) return false
      if (template && (template === 'none' ? m.template_id : m.template_id !== template)) return false
      if (!q) return true
      return [m.full_name, m.email, m.phone, m.employee_id, m.designation].some((v) => v && String(v).toLowerCase().includes(q))
    })
  }, [members, search, status, role, department, template])

  const tiles = [
    ['Users', counts.total, () => { setStatus('current'); setRole('') }],
    ['Online now', counts.online, null],
    ['Invited', counts.invited, () => setStatus('invited')],
    ['Suspended', counts.suspended, () => setStatus('suspended')],
    ['Admins & Owners', counts.admins, () => { setStatus('current'); setRole('admin') }],
    ['Developers', counts.developers, () => { setStatus('current'); setRole('developer') }],
  ]

  return (
    <>
      <div className="um-stats">
        {tiles.map(([label, value, onClick]) => (
          onClick
            ? <button key={label} type="button" className="um-stat" onClick={onClick}><strong>{members ? value : '·'}</strong><span>{label}</span></button>
            : <div key={label} className="um-stat"><strong>{members ? value : '·'}</strong><span>{label}{label === 'Online now' && value > 0 && <i className="um-dot" aria-hidden="true" />}</span></div>
        ))}
      </div>

      <div className="um-toolbar">
        <div className="search-box">
          <Icon name="search" size={18} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone or employee ID" aria-label="Search users" />
          {search && <button className="search-clear" onClick={() => setSearch('')} aria-label="Clear search"><Icon name="close" size={15} /></button>}
        </div>
        <select className="um-filter" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="current">Current users</option>
          <option value="">Everyone, incl. archived</option>
          {FILTERS.status.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select className="um-filter" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {FILTERS.role.map((r) => <option key={r} value={r}>{r === 'developer' ? 'Developers' : r[0].toUpperCase() + r.slice(1)}</option>)}
        </select>
        <select className="um-filter" value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {(catalog?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="um-filter" value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Permission template">
          <option value="">All templates</option>
          <option value="none">Custom (no template)</option>
          {(catalog?.templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {can('users.create') && (
          <button className="primary-button add-button" onClick={() => setAdding(true)} disabled={!catalog}>
            <Icon name="plus" size={18} /> Add user
          </button>
        )}
      </div>

      {error && (
        <div className="page-error" role="alert">
          <span className="page-error-icon"><Icon name="alert" size={18} /></span>
          <div><strong>Could not load users</strong><p>{error}</p></div>
        </div>
      )}

      <section className="table-card">
        <div className="table-wrapper">
          <table className="um-people">
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Role</th>
                <th>Template</th>
                <th>Status</th>
                <th>Last active</th>
                <th className="actions-column"><span className="um-visually-hidden">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {!members && !error ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="skeleton-row">
                    <td><span className="skeleton skeleton-company" /></td>
                    <td><span className="skeleton skeleton-gstin" /></td>
                    <td><span className="skeleton skeleton-status" /></td>
                    <td><span className="skeleton skeleton-pan" /></td>
                    <td><span className="skeleton skeleton-status" /></td>
                    <td><span className="skeleton skeleton-pan" /></td>
                    <td><span className="skeleton skeleton-action" /></td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-state">
                    <div className="empty-title">{members?.length ? 'Nobody matches these filters' : 'No users yet'}</div>
                    <div className="empty-copy">{members?.length ? 'Try a different search, or clear the filters.' : 'Add the first person with the Add user button.'}</div>
                  </td>
                </tr>
              ) : rows.map((m) => (
                <tr key={m.user_id} className="um-row" onClick={() => navigate(`/users/${m.user_id}`)}>
                  <td>
                    <div className="um-person">
                      <UserAvatar member={m} />
                      <div>
                        <Link to={`/users/${m.user_id}`} className="um-name" onClick={(e) => e.stopPropagation()}>{m.full_name}</Link>
                        <span className="um-sub">{m.email ?? (m.phone ? `+${m.phone}` : '')}{m.employee_id ? ` · ${m.employee_id}` : ''}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span>{m.department ?? <span className="um-muted">None</span>}</span>
                    {(m.team || m.designation) && <span className="um-sub">{[m.designation, m.team].filter(Boolean).join(' · ')}</span>}
                  </td>
                  <td><RoleBadges member={m} /></td>
                  <td>{m.template ?? <span className="um-muted">Custom</span>}</td>
                  <td><StatusPill status={m.status} /></td>
                  <td>
                    <span className={`um-activity${m.online ? ' is-online' : ''}`}>
                      {m.online && <i className="um-dot" aria-hidden="true" />}
                      {activityLabel(m)}
                    </span>
                    {liveAssist?.helpRequestFor(m.user_id) && (
                      <button
                        type="button"
                        className="um-help-chip is-button"
                        onClick={(e) => { e.stopPropagation(); liveAssist.startAssist(m, liveAssist.helpRequestFor(m.user_id).id) }}
                        disabled={liveAssist.busy}
                      >
                        Needs help · Help now
                      </button>
                    )}
                  </td>
                  <td className="actions-column">
                    <span className="row-action" aria-hidden="true"><Icon name="chevron" size={17} /></span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {adding && catalog && (
        <AddUserModal
          catalog={catalog}
          members={members ?? []}
          onClose={() => setAdding(false)}
          onAdded={(member, { customize }) => {
            setAdding(false)
            load()
            if (customize) navigate(`/users/${member.user_id}?tab=access`)
          }}
        />
      )}
    </>
  )
}
