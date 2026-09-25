function initials(name, phone) {
  const src = (name || '').trim()
  if (src) return src.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (phone || '?').slice(-2)
}

function relativeTime(iso) {
  if (!iso) return ''
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' })
}

// Left pane. Conversations arrive pre-sorted by last_message_at from the API and
// are kept sorted by the parent as realtime events bump them to the top.
export function ChatList({ conversations, activeId, onSelect, loading }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {loading && conversations.length === 0 && (
        <div className="p-4 text-sm text-gray-500">Loading conversations…</div>
      )}
      {!loading && conversations.length === 0 && (
        <div className="p-4 text-sm text-gray-500">No conversations yet. They appear here when a customer messages your number.</div>
      )}

      {conversations.map((conv) => {
        const name = conv.wa_name || conv.contact_name || conv.phone
        const active = conv.id === activeId
        const unread = conv.unread_count > 0
        return (
          <button
            key={conv.id}
            onClick={() => onSelect(conv)}
            className={`flex w-full items-center gap-3 border-b border-black/5 px-3 py-3 text-left transition-colors
              dark:border-white/5
              ${active ? 'bg-[#185494]/[0.06] dark:bg-white/[0.06]' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'}`}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#185494]/10 text-[13px] font-semibold text-[#185494] dark:bg-white/10 dark:text-[#5ba0e0]">
              {initials(conv.wa_name || conv.contact_name, conv.phone)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className={`truncate text-[14px] ${unread ? 'font-semibold text-gray-900 dark:text-white' : 'font-medium text-gray-800 dark:text-gray-100'}`}>
                  {name}
                </span>
                <span className={`shrink-0 text-[11px] ${unread ? 'text-[#25d366]' : 'text-gray-400'}`}>
                  {relativeTime(conv.last_message_at)}
                </span>
              </span>
              <span className="mt-0.5 flex items-center justify-between gap-2">
                <span className="truncate text-[12.5px] text-gray-500 dark:text-gray-400">
                  {conv.last_message_direction === 'outbound' ? '↩ ' : ''}{conv.last_message_preview || ''}
                </span>
                {unread && (
                  <span className="ml-auto flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#25d366] px-1.5 text-[11px] font-bold text-white">
                    {conv.unread_count}
                  </span>
                )}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
