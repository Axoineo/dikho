import { useRef, useState } from 'react'
import { waApi } from '../../../lib/api'
import { sessionMsLeft, formatCountdown, displayName } from './inboxUtils'

const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤩','🥳','👍','👎','🙏','👏','🙌','💪','🔥','✨','🎉','✅','❌','⚠️','❤️','💙','💯','🤝','🙂','😉','😅','😢','😡','🤔','👌','👋','💰','📎','📄','📷','🕒']

// Attachment menu — the CRM-relevant subset of WhatsApp's menu (img1). Camera,
// contacts, polls etc. are omitted as not useful for a business inbox.
const ATTACH = [
  { key: 'document', label: 'Document', accept: '*/*', color: '#7c5cfc',
    icon: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6" /> },
  { key: 'media', label: 'Photos & videos', accept: 'image/*,video/*', color: '#0aa5e0',
    icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 16l-5-5L5 21" /></> },
]

export function Composer({ conversation, onSendText, onSendMedia }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(null) // 'attach' | 'emoji' | null
  const fileRef = useRef(null)
  const acceptRef = useRef('*/*')
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

  if (!withinWindow) {
    return (
      <div className="border-t border-black/10 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800 dark:border-white/10 dark:bg-amber-950/40 dark:text-amber-200">
        ⏳ The 24-hour messaging window has closed. You can only send a pre-approved{' '}
        <b>Template</b> until {displayName(conversation)} replies again.
        <a href="/whatsapp/templates" className="ml-1 font-semibold underline">Open Templates →</a>
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
    acceptRef.current = accept
    setMenu(null)
    // set accept then open
    if (fileRef.current) { fileRef.current.accept = accept; fileRef.current.click() }
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try { await onSendMedia(file, text.trim()); setText('') } finally { setBusy(false) }
  }

  return (
    <div className="relative border-t border-black/10 bg-[#f0f2f5] dark:border-white/10 dark:bg-[#202c33]">
      {/* low-session warning strip */}
      {msLeft < 60 * 60 * 1000 && (
        <div className="px-4 pt-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
          ⏳ Session closes in {formatCountdown(msLeft)} — free-form replies disabled after that.
        </div>
      )}

      {/* click-away layer for popovers */}
      {menu && <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />}

      {/* attachment menu */}
      {menu === 'attach' && (
        <div className="absolute bottom-16 left-3 z-20 w-56 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-[#233138]">
          {ATTACH.map((a) => (
            <button key={a.key} type="button" onClick={() => pickFile(a.accept)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] text-gray-800 hover:bg-black/5 dark:text-gray-100 dark:hover:bg-white/5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ backgroundColor: a.color }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{a.icon}</svg>
              </span>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* emoji popover */}
      {menu === 'emoji' && (
        <div className="absolute bottom-16 left-3 z-20 grid w-64 grid-cols-8 gap-1 rounded-xl border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#233138]">
          {EMOJIS.map((em) => (
            <button key={em} type="button" onClick={() => { setText((t) => t + em); }}
              className="rounded p-1 text-xl hover:bg-black/5 dark:hover:bg-white/10">{em}</button>
          ))}
        </div>
      )}

      <form onSubmit={submitText} className="flex items-end gap-1.5 px-3 py-2">
        <input ref={fileRef} type="file" className="hidden" onChange={onFile} />

        <button type="button" title="Emoji" onClick={() => setMenu(menu === 'emoji' ? null : 'emoji')}
          className="shrink-0 rounded-full p-2 text-gray-500 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" strokeLinecap="round" /><circle cx="9" cy="10" r="0.6" fill="currentColor" /><circle cx="15" cy="10" r="0.6" fill="currentColor" /></svg>
        </button>

        <button type="button" title="Attach" onClick={() => setMenu(menu === 'attach' ? null : 'attach')}
          className="shrink-0 rounded-full p-2 text-gray-500 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.05l-8.49 8.49a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78" /></svg>
        </button>

        <textarea
          rows={1}
          value={text}
          disabled={busy}
          onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) pingTyping() }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitText() } }}
          placeholder="Type a message"
          className="max-h-32 flex-1 resize-none rounded-lg border-0 bg-white px-3 py-2.5 text-[14px] outline-none placeholder:text-gray-400 dark:bg-[#2a3942] dark:text-white"
        />

        <button type="submit" disabled={busy || !text.trim()} title="Send"
          className="shrink-0 rounded-full bg-[#185494] p-2.5 text-white transition-opacity disabled:opacity-40">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-8.06a.5.5 0 0 0 0-.9L3.4 3.38a.5.5 0 0 0-.7.58L4.6 11 2.7 19.82a.5.5 0 0 0 .7.58z" /></svg>
        </button>
      </form>
    </div>
  )
}
