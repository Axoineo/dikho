import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EMPLOYEE_REPLIES, MAX_CHAT } from './chat'
import { ChatIcon, CloseIcon, Composer, MessageList } from './ChatParts'
import { useTyping } from './useTyping'

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Your colleague'

function secondsLeft(iso) {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 1000))
}

// "Arjun wants to help you": the employee's choice, every time. Accepting
// opens the browser's own share picker for this tab.
export function IncomingDialog({ session, onAccept, onDecline }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [left, setLeft] = useState(() => secondsLeft(session.expires_at))
  const supported = Boolean(navigator.mediaDevices?.getDisplayMedia)
  const who = firstName(session.helper_name)

  useEffect(() => {
    const t = setInterval(() => setLeft(secondsLeft(session.expires_at)), 1000)
    return () => clearInterval(t)
  }, [session.expires_at])

  async function accept() {
    setBusy(true)
    setError('')
    const result = await onAccept()
    if (!result?.ok) {
      setError(result?.message ?? 'Live Assist could not start.')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop la-backdrop">
      <div className="modal-card la-dialog" role="alertdialog" aria-modal="true" aria-labelledby="la-incoming-title" aria-describedby="la-incoming-copy">
        <span className="la-dialog-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16v4" /><path d="m10 8.5 4 2-4 2z" />
          </svg>
        </span>
        <h2 id="la-incoming-title">{session.helper_name} wants to help you</h2>
        {supported ? (
          <p id="la-incoming-copy">
            {who} will see this Dikho tab, nothing else, and can point at things on your screen.
            They cannot click or type for you. You can stop at any time. Nothing is recorded.
          </p>
        ) : (
          <p id="la-incoming-copy">
            {who} wants to see your screen, but sharing needs Chrome or Edge on a computer.
            Open Dikho there to get help this way.
          </p>
        )}
        {error && <p className="la-error" role="alert">{error}</p>}
        <div className="la-dialog-actions">
          <button type="button" className="secondary-button" onClick={onDecline} disabled={busy}>Not now</button>
          {supported && (
            <button type="button" className="primary-button" onClick={accept} disabled={busy} autoFocus>
              {busy ? 'Waiting for the browser…' : 'Share this tab'}
            </button>
          )}
        </div>
        <p className="la-fineprint">
          {supported ? 'Your browser will ask you to confirm. Choose this tab. ' : ''}
          {left > 0 ? `This request closes in ${left} s.` : 'This request has closed.'}
        </p>
      </div>
    </div>
  )
}

// What a note or highlight hugs: the button, field or row under the spot the
// helper clicked, so the ring sits on it rather than at a bare coordinate.
// Live Assist's own layers (`.la-layer`) are never the answer; something too
// big to point at (a whole panel) means "point at the spot" instead.
const ANCHORS = 'button, a, input, select, textarea, label, [role="button"], [role="tab"], [role="checkbox"], th, td, li, .nav-item, .field'

function anchorAt(x, y) {
  const hit = document.elementsFromPoint(x * window.innerWidth, y * window.innerHeight)
    .find((el) => !el.closest('.la-layer'))
  const target = hit?.closest?.(ANCHORS) ?? hit ?? null
  const r = target?.getBoundingClientRect?.()
  if (!r || r.width * r.height > window.innerWidth * window.innerHeight * 0.35) return null
  return target
}

function boxFor(x, y, el) {
  if (el?.isConnected) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10, round: false }
  }
  const px = x * window.innerWidth
  const py = y * window.innerHeight
  return { left: px - 24, top: py - 24, width: 48, height: 48, round: true }
}

// The note sits beside what it points at: right, else left, else below, else
// above; inside the window and clear of the banner column and of other
// notes. When nothing is clear, the first side that fits the window.
const NOTE_WIDTH = 260
const NOTE_HEIGHT = 46
const GAP = 12

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

