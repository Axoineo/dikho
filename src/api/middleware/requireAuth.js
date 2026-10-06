import { HTTPException } from 'hono/http-exception'
import { logEvent } from '../utils/logger.js'

// The dashboard already authenticates with Supabase, so the API trusts the
// same session: the browser sends its Supabase access token and the Worker
// validates it against Supabase before touching D1 or the Meta API.
//
// Without this, /api/campaigns/send would be an open endpoint that spends
// real WhatsApp message quota for anyone who finds the URL.
//
// One request does all of it: public.my_access() is called through PostgREST
// WITH THE CALLER'S TOKEN. PostgREST verifies the token's signature and
// expiry; the function then checks that the token's session still exists
// (signing out, or an administrator ending it, deletes that row), that the
// person has an active staff record and is not banned, and returns their
// effective permissions. Nothing is cached, so a suspension, a forced
// sign-out or a permission change applies to the very next request.
// See docs/decisions/0007-user-management-and-permissions.md.
const TIMEOUT_MS = 10_000

export async function requireAuth(c, next) {
  const header = c.req.header('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw new HTTPException(401, { message: 'Missing bearer token' })

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = c.env
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new HTTPException(500, { message: 'Auth is not configured on the server' })
  }

  let res
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_access`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // Fail closed: no verdict on the session means no access.
    throw new HTTPException(503, { message: 'Could not verify the session. Please try again.' })
  }
  // 401/403: PostgREST rejected the token itself. Anything else (404 when the
  // database has not been updated for this version, 5xx when it is down) is
  // not the caller's fault, and a 401 would sign them out for nothing.
  if (res.status === 401 || res.status === 403) {
    throw new HTTPException(401, { message: 'Invalid or expired session' })
  }
  if (!res.ok) {
    throw new HTTPException(503, { message: 'Dikho is being updated or is temporarily unavailable. Please try again shortly.' })
  }

  const access = await res.json().catch(() => null)
  if (!access || typeof access !== 'object') {
    throw new HTTPException(401, { message: 'Invalid or expired session' })
  }
  if (access.status === 'signed_out' || access.status === 'session_ended') {
    throw new HTTPException(401, { message: 'Your session has ended. Please sign in again.' })
  }
  if (access.status !== 'active' || typeof access.user_id !== 'string') {
    throw new HTTPException(403, { message: 'This account does not have access to the Dikho workspace.' })
  }

  const permissions = access.permissions && typeof access.permissions === 'object' ? access.permissions : {}
  c.set('user', {
    id: access.user_id,
    email: access.email ?? null,
    sessionId: access.session_id ?? null,
    systemRole: access.system_role,
    developerLevel: access.developer_level ?? null,
    permissions,
  })
  await next()
}

/** True when the verified user holds `key` at any scope. */
export function can(user, key) {
  const scope = user?.permissions?.[key]
  return typeof scope === 'string' && scope !== 'none'
}

// Route guard, used after requireAuth. Passes when the user holds ANY of the
// given permissions. The database re-checks on every write it owns; this is
// the gate for the D1 and Meta routes, where the Worker is the only check.
export function requirePermission(...keys) {
  return async (c, next) => {
    const user = c.get('user')
    if (!keys.some((key) => can(user, key))) {
      logEvent('access.permission_denied', { user_id: user?.id ?? null, need: keys.join('|'), path: new URL(c.req.url).pathname })
      throw new HTTPException(403, { message: 'You do not have permission to do this.' })
    }
    await next()
  }
}
