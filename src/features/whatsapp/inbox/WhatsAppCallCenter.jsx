import { useWhatsAppCall } from './useWhatsAppCall'
import { useInboxRealtime } from './useInboxRealtime'
import { CallOverlay } from './CallOverlay'

// Session-wide call handling: one subscription, one overlay, mounted from
// AuthenticatedLayout. A call rings on whatever CRM screen the agent is on —
// scoping this to the Inbox screen would mean every call that arrives while
// someone is on Sales Orders simply rings out unanswered.
//
// Every open dashboard tab rings. The Worker's claim decides who actually gets
// the call, and the losers dismiss themselves on `call:claimed`.
export function WhatsAppCallCenter() {
  const {
    call, muted, answer, decline, hangUp, toggleMute,
    onCallIncoming, onCallEnded, onCallClaimed,
  } = useWhatsAppCall()

  useInboxRealtime({ onCallIncoming, onCallEnded, onCallClaimed })

  return (
    <CallOverlay
      call={call}
      muted={muted}
      onAnswer={answer}
      onDecline={decline}
      onHangUp={hangUp}
      onToggleMute={toggleMute}
    />
  )
}