function notePlace(box, avoid) {
  const W = window.innerWidth
  const H = window.innerHeight
  const middle = box.top + box.height / 2
  const left = Math.min(Math.max(box.left, 8), W - NOTE_WIDTH - 8)
  const sides = [
    { side: 'right', rect: { left: box.left + box.width + GAP, right: box.left + box.width + GAP + NOTE_WIDTH, top: middle - NOTE_HEIGHT / 2, bottom: middle + NOTE_HEIGHT / 2 },
      style: { left: box.left + box.width + GAP, top: middle } },
    { side: 'left', rect: { left: box.left - GAP - NOTE_WIDTH, right: box.left - GAP, top: middle - NOTE_HEIGHT / 2, bottom: middle + NOTE_HEIGHT / 2 },
      style: { right: W - box.left + GAP, top: middle } },
    { side: 'below', rect: { left, right: left + NOTE_WIDTH, top: box.top + box.height + GAP, bottom: box.top + box.height + GAP + NOTE_HEIGHT },
      style: { left, top: box.top + box.height + GAP } },
    { side: 'above', rect: { left, right: left + NOTE_WIDTH, top: box.top - GAP - NOTE_HEIGHT, bottom: box.top - GAP },
      style: { left, bottom: H - box.top + GAP } },
  ]
  const inWindow = sides.filter(({ rect }) => rect.left >= 8 && rect.right <= W - 8 && rect.top >= 8 && rect.bottom <= H - 8)
  return inWindow.find(({ rect }) => !avoid.some((a) => overlaps(rect, a))) ?? inWindow[0] ?? sides[2]
}

const employeeNoteStatus = (m) => ({
  pinned: 'Shown on your screen',
  clicked: 'You clicked it',
  dismissed: 'Done',
  cleared: 'Cleared when you changed page',
  removed: 'Removed',
})[m.status] ?? ''

