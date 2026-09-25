import { useCallback, useEffect, useRef, useState } from 'react'
import { waApi } from '../../../lib/api'
import { useInboxRealtime } from './useInboxRealtime'
import { ChatList } from './ChatList'
import { Conversation } from './Conversation'

// Newest activity first — the ordering the chat list and every realtime bump rely on.
function sortConvs(list) {
  return [...list].sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''))
}

// Merges an updated conversation into the list (replace-or-insert), then re-sorts.
function upsertConv(list, conv) {
  const idx = list.findIndex((c) => c.id === conv.id)
  if (idx === -1) return sortConvs([conv, ...list])
  const next = list.slice()
  next[idx] = { ...next[idx], ...conv }
  return sortConvs(next)
}

export default function WhatsAppInbox() {
  const [conversations, setConversations] = useState([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)

  // Realtime callbacks must stay stable so the channel is not rebuilt on every
  // render; they read the current active conversation through a ref.
  const activeIdRef = useRef(null)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  // Initial chat list.
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
    // Optimistically clear the unread badge, then persist it.
    setConversations((prev) => prev.map((c) => (c.id === conv.id ? { ...c, unread_count: 0 } : c)))
    waApi.markRead(conv.id).catch(() => {})
    try {
      const data = await waApi.messages(conv.id)
      setMessages(data.messages || [])
    } finally {
      setLoadingMsgs(false)
    }
  }, [])

  // Appends a message to the open thread, de-duplicating on id / wamid so a
  // locally-added send and its echoed broadcast never both land.
  const appendMessage = useCallback((message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id ||
        (message.meta_message_id && m.meta_message_id === message.meta_message_id))) return prev
      return [...prev, message]
    })
  }, [])

  const onNewMessage = useCallback(({ conversation, message }) => {
    const isActive = conversation.id === activeIdRef.current
    setConversations((prev) => {
      const bumped = { ...conversation }
      // Keep the badge cleared for the thread the agent is looking at.
      if (isActive) bumped.unread_count = 0
      return upsertConv(prev, bumped)
    })
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

  useInboxRealtime({ onNewMessage, onMessageUpdated, onStatus })

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

  return (
    <div className="flex h-[calc(100vh-var(--app-header-h,56px))] overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-[#111b21]">
      {/* Left: chat list */}
      <aside className="flex w-full max-w-[380px] shrink-0 flex-col border-r border-black/10 dark:border-white/10">
        <header className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h1 className="text-[16px] font-semibold text-gray-900 dark:text-white">Inbox</h1>
          <span className="text-[12px] text-gray-500">{conversations.length}</span>
        </header>
        <ChatList
          conversations={conversations}
          activeId={activeId}
          onSelect={openConversation}
          loading={loadingConvs}
        />
      </aside>

      {/* Right: active conversation */}
      <main className="min-w-0 flex-1">
        <Conversation
          conversation={activeConv}
          messages={messages}
          loading={loadingMsgs}
          onSendText={handleSendText}
          onSendMedia={handleSendMedia}
        />
      </main>
    </div>
  )
}
