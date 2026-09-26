import { useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

// Subscribes to the shared `wa-inbox` Supabase Realtime channel that the API
// Worker broadcasts to after every D1 write. Pass stable callbacks (useCallback)
// so the channel is not rebuilt on every render.
//
// This is the whole "WebSocket engine" on the client — Supabase Realtime rides a
// single multiplexed WS connection, so there is no server to run by hand.
export function useInboxRealtime({
  onNewMessage, onMessageUpdated, onStatus, onConversationUpdated, onResync,
  onCallIncoming, onCallEnded, onCallClaimed,
}) {
  useEffect(() => {
    const channel = supabase
      .channel('wa-inbox')
      .on('broadcast', { event: 'message:new' }, ({ payload }) => onNewMessage?.(payload))
      .on('broadcast', { event: 'message:updated' }, ({ payload }) => onMessageUpdated?.(payload))
      .on('broadcast', { event: 'status:update' }, ({ payload }) => onStatus?.(payload))
      .on('broadcast', { event: 'conversation:updated' }, ({ payload }) => onConversationUpdated?.(payload))
      // Voice calls. `call:incoming` carries Meta's SDP offer and is the one
      // event here with a deadline — the Worker sends it before it does any
      // bookkeeping, because a ringing call is dead in ~30 seconds and
      // redelivery cannot save it the way it saves a message.
      .on('broadcast', { event: 'call:incoming' }, ({ payload }) => onCallIncoming?.(payload))
      .on('broadcast', { event: 'call:ended' }, ({ payload }) => onCallEnded?.(payload))
      .on('broadcast', { event: 'call:claimed' }, ({ payload }) => onCallClaimed?.(payload))
      // Broadcasts are fire-and-forget: anything sent while the socket was
      // down is simply gone, never replayed. SUBSCRIBED fires on the initial
      // connect *and* on every reconnect, which is exactly when the client
      // has to reconcile against D1 rather than assume it kept up.
      .subscribe((status) => { if (status === 'SUBSCRIBED') onResync?.() })

    return () => { supabase.removeChannel(channel) }
  }, [onNewMessage, onMessageUpdated, onStatus, onConversationUpdated, onResync,
      onCallIncoming, onCallEnded, onCallClaimed])
}
