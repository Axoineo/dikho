// Display helpers for the Email Hub. Nothing here decides access.

export const FOLDERS = [
  { key: 'inbox', label: 'Inbox', icon: 'inbox' },
  { key: 'assigned', label: 'Assigned to me', icon: 'user' },
  { key: 'starred', label: 'Starred', icon: 'star' },
  { key: 'sent', label: 'Sent', icon: 'send' },
  { key: 'drafts', label: 'Drafts', icon: 'edit' },
  { key: 'archived', label: 'Archived', icon: 'archive' },
  { key: 'all', label: 'All mail', icon: 'mail' },
]

export const ROLE_LABELS = { viewer: 'Viewer', responder: 'Responder', manager: 'Manager', admin: 'Administrator' }
export const ROLE_HELP = {
  viewer: 'Reads conversations.',
  responder: 'Reads, replies, files and takes conversations.',
  manager: 'Also assigns conversations to others.',
  admin: 'Also chooses who may use the mailbox and connects it.',
}
export const ROLE_RANK = { viewer: 1, responder: 2, manager: 3, admin: 4 }
export const atLeast = (role, min) => (ROLE_RANK[role] ?? 0) >= ROLE_RANK[min]

export const WORKFLOW = [
  { key: 'open', label: 'Open' },
  { key: 'pending', label: 'Waiting' },
  { key: 'closed', label: 'Done' },
]

export const STATUS = {
  connected: { label: 'Connected', tone: 'ok' },
  pending: { label: 'Not connected yet', tone: 'warn' },
  reauth_required: { label: 'Reconnect needed', tone: 'danger' },
  disconnected: { label: 'Disconnected', tone: '' },
}

// What the Google return page means, keyed by the code the API sends back.
export const CONNECT_OUTCOMES = {
  connected: ['ok', 'Mailbox connected. The first sync is running; recent conversations appear in a minute.'],
  cancelled: ['warn', 'The connection was cancelled in Google. Nothing was connected.'],
  expired: ['warn', 'That connection link had expired or was already used. Start again from this page.'],
  invalid: ['danger', 'Google sent back an unexpected answer. Start again from this page.'],
  scope_missing: ['danger', 'Dikho needs permission to read and send mail. Connect again and leave the Gmail box ticked.'],
  no_refresh_token: ['danger', 'Google did not grant lasting access. Connect again.'],
  identity_invalid: ['danger', 'Google could not confirm which account signed in. Connect again.'],
  wrong_domain: ['danger', 'Only company Google Workspace accounts can be connected.'],
  conflict: ['danger', 'That mailbox is already connected by someone else, or you signed in as a different address than the shared mailbox.'],
  forbidden: ['danger', 'You are not allowed to connect that mailbox. A colleague\'s own address can only be connected by them.'],
  not_yours: ['danger', 'This connection was started by someone else in Dikho, so nothing was connected. If someone sent you that link, tell an administrator. To connect your own mailbox, start from this page.'],
  not_configured: ['danger', 'Google sign-in is not set up on the server yet. Ask an administrator.'],
  google_error: ['danger', 'Google reported an error. Try again in a minute.'],
  google_unreachable: ['danger', 'Google could not be reached. Try again in a minute.'],
  exchange_failed: ['danger', 'Google did not accept the connection. Start again from this page.'],
  failed: ['danger', 'The mailbox could not be connected. Try again.'],
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Gmail-style: time today, "12 Oct" this year, "12 Oct 2025" before. */
export function listTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString([], d.getFullYear() === now.getFullYear()
    ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fullTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function relativeTime(iso) {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return listTime(iso)
}

export const personName = (p) => (p?.name || p?.email || '').trim()
export const firstName = (p) => personName(p).split(/[\s@]/)[0]

export function initials(p) {
  const name = personName(p)
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase()
}

/** "Asha, me, Ravi (3)": participants other than the mailbox itself first. */
export function participantLine(thread, mailboxEmail) {
  const people = (thread.participants ?? []).filter((p) => p.email !== mailboxEmail)
  const names = (people.length ? people : thread.participants ?? []).slice(0, 3).map(firstName).filter(Boolean)
  const line = names.join(', ') || '(no one)'
  return thread.message_count > 1 ? `${line} (${thread.message_count})` : line
}

export function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const addressList = (people) => (people ?? []).map((p) => (p.name ? `${p.name} <${p.email}>` : p.email)).join(', ')

/** "Re: " / "Fwd: " once, never stacked. */
export function prefixed(prefix, subject) {
  const clean = String(subject || '').trim()
  return new RegExp(`^${prefix}:\\s`, 'i').test(clean) ? clean : `${prefix}: ${clean}`.trim()
}

/** One id per message in the composer, so a double submit sends once. */
export const newSendId = () => crypto.randomUUID()

// ── Campaigns, templates and consent ─────────────────────────────────────────
export const CAMPAIGN_STATUS = {
  draft: { label: 'Draft', tone: '' },
  pending_approval: { label: 'Awaiting approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'brand' },
  rejected: { label: 'Changes requested', tone: 'danger' },
  sending: { label: 'Sending', tone: 'brand' },
  paused: { label: 'Paused', tone: 'warn' },
  sent: { label: 'Sent', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: '' },
}

// A recipient ends in exactly one of these; "sent" means SES accepted it and
// no later event (delivered, bounced, ...) has arrived yet.
export const DELIVERED_STATES = ['sent', 'delivered', 'bounced', 'complained', 'unsubscribed']
export function campaignCounts(stats) {
  const n = (k) => Number(stats?.[k] ?? 0)
  const total = Object.values(stats ?? {}).reduce((a, b) => a + Number(b || 0), 0)
  return {
    total,
    queued: n('pending') + n('sending'),
    sent: DELIVERED_STATES.reduce((a, k) => a + n(k), 0),
    delivered: n('delivered') + n('unsubscribed'),
    bounced: n('bounced'),
    complained: n('complained'),
    unsubscribed: n('unsubscribed'),
    failed: n('failed'),
    uncertain: n('uncertain'),
    skipped: n('skipped'),
  }
}

export const SOURCE_LABELS = { client: 'Clients', vendor: 'Vendors', lead: 'Leads' }
export const EMPTY_AUDIENCE = { sources: [], country: [], state: [], city: [], media: [], sub_media: [], active_only: true }

export const CONSENT_SOURCES = {
  form: 'Signed up on a form',
  verbal: 'Agreed verbally',
  written: 'Agreed in writing',
  imported: 'Imported with consent records',
  request: 'At their request',
  unsubscribe_link: 'Unsubscribe link',
  complaint: 'Marked as spam',
}

export const CAMPAIGN_EVENTS = {
  'email_campaign.created': 'Created',
  'email_campaign.edited': 'Edited after submission',
  'email_campaign.submitted': 'Submitted for approval',
  'email_campaign.approved': 'Approved',
  'email_campaign.rejected': 'Changes requested',
  'email_campaign.paused': 'Paused',
  'email_campaign.resumed': 'Resumed',
  'email_campaign.cancelled': 'Cancelled',
  'email_campaign.sent': 'Finished sending',
}

/** <input type="datetime-local"> value for an ISO time, in local time. */
export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const formatCount = (n) => Number(n ?? 0).toLocaleString()
