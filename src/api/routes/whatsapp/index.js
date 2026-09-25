import { Hono } from 'hono'
import { requireAuth } from '../../middleware/requireAuth.js'
import { ok } from '../../utils/response.js'
import { signMediaTicket } from '../../services/whatsapp/mediaTicket.js'
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
whatsapp.get('/media-ticket', requireAuth, async (c) => {
  const ticket = await signMediaTicket(c.env.WHATSAPP_APP_SECRET)
  return ok(c, { ticket })
})

// Inbox data routes are dashboard-only.
whatsapp.use('/conversations', requireAuth)
whatsapp.use('/conversations/*', requireAuth)
whatsapp.route('/conversations', conversations)

export default whatsapp
