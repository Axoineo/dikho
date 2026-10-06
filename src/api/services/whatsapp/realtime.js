// Publishes inbox events to a Supabase Realtime channel over HTTP. The dashboard
// SPA is already a Supabase client, so it subscribes to the same channel with
// zero extra infrastructure (no Socket.io/WS server — which cannot run on a
// stateless Worker anyway).
//
// Best-effort by design: D1 is the source of truth. A dropped broadcast never
// blocks the webhook or a reply — the next fetch reconciles the thread — so this
// only ever logs on failure and never throws.
//
// The channel is PRIVATE. Its events carry customer phone numbers and message
// text, and a public channel can be joined by anyone holding the public key
// that ships in the bundle. Private delivery is authorized by the staff policy
// on realtime.messages; the service-role key used here bypasses that policy to
// publish, so it must stay a Worker secret like everywhere else.
import { logError } from '../../utils/logger.js'

const CHANNEL = 'wa-inbox'
const TIMEOUT_MS = 5_000

export async function broadcast(env, event, payload) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return
  try {
    const res = await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        messages: [{ topic: CHANNEL, event, payload, private: true }],
      }),
    })
    if (!res.ok) logError('whatsapp.broadcast.failed', `HTTP ${res.status}`)
  } catch (err) {
    logError('whatsapp.broadcast.failed', err)
  }
}
