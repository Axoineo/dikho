import { useEffect, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { avatarColor, initials } from './inboxUtils'

// Floating card for a live WhatsApp voice call. Mounted once per session from
// AuthenticatedLayout, so a call rings wherever the agent happens to be in the
// CRM rather than only on the Inbox screen.
//
// Deliberately does not use inbox/Avatar: that one reads a media ticket from
// MediaTicketContext, which only exists inside the inbox. Initials are enough
// here and keep the overlay mountable anywhere.

function elapsed(startedAt) {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function CallTimer({ startedAt }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return <>{elapsed(startedAt)}</>
}

// Round action button. Preflight is off, so the background and text colour are
// both explicit — a button that sets neither falls back to the UA's buttonface
// grey and buttontext black regardless of theme.
function CallButton({ tone, label, icon, onClick, disabled }) {
  const tones = {
    accept: 'bg-[#25d366] text-white hover:bg-[#1eb855]',
    end: 'bg-[#e5484d] text-white hover:bg-[#d13c41]',
    neutral: 'bg-line-soft text-ink hover:bg-line',
  }
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-12 w-12 items-center justify-center rounded-full border-0 shadow-sm
        transition-colors disabled:opacity-50 ${tones[tone]}`}
    >
      {icon}
    </button>
  )
}

export function CallOverlay({ call, muted, onAnswer, onDecline, onHangUp, onToggleMute }) {
  if (!call) return null

  const name = call.waName || (call.phone ? `+${call.phone}` : 'Unknown caller')
  const { state } = call

  const subtitle =
    state === 'ringing' ? 'Incoming WhatsApp call'
      : state === 'connecting' ? 'Connecting…'
      : state === 'active' ? <CallTimer startedAt={call.startedAt ?? Date.now()} />
      : call.error || 'Call ended'

  return (
    <div
      role="dialog"
      aria-live="assertive"
      aria-label={`${subtitle === 'Incoming WhatsApp call' ? 'Incoming' : 'Ongoing'} call from ${name}`}
      className="fixed bottom-5 right-5 z-[120] w-[320px] max-w-[calc(100vw-2.5rem)]
        rounded-2xl border border-line bg-surface p-4 shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <span
          style={{ backgroundColor: avatarColor(name) }}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full
            text-[15px] font-semibold text-white ${state === 'ringing' ? 'animate-pulse' : ''}`}
        >
          {initials(call.waName, call.phone)}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight text-ink">{name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
            <span className="text-[#25d366]"><Icon name="whatsapp" size={13} /></span>
            {subtitle}
          </p>
        </div>
      </div>

      {call.error && state !== 'ended' && (
        <p className="mt-3 rounded-lg bg-tint-danger px-2.5 py-1.5 text-[12px] text-danger">{call.error}</p>
      )}

      <div className="mt-4 flex items-center justify-center gap-3">
        {state === 'ringing' && (
          <>
            <CallButton tone="end" label="Decline" onClick={onDecline}
              icon={<Icon name="phoneDown" size={22} />} />
            <CallButton tone="accept" label="Answer" onClick={onAnswer}
              icon={<Icon name="phone" size={21} />} />
          </>
        )}

        {state === 'connecting' && (
          <CallButton tone="end" label="Cancel" onClick={onHangUp}
            icon={<Icon name="phoneDown" size={22} />} />
        )}

        {state === 'active' && (
          <>
            <CallButton tone="neutral" label={muted ? 'Unmute' : 'Mute'} onClick={onToggleMute}
              icon={<Icon name={muted ? 'micOff' : 'mic'} size={20} />} />
            <CallButton tone="end" label="Hang up" onClick={onHangUp}
              icon={<Icon name="phoneDown" size={22} />} />
          </>
        )}
      </div>

      {state === 'active' && muted && (
        <p className="mt-2.5 text-center text-[11.5px] font-medium text-muted">
          Your microphone is muted
        </p>
      )}
    </div>
  )
}
