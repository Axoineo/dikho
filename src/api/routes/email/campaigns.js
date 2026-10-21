import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '../../middleware/requireAuth.js'
import { ok } from '../../utils/response.js'
import { readBoundedJson } from '../../utils/body.js'
import { sanitizeHtml, htmlToText } from '../../services/email/sanitizeHtml.js'
import { sendEmail } from '../../services/email/delivery.js'
import { isEmail } from '../../services/email/mime.js'
import {
  CAMPAIGN_VARIABLES, TRANSACTIONAL_VARIABLES, unknownVariables, allowedSenders, campaignReadiness, maxRecipients, dailyCap,
  buildCampaignMessage,
} from '../../services/email/campaigns.js'
import { actor, rpc, uuidParam, requestContext, noStore } from './shared.js'

// Campaigns, templates, audiences, consent and analytics. Mounted behind
// requireAuth. The em_* functions hold the rules (who may edit, submit and
// approve; nobody approves their own; approval binds to a snapshot hash);
// these routes sanitize content and check sender and variables.
const marketing = new Hono()
const MAX_BODY = 1024 * 1024
const SOURCES = new Set(['client', 'vendor', 'lead'])

function cleanContent(body, allowed) {
  const out = {}
  for (const key of ['name', 'from_name', 'subject', 'preheader']) {
    if (key in body) {
      if (typeof body[key] !== 'string' || /[\r\n]/.test(body[key])) throw new HTTPException(400, { message: `${key} must be one line of text` })
      out[key] = body[key].trim().slice(0, key === 'subject' ? 900 : key === 'preheader' ? 200 : 120)
    }
  }
  if ('from_email' in body) {
    const from = String(body.from_email ?? '').trim().toLowerCase()
    if (from && !isEmail(from)) throw new HTTPException(400, { message: 'Choose a valid sender address.' })
    out.from_email = from
  }
  if ('reply_to' in body) out.reply_to = body.reply_to ? String(body.reply_to).trim().toLowerCase().slice(0, 254) : null
  if ('html' in body) {
    if (typeof body.html !== 'string' || body.html.length > 500_000) throw new HTTPException(413, { message: 'The content is too long.' })
    out.html = sanitizeHtml(body.html, { keepStyles: true, maxLength: 500_000 }).html
  }
  if ('text_body' in body) out.text_body = typeof body.text_body === 'string' ? body.text_body.slice(0, 200_000) : ''
  if ('html' in out && !out.text_body) out.text_body = htmlToText(out.html)
  const unknown = unknownVariables([out.subject, out.preheader, out.html, out.text_body], allowed)
  if (unknown.length) {
    throw new HTTPException(400, { message: `Unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.map((v) => `{{${v}}}`).join(', ')}. Use only ${Object.keys(allowed).map((v) => `{{${v}}}`).join(', ')}.` })
  }
  return out
}

function cleanAudience(audience) {
  if (audience === undefined) return undefined
  if (!audience || typeof audience !== 'object' || Array.isArray(audience)) throw new HTTPException(400, { message: 'Invalid audience' })
  const list = (v, max, pattern) => {
    if (v === undefined) return []
    if (!Array.isArray(v) || v.length > max) throw new HTTPException(400, { message: 'Invalid audience filter' })
    return v.map((x) => String(x).trim()).filter((x) => x && x.length <= 80 && (!pattern || pattern.test(x)))
  }
  const sources = list(audience.sources, 3).filter((s) => SOURCES.has(s))
  return {
    sources,
    country: list(audience.country, 50),
    state: list(audience.state, 100),
    city: list(audience.city, 200),
    media: list(audience.media, 20, /^\d{1,18}$/),
    sub_media: list(audience.sub_media, 100, /^\d{1,18}$/),
    active_only: audience.active_only !== false,
  }
}

function cleanSendAt(value) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const t = Date.parse(value)
  if (!Number.isFinite(t)) throw new HTTPException(400, { message: 'Invalid send time' })
  return new Date(t).toISOString()
}

async function campaignFields(c) {
  const body = await readBoundedJson(c, MAX_BODY)
  if (!body || typeof body !== 'object') throw new HTTPException(400, { message: 'Expected a JSON object' })
  const fields = cleanContent(body, CAMPAIGN_VARIABLES)
  const audience = cleanAudience(body.audience)
  if (audience) fields.audience = audience
  const sendAt = cleanSendAt(body.send_at)
  if (sendAt !== undefined) fields.send_at = sendAt
  if ('template_id' in body) fields.template_id = body.template_id && /^[0-9a-f-]{36}$/i.test(body.template_id) ? body.template_id : null
  return fields
}

