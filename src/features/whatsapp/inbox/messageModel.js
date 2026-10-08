// Pure helpers that turn the thread's rows into what the bubbles show.

// Payload kinds that RichContent draws instead of the plain-text summary.
const RICH_KINDS = new Set(['location', 'contacts', 'interactive', 'template', 'form_reply', 'order'])
export function isRichKind(payload) {
  return RICH_KINDS.has(payload?.kind)
}

export function parsePayload(message) {
  if (!message?.payload) return null
  if (typeof message.payload === 'object') return message.payload
  try { return JSON.parse(message.payload) } catch { return null }
}

// The thread arrives a page at a time, newest page first: the API sends
// { messages (oldest first), hasMore }. `before` is the oldest row of the
// oldest page fetched, the cursor for the next one up. It is kept apart from
// messages[0] because a realtime append can be older than every fetched row
// (a late webhook carries WhatsApp's own timestamp), and once sorted in it
// would sit in front of rows the server still has to send.
export const EMPTY_THREAD = { messages: [], hasMore: false, before: null }

// The API's order. Rows in a thread all carry ISO timestamps, so strings
// compare as times.
function byTime(a, b) {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id - b.id
}

// hasMore must be exactly true: an API from before paging sends none, and
// then there is nothing older to ask for.
export function threadFromPage(page) {
  const messages = page?.messages ?? []
  return { messages, hasMore: page?.hasMore === true, before: messages[0]?.id ?? null }
}

// An older page goes in front. The server's copy of a row wins over one a
// broadcast added out of order. Dropped if the thread moved on while it was in
// flight (another chat, or a refresh that started over).
export function prependOlderPage(thread, page, requestedBefore) {
  if (thread.before !== requestedBefore) return thread
  const older = page?.messages ?? []
  const ids = new Set(older.map((m) => m.id))
  return {
    messages: [...older, ...thread.messages.filter((m) => !ids.has(m.id))].sort(byTime),
    hasMore: page?.hasMore === true,
    before: older[0]?.id ?? thread.before,
  }
}

// The background refresh re-reads the newest page. Its rows replace the
// thread's from its first row on, so deletes, clears and statuses that a
// missed broadcast never delivered still land, and older pages the agent
// scrolled up through stay. When the page is the whole thread, or does not
// reach back to a row already here (a page or more arrived meanwhile), it
// replaces everything.
export function mergeNewestPage(thread, page) {
  const fresh = page?.messages ?? []
  if (page?.hasMore !== true || !thread.messages.some((m) => m.id === fresh[0].id)) return threadFromPage(page)
  const ids = new Set(fresh.map((m) => m.id))
  const older = thread.messages.filter((m) => !ids.has(m.id) && byTime(m, fresh[0]) < 0)
  return { ...thread, messages: [...older, ...fresh].sort(byTime) }
}

// Reactions are rows of their own (type 'reaction', context_wamid = the
// message reacted to), as Meta delivers them. A bubble shows the latest one
// from each side; an empty emoji means it was taken off. Rows from before
// migration 0011 carry no target and stay visible as small bubbles. A
// reaction whose message is on a page not loaded yet shows nowhere, and joins
// its bubble when that page comes in.
export function foldReactions(messages) {
  const byTarget = new Map()
  const shown = []
  for (const m of messages) {
    if (m.type === 'reaction' && m.context_wamid) {
      const side = m.direction === 'outbound' ? 'business' : 'customer'
      const entry = byTarget.get(m.context_wamid) ?? {}
      entry[side] = m.body || null
      byTarget.set(m.context_wamid, entry)
      continue
    }
    shown.push(m)
  }
  return { shown, reactionsFor: (m) => (m.meta_message_id ? byTarget.get(m.meta_message_id) ?? null : null) }
}

export function indexByWamid(messages) {
  const map = new Map()
  for (const m of messages) if (m.meta_message_id) map.set(m.meta_message_id, m)
  return map
}

// Meta refuses reactions to messages over 30 days old (error 131009).
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
export function canReactTo(message, parseDate) {
  if (!message?.meta_message_id || message.type === 'reaction' || message.type === 'system') return false
  const at = parseDate(message.wa_timestamp || message.created_at)
  return Boolean(at) && Date.now() - at.getTime() < THIRTY_DAYS
}

const FORWARDABLE = new Set(['text', 'image', 'video', 'audio', 'document', 'sticker', 'location'])
export function canForward(message) {
  if (!FORWARDABLE.has(message?.type)) return false
  if (message.type === 'text') return Boolean(message.body?.trim())
  if (message.type === 'location') return true
  return message.media_status === 'ready' && Boolean(message.media_url)
}

// One line describing a message, for quotes, the pinned bar and the reply bar.
export function snippet(message) {
  if (!message) return ''
  const payload = parsePayload(message)
  if (payload?.kind === 'voice') return 'Voice message'
  if (message.body) return message.body
  const mime = message.media_mime || ''
  if (mime.startsWith('image/')) return message.type === 'sticker' ? 'Sticker' : 'Photo'
  if (mime.startsWith('video/')) return 'Video'
  if (mime.startsWith('audio/')) return 'Audio'
  if (message.media_filename) return message.media_filename
  return 'Message'
}
