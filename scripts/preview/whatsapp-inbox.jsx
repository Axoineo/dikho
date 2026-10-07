// Preview of the WhatsApp inbox with synthetic chats. Every API call is
// answered here from memory and nothing leaves the page: fetch is stubbed, and
// so is WebSocket, so the Realtime client never reaches a real Supabase even if
// this runs with the real .env.local. Clear, delete, block and unblock change
// the in-memory data the way the API changes D1, so the flows can be tried.
//
//   ?theme=dark            dark mode
//   ?open=Riya             open the first chat whose name contains this
//   ?perms=view,reply      inbox permissions to hold (default: all four)
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Same stylesheets, in the same order, as src/main.jsx, so the page renders
// here exactly as it does in the app.
import '../../src/index.css'
import '../../src/components/ContactDetails.css'
import '../../src/tailwind.css'
import Workspace from './Workspace.jsx'

const params = new URLSearchParams(window.location.search)
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'

// The Realtime client opens a socket on subscribe. Here it opens nothing.
window.WebSocket = class {
  constructor() { this.readyState = 3 }
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

const MIN = 60_000
const HOUR = 60 * MIN
const now = Date.now()
const at = (msAgo) => new Date(now - msAgo).toISOString()

let nextId = 100
function msg(conversationId, direction, msAgo, body, extra = {}) {
  const id = nextId++
  return {
    id,
    conversation_id: conversationId,
    meta_message_id: `wamid.preview.${id}`,
    direction,
    type: 'text',
    body,
    status: direction === 'inbound' ? 'received' : 'read',
    wa_timestamp: at(msAgo),
    created_at: at(msAgo),
    ...extra,
  }
}

const DAY = 24 * HOUR
const conversations = [
  { id: 1, phone: '919800000001', wa_name: 'Riya Kapoor', last_inbound_at: at(6 * MIN), unread_count: 0 },
  { id: 2, phone: '919800000002', wa_name: 'Arjun Mehta', last_inbound_at: at(3 * MIN), unread_count: 2 },
  { id: 3, phone: '919800000003', wa_name: 'Lotus Events', last_inbound_at: at(20 * HOUR), unread_count: 0 },
  { id: 4, phone: '919800000004', wa_name: null, last_inbound_at: at(5 * HOUR), unread_count: 0, blocked_at: at(4 * HOUR) },
  { id: 5, phone: '919800000005', wa_name: 'Nikhil Rao', last_inbound_at: at(3 * DAY), unread_count: 0 },
].map((c) => ({ status: 'open', cleared_through_id: 0, blocked_at: null, contact_name: null, avatar_url: null, ...c }))

const messages = [
  msg(1, 'inbound', DAY + 40 * MIN, 'Hi, is the MG Road hoarding free in November?'),
  msg(1, 'outbound', DAY + 38 * MIN, 'Hi Riya! Yes, both faces are open from 1 Nov.'),
  msg(1, 'outbound', DAY + 38 * MIN, 'Want me to hold it for you?'),
  msg(1, 'inbound', DAY + 35 * MIN, 'Yes please'),
  msg(1, 'inbound', DAY + 35 * MIN, 'Can you also share the rate card?'),
  msg(1, 'outbound', DAY + 29 * MIN, null, {
    type: 'document', media_url: '/api/whatsapp/media/preview-rate-card', media_mime: 'application/pdf',
    media_filename: 'Rate card November.pdf', media_size: 482_000, media_status: 'ready',
  }),
  msg(1, 'inbound', 14 * MIN, 'Got it, thanks'),
  msg(1, 'inbound', 13 * MIN, 'We will go with the 40x20 one. Can the creative go up by the 3rd? Our launch event is on the 5th, so we need at least two days of visibility before it.'),
  msg(1, 'outbound', 11 * MIN, 'Done. Printing takes a day, so send the final artwork by the 1st and it goes up on the 2nd.'),
  msg(1, 'outbound', 11 * MIN, '👍'),
  msg(1, 'inbound', 6 * MIN, 'ok'),
  msg(1, 'outbound', 4 * MIN, 'Sharing the booking confirmation shortly', { status: 'delivered' }),
  msg(1, 'outbound', 2 * MIN, 'Here it is', { status: 'sent' }),

  msg(2, 'outbound', 2 * HOUR, 'The shoot is confirmed for Friday, 11 am.'),
  msg(2, 'inbound', 4 * MIN, 'Hey, small change'),
  msg(2, 'inbound', 3 * MIN, 'Can we move the shoot to Saturday?'),

  msg(3, 'inbound', 20 * HOUR, 'Please send the invoice for the October campaign.'),
  msg(3, 'outbound', 19 * HOUR, 'Sent to your accounts email just now.', { status: 'delivered' }),

  msg(4, 'inbound', 6 * HOUR, 'WIN BIG!!! Click the link to claim your prize'),
  msg(4, 'inbound', 5 * HOUR, 'Last chance, reply YES'),

  msg(5, 'inbound', 3 * DAY + HOUR, 'Thanks for the quote. We will get back to you next week.'),
  msg(5, 'outbound', 3 * DAY, 'Sure, happy to help.'),
]

function summarise(conv) {
  const visible = messages.filter((m) => m.conversation_id === conv.id && m.id > conv.cleared_through_id)
  const last = visible.at(-1)
  const lastOut = visible.filter((m) => m.direction === 'outbound').at(-1)
  return {
    ...conv,
    last_message_at: conv.last_message_at ?? last?.created_at ?? null,
    last_message_preview: conv.cleared_through_id && !last ? null : (last?.body ?? (last ? `📎 ${last.type}` : null)),
    last_message_direction: last?.direction ?? null,
    last_message_status: lastOut?.status ?? null,
  }
}

const json = (data, status = 200) => new Response(
  JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }),
  { status, headers: { 'content-type': 'application/json' } },
)

