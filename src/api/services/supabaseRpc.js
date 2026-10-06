import { HTTPException } from 'hono/http-exception'
import { logError } from '../utils/logger.js'

// Calls a Postgres function through PostgREST with the SERVICE-ROLE key.
//
// Why the service-role key and not the anon key: the public write RPCs used to
// have EXECUTE granted to `anon` so the browser could call them directly, which
// meant a bot could skip the form (and therefore Turnstile) and hit the RPC.
// Migration 20260927000000_turnstile_lockdown.sql revokes that grant, leaving
// this Worker as the only caller — so the Turnstile check in front of it is
// actually load-bearing rather than advisory.
//
// The service-role key bypasses RLS entirely. It must never reach the browser:
// it lives only as a Worker secret (SUPABASE_SERVICE_ROLE_KEY), and nothing here
// echoes it back or logs it.
//
// Consistent with the rest of this Worker, which talks to Supabase over plain
// fetch rather than pulling in @supabase/supabase-js (see middleware/requireAuth.js).
const TIMEOUT_MS = 10_000

export async function callRpc(c, fn, args) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = c.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Fail closed and loudly: without these the public forms cannot write, and
    // we would rather see a 500 than guess at a fallback that writes as anon.
    throw new HTTPException(500, { message: 'Database access is not configured on the server' })
  }

  let res
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify(args),
    })
  } catch (err) {
    logError(`rpc.${fn}.unreachable`, err)
    throw new HTTPException(503, { message: 'Could not reach the database. Please try again.' })
  }

  const text = await res.text()

  if (!res.ok) {
    // PostgREST surfaces the RPC's own `raise exception` text here (e.g.
    // "company_name is required"). Log it, but return a generic message: these
    // are validation guards the frontend already enforces, so a caller seeing
    // them is either misusing the endpoint or probing it. Only the code and
    // message are logged: PostgREST's `details` echoes submitted values (a
    // duplicate-key error quotes the key), which is form data, not diagnostics.
    let code = null
    let message = text.slice(0, 200)
    try {
      const parsed = JSON.parse(text)
      code = parsed?.code ?? null
      message = String(parsed?.message ?? '').slice(0, 200)
    } catch { /* non-JSON body: keep the truncated text, scrubbed by the logger */ }
    logError(`rpc.${fn}.failed`, `${res.status} ${code ?? ''} ${message}`.trim())
    throw new HTTPException(400, { message: 'Submission was rejected. Please check your details and try again.' })
  }

  // The vendor RPC returns a bigint id; the lead RPC returns void (empty body).
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}
