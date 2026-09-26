import { Avatar } from './Avatar'
import { useMediaSrc } from './MediaTicketContext'
import { displayName, sessionMsLeft, formatCountdown, formatLastActive } from './inboxUtils'

function Row({ label, value }) {
  return (
    <div className="px-5 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 break-words text-[13.5px] text-ink">{value || '—'}</div>
    </div>
  )
}

// Right-hand details panel (the third pane). Read-only summary of the customer
// plus a shared-media grid, built entirely from data we already have — no extra
// API calls. Collapsible from the conversation header.
export function ContactPanel({ conversation, messages, onOpenMedia }) {
  const { srcFor } = useMediaSrc()
  if (!conversation) return null

  const msLeft = sessionMsLeft(conversation.last_inbound_at)
  const media = messages.filter(
    (m) => m.media_status === 'ready' && m.media_url && (m.media_mime || '').startsWith('image/'),
  )

  return (
    <aside className="hidden w-[300px] shrink-0 flex-col border-l border-line bg-chat-shell xl:flex">
      <div className="flex flex-col items-center px-5 pb-5 pt-8 text-center">
        <Avatar name={conversation.wa_name || conversation.contact_name} phone={conversation.phone} avatarUrl={conversation.avatar_url} size={92} />
        <div className="mt-3 text-[16px] font-semibold text-ink">{displayName(conversation)}</div>
        <div className="mt-0.5 text-[13px] text-muted">+{conversation.phone}</div>
        {msLeft > 0 ? (
          <span className="mt-3 flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active · {formatCountdown(msLeft)} left
          </span>
        ) : (
          <span className="mt-3 flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-[12px] font-medium text-amber-600 dark:text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Session closed
          </span>
        )}
      </div>

      <div className="border-t border-line">
        <Row label="Name" value={conversation.wa_name || conversation.contact_name} />
        <Row label="Phone" value={`+${conversation.phone}`} />
        <Row label="Last active" value={formatLastActive(conversation.last_inbound_at)} />
      </div>

      {media.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-5 py-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
            Shared media · {media.length}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {media.slice(-12).reverse().map((m) => (
              <button key={m.id} type="button" onClick={() => onOpenMedia?.(m)} className="aspect-square overflow-hidden rounded-lg bg-line-soft">
                <img src={srcFor(m.media_url)} alt="" className="h-full w-full object-cover transition-transform hover:scale-105" />
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
