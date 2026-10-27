// Preview of the Email Hub with a Google Workspace and a Hostinger mailbox.
// Synthetic data only: every /api/email call is answered here from memory and
// nothing leaves the page (fetch is stubbed). Real page components and CSS.
//
//   ?route=/email/settings                 (default) connected mailboxes
//   ?route=/email/inbox/<thread id>        a Hostinger conversation
//   ?route=/email/campaigns/new            the campaign editor's sender picker
//   ?theme=dark                            dark mode
//   ?google=0 / ?hostinger=0               that provider not set up on the server
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '../../src/index.css'
import '../../src/components/ContactDetails.css'
import '../../src/tailwind.css'
import Workspace from './Workspace.jsx'
import { capabilitiesOf } from '../../src/api/services/email/providers.js'

const params = new URLSearchParams(window.location.search)
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const googleReady = params.get('google') !== '0'
const hostingerReady = params.get('hostinger') !== '0'

const ME = '44444444-4444-4444-8444-444444444444'
const GOOGLE_BOX = 'aaaaaaaa-1111-4111-8111-111111111111'
const HOST_BOX = 'cccccccc-3333-4333-8333-333333333333'
const PENDING_BOX = 'dddddddd-4444-4444-8444-444444444444'
const THREAD = 'bbbbbbbb-2222-4222-8222-222222222222'
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString()

const box = (b) => ({ ...b, ...capabilitiesOf(b) })
const mailboxes = [
  box({ id: GOOGLE_BOX, kind: 'personal', provider: 'google', email_address: 'sam@dikho.example', display_name: 'Sam Sales', owner_id: ME, owner_name: 'Sam Sales', status: 'connected', last_synced_at: ago(2), role: 'admin', unread_count: 3, can_configure: true, campaign_sender: false, campaign_daily_cap: null }),
  box({ id: HOST_BOX, kind: 'shared', provider: 'hostinger', email_address: 'contact@dikho.example', display_name: 'Contact', status: 'connected', last_synced_at: ago(5), role: 'admin', unread_count: 1, can_configure: true, campaign_sender: true, campaign_daily_cap: 50 }),
]
const sharedSetup = [
  { ...mailboxes[1], member_count: 3 },
  box({ id: PENDING_BOX, kind: 'shared', provider: 'google', email_address: 'sales@dikho.example', display_name: 'Sales team', status: 'pending', member_count: 0, campaign_sender: false }),
]

const conversation = {
  thread: { id: THREAD, account_id: HOST_BOX, gmail_thread_id: 'f'.repeat(32), subject: 'Hoarding rates for Andheri', participants: [], last_message_at: ago(30), message_count: 2, unread: false, starred: false, label_ids: ['INBOX', 'SENT'], workflow_status: 'open', assigned_to: null },
  account: mailboxes[1],
  notes: [],
  assignable: [{ user_id: ME, full_name: 'Sam Sales' }],
  omitted: 0,
  messages: [
    { id: '11111111-aaaa-4aaa-8aaa-111111111111', date: ago(300), from: { name: 'Riya Mehta', email: 'riya@client.example' }, to: [{ name: null, email: 'contact@dikho.example' }], cc: [], bcc: [], reply_to: [], subject: 'Hoarding rates for Andheri', labels: ['INBOX'], unread: false, draft: false, html: null, render_path: null, blocked_images: 0, text: 'Hello,\n\nCould you share rates for two hoardings near Andheri station for November?\n\nThanks,\nRiya', attachments: [{ id: 'att.1', filename: 'brief.pdf', mime_type: 'application/pdf', size: 182400, inline: false }] },
    { id: '22222222-bbbb-4bbb-8bbb-222222222222', date: ago(30), from: { name: 'Contact', email: 'contact@dikho.example' }, to: [{ name: 'Riya Mehta', email: 'riya@client.example' }], cc: [], bcc: [], reply_to: [], subject: 'Re: Hoarding rates for Andheri', labels: ['SENT'], unread: false, draft: false, html: null, render_path: null, blocked_images: 0, text: 'Hi Riya,\n\nThe rate card is attached. Both sites are free from 4 November.\n\nRegards,\nDikho', attachments: [] },
  ],
}

const access = {
  status: 'active', user_id: ME, email: 'sam@dikho.example', full_name: 'Sam Sales', system_role: 'staff',
  permissions: Object.fromEntries(['email_inbox.view', 'email_mailboxes.manage', 'email_campaigns.create', 'email_campaigns.view', 'clients.view'].map((k) => [k, 'all'])),
}

const json = (data, status = 200) => new Response(
  JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }),
  { status, headers: { 'content-type': 'application/json' } },
)