// ── Campaigns ────────────────────────────────────────────────────────────────
marketing.get('/campaigns', async (c) => {
  noStore(c)
  return ok(c, {
    campaigns: await rpc(c, 'em_list_campaigns', { p_actor: actor(c) }),
    readiness: campaignReadiness(c.env),
    senders: allowedSenders(c.env),
    variables: CAMPAIGN_VARIABLES,
    max_recipients: maxRecipients(c.env),
  })
})

marketing.post('/campaigns', requirePermission('email_campaigns.create'), async (c) => {
  return ok(c, await rpc(c, 'em_save_campaign', { p_actor: actor(c), p_campaign: null, p_fields: await campaignFields(c), p_ctx: requestContext(c) }), 201)
})

marketing.get('/campaigns/:id', async (c) => {
  noStore(c)
  return ok(c, await rpc(c, 'em_get_campaign', { p_actor: actor(c), p_campaign: uuidParam(c) }))
})

marketing.put('/campaigns/:id', requirePermission('email_campaigns.create'), async (c) => {
  const id = uuidParam(c)
  return ok(c, await rpc(c, 'em_save_campaign', { p_actor: actor(c), p_campaign: id, p_fields: await campaignFields(c), p_ctx: requestContext(c) }))
})

marketing.post('/campaigns/:id/submit', requirePermission('email_campaigns.create'), async (c) => {
  const id = uuidParam(c)
  const current = await rpc(c, 'em_get_campaign', { p_actor: actor(c), p_campaign: id })
  if (!allowedSenders(c.env).includes(current.from_email)) {
    throw new HTTPException(400, { message: 'Choose one of the verified sender addresses before submitting.' })
  }
  return ok(c, await rpc(c, 'em_submit_campaign', { p_actor: actor(c), p_campaign: id, p_max: maxRecipients(c.env), p_ctx: requestContext(c) },
    { action: 'email.campaign_submit' }))
})

