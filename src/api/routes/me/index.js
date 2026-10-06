import { Hono } from 'hono'
import { ok } from '../../utils/response.js'
import { callUserRpc } from '../../services/userAdmin.js'

// Self-service routes for the signed-in person. Mounted behind requireAuth.
const me = new Hono()

// Records where this session signed in from, for "last login" and the
// sessions list in User Management. Location is Cloudflare's own lookup of
// the connecting IP (request.cf): city level at best, and wrong behind a VPN
// or on some mobile networks, which the dashboard says. The user and session
// come from the verified token, never from the request body. Idempotent: the
// first call for a session wins; later calls only fill gaps.
me.post('/session', async (c) => {
  const user = c.get('user')
  if (!user.sessionId) return ok(c, { recorded: false })
  const cf = c.req.raw.cf ?? {}
  await callUserRpc(c, 'um_record_session', {
    p_user: user.id,
    p_session: user.sessionId,
    p_ip: c.req.header('CF-Connecting-IP') ?? null,
    p_city: typeof cf.city === 'string' ? cf.city : null,
    p_region: typeof cf.region === 'string' ? cf.region : null,
    p_country: typeof cf.country === 'string' ? cf.country : null,
    p_user_agent: (c.req.header('User-Agent') ?? '').slice(0, 300),
  })
  return ok(c, { recorded: true })
})

export default me
