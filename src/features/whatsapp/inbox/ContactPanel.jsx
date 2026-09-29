import { useState } from 'react'
import { Avatar } from './Avatar'
import { useMediaSrc } from './MediaTicketContext'
import { displayName, sessionMsLeft, formatCountdown, formatLastActive } from './inboxUtils'

function Block({ label, value, onCopy }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(onCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked — the value is selectable anyway */ }
  }
  return (
    <div className="group flex items-start gap-2 rounded-2xl bg-inbox-panel px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">{label}</div>
        <div className="mt-1 break-words text-[13.5px] text-ink">{value || '—'}</div>
      </div>
      {onCopy && (
        <button
          type="button"
          onClick={copy}
          title={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-inbox-control hover:text-ink"
        >
          {copied
            ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>}
        </button>
      )}
    </div>
  )
}

/* Third pane. CHROME, so it follows the dashboard: a surface panel with
   rounded blocks, matching the rail's radii and tints. */
export function ContactPanel({ conversation, messages, onOpenMedia }) {
  const { srcFor } = useMediaSrc()
  if (!conversation) return null

  const msLeft = sessionMsLeft(conversation.last_inbound_at)
  const media = messages.filter(
    (m) => m.media_status === 'ready' && m.media_url && (m.media_mime || '').startsWith('image/'),
  )

  return (
    <aside className="hidden w-[320px] shrink-0 flex-col border-l border-inbox-divider bg-inbox-list xl:flex">
      <div className="flex h-16 shrink-0 items-center border-b border-line px-5 text-[14.5px] font-semibold text-ink">
        Contact info
      </div>

      <div className="inbox-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        <div className="flex flex-col items-center rounded-2xl bg-inbox-panel px-5 pb-5 pt-6 text-center">
          <Avatar name={conversation.wa_name || conversation.contact_name} phone={conversation.phone} avatarUrl={conversation.avatar_url} size={88} />
          <div className="mt-3 text-[16px] font-semibold text-ink">{displayName(conversation)}</div>
          <div className="mt-0.5 text-[13px] text-muted">+{conversation.phone}</div>
          {msLeft > 0 ? (
            <span className="mt-3 flex items-center gap-1.5 rounded-full bg-inbox-chip px-3 py-1 text-[12px] font-semibold text-brand">
              <span className="h-1.5 w-1.5 rounded-full bg-current" /> Replies open · {formatCountdown(msLeft)} left
            </span>
          ) : (
            <span className="mt-3 flex items-center gap-1.5 rounded-full bg-tint-warn px-3 py-1 text-[12px] font-semibold text-amber-700 dark:text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-current" /> Window closed · templates only
            </span>
          )}
        </div>

        <Block label="Phone" value={`+${conversation.phone}`} onCopy={`+${conversation.phone}`} />
        <Block label="Last active" value={formatLastActive(conversation.last_inbound_at)} />

        {media.length > 0 && (
          <div className="rounded-2xl bg-inbox-panel px-4 py-3.5">
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
              Media · {media.length}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {media.slice(-12).reverse().map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onOpenMedia?.(m)}
                  aria-label="Open media"
                  className="aspect-square overflow-hidden rounded-xl bg-inbox-field"
                >
                  <img src={srcFor(m.media_url)} alt="" className="h-full w-full object-cover transition-transform hover:scale-105" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
