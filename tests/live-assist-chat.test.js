import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_CHAT, MAX_NOTE, MAX_NOTES, MAX_THREAD, chatReducer, cleanText, emptyChat, helperMessage,
  readEmployeeMessage, readHelperMessage,
} from '../src/features/live-assist/chat.js'

// Live Assist chat runs browser to browser, so each side checks what the
// other sends before showing it. Synthetic text only.
const id = (n) => `abcdef${String(n).padStart(4, '0')}`

test('text is plain, bounded and tidy', () => {
  assert.equal(cleanText('  Click\u0000 the\t\tSave   button \u0007', 100), 'Click the Save button')
  assert.equal(cleanText('a\n\n\n\nb', 100), 'a\n\nb')
  assert.equal(cleanText('x'.repeat(900), MAX_CHAT).length, MAX_CHAT)
  assert.equal(cleanText(42, 100), '')
  assert.equal(cleanText('<b>bold</b>', 100), '<b>bold</b>', 'kept as text; React escapes it when shown')
})

test('the employee accepts only well-formed helper messages', () => {
  assert.deepEqual(readHelperMessage({ t: 'chat', id: id(1), text: ' Hi ' }), { t: 'chat', id: id(1), text: 'Hi' })
  assert.equal(readHelperMessage({ t: 'chat', id: id(1), text: '   ' }), null)
  assert.equal(readHelperMessage({ t: 'chat', id: 'bad id!', text: 'Hi' }), null)
  assert.deepEqual(readHelperMessage({ t: 'note', id: id(2), text: 'Click here', x: 0.5, y: 1, n: 1 }),
    { t: 'note', id: id(2), text: 'Click here', x: 0.5, y: 1, n: 1 })
  assert.equal(readHelperMessage({ t: 'note', id: id(2), text: 'Click here', x: 1.2, y: 0.5, n: 1 }), null)
  assert.equal(readHelperMessage({ t: 'note', id: id(2), text: 'Click here', x: 0.2, y: 0.5, n: 0 }), null)
  assert.equal(readHelperMessage({ t: 'note', id: id(2), text: 'x'.repeat(400), x: 0.2, y: 0.5, n: 1 }).text.length, MAX_NOTE)
  assert.deepEqual(readHelperMessage({ t: 'note_remove', id: 'all' }), { t: 'note_remove', id: 'all' })
  assert.equal(readHelperMessage({ t: 'note_done', id: id(2) }), null, 'only the employee sends note_done')
  assert.equal(readHelperMessage({ t: 'eval', code: 'alert(1)' }), null)
  assert.equal(readHelperMessage(null), null)
})

test('the helper accepts only well-formed employee messages', () => {
  assert.deepEqual(readEmployeeMessage({ t: 'note_done', id: id(3), how: 'clicked' }), { t: 'note_done', id: id(3), how: 'clicked' })
  assert.deepEqual(readEmployeeMessage({ t: 'note_done', id: id(3), how: 'anything' }), { t: 'note_done', id: id(3), how: 'dismissed' })
  assert.deepEqual(readEmployeeMessage({ t: 'notes_cleared' }), { t: 'notes_cleared' })
  assert.equal(readEmployeeMessage({ t: 'note', id: id(4), text: 'x', x: 0, y: 0, n: 1 }), null, 'only the helper pins notes')
})

const receive = (state, message, now = 1000) => chatReducer(state, { type: 'receive', message, now })

test('a new message shows as a peek and counts as unread until the chat is opened', () => {
  let s = receive(emptyChat, { t: 'chat', id: id(1), text: 'Choose the client first' })
  assert.equal(s.unread, 1)
  assert.equal(s.peek.text, 'Choose the client first')
  s = receive(s, { t: 'chat', id: id(1), text: 'Choose the client first' })
  assert.equal(s.messages.length, 1, 'a repeated message is shown once')
  s = chatReducer(s, { type: 'open' })
  assert.deepEqual([s.open, s.unread, s.peek], [true, 0, null])
  s = receive(s, { t: 'chat', id: id(2), text: 'Now add the item' })
  assert.deepEqual([s.unread, s.peek], [0, null], 'nothing pops up over an open chat')
})

