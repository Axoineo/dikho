import { useCallback, useState } from 'react'
import { AuthedMedia } from './AuthedMedia'
import { formatTime } from './inboxUtils'
import { MessageMenu } from './MessageMenu'
import { RichBody, ReferralBanner } from './RichContent'
import { isRichKind, parsePayload, snippet } from './messageModel'

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

const GLYPH = {
  star: <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-label="Starred"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" /></svg>,
  pin: <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-label="Pinned"><path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" /><path d="M12 16v5" /></svg>,
  forward: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5V20" /></svg>,
  mic: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm6-3a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.93V22h2v-2.07A8 8 0 0 0 20 12h-2z" /></svg>,
}

// The message a reply quotes, inside the bubble; a tap jumps to it.
function Quote({ quoted, author, mine, onJump }) {
  return (
    <button type="button" onClick={onJump} title="Go to the quoted message"
      className="flex w-full min-w-0 overflow-hidden rounded-[6px] bg-chat-quote text-left">
      <span className={`w-1 shrink-0 ${mine ? 'bg-chat-quote-you' : 'bg-chat-quote-them'}`} />
      <span className="min-w-0 px-2 py-[5px]">
        <span className={`block truncate text-[12.8px] font-semibold ${mine ? 'text-chat-quote-you' : 'text-chat-quote-them'}`}>{author}</span>
        <span className="line-clamp-2 text-[13px] leading-[18px] text-chat-secondary">{snippet(quoted)}</span>
      </span>
    </button>
  )
}

// The latest reaction from each side, under the bubble's bottom edge.
function ReactionBadge({ reactions, outbound }) {
  const { customer, business } = reactions
  const emojis = customer && business && customer === business ? [customer] : [customer, business].filter(Boolean)
  if (!emojis.length) return null
  const title = [customer && `Customer reacted ${customer}`, business && `You reacted ${business}`].filter(Boolean).join(' · ')
  return (
    <span title={title} aria-label={title}
      className={`absolute -bottom-[17px] ${outbound ? 'right-2' : 'left-2'} z-[2] flex items-center gap-0.5 rounded-full border border-chat-canvas bg-chat-raised px-1.5 text-[14px] leading-[22px] text-chat-sub shadow-bubble`}>
      {emojis.map((e) => <span key={e}>{e}</span>)}
      {customer && business && customer === business && <span className="text-[11.5px] tabular-nums">2</span>}
    </span>
  )
}

