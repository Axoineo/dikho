import { useEffect, useMemo, useState } from 'react'
import { Avatar } from './Avatar'
import { displayName, sessionMsLeft } from './inboxUtils'
import { snippet } from './messageModel'

// Forward one message to up to five chats, as WhatsApp allows. Each chat is a
// separate send through the API, one after another, and each must have its
// 24-hour window open: a forward is a free-form message.

const MAX_TARGETS = 5

function unavailable(conv) {
  if (conv.blocked_at) return 'Blocked'
  if (sessionMsLeft(conv.last_inbound_at) <= 0) return 'Reply window closed'
  return null
}

export function ForwardDialog({ message, conversations, currentId, onForward, onClose }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState([])
  const [results, setResults] = useState({}) // id -> 'sending' | 'sent' | error text
  const [running, setRunning] = useState(false)
  const done = Object.keys(results).length > 0 && !running

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !running) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, onClose])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations
      .filter((c) => c.id !== currentId)
      .filter((c) => !q || displayName(c).toLowerCase().includes(q) || (c.phone || '').includes(q))
  }, [conversations, currentId, query])

  function toggle(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < MAX_TARGETS ? [...prev, id] : prev))
  }

  async function run() {
    setRunning(true)
    for (const id of selected) {
      setResults((r) => ({ ...r, [id]: 'sending' }))
      try {
        await onForward(id)
        setResults((r) => ({ ...r, [id]: 'sent' }))
      } catch (err) {
        setResults((r) => ({ ...r, [id]: err?.message || 'Did not send' }))
      }
    }
    setRunning(false)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,20,26,0.45)] p-4" onMouseDown={() => { if (!running) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="forward-title" onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[min(640px,calc(100vh-32px))] w-full max-w-[420px] flex-col rounded-2xl border border-line bg-surface shadow-[0_17px_50px_rgba(11,20,26,0.19)]">
        <div className="border-b border-line px-5 pb-3 pt-5">
          <h2 id="forward-title" className="m-0 text-[17px] font-semibold text-ink">Forward message</h2>
          <p className="m-0 mt-1 truncate text-[12.5px] text-muted">“{snippet(message)}”</p>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats"
            className="mt-3 w-full rounded-full bg-inbox-field px-4 py-2 text-[13.5px] text-ink outline-none focus:ring-2 focus:ring-inbox-focus" />
        </div>
        <div className="inbox-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
          {list.length === 0 && <p className="m-0 px-4 py-6 text-center text-[13px] text-muted">No chats match.</p>}
          {list.map((c) => {
            const reason = unavailable(c)
            const checked = selected.includes(c.id)
            const result = results[c.id]
            return (
              <button key={c.id} type="button" disabled={Boolean(reason) || running || done || (!checked && selected.length >= MAX_TARGETS)}
                onClick={() => toggle(c.id)} aria-pressed={checked}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-inbox-row-hover disabled:cursor-default disabled:hover:bg-transparent">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${checked ? 'border-brand bg-brand text-white' : 'border-line'} ${reason ? 'opacity-40' : ''}`}>
                  {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>}
                </span>
                <Avatar name={c.wa_name || c.contact_name} phone={c.phone} avatarUrl={c.avatar_url} size={36} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[14px] font-medium ${reason ? 'text-muted' : 'text-ink'}`}>{displayName(c)}</span>
                  {reason && <span className="block text-[12px] text-muted">{reason}</span>}
                  {result && result !== 'sending' && result !== 'sent' && <span className="block text-[12px] text-danger">{result}</span>}
                </span>
                {result === 'sending' && <span className="text-[12px] text-muted">Sending…</span>}
                {result === 'sent' && <span className="text-[12px] font-semibold text-chat-accent-ink">Sent</span>}
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3.5">
          <span className="text-[12.5px] text-muted">{selected.length} of {MAX_TARGETS} selected</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={running}
              className="h-9 rounded-full border border-line px-4 text-[13px] font-semibold text-ink hover:bg-inbox-control disabled:opacity-50">{done ? 'Done' : 'Cancel'}</button>
            {!done && (
              <button type="button" onClick={run} disabled={running || selected.length === 0}
                className="h-9 rounded-full border-0 bg-brand px-4 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50">{running ? 'Forwarding…' : 'Forward'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
