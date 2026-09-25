import { useState } from 'react'
import { useMediaSrc } from './MediaTicketContext'
import { avatarColor, initials } from './inboxUtils'

// Circular contact avatar. Shows the agent-uploaded photo when present
// (avatar_url, streamed via a signed ticket URL), otherwise hash-colored
// initials — what WhatsApp itself shows when a contact has no photo. The Cloud
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
      style={{ ...dim, backgroundColor: avatarColor(name || phone || '') }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
    >
      {initials(name, phone)}
    </span>
  )
}
