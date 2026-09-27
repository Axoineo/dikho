import { useMemo, useState } from 'react'
import { Avatar } from './Avatar'
import { formatListTime, displayName } from './inboxUtils'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
]

// The list row has no message type of its own to read — `conversations` only
// stores `last_message_preview` — but the webhook writes a recognisable stand-in
// ("📎 image") whenever a media message arrives without a caption, and a
// bracketed token ("[interactive]") for any type it could not parse. Decoding
// those here gives the row a glyph and readable text with no schema change.
const MEDIA_PREVIEW = /^📎\s*([a-z]+)$/i
const PLACEHOLDER_PREVIEW = /^\[([a-z_\- ]{1,40})\]$/i

const MEDIA_LABEL = {
  image: 'Photo', video: 'Video', audio: 'Voice message',
  document: 'Document', sticker: 'Sticker',
}

const GLYPHS = {
  image: <path d="M21 5H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zm-1 12H4l4.5-6 3 4 3-2.5L20 17z" />,
  video: <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />,
  audio: <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm6-3a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.93V22h2v-2.07A8 8 0 0 0 20 12h-2z" />,
  document: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6zm0 2.5L18.5 10H14V5.5z" />,
  sticker: <path d="M12 2a10 10 0 1 0 10 10h-6a4 4 0 0 1-4-4V2z" />,
}

// Returns { text, glyph } for one conversation's list row.
function decodePreview(conv) {
  const raw = (conv.last_message_preview || '').trim()

  const media = raw.match(MEDIA_PREVIEW)
  if (media) {
    const key = media[1].toLowerCase()
    return { text: MEDIA_LABEL[key] || key, glyph: GLYPHS[key] || GLYPHS.document }
  }

  const placeholder = raw.match(PLACEHOLDER_PREVIEW)
  if (placeholder) {
    const key = placeholder[1].toLowerCase()
    if (key === 'interactive' || key === 'button') return { text: 'Tapped a button', glyph: null }
    return { text: `${key.charAt(0).toUpperCase()}${key.slice(1)} message`, glyph: null }
  }

  return { text: raw, glyph: null }
}

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
    <div className="flex h-full flex-col bg-chat-shell">
      {/* Panel bar — same height and fill as the chat header opposite it. */}
      <header className="flex h-[59px] shrink-0 items-center justify-between bg-chat-bar px-5">
        <h1 className="text-[19px] font-semibold tracking-tight text-chat-text">Inbox</h1>
        {unreadTotal > 0 && (
          <span className="rounded-full bg-chat-accent px-2 py-0.5 text-[12px] font-semibold text-chat-on-accent">
            {unreadTotal}
          </span>
        )}
      </header>

      {/* Search */}
      <div className="px-3 py-[7px]">
        <div className="flex h-[35px] items-center rounded-lg bg-chat-bar focus-within:ring-1 focus-within:ring-chat-accent">
          <span className="grid w-12 shrink-0 place-items-center text-chat-sub">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, number or message"
            className="w-full bg-transparent pr-3 text-[14px] text-chat-text outline-none placeholder:text-chat-sub"
          />
          {query && <button onClick={() => setQuery('')} className="pr-3 text-chat-sub hover:text-chat-text" title="Clear">✕</button>}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 px-3 pb-2.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`h-[30px] rounded-full px-[13px] text-[13.5px] transition-colors
              ${filter === f.key
                ? 'bg-chat-chip font-medium text-chat-accent-ink'
                : 'bg-chat-bar text-chat-sub hover:brightness-95'}`}
          >
            {f.label}{f.key === 'unread' && unreadTotal > 0 ? ` ${unreadTotal}` : ''}
          </button>
        ))}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {loading && conversations.length === 0 && <div className="p-4 text-sm text-chat-sub">Loading conversations…</div>}
        {!loading && shown.length === 0 && (
          <div className="p-6 text-center text-sm text-chat-sub">
            {conversations.length === 0
              ? 'No conversations yet. They appear here when a customer messages your number.'
              : 'No conversations match.'}
          </div>
        )}

        {shown.map((conv) => {
          const active = conv.id === activeId
          const unread = conv.unread_count > 0
          const preview = decodePreview(conv)
          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv)}
              aria-current={active}
              className={`relative flex h-[72px] w-full items-center gap-[15px] px-[15px] text-left transition-colors
                ${active ? 'bg-chat-row-active' : 'hover:bg-chat-row-hover'}`}
            >
              <Avatar name={conv.wa_name || conv.contact_name} phone={conv.phone} avatarUrl={conv.avatar_url} size={49} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2.5">
                  <span className="truncate text-[17px] font-normal text-chat-text">
                    {displayName(conv)}
                  </span>
                  <span className={`shrink-0 text-[12px] tabular-nums ${unread ? 'text-chat-accent-ink' : 'text-chat-sub'}`}>
                    {formatListTime(conv.last_message_at)}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2.5">
                  <span className="flex min-w-0 items-center gap-1 text-[14px] text-chat-sub">
                    {conv.last_message_direction === 'outbound' && (
                      <svg viewBox="0 0 18 12" width="15" height="10" className="shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6.5l3.2 3.2L11 3" /><path d="M6.2 9.7L12.9 3" /></svg>
                    )}
                    {preview.glyph && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">{preview.glyph}</svg>
                    )}
                    <span className="truncate">{preview.text}</span>
                  </span>
                  {unread && (
                    <span className="ml-auto flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-chat-accent px-1.5 text-[12px] font-medium leading-none text-chat-on-accent">
                      {conv.unread_count}
                    </span>
                  )}
                </span>
              </span>
              {/* Inset hairline, starting past the avatar as the client does. */}
              <span className="pointer-events-none absolute bottom-0 left-[79px] right-0 h-px bg-chat-ring" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
