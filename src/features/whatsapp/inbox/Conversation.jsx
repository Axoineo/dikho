import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'
import { Avatar } from './Avatar'
import { displayName, formatDaySeparator, parseWaDate, sessionMsLeft, formatCountdown } from './inboxUtils'

// Day separators plus run detection: a bubble starts a new run (and so gets a
// tail and a wider gap) when the direction changes or a day break intervenes.
function buildRows(messages) {
  const out = []
  let lastDay = null
  let lastDirection = null
  for (const m of messages) {
    const d = parseWaDate(m.wa_timestamp || m.created_at)
    const key = d ? d.toDateString() : ''
    if (key !== lastDay) {
      out.push({ separator: true, id: `sep-${key}`, at: m.wa_timestamp || m.created_at })
      lastDay = key
      lastDirection = null
    }
    out.push({ ...m, grouped: m.direction !== lastDirection })
    lastDirection = m.direction
  }
  return out
}

export function Conversation({ conversation, messages, loading, onSendText, onSendMedia, onOpenMedia, onUploadAvatar, infoOpen, onToggleInfo }) {
  const endRef = useRef(null)
  const avatarInput = useRef(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length, conversation?.id])

  const rows = useMemo(() => (conversation ? buildRows(messages) : []), [messages, conversation])

  if (!conversation) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center bg-chat-canvas text-center">
        <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-chat-raised text-chat-accent shadow-sm">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
        </div>
        <p className="text-[16px] font-semibold text-chat-text">Dikho WhatsApp Inbox</p>
        <p className="mt-1 max-w-xs text-[13.5px] text-chat-sub">Select a conversation from the left to view the thread and reply.</p>
      </div>
    )
  }

  async function onAvatarFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try { await onUploadAvatar(conversation, file) } finally { setUploading(false) }
  }

  const msLeft = sessionMsLeft(conversation.last_inbound_at)

  return (
    <div className="flex h-full flex-1 flex-col bg-chat-canvas">
      {/* Header */}
      <div className="flex h-[59px] shrink-0 items-center gap-[15px] border-l border-chat-ring bg-chat-bar px-4">
        <div className="relative">
          <Avatar name={conversation.wa_name || conversation.contact_name} phone={conversation.phone} avatarUrl={conversation.avatar_url} size={40} />
          <button
            type="button"
            title="Set photo"
            onClick={() => avatarInput.current?.click()}
            className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-chat-bar bg-chat-accent text-white"
          >
            {uploading
              ? <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>}
          </button>
          <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={onAvatarFile} />
        </div>

        <button type="button" onClick={onToggleInfo} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[16px] font-normal leading-tight text-chat-text">{displayName(conversation)}</div>
          <div className="truncate text-[13px] text-chat-sub">+{conversation.phone}</div>
        </button>

        <button
          type="button"
          title={infoOpen ? 'Hide details' : 'Show details'}
          onClick={onToggleInfo}
          className="flex h-10 w-10 items-center justify-center rounded-full text-chat-sub transition-colors hover:bg-chat-ring"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="8" r="0.6" fill="currentColor" /></svg>
        </button>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-2 py-3 sm:px-[6.5%]">
        {loading && messages.length === 0 && <div className="p-4 text-center text-sm text-chat-sub">Loading messages…</div>}
        {rows.map((row) =>
          row.separator ? (
            <div key={row.id} className="flex justify-center py-3">
              <span className="rounded-bubble bg-chat-raised px-3 py-[5px] text-[12.5px] uppercase tracking-[.2px] text-chat-sub shadow-bubble">
                {formatDaySeparator(row.at)}
              </span>
            </div>
          ) : (
            <MessageBubble key={row.id ?? row.meta_message_id} message={row} grouped={row.grouped} onOpenMedia={onOpenMedia} />
          ),
        )}

        {/* The 24-hour window has no WhatsApp equivalent, so it goes where the
            client puts its own system notices — centred on the canvas — rather
            than as dashboard chrome bolted to the header. Sits last so it
            stays in view: the thread auto-scrolls to the end. */}
        {msLeft > 0 && (
          <div className="flex justify-center py-3">
            <span className="max-w-[78%] rounded-bubble bg-chat-raised px-3 py-[5px] text-center text-[12.5px] leading-relaxed text-chat-sub shadow-bubble">
              Replies are open for <b className="font-semibold text-chat-text">{formatCountdown(msLeft)}</b>. After that, only approved templates can be sent.
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <Composer conversation={conversation} onSendText={onSendText} onSendMedia={onSendMedia} />
    </div>
  )
}
