import { useMemo } from 'react'
import { groupCatalog } from './permissionModel'

// Permission grid. Two modes:
//   mode="user":     inherited = what the template + system role give;
//                    value = this person's overrides { key: {effect, scope} }.
//   mode="template": value = the template's permissions { key: scope }.
// Business modules render as a matrix (one column per action); modules with
// several permissions per action (User Management, Developer) as a list.
//
// `grantable` is the editor's own access: a permission they do not hold is
// locked here because the server would refuse it anyway.

const ACTIONS = [
  ['view', 'View'], ['create', 'Add'], ['edit', 'Edit'], ['delete', 'Delete'],
  ['export', 'Export'], ['approve', 'Approve'], ['send', 'Send'],
]
const SCOPE_RANK = { own: 1, team: 2, department: 3, all: 4 }
const SCOPE_SHORT = { own: 'Own', team: 'Team', department: 'Dept', all: 'All' }

export default function PermissionMatrix({
  catalog, mode, inherited = {}, value, onChange, grantable, readOnly = false, superuser = false, effective = {},
}) {
  const modules = useMemo(() => groupCatalog(catalog.permissions), [catalog.permissions])
  const matrixModules = modules.filter((m) => m.matrix)
  const listModules = modules.filter((m) => !m.matrix)
  const usedActions = ACTIONS.filter(([key]) => matrixModules.some((m) => m.byAction[key]))

  const canGrant = (p, scope = 'all') => {
    if (p.developer_only) return false
    const mine = grantable?.[p.key]
    return Boolean(mine) && SCOPE_RANK[mine] >= SCOPE_RANK[scope]
  }
  const widestFor = (p) => {
    const mine = grantable?.[p.key]
    return [...p.allowed_scopes].sort((a, b) => SCOPE_RANK[b] - SCOPE_RANK[a]).find((s) => !mine || SCOPE_RANK[s] <= SCOPE_RANK[mine]) ?? 'all'
  }

  function stateOf(p) {
    // Owners and developers are not narrowed by templates or overrides; show
    // what they actually hold.
    if (superuser) return { on: Boolean(effective?.[p.key]), scope: effective?.[p.key]?.scope ?? null, source: 'full' }
    if (mode === 'template') {
      const scope = value?.[p.key] ?? null
      return { on: Boolean(scope), scope, source: scope ? 'template' : 'off' }
    }
    const o = value?.[p.key]
    const base = inherited?.[p.key] ?? null
    if (o?.effect === 'revoke') return { on: false, scope: null, source: 'removed', base }
    if (o?.effect === 'grant') return { on: true, scope: o.scope ?? 'all', source: 'added', base }
    return { on: Boolean(base), scope: base, source: base ? 'inherited' : 'off', base }
  }

  // Each change is the smallest override that produces it, so "back to how
  // the template has it" never leaves a redundant override behind.
  function setPermission(p, on, scope) {
    if (mode === 'template') {
      const next = { ...value }
      if (on) next[p.key] = scope ?? widestFor(p)
      else delete next[p.key]
      onChange(next)
      return
    }
    const next = { ...value }
    const base = inherited?.[p.key] ?? null
    if (!on) {
      if (base) next[p.key] = { effect: 'revoke' }
      else delete next[p.key]
    } else {
      const wanted = scope ?? base ?? widestFor(p)
      if (base && base === wanted) delete next[p.key]
      else next[p.key] = { effect: 'grant', scope: wanted }
    }
    onChange(next)
  }

  function toggle(p) {
    const s = stateOf(p)
    setPermission(p, !s.on)
  }

  function setModule(m, preset) {
    if (mode === 'template') {
      const next = { ...value }
      for (const p of m.permissions) {
        const on = preset === 'all' || (preset === 'view' && p.action === 'view')
        if (!canGrant(p)) continue
        if (on) next[p.key] = widestFor(p)
        else delete next[p.key]
      }
      onChange(next)
      return
    }
    const next = { ...value }
    for (const p of m.permissions) {
      if (!canGrant(p)) continue
      const base = inherited?.[p.key] ?? null
      if (preset === 'reset') { delete next[p.key]; continue }
      const on = preset === 'all' || (preset === 'view' && p.action === 'view')
      if (!on) {
        if (base) next[p.key] = { effect: 'revoke' }
        else delete next[p.key]
      } else if (base) {
        delete next[p.key]
      } else {
        next[p.key] = { effect: 'grant', scope: widestFor(p) }
      }
    }
    onChange(next)
  }

  // A render function, not a component: a component declared in here would
  // remount on every change and drop focus from the scope dropdown.
  function renderCell(p, key) {
    if (!p) return <td key={key} className="um-cell um-cell-empty" aria-hidden="true" />
    const s = stateOf(p)
    const locked = readOnly || superuser || !canGrant(p, s.scope ?? 'all')
    const title = superuser
      ? 'Full access'
      : locked && !readOnly
        ? 'You can only give or remove access you have yourself.'
        : {
            inherited: 'From the template or system role. Click to remove for this person.',
            added: 'Added for this person. Click to remove.',
            removed: 'Removed for this person. Click to restore the template setting.',
            off: 'Not included. Click to add for this person.',
            template: 'Included in this template.',
          }[s.source]
    return (
      <td key={key} className="um-cell">
        <button
          type="button"
          className={`um-check is-${s.source}${s.on ? ' is-on' : ''}`}
          onClick={() => toggle(p)}
          disabled={locked}
          aria-pressed={s.on}
          aria-label={`${p.label}: ${s.on ? 'allowed' : 'not allowed'}`}
          title={title}
        >
          {s.on && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          )}
          {s.source === 'removed' && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          )}
        </button>
        {s.on && p.allowed_scopes.length > 1 && (
          <select
            className="um-scope"
            value={s.scope}
            disabled={locked}
            onChange={(e) => setPermission(p, true, e.target.value)}
            aria-label={`${p.label} scope`}
          >
            {p.allowed_scopes.map((scope) => (
              <option key={scope} value={scope} disabled={!canGrant(p, scope)}>{SCOPE_SHORT[scope]}</option>
            ))}
          </select>
        )}
      </td>
    )
  }

  const presets = (m) => !readOnly && !superuser && (
    <div className="um-presets">
      <button type="button" onClick={() => setModule(m, 'all')}>All</button>
      <button type="button" onClick={() => setModule(m, 'view')}>View only</button>
      <button type="button" onClick={() => setModule(m, 'none')}>None</button>
      {mode === 'user' && <button type="button" onClick={() => setModule(m, 'reset')}>Reset</button>}
    </div>
  )

  return (
    <div className="um-matrix-wrap">
      {mode === 'user' && !superuser && (
        <div className="um-legend" aria-hidden="true">
          <span><i className="um-swatch is-inherited" /> From template or role</span>
          <span><i className="um-swatch is-added" /> Added for this person</span>
          <span><i className="um-swatch is-removed" /> Removed for this person</span>
        </div>
      )}

      <div className="um-table-scroll">
        <table className="um-matrix">
          <thead>
            <tr>
              <th scope="col" className="um-module-col">Module</th>
              {usedActions.map(([key, label]) => <th key={key} scope="col">{label}</th>)}
              {!readOnly && !superuser && <th scope="col" className="um-preset-col"><span className="um-visually-hidden">Quick set</span></th>}
            </tr>
          </thead>
          <tbody>
            {matrixModules.map((m) => (
              <tr key={m.name}>
                <th scope="row" className="um-module-col">{m.name}</th>
                {usedActions.map(([key]) => renderCell(m.byAction[key], key))}
                {!readOnly && !superuser && <td className="um-preset-col">{presets(m)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {listModules.map((m) => (
        <section key={m.name} className="um-perm-list">
          <header>
            <h4>{m.name}</h4>
            {m.permissions.some((p) => p.developer_only)
              ? <span className="um-muted">Comes with developer access</span>
              : presets(m)}
          </header>
          <table className="um-matrix um-matrix-list">
            <tbody>
              {m.permissions.map((p) => (
                <tr key={p.key}>
                  {renderCell(p, 'cell')}
                  <th scope="row">
                    {p.label}
                    {p.description && <span className="um-perm-note">{p.description}</span>}
                  </th>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
