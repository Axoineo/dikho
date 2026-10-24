import { AwsClient } from 'aws4fetch'
import { isEmail, unsafeHeader } from './mime.js'
import { logError } from '../../utils/logger.js'

// EmailDeliveryService: programmatic mail sent BY Dikho (staff welcome,
// alerts, lead acknowledgements, approved campaigns). Correspondence written
// by a person goes through their connected Gmail mailbox instead.
//
// Providers, behind one small interface (send one message, get a normalized
// result). Campaign semantics stay outside it.
//   ses    Amazon SES v2 (primary). HTTPS API signed with aws4fetch.
//   brevo  kept for the flows that already used it, only while BREVO_API_KEY
//          is set, so nothing that works today stops working.
//
// Configuration (docs/CONFIGURATION.md):
//   EMAIL_PROVIDER            'ses' | 'brevo'. Unset: SES when it is ready,
//                             else Brevo when it is configured.
//   EMAIL_FROM_ADDRESS        verified sender, e.g. noreply@<domain>.
//   EMAIL_FROM_NAME           display name; defaults to "Dikho".
//   AWS_SES_REGION, AWS_SES_ACCESS_KEY_ID, AWS_SES_SECRET_ACCESS_KEY (secret)
//   AWS_SES_CONFIGURATION_SET  required for delivery/bounce/complaint events.
//   EMAIL_SES_SEND_ENABLED    'true' only after the identity, production
//                             access and IAM policy are verified. Off: SES is
//                             never called.
//   BREVO_API_KEY (secret), BREVO_SENDER_EMAIL   legacy provider.
//
// Results: { ok, provider, messageId } on acceptance. On failure: ok false
// with `uncertain` when the provider may have accepted it (timeout, 5xx; the
// caller must NOT resend blindly) or `retryable` for throttling. Acceptance is
// not delivery: delivery, bounces and complaints arrive later as SES events.

const TIMEOUT_MS = 15_000

function sesConfigured(env) {
  return Boolean(env.AWS_SES_REGION && env.AWS_SES_ACCESS_KEY_ID && env.AWS_SES_SECRET_ACCESS_KEY)
    && /^[a-z]{2}(-[a-z]+)+-\d$/.test(env.AWS_SES_REGION)
}

const sesReady = (env) => sesConfigured(env) && env.EMAIL_SES_SEND_ENABLED === 'true' && isEmail(env.EMAIL_FROM_ADDRESS || '')
const brevoReady = (env) => Boolean(env.BREVO_API_KEY) && isEmail(env.BREVO_SENDER_EMAIL || '')

/** The provider transactional mail goes through now, or null. */
export function activeProvider(env) {
  if (env.EMAIL_PROVIDER === 'ses') return sesReady(env) ? 'ses' : null
  if (env.EMAIL_PROVIDER === 'brevo') return brevoReady(env) ? 'brevo' : null
  if (sesReady(env)) return 'ses'
  if (brevoReady(env)) return 'brevo'
  return null
}

/** Yes/no readiness for the settings screen. Never a value or identifier. */
export function deliveryStatus(env) {
  return {
    provider: activeProvider(env),
    from_configured: isEmail(env.EMAIL_FROM_ADDRESS || ''),
    ses: {
      configured: sesConfigured(env),
      sending_enabled: env.EMAIL_SES_SEND_ENABLED === 'true',
      events_configured: Boolean(env.AWS_SES_CONFIGURATION_SET),
      notifications_configured: Boolean(env.AWS_SNS_TOPIC_ARN),
    },
    brevo: { configured: brevoReady(env) },
  }
}

function fromFor(env, provider, from) {
  const email = from?.email || (provider === 'brevo' ? env.BREVO_SENDER_EMAIL : env.EMAIL_FROM_ADDRESS)
  const name = from?.name || env.EMAIL_FROM_NAME || 'Dikho'
  return { email, name }
}

function quoteName(name) {
  return `"${String(name).replace(/[\r\n"\\]/g, '').slice(0, 120)}"`
}

function validate(message) {
  const to = Array.isArray(message.to) ? message.to : []
  if (to.length < 1 || to.length > 50 || !to.every((r) => isEmail(r?.email))) return 'invalid recipients'
  if (typeof message.subject !== 'string' || !message.subject.trim() || message.subject.length > 998 || unsafeHeader(message.subject)) return 'invalid subject'
  if (typeof message.html !== 'string' && typeof message.text !== 'string') return 'empty body'
  for (const [name, value] of Object.entries(message.headers ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(name) || unsafeHeader(value) || String(value).length > 2000) return 'invalid header'
  }
  return null
}

