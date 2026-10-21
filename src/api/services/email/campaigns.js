import { callUserRpc } from '../userAdmin.js'
import { sendEmail, activeProvider } from './delivery.js'
import { hmacSha256, safeEqual, sha256Hex } from './crypto.js'
import { htmlToText } from './sanitizeHtml.js'
import { isEmail } from './mime.js'
import { logError, logEvent } from '../../utils/logger.js'

// Campaign sending, personalization and unsubscribe links.
//
// Dispatch claims one batch at a time from the database (em_claim_campaign_batch:
// approval re-checked, consent re-checked, daily budget advanced), sends it
// through Amazon SES only, and records every result. It is driven by API
// traffic, the scheduled handler when cron fires, and POST /email/jobs/run
// for an external scheduler; any of them may run at once safely.
//
// Configuration (docs/CONFIGURATION.md):
//   API_PUBLIC_URL               https origin of this API Worker (unsubscribe links)
//   EMAIL_DAILY_CAP              positive daily ceiling on campaign sends (UTC)
//   EMAIL_CAMPAIGN_SENDERS       comma-separated verified From addresses
//                                (defaults to EMAIL_FROM_ADDRESS)
//   EMAIL_CAMPAIGN_MAX_RECIPIENTS   per-campaign limit, default 5000
//   EMAIL_FOOTER_ADDRESS         optional postal address for the footer

const rpc = (env, fn, args) => callUserRpc({ env }, fn, args)
const BATCH = 20
const CONCURRENCY = 5

// ── Variables ────────────────────────────────────────────────────────────────
// The only placeholders a campaign or template may use. Unknown ones are
// refused when saving, so nothing is ever looked up by a name a person typed.
export const CAMPAIGN_VARIABLES = {
  first_name: 'First name',
  name: 'Full name',
  company: 'Company',
  email: 'Email address',
}
// Extra placeholders for transactional templates, filled by the workflow
// that sends them (never by a recipient list).
export const TRANSACTIONAL_VARIABLES = {
  client_name: 'Client name',
  company_name: 'Company name',
  salesperson: 'Assigned salesperson',
  reference: 'Reference number',
  amount: 'Amount',
  due_date: 'Due date',
}
const VARIABLE = /\{\{\s*([a-z_]{1,40})\s*\}\}/g

