import { Hono } from 'hono'
import webhook from './webhook.js'

const whatsapp = new Hono()

whatsapp.route('/webhook', webhook)

// Future modules mount here the same way, each in its own file:
// import send from './send.js'
// import templates from './templates.js'
// import messages from './messages.js'
// whatsapp.route('/send', send)
// whatsapp.route('/templates', templates)
// whatsapp.route('/messages', messages)

export default whatsapp