export function MessageBubble({
  message, onOpenMedia, grouped = true, searchTerm = '',
  reactions = null, quoted = null, quotedAuthor = '', quotedMine = false, onJumpTo,
  highlighted = false, menu = null,
}) {
  const [menuAt, setMenuAt] = useState(null)
  const closeMenu = useCallback(() => setMenuAt(null), [])
  const outbound = message.direction === 'outbound'
  const payload = parsePayload(message)
  const rich = isRichKind(payload)
  const voice = payload?.kind === 'voice'
  const hasMedia = !rich && message.type !== 'text' && (message.media_url || message.media_status)
  const isImageOrVideo = (message.media_mime || '').startsWith('image/') || (message.media_mime || '').startsWith('video/')
  const isCall = message.type === 'call' || /^missed (voice|video) call$/i.test(message.body || '')
  const placeholder = rich ? null : placeholderLabel(message.body)
  const bodyText = rich || placeholder ? null : message.body
  const mediaOnly = (hasMedia || isCall) && !bodyText && !placeholder
  // Pictures and files sit in a 3px frame, the way WhatsApp draws them; text
  // gets the full padding; rich content lays out its own sections. A
  // captionless file keeps a strip under its card for the clock. Over a
  // captionless picture the clock rides the image.
  const framed = !isCall && Boolean(hasMedia)
  const overImage = mediaOnly && isImageOrVideo
  const fileOnly = framed && mediaOnly && !isImageOrVideo
  const layout = rich ? 'rich' : framed ? 'framed' : 'text'
  const padding = layout === 'rich' ? '' : layout === 'text' ? 'py-[5px] pl-[9px] pr-[7px]' : fileOnly ? 'p-[3px] pb-[20px]' : 'p-[3px]'
  const showReactions = reactions && (reactions.customer || reactions.business)

  const meta = (
    <>
      {Boolean(message.starred) && GLYPH.star}
      {message.pinned_at && GLYPH.pin}
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
  // With text, a 19px line box at bottom-[4px] puts the clock's baseline
  // exactly on the last line's (measured: the 11px clock centred in the same
  // 19px box as the 14.2px text sits 1px high, and the bottom padding is 5px,
  // or a caption's 3px frame plus 2px). Under a card and over a picture it
  // has a strip of its own.
  const tone = overImage ? 'text-white/95' : outbound ? 'text-chat-meta' : 'text-chat-sub'
  function renderMeta(mode) {
    const place = overImage ? 'bottom-[6px] right-[9px] leading-[15px]'
      : mode === 'strip' ? 'bottom-[3px] right-[7px] leading-[15px]'
      : 'bottom-[4px] right-[7px] leading-[19px]'
    return <span className={`absolute z-[1] flex select-none items-center gap-[3px] text-[11px] ${place} ${tone}`}>{meta}</span>
  }
  const textPadding = framed ? 'pl-[6px] pr-[4px] pt-[4px] pb-[2px]' : ''
  const renderText = (text) => highlight(text, searchTerm)

  // Quote and ad banner sit 3px from the bubble's edges in every layout.
  const headerBlocks = (quoted || payload?.referral) && (
    <div className={`flex flex-col gap-[3px] ${layout === 'text' ? '-ml-[6px] -mr-[4px] -mt-[2px] mb-[4px]' : layout === 'framed' ? 'mb-[3px]' : 'm-[3px] mb-0'}`}>
      {payload?.referral && <ReferralBanner referral={payload.referral} />}
      {quoted && <Quote quoted={quoted} author={quotedAuthor} mine={quotedMine} onJump={() => onJumpTo?.(quoted.id)} />}
    </div>
  )
  const forwarded = payload?.forwarded && (
    <div className={`flex items-center gap-1 text-[12.5px] italic text-chat-secondary ${layout === 'text' ? '-mt-[1px] mb-[1px]' : layout === 'framed' ? 'px-[6px] pt-[2px] pb-[3px]' : 'px-[9px] pt-[5px]'}`}>
      {GLYPH.forward}{payload.forwarded === 'many' ? 'Forwarded many times' : 'Forwarded'}
    </div>
  )

  function openMenu(e, alignRight) {
    setMenuAt({ rect: e.currentTarget.getBoundingClientRect(), alignRight })
  }

  const reactButton = menu?.reactions?.enabled && (
    <button
      type="button"
      title="React"
      aria-label="React to this message"
      onClick={(e) => openMenu(e, outbound)}
      className="mx-1.5 grid h-7 w-7 shrink-0 place-items-center self-center rounded-full bg-chat-raised text-chat-sub opacity-0 shadow-bubble transition-opacity hover:text-chat-text focus-visible:opacity-100 group-hover/row:opacity-100"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" strokeLinecap="round" /><circle cx="9" cy="10" r="0.8" fill="currentColor" /><circle cx="15" cy="10" r="0.8" fill="currentColor" /></svg>
    </button>
  )

  return (
    <div
      data-message-id={message.id}
      className={`group/row flex items-start px-[9px] ${grouped ? 'mt-3' : 'mt-[2px]'} ${showReactions ? 'mb-[17px]' : ''} ${outbound ? 'justify-end' : 'justify-start'}`}
    >
      {outbound && reactButton}
      <div
        /* w-fit so the bubble is only as wide as its content: a six-digit OTP
           gets a six-digit bubble. Pictures are capped at their own width so a
           long caption wraps under the image instead of widening past it. */
        className={`group/bubble relative w-fit rounded-bubble shadow-bubble text-[14.2px] leading-[19px] transition-shadow ${padding} ${outbound ? 'bubble-out' : 'bubble-in'}
          ${framed && isImageOrVideo ? 'max-w-[min(85%,286px)]' : 'max-w-[85%] md:max-w-[75%] xl:max-w-[65%]'}
          ${highlighted ? 'ring-2 ring-chat-tick' : ''}
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

        {menu && (
          <button
            type="button"
            title="Message options"
            aria-label="Message options"
            aria-haspopup="menu"
            aria-expanded={Boolean(menuAt)}
            onClick={(e) => openMenu(e, true)}
            className={`absolute right-[3px] top-[3px] z-[3] grid h-[22px] w-[22px] place-items-center rounded-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover/bubble:opacity-100
              ${menuAt ? 'opacity-100' : ''}
              ${overImage || (framed && isImageOrVideo && !bodyText) ? 'bg-black/35 text-white'
                : outbound ? 'bg-chat-bubble-out text-chat-meta shadow-[-6px_0_8px_2px_var(--chat-bubble-out)]'
                : 'bg-chat-bubble-in text-chat-sub shadow-[-6px_0_8px_2px_var(--chat-bubble-in)]'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        )}

        {forwarded}
        {headerBlocks}

        {isCall && <CallRow message={message} label={message.body || 'Missed voice call'} />}

        {rich && <RichBody payload={payload} renderMeta={renderMeta} spacer={spacer} renderText={renderText} />}

        {framed && (
          voice ? (
            <div className="flex items-center gap-2 pl-1.5 pr-1 pt-1">
              <span className="shrink-0 text-chat-action" title="Voice message">{GLYPH.mic}</span>
              <AuthedMedia message={message} onOpen={() => onOpenMedia?.(message)} />
            </div>
          ) : (
            <div className="overflow-hidden rounded-[6px]">
              <AuthedMedia message={message} onOpen={() => onOpenMedia?.(message)} />
            </div>
          )
        )}

        {placeholder && (
          <p className={`m-0 italic text-chat-secondary ${textPadding}`}>
            {placeholder}
            {spacer}
          </p>
        )}
        {bodyText && (
          <p className={`m-0 whitespace-pre-wrap break-words ${textPadding}`}>
            {renderText(bodyText)}
            {spacer}
          </p>
        )}

        {/* Over a picture the clock needs its own ground: on a white sky it
            vanished, and the ticks with it. A scrim only under the corner it
            occupies, so the image is otherwise untouched. */}
        {overImage && (
          <span aria-hidden="true" className="media-scrim pointer-events-none absolute inset-x-[3px] bottom-[3px] h-11 rounded-b-[6px]" />
        )}

        {!isCall && !rich && renderMeta(fileOnly ? 'strip' : 'text')}

        {showReactions && <ReactionBadge reactions={reactions} outbound={outbound} />}
      </div>
      {!outbound && reactButton}

      {menuAt && menu && (
        <MessageMenu
          anchor={menuAt.rect}
          alignRight={menuAt.alignRight}
          reactions={menu.reactions}
          myReaction={reactions?.business ?? null}
          items={menu.items}
          onReact={(emoji) => { closeMenu(); menu.onReact(emoji) }}
          onAction={(key) => { closeMenu(); menu.onAction(key) }}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}
