import { Hono } from 'hono'
import { requireAuth } from '../../middleware/requireAuth.js'
import webhook from './webhook.js'
import conversations from './conversations.js'
import media from './media.js'

const whatsapp = new Hono()

// Public: Meta's webhook authenticates itself (verify token on GET, payload
// signature on POST), so it must NOT sit behind the dashboard's requireAuth.
whatsapp.route('/webhook', webhook)

// Inbox routes are dashboard-only. Both the bare path and the wildcard are
// guarded because Hono's `/x/*` does not match `/x`.
whatsapp.use('/conversations', requireAuth)
whatsapp.use('/conversations/*', requireAuth)
whatsapp.use('/media/*', requireAuth)
whatsapp.route('/conversations', conversations)
whatsapp.route('/media', media)

export default whatsapp
