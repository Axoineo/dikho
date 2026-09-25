import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'
import { Avatar } from './Avatar'
import { displayName, formatDaySeparator, parseWaDate, sessionMsLeft, formatCountdown } from './inboxUtils'

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

function HeaderStatus({ conversation }) {
  const msLeft = sessionMsLeft(conversation.last_inbound_at)
  if (msLeft > 0) {
    return (
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active · {formatCountdown(msLeft)} left
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-medium text-amber-600 dark:text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Session closed · templates only
    </span>
  )
}

export function Conversation({ conversation, messages, loading, onSendText, onSendMedia, onOpenMedia, onUploadAvatar, infoOpen, onToggleInfo }) {
  const endRef = useRef(null)
  const avatarInput = useRef(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length, conversation?.id])

  const rows = useMemo(() => (conversation ? withDaySeparators(messages) : []), [messages, conversation])

  if (!conversation) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center bg-[#f5f6f8] text-center dark:bg-[#0b141a]">
        <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-white text-[#185494] shadow-sm dark:bg-white/5">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
        </div>
        <p className="text-[16px] font-semibold text-gray-700 dark:text-gray-200">Dikho WhatsApp Inbox</p>
        <p className="mt-1 max-w-xs text-[13.5px] text-gray-500">Select a conversation from the left to view the thread and reply.</p>
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
    <div className="flex h-full flex-1 flex-col bg-[#f5f6f8] dark:bg-[#0b141a]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-black/[0.07] bg-white px-5 py-3 dark:border-white/[0.08] dark:bg-[#0f1a20]">
        <div className="relative">
          <Avatar name={conversation.wa_name || conversation.contact_name} phone={conversation.phone} avatarUrl={conversation.avatar_url} size={42} />
          <button
            type="button"
            title="Set photo"
            onClick={() => avatarInput.current?.click()}
            className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[#185494] text-white dark:border-[#0f1a20]"
          >
            {uploading
              ? <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>}
          </button>
          <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={onAvatarFile} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[15.5px] font-semibold leading-tight text-gray-900 dark:text-white">{displayName(conversation)}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-gray-500 dark:text-gray-400">
            <span className="truncate">+{conversation.phone}</span>
            <span className="text-gray-300 dark:text-gray-600">•</span>
            <HeaderStatus conversation={conversation} />
          </div>
        </div>

        <button
          type="button"
          title={infoOpen ? 'Hide details' : 'Show details'}
          onClick={onToggleInfo}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors
            ${infoOpen ? 'bg-[#185494]/10 text-[#185494] dark:bg-[#185494]/25 dark:text-[#7cb2ea]' : 'text-gray-400 hover:bg-black/5 dark:hover:bg-white/10'}`}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" strokeLinecap="round" /><circle cx="12" cy="8" r="0.6" fill="currentColor" /></svg>
        </button>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-2 py-4 sm:px-4">
        {loading && messages.length === 0 && <div className="p-4 text-center text-sm text-gray-500">Loading messages…</div>}
        {rows.map((row) =>
          row.separator ? (
            <div key={row.id} className="flex justify-center py-3">
              <span className="rounded-full border border-black/5 bg-white px-3 py-1 text-[11.5px] font-medium text-gray-500 shadow-sm dark:border-white/10 dark:bg-[#182229] dark:text-gray-300">
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
