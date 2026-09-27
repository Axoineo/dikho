import { AuthedMedia } from './AuthedMedia'
import { formatTime } from './inboxUtils'

// Delivery ticks: single grey (sent), double grey (delivered), double blue (read).
function Ticks({ status }) {
  const base = 'ml-0.5 inline-block align-middle'
  if (status === 'read' || status === 'delivered') {
    return (
      <svg viewBox="0 0 18 12" width="16" height="11" className={`${base} ${status === 'read' ? 'text-chat-tick' : ''}`} fill="none"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 6.5l3.2 3.2L11 3" /><path d="M6.2 9.7L12.9 3" />
      </svg>
    )
  }
  if (status === 'sent') {
    return <svg viewBox="0 0 12 12" width="13" height="11" className={base} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6.5l3.2 3.2L11 3" /></svg>
  }
  if (status === 'failed') return <span className={`${base} text-red-500`}>⚠</span>
  return <svg viewBox="0 0 24 24" width="12" height="11" className={base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>
}

// The webhook writes a bracketed placeholder for any type it cannot parse
// (see parseContent in api/services/whatsapp/inbound.js), so older rows carry
// a literal "[interactive]" as their whole body. Printing the internal token
// at the customer looks like a bug; describe the event instead.
const PLACEHOLDER = /^\[([a-z_\- ]{1,40})\]$/i
const PLACEHOLDER_LABEL = {
  interactive: 'Tapped a button',
  button: 'Tapped a button',
  order: 'Sent an order',
  location: 'Shared a location',
  contacts: 'Shared a contact',
  reaction: 'Reacted to a message',
  unsupported_message: 'Unsupported message',
}

function placeholderLabel(body) {
  const m = typeof body === 'string' && body.match(PLACEHOLDER)
  if (!m) return null
  const key = m[1].toLowerCase().replace(/\s+/g, '_')
  return PLACEHOLDER_LABEL[key] || `Sent a ${m[1].toLowerCase()} message`
}

// Voice-calling was removed on 2026-09-26, but rows it created are still in
// the thread. WhatsApp renders a call as an icon row, never as a text bubble.
function CallRow({ message, label }) {
  return (
    <div className="flex items-center gap-3 py-0.5 pl-1 pr-2">
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-chat-ring text-red-500">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.25 1l-2.2 2.2z" /></svg>
      </span>
      <span className="text-[14px] leading-tight">
        {label}
        <small className="mt-0.5 block text-[11.5px] text-chat-sub">{formatTime(message.wa_timestamp || message.created_at)}</small>
      </span>
    </div>
  )
}

export function MessageBubble({ message, onOpenMedia, grouped = true }) {
  const outbound = message.direction === 'outbound'
  const hasMedia = message.type !== 'text' && (message.media_url || message.media_status)
  const isImageOrVideo = (message.media_mime || '').startsWith('image/') || (message.media_mime || '').startsWith('video/')
  const isCall = message.type === 'call' || /^missed (voice|video) call$/i.test(message.body || '')
  const placeholder = placeholderLabel(message.body)
  const bodyText = placeholder ? null : message.body
  const mediaOnly = (hasMedia || isCall) && !bodyText && !placeholder

  return (
    <div className={`flex px-2 sm:px-4 ${grouped ? 'mt-3' : 'mt-0.5'} ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`relative max-w-[76%] rounded-bubble shadow-bubble pb-2 pl-[9px] pr-[7px] pt-1.5 text-[14.2px] leading-[19px] sm:max-w-[65%]
          ${mediaOnly ? 'pb-[22px]' : ''}
          ${outbound
            ? `bg-chat-bubble-out text-chat-bubble-out-text ${grouped ? 'rounded-tr-none' : ''}`
            : `bg-chat-bubble-in text-chat-text ${grouped ? 'rounded-tl-none' : ''}`}`}
      >
        {/* The tail only ever sits on the first bubble of a run, as in the client. */}
        {grouped && (
          <span
            aria-hidden="true"
            className={`absolute top-0 h-[13px] w-2 ${outbound ? '-right-2 bg-chat-bubble-out' : '-left-2 bg-chat-bubble-in'}`}
            style={{ clipPath: outbound ? 'polygon(0 0, 100% 0, 0 100%)' : 'polygon(100% 0, 0 0, 100% 100%)' }}
          />
        )}

        {isCall && <CallRow message={message} label={message.body || 'Missed voice call'} />}

        {!isCall && hasMedia && (
          <div className={`overflow-hidden ${bodyText ? 'mb-1' : ''} ${isImageOrVideo ? '-mx-0.5 -mt-0.5 rounded-lg' : ''}`}>
            <AuthedMedia message={message} onOpen={() => onOpenMedia?.(message)} />
          </div>
        )}

        {placeholder && (
          <p className={`italic text-chat-sub ${outbound ? 'pr-[68px]' : 'pr-[52px]'}`}>{placeholder}</p>
        )}
        {bodyText && (
          <p className={`whitespace-pre-wrap break-words ${outbound ? 'pr-[68px]' : 'pr-[52px]'}`}>{bodyText}</p>
        )}

        {!isCall && (
          <span className={`absolute bottom-[5px] right-2 flex select-none items-center gap-[3px] text-[11px] leading-[11px]
            ${outbound ? 'text-chat-meta' : 'text-chat-sub'}`}>
            {formatTime(message.wa_timestamp || message.created_at)}
            {outbound && <Ticks status={message.status} />}
          </span>
        )}
      </div>
    </div>
  )
}
