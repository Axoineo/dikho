// Preview of the WhatsApp inbox with synthetic chats. Every API call is
// answered here from memory and nothing leaves the page: fetch is stubbed, and
// so is WebSocket, so the Realtime client never reaches a real Supabase even if
// this runs with the real .env.local. Clear, delete, block and unblock change
// the in-memory data the way the API changes D1, so the flows can be tried.
//
//   ?theme=dark            dark mode
//   ?open=Riya             open the first chat whose name contains this
//   ?perms=view,reply      inbox permissions to hold (default: all four)
//   ?campaigns=0           without campaigns.send (no template sending)
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

const SEC = 1000
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

const P = (payload) => ({ payload: JSON.stringify(payload) })
const messages = [
  msg(1, 'inbound', DAY + 40 * MIN, 'Hi, is the MG Road hoarding free in November?', P({ kind: 'text', referral: { source_type: 'ad', headline: 'Outdoor ads this festive season', body: 'Hoardings across Pune from Rs 40,000 a month', source_url: 'https://example.com/ad' } })),
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
]
// Every rich kind, after the plain thread: replies, reactions, pins, stars,
// buttons and the customer's choice, a list, a link, a template, a location,
// a contact card, an address, a forward, a voice note and a system notice.
{
  const byBody = (body) => messages.find((m) => m.body === body)
  const q = byBody('We will go with the 40x20 one. Can the creative go up by the 3rd? Our launch event is on the 5th, so we need at least two days of visibility before it.')
  const done = byBody('Done. Printing takes a day, so send the final artwork by the 1st and it goes up on the 2nd.')
  done.context_wamid = q.meta_message_id
  done.pinned_at = at(MIN)
  q.starred = 1
  const buttonsMsg = msg(1, 'outbound', 100 * SEC, 'Which slot works for the shoot?', { status: 'read', type: 'interactive', ...P({ kind: 'interactive', interactive_type: 'buttons', header: 'Shoot slot', body: 'Which slot works for the shoot?', footer: 'Dikho Studios', buttons: ['Morning', 'Afternoon', 'Evening'] }) })
  messages.push(
    msg(1, 'inbound', 3 * MIN, null, { context_wamid: q.meta_message_id, type: 'reaction', body: '👍' }),
    msg(1, 'outbound', 3 * MIN, null, { context_wamid: q.meta_message_id, type: 'reaction', body: '❤️' }),
    buttonsMsg,
    msg(1, 'inbound', 90 * SEC, 'Afternoon', { type: 'interactive', context_wamid: buttonsMsg.meta_message_id, ...P({ kind: 'choice', reply: { id: 'btn_2', title: 'Afternoon' } }) }),
    msg(1, 'outbound', 80 * SEC, 'Pick a package', { type: 'interactive', status: 'delivered', ...P({ kind: 'interactive', interactive_type: 'list', body: 'Here are this month\'s packages.', button: 'See packages', sections: [{ rows: [{ title: 'Hoarding', description: '40x20, one month' }, { title: 'Radio', description: '30 s spots, two weeks' }] }] }) }),
    msg(1, 'outbound', 70 * SEC, 'See the rate card', { type: 'interactive', status: 'delivered', ...P({ kind: 'interactive', interactive_type: 'cta_url', body: 'Our November rate card is online.', label: 'Open rate card', url: 'https://example.com/rates' }) }),
    msg(1, 'inbound', 60 * SEC, '📍 Koregaon Park office', { type: 'location', ...P({ kind: 'location', latitude: 18.5362, longitude: 73.8939, name: 'Koregaon Park office', address: 'Lane 6, Koregaon Park, Pune' }) }),
    msg(1, 'inbound', 55 * SEC, '👤 Neha Joshi', { type: 'contacts', ...P({ kind: 'contacts', contacts: [{ name: 'Neha Joshi', org: 'Lotus Events', phones: [{ phone: '+91 98000 00099', type: 'WORK' }], emails: ['neha@example.com'] }] }) }),
    msg(1, 'inbound', 50 * SEC, '📍 Address: Riya Kapoor, Tower 2, Pune, 411001', { type: 'interactive', ...P({ kind: 'form_reply', name: 'address_message', values: { name: 'Riya Kapoor', phone_number: '9800000001', building_name: 'Tower 2', address: 'Baner Road', city: 'Pune', state: 'Maharashtra', in_pin_code: '411001' } }) }),
    msg(1, 'outbound', 40 * SEC, 'Hi Riya, your booking for November is confirmed. Reply to this message with any questions.', { type: 'template', status: 'read', ...P({ kind: 'template', name: 'booking_confirmed', language: 'en', body: 'Hi Riya, your booking for November is confirmed. Reply to this message with any questions.', footer: 'Dikho Global Media', buttons: ['Call us'] }) }),
    msg(1, 'inbound', 30 * SEC, 'Sharing the artwork brief from our agency', P({ kind: 'text', forwarded: 'once' })),
    msg(1, 'inbound', 20 * SEC, 'Customer changed their number. Tap to message or add the new number.', { type: 'system', ...P({ kind: 'system', system_type: 'user_changed_number' }) }),
  )
}
messages.push(

  msg(2, 'outbound', 2 * HOUR, 'The shoot is confirmed for Friday, 11 am.'),
  msg(2, 'inbound', 4 * MIN, 'Hey, small change'),
  msg(2, 'inbound', 3 * MIN, 'Can we move the shoot to Saturday?'),

  msg(3, 'inbound', 20 * HOUR, 'Please send the invoice for the October campaign.'),
  msg(3, 'outbound', 19 * HOUR, 'Sent to your accounts email just now.', { status: 'delivered' }),

  msg(4, 'inbound', 6 * HOUR, 'WIN BIG!!! Click the link to claim your prize'),
  msg(4, 'inbound', 5 * HOUR, 'Last chance, reply YES'),

  msg(5, 'inbound', 3 * DAY + HOUR, 'Thanks for the quote. We will get back to you next week.'),
  msg(5, 'outbound', 3 * DAY, 'Sure, happy to help.'),
)
messages.sort((a, b) => a.created_at.localeCompare(b.created_at))

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
  permissions: {
    ...Object.fromEntries(allowedPerms.map((p) => [`inbox.${p}`, 'all'])),
    ...(params.get('campaigns') === '0' ? {} : { 'campaigns.send': 'all' }),
  },
}

