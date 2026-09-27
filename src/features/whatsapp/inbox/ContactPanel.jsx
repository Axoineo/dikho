import { Avatar } from './Avatar'
import { useMediaSrc } from './MediaTicketContext'
import { displayName, sessionMsLeft, formatCountdown, formatLastActive } from './inboxUtils'

function Block({ label, value }) {
  return (
    <div className="mt-2.5 bg-chat-shell px-5 py-3.5">
      <div className="text-[13px] text-chat-sub">{label}</div>
      <div className="mt-0.5 break-words text-[15px] text-chat-text">{value || '—'}</div>
    </div>
  )
}

// Right-hand details panel (the third pane), laid out like WhatsApp's contact
// info drawer: a card on the canvas, then stacked blocks. Read-only summary
// built entirely from data we already have — no extra API calls.
export function ContactPanel({ conversation, messages, onOpenMedia }) {
  const { srcFor } = useMediaSrc()
  if (!conversation) return null

  const msLeft = sessionMsLeft(conversation.last_inbound_at)
  const media = messages.filter(
    (m) => m.media_status === 'ready' && m.media_url && (m.media_mime || '').startsWith('image/'),
  )

  return (
    <aside className="hidden w-[340px] shrink-0 flex-col border-l border-chat-ring bg-chat-canvas xl:flex">
      <div className="flex h-[59px] shrink-0 items-center px-5 text-[16px] text-chat-text bg-chat-bar">Contact info</div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center bg-chat-shell px-5 pb-6 pt-7 text-center">
          <Avatar name={conversation.wa_name || conversation.contact_name} phone={conversation.phone} avatarUrl={conversation.avatar_url} size={100} />
          <div className="mt-3 text-[19px] text-chat-text">{displayName(conversation)}</div>
          <div className="mt-0.5 text-[15px] text-chat-sub">+{conversation.phone}</div>
          {msLeft > 0 ? (
            <span className="mt-3 flex items-center gap-1.5 rounded-full bg-chat-chip px-3 py-1 text-[12.5px] font-medium text-chat-accent-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-current" /> Replies open · {formatCountdown(msLeft)} left
            </span>
          ) : (
            <span className="mt-3 flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-[12.5px] font-medium text-amber-700 dark:text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-current" /> Window closed · templates only
            </span>
          )}
        </div>

        <Block label="Phone" value={`+${conversation.phone}`} />
        <Block label="Last active" value={formatLastActive(conversation.last_inbound_at)} />

        {media.length > 0 && (
          <div className="mt-2.5 bg-chat-shell px-5 py-4">
            <div className="mb-2.5 text-[13px] text-chat-sub">Media, links and docs · {media.length}</div>
            <div className="grid grid-cols-3 gap-[3px]">
              {media.slice(-12).reverse().map((m) => (
                <button key={m.id} type="button" onClick={() => onOpenMedia?.(m)} className="aspect-square overflow-hidden rounded bg-chat-ring">
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
