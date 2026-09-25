// Shared formatting + presentation helpers for the inbox.

// D1 stores timestamps either as ISO (our inserts) or as `datetime('now')`'s
// space-separated UTC string. Normalise both to a Date.
export function parseWaDate(value) {
  if (!value) return null
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatTime(value) {
  const d = parseWaDate(value)
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

// Chat-list timestamp: time today, "Yesterday", weekday this week, else date.
export function formatListTime(value) {
  const d = parseWaDate(value)
  if (!d) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  const days = (now - d) / 86400000
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' })
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: '2-digit' })
}

// Centered day separator in the thread ("Today" / "Yesterday" / a date).
export function formatDaySeparator(value) {
  const d = parseWaDate(value)
  if (!d) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Relative "last active" for the header (honest proxy — the Cloud API does not
// expose real WhatsApp last-seen/presence for business accounts).
export function formatLastActive(value) {
  const d = parseWaDate(value)
  if (!d) return ''
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  return formatListTime(value).toLowerCase()
}

// Milliseconds remaining in the 24-hour customer-service window, or 0.
export function sessionMsLeft(lastInboundAt) {
  const d = parseWaDate(lastInboundAt)
  if (!d) return 0
  return Math.max(0, 24 * 3600 * 1000 - (Date.now() - d.getTime()))
}

export function formatCountdown(ms) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `${h}h ${m}m`
}

const AVATAR_COLORS = [
  '#185494', '#2563eb', '#0ea5e9', '#0891b2', '#0d9488',
  '#7c3aed', '#4f46e5', '#c026d3', '#db2777', '#ea580c',
]

export function avatarColor(seed = '') {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function initials(name, phone) {
  const src = (name || '').trim()
  if (src) return src.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (phone || '?').slice(-2)
}

export function displayName(conv) {
  return conv.wa_name || conv.contact_name || `+${conv.phone}`
}