test('replying clears the peek', () => {
  let s = receive(emptyChat, { t: 'chat', id: id(1), text: 'Choose the client first' })
  s = chatReducer(s, { type: 'send', message: { t: 'chat', id: id(2), text: 'OK' }, now: 2000 })
  assert.deepEqual([s.peek, s.unread, s.messages.map((m) => m.from)], [null, 0, ['them', 'me']])
})

test('at most five notes stay on screen; the oldest make way', () => {
  let s = emptyChat
  for (let n = 1; n <= MAX_NOTES + 2; n++) s = receive(s, { t: 'note', id: id(n), text: `Step ${n}`, x: 0.1, y: 0.1, n })
  assert.deepEqual(s.notes.map((n) => n.n), [3, 4, 5, 6, 7])
  assert.deepEqual(s.messages.filter((m) => m.status === 'removed').map((m) => m.n), [1, 2])
})

test('notes end by click, by Got it, by a page change, or by the helper', () => {
  let s = emptyChat
  for (let n = 1; n <= 3; n++) s = receive(s, { t: 'note', id: id(n), text: `Step ${n}`, x: 0.1, y: 0.1, n })
  s = chatReducer(s, { type: 'note_done', id: id(1), how: 'clicked' })
  assert.deepEqual(s.notes.map((n) => n.n), [2, 3])
  assert.equal(s.messages[0].status, 'clicked')
  s = receive(s, { t: 'note_remove', id: id(2) })
  assert.deepEqual(s.notes.map((n) => n.n), [3])
  s = chatReducer(s, { type: 'clear_notes' })
  assert.deepEqual([s.notes, s.messages.map((m) => m.status)], [[], ['clicked', 'removed', 'cleared']])
})

test('the helper numbers notes and hears how each one ended', () => {
  let s = emptyChat
  const pin = { x: 0.4, y: 0.6 }
  const first = helperMessage('Click here', pin, s.nextNote)
  assert.equal(first.t, 'note')
  s = chatReducer(s, { type: 'send', message: first, now: 1 })
  const second = helperMessage('Then type the amount', pin, s.nextNote)
  assert.equal(second.n, 2)
  s = chatReducer(s, { type: 'send', message: second, now: 2 })
  s = receive(s, { t: 'note_done', id: first.id, how: 'clicked' })
  assert.deepEqual(s.messages.map((m) => m.status), ['clicked', 'pinned'])
  s = receive(s, { t: 'notes_cleared' })
  assert.deepEqual([s.messages.map((m) => m.status), s.nextNote], [['clicked', 'cleared'], 1])
})

test('without a pin, or too long for a note, the helper sends plain chat', () => {
  assert.equal(helperMessage('Hello', null, 1).t, 'chat')
  assert.equal(helperMessage('x'.repeat(MAX_NOTE + 1), { x: 0.1, y: 0.1 }, 1).t, 'chat')
  assert.equal(helperMessage('   ', { x: 0.1, y: 0.1 }, 1), null)
})

test('the thread keeps the latest 100 messages', () => {
  let s = emptyChat
  for (let n = 0; n < MAX_THREAD + 20; n++) s = receive(s, { t: 'chat', id: id(n), text: `m${n}` })
  assert.equal(s.messages.length, MAX_THREAD)
  assert.equal(s.messages[0].text, 'm20')
})

test('typing shows until the next message arrives', () => {
  let s = receive(emptyChat, { t: 'typing' }, 5000)
  assert.equal(s.typingAt, 5000)
  s = receive(s, { t: 'chat', id: id(1), text: 'Done' }, 6000)
  assert.equal(s.typingAt, 0)
})
