import { AuthedMedia } from './AuthedMedia'
import { formatTime } from './inboxUtils'

// Splits a body on the active search term so the matched run can be marked.
// Case-insensitive, and the term is escaped — a customer message containing
// "(" would otherwise throw when it reached the RegExp.
function highlight(text, term) {
  if (!term || !text) return text
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = String(text).split(new RegExp(`(${safe})`, 'ig'))
  return parts.map((part, i) =>
    part.toLowerCase() === term.toLowerCase()
      ? <mark key={i} className="inbox-hit">{part}</mark>
      : part,
  )
}

// Delivery ticks: single grey (sent), double grey (delivered), double blue (read).
function Ticks({ status, mediaOnly = false }) {
  const base = 'inline-block align-middle'
  if (status === 'read' || status === 'delivered') {
    // On a photo the tick rides the scrim, where the light-mode blue would be
    // as lost as the clock was; a brighter blue holds up against the image.
    const readTone = mediaOnly ? 'text-[#7cd0f5]' : 'text-chat-tick'
    return (
      /* Pulled apart: at the original spacing the two checks read as one
         thick glyph at 11px, so "delivered" and "read" looked identical. */
      <svg viewBox="0 0 20 12" width="17" height="11" className={`${base} ${status === 'read' ? readTone : ''}`} fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 6.6l3.1 3.1L10.4 3.2" /><path d="M8.2 9.7L14.9 3.2" />
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

export function MessageBubble({ message, onOpenMedia, grouped = true, searchTerm = '' }) {
  const outbound = message.direction === 'outbound'
  const hasMedia = message.type !== 'text' && (message.media_url || message.media_status)
  const isImageOrVideo = (message.media_mime || '').startsWith('image/') || (message.media_mime || '').startsWith('video/')
  const isCall = message.type === 'call' || /^missed (voice|video) call$/i.test(message.body || '')
  const placeholder = placeholderLabel(message.body)
  const bodyText = placeholder ? null : message.body
  const mediaOnly = (hasMedia || isCall) && !bodyText && !placeholder

  return (
    <div className={`flex px-2 sm:px-4 ${grouped ? 'mt-2' : 'mt-[3px]'} ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        /* w-fit so the bubble is only as wide as its content — a six-digit OTP
           gets a six-digit bubble. The cap is a reading measure (32rem) rather
           than a share of the pane, so a long paragraph stays legible instead
           of stretching across a wide monitor. */
        className={`relative w-fit max-w-[min(72%,23rem)] rounded-bubble shadow-bubble pb-[5px] pl-[7px] pr-[6px] pt-[4px] text-[13.4px] leading-[18px]
          ${mediaOnly ? 'pb-[19px]' : ''}
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
          <div className={`overflow-hidden ${bodyText ? 'mb-1' : ''} ${isImageOrVideo ? '-mx-0.5 -mt-0.5 rounded-lg' : ''}
            ${mediaOnly && !isImageOrVideo ? 'mb-3' : ''}`}>
            <AuthedMedia message={message} onOpen={() => onOpenMedia?.(message)} />
          </div>
        )}

        {/* The timestamp is absolutely placed, and the last text line reserves
            room for it with an inline spacer rather than the whole paragraph
            carrying right padding. Padding indents EVERY line, which on a
            multi-line message left a ragged empty column down the right side;
            the spacer only affects the line the clock actually sits on. */}
        {placeholder && (
          <p className="italic text-chat-sub">
            {placeholder}
            <span aria-hidden="true" className={`inline-block h-0 ${outbound ? 'w-[54px]' : 'w-[38px]'}`} />
          </p>
        )}
        {bodyText && (
          <p className="whitespace-pre-wrap break-words">
            {highlight(bodyText, searchTerm)}
            <span aria-hidden="true" className={`inline-block h-0 ${outbound ? 'w-[54px]' : 'w-[38px]'}`} />
          </p>
        )}

        {/* Over a picture the clock needs its own ground — on a white sky it
            vanished, and the ticks with it. A scrim only under the corner it
            occupies, so the image is otherwise untouched. */}
        {mediaOnly && isImageOrVideo && (
          <span aria-hidden="true" className="media-scrim pointer-events-none absolute inset-x-0 bottom-0 h-11 rounded-b-bubble" />
        )}

        {!isCall && (
          <span className={`absolute bottom-[4px] right-[7px] z-[1] flex select-none items-center gap-[5px] text-[10.5px] leading-[10px]
            ${mediaOnly && isImageOrVideo
              ? 'text-white/95'
              : outbound ? 'text-chat-meta' : 'text-chat-sub'}`}>
            {formatTime(message.wa_timestamp || message.created_at)}
            {outbound && <Ticks status={message.status} mediaOnly={mediaOnly && isImageOrVideo} />}
          </span>
        )}

      </div>
    </div>
  )
}
