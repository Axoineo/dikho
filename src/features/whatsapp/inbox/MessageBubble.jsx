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

/* Compact, WhatsApp-sized bubbles: 14.2px text on a 19px line, 5px above and
   below it, so a one-line message is 29px tall; 2px between bubbles in a run
   and 12px where the sender changes. The clock sits ON the last line of text,
   sharing its baseline, rather than hanging below it.
   Preflight is off here, so every <p> must say m-0: the UA's 1em margins are
   what used to make a one-word message 54px tall, with its clock alone on a
   second line. */
export function MessageBubble({ message, onOpenMedia, grouped = true, searchTerm = '' }) {
  const outbound = message.direction === 'outbound'
  const hasMedia = message.type !== 'text' && (message.media_url || message.media_status)
  const isImageOrVideo = (message.media_mime || '').startsWith('image/') || (message.media_mime || '').startsWith('video/')
  const isCall = message.type === 'call' || /^missed (voice|video) call$/i.test(message.body || '')
  const placeholder = placeholderLabel(message.body)
  const bodyText = placeholder ? null : message.body
  const mediaOnly = (hasMedia || isCall) && !bodyText && !placeholder
  // Pictures and files sit in a 3px frame, the way WhatsApp draws them; text
  // gets the full padding. A captionless file keeps a strip under its card
  // for the clock. Over a captionless picture the clock rides the image.
  const framed = !isCall && hasMedia
  const overImage = mediaOnly && isImageOrVideo
  const fileOnly = framed && mediaOnly && !isImageOrVideo
  const padding = !framed ? 'py-[5px] pl-[9px] pr-[7px]' : fileOnly ? 'p-[3px] pb-[20px]' : 'p-[3px]'

  const meta = (
    <>
      <span>{formatTime(message.wa_timestamp || message.created_at)}</span>
      {outbound && <Ticks status={message.status} mediaOnly={overImage} />}
    </>
  )
  // The clock is drawn in the corner, absolutely. The last line of text makes
  // room for it with an invisible copy of the same clock, so the reserved gap
  // is exactly as wide as the time and ticks really are: a short message keeps
  // its clock on the same line, and a full line pushes it onto a new one.
  const spacer = (
    <span aria-hidden="true" className="invisible ml-[6px] inline-flex h-0 select-none items-center gap-[3px] overflow-hidden align-baseline text-[11px]">
      {meta}
    </span>
  )
  const textPadding = framed ? 'pl-[6px] pr-[4px] pt-[4px] pb-[2px]' : ''

  return (
    <div className={`flex px-[9px] ${grouped ? 'mt-3' : 'mt-[2px]'} ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        /* w-fit so the bubble is only as wide as its content: a six-digit OTP
           gets a six-digit bubble. Pictures are capped at their own width so a
           long caption wraps under the image instead of widening past it. */
        className={`relative w-fit rounded-bubble shadow-bubble text-[14.2px] leading-[19px] ${padding}
          ${framed && isImageOrVideo ? 'max-w-[min(85%,286px)]' : 'max-w-[85%] md:max-w-[75%] xl:max-w-[65%]'}
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

        {framed && (
          <div className="overflow-hidden rounded-[6px]">
            <AuthedMedia message={message} onOpen={() => onOpenMedia?.(message)} />
          </div>
        )}

        {placeholder && (
          <p className={`m-0 italic text-chat-sub ${textPadding}`}>
            {placeholder}
            {spacer}
          </p>
        )}
        {bodyText && (
          <p className={`m-0 whitespace-pre-wrap break-words ${textPadding}`}>
            {highlight(bodyText, searchTerm)}
            {spacer}
          </p>
        )}

        {/* Over a picture the clock needs its own ground: on a white sky it
            vanished, and the ticks with it. A scrim only under the corner it
            occupies, so the image is otherwise untouched. */}
        {overImage && (
          <span aria-hidden="true" className="media-scrim pointer-events-none absolute inset-x-[3px] bottom-[3px] h-11 rounded-b-[6px]" />
        )}

        {/* With text, a 19px line box at bottom-[4px] puts the clock's
            baseline exactly on the last line's (measured: the 11px clock
            centred in the same 19px box as the 14.2px text sits 1px high, and
            the bottom padding is 5px, or a caption's 3px frame plus 2px).
            Under a file card and over a picture it has a strip of its own. */}
        {!isCall && (
          <span className={`absolute z-[1] flex select-none items-center gap-[3px] text-[11px]
            ${overImage
              ? 'bottom-[6px] right-[9px] leading-[15px] text-white/95'
              : `right-[7px] ${fileOnly ? 'bottom-[3px] leading-[15px]' : 'bottom-[4px] leading-[19px]'} ${outbound ? 'text-chat-meta' : 'text-chat-sub'}`}`}>
            {meta}
          </span>
        )}

      </div>
    </div>
  )
}
