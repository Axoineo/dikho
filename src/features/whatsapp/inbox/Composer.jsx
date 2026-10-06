import { useRef, useState } from 'react'
import { waApi } from '../../../lib/api'
import { sessionMsLeft, displayName } from './inboxUtils'

const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤩','🥳','👍','👎','🙏','👏','🙌','💪','🔥','✨','🎉','✅','❌','⚠️','❤️','💙','💯','🤝','🙂','😉','😅','😢','😡','🤔','👌','👋','💰','📎','📄','📷','🕒']

// Attachment menu — the CRM-relevant subset of WhatsApp's menu. Camera,
// contacts, polls etc. are omitted as not useful for a business inbox.
const ATTACH = [
  { key: 'document', label: 'Document', accept: '*/*',
    icon: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6" /> },
  { key: 'media', label: 'Photos & videos', accept: 'image/*,video/*',
    icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 16l-5-5L5 21" /></> },
]

/* The composer is CHROME: it follows the dashboard's controls — disc icon
   buttons, a pill field, brand-blue send — rather than WhatsApp's. The thread
   above it keeps the client's palette. */
export function Composer({ conversation, onSendText, onSendMedia }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(null) // 'attach' | 'emoji' | null
  const fileRef = useRef(null)
  const lastTypingRef = useRef(0)

  const msLeft = sessionMsLeft(conversation.last_inbound_at)
  const withinWindow = msLeft > 0

  // Tell Meta to show the customer a "typing…" indicator, at most once per ~12s
  // while the agent types (Meta keeps it up for ~25s per call).
  function pingTyping() {
    const now = Date.now()
    if (now - lastTypingRef.current < 12000) return
    lastTypingRef.current = now
    waApi.typing(conversation.id).catch(() => {})
  }

  // Closed window: the composer is replaced outright, at composer height, so
  // the chat keeps its shape instead of growing an amber warning strip. The
  // live countdown for the open case is a system notice on the canvas.
  if (!withinWindow) {
    return (
      <div className="m-3 flex shrink-0 items-center gap-3 rounded-2xl border border-inbox-divider bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted shadow-[0_2px_10px_rgba(16,26,44,0.08)]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></svg>
        <span className="min-w-0">
          The 24-hour reply window has closed. <b className="font-semibold text-ink">{displayName(conversation)}</b> must message first, or you can send an approved template.
        </span>
        <a
          href="/whatsapp/templates"
          className="ml-auto shrink-0 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-white no-underline transition-opacity hover:opacity-90"
        >
          Send a template
        </a>
      </div>
    )
  }

  async function submitText(e) {
    e?.preventDefault()
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try { await onSendText(body); setText('') } finally { setBusy(false) }
  }

  function pickFile(accept) {
    setMenu(null)
    if (fileRef.current) { fileRef.current.accept = accept; fileRef.current.click() }
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try { await onSendMedia(file, text.trim()); setText('') } finally { setBusy(false) }
  }

  const canSend = !busy && !!text.trim()
  const discBtn = 'grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-inbox-control hover:text-ink'

  return (
    <div className="relative shrink-0 px-3 pb-3 pt-1.5">
      {/* click-away layer for popovers */}
      {menu && <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />}

      {menu === 'attach' && (
        <div className="absolute bottom-[64px] left-4 z-20 w-56 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-[0_5px_16px_rgba(24,40,65,0.10)]">
          {ATTACH.map((a) => (
            <button key={a.key} type="button" onClick={() => pickFile(a.accept)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-medium text-ink transition-colors hover:bg-inbox-row-hover">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-inbox-chip text-brand">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{a.icon}</svg>
              </span>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {menu === 'emoji' && (
        <div className="absolute bottom-[64px] left-4 z-20 grid w-[17rem] grid-cols-8 gap-1 rounded-2xl border border-line bg-surface p-2 shadow-[0_5px_16px_rgba(24,40,65,0.10)]">
          {EMOJIS.map((em) => (
            <button key={em} type="button" onClick={() => setText((t) => t + em)}
              className="rounded-lg p-1 text-xl transition-colors hover:bg-inbox-row-hover">{em}</button>
          ))}
        </div>
      )}

      {/* One rounded bar floating on the canvas — controls inside it, nothing
          spanning the full width. */}
      <form
        onSubmit={submitText}
        className="flex items-end gap-1 rounded-[24px] border border-inbox-divider bg-surface px-1.5 py-1.5 shadow-[0_2px_10px_rgba(16,26,44,0.08)]"
      >
        {/* The types WhatsApp accepts; the API enforces the same list and the
            per-type size limits (src/api/routes/whatsapp/conversations.js). */}
        <input ref={fileRef} type="file" className="hidden" onChange={onFile}
          accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg,text/plain,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" />

        <button type="button" title="Emoji" aria-label="Insert emoji" aria-expanded={menu === 'emoji'}
          onClick={() => setMenu(menu === 'emoji' ? null : 'emoji')}
          className={`${discBtn} ${menu === 'emoji' ? 'bg-inbox-control text-ink' : ''}`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" strokeLinecap="round" /><circle cx="9" cy="10" r="0.7" fill="currentColor" /><circle cx="15" cy="10" r="0.7" fill="currentColor" /></svg>
        </button>

        <button type="button" title="Attach" aria-label="Attach a file" aria-expanded={menu === 'attach'}
          onClick={() => setMenu(menu === 'attach' ? null : 'attach')}
          className={`${discBtn} ${menu === 'attach' ? 'bg-inbox-control text-ink' : ''}`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.05l-8.49 8.49a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78" /></svg>
        </button>

        <textarea
          rows={1}
          value={text}
          disabled={busy}
          onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) pingTyping() }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitText() } }}
          placeholder="Type a message"
          aria-label="Message"
          className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-[8px] text-[14px] leading-5 text-ink outline-none placeholder:text-muted"
        />

        {/* Filled brand disc once there is something to send — the dashboard's
            own primary-action shape, rather than the client's bare glyph. */}
        <button type="submit" disabled={!canSend} title="Send" aria-label="Send message"
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-all
            ${canSend
              ? 'bg-brand text-white hover:opacity-90'
              : 'cursor-default text-muted opacity-50'}`}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-8.06a.5.5 0 0 0 0-.9L3.4 3.38a.5.5 0 0 0-.7.58L4.6 11 2.7 19.82a.5.5 0 0 0 .7.58z" /></svg>
        </button>
      </form>
    </div>
  )
}
