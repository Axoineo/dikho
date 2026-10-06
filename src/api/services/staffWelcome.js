import { sendTemplateMessage } from './whatsapp/graph.js'
import { logError, logEvent } from '../utils/logger.js'

// "You've been added to Dikho" message, sent when an administrator adds
// someone. Email when the person has one (Brevo), otherwise WhatsApp through
// an approved utility template. It carries no link token or code: the person
// signs in the normal way, with a one-time code to the same email or number.
//
// Spend and abuse limits live in the database (um_claim_welcome): one per
// person per 10 minutes and 30 per day across the workspace, claimed BEFORE
// anything is sent.
//
// Configuration (docs/CONFIGURATION.md):
//   BREVO_API_KEY (secret), BREVO_SENDER_EMAIL, APP_URL
//   WHATSAPP_STAFF_WELCOME_TEMPLATE_NAME, WHATSAPP_STAFF_WELCOME_TEMPLATE_LANG
// A channel whose configuration is missing is skipped, not an error.

const TIMEOUT_MS = 10_000

export function welcomeChannelFor(env, { email, phone }) {
  if (email && env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL) return 'email'
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
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      sender: { name: 'Dikho', email: env.BREVO_SENDER_EMAIL },
      to: [{ email }],
      subject: 'You have been added to Dikho CRM',
      htmlContent: `
<p style="${style}">Hi ${name},</p>
<p style="${style}">You now have an account on Dikho CRM.</p>
<p style="${style}">To sign in, open ${where} and enter this email address. We will email you a one-time code. There is no password to remember.</p>
<p style="${style}">If you were not expecting this, you can ignore this email.</p>
<p style="font-family:sans-serif;font-size:13px;color:#5f6c82;">Dikho</p>`,
    }),
  })
  if (!res.ok) return { ok: false, reason: `email provider returned ${res.status}` }
  return { ok: true }
}

async function sendWhatsApp(env, { phone, fullName }) {
  const result = await sendTemplateMessage(env, {
    to: phone,
    templateName: env.WHATSAPP_STAFF_WELCOME_TEMPLATE_NAME,
    languageCode: env.WHATSAPP_STAFF_WELCOME_TEMPLATE_LANG || 'en',
    components: [{ type: 'body', parameters: [{ type: 'text', text: (fullName.split(/\s+/)[0] || fullName).slice(0, 60) }] }],
  })
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
