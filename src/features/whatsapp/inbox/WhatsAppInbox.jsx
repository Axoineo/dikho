import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { waApi } from '../../../lib/api'
import { useInboxRealtime } from './useInboxRealtime'
import { ChatList } from './ChatList'
import { Conversation } from './Conversation'
import { ContactPanel } from './ContactPanel'
import { MediaLightbox } from './MediaLightbox'
import { MediaTicketProvider } from './MediaTicketContext'

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

function isViewable(m) {
  return m.type !== 'text' && m.media_status === 'ready' && m.media_url &&
    !(m.media_mime || '').startsWith('audio/')
}

export default function WhatsAppInbox() {
  const [conversations, setConversations] = useState([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [lightboxId, setLightboxId] = useState(null)
  const [infoOpen, setInfoOpen] = useState(true)
  const [, setTick] = useState(0)

  const activeIdRef = useRef(null)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let alive = true
    waApi.conversations()
      .then((data) => { if (alive) setConversations(sortConvs(data.conversations || [])) })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingConvs(false) })
    return () => { alive = false }
  }, [])

  const openConversation = useCallback(async (conv) => {
    setActiveId(conv.id)
    setLoadingMsgs(true)
    setMessages([])
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, unread_count: 0 } : c)))
    waApi.markRead(conv.id).catch(() => {})
    try {
      const data = await waApi.messages(conv.id)
      setMessages(data.messages || [])
    } finally {
      setLoadingMsgs(false)
    }
  }, [])

  // ?c=<id> deep link, used by the missed-calls screen's Reply button. Opens
  // that thread once the list has loaded, then clears the param so a later
  // manual navigation isn't yanked back to the same conversation.
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkId = Number(searchParams.get('c'))
  useEffect(() => {
    if (!Number.isInteger(deepLinkId) || deepLinkId <= 0) return
    const conv = conversations.find((c) => c.id === deepLinkId)
    if (!conv) return
    openConversation(conv)
    setSearchParams({}, { replace: true })
  }, [deepLinkId, conversations, openConversation, setSearchParams])

  const appendMessage = useCallback((message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id ||
        (message.meta_message_id && m.meta_message_id === message.meta_message_id))) return prev
      return [...prev, message]
    })
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
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...message } : m)))
  }, [])

  const onStatus = useCallback(({ messageId, status }) => {
    setMessages((prev) => prev.map((m) => (m.meta_message_id === messageId ? { ...m, status } : m)))
  }, [])

  const onConversationUpdated = useCallback(({ id, avatar_url }) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, avatar_url } : c)))
  }, [])

  // Re-read the inbox from D1, which is the source of truth. The realtime
  // broadcast is best-effort and is never replayed, so every event sent while
  // the socket was down — a sleeping laptop, a network hop, a Supabase
  // reconnect — is lost for good. Until now nothing recovered from that: the
  // list was fetched once on mount and afterwards only ever patched by
  // broadcasts, so a dropped socket left the inbox frozen on stale
  // conversations until someone reloaded the page by hand.
  const refresh = useCallback(async () => {
    const openId = activeIdRef.current
    const [convs, thread] = await Promise.all([
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
    if (thread && activeIdRef.current === openId) setMessages(thread.messages || [])
  }, [])

  useInboxRealtime({ onNewMessage, onMessageUpdated, onStatus, onConversationUpdated, onResync: refresh })

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

  const handleSendText = useCallback(async (body) => {
    if (!activeIdRef.current) return
    const { message } = await waApi.sendText(activeIdRef.current, body)
    appendMessage(message)
  }, [appendMessage])

  const handleSendMedia = useCallback(async (file, caption) => {
    if (!activeIdRef.current) return
    const { message } = await waApi.sendMedia(activeIdRef.current, file, caption)
    appendMessage(message)
  }, [appendMessage])

  const handleUploadAvatar = useCallback(async (conv, file) => {
    const { avatar_url } = await waApi.uploadAvatar(conv.id, file)
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, avatar_url } : c)))
  }, [])

  const mediaItems = useMemo(() => messages.filter(isViewable), [messages])
  const lightboxIndex = mediaItems.findIndex((m) => m.id === lightboxId)
  const openMedia = useCallback((message) => setLightboxId(message.id), [])

  return (
   <MediaTicketProvider>
    <div className="flex h-[calc(100vh-var(--app-header-h,56px))] overflow-hidden rounded-2xl border border-line bg-chat-shell shadow-sm">
      {/* Left — conversation list */}
      <aside className="flex w-full max-w-[360px] shrink-0 flex-col border-r border-line">
        <header className="flex items-center justify-between px-5 pb-1 pt-4">
          <h1 className="text-[19px] font-semibold tracking-tight text-ink">Inbox</h1>
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-semibold text-brand dark:text-[#5ba0e0]">
            {conversations.length}
          </span>
        </header>
        <div className="min-h-0 flex-1">
          <ChatList conversations={conversations} activeId={activeId} onSelect={openConversation} loading={loadingConvs} />
        </div>
      </aside>

      {/* Middle — active conversation */}
      <main className="flex min-w-0 flex-1">
        <Conversation
          conversation={activeConv}
          messages={messages}
          loading={loadingMsgs}
          onSendText={handleSendText}
          onSendMedia={handleSendMedia}
          onOpenMedia={openMedia}
          onUploadAvatar={handleUploadAvatar}
          infoOpen={infoOpen}
          onToggleInfo={() => setInfoOpen((v) => !v)}
        />
      </main>

      {/* Right — contact details (third pane) */}
      {infoOpen && activeConv && (
        <ContactPanel conversation={activeConv} messages={messages} onOpenMedia={openMedia} />
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
