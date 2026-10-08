import { useEffect, useRef, useState } from 'react'

// Pieces both sides of the Live Assist chat use: icons, the message list
// and the composer.

export function ChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2.2" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12 20 4l-6 16-2.5-6.5z" /><path d="m11.5 13.5 3-3" />
    </svg>
  )
}

export function MessageList({ messages, statusText, emptyText }) {
  const listRef = useRef(null)
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])
  return (
    <div className="la-msgs" ref={listRef} role="log" aria-live="polite" aria-relevant="additions">
      {messages.length === 0 && <p className="la-msgs-empty">{emptyText}</p>}
      {messages.map((m) => (
        <div key={m.id} className={`la-msg is-${m.from}${m.kind === 'note' ? ` is-note is-${m.status}` : ''}`}>
          {m.kind === 'note' && <span className="la-num" aria-label={`Note ${m.n}:`}>{m.n}</span>}
          <span className="la-msg-text">{m.text}</span>
          {m.kind === 'note' && <span className="la-msg-status">{statusText(m)}</span>}
        </div>
      ))}
    </div>
  )
}

// Enter sends, Shift+Enter starts a new line. Sends a "typing" signal at
// most every 2.5 seconds while the person types.
export function Composer({ placeholder, max, onSend, onTyping, inputRef, onEscape }) {
  const [text, setText] = useState('')
  const lastTyping = useRef(0)

  function change(e) {
    setText(e.target.value)
    const now = Date.now()
    if (onTyping && now - lastTyping.current > 2500) {
      lastTyping.current = now
      onTyping()
    }
  }

  function submit(e) {
    e?.preventDefault()
    if (!text.trim()) return
    onSend(text)
    setText('')
    lastTyping.current = 0
  }

  function key(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape' && onEscape) {
      e.stopPropagation()
      onEscape()
    }
  }

  return (
    <form className="la-composer" onSubmit={submit}>
      <textarea
        ref={inputRef}
        rows={1}
        value={text}
        maxLength={max}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={change}
        onKeyDown={key}
      />
      <button type="submit" className="la-send" disabled={!text.trim()} aria-label="Send">
        <SendIcon />
      </button>
    </form>
  )
}
