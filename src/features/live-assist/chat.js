// Live Assist chat and pinned notes: the messages the two browsers exchange
// on the session's data channel (peer.js), checked on arrival, and the small
// state each side keeps. Nothing here is stored or passes through Dikho's
// servers; it is gone when the session ends. No browser APIs, so
// tests/live-assist-chat.test.js runs it in Node.
//
// Helper -> employee: chat, note (pinned at a spot), note_remove, typing
// Employee -> helper: chat, note_done (clicked or dismissed), notes_cleared
//                     (they changed page), typing

export const MAX_CHAT = 500
export const MAX_NOTE = 140
export const MAX_NOTES = 5
export const MAX_THREAD = 100
// How long "is typing" shows after the last keystroke signal.
export const TYPING_MS = 4000

export const HELPER_PHRASES = ['Click here', 'Type here', 'Scroll down', 'Wait a moment', 'Well done']
export const EMPLOYEE_REPLIES = ['OK', 'Done', 'Where?', 'One moment']

const ID = /^[a-z0-9]{8,32}$/

export function newId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ? uuid.replace(/-/g, '').slice(0, 16) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

// Plain text only: no control characters, runs of spaces collapsed, at most
// two line breaks in a row, trimmed to the limit. It is shown as text, never
// as HTML, and links are not made clickable.
export function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\p{Cc}/gu, (ch) => (ch === '\n' ? ch : ''))
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
}

const inRange = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

function readChat(m) {
  const text = cleanText(m.text, MAX_CHAT)
  return text && ID.test(m.id) ? { t: 'chat', id: m.id, text } : null
}

/** A message from the helper, as the employee's browser accepts it, or null. */
export function readHelperMessage(m) {
  if (!m || typeof m !== 'object') return null
  switch (m.t) {
    case 'chat':
      return readChat(m)
    case 'note': {
      const text = cleanText(m.text, MAX_NOTE)
      const ok = text && ID.test(m.id) && inRange(m.x) && inRange(m.y) && Number.isInteger(m.n) && m.n >= 1 && m.n <= 99
      return ok ? { t: 'note', id: m.id, text, x: m.x, y: m.y, n: m.n } : null
    }
    case 'note_remove':
      return m.id === 'all' || ID.test(m.id) ? { t: 'note_remove', id: m.id } : null
    case 'typing':
      return { t: 'typing' }
    default:
      return null
  }
}

/** A message from the employee, as the helper's browser accepts it, or null. */
export function readEmployeeMessage(m) {
  if (!m || typeof m !== 'object') return null
  switch (m.t) {
    case 'chat':
      return readChat(m)
    case 'note_done':
      return ID.test(m.id) ? { t: 'note_done', id: m.id, how: m.how === 'clicked' ? 'clicked' : 'dismissed' } : null
    case 'notes_cleared':
      return { t: 'notes_cleared' }
    case 'typing':
      return { t: 'typing' }
    default:
      return null
  }
}

// One side's conversation. `messages` is the thread (mine and theirs, chat
// and notes); `notes` are the notes on the employee's screen right now;
// `peek` is the newest message from the other side not yet answered or
// dismissed; `nextNote` numbers the helper's notes 1, 2, 3...
export const emptyChat = { messages: [], notes: [], unread: 0, open: false, peek: null, typingAt: 0, nextNote: 1 }

const capped = (list) => (list.length > MAX_THREAD ? list.slice(list.length - MAX_THREAD) : list)

function setStatus(messages, match, status) {
  return messages.map((m) => (m.kind === 'note' && m.status === 'pinned' && match(m) ? { ...m, status } : m))
}

export function chatReducer(state, action) {
  switch (action.type) {
    case 'receive': {
      const m = action.message
      const at = action.now
      if (m.t === 'typing') return { ...state, typingAt: at }
      if (m.t === 'chat') {
        if (state.messages.some((x) => x.id === m.id)) return state
        const message = { id: m.id, from: 'them', kind: 'chat', text: m.text, at }
        return {
          ...state,
          messages: capped([...state.messages, message]),
          unread: state.open ? 0 : state.unread + 1,
          peek: state.open ? null : message,
          typingAt: 0,
        }
      }
      if (m.t === 'note') {
        if (state.messages.some((x) => x.id === m.id)) return state
        const message = { id: m.id, from: 'them', kind: 'note', n: m.n, text: m.text, status: 'pinned', at }
        let notes = [...state.notes, { id: m.id, n: m.n, text: m.text, x: m.x, y: m.y }]
        let messages = [...state.messages, message]
        if (notes.length > MAX_NOTES) {
          const gone = new Set(notes.slice(0, notes.length - MAX_NOTES).map((n) => n.id))
          notes = notes.slice(notes.length - MAX_NOTES)
          messages = setStatus(messages, (x) => gone.has(x.id), 'removed')
        }
        return { ...state, notes, messages: capped(messages), typingAt: 0 }
      }
      if (m.t === 'note_remove') {
        const hit = (x) => m.id === 'all' || x.id === m.id
        return { ...state, notes: state.notes.filter((n) => !hit(n)), messages: setStatus(state.messages, hit, 'removed') }
      }
      if (m.t === 'note_done') {
        return { ...state, messages: setStatus(state.messages, (x) => x.id === m.id, m.how) }
      }
      if (m.t === 'notes_cleared') {
        return { ...state, messages: setStatus(state.messages, () => true, 'cleared'), nextNote: 1 }
      }
      return state
    }
    // My own message, already handed to the data channel.
    case 'send': {
      const m = action.message
      const message = m.t === 'note'
        ? { id: m.id, from: 'me', kind: 'note', n: m.n, text: m.text, status: 'pinned', at: action.now }
        : { id: m.id, from: 'me', kind: 'chat', text: m.text, at: action.now }
      return {
        ...state,
        messages: capped([...state.messages, message]),
        nextNote: m.t === 'note' ? m.n + 1 : state.nextNote,
        peek: null,
        unread: 0,
      }
    }
    // Employee side: a note answered on their screen.
    case 'note_done': {
      return {
        ...state,
        notes: state.notes.filter((n) => n.id !== action.id),
        messages: setStatus(state.messages, (x) => x.id === action.id, action.how),
      }
    }
    // Employee side: they moved to another page, where the spots mean nothing.
    case 'clear_notes':
      return { ...state, notes: [], messages: setStatus(state.messages, () => true, 'cleared') }
    // Helper side: "Remove notes".
    case 'remove_notes':
      return { ...state, messages: setStatus(state.messages, () => true, 'removed'), nextNote: 1 }
    case 'open':
      return { ...state, open: true, unread: 0, peek: null }
    case 'close':
      return { ...state, open: false }
    case 'toggle':
      return state.open ? { ...state, open: false } : { ...state, open: true, unread: 0, peek: null }
    case 'dismiss_peek':
      return { ...state, peek: null }
    case 'reset':
      return emptyChat
    default:
      return state
  }
}

/** The helper's outgoing message: a note pinned at a spot, or plain chat. */
export function helperMessage(text, pin, nextNote) {
  const clean = cleanText(text, MAX_CHAT)
  if (!clean) return null
  if (pin && clean.length <= MAX_NOTE) return { t: 'note', id: newId(), n: nextNote, text: clean, x: pin.x, y: pin.y }
  return { t: 'chat', id: newId(), text: clean }
}

export function chatMessage(text) {
  const clean = cleanText(text, MAX_CHAT)
  return clean ? { t: 'chat', id: newId(), text: clean } : null
}
