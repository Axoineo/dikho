import { useRef, useState } from 'react'

const SESSION_MS = 24 * 60 * 60 * 1000

// Bottom input for the active thread. Enforces Meta's 24-hour customer service
// window: once it has been more than 24h since the customer's last inbound
// message, free-form messaging is disabled and only a template can be sent. This
// mirrors the server-side guard in the conversations route — the UI copy just
// makes the rule visible instead of surfacing a 409 after the fact.
export function Composer({ conversation, onSendText, onSendMedia, disabled }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const lastInbound = conversation.last_inbound_at
    ? new Date(conversation.last_inbound_at.includes('T')
        ? conversation.last_inbound_at
        : `${conversation.last_inbound_at.replace(' ', 'T')}Z`).getTime()
    : 0
  const withinWindow = lastInbound > 0 && Date.now() - lastInbound < SESSION_MS

  if (!withinWindow) {
    return (
      <div className="border-t border-black/10 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800 dark:border-white/10 dark:bg-amber-950/40 dark:text-amber-200">
        ⏳ The 24-hour messaging window has closed. You can only send a
        pre-approved <b>Template</b> until {conversation.wa_name || conversation.contact_name || 'the customer'} replies again.
        <a href="/whatsapp/templates" className="ml-1 font-semibold underline">Open Templates →</a>
      </div>
    )
  }

  async function submitText(e) {
    e?.preventDefault()
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await onSendText(body)
      setText('')
    } finally {
      setBusy(false)
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setBusy(true)
    try {
      await onSendMedia(file, text.trim())
      setText('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submitText}
      className="flex items-end gap-2 border-t border-black/10 bg-[#f0f2f5] px-3 py-2 dark:border-white/10 dark:bg-[#202c33]"
    >
      <button
        type="button"
        title="Attach"
        disabled={disabled || busy}
        onClick={() => fileRef.current?.click()}
        className="shrink-0 rounded-full p-2 text-gray-500 hover:bg-black/5 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-white/10"
      >
        📎
      </button>
      <input ref={fileRef} type="file" className="hidden" onChange={onFile} />

      <textarea
        rows={1}
        value={text}
        disabled={disabled || busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submitText()
          }
        }}
        placeholder="Type a message"
        className="max-h-32 flex-1 resize-none rounded-lg border-0 bg-white px-3 py-2 text-[14px] outline-none dark:bg-[#2a3942] dark:text-white"
      />

      <button
        type="submit"
        disabled={disabled || busy || !text.trim()}
        className="shrink-0 rounded-full bg-[#25d366] p-2 text-white disabled:opacity-40"
        title="Send"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.5l18-8.5L3 3.5 3 10l13 2-13 2z" /></svg>
      </button>
    </form>
  )
}
