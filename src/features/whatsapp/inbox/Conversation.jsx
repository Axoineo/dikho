import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'
import { Avatar } from './Avatar'
import { displayName, formatDaySeparator, parseWaDate, sessionMsLeft, formatCountdown } from './inboxUtils'

// Subtle chat wallpaper (tiny inline SVG so nothing loads cross-origin).
const WALLPAPER =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cg fill='%23000' fill-opacity='0.02'%3E%3Ccircle cx='10' cy='10' r='1.5'/%3E%3Ccircle cx='30' cy='30' r='1.5'/%3E%3C/g%3E%3C/svg%3E\")"

// Inserts a day separator before the first message of each calendar day.
function withDaySeparators(messages) {
  const out = []
  let lastDay = null
  for (const m of messages) {
    const d = parseWaDate(m.wa_timestamp || m.created_at)
    const key = d ? d.toDateString() : ''
    if (key !== lastDay) { out.push({ separator: true, id: `sep-${key}`, at: m.wa_timestamp || m.created_at }); lastDay = key }
    out.push(m)
  }
  return out
}

function SessionChip({ conversation }) {
  const msLeft = sessionMsLeft(conversation.last_inbound_at)
  if (msLeft > 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Active · {formatCountdown(msLeft)} left
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-amber-500/12 px-2.5 py-1 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Session closed · templates only
    </span>
  )
}

export function Conversation({ conversation, messages, loading, onSendText, onSendMedia, onOpenMedia, onUploadAvatar }) {
  const endRef = useRef(null)
  const avatarInput = useRef(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length, conversation?.id])

  const rows = useMemo(() => (conversation ? withDaySeparators(messages) : []), [messages, conversation])

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#f0f2f5] text-center text-gray-500 dark:bg-[#0b141a]">
        <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-[#185494]/10 text-[#185494] dark:bg-white/5">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
        </div>
        <p className="text-[15px] font-medium text-gray-600 dark:text-gray-300">Dikho WhatsApp Inbox</p>
        <p className="mt-1 text-[13px]">Select a conversation to start chatting</p>
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

  return (
    <div className="flex h-full flex-col bg-[#efeae2] dark:bg-[#0b141a]">
      {/* Header */}
      <div className="z-10 flex items-center gap-3 border-b border-black/10 bg-[#f0f2f5] px-4 py-2 dark:border-white/10 dark:bg-[#202c33]">
        <div className="relative">
          <Avatar name={conversation.wa_name || conversation.contact_name} phone={conversation.phone} avatarUrl={conversation.avatar_url} size={40} />
          <button
            type="button"
            title="Set photo"
            onClick={() => avatarInput.current?.click()}
            className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#f0f2f5] bg-[#185494] text-white dark:border-[#202c33]"
          >
            {uploading
              ? <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>}
          </button>
          <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={onAvatarFile} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-gray-900 dark:text-white">{displayName(conversation)}</div>
          <div className="truncate text-[12px] text-gray-500 dark:text-gray-400">+{conversation.phone}</div>
        </div>

        <SessionChip conversation={conversation} />
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto py-3" style={{ backgroundImage: WALLPAPER }}>
        {loading && messages.length === 0 && <div className="p-4 text-center text-sm text-gray-500">Loading messages…</div>}
        {rows.map((row) =>
          row.separator ? (
            <div key={row.id} className="flex justify-center py-2">
              <span className="rounded-md bg-white/80 px-3 py-1 text-[11.5px] font-medium text-gray-500 shadow-sm dark:bg-[#182229] dark:text-gray-300">
                {formatDaySeparator(row.at)}
              </span>
            </div>
          ) : (
            <MessageBubble key={row.id ?? row.meta_message_id} message={row} onOpenMedia={onOpenMedia} />
          ),
        )}
        <div ref={endRef} />
      </div>

      <Composer conversation={conversation} onSendText={onSendText} onSendMedia={onSendMedia} />
    </div>
  )
}