/** Placeholders used in the given texts that are not allowed. */
export function unknownVariables(texts, allowed = CAMPAIGN_VARIABLES) {
  const bad = new Set()
  for (const text of texts) for (const m of String(text ?? '').matchAll(VARIABLE)) if (!(m[1] in allowed)) bad.add(m[1])
  return [...bad]
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Fills placeholders. In HTML the values are escaped; elsewhere plain. */
export function fillVariables(text, values, { html = false } = {}) {
  return String(text ?? '').replace(VARIABLE, (whole, key) => {
    if (!(key in values)) return whole
    const value = String(values[key] ?? '').replace(/[\r\n]+/g, ' ')
    return html ? escapeHtml(value) : value
  })
}

export function recipientValues(recipient) {
  const name = (recipient.name || '').trim()
  return {
    first_name: name.split(/\s+/)[0] || 'there',
    name: name || 'there',
    company: (recipient.company || '').trim(),
    email: recipient.email,
  }
}

// ── Senders and readiness ────────────────────────────────────────────────────
export function allowedSenders(env) {
  const list = (env.EMAIL_CAMPAIGN_SENDERS || env.EMAIL_FROM_ADDRESS || '').split(',').map((s) => s.trim().toLowerCase())
  return list.filter(isEmail)
}

export function dailyCap(env) {
  const n = Number.parseInt(env.EMAIL_DAILY_CAP, 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : null
}

export const maxRecipients = (env) => {
  const n = Number.parseInt(env.EMAIL_CAMPAIGN_MAX_RECIPIENTS, 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50_000) : 5000
}

function publicApiUrl(env) {
  const base = (env.API_PUBLIC_URL || '').replace(/\/+$/, '')
  return /^https:\/\/[^/]+$/.test(base) ? base : null
}

/** Everything campaign sending needs, as yes/no with what is missing. */
export function campaignReadiness(env) {
  const missing = []
  if (env.EMAIL_SES_SEND_ENABLED !== 'true' || activeProvider({ ...env, EMAIL_PROVIDER: 'ses' }) !== 'ses') missing.push('Amazon SES sending')
  if (!allowedSenders(env).length) missing.push('a verified sender address')
  if (!dailyCap(env)) missing.push('a daily sending limit')
  if (!publicApiUrl(env)) missing.push('the public API address for unsubscribe links')
  if (!env.EMAIL_TOKEN_KEY) missing.push('the signing key')
  return { ready: missing.length === 0, missing }
}

// ── Unsubscribe links ────────────────────────────────────────────────────────
const unsubscribeKeyFrom = (secret) => (secret ? sha256Hex(`dikho-unsubscribe:${secret}`) : null)
const unsubscribeKey = (env) => unsubscribeKeyFrom(env.EMAIL_TOKEN_KEY)

export async function unsubscribeUrl(env, recipientId) {
  const key = await unsubscribeKey(env)
  const base = publicApiUrl(env)
  if (!key || !base) return null
  return `${base}/api/email/unsubscribe?r=${recipientId}&s=${await hmacSha256(key, `r:${recipientId}`)}`
}

// Links signed before a key rotation keep working while the previous key is
// configured: someone must always be able to unsubscribe.
export async function verifyUnsubscribe(env, recipientId, signature) {
  if (!/^[0-9a-f-]{36}$/.test(recipientId ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(signature ?? '')) return false
  for (const secret of [env.EMAIL_TOKEN_KEY, env.EMAIL_TOKEN_KEY_PREVIOUS]) {
    const key = await unsubscribeKeyFrom(secret)
    if (key && safeEqual(await hmacSha256(key, `r:${recipientId}`), signature)) return true
  }
  return false
}

// ── Building one message ─────────────────────────────────────────────────────
export async function buildCampaignMessage(env, campaign, recipient) {
  const values = recipientValues(recipient)
  const link = await unsubscribeUrl(env, recipient.id)
  const sender = escapeHtml(campaign.from_name || env.EMAIL_FROM_NAME || 'Dikho')
  const address = env.EMAIL_FOOTER_ADDRESS ? `<br>${escapeHtml(String(env.EMAIL_FOOTER_ADDRESS).slice(0, 200))}` : ''
  const preheader = campaign.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(fillVariables(campaign.preheader, values))}</div>`
    : ''
  const footer = `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font:12px/1.5 Arial,sans-serif;color:#6b7280">`
    + `You receive this because you agreed to hear from ${sender}.${address}<br>`
    + `<a href="${escapeHtml(link)}" style="color:#6b7280">Unsubscribe</a></div>`
  const body = fillVariables(campaign.html, values, { html: true })
  const text = `${fillVariables(campaign.text_body || htmlToText(campaign.html), values)}\n\n--\nYou receive this because you agreed to hear from ${campaign.from_name || 'us'}.\nUnsubscribe: ${link}`
  return {
    from: { email: campaign.from_email, name: campaign.from_name || null },
    to: [{ email: recipient.email, name: recipient.name || null }],
    replyTo: campaign.reply_to ? [{ email: campaign.reply_to }] : [],
    subject: fillVariables(campaign.subject, values).slice(0, 900),
    html: `${preheader}${body}${footer}`,
    text,
    headers: {
      // RFC 8058 one-click unsubscribe: mail apps POST to the link.
      'List-Unsubscribe': `<${link}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: { purpose: 'marketing', campaign: campaign.id },
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

/**
 * Sends one batch of whichever approved campaign is due. Never throws.
 * Returns { sent, failed, uncertain, retry } counts, or { idle } / { skipped }.
 */
export async function dispatchCampaignBatch(env) {
  if (!campaignReadiness(env).ready) return { skipped: 'not_ready' }
  let batch
  try {
    batch = await rpc(env, 'em_claim_campaign_batch', { p_limit: BATCH, p_daily_cap: dailyCap(env) })
  } catch (err) {
    logError('email.campaign.claim_failed', err)
    return { skipped: 'claim_failed' }
  }
  if (!batch) return { idle: true }

  const senders = allowedSenders(env)
  const results = await mapLimit(batch.recipients, CONCURRENCY, async (recipient) => {
    if (!senders.includes(String(batch.campaign.from_email).toLowerCase())) {
      return { id: recipient.id, status: 'failed', error: 'The sender is not a verified campaign sender.' }
    }
    try {
      const result = await sendEmail(env, await buildCampaignMessage(env, batch.campaign, recipient), { provider: 'ses' })
      if (result.ok) return { id: recipient.id, status: 'sent', message_id: result.messageId }
      if (result.retryable) return { id: recipient.id, status: 'pending', error: result.reason }
      if (result.uncertain) return { id: recipient.id, status: 'uncertain', error: result.reason }
      return { id: recipient.id, status: 'failed', error: result.reason }
    } catch (err) {
      logError('email.campaign.send_error', err)
      return { id: recipient.id, status: 'uncertain', error: 'unexpected error while sending' }
    }
  })

  try {
    await rpc(env, 'em_finish_campaign_batch', { p_results: results })
  } catch (err) {
    // Rows stay 'sending' and turn 'uncertain' after ten minutes: never resent.
    logError('email.campaign.record_failed', err)
  }
  const count = (s) => results.filter((r) => r.status === s).length
  const summary = { sent: count('sent'), failed: count('failed'), uncertain: count('uncertain'), retry: count('pending') }
  logEvent('email.campaign.batch', summary)
  return summary
}

// Request-driven dispatch (cron does not fire on this plan), at most every
// 30 s per isolate, after the response.
let lastDispatch = 0
export function maybeDispatchCampaignsOnRequest(c) {
  if (c.env?.EMAIL_HUB_ENABLED !== 'true') return
  // Hono's executionCtx getter throws where there is none; a background hook
  // must never be able to fail the request it rides on.
  let ctx
  try { ctx = c.executionCtx } catch { return }
  const now = Date.now()
  if (now - lastDispatch < 30_000) return
  lastDispatch = now
  if (!campaignReadiness(c.env).ready) return
  ctx.waitUntil(dispatchCampaignBatch(c.env).catch((err) => logError('email.campaign.dispatch_failed', err)))
}
