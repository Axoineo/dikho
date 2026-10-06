import { DEVELOPER_LABELS, ROLE_LABELS, SECTION_LABELS } from '../../lib/access'

export const STATUS_LABELS = {
  active: 'Active', invited: 'Invited', suspended: 'Suspended', archived: 'Archived',
}

export function initials(name) {
  // Words that start with a letter, so "Asha (Finance)" gives "AF" not "A(".
  const parts = String(name || '?').trim().split(/\s+/).map((w) => w.replace(/^[^\p{L}]+/u, '')).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function roleLabel(member) {
  return ROLE_LABELS[member?.system_role] ?? 'Staff'
}

export function developerLabel(level) {
  return level ? DEVELOPER_LABELS[level] ?? 'Developer' : null
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Sep" */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const diff = Math.max(0, now - then)
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`
  if (diff < 2 * DAY) return 'yesterday'
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`
  return new Date(then).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: diff > 300 * DAY ? 'numeric' : undefined })
}

export function dateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function dateOnly(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "Ahmedabad, Gujarat, IN" from Cloudflare's IP lookup; null when unknown. */
export function locationLabel({ city, region, country } = {}) {
  const parts = [city, region !== city ? region : null, country].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

let regionNames
/** Full country name for an ISO code where the browser knows it. */
export function countryName(code) {
  if (!code) return null
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(code)
  } catch {
    return code
  }
}

// A readable device from a user-agent string: "Chrome on Windows". Rough on
// purpose: it labels a session for a person, it does not identify a device.
export function deviceLabel(ua) {
  if (!ua) return 'Unknown device'
  const os = /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux' : null
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : null
  if (browser && os) return `${browser} on ${os}`
  return browser || os || 'Unknown device'
}

export function sectionLabel(section) {
  return section ? SECTION_LABELS[section] ?? null : null
}

/** "Online · Sales Orders" | "Active 5 min ago" | "Never signed in" */
export function activityLabel(member) {
  if (member.online) {
    const where = sectionLabel(member.last_seen_section)
    return where ? `Online · ${where}` : 'Online'
  }
  // "Active" only for real use of the dashboard (the heartbeat); a sign-in
  // alone is reported as a sign-in.
  const seen = relativeTime(member.last_seen_at)
  if (seen) return `Active ${seen}`
  const signedIn = relativeTime(member.last_sign_in_at)
  if (signedIn) return `Signed in ${signedIn}`
  return 'Never signed in'
}

const SCOPE_LABELS = { own: 'own records', team: 'their team', department: 'their department', all: 'all records' }
export function scopeLabel(scope) {
  return SCOPE_LABELS[scope] ?? scope
}

// One readable sentence per audit entry: "<actor> <verb> <target>".
const EVENT_VERBS = {
  'user.created': 'added',
  'user.updated': 'updated the profile of',
  'user.role_changed': 'changed the system role of',
  'user.template_changed': 'changed the permission template of',
  'user.permissions_changed': 'changed the permissions of',
  'user.developer_granted': 'granted developer access to',
  'user.developer_revoked': 'removed developer access from',
  'user.suspended': 'suspended',
  'user.reactivated': 'reactivated',
  'user.archived': 'archived',
  'user.signed_out_everywhere': 'signed out',
  'user.session_ended': 'ended a session of',
  'user.welcome_sent': 'sent a welcome message to',
  'user.welcome_failed': 'could not deliver a welcome message to',
  'user.owner_bootstrapped': 'made the first Owner:',
  'access.denied': 'was refused an action on',
  'template.created': 'created a permission template',
  'template.updated': 'changed a permission template',
  'template.deleted': 'deleted a permission template',
  'department.saved': 'saved a department',
  'team.saved': 'saved a team',
}

/** [lead, targetName, tail], so a caller can link the target's name. */
export function eventParts(event) {
  const actor = event.actor ?? (event.actor_id ? 'Someone' : 'The system')
  const verb = EVENT_VERBS[event.event_type] ?? event.event_type
  const target = event.target ?? (event.target_user_id ? 'a former user' : null)
  if (event.event_type === 'user.signed_out_everywhere') return [`${actor} signed out`, target, 'on every device']
  if (event.event_type === 'access.denied' && !event.target_user_id) return [`${actor} was refused an action`, null, '']
  return [`${actor} ${verb}`, target, '']
}

export function describeEvent(event) {
  return eventParts(event).filter(Boolean).join(' ')
}

// Short "before → after" lines for an audit entry, in plain words.
export function describeChange(event, catalog) {
  const lines = []
  const label = (key) => catalog?.permissionsByKey?.[key]?.label ?? key
  const { old_value: before, new_value: after, metadata } = event
  switch (event.event_type) {
    case 'user.role_changed':
      lines.push(`${ROLE_LABELS[before?.system_role] ?? before?.system_role} → ${ROLE_LABELS[after?.system_role] ?? after?.system_role}`)
      break
    case 'user.developer_granted':
    case 'user.developer_revoked':
      lines.push(`${developerLabel(before?.developer_level) ?? 'No developer access'} → ${developerLabel(after?.developer_level) ?? 'No developer access'}`)
      break
    case 'user.template_changed':
      lines.push(`${before?.template ?? 'No template'} → ${after?.template ?? 'No template'}`)
      break
    case 'user.permissions_changed': {
      const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
      for (const key of keys) {
        const a = before?.[key]
        const b = after?.[key]
        const text = (o) => (!o ? 'as template' : o.effect === 'revoke' ? 'removed' : `granted (${scopeLabel(o.scope)})`)
        if (JSON.stringify(a) !== JSON.stringify(b)) lines.push(`${label(key)}: ${text(a)} → ${text(b)}`)
      }
      break
    }
    case 'user.suspended':
    case 'user.archived':
      if (metadata?.reason) lines.push(`Reason: ${metadata.reason}`)
      if (after?.sessions_ended) lines.push(`${after.sessions_ended} session${after.sessions_ended === 1 ? '' : 's'} ended`)
      break
    case 'user.signed_out_everywhere':
    case 'user.session_ended':
      if (after?.sessions_ended != null) lines.push(`${after.sessions_ended} session${after.sessions_ended === 1 ? '' : 's'} ended`)
      break
    case 'user.updated':
      for (const key of Object.keys(after ?? {})) {
        lines.push(`${key.replace(/_/g, ' ')}: ${before?.[key] ?? 'empty'} → ${after?.[key] ?? 'empty'}`)
      }
      break
    case 'user.welcome_sent':
    case 'user.welcome_failed':
      lines.push(after?.channel === 'whatsapp' ? 'By WhatsApp' : 'By email')
      break
    case 'access.denied':
      if (metadata?.message) lines.push(metadata.message)
      break
    default:
      if (after?.name) lines.push(after.name)
  }
  return lines
}
