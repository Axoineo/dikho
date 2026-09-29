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

/* Same delivery states the thread shows, at list scale: one check sent, two
   delivered, two blue read. Without this the row drew a fixed grey double
   check on every outbound conversation, which claimed "delivered" even for a
   message that had only just been queued — or had failed outright. */
function RowTicks({ status }) {
  if (status === 'failed') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" className="shrink-0 text-danger" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.4h.01" />
      </svg>
    )
  }
  if (status === 'read' || status === 'delivered') {
    return (
      <svg viewBox="0 0 20 12" width="15" height="10"
        className={`shrink-0 ${status === 'read' ? 'text-chat-tick' : ''}`}
        fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 6.6l3.1 3.1L10.4 3.2" /><path d="M8.2 9.7L14.9 3.2" />
      </svg>
    )
  }
  if (status === 'sent' || status === 'queued') {
    return (
      <svg viewBox="0 0 12 12" width="11" height="10" className="shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 6.5l3.2 3.2L11 3" />
      </svg>
    )
  }
  // No status at all — an API that predates last_message_status being derived.
  // Falls back to the neutral double check this row drew before, rather than
  // asserting "sent" and downgrading every delivered message on a stale API.
  return (
    <svg viewBox="0 0 20 12" width="15" height="10" className="shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 6.6l3.1 3.1L10.4 3.2" /><path d="M8.2 9.7L14.9 3.2" />
    </svg>
  )
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

/* The conversation list is CHROME, not thread, so it follows the dashboard:
   rounded rows on a surface fill, brand-tinted selection, the rail's own
   hover/active alphas. The thread opposite it keeps WhatsApp's palette. */
export function ChatList({ conversations, activeId, onSelect, loading, error, onRetry }) {
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
    <div className="flex h-full flex-col bg-inbox-list">
      {/* Header — same 64px as the thread header opposite, so the two bars
          line up across the divider. */}
      <header className="flex h-16 shrink-0 items-center justify-between px-5">
        <h1 className="text-[17px] font-semibold tracking-[-0.2px] text-ink">Inbox</h1>
        {unreadTotal > 0 && (
          <span className="rounded-full bg-brand px-2 py-[3px] text-[11.5px] font-bold leading-none text-white">
            {unreadTotal}
          </span>
        )}
      </header>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex h-10 items-center rounded-full bg-surface transition-shadow focus-within:ring-2 focus-within:ring-inbox-focus">
          <span className="grid w-10 shrink-0 place-items-center text-muted">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, number or message"
            aria-label="Search conversations"
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-inbox-control hover:text-ink"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Segmented control, not two loose buttons: a shared track makes it read
          as one either/or choice, and the raised thumb shows which side is
          live. */}
      <div className="px-3 pb-2.5">
        <div role="tablist" aria-label="Filter conversations" className="inline-flex rounded-full bg-surface p-[3px]">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`h-7 rounded-full px-3.5 text-[12.5px] transition-all
                ${filter === f.key
                  ? 'bg-inbox-chip font-semibold text-brand'
                  : 'font-medium text-muted hover:text-ink'}`}
            >
              {f.label}{f.key === 'unread' && unreadTotal > 0 ? ` ${unreadTotal}` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="inbox-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading && conversations.length === 0 && (
          <p className="px-3 py-4 text-[13px] text-muted">Loading conversations…</p>
        )}

        {/* A failed load is NOT an empty inbox, and must not read like one. */}
        {!loading && error && conversations.length === 0 && (
          <div className="mx-1 mt-2 rounded-2xl bg-tint-danger px-4 py-4 text-center">
            <p className="text-[13px] font-semibold text-ink">Couldn&rsquo;t load conversations</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-full bg-brand px-4 py-1.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && shown.length === 0 && (
          <p className="px-5 py-10 text-center text-[13px] leading-relaxed text-muted">
            {conversations.length === 0
              ? 'No conversations yet \u2014 they\u2019ll appear here as soon as a customer messages your number.'
              : 'No conversations match your search.'}
          </p>
        )}

        {shown.map((conv) => {
          const active = conv.id === activeId
          const unread = conv.unread_count > 0
          const preview = decodePreview(conv)
          return (
            <button
              key={conv.id}
              type="button"
              onClick={() => onSelect(conv)}
              aria-current={active ? 'true' : undefined}
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors
                ${active ? 'bg-inbox-row-active' : 'hover:bg-inbox-row-hover'}`}
            >
              <Avatar name={conv.wa_name || conv.contact_name} phone={conv.phone} avatarUrl={conv.avatar_url} size={44} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2.5">
                  <span className={`truncate text-[14.5px] ${unread || active ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>
                    {displayName(conv)}
                  </span>
                  <span className={`shrink-0 text-[11.5px] tabular-nums ${unread ? 'font-semibold text-brand' : 'text-muted'}`}>
                    {formatListTime(conv.last_message_at)}
                  </span>
                </span>
                <span className="mt-[3px] flex items-center justify-between gap-2.5">
                  <span className="flex min-w-0 items-center gap-1 text-[12.8px] text-muted">
                    {conv.last_message_direction === 'outbound' && (
                      <RowTicks status={conv.last_message_status} />
                    )}
                    {preview.glyph && (
                      <svg width="12.5" height="12.5" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">{preview.glyph}</svg>
                    )}
                    <span className="truncate">{preview.text}</span>
                  </span>
                  {unread && (
                    <span className="ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold leading-none text-white">
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