window.fetch = async (request, init = {}) => {
  const url = new URL(typeof request === 'string' ? request : request.url, window.location.href)
  const method = (init.method || 'GET').toUpperCase()
  const path = url.pathname.replace(/^.*\/api\//, '/')
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null

  if (path === '/email/status') {
    return json({
      gmail: { configured: googleReady, push: false, workspace_domain: null },
      hostinger: { configured: hostingerReady },
      delivery: { provider: 'brevo', from_configured: false, brevo: { configured: true }, ses: { configured: false, sending_enabled: false } },
    })
  }
  if (path === '/email/accounts') return json({ can_connect_personal: true, can_manage_shared: true, mailboxes, shared_setup: sharedSetup })
  if (path === '/email/hostinger/mailboxes') return json({ addresses: ['accounts@dikho.example', 'contact@dikho.example', 'media@dikho.example'] })
  const routing = path.match(/^\/email\/accounts\/([^/]+)\/routing$/)
  if (routing) {
    const host = routing[1] === HOST_BOX
    return json({
      domain: 'dikho.example', mx: [{ preference: 1, host: 'smtp.google.com' }], routes_to: 'google', provider: host ? 'hostinger' : 'google',
      inbound: host ? 'elsewhere' : 'direct',
      note: host
        ? 'Incoming mail for dikho.example is delivered to Google Workspace, not Hostinger. This mailbox receives outside mail only if Google Workspace forwards it to Hostinger (split delivery). Sending works regardless. See the setup guide before changing anything.'
        : 'Incoming mail for dikho.example is delivered to Google Workspace.',
    })
  }
  if (path === `/email/accounts/${HOST_BOX}/quota`) return json({ quota: { used_bytes: 1_288_490_188, limit_bytes: 10_737_418_240, percent: 12 } })
  const sender = path.match(/^\/email\/accounts\/([^/]+)\/campaign-sender$/)
  if (sender && method === 'PUT') {
    const m = [...mailboxes, ...sharedSetup].find((x) => x.id === sender[1])
    for (const x of [...mailboxes, ...sharedSetup]) if (x.id === sender[1]) Object.assign(x, { campaign_sender: body.enabled, campaign_daily_cap: body.enabled ? body.daily_cap : x.campaign_daily_cap })
    return json(m)
  }
  if (path === '/email/accounts/hostinger/connect' || path === '/email/accounts/shared') return json({ id: 'new', provider: 'hostinger', status: 'connected' }, 201)
  if (path === '/email/threads') return json({ threads: [{ ...conversation.thread, account_email: 'contact@dikho.example', account_name: 'Contact', participants: [{ name: 'Riya Mehta', email: 'riya@client.example' }] }], has_more: false })
  if (path === `/email/threads/${THREAD}`) return json(conversation)
  if (path === `/email/threads/${THREAD}/crm`) return json({ links: [], suggestions: [] })
  if (path === '/email/campaigns') {
    return json({
      campaigns: [], senders: [], max_recipients: 5000,
      readiness: { ready: true, missing: [], ses: false, scheduler: false },
      variables: { first_name: 'First name', name: 'Full name', company: 'Company', email: 'Email address' },
      sender_mailboxes: [
        { id: HOST_BOX, email_address: 'contact@dikho.example', display_name: 'Contact', provider: 'hostinger', daily_cap: 50, sent_today: 12, cooldown_until: null },
        { id: GOOGLE_BOX, email_address: 'sam@dikho.example', display_name: 'Sam Sales', provider: 'google', daily_cap: 100, sent_today: 0, cooldown_until: null },
      ],
    })
  }
  if (path === '/email/templates') return json({ templates: [], variables: { marketing: {}, transactional: {} } })
  if (path === '/email/audience/options') return json({ countries: [], states: [], cities: [], media: [], sub_media: [] })
  if (path === '/email/audience/preview') return json({ eligible: 0, total: 0, sample: [] })
  if (path === '/email/directory') return json([])
  return json({ code: 'NOT_FOUND', message: `Not in the preview: ${method} ${path}` }, 404)
}

const { AccessContext } = await import('../../src/lib/access.js')
const { default: EmailSettings } = await import('../../src/features/email/EmailSettings.jsx')
const { default: EmailInbox } = await import('../../src/features/email/EmailInbox.jsx')
const { default: EmailCampaigns } = await import('../../src/features/email/EmailCampaigns.jsx')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MemoryRouter initialEntries={[params.get('route') || '/email/settings']}>
      <AccessContext.Provider value={access}>
        <Workspace>
          <Routes>
            <Route path="/email/settings" element={<EmailSettings />} />
            <Route path="/email/inbox" element={<EmailInbox />} />
            <Route path="/email/inbox/:threadId" element={<EmailInbox />} />
            <Route path="/email/campaigns" element={<EmailCampaigns />} />
            <Route path="/email/campaigns/:campaignId" element={<EmailCampaigns />} />
          </Routes>
        </Workspace>
      </AccessContext.Provider>
    </MemoryRouter>
  </StrictMode>,
)
