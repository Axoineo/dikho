import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'
import { Avatar } from './Avatar'
import { ChatMenu } from './ChatActions'
import { displayName, formatDaySeparator, parseWaDate, sessionMsLeft, formatCountdown } from './inboxUtils'
import { useAccess } from '../../../lib/access'

// Day chips and system notices on the wallpaper.
const CANVAS_CHIP = 'rounded-bubble bg-chat-raised px-3 py-[5px] text-[12.5px] text-chat-sub shadow-bubble'

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

/* Header and empty state are CHROME and follow the dashboard. Everything from
   the canvas down — bubbles, tails, day chips, system notices — stays on the
   --chat-* palette, because that is the part agents read all day. */
export function Conversation({ conversation, messages, loading, onSendText, onSendMedia, onOpenMedia, onUploadAvatar, infoOpen, onToggleInfo, onChatAction }) {
  const { can } = useAccess()
  const canReply = can('inbox.reply')
  const canBlock = can('inbox.block')
  const endRef = useRef(null)
  const scrollRef = useRef(null)
  const avatarInput = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState(null)   // null = closed, '' = open+empty
  const [atBottom, setAtBottom] = useState(true)

  // Auto-scroll only when already parked at the end. Yanking an agent back
  // down mid-scroll while a new message lands is how you lose your place in a
  // thread you were reading.
  useEffect(() => {
    if (atBottom) endRef.current?.scrollIntoView({ block: 'end' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, conversation?.id])

  // Switching threads always starts at the end, and closes any open search.
  useEffect(() => {
    setSearch(null)
    setAtBottom(true)
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [conversation?.id])

  const matches = useMemo(() => {
    const q = (search || '').trim().toLowerCase()
    if (!q) return null
    return messages.filter((m) => (m.body || '').toLowerCase().includes(q))
  }, [messages, search])

  const rows = useMemo(
    () => (conversation ? buildRows(matches ?? messages) : []),
    [messages, matches, conversation],
  )

  if (!conversation) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center bg-page px-6 text-center">
        <div className="mb-5 grid h-20 w-20 place-items-center rounded-full bg-inbox-chip text-brand">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.4 11.8a8.3 8.3 0 0 1-12.4 7.2l-4.5 1.2 1.3-4.4A8.3 8.3 0 1 1 20.4 11.8Z" />
          </svg>
        </div>
        <p className="text-[15.5px] font-semibold text-ink">WhatsApp Inbox</p>
        <p className="mt-1.5 max-w-[16rem] text-[13px] leading-relaxed text-muted">
          Pick a conversation on the left to read the thread and reply.
        </p>
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
  const blocked = Boolean(conversation.blocked_at)

  return (
    <div className="chat-canvas relative flex h-full flex-1 flex-col">
      {/* Header — 64px to match the list header across the divider. */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-inbox-divider bg-surface px-4">
        <div className="relative shrink-0">
          <Avatar name={conversation.wa_name || conversation.contact_name} phone={conversation.phone} avatarUrl={conversation.avatar_url} size={40} />
          <button
            type="button"
            title="Set photo"
            aria-label="Set contact photo"
            onClick={() => avatarInput.current?.click()}
            /* leading-none + block svg: without them the glyph sits on a text
               baseline inside the badge and rides ~1px low of centre. */
            className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-surface bg-brand p-0 leading-none text-white"
          >
            {uploading
              ? <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" className="block"><path d="M12 5v14M5 12h14" /></svg>}
          </button>
          <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={onAvatarFile} />
        </div>

        {/* The name is the control — no separate ⓘ button competing with it. */}
        <button
          type="button"
          onClick={onToggleInfo}
          aria-expanded={infoOpen}
          title={infoOpen ? 'Hide contact details' : 'Show contact details'}
          className="-ml-2 min-w-0 flex-1 rounded-xl px-2 py-1 text-left transition-colors hover:bg-inbox-control"
        >
          <div className="truncate text-[14.5px] font-semibold leading-tight text-ink">{displayName(conversation)}</div>
          <div className="truncate text-[12.5px] text-muted">+{conversation.phone}</div>
        </button>

        {/* Find a message in this thread — the single most-asked-for thing in a
            support inbox, and entirely client-side: the whole thread is
            already loaded. */}
        <button
          type="button"
          title="Search this conversation"
          aria-label="Search this conversation"
          aria-pressed={search !== null}
          onClick={() => setSearch((v) => (v === null ? '' : null))}
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors
            ${search !== null ? 'bg-inbox-chip text-brand' : 'text-muted hover:bg-inbox-control hover:text-ink'}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        </button>

        <ChatMenu
          conversation={conversation}
          canDelete={can('inbox.delete')}
          canBlock={canBlock}
          onAction={onChatAction}
        />

      </div>

      {search !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 pb-2.5">
          <div className="flex h-9 flex-1 items-center rounded-full bg-inbox-field focus-within:ring-2 focus-within:ring-inbox-focus">
            <span className="grid w-9 shrink-0 place-items-center text-muted">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            </span>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSearch(null) }}
              placeholder="Find in this conversation"
              aria-label="Find in this conversation"
              className="w-full bg-transparent pr-3 text-[13px] text-ink outline-none placeholder:text-muted"
            />
          </div>
          <span className="shrink-0 text-[12px] tabular-nums text-muted">
            {matches ? `${matches.length} found` : ''}
          </span>
          <button
            type="button"
            onClick={() => setSearch(null)}
            aria-label="Close search"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-inbox-control hover:text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      )}

      {/* Thread */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
        }}
        className="inbox-scroll relative min-h-0 flex-1 overflow-y-auto pb-3 pt-1 sm:px-[4.5%]"
      >
        {/* Loose text on the wallpaper sits on a chip, as WhatsApp's system
            notices do: --chat-sub is under 4.5:1 on the bare canvas. */}
        {loading && messages.length === 0 && (
          <div className="flex justify-center pt-3">
            <span className={CANVAS_CHIP}>Loading messages…</span>
          </div>
        )}
        {matches && matches.length === 0 && (
          <div className="flex justify-center pt-3">
            <span className={CANVAS_CHIP}>No messages match that search.</span>
          </div>
        )}
        {rows.map((row) =>
          row.separator ? (
            /* No bottom padding: the first bubble after a day chip starts a
               run, and its own 12px top margin is the gap. */
            <div key={row.id} className="flex justify-center pt-3">
              <span className={`${CANVAS_CHIP} uppercase tracking-[.2px]`}>
                {formatDaySeparator(row.at)}
              </span>
            </div>
          ) : (
            <MessageBubble
              key={row.id ?? row.meta_message_id}
              message={row}
              grouped={row.grouped}
              onOpenMedia={onOpenMedia}
              searchTerm={(search || '').trim()}
            />
          ),
        )}

        {/* The 24-hour window has no WhatsApp equivalent, so it goes where the
            client puts its own system notices — centred on the canvas — rather
            than as dashboard chrome bolted to the header. Sits last so it
            stays in view: the thread auto-scrolls to the end. */}
        {msLeft > 0 && !matches && !blocked && (
          <div className="flex justify-center pt-3">
            <span className={`${CANVAS_CHIP} max-w-[78%] text-center leading-relaxed`}>
              Replies are open for <b className="font-semibold text-chat-text">{formatCountdown(msLeft)}</b>. After that, only approved templates can be sent.
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Jump back to the newest message after scrolling up through history. */}
      {!atBottom && !matches && (
        <button
          type="button"
          onClick={() => { setAtBottom(true); endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }}
          title="Jump to latest"
          aria-label="Jump to latest message"
          className="absolute bottom-[76px] right-5 z-10 grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted shadow-[0_3px_10px_rgba(16,26,44,0.13)] transition-colors hover:text-ink"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
        </button>
      )}

      {/* Blocked replaces the composer outright, as WhatsApp does: nothing
          can be sent to a blocked number, so there is nothing to type into. */}
      {blocked ? (
        <div className="m-3 flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-2xl border border-inbox-divider bg-surface px-4 py-3 text-center text-[13px] leading-relaxed text-muted shadow-[0_2px_10px_rgba(16,26,44,0.08)]">
          <span>
            {canBlock
              ? 'You blocked this contact. They cannot message this number, and you cannot message them.'
              : 'This contact is blocked. Someone with permission to block contacts can unblock them.'}
          </span>
          {canBlock && (
            <button
              type="button"
              onClick={() => onChatAction?.('unblock')}
              className="shrink-0 rounded-full bg-brand px-4 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Unblock
            </button>
          )}
        </div>
      ) : canReply
        ? <Composer conversation={conversation} onSendText={onSendText} onSendMedia={onSendMedia} />
        : <p className="inbox-readonly-note">You can read conversations, but your access does not include replying.</p>}
    </div>
  )
}
