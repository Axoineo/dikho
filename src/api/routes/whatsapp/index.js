import { Hono } from 'hono'
import { requireAuth, requirePermission } from '../../middleware/requireAuth.js'
import { ok } from '../../utils/response.js'
import { signMediaTicket } from '../../services/whatsapp/mediaTicket.js'
import { reconcileInbound, reconcileStatuses } from '../../services/whatsapp/reconcile.js'
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
  const ticket = await signMediaTicket(c.env.WHATSAPP_APP_SECRET)
  return ok(c, { ticket })
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

// Inbox data routes are dashboard-only.
whatsapp.use('/conversations', requireAuth)
whatsapp.use('/conversations/*', requireAuth)
whatsapp.route('/conversations', conversations)

export default whatsapp
