import { AuthedMedia } from './AuthedMedia'
import { formatTime } from './inboxUtils'

// Delivery ticks: single grey (sent), double grey (delivered), double blue (read).
function Ticks({ status }) {
  const base = 'ml-0.5 inline-block align-middle'
  if (status === 'read' || status === 'delivered') {
    return (
      <svg viewBox="0 0 18 12" width="16" height="11" className={base} fill="none"
        stroke={status === 'read' ? '#2a9df4' : 'currentColor'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 6.5l3.2 3.2L11 3" /><path d="M6.5 9.5L13.2 3" />
      </svg>
    )
  }
  if (status === 'sent') {
    return <svg viewBox="0 0 12 12" width="13" height="11" className={base} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6.5l3.2 3.2L11 3" /></svg>
  }
  if (status === 'failed') return <span className={`${base} text-red-500`}>⚠</span>
  return <svg viewBox="0 0 24 24" width="12" height="11" className={base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>
}

export function MessageBubble({ message, onOpenMedia }) {
  const outbound = message.direction === 'outbound'
  const hasMedia = message.type !== 'text' && (message.media_url || message.media_status)
  const isImageOrVideo = (message.media_mime || '').startsWith('image/') || (message.media_mime || '').startsWith('video/')

  return (
    <div className={`flex px-2 py-[3px] sm:px-4 ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[76%] rounded-2xl px-2.5 py-1.5 text-[14px] leading-[20px] sm:max-w-[68%]
          ${outbound
            ? 'rounded-br-md bg-chat-bubble-out text-chat-bubble-out-text ring-1 ring-chat-ring'
            : 'rounded-bl-md bg-chat-bubble-in text-ink ring-1 ring-chat-ring'}`}
      >
        {hasMedia && (
          <div className={`overflow-hidden ${message.body ? 'mb-1' : ''} ${isImageOrVideo ? '-mx-1 -mt-0.5 rounded-xl' : ''}`}>
            <AuthedMedia message={message} onOpen={() => onOpenMedia?.(message)} />
          </div>
        )}
        {message.body && <p className="whitespace-pre-wrap break-words pr-12">{message.body}</p>}

        <span className={`float-right ml-2 mt-1 flex select-none items-center gap-0.5 text-[10.5px] leading-none
          ${outbound ? 'text-[#185494]/70 dark:text-white/70' : 'text-muted'}`}>
          {formatTime(message.wa_timestamp || message.created_at)}
          {outbound && <Ticks status={message.status} />}
        </span>
      </div>
    </div>
  )
}
