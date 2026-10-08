import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { waApi } from '../../../lib/api'
import { useInboxRealtime } from './useInboxRealtime'
import { ChatList } from './ChatList'
import { Conversation } from './Conversation'
import { ContactPanel } from './ContactPanel'
import { MediaLightbox } from './MediaLightbox'
import { MediaTicketProvider } from './MediaTicketContext'
import { ChatActionDialog } from './ChatActions'
import { ForwardDialog } from './ForwardDialog'
import { EMPTY_THREAD, mergeNewestPage, prependOlderPage, threadFromPage } from './messageModel'

function sortConvs(list) {
  return [...list].sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''))
}

function upsertConv(list, conv) {
  const idx = list.findIndex((c) => c.id === conv.id)
  if (idx === -1) return sortConvs([conv, ...list])
  const next = list.slice()
  next[idx] = { ...next[idx], ...conv }
  return sortConvs(next)
}

// A thread updater that changes only the rows; the paging state rides along.
const withRows = (update) => (thread) => ({ ...thread, messages: update(thread.messages) })

function isViewable(m) {
  return m.type !== 'text' && m.media_status === 'ready' && m.media_url &&
    !(m.media_mime || '').startsWith('audio/')
}

export default function WhatsAppInbox() {
  const [conversations, setConversations] = useState([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [activeId, setActiveId] = useState(null)
  // The open thread: its rows plus where the next older page starts.
  const [thread, setThread] = useState(EMPTY_THREAD)
  const { messages, hasMore, before } = thread
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loadingOlderRef = useRef(false)
  const [lightboxId, setLightboxId] = useState(null)
  // Closed by default. The thread is the work; contact details are a lookup
  // you ask for, and defaulting them open cost ~320px of message width on
  // every screen for information that rarely changes.
  const [infoOpen, setInfoOpen] = useState(false)
  const [, setTick] = useState(0)

  const activeIdRef = useRef(null)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  // The first load used to swallow its error, which meant a failed request
  // rendered the same "No conversations yet" copy as a genuinely empty inbox —
  // so an auth or network problem looked like having no customers. Surface it
  // instead, and offer a retry.
  useEffect(() => {
    let alive = true
    setLoadingConvs(true)
    setLoadError(null)
    waApi.conversations()
      .then((data) => {
        if (!alive) return
        setConversations(sortConvs(data.conversations || []))
      })
      .catch((err) => {
        if (!alive) return
        console.error('[inbox] failed to load conversations', err)
        setLoadError(err?.message || 'Could not reach the server.')
      })
      .finally(() => { if (alive) setLoadingConvs(false) })
    return () => { alive = false }
  }, [reloadKey])

  // Opens on the newest page; older ones load as the agent scrolls up. Set
  // on the ref at once, not after the render, so a reply for a chat that was
  // left meanwhile can be told apart and dropped.
  const openConversation = useCallback(async (conv) => {
    activeIdRef.current = conv.id
    setActiveId(conv.id)
    setLoadingMsgs(true)
    setThread(EMPTY_THREAD)
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, unread_count: 0 } : c)))
    waApi.markRead(conv.id).catch(() => {})
    try {
      const page = await waApi.messages(conv.id)
      if (activeIdRef.current === conv.id) setThread(threadFromPage(page))
    } finally {
      if (activeIdRef.current === conv.id) setLoadingMsgs(false)
    }
  }, [])

  const appendMessage = useCallback((message) => {
    setThread(withRows((prev) => {
      if (prev.some((m) => m.id === message.id ||
        (message.meta_message_id && m.meta_message_id === message.meta_message_id))) return prev
      return [...prev, message]
    }))
  }, [])

  const onNewMessage = useCallback(({ conversation, message }) => {
    const isActive = conversation.id === activeIdRef.current
    setConversations((prev) => upsertConv(prev, isActive ? { ...conversation, unread_count: 0 } : conversation))
    if (isActive) {
      appendMessage(message)
      if (message.direction === 'inbound') waApi.markRead(conversation.id).catch(() => {})
    }
  }, [appendMessage])

  const onMessageUpdated = useCallback(({ message }) => {
    setThread(withRows((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...message } : m))))
  }, [])

  const onStatus = useCallback(({ messageId, status }) => {
    setThread(withRows((prev) => prev.map((m) => (m.meta_message_id === messageId ? { ...m, status } : m))))
  }, [])

  const onConversationUpdated = useCallback(({ id, avatar_url }) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, avatar_url } : c)))
  }, [])

  // Clear chat, Delete chat and Block, applied the same way whether this tab
  // did it or another agent's did (the API broadcasts each one).
  const onConversationCleared = useCallback(({ conversation }) => {
    if (!conversation?.id) return
    setConversations((prev) => prev.map((c) => (c.id === conversation.id
      ? { ...c, ...conversation, last_message_status: null, unread_count: 0 }
      : c)))
    if (conversation.id === activeIdRef.current) {
      // Anything newer than the clear (a message that landed meanwhile) stays,
      // and nothing older is left to page in.
      setThread((t) => ({
        ...t,
        messages: t.messages.filter((m) => m.id > (conversation.cleared_through_id ?? Infinity)),
        hasMore: false,
      }))
    }
  }, [])

  const onConversationDeleted = useCallback(({ id }) => {
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (id === activeIdRef.current) {
      activeIdRef.current = null
      setActiveId(null)
      setThread(EMPTY_THREAD)
    }
  }, [])

  const onConversationBlocked = useCallback(({ id, blocked_at }) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, blocked_at: blocked_at ?? null } : c)))
  }, [])

  const onMessageHidden = useCallback(({ id }) => {
    setThread(withRows((prev) => prev.filter((m) => m.id !== id)))
  }, [])

  // Re-read the inbox from D1, which is the source of truth. The realtime
  // broadcast is best-effort and is never replayed, so every event sent while
  // the socket was down — a sleeping laptop, a network hop, a Supabase
  // reconnect — is lost for good. Until now nothing recovered from that: the
  // list was fetched once on mount and afterwards only ever patched by
  // broadcasts, so a dropped socket left the inbox frozen on stale
  // conversations until someone reloaded the page by hand.
  //
  // The thread side re-reads only the newest page and merges it, so older
  // pages the agent scrolled up through are not thrown away every 25 seconds.
  const refresh = useCallback(async () => {
    const openId = activeIdRef.current
    const [convs, page] = await Promise.all([
      waApi.conversations().catch(() => null),
      openId ? waApi.messages(openId).catch(() => null) : null,
    ])
    if (convs) {
      setConversations(sortConvs((convs.conversations || []).map((conv) => (
        // Don't let the server resurrect a badge on the thread the agent is
        // already reading — markRead may not have landed yet.
        conv.id === openId ? { ...conv, unread_count: 0 } : conv
      ))))
    }
    // Guard against a thread switch mid-flight clobbering the new one.
    if (page && activeIdRef.current === openId) setThread((t) => mergeNewestPage(t, page))
  }, [])

  useInboxRealtime({
    onNewMessage, onMessageUpdated, onStatus, onConversationUpdated,
    onConversationCleared, onConversationDeleted, onConversationBlocked, onMessageHidden,
    onResync: refresh,
  })

  // Reconcile whenever we might have missed something: coming back to the tab,
  // and on a slow timer as a backstop for a socket that is nominally up but
  // silently dropping events. Paused while hidden so a backgrounded tab costs
  // nothing. These are D1 reads, which are cheap — the free-tier limit that
  // bites is row *writes*.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    const poll = setInterval(onVisible, 25000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
      clearInterval(poll)
    }
  }, [refresh])

  const activeConv = conversations.find((c) => c.id === activeId) || null

  const handleSendText = useCallback(async (body, replyTo) => {
    if (!activeIdRef.current) return
    const { message } = await waApi.sendText(activeIdRef.current, body, replyTo)
    appendMessage(message)
  }, [appendMessage])

  const handleSendMedia = useCallback(async (file, caption, opts) => {
    if (!activeIdRef.current) return
    const { message } = await waApi.sendMedia(activeIdRef.current, file, caption, opts)
    appendMessage(message)
  }, [appendMessage])

  // Locations, contact cards, buttons, lists, links, requests and templates.
  const handleCompose = useCallback(async (kind, input) => {
    const id = activeIdRef.current
    if (!id) return
    const call = kind === 'location' ? waApi.sendLocation(id, input)
      : kind === 'contact' ? waApi.sendContact(id, input)
      : kind === 'template' ? waApi.sendTemplate(id, input)
      : waApi.sendInteractive(id, { ...input, kind })
    appendMessage((await call).message)
  }, [appendMessage])

  // A short line over the thread for an action that has no other visible
  // result, or that failed.
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)
  const showNotice = useCallback((text) => {
    clearTimeout(noticeTimer.current)
    setNotice(text)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  // The page older than the oldest one loaded, when the agent scrolls to the
  // top of the thread. One request at a time.
  const loadOlder = useCallback(async () => {
    const id = activeIdRef.current
    if (!id || !hasMore || loadingOlderRef.current) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const page = await waApi.messages(id, before)
      if (activeIdRef.current === id) setThread((t) => prependOlderPage(t, page, before))
    } catch (err) {
      console.error('[inbox] failed to load older messages', err)
      showNotice('Could not load older messages. Please try again.')
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [hasMore, before, showNotice])

  const mergeMessage = useCallback((row) => {
    setThread(withRows((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m))))
  }, [])

  const [forwarding, setForwarding] = useState(null) // the message being forwarded

  const handleUploadAvatar = useCallback(async (conv, file) => {
    const { avatar_url } = await waApi.uploadAvatar(conv.id, file)
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, avatar_url } : c)))
  }, [])

  // The confirmation is pinned to the chat it was opened for, so it can never
  // act on a different one. A rejected promise keeps the dialog open with the
  // API's message (ChatActionDialog shows it).
  const [chatAction, setChatAction] = useState(null) // { action, id, messageId? }
  const requestChatAction = useCallback((action) => {
    if (activeIdRef.current) setChatAction({ action, id: activeIdRef.current })
  }, [])

  // One message's menu. React, pin and star apply at once; delete asks
  // first; forward opens the chat picker.
  const handleMessageAction = useCallback(async (action, message, emoji) => {
    const id = activeIdRef.current
    if (!id) return
    try {
      if (action === 'react') appendMessage((await waApi.react(id, message.id, emoji)).message)
      else if (action === 'pin') { mergeMessage((await waApi.pin(id, message.id)).message); showNotice('Pinned for your team') }
      else if (action === 'unpin') mergeMessage((await waApi.unpin(id, message.id)).message)
      else if (action === 'star' || action === 'unstar') {
        await (action === 'star' ? waApi.star(id, message.id) : waApi.unstar(id, message.id))
        mergeMessage({ id: message.id, starred: action === 'star' ? 1 : 0 })
      } else if (action === 'delete') setChatAction({ action: 'deleteMessage', id, messageId: message.id })
      else if (action === 'forward') setForwarding(message)
    } catch (err) {
      showNotice(err?.message || 'That did not work. Please try again.')
    }
  }, [appendMessage, mergeMessage, showNotice])

  const runChatAction = useCallback(async () => {
    const { action, id, messageId } = chatAction
    if (action === 'deleteMessage') { await waApi.deleteMessage(id, messageId); onMessageHidden({ id: messageId }) }
    else if (action === 'clear') onConversationCleared(await waApi.clearChat(id))
    else if (action === 'delete') onConversationDeleted(await waApi.deleteChat(id))
    else if (action === 'block' || action === 'unblock') {
      const { conversation } = await (action === 'block' ? waApi.block(id) : waApi.unblock(id))
      onConversationBlocked({ id, blocked_at: conversation?.blocked_at })
    }
    setChatAction(null)
  }, [chatAction, onConversationCleared, onConversationDeleted, onConversationBlocked, onMessageHidden])
  const chatActionConv = chatAction ? conversations.find((c) => c.id === chatAction.id) : null

  const mediaItems = useMemo(() => messages.filter(isViewable), [messages])
  const lightboxIndex = mediaItems.findIndex((m) => m.id === lightboxId)
  const openMedia = useCallback((message) => setLightboxId(message.id), [])

  return (
   <MediaTicketProvider>
    {/* Full-bleed panes divided by hairlines — no card, no outer radius, no
        shadow. The floating-card treatment is what made the inbox read as a
        widget inside a dashboard rather than as a chat client. The dividers
        are the app's --line now, since the chrome either side of them is. */}
    <div className="workspace-bleed flex overflow-hidden bg-surface">
      {/* Left — conversation list */}
      {/* The list is a distinct pane, not a column of the same sheet: its own
          fill plus a divider stronger than --line, so the boundary between
          "all chats" and the open thread reads at a glance. */}
      <aside className="flex w-full max-w-[352px] shrink-0 flex-col border-r border-inbox-divider bg-inbox-list">
        <ChatList
          conversations={conversations}
          activeId={activeId}
          onSelect={openConversation}
          loading={loadingConvs}
          error={loadError}
          onRetry={() => setReloadKey((n) => n + 1)}
        />
      </aside>

      {/* Middle — active conversation */}
      <main className="flex min-w-0 flex-1">
        <Conversation
          conversation={activeConv}
          messages={messages}
          loading={loadingMsgs}
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
          onSendText={handleSendText}
          onSendMedia={handleSendMedia}
          onOpenMedia={openMedia}
          onUploadAvatar={handleUploadAvatar}
          infoOpen={infoOpen}
          onToggleInfo={() => setInfoOpen((v) => !v)}
          onChatAction={requestChatAction}
          onCompose={handleCompose}
          onMessageAction={handleMessageAction}
          notice={notice}
        />
      </main>

      {/* Right — contact details (third pane) */}
      {infoOpen && activeConv && (
        <ContactPanel conversation={activeConv} messages={messages} onOpenMedia={openMedia} onChatAction={requestChatAction} />
      )}

      {forwarding && (
        <ForwardDialog
          message={forwarding}
          conversations={conversations}
          currentId={activeId}
          onForward={async (targetId) => {
            const { message } = await waApi.forward(targetId, forwarding.id)
            setConversations((prev) => upsertConv(prev, {
              id: targetId, last_message_at: message.created_at,
              last_message_preview: message.body || `📎 ${message.type}`, last_message_direction: 'outbound',
            }))
          }}
          onClose={() => setForwarding(null)}
        />
      )}

      {chatActionConv && (
        <ChatActionDialog
          action={chatAction.action}
          conversation={chatActionConv}
          onConfirm={runChatAction}
          onClose={() => setChatAction(null)}
        />
      )}

      {lightboxIndex >= 0 && (
        <MediaLightbox
          items={mediaItems}
          index={lightboxIndex}
          onIndexChange={(i) => setLightboxId(mediaItems[i]?.id ?? null)}
          onClose={() => setLightboxId(null)}
        />
      )}
    </div>
   </MediaTicketProvider>
  )
}
