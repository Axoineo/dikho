import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireAuth } from '../../middleware/requireAuth.js'
import { readBoundedBytes } from '../../utils/body.js'
import { callUserRpc } from '../../services/userAdmin.js'
import { emailHubEnabled, connectUrl } from '../../services/email/config.js'
import { gmail, GmailError, GoogleAuthError } from '../../services/email/google.js'
import { verifyPushToken } from '../../services/email/googleJwt.js'
import { verifyRenderTicket } from '../../services/email/renderTicket.js'
import { readMessage } from '../../services/email/mime.js'
import { sanitizeHtml, textToHtml } from '../../services/email/sanitizeHtml.js'
import { UUID, GMAIL_ID } from './shared.js'
import { verifySnsMessage, normalizeSesEvent, snsUrlAllowed } from '../../services/email/sns.js'
import { verifyUnsubscribe, dispatchCampaignBatch, buildCampaignMessage } from '../../services/email/campaigns.js'
import { safeEqual } from '../../services/email/crypto.js'
import { syncMailbox as syncOne } from '../../services/email/sync.js'
import { syncMailbox, inBackground } from '../../services/email/sync.js'
import { logError, logEvent } from '../../utils/logger.js'
import accounts from './accounts.js'
import threads from './threads.js'
import compose from './compose.js'
import marketing from './campaigns.js'

// /api/email — the Email Hub (docs/decisions/0009-email-hub.md).
//
// Off unless EMAIL_HUB_ENABLED=true: every route answers 404, so a
// half-configured module is invisible. Two exceptions stay on whatever the
// switch says, because mail already sent depends on them: unsubscribe links,
// and SES delivery/bounce/complaint events.
//
// Route classes:
//   no session (each authenticates itself):
//     GET  /oauth/google/callback   hands the browser to the dashboard; completes nothing
//     POST /webhooks/google-pubsub  Google-signed OIDC token
//     GET  /render/:thread/:message ten-minute render ticket + live membership check
//     GET/POST /unsubscribe         HMAC-signed recipient link (always on)
//     POST /webhooks/ses            SNS signature, certificate host, topic (always on)
//     GET  /preview/:kind/:id       ten-minute preview ticket + live permission check
//     POST /jobs/run                EMAIL_JOBS_SECRET, for an external scheduler
//   everything else: requireAuth (live session, active staff), then the
//   em_* functions decide permission and mailbox membership.
const email = new Hono()

