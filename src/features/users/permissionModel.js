// Pure helpers shared by the User Management screens. The server applies the
// same rules (um_* functions); these only avoid offering choices it would refuse.

export const ACTION_KEYS = ['view', 'create', 'edit', 'delete', 'export', 'approve', 'send']

export const ROLE_RANK = { staff: 0, manager: 10, admin: 20, owner: 40 }
export const SCOPE_RANK = { own: 1, team: 2, department: 3, all: 4 }

// Roles the editor may hand out: below their own rank, and Owner only by an
// Owner. The server enforces the same rule; this only avoids offering a
// choice that would be refused.
export function assignableRoles(actor) {
  return Object.keys(ROLE_RANK).filter((role) => (actor.system_role === 'owner'
    ? true
    : ROLE_RANK[role] < actor.rank && (role === 'staff' || Boolean(actor.permissions['users.roles']))))
}

export function templateWithinReach(template, actor) {
  return Object.entries(template.permissions).every(([key, scope]) => {
    const mine = actor.permissions[key]
    return mine && SCOPE_RANK[mine] >= SCOPE_RANK[scope]
  })
}


export function groupCatalog(permissions) {
  const modules = []
  const byName = new Map()
  for (const p of permissions) {
    if (!byName.has(p.module)) {
      const group = { name: p.module, permissions: [] }
      byName.set(p.module, group)
      modules.push(group)
    }
    byName.get(p.module).permissions.push(p)
  }
  for (const m of modules) {
    const actions = m.permissions.map((p) => p.action)
    m.matrix = new Set(actions).size === actions.length && actions.every((a) => ACTION_KEYS.includes(a))
    m.byAction = Object.fromEntries(m.permissions.map((p) => [p.action, p]))
  }
  return modules
}

/** The scope a permission ends up with for a person, or null. */
export function effectiveScope(key, inherited, overrides) {
  const o = overrides?.[key]
  if (o?.effect === 'revoke') return null
  if (o?.effect === 'grant') return o.scope ?? 'all'
  return inherited?.[key] ?? null
}

