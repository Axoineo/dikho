// Publishes inbox events to a Supabase Realtime channel over HTTP. The dashboard
// SPA is already a Supabase client, so it subscribes to the same channel with
// zero extra infrastructure (no Socket.io/WS server — which cannot run on a
// stateless Worker anyway).
//
// Best-effort by design: D1 is the source of truth. A dropped broadcast never
// blocks the webhook or a reply — the next fetch reconciles the thread — so this
// only ever logs on failure and never throws.

const CHANNEL = 'wa-inbox'

export async function broadcast(env, event, payload) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return
  try {
    await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        messages: [{ topic: CHANNEL, event, payload }],
      }),
    })
  } catch (err) {
    console.error('[whatsapp.broadcast.failed]', err?.message ?? err)
  }
}