// ── Unsubscribe (always on) ──────────────────────────────────────────────────
// GET shows a confirmation page and changes nothing, so link scanners and
// previews cannot unsubscribe anyone. POST (the page's button, or a mail
// app's RFC 8058 one-click request) records it. Signed per recipient.
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}
const page = (title, body, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`
  + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f8fb;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#263247}'
  + 'main{max-width:420px;margin:24px;padding:32px;background:#fff;border:1px solid #dfe5ed;border-radius:14px;text-align:center}'
  + 'h1{margin:0 0 8px;font-size:20px}p{margin:0 0 20px;color:#5f6c82}button{min-height:44px;padding:0 22px;border:0;border-radius:12px;background:#185494;color:#fff;font-weight:600;font-size:15px;cursor:pointer}</style>'
  + `</head><body><main>${body}</main></body></html>`, { status, headers: PAGE_HEADERS })

async function unsubscribeTarget(c) {
  const r = c.req.query('r')
  const s = c.req.query('s')
  return (await verifyUnsubscribe(c.env, r, s)) ? { r, s } : null
}

email.get('/unsubscribe', async (c) => {
  const target = await unsubscribeTarget(c)
  if (!target) return page('Link not valid', '<h1>This link is not valid</h1><p>It may have been copied incompletely. Use the link in the email again.</p>', 400)
  return page('Unsubscribe', '<h1>Stop marketing emails?</h1><p>You will no longer receive campaigns from us. Messages about your own orders and invoices are not affected.</p>'
    + `<form method="post" action="?r=${target.r}&amp;s=${target.s}"><button type="submit">Unsubscribe</button></form>`)
})

email.post('/unsubscribe', async (c) => {
  await readBoundedBytes(c, 4 * 1024)
  const target = await unsubscribeTarget(c)
  if (!target) return page('Link not valid', '<h1>This link is not valid</h1><p>Use the link in the email again.</p>', 400)
  try {
    await callUserRpc(c, 'em_unsubscribe_recipient', { p_recipient: target.r })
  } catch (err) {
    logError('email.unsubscribe.failed', err)
    return page('Try again', '<h1>Something went wrong</h1><p>Please try the link again in a minute.</p>', 503)
  }
  logEvent('email.unsubscribed', { via: 'link' })
  return page('Unsubscribed', '<h1>You are unsubscribed</h1><p>You will not receive further marketing emails from us.</p>')
})

// ── Amazon SES events through SNS (always on) ───────────────────────────────
email.post('/webhooks/ses', async (c) => {
  const bytes = await readBoundedBytes(c, 256 * 1024)
  let message
  try {
    message = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return c.json({ success: false }, 400)
  }
  const verdict = await verifySnsMessage(c.env, message)
  if (!verdict.ok) {
    logEvent('email.sns.rejected', { reason: verdict.reason })
    return c.json({ success: false }, verdict.reason === 'not_configured' ? 404 : 403)
  }
  if (message.Type === 'SubscriptionConfirmation') {
    // Only a verified message for our own topic gets its subscription confirmed.
    if (!snsUrlAllowed(message.SubscribeURL)) return c.json({ success: false }, 400)
    const res = await fetch(message.SubscribeURL, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
    logEvent('email.sns.subscription', { confirmed: Boolean(res?.ok) })
    return c.body(null, res?.ok ? 204 : 502)
  }
  if (message.Type === 'UnsubscribeConfirmation') {
    logEvent('email.sns.unsubscribed', {})
    return c.body(null, 204)
  }
  let event
  try {
    event = JSON.parse(message.Message)
  } catch {
    return c.body(null, 204)
  }
  try {
    const result = await callUserRpc(c, 'em_record_delivery_event', { p_event: normalizeSesEvent(message.MessageId, event) })
    logEvent('email.ses.event', { type: String(event?.eventType ?? event?.notificationType ?? 'unknown').slice(0, 30), result })
  } catch (err) {
    // Not acknowledged, so SNS retries.
    logError('email.ses.record_failed', err)
    return c.json({ success: false }, 503)
  }
  return c.body(null, 204)
})

email.use('*', async (c, next) => {
  if (!emailHubEnabled(c.env)) throw new HTTPException(404, { message: 'Not found' })
  await next()
})

// ── Google sends the browser back here after consent ─────────────────────────
// Nothing is completed here. A redirect carries no bearer token, so this page
// cannot know who is in front of it, and the state alone only says who
// STARTED: a consent link forwarded to a colleague would otherwise connect the
// colleague's mailbox to the sender. The browser is handed on to the
// dashboard, which finishes with its session (POST /oauth/google/complete);
// the API then requires the same person who started. Only the state, the
// one-use code and Google's short error code are passed on.
email.get('/oauth/google/callback', (c) => {
  c.header('Cache-Control', 'no-store')
  const { state, code, error } = c.req.query()
  const params = {}
  if (typeof state === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(state)) params.state = state
  if (typeof code === 'string' && code.length >= 10 && code.length <= 2048) params.code = code
  if (typeof error === 'string' && /^[a-z_]{1,64}$/.test(error)) params.error = error
  const url = connectUrl(c.env, params)
  if (url) return c.redirect(url, 303)
  return c.html('<!doctype html><meta charset="utf-8"><title>Dikho</title><p>The mailbox was not connected: the dashboard address is not configured. Ask an administrator.</p>', 503)
})

// ── Gmail push (Cloud Pub/Sub) ───────────────────────────────────────────────
// Authenticated by the OIDC token Google signs for the push subscription.
// Acknowledged quickly (any 2xx); the sync runs after the response. Duplicate
// and stale pushes do nothing: em_push_target only answers for history the
// mailbox has not seen, and the sync lease stops parallel runs.
email.post('/webhooks/google-pubsub', async (c) => {
  const claims = await verifyPushToken(c.env, c.req.header('Authorization'))
  if (!claims) {
    logEvent('email.push.rejected', { reason: 'token' })
    return c.json({ success: false }, 401)
  }
  const bytes = await readBoundedBytes(c, 64 * 1024)
  let notice = null
  try {
    const envelope = JSON.parse(new TextDecoder().decode(bytes))
    const data = envelope?.message?.data
    if (typeof data === 'string' && data.length <= 4096) notice = JSON.parse(atob(data))
  } catch { /* malformed: acknowledged and ignored, Pub/Sub would only resend it */ }

  const address = typeof notice?.emailAddress === 'string' ? notice.emailAddress.slice(0, 254) : null
  const historyId = notice?.historyId !== undefined ? String(notice.historyId) : null
  if (address && historyId && /^[0-9]{1,20}$/.test(historyId)) {
    try {
      const target = await callUserRpc(c, 'em_push_target', { p_email: address, p_history_id: historyId })
      if (target) inBackground(c, syncMailbox(c.env, target))
    } catch (err) {
      // Not acknowledging lets Pub/Sub retry later.
      logError('email.push.lookup_failed', err)
      return c.json({ success: false }, 503)
    }
  }
  return c.body(null, 204)
})

// ── One message, rendered for an iframe ──────────────────────────────────────
// Served from the API origin, not inlined in the dashboard, so the message
// gets an origin and a Content-Security-Policy of its own: the dashboard's CSP
// (no inline styles) would otherwise apply to it and break every email.
// Authenticated by a ten-minute ticket for one person and one message, and
// the person's mailbox access is re-checked on every load. The document is
// sandboxed (opaque origin), allows no network loads, and runs exactly one
// script: the hash-pinned one that reports its height to the dashboard.
// Measures <body>, not the document: the document is never shorter than the
// frame showing it, so a frame sized from it could grow but never shrink.
const RESIZE_SCRIPT = "(function(){var b=document.body;function s(){parent.postMessage({type:'dikho-email-height',height:Math.ceil(Math.max(b.getBoundingClientRect().height,b.scrollHeight))},'*')}addEventListener('load',s);if(window.ResizeObserver){new ResizeObserver(s).observe(b)}})();"
const RENDER_STYLE = 'html,body{margin:0;padding:0;background:#fff;color:#202124}'
  + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:14px;line-height:1.55;overflow-wrap:anywhere;word-break:break-word;padding:2px;overflow-y:hidden}'
  + 'img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#185494}'
  + 'blockquote{margin:8px 0 8px 4px;padding-left:12px;border-left:3px solid #dadce0;color:#5f6368}'
let resizeHash = null

async function renderHeaders(env) {
  if (!resizeHash) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(RESIZE_SCRIPT)))
    resizeHash = `'sha256-${btoa(String.fromCharCode(...digest))}'`
  }
  const ancestors = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim())
    .filter((o) => /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(o))
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': [
      'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox',
      "default-src 'none'", `script-src ${resizeHash}`, "style-src 'unsafe-inline'", 'img-src data:', 'font-src data:',
      "form-action 'none'", "base-uri 'none'", `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`,
    ].join('; '),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  }
}

const renderPage = (body) => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${RENDER_STYLE}</style></head><body>${body}<script>${RESIZE_SCRIPT}</script></body></html>`

email.get('/render/:threadId/:messageId', async (c) => {
  const headers = await renderHeaders(c.env)
  const refuse = (status, text) => new Response(renderPage(`<p style="color:#5f6368">${text}</p>`), { status, headers })
  const threadId = c.req.param('threadId')
  const messageId = c.req.param('messageId')
  if (!UUID.test(threadId) || !GMAIL_ID.test(messageId)) return refuse(400, 'This message link is not valid.')
  const claim = await verifyRenderTicket(c.env, c.req.query('t'), { threadId: threadId.toLowerCase(), messageId })
  if (!claim) return refuse(403, 'This preview has expired. Close and reopen the conversation.')

  try {
    const meta = await callUserRpc(c, 'em_open_thread', { p_actor: claim.userId, p_thread: threadId.toLowerCase(), p_min_role: 'viewer' })
    const message = await gmail(c.env, meta.account, `/messages/${messageId}`, { query: 'format=full' })
    if (message?.threadId !== meta.thread.gmail_thread_id) return refuse(404, 'This message is not part of the conversation.')
    const m = readMessage(message)
    const body = m.html ? sanitizeHtml(m.html).html : textToHtml(m.text)
    return new Response(renderPage(body), { headers })
  } catch (err) {
    if (err?.fromRule || err?.status === 404) return refuse(404, 'This message is no longer available to you.')
    if (!(err instanceof GmailError) && !(err instanceof GoogleAuthError)) logError('email.render.failed', err)
    return refuse(502, 'The message could not be loaded from Gmail. Try again.')
  }
})

// ── Background work for an external scheduler ────────────────────────────────
// Cron Triggers do not fire on this account's plan, so anything that must run
// without dashboard traffic (campaign batches, idle mailboxes) can be driven
// by an independent scheduler (for example Supabase pg_cron + pg_net) calling
// this with EMAIL_JOBS_SECRET. Unset secret: the endpoint does not exist.
email.post('/jobs/run', async (c) => {
  const secret = c.env.EMAIL_JOBS_SECRET
  const header = c.req.header('Authorization') || ''
  if (!secret || secret.length < 32 || !safeEqual(header, `Bearer ${secret}`)) throw new HTTPException(404, { message: 'Not found' })
  const campaigns = await dispatchCampaignBatch(c.env)
  let synced = null
  try {
    const due = await callUserRpc(c, 'em_sync_due', { p_user: null, p_limit: 1 })
    if (Array.isArray(due) && due[0]) synced = await syncOne(c.env, due[0])
  } catch (err) {
    logError('email.jobs.sync_failed', err)
  }
  return c.json({ success: true, data: { campaigns, synced: Boolean(synced?.ok) } })
})

// ── Campaign and template previews ───────────────────────────────────────────
// Same isolation as messages (own origin, sandbox, no network loads), with
// sample values in the variables and the real footer, so what is reviewed
// and approved is what recipients see. Ticket for one person and one item;
// permission re-checked through em_get_campaign / em_get_template.
email.get('/preview/:kind/:id', async (c) => {
  const headers = await renderHeaders(c.env)
  const refuse = (status, text) => new Response(renderPage(`<p style="color:#5f6368">${text}</p>`), { status, headers })
  const kind = c.req.param('kind')
  const id = c.req.param('id')
  if (!['campaign', 'template'].includes(kind) || !UUID.test(id)) return refuse(400, 'This preview link is not valid.')
  const claim = await verifyRenderTicket(c.env, c.req.query('t'), { threadId: id.toLowerCase(), messageId: kind })
  if (!claim) return refuse(403, 'This preview has expired. Reopen it.')
  try {
    const item = kind === 'campaign'
      ? await callUserRpc(c, 'em_get_campaign', { p_actor: claim.userId, p_campaign: id.toLowerCase() })
      : await callUserRpc(c, 'em_get_template', { p_actor: claim.userId, p_template: id.toLowerCase(), p_version: null })
    const message = await buildCampaignMessage(c.env, { ...item, from_name: item.from_name || c.env.EMAIL_FROM_NAME || 'Dikho', id },
      { id: '00000000-0000-4000-8000-000000000000', email: 'asha@example.com', name: 'Asha Verma', company: 'Example Industries' })
    return new Response(renderPage(sanitizeHtml(message.html, { keepStyles: true }).html), { headers })
  } catch (err) {
    if (err?.fromRule) return refuse(404, 'This item is no longer available to you.')
    logError('email.preview.failed', err)
    return refuse(502, 'The preview could not be loaded. Try again.')
  }
})

// ── Staff routes ─────────────────────────────────────────────────────────────
email.use('*', requireAuth)
email.route('/', accounts)
email.route('/', threads)
email.route('/', compose)
email.route('/', marketing)

export default email