// The helper's notes, pinned beside what they point at. They follow the page
// as it scrolls, and end when the employee clicks the thing itself, presses
// Got it, or moves to another page (the provider clears them then).
export function PinnedNotes({ notes, layoutKey, onDone }) {
  const anchors = useRef(new Map())
  const notesRef = useRef(notes)
  const [boxes, setBoxes] = useState({})

  const measure = useCallback(() => {
    const next = {}
    const top = document.querySelector('.la-top')?.getBoundingClientRect()
    const avoid = top ? [{ left: top.left - 8, right: top.right + 8, top: top.top - 8, bottom: top.bottom + 8 }] : []
    for (const note of notesRef.current) {
      const box = boxFor(note.x, note.y, anchors.current.get(note.id))
      const place = notePlace(box, avoid)
      avoid.push(place.rect, { left: box.left, right: box.left + box.width, top: box.top, bottom: box.top + box.height })
      next[note.id] = { box, place }
    }
    setBoxes(next)
  }, [])

  // Also re-placed when the banner column changes size (a message card or
  // the chat opening), which `layoutKey` signals.
  useLayoutEffect(() => {
    notesRef.current = notes
    const map = anchors.current
    for (const note of notes) if (!map.has(note.id)) map.set(note.id, anchorAt(note.x, note.y))
    for (const id of [...map.keys()]) if (!notes.some((n) => n.id === id)) map.delete(id)
    measure()
  }, [notes, layoutKey, measure])

  useEffect(() => {
    if (!notes.length) return undefined
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    // Layout also shifts without any event (a table loading); a cheap
    // re-measure each second catches that.
    const t = setInterval(measure, 1000)
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
      clearInterval(t)
    }
  }, [notes.length, measure])

  useEffect(() => {
    if (!notes.length) return undefined
    function onClick(e) {
      if (e.target.closest?.('.la-layer')) return
      for (const note of notes) {
        if (anchors.current.get(note.id)?.contains(e.target)) onDone(note.id, 'clicked')
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [notes, onDone])

  if (!notes.length) return null
  return (
    <div className="la-layer la-notes">
      {notes.map((note) => {
        if (!boxes[note.id]) return null
        const { box, place } = boxes[note.id]
        return (
          <Fragment key={note.id}>
            <div
              className={`la-note-ring${box.round ? ' is-round' : ''}`}
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
              aria-hidden="true"
            />
            <div className={`la-note is-${place.side}`} style={place.style} role="note">
              <span className="la-num" aria-label={`Note ${note.n}:`}>{note.n}</span>
              <span className="la-note-text">{note.text}</span>
              <button type="button" onClick={() => onDone(note.id, 'dismissed')}>Got it</button>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

function ChatToggle({ open, unread, onToggle }) {
  return (
    <button
      type="button"
      className={`la-chat-toggle${open ? ' is-open' : ''}`}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="la-thread"
    >
      <ChatIcon />
      <span>Chat</span>
      {unread > 0 && <span className="la-badge">{unread}<span className="la-sr"> new</span></span>}
    </button>
  )
}

// The helper's newest message, under the banner, until it is answered,
// hidden or the chat is opened.
function ChatPeek({ message, who, onQuick, onReply, onDismiss }) {
  return (
    <div className="la-peek">
      <p role="status"><strong>{who}:</strong> {message.text}</p>
      <div className="la-peek-actions">
        {EMPLOYEE_REPLIES.slice(0, 3).map((reply) => (
          <button key={reply} type="button" className="la-quick" onClick={() => onQuick(reply)}>{reply}</button>
        ))}
        <button type="button" className="la-link" onClick={onReply}>Reply</button>
        <button type="button" className="la-icon-button" onClick={onDismiss} aria-label="Hide this message"><CloseIcon /></button>
      </div>
    </div>
  )
}

function ChatThread({ who, chat, actions }) {
  const inputRef = useRef(null)
  const typing = useTyping(chat.typingAt)
  useEffect(() => { inputRef.current?.focus() }, [])
  return (
    <section id="la-thread" className="la-thread" aria-label={`Chat with ${who}`}>
      <header className="la-thread-head">
        <span>Chat with {who}</span>
        <button type="button" className="la-icon-button" onClick={actions.close} aria-label="Close chat"><CloseIcon /></button>
      </header>
      <MessageList
        messages={chat.messages}
        statusText={employeeNoteStatus}
        emptyText={`Messages with ${who} show here. Nothing is saved.`}
      />
      {typing && <p className="la-typing">{who} is typing…</p>}
      <div className="la-quick-row">
        {EMPLOYEE_REPLIES.map((reply) => (
          <button key={reply} type="button" className="la-quick" onClick={() => actions.send(reply)}>{reply}</button>
        ))}
      </div>
      <Composer
        inputRef={inputRef}
        placeholder={`Message ${who}`}
        max={MAX_CHAT}
        onSend={actions.send}
        onTyping={actions.typing}
        onEscape={actions.close}
      />
    </section>
  )
}

export function EmployeeOverlay({ session, phase, overlay, chat, chatActions, onStop, onGo, onDismissSuggestion, onHighlightDone }) {
  const who = firstName(session.helper_name)
  const live = phase === 'live'
  const [box, setBox] = useState(null)
  const [pointerVisible, setPointerVisible] = useState(false)

  useEffect(() => {
    if (!overlay.highlight) { setBox(null); return undefined }
    const { x, y } = overlay.highlight
    setBox(boxFor(x, y, anchorAt(x, y)))
    const t = setTimeout(onHighlightDone, 4000)
    return () => clearTimeout(t)
  }, [overlay.highlight, onHighlightDone])

  // The pointer fades when the helper stops moving it.
  useEffect(() => {
    if (!overlay.pointer) { setPointerVisible(false); return undefined }
    setPointerVisible(true)
    const t = setTimeout(() => setPointerVisible(false), 4000)
    return () => clearTimeout(t)
  }, [overlay.pointer])

  return (
    <>
      <div className="la-layer la-top">
        <div className={`la-banner${live ? ' is-live' : ''}`}>
          <span className="la-banner-dot" aria-hidden="true" />
          <span role="status">{live ? `${session.helper_name} is viewing your screen` : `Connecting to ${who}…`}</span>
          {live && <ChatToggle open={chat.open} unread={chat.unread} onToggle={chatActions.toggle} />}
          <button type="button" className="la-stop" onClick={onStop}>Stop sharing</button>
        </div>
        {live && chat.open && <ChatThread who={who} chat={chat} actions={chatActions} />}
        {live && !chat.open && chat.peek && (
          <ChatPeek
            message={chat.peek}
            who={who}
            onQuick={chatActions.send}
            onReply={chatActions.open}
            onDismiss={chatActions.dismissPeek}
          />
        )}
      </div>

      {live && <PinnedNotes notes={chat.notes} layoutKey={`${chat.open}:${chat.peek?.id ?? ''}:${chat.messages.length}`} onDone={chatActions.noteDone} />}

      {overlay.pointer && pointerVisible && (
        <div
          className="la-layer la-pointer"
          style={{ transform: `translate(${overlay.pointer.x * window.innerWidth}px, ${overlay.pointer.y * window.innerHeight}px)` }}
          aria-hidden="true"
        >
          <svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2.5 20 12l-7.2 1.6L9 21z" /></svg>
          <span>{who}</span>
        </div>
      )}

      {box && (
        <div
          className={`la-layer la-highlight${box.round ? ' is-round' : ''}`}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          aria-hidden="true"
        />
      )}

      {overlay.suggestion && (
        <div className="la-layer la-suggestion" role="status">
          <span>{who} suggests opening <strong>{overlay.suggestion.label}</strong></span>
          <button type="button" className="primary-button" onClick={() => onGo(overlay.suggestion.path)}>Go</button>
          <button type="button" className="la-link" onClick={onDismissSuggestion}>Not now</button>
        </div>
      )}
    </>
  )
}
