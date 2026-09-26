import { useMemo, useState } from 'react'
import { Avatar } from './Avatar'
import { formatListTime, displayName } from './inboxUtils'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
]

export function ChatList({ conversations, activeId, onSelect, loading }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations.filter((c) => {
      if (filter === 'unread' && !(c.unread_count > 0)) return false
      if (!q) return true
      return (
        (c.wa_name || '').toLowerCase().includes(q) ||
        (c.contact_name || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.last_message_preview || '').toLowerCase().includes(q)
      )
    })
  }, [conversations, query, filter])

  const unreadTotal = conversations.filter((c) => c.unread_count > 0).length

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="px-4 pb-2 pt-2">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-chat-canvas px-3 py-2 focus-within:border-brand">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, number or message"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted dark:text-white"
          />
          {query && <button onClick={() => setQuery('')} className="text-muted hover:text-ink" title="Clear">✕</button>}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 px-4 pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors
              ${filter === f.key
                ? 'bg-brand text-white'
                : 'bg-line-soft text-muted hover:bg-line'}`}
          >
            {f.label}{f.key === 'unread' && unreadTotal > 0 ? ` ${unreadTotal}` : ''}
          </button>
        ))}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading && conversations.length === 0 && <div className="p-4 text-sm text-muted">Loading conversations…</div>}
        {!loading && shown.length === 0 && (
          <div className="p-6 text-center text-sm text-muted">
            {conversations.length === 0
              ? 'No conversations yet. They appear here when a customer messages your number.'
              : 'No conversations match.'}
          </div>
        )}

        {shown.map((conv) => {
          const active = conv.id === activeId
          const unread = conv.unread_count > 0
          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv)}
              className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors
                ${active ? 'bg-brand-soft' : 'hover:bg-line-soft'}`}
            >
              {active && <span className="absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-brand" />}
              <Avatar name={conv.wa_name || conv.contact_name} phone={conv.phone} avatarUrl={conv.avatar_url} size={46} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-[14.5px] ${unread ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>
                    {displayName(conv)}
                  </span>
                  <span className={`shrink-0 text-[11px] ${unread ? 'font-semibold text-brand dark:text-[#5ba0e0]' : 'text-muted'}`}>
                    {formatListTime(conv.last_message_at)}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1 text-[12.5px] text-muted">
                    {conv.last_message_direction === 'outbound' && (
                      <svg viewBox="0 0 18 12" width="14" height="9" className="shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6.5l3.2 3.2L11 3" /><path d="M6.5 9.5L13.2 3" /></svg>
                    )}
                    <span className="truncate">{conv.last_message_preview || ''}</span>
                  </span>
                  {unread && (
                    <span className="ml-auto flex h-[19px] min-w-[19px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-bold text-white">
                      {conv.unread_count}
                    </span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