const allowedPerms = (params.get('perms') ?? 'view,reply,delete,block').split(',').filter(Boolean)
const access = {
  status: 'active',
  user_id: 'preview-user',
  full_name: 'Preview Agent',
  system_role: 'staff',
  permissions: Object.fromEntries(allowedPerms.map((p) => [`inbox.${p}`, 'all'])),
}

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, window.location.href)
  const method = (init.method || 'GET').toUpperCase()
  const path = url.pathname.replace(/^.*\/api\//, '/')
  const parts = path.split('/').filter(Boolean) // whatsapp, conversations, :id, action
  const conv = conversations.find((c) => c.id === Number(parts[2]))

  if (path === '/whatsapp/media-ticket') return json({ ticket: 'preview' })
  if (path === '/whatsapp/conversations' && method === 'GET') {
    return json({ conversations: conversations.filter((c) => c.status === 'open').map(summarise) })
  }
  if (parts[1] !== 'conversations' || !conv) return json({ code: 'NOT_FOUND', message: 'Not found' }, 404)

  const action = parts[3] ?? ''
  if (action === 'messages' && method === 'GET') {
    return json({ messages: messages.filter((m) => m.conversation_id === conv.id && m.id > conv.cleared_through_id) })
  }
  if (action === 'read' || action === 'typing') return json({ ok: true })
  if (action === 'clear' || (action === '' && method === 'DELETE')) {
    if (!access.permissions['inbox.delete']) return json({ code: 'FORBIDDEN', message: 'You do not have permission to do this.' }, 403)
    conv.cleared_through_id = Math.max(0, ...messages.filter((m) => m.conversation_id === conv.id).map((m) => m.id))
    conv.unread_count = 0
    if (action === '') { conv.status = 'deleted'; return json({ id: conv.id }) }
    return json({ conversation: summarise(conv) })
  }
  if (action === 'block') {
    if (!access.permissions['inbox.block']) return json({ code: 'FORBIDDEN', message: 'You do not have permission to do this.' }, 403)
    if (method === 'POST') {
      if (now - Date.parse(conv.last_inbound_at) >= DAY) {
        return json({ code: 'OUTSIDE_24H', message: 'WhatsApp only lets you block someone within 24 hours of their last message.' }, 409)
      }
      conv.blocked_at = new Date().toISOString()
    } else {
      conv.blocked_at = null
    }
    return json({ conversation: summarise(conv) })
  }
  if (action === 'messages' && method === 'POST') {
    const body = JSON.parse(init.body || '{}').body
    const m = msg(conv.id, 'outbound', 0, body, { status: 'sent' })
    messages.push(m)
    conv.last_message_at = m.created_at
    return json({ message: m })
  }
  return json({ code: 'NOT_FOUND', message: 'Not found' }, 404)
}

const { AccessContext } = await import('../../src/lib/access.js')
const { default: WhatsAppInbox } = await import('../../src/features/whatsapp/inbox/WhatsAppInbox.jsx')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AccessContext.Provider value={access}>
        <Workspace><WhatsAppInbox /></Workspace>
      </AccessContext.Provider>
    </BrowserRouter>
  </StrictMode>,
)

// Open a chat by name once the list has loaded.
const open = params.get('open')
if (open) {
  const timer = setInterval(() => {
    const row = [...document.querySelectorAll('aside button')].find((b) => b.textContent.includes(open))
    if (row) { clearInterval(timer); row.click() }
  }, 50)
}
