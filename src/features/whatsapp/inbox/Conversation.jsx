import { useEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'

function headerInitials(conv) {
  const src = (conv.wa_name || conv.contact_name || '').trim()
  if (src) return src.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (conv.phone || '?').slice(-2)
}

// Right pane. Renders the thread and pins the scroll to the newest message on
// load and whenever a new message arrives.
export function Conversation({ conversation, messages, loading, onSendText, onSendMedia }) {
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, conversation?.id])

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#f0f2f5] text-center text-gray-500 dark:bg-[#0b141a]">
        <div className="mb-2 text-5xl">💬</div>
        <p className="text-[15px]">Select a conversation to start chatting</p>
      </div>
    )
  }

  const name = conversation.wa_name || conversation.contact_name || conversation.phone

  return (
    <div className="flex h-full flex-col bg-[#efeae2] dark:bg-[#0b141a]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-black/10 bg-[#f0f2f5] px-4 py-2.5 dark:border-white/10 dark:bg-[#202c33]">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#185494]/10 text-[12px] font-semibold text-[#185494] dark:bg-white/10 dark:text-[#5ba0e0]">
          {headerInitials(conversation)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-gray-900 dark:text-white">{name}</div>
          <div className="truncate text-[12px] text-gray-500 dark:text-gray-400">+{conversation.phone}</div>
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto py-3">
        {loading && messages.length === 0 && (
          <div className="p-4 text-center text-sm text-gray-500">Loading messages…</div>
        )}
        {messages.map((m) => <MessageBubble key={m.id ?? m.meta_message_id} message={m} />)}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <Composer
        conversation={conversation}
        onSendText={onSendText}
        onSendMedia={onSendMedia}
      />
    </div>
  )
}
