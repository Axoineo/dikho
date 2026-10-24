import { fetchApprovedTemplates, sendTemplateMessage } from './whatsapp/graph.js'
import { buildComponents, sanitizeParam, templateTokens } from '../../lib/templateVars.js'
import { logError, logEvent } from '../utils/logger.js'
import { activeProvider, sendEmail as deliverEmail } from './email/delivery.js'

// "You've been added to Dikho" message, sent when an administrator adds
// someone. Email when the person has one (Amazon SES, or Brevo while it is
// still configured; see services/email/delivery.js), otherwise WhatsApp through
// an approved utility template. It carries no link token or code: the person
// signs in the normal way, with a one-time code to the same email or number.
//
// Spend and abuse limits live in the database (um_claim_welcome): one per
// person per 10 minutes and 30 per day across the workspace, claimed BEFORE
// anything is sent.
//
// Configuration (docs/CONFIGURATION.md):
//   the email delivery settings (EMAIL_PROVIDER, EMAIL_FROM_ADDRESS, AWS_SES_*,
//   or BREVO_API_KEY + BREVO_SENDER_EMAIL), APP_URL
//   WHATSAPP_STAFF_WELCOME_TEMPLATE_NAME, WHATSAPP_STAFF_WELCOME_TEMPLATE_LANG
// A channel whose configuration is missing is skipped, not an error.

export function welcomeChannelFor(env, { email, phone }) {
  if (email && activeProvider(env)) return 'email'
  if (phone && env.WHATSAPP_STAFF_WELCOME_TEMPLATE_NAME && env.WHATSAPP_ACCESS_TOKEN) return 'whatsapp'
  return null
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}

async function sendEmail(env, { email, fullName }) {
  const name = escapeHtml(fullName.split(/\s+/)[0] || fullName)
  const where = env.APP_URL
    ? `<a href="${escapeHtml(env.APP_URL)}" style="color:#185494;">${escapeHtml(env.APP_URL.replace(/^https?:\/\//, ''))}</a>`
    : 'the Dikho dashboard'
  const style = 'font-family:sans-serif;font-size:15px;color:#263247;line-height:1.5;'
  const result = await deliverEmail(env, {
    to: [{ email }],
    subject: 'You have been added to Dikho CRM',
    tags: { purpose: 'staff_welcome' },
    html: `
<p style="${style}">Hi ${name},</p>
<p style="${style}">You now have an account on Dikho CRM.</p>
<p style="${style}">To sign in, open ${where} and enter this email address. We will email you a one-time code. There is no password to remember.</p>
<p style="${style}">If you were not expecting this, you can ignore this email.</p>
<p style="font-family:sans-serif;font-size:13px;color:#5f6c82;">Dikho</p>`,
  })
  return result.ok ? { ok: true } : { ok: false, reason: result.reason }
}

// The approved template as Meta has it, so the send matches its real shape.
// Meta refuses a parameter count that differs from the template's (error
// 132000): that is how every lead confirmation failed in production while it
// hardcoded one body parameter. Exact language first, then the same name in
// any language (an `en_US` template does not answer to `en`).
async function approvedWelcomeTemplate(env) {
  const name = env.WHATSAPP_STAFF_WELCOME_TEMPLATE_NAME
  const language = env.WHATSAPP_STAFF_WELCOME_TEMPLATE_LANG || 'en'
  const list = await fetchApprovedTemplates(env)
  return list.find((t) => t.name === name && t.language === language)
    ?? list.find((t) => t.name === name)
    ?? null
}

// A button that needs its own value (a link ending in {{1}}, a code to copy)
// has nothing to be filled with here.
const buttonNeedsValue = (button) => /\{\{/.test(button?.url ?? '') || ['COPY_CODE', 'OTP'].includes(button?.type)

async function sendWhatsApp(env, { phone, fullName }) {
  const firstName = sanitizeParam(fullName.split(/\s+/)[0] || fullName).slice(0, 60)
  let templateName = env.WHATSAPP_STAFF_WELCOME_TEMPLATE_NAME
  let languageCode = env.WHATSAPP_STAFF_WELCOME_TEMPLATE_LANG || 'en'
  // The documented shape (docs/CONFIGURATION.md): one body variable, the
  // first name. Used as is only when Meta's template list cannot be read.
  let components = [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }]

  let template
  try {
    template = await approvedWelcomeTemplate(env)
  } catch (err) {
    logError('users.welcome.template_lookup_failed', err)
  }
  if (template === null) return { ok: false, reason: `WhatsApp template ${templateName} is not approved` }
  if (template) {
    const tokens = templateTokens(template)
    const buttons = template.buttons ?? []
    if (tokens.length > 1 || buttons.some(buttonNeedsValue)) {
      logEvent('users.welcome.template_shape', { tokens: tokens.length, buttons: buttons.map((b) => b?.type ?? 'unknown') })
      return { ok: false, reason: 'WhatsApp template needs more values than the first name' }
    }
    templateName = template.name
    languageCode = template.language || languageCode
    components = tokens.length
      ? buildComponents(template, { [tokens[0]]: { source: 'literal', value: firstName } }, {})
      : undefined
  }

  const result = await sendTemplateMessage(env, { to: phone, templateName, languageCode, components })
  if (!result.ok) return { ok: false, reason: `WhatsApp error ${result.errorCode}` }
  return { ok: true }
}

/** Sends on the given channel. Never throws; returns { ok, reason? }. */
export async function sendWelcome(env, channel, person) {
  try {
    const result = channel === 'email' ? await sendEmail(env, person) : await sendWhatsApp(env, person)
    if (result.ok) logEvent('users.welcome.sent', { channel })
    else logError('users.welcome.failed', `${channel}: ${result.reason}`)
    return result
  } catch (err) {
    logError('users.welcome.failed', err)
    return { ok: false, reason: 'send failed' }
  }
}