async function sendSes(env, message, from) {
  // retries: 0 — aws4fetch otherwise retries 5xx/429 up to ten times, and a
  // retried SendEmail can deliver the same mail twice.
  const aws = new AwsClient({
    accessKeyId: env.AWS_SES_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SES_SECRET_ACCESS_KEY,
    region: env.AWS_SES_REGION,
    service: 'ses',
    retries: 0,
  })
  const tags = Object.entries(message.tags ?? {})
    .filter(([k, v]) => /^[A-Za-z0-9_-]{1,64}$/.test(k) && /^[A-Za-z0-9_.-]{1,64}$/.test(String(v)))
    .slice(0, 10)
    .map(([Name, Value]) => ({ Name, Value: String(Value) }))
  const body = {
    FromEmailAddress: `${quoteName(from.name)} <${from.email}>`,
    Destination: { ToAddresses: message.to.map((r) => r.email) },
    ...(message.replyTo?.length ? { ReplyToAddresses: message.replyTo.map((r) => r.email).filter(isEmail).slice(0, 5) } : {}),
    Content: {
      Simple: {
        Subject: { Data: message.subject, Charset: 'UTF-8' },
        Body: {
          ...(message.html ? { Html: { Data: message.html, Charset: 'UTF-8' } } : {}),
          ...(message.text ? { Text: { Data: message.text, Charset: 'UTF-8' } } : {}),
        },
        ...(message.headers && Object.keys(message.headers).length
          ? { Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value: String(Value) })) }
          : {}),
      },
    },
    ...(env.AWS_SES_CONFIGURATION_SET ? { ConfigurationSetName: env.AWS_SES_CONFIGURATION_SET } : {}),
    ...(tags.length ? { EmailTags: tags } : {}),
  }

  let res
  try {
    res = await aws.fetch(`https://email.${env.AWS_SES_REGION}.amazonaws.com/v2/email/outbound-emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { ok: false, provider: 'ses', uncertain: true, reason: 'SES did not answer in time' }
  }
  const data = await res.json().catch(() => null)
  if (res.ok && typeof data?.MessageId === 'string') return { ok: true, provider: 'ses', messageId: data.MessageId }
  // SES names the failure in a header or the body; neither carries the message.
  const type = String(res.headers.get('x-amzn-ErrorType') || data?.__type || '').split(':')[0].slice(0, 60)
  if (res.status >= 500) return { ok: false, provider: 'ses', uncertain: true, reason: `SES error ${res.status}` }
  if (res.status === 429 || /Throttl|TooManyRequests|LimitExceeded/i.test(type)) {
    return { ok: false, provider: 'ses', retryable: true, reason: 'SES is throttling sends' }
  }
  logError('email.ses.rejected', `${res.status} ${type}`)
  return { ok: false, provider: 'ses', reason: `SES refused the message (${type || res.status})` }
}

async function sendBrevo(env, message, from) {
  let res
  try {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        sender: { name: from.name, email: from.email },
        to: message.to.map((r) => (r.name ? { email: r.email, name: r.name } : { email: r.email })),
        ...(message.replyTo?.[0] ? { replyTo: { email: message.replyTo[0].email } } : {}),
        subject: message.subject,
        ...(message.html ? { htmlContent: message.html } : {}),
        ...(message.text ? { textContent: message.text } : {}),
        ...(message.headers && Object.keys(message.headers).length ? { headers: message.headers } : {}),
      }),
    })
  } catch {
    return { ok: false, provider: 'brevo', uncertain: true, reason: 'Brevo did not answer in time' }
  }
  const data = await res.json().catch(() => null)
  if (res.ok) return { ok: true, provider: 'brevo', messageId: typeof data?.messageId === 'string' ? data.messageId : null }
  if (res.status >= 500) return { ok: false, provider: 'brevo', uncertain: true, reason: `email provider returned ${res.status}` }
  if (res.status === 429) return { ok: false, provider: 'brevo', retryable: true, reason: 'email provider is throttling sends' }
  return { ok: false, provider: 'brevo', reason: `email provider returned ${res.status}` }
}

/**
 * Sends one message through `provider` (default: the active one). Never
 * throws. message: { to: [{ email, name? }], subject, html?, text?,
 * from?: { email, name }, replyTo?: [{ email }], headers?: {}, tags?: {} }
 */
export async function sendEmail(env, message, { provider = activeProvider(env) } = {}) {
  if (!provider) return { ok: false, provider: null, reason: 'no email provider is configured' }
  if (provider === 'ses' && !sesReady(env)) return { ok: false, provider, reason: 'SES sending is not enabled' }
  if (provider === 'brevo' && !brevoReady(env)) return { ok: false, provider, reason: 'Brevo is not configured' }
  const invalid = validate(message)
  if (invalid) return { ok: false, provider, reason: invalid }
  const from = fromFor(env, provider, message.from)
  if (!isEmail(from.email)) return { ok: false, provider, reason: 'no sender address is configured' }
  return provider === 'ses' ? sendSes(env, message, from) : sendBrevo(env, message, from)
}
