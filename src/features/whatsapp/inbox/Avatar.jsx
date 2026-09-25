import { useEffect, useState } from 'react'
import { getMediaUrl } from './mediaCache'
import { avatarColor, initials } from './inboxUtils'

// Circular contact avatar. Shows the agent-uploaded photo when present
// (avatar_url, served auth'd from R2), otherwise hash-colored initials — which is
// what WhatsApp itself shows when a contact has no photo. The Cloud API cannot
// provide real WhatsApp profile pictures, so uploaded photos are the only source.
export function Avatar({ name, phone, avatarUrl, size = 40, className = '' }) {
  const [src, setSrc] = useState(null)

  useEffect(() => {
    setSrc(null)
    if (!avatarUrl) return
    let alive = true
    getMediaUrl(avatarUrl).then((u) => { if (alive) setSrc(u) }).catch(() => {})
    return () => { alive = false }
  }, [avatarUrl])

  const dim = { width: size, height: size, fontSize: Math.round(size * 0.36) }

  if (src) {
    return (
      <img
        src={src}
        alt={name || phone || ''}
        style={dim}
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