marketing.post('/campaigns/:id/decision', requirePermission('email_campaigns.approve'), async (c) => {
  const id = uuidParam(c)
  const body = await readBoundedJson(c, 8 * 1024)
  if (typeof body?.approve !== 'boolean' || !/^[0-9a-f]{64}$/.test(body?.hash ?? '')) {
    throw new HTTPException(400, { message: 'Approve or reject the version you reviewed.' })
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null
  if (!body.approve && !note) throw new HTTPException(400, { message: 'Say why the campaign is rejected.' })
  return ok(c, await rpc(c, 'em_decide_campaign', {
    p_actor: actor(c), p_campaign: id, p_approve: body.approve, p_hash: body.hash, p_note: note, p_ctx: requestContext(c),
  }, { action: 'email.campaign_decide' }))
})

marketing.post('/campaigns/:id/control', async (c) => {
  const body = await readBoundedJson(c, 4 * 1024)
  if (!['pause', 'resume', 'cancel'].includes(body?.action)) throw new HTTPException(400, { message: 'Unknown action' })
  return ok(c, await rpc(c, 'em_control_campaign', { p_actor: actor(c), p_campaign: uuidParam(c), p_action: body.action, p_ctx: requestContext(c) }))
})

marketing.post('/campaigns/:id/duplicate', requirePermission('email_campaigns.create'), async (c) => {
  return ok(c, await rpc(c, 'em_duplicate_campaign', { p_actor: actor(c), p_campaign: uuidParam(c), p_ctx: requestContext(c) }), 201)
})

// A test copy to the person's own address only, through SES, counted
// against the daily limit. Variables are filled with their own name.
marketing.post('/campaigns/:id/test', requirePermission('email_campaigns.create'), async (c) => {
  const id = uuidParam(c)
  const user = c.get('user')
  const readiness = campaignReadiness(c.env)
  if (!readiness.ready) throw new HTTPException(409, { message: `Test sends need ${readiness.missing.join(', ')}.` })
  if (!isEmail(user?.email ?? '')) throw new HTTPException(400, { message: 'Your account has no email address to send a test to.' })
  const campaign = await rpc(c, 'em_get_campaign', { p_actor: actor(c), p_campaign: id })
  if (!allowedSenders(c.env).includes(campaign.from_email)) throw new HTTPException(400, { message: 'Choose a verified sender first.' })
  if (!(await rpc(c, 'em_take_budget', { p_n: 1, p_cap: dailyCap(c.env) }))) {
    throw new HTTPException(429, { message: 'Today\'s sending limit has been reached.' })
  }
  const message = await buildCampaignMessage(c.env, { ...campaign, subject: `[Test] ${campaign.subject}` },
    { id: '00000000-0000-4000-8000-000000000000', email: user.email, name: '', company: '' })
  const result = await sendEmail(c.env, { ...message, to: [{ email: user.email }], tags: { purpose: 'campaign_test', campaign: id } }, { provider: 'ses' })
  if (!result.ok) throw new HTTPException(result.uncertain ? 502 : 400, { message: `The test was not sent: ${result.reason}` })
  return ok(c, { sent_to: user.email })
})

marketing.post('/audience/preview', requirePermission('email_campaigns.create'), async (c) => {
  const body = await readBoundedJson(c, 64 * 1024)
  return ok(c, await rpc(c, 'em_audience_preview', { p_actor: actor(c), p_spec: cleanAudience(body?.audience ?? {}) }))
})

marketing.get('/audience/options', requirePermission('email_campaigns.create'), async (c) => {
  return ok(c, await rpc(c, 'em_audience_options', { p_actor: actor(c) }))
})

// ── Templates ────────────────────────────────────────────────────────────────
marketing.get('/templates', async (c) => {
  return ok(c, { templates: await rpc(c, 'em_list_templates', { p_actor: actor(c) }), variables: { marketing: CAMPAIGN_VARIABLES, transactional: TRANSACTIONAL_VARIABLES } })
})

marketing.get('/templates/:id', async (c) => {
  const version = c.req.query('version')
  if (version && !/^\d{1,6}$/.test(version)) throw new HTTPException(400, { message: 'Invalid version' })
  return ok(c, await rpc(c, 'em_get_template', { p_actor: actor(c), p_template: uuidParam(c), p_version: version ? Number(version) : null }))
})

async function saveTemplate(c, id) {
  const body = await readBoundedJson(c, MAX_BODY)
  const kind = id ? null : body?.kind
  if (!id && !['marketing', 'transactional'].includes(kind)) throw new HTTPException(400, { message: 'Choose marketing or transactional.' })
  const allowed = kind === 'transactional' || body?.kind === 'transactional' ? { ...CAMPAIGN_VARIABLES, ...TRANSACTIONAL_VARIABLES } : CAMPAIGN_VARIABLES
  const fields = cleanContent(body ?? {}, allowed)
  if (kind) fields.kind = kind
  return ok(c, await rpc(c, 'em_save_template', { p_actor: actor(c), p_template: id, p_fields: fields, p_ctx: requestContext(c) }), id ? 200 : 201)
}
marketing.post('/templates', requirePermission('email_templates.manage'), (c) => saveTemplate(c, null))
marketing.put('/templates/:id', requirePermission('email_templates.manage'), (c) => saveTemplate(c, uuidParam(c)))
marketing.delete('/templates/:id', requirePermission('email_templates.manage'), async (c) => {
  await rpc(c, 'em_archive_template', { p_actor: actor(c), p_template: uuidParam(c) })
  return ok(c, { archived: true })
})

// ── Consent ──────────────────────────────────────────────────────────────────
marketing.get('/preferences', async (c) => {
  const email = String(c.req.query('email') ?? '').trim().toLowerCase()
  if (!isEmail(email)) throw new HTTPException(400, { message: 'Enter a valid email address.' })
  noStore(c)
  return ok(c, await rpc(c, 'em_get_preference', { p_actor: actor(c), p_email: email }))
})

marketing.put('/preferences', requirePermission('email_consent.manage'), async (c) => {
  const body = await readBoundedJson(c, 8 * 1024)
  const email = String(body?.email ?? '').trim().toLowerCase()
  if (!isEmail(email)) throw new HTTPException(400, { message: 'Enter a valid email address.' })
  const change = {}
  if ('marketing' in (body ?? {})) {
    if (![null, 'subscribed', 'unsubscribed'].includes(body.marketing)) throw new HTTPException(400, { message: 'Unknown preference' })
    change.marketing = body.marketing
    if (body.source !== undefined) change.source = String(body.source).slice(0, 20)
    if (body.note !== undefined) change.note = String(body.note).slice(0, 300)
  }
  if (body?.suppress === true) change.suppress = true
  if (body?.unsuppress === true) change.unsuppress = true
  if (!Object.keys(change).length) throw new HTTPException(400, { message: 'Nothing to change' })
  return ok(c, await rpc(c, 'em_set_preference', { p_actor: actor(c), p_email: email, p_change: change, p_ctx: requestContext(c) },
    { action: 'email.consent' }))
})

// ── Analytics ────────────────────────────────────────────────────────────────
marketing.get('/analytics', async (c) => {
  const days = Math.min(Math.max(Number.parseInt(c.req.query('days'), 10) || 30, 1), 365)
  noStore(c)
  return ok(c, await rpc(c, 'em_email_analytics', { p_actor: actor(c), p_days: days }))
})

export default marketing
