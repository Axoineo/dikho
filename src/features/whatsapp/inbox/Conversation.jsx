import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'
import { Avatar } from './Avatar'
import { ChatMenu } from './ChatActions'
import { ComposeDialog } from './SendDialogs'
import { canForward, canReactTo, foldReactions, indexByWamid, snippet } from './messageModel'
import { displayName, formatDaySeparator, parseWaDate, sessionMsLeft, formatCountdown } from './inboxUtils'
import { useAccess } from '../../../lib/access'

// Day chips and system notices on the wallpaper.
const CANVAS_CHIP = 'rounded-bubble bg-chat-raised px-3 py-[5px] text-[12.5px] text-chat-sub shadow-bubble'

// How close to the top of the thread (px) the next older page starts loading.
const LOAD_OLDER_AT = 300

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
export function Conversation({
  conversation, messages, loading, hasMore, loadingOlder, onLoadOlder, onSendText, onSendMedia, onOpenMedia, onUploadAvatar, infoOpen, onToggleInfo,
  onChatAction, onCompose, onMessageAction, notice,
}) {
  const { can } = useAccess()
  const canReply = can('inbox.reply')
  const canBlock = can('inbox.block')
  const canDelete = can('inbox.delete')
  const canTemplate = can('campaigns.send')
  const endRef = useRef(null)
  const scrollRef = useRef(null)
  const avatarInput = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState(null)   // null = closed, '' = open+empty
  const [starredOnly, setStarredOnly] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [replyTo, setReplyTo] = useState(null)
  const [composeKind, setComposeKind] = useState(null)
  const [highlightId, setHighlightId] = useState(null)
  const [pinIndex, setPinIndex] = useState(0)
  const [unseen, setUnseen] = useState(0)
  const seenIdsRef = useRef(new Set())

  // Auto-scroll only when already parked at the end. Yanking an agent back
  // down mid-scroll while a new message lands is how you lose your place in a
  // thread you were reading; instead the jump button counts what arrived.
  // Rows in front of the first one already seen are older history the agent
  // scrolled up to, not arrivals. A layout effect, so a freshly opened thread
  // is at its end before any scroll event can read it as "near the top".
  useLayoutEffect(() => {
    const seen = seenIdsRef.current
    const firstSeen = messages.findIndex((m) => seen.has(m.id))
    const fresh = messages.slice(Math.max(firstSeen, 0)).filter((m) => !seen.has(m.id))
    messages.forEach((m) => seen.add(m.id))
    if (atBottom) endRef.current?.scrollIntoView({ block: 'end' })
    else setUnseen((n) => n + fresh.filter((m) => m.direction === 'inbound' && m.type !== 'reaction').length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, conversation?.id])

  // An older page goes in above what is on screen without moving it: the
  // distance from the bottom of the thread is held across the insert. It is
  // recorded on every scroll and after every render, so it is current when
  // the page lands. Rows went in above when the previous first row is still
  // here but no longer first.
  const fromBottomRef = useRef(0)
  const firstIdRef = useRef(null)
  const firstId = messages[0]?.id ?? null
  useLayoutEffect(() => {
    const el = scrollRef.current
    const prevFirst = firstIdRef.current
    firstIdRef.current = firstId
    if (!el || prevFirst === null || prevFirst === firstId) return
    if (messages.findIndex((m) => m.id === prevFirst) > 0) el.scrollTop = el.scrollHeight - fromBottomRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstId])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) fromBottomRef.current = el.scrollHeight - el.scrollTop
  })

  // Switching threads always starts at the end, and drops any open search,
  // filter, reply or form.
  useEffect(() => {
    setSearch(null)
    setStarredOnly(false)
    setReplyTo(null)
    setComposeKind(null)
    setPinIndex(0)
    setUnseen(0)
    setAtBottom(true)
    seenIdsRef.current = new Set(messages.map((m) => m.id))
    endRef.current?.scrollIntoView({ block: 'end' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id])

  const { shown, reactionsFor } = useMemo(() => foldReactions(messages), [messages])
  const byWamid = useMemo(() => indexByWamid(messages), [messages])
  const pinned = useMemo(
    () => shown.filter((m) => m.pinned_at).sort((a, b) => String(b.pinned_at).localeCompare(String(a.pinned_at))),
    [shown],
  )

  const matches = useMemo(() => {
    if (starredOnly) return shown.filter((m) => m.starred)
    const q = (search || '').trim().toLowerCase()
    if (!q) return null
    return shown.filter((m) => (m.body || '').toLowerCase().includes(q))
  }, [shown, search, starredOnly])

  const rows = useMemo(
    () => (conversation ? buildRows(matches ?? shown) : []),
    [shown, matches, conversation],
  )

  // Scrolls to a message and rings it for a moment. A search or filter that
  // hides it is closed first; the jump then runs once the full thread renders.
  const [pendingJump, setPendingJump] = useState(null)
  const jumpTo = useCallback((id) => {
    if (matches && !matches.some((m) => m.id === id)) {
      setSearch(null)
      setStarredOnly(false)
    }
    setPendingJump({ id, at: Date.now() })
  }, [matches])
  useEffect(() => {
    if (!pendingJump) return undefined
    const el = scrollRef.current?.querySelector(`[data-message-id="${pendingJump.id}"]`)
    if (!el) return undefined
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setHighlightId(pendingJump.id)
    const t = setTimeout(() => setHighlightId(null), 1600)
    return () => clearTimeout(t)
  }, [pendingJump, rows])

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
  const windowOpen = msLeft > 0 && !blocked
  const contactName = displayName(conversation)
  const authorOf = (m) => (m.direction === 'outbound' ? 'You' : contactName)

  // The menu on one message. Sending things (reply, react, forward) follows
  // the reply rules; pin is for repliers, star for anyone who can read,
  // delete for inbox.delete.
  function menuFor(m) {
    if (m.type === 'system' || m.type === 'call') return null
    const reactable = canReactTo(m, parseWaDate)
    const reason = !canReply ? null
      : blocked ? 'You blocked this contact.'
      : msLeft <= 0 ? 'Reactions need the 24-hour reply window to be open.'
      : !reactable ? 'WhatsApp only takes reactions to messages from the last 30 days.'
      : null
    const items = [
      canReply && windowOpen && m.meta_message_id && { key: 'reply', label: 'Reply' },
      m.body && { key: 'copy', label: 'Copy' },
      canReply && canForward(m) && { key: 'forward', label: 'Forward' },
      canReply && (m.pinned_at ? { key: 'unpin', label: 'Unpin' } : { key: 'pin', label: 'Pin' }),
      m.starred ? { key: 'unstar', label: 'Unstar' } : { key: 'star', label: 'Star' },
      canDelete && { key: 'delete', label: 'Delete', danger: true },
    ].filter(Boolean)
    return {
      reactions: { enabled: canReply && windowOpen && reactable, reason },
      items,
      onReact: (emoji) => onMessageAction?.('react', m, emoji),
      onAction: (key) => {
        if (key === 'reply') setReplyTo(m)
        else if (key === 'copy') navigator.clipboard?.writeText(m.body).catch(() => {})
        else onMessageAction?.(key, m)
      },
    }
  }

  const currentPin = pinned.length ? pinned[pinIndex % pinned.length] : null

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
            support inbox. Client-side, so it covers the messages loaded so
            far: the newest page and any older ones scrolled up to. */}
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
          canDelete={canDelete}
          canBlock={canBlock}
          onAction={(key) => {
            if (key === 'starred') { setSearch(null); setStarredOnly(true) } else onChatAction?.(key)
          }}
        />

      </div>

      {starredOnly && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-1.5">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-muted"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" /></svg>
          <span className="flex-1 text-[13px] font-medium text-ink">Your starred messages <span className="font-normal text-muted">· {matches?.length ?? 0}</span></span>
          <button type="button" onClick={() => setStarredOnly(false)} aria-label="Show all messages"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-inbox-control hover:text-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      )}

      {/* Pinned messages, newest first; a tap goes to the message and moves on
          to the next pin, as in WhatsApp. Pins are the team's, not the
          customer's: the Cloud API has no pinning. */}
      {currentPin && !starredOnly && (
        <button
          type="button"
          onClick={() => { jumpTo(currentPin.id); setPinIndex((i) => (i + 1) % pinned.length) }}
          title="Go to the pinned message"
          className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2 text-left transition-colors hover:bg-inbox-row-hover"
        >
          {pinned.length > 1 && (
            <span className="flex flex-col gap-[2px] self-stretch py-0.5" aria-hidden="true">
              {pinned.map((p, i) => <span key={p.id} className={`w-[3px] flex-1 rounded-full ${i === pinIndex % pinned.length ? 'bg-brand' : 'bg-line'}`} />)}
            </span>
          )}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted"><path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" /><path d="M12 16v5" /></svg>
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] font-semibold uppercase tracking-[.3px] text-muted">Pinned{pinned.length > 1 ? ` · ${(pinIndex % pinned.length) + 1} of ${pinned.length}` : ''}</span>
            <span className="block truncate text-[13px] text-ink">{snippet(currentPin)}</span>
          </span>
        </button>
      )}

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
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          fromBottomRef.current = el.scrollHeight - el.scrollTop
          setAtBottom(bottom)
          if (bottom) setUnseen(0)
          // Not under a search or the starred filter: those show only what
          // matches, so the top of the list is not the top of the thread.
          if (el.scrollTop < LOAD_OLDER_AT && hasMore && !loadingOlder && !matches) onLoadOlder?.()
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
        {/* Older history. Loads by itself near the top; the button is for
            when the thread is too short to scroll, and for keyboards. One
            element in both states, so keyboard focus survives the load. */}
        {hasMore && !matches && messages.length > 0 && (
          <div className="flex justify-center pt-3" aria-live="polite">
            <button
              type="button"
              aria-disabled={loadingOlder}
              onClick={() => { if (!loadingOlder) onLoadOlder?.() }}
              className={`${CANVAS_CHIP} ${loadingOlder ? 'cursor-default' : 'transition-colors hover:text-chat-text'}`}
            >
              {loadingOlder ? 'Loading older messages…' : 'Load older messages'}
            </button>
          </div>
        )}
        {matches && matches.length === 0 && (
          <div className="flex justify-center pt-3">
            <span className={CANVAS_CHIP}>{starredOnly ? 'You have not starred anything in this chat.' : 'No messages match that search.'}</span>
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
          ) : row.type === 'system' ? (
            /* WhatsApp's own notices (a changed number and the like) are
               centred chips, never bubbles. */
            <div key={row.id} data-message-id={row.id} className="flex justify-center pt-3">
              <span className={`${CANVAS_CHIP} max-w-[78%] text-center leading-relaxed`}>{row.body}</span>
            </div>
          ) : (
            <MessageBubble
              key={row.id ?? row.meta_message_id}
              message={row}
              grouped={row.grouped}
              onOpenMedia={onOpenMedia}
              searchTerm={(search || '').trim()}
              reactions={reactionsFor(row)}
              quoted={row.context_wamid ? byWamid.get(row.context_wamid) ?? null : null}
              quotedAuthor={row.context_wamid && byWamid.get(row.context_wamid) ? authorOf(byWamid.get(row.context_wamid)) : ''}
              quotedMine={byWamid.get(row.context_wamid)?.direction === 'outbound'}
              onJumpTo={jumpTo}
              highlighted={highlightId === row.id}
              menu={menuFor(row)}
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

      {/* Back to the newest message after scrolling up through history, with
          a count of what arrived meanwhile, as WhatsApp shows it. Sits above
          the composer whatever its height (reply bar, errors). */}
      {notice && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[84px] z-10 flex justify-center px-4">
          <span role="status" className="rounded-full bg-[rgba(11,20,26,0.82)] px-4 py-2 text-[13px] text-white shadow-[0_3px_10px_rgba(11,20,26,0.2)]">{notice}</span>
        </div>
      )}
      {!atBottom && !matches && (
        <button
          type="button"
          onClick={() => { setAtBottom(true); setUnseen(0); endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }}
          title="Go to the latest message"
          aria-label={unseen ? `Go to the latest message, ${unseen} new` : 'Go to the latest message'}
          className="absolute bottom-[84px] right-5 z-10 grid h-[42px] w-[42px] place-items-center rounded-full border-0 bg-chat-raised text-chat-sub shadow-[0_2px_8px_rgba(11,20,26,0.22)] transition-colors hover:text-chat-text"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          {unseen > 0 && (
            <span className="absolute -top-1.5 -right-1 flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-chat-accent px-1.5 text-[11px] font-bold leading-none text-chat-on-accent">
              {unseen > 99 ? '99+' : unseen}
            </span>
          )}
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
        ? (
          <Composer
            conversation={conversation}
            onSendText={async (body) => { await onSendText(body, replyTo?.id); setReplyTo(null) }}
            onSendMedia={async (file, caption, opts = {}) => { await onSendMedia(file, caption, { ...opts, replyTo: replyTo?.id }); setReplyTo(null) }}
            onCompose={setComposeKind}
            canTemplate={canTemplate}
            replyTo={replyTo}
            replyAuthor={replyTo ? authorOf(replyTo) : ''}
            replyMine={replyTo?.direction === 'outbound'}
            onCancelReply={() => setReplyTo(null)}
          />
        )
        : <p className="inbox-readonly-note">You can read conversations, but your access does not include replying.</p>}

      {composeKind && (
        <ComposeDialog
          kind={composeKind}
          conversation={conversation}
          onSend={async (kind, input) => {
            const reply = kind === 'template' ? undefined : replyTo?.id
            await onCompose(kind, reply ? { ...input, replyTo: reply } : input)
            if (reply) setReplyTo(null)
          }}
          onClose={() => setComposeKind(null)}
        />
      )}
    </div>
  )
}