window.fetch = async (request, init = {}) => {
  const url = new URL(typeof request === 'string' ? request : request.url, window.location.href)
  const method = (init.method || 'GET').toUpperCase()
  const path = url.pathname.replace(/^.*\/api\//, '/')
  const parts = path.split('/').filter(Boolean) // whatsapp, conversations, :id, action
  const conv = conversations.find((c) => c.id === Number(parts[2]))

  if (path === '/whatsapp/media-ticket') return json({ ticket: 'preview' })
  if (path === '/templates') {
    return json({ source: 'meta', templates: [
      { name: 'enquiry_followup', language: 'en', category: 'MARKETING', status: 'APPROVED', headerText: '', headerFormat: null, bodyText: 'Hi {{1}}, thanks for your enquiry.', footerText: '', buttons: [], variables: ['1'] },
      { name: 'diwali_offer', language: 'en', category: 'MARKETING', status: 'APPROVED', headerText: '', headerFormat: 'IMAGE', bodyText: 'Festive offer', footerText: '', buttons: [], variables: [] },
    ] })
  }
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
  // Media uploads are kept on window.__lastUpload so a test can check what a
  // recording turned into (e.g. that a voice note is OGG/Opus).
  if (action === 'media' && init.body instanceof FormData) {
    const file = init.body.get('file')
    const bytes = new Uint8Array(await file.arrayBuffer())
    window.__lastUpload = { name: file.name, type: file.type, size: bytes.length, voice: init.body.get('voice') === '1', bytes }
    const m = msg(conv.id, 'outbound', 0, null, {
      status: 'sent', type: 'audio', media_mime: file.type, media_url: '/api/whatsapp/media/preview-upload', media_status: 'ready', media_size: bytes.length,
      ...(init.body.get('voice') === '1' ? P({ kind: 'voice' }) : {}),
    })
    messages.push(m)
    return json({ message: m })
  }
  const input = typeof init.body === 'string' ? JSON.parse(init.body || '{}') : {}
  const send = (body, extra = {}) => {
    const m = msg(conv.id, 'outbound', 0, body, { status: 'sent', ...extra })
    messages.push(m)
    if (extra.type !== 'reaction') conv.last_message_at = m.created_at
    return json({ message: m })
  }
  const target = messages.find((m) => m.id === Number(parts[4]) && m.conversation_id === conv.id)
  const replyCtx = (id) => (id ? { context_wamid: messages.find((m) => m.id === Number(id))?.meta_message_id } : {})
  if (action === 'messages' && method === 'POST' && !parts[4]) return send(input.body, replyCtx(input.replyTo))
  if (action === 'messages' && target) {
    const sub = parts[5] ?? ''
    if (sub === 'reaction') return send(input.emoji, { type: 'reaction', context_wamid: target.meta_message_id })
    if (sub === 'pin') { target.pinned_at = method === 'POST' ? new Date().toISOString() : null; return json({ message: target }) }
    if (sub === 'star') { target.starred = method === 'POST' ? 1 : 0; return json({ id: target.id, starred: method === 'POST' }) }
    if (sub === '' && method === 'DELETE') { messages.splice(messages.indexOf(target), 1); return json({ id: target.id }) }
  }
  if (action === 'forward') {
    const source = messages.find((m) => m.id === Number(input.messageId))
    if (!source) return json({ code: 'GONE', message: 'That message is no longer available.' }, 404)
    return send(source.body, { type: source.type, payload: source.payload })
  }
  if (action === 'location') return send(`📍 ${input.name || 'Location'}`, { type: 'location', ...P({ kind: 'location', ...input }) })
  if (action === 'contact') return send(`👤 ${input.name}`, { type: 'contacts', ...P({ kind: 'contacts', contacts: [{ name: input.name, org: input.company, phones: [{ phone: input.phone }], emails: input.email ? [input.email] : [] }] }) })
  if (action === 'interactive') {
    const { kind, ...rest } = input
    return send(rest.body, { type: 'interactive', ...P({ kind: 'interactive', interactive_type: kind, ...rest, buttons: rest.buttons, sections: rest.sections }) })
  }
  if (action === 'template') return send(`Hi ${input.values?.['1'] ?? ''}, thanks for your enquiry.`, { type: 'template', ...P({ kind: 'template', name: input.name, language: input.language, body: `Hi ${input.values?.['1'] ?? ''}, thanks for your enquiry.` }) })
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
