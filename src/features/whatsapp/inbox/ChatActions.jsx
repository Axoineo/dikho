import { useEffect, useRef, useState } from 'react'
import { canBlockNow, displayName } from './inboxUtils'

// Clear chat, Delete chat, Block and Unblock: the header menu that offers
// them and the confirmation each one goes through. The dashboard only hides
// what the person may not do; the API checks inbox.delete and inbox.block on
// every request (src/api/routes/whatsapp/conversations.js).

const COPY = {
  clear: {
    title: () => 'Clear this chat?',
    body: (name) => `Every message in this chat is removed from the inbox for everyone on your team. ${name} keeps their copy on WhatsApp.`,
    confirm: 'Clear chat',
    danger: true,
  },
  delete: {
    title: () => 'Delete this chat?',
    body: (name) => `The chat and its messages are removed from the inbox for everyone on your team. If ${name} writes again, a new chat starts without the old messages. They keep their copy on WhatsApp.`,
    confirm: 'Delete chat',
    danger: true,
  },
  block: {
    title: (name) => `Block ${name}?`,
    body: () => 'They will not be able to message this business number, and nobody here can message them until they are unblocked. The chat stays in the inbox.',
    confirm: 'Block',
    danger: true,
  },
  unblock: {
    title: (name) => `Unblock ${name}?`,
    body: () => 'They will be able to message this business number again.',
    confirm: 'Unblock',
    danger: false,
  },
}

export function ChatActionDialog({ action, conversation, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef(null)
  const copy = COPY[action]
  const name = displayName(conversation)

  // Escape cancels, unless the request is already on its way.
  useEffect(() => {
    cancelRef.current?.focus()
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (err) {
      // Stays open with the reason, so a refusal is never silent.
      setError(err?.message || 'That did not work. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,20,26,0.45)] p-4"
      onMouseDown={() => { if (!busy) onClose() }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="chat-action-title"
        aria-describedby="chat-action-body"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-2xl border border-line bg-surface p-6 shadow-[0_17px_50px_rgba(11,20,26,0.19)]"
      >
        <h2 id="chat-action-title" className="m-0 text-[17px] font-semibold leading-snug text-ink">{copy.title(name)}</h2>
        <p id="chat-action-body" className="m-0 mt-2 text-[13.5px] leading-relaxed text-muted">{copy.body(name)}</p>
        {error && (
          <p role="alert" className="m-0 mt-3 rounded-xl bg-tint-danger px-3 py-2 text-[13px] leading-snug text-ink">{error}</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 rounded-full border border-line px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-inbox-control disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className={`h-9 rounded-full border-0 px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60
              ${copy.danger ? 'bg-danger' : 'bg-brand'}`}
          >
            {busy ? 'Working…' : copy.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}

const ICONS = {
  clear: <><path d="M5 7h14" /><path d="M9 7V5h6v2" /><path d="M7 7l1 12h8l1-12" /><path d="M10.5 11v4.5M13.5 11v4.5" /></>,
  delete: <><path d="M4 7h16" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l.9 12.5h9.2L17.5 7" /></>,
  block: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
  unblock: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.5l2.4 2.4 4.6-5.2" /></>,
}

export function ActionIcon({ action, className = '' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      {ICONS[action]}
    </svg>
  )
}

/* The header's "more" menu. Rendered only when the person holds one of the
   two permissions, so a read-and-reply agent sees the header they had. */
export function ChatMenu({ conversation, canDelete, canBlock, onAction }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!canDelete && !canBlock) return null

  const blocked = Boolean(conversation.blocked_at)
  const blockable = blocked || canBlockNow(conversation)
  const items = [
    canDelete && { key: 'clear', label: 'Clear chat' },
    canDelete && { key: 'delete', label: 'Delete chat', danger: true },
    canBlock && (blocked
      ? { key: 'unblock', label: 'Unblock' }
      : { key: 'block', label: 'Block', danger: true, disabled: !blockable, hint: blockable ? null : 'Only within 24 hours of their last message' }),
  ].filter(Boolean)

  function choose(item) {
    if (item.disabled) return
    setOpen(false)
    onAction(item.key)
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        title="More options"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`grid h-10 w-10 place-items-center rounded-full transition-colors
          ${open ? 'bg-inbox-chip text-brand' : 'text-muted hover:bg-inbox-control hover:text-ink'}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5.5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="18.5" r="1.8" /></svg>
      </button>

      {open && (
        <>
          {/* click-away layer */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="Chat options"
            className="absolute right-0 top-[46px] z-30 w-60 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-[0_5px_16px_rgba(24,40,65,0.10)]"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                onClick={() => choose(item)}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors
                  ${item.disabled ? 'cursor-default opacity-60' : 'hover:bg-inbox-row-hover'}
                  ${item.danger ? 'text-danger' : 'text-ink'}`}
              >
                <ActionIcon action={item.key} className="mt-px" />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium leading-5">{item.label}</span>
                  {item.hint && <span className="block text-[12px] leading-snug text-muted">{item.hint}</span>}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
