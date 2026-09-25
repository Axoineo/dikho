import { useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

// Subscribes to the shared `wa-inbox` Supabase Realtime channel that the API
// Worker broadcasts to after every D1 write. The handlers are refs-in-practice:
// pass stable callbacks (useCallback) so the channel is not torn down and rebuilt
// on every render.
//
// This is the whole "WebSocket engine" on the client — Supabase Realtime rides a
// single multiplexed WS connection, so there is no server to run and no socket
// to manage by hand.
export function useInboxRealtime({ onNewMessage, onMessageUpdated, onStatus }) {
  useEffect(() => {
    const channel = supabase
      .channel('wa-inbox')
      .on('broadcast', { event: 'message:new' }, ({ payload }) => onNewMessage?.(payload))
      .on('broadcast', { event: 'message:updated' }, ({ payload }) => onMessageUpdated?.(payload))
      .on('broadcast', { event: 'status:update' }, ({ payload }) => onStatus?.(payload))
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [onNewMessage, onMessageUpdated, onStatus])
}
