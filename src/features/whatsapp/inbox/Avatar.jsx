import { useState } from 'react'
import { useMediaSrc } from './MediaTicketContext'
import { initials } from './inboxUtils'

// Circular contact avatar. Shows the agent-uploaded photo when present
// (avatar_url, streamed via a signed ticket URL), otherwise initials on the
// soft brand tint every other page uses for people. The Cloud
// API cannot provide real WhatsApp profile pictures, so uploads are the source.
export function Avatar({ name, phone, avatarUrl, size = 40, className = '' }) {
  const { srcFor } = useMediaSrc()
  const [failed, setFailed] = useState(false)
  const src = avatarUrl && !failed ? srcFor(avatarUrl) : null

  const dim = { width: size, height: size, fontSize: Math.round(size * 0.36) }

  if (src) {
    return (
      <img
        src={src}
        alt={name || phone || ''}
        style={dim}
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    )
  }

  return (
    <span
      style={dim}
      /* leading-none matters: initials otherwise sit on a text baseline and
         render a pixel or two below the circle's true centre. */
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-medium leading-none text-brand-ink ${className}`}
    >
      {initials(name, phone)}
    </span>
  )
}
