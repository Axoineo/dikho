import { HTTPException } from 'hono/http-exception'

// The dashboard already authenticates with Supabase, so the API trusts the
// same session: the browser sends its Supabase access token and the Worker
// validates it against Supabase before touching D1 or the Meta API.
//
// Without this, /api/campaigns/send would be an open endpoint that spends
// real WhatsApp message quota for anyone who finds the URL.
export async function requireAuth(c, next) {
  const header = c.req.header('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw new HTTPException(401, { message: 'Missing bearer token' })

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = c.env
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new HTTPException(500, { message: 'Auth is not configured on the server' })
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  })
  if (!res.ok) throw new HTTPException(401, { message: 'Invalid or expired session' })

  const user = await res.json()
  c.set('user', { id: user.id, email: user.email })
  await next()
}
