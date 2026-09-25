import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { waApi } from '../../../lib/api'
import { useInboxRealtime } from './useInboxRealtime'
import { ChatList } from './ChatList'
import { Conversation } from './Conversation'
import { MediaLightbox } from './MediaLightbox'

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

// A media message is viewable in the lightbox if its bytes are re-hosted.
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
  const [, setTick] = useState(0) // forces session-countdown re-render

  const activeIdRef = useRef(null)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  // Keep session chips / composer gate fresh as the 24h window ticks down.
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

  useInboxRealtime({ onNewMessage, onMessageUpdated, onStatus, onConversationUpdated })

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

  // Lightbox works over the conversation's viewable media, so ←/→ pages through them.
  const mediaItems = useMemo(() => messages.filter(isViewable), [messages])
  const lightboxIndex = mediaItems.findIndex((m) => m.id === lightboxId)
  const openMedia = useCallback((message) => setLightboxId(message.id), [])

  return (
    <div className="flex h-[calc(100vh-var(--app-header-h,56px))] overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-[#111b21]">
      <aside className="flex w-full max-w-[400px] shrink-0 flex-col border-r border-black/10 dark:border-white/10">
        <header className="flex items-center justify-between px-4 py-3">
          <h1 className="text-[17px] font-semibold text-gray-900 dark:text-white">Inbox</h1>
          <span className="rounded-full bg-[#185494]/10 px-2 py-0.5 text-[12px] font-medium text-[#185494] dark:bg-[#185494]/25 dark:text-[#7cb2ea]">
            {conversations.length}
          </span>
        </header>
        <div className="min-h-0 flex-1">
          <ChatList conversations={conversations} activeId={activeId} onSelect={openConversation} loading={loadingConvs} />
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Conversation
          conversation={activeConv}
          messages={messages}
          loading={loadingMsgs}
          onSendText={handleSendText}
          onSendMedia={handleSendMedia}
          onOpenMedia={openMedia}
          onUploadAvatar={handleUploadAvatar}
        />
      </main>

      {lightboxIndex >= 0 && (
        <MediaLightbox
          items={mediaItems}
          index={lightboxIndex}
          onIndexChange={(i) => setLightboxId(mediaItems[i]?.id ?? null)}
          onClose={() => setLightboxId(null)}
        />
      )}
    </div>
  )
}
