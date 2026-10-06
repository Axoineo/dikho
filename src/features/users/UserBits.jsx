import { useState } from 'react'
import { DEFAULT_API_BASE } from '../../lib/apiBase'
import { developerLabel, initials, roleLabel, STATUS_LABELS } from './userFormat'

// avatar_url lives in user_metadata, which each person can set to anything.
// Rendering an arbitrary URL in an administrator's browser would let anyone
// learn when (and from where) an admin opens the user list, so only photos
// served by our own avatar route are shown; anything else gets initials.
const AVATAR_PREFIX = `${import.meta.env.VITE_API_BASE ?? DEFAULT_API_BASE}/api/avatars/`

export function UserAvatar({ member, size = 34 }) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) }
  const ownPhoto = typeof member.avatar_url === 'string' && member.avatar_url.startsWith(AVATAR_PREFIX)
  if (ownPhoto && !broken) {
    return <img className="um-avatar" src={member.avatar_url} alt="" style={style} onError={() => setBroken(true)} />
  }
  return <span className="um-avatar" style={style} aria-hidden="true">{initials(member.full_name)}</span>
}

export function RoleBadges({ member }) {
  return (
    <span className="um-badges">
      <span className={`um-badge is-${member.system_role}`}>{roleLabel(member)}</span>
      {member.developer_level && <span className="um-badge is-developer">{developerLabel(member.developer_level)}</span>}
    </span>
  )
}

export function StatusPill({ status }) {
  return <span className={`um-status is-${status}`}>{STATUS_LABELS[status] ?? status}</span>
}
