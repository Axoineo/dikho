import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireAuth, requirePermission } from '../../middleware/requireAuth.js'
import { ok } from '../../utils/response.js'
import { MEDIA_TICKET_TTL_SECONDS, mediaTicketSecret, signMediaTicket } from '../../services/whatsapp/mediaTicket.js'
import { reconcileInbound, reconcileStatuses } from '../../services/whatsapp/reconcile.js'
import { RANGES, buildAnalytics, campaignPerformance } from '../../services/whatsapp/analytics.js'
import webhook from './webhook.js'
import conversations from './conversations.js'
import media from './media.js'

const whatsapp = new Hono()

// Public: Meta's webhook authenticates itself (verify token on GET, payload
// signature on POST), so it must NOT sit behind the dashboard's requireAuth.
whatsapp.route('/webhook', webhook)

// The media route self-authenticates with a signed ticket (?t=), so it is NOT
// behind requireAuth — that lets <img>/<video>/<iframe> load it directly.
whatsapp.route('/media', media)

// Issues a media ticket to a logged-in agent. Requires a valid session.
whatsapp.get('/media-ticket', requireAuth, requirePermission('inbox.view'), async (c) => {
  const user = c.get('user')
  if (!user?.sessionId) throw new HTTPException(401, { message: 'Your session could not be identified. Please sign in again.' })
  const ticket = await signMediaTicket(mediaTicketSecret(c.env), { userId: user.id, sessionId: user.sessionId })
  return ok(c, { ticket, expiresIn: MEDIA_TICKET_TTL_SECONDS })
})

// Drains delivery receipts the webhook could not attach to a row at the time
// (see services/whatsapp/reconcile.js). A cron in wrangler.api.jsonc runs the
// same sweep; this route is the manual handle, and `?includeProcessed=1`
// widens it to receipts ACKed before the backlog flag existed.
whatsapp.post('/reconcile', requireAuth, requirePermission('whatsapp.maintain'), async (c) => {
  const includeProcessed = c.req.query('includeProcessed') === '1'
  const sinceIso = c.req.query('since') ?? null
  const result = await reconcileStatuses(c.env.DB, { includeProcessed, sinceIso })
  const inbound = await reconcileInbound(c)
  return ok(c, { ...result, inbound })
})

// The WhatsApp dashboard: everything sent and received in the last 7, 30 or 90 days,
// with the previous period for comparison, and what Meta reports. Same people as the
// old campaign stats. See services/whatsapp/analytics.js for why it is cheap to read.
whatsapp.get('/analytics', requireAuth, requirePermission('campaigns.view', 'campaigns.send'), async (c) => {
  const days = Number(c.req.query('days') ?? 30)
  if (!RANGES.includes(days)) throw new HTTPException(400, { message: 'days must be 7, 30 or 90' })
  return ok(c, await buildAnalytics(c.env, { days }))
})

// One campaign's own performance, for the dashboard's campaign page.
whatsapp.get('/analytics/campaigns/:id', requireAuth, requirePermission('campaigns.view', 'campaigns.send'), async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) throw new HTTPException(400, { message: 'Bad campaign id' })
  const result = await campaignPerformance(c.env, id)
  if (!result) throw new HTTPException(404, { message: 'Campaign not found' })
  return ok(c, result)
})

// Inbox data routes are dashboard-only.
whatsapp.use('/conversations/*', requireAuth) // Hono's /* also matches the bare path
whatsapp.route('/conversations', conversations)

export default whatsapp
