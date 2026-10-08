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

// Reactions are rows of their own (type 'reaction', context_wamid = the
// message reacted to), as Meta delivers them. A bubble shows the latest one
// from each side; an empty emoji means it was taken off. Rows from before
// migration 0011 carry no target and stay visible as small bubbles.
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
