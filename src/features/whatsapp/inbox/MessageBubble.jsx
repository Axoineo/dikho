import { AuthedMedia } from './AuthedMedia'

function timeOf(m) {
  const iso = m.wa_timestamp || m.created_at
  if (!iso) return ''
  // D1 stores `datetime('now')` as a space-separated UTC string; normalise it.
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Delivery ticks, matching WhatsApp: single grey (sent), double grey (delivered),
// double blue (read). Failed shows a red warning; anything earlier is a clock.
function Ticks({ status }) {
  const cls = 'ml-0.5 inline-flex items-center text-[13px] leading-none'
  if (status === 'read')      return <span className={`${cls} text-[#53bdeb]`} title="Read">✓✓</span>
  if (status === 'delivered') return <span className={`${cls} text-gray-400`} title="Delivered">✓✓</span>
  if (status === 'sent')      return <span className={`${cls} text-gray-400`} title="Sent">✓</span>
  if (status === 'failed')    return <span className={`${cls} text-red-500`} title="Failed">⚠</span>
  return <span className={`${cls} text-gray-300`} title="Pending">🕓</span>
}

export function MessageBubble({ message }) {
  const outbound = message.direction === 'outbound'
  const hasMedia = message.type !== 'text' && (message.media_url || message.media_status)

  return (
    <div className={`flex px-4 py-0.5 ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] rounded-lg px-2.5 py-1.5 text-[14px] shadow-sm
          ${outbound
            ? 'rounded-tr-sm bg-[#d9fdd3] text-gray-900 dark:bg-[#005c4b] dark:text-white'
            : 'rounded-tl-sm bg-white text-gray-900 dark:bg-[#202c33] dark:text-white'}`}
      >
        {hasMedia && (
          <div className="mb-1">
            <AuthedMedia message={message} />
          </div>
        )}
        {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-gray-500 dark:text-gray-300/70">
          <span>{timeOf(message)}</span>
          {outbound && <Ticks status={message.status} />}
        </div>
      </div>
    </div>
  )
}
