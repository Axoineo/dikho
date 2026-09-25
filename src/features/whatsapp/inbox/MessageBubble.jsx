import { AuthedMedia } from './AuthedMedia'
import { formatTime } from './inboxUtils'

// Delivery ticks, matching WhatsApp: single grey (sent), double grey (delivered),
// double blue (read). Failed shows a red warning; anything earlier is a clock.
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
    <div className={`flex px-3 py-[3px] sm:px-8 ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`relative max-w-[75%] rounded-lg px-2 py-1.5 text-[14.2px] leading-[19px] shadow-sm
          ${outbound
            ? 'rounded-tr-none bg-[#d7e8fb] text-gray-900 dark:bg-[#12405f] dark:text-white'
            : 'rounded-tl-none bg-white text-gray-900 dark:bg-[#202c33] dark:text-white'}`}
      >
        {/* bubble tail */}
        <span
          className={`absolute top-0 h-3 w-3 ${outbound
            ? 'right-[-7px] text-[#d7e8fb] dark:text-[#12405f]'
            : 'left-[-7px] text-white dark:text-[#202c33]'}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 8 12" width="8" height="12" className={outbound ? 'scale-x-[-1]' : ''} fill="currentColor"><path d="M8 0H0c2 2 6 3 8 12V0z" /></svg>
        </span>

        {hasMedia && (
          <div className={`mb-1 overflow-hidden ${isImageOrVideo ? '-mx-1 -mt-0.5' : ''}`}>
            <AuthedMedia message={message} onOpen={() => onOpenMedia?.(message)} />
          </div>
        )}
        {message.body && <p className="whitespace-pre-wrap break-words pr-14">{message.body}</p>}

        <span className={`float-right ml-2 mt-1 flex select-none items-center gap-0.5 text-[11px] leading-none
          ${outbound ? 'text-[#185494]/70 dark:text-white/60' : 'text-gray-500 dark:text-gray-400'}`}>
          {formatTime(message.wa_timestamp || message.created_at)}
          {outbound && <Ticks status={message.status} />}
        </span>
      </div>
    </div>
  )
}
