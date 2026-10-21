import { fromBase64 } from './crypto.js'

// Amazon SNS message verification, for SES delivery/bounce/complaint events
// pushed to POST /api/email/webhooks/ses. Follows AWS's documented procedure,
// and fails closed:
//   - Type is Notification, SubscriptionConfirmation or UnsubscribeConfirmation;
//   - TopicArn is exactly the configured AWS_SNS_TOPIC_ARN (so another
//     account's topic cannot feed us events, or get a subscription confirmed);
//   - SigningCertURL is https on sns.<region>.amazonaws.com and ends in .pem;
//   - SignatureVersion 1 (SHA1withRSA) or 2 (SHA256withRSA) over the
//     documented string to sign, checked with the certificate's public key;
//   - Timestamp is no more than an hour old (duplicates inside that window are
//     caught by the notification id in the database).
// The certificate's public key is read with a minimal DER walk (X.509 ->
// tbsCertificate -> subjectPublicKeyInfo), so no crypto library is needed.

const CERT_HOST = /^sns\.[a-z0-9-]{2,30}\.amazonaws\.com(\.cn)?$/
const TYPES = new Set(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'])
const MAX_AGE_MS = 60 * 60 * 1000

export function snsUrlAllowed(value, { pem = false } = {}) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && CERT_HOST.test(url.hostname) && !url.port && !url.username && !url.password
      && (!pem || url.pathname.endsWith('.pem'))
  } catch {
    return false
  }
}

// ── DER ──────────────────────────────────────────────────────────────────────
function readTlv(bytes, pos) {
  if (pos + 2 > bytes.length) throw new Error('truncated DER')
  const tag = bytes[pos]
  let length = bytes[pos + 1]
  let offset = pos + 2
  if (length & 0x80) {
    const count = length & 0x7f
    if (count < 1 || count > 4) throw new Error('bad DER length')
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + bytes[offset++]
  }
  const end = offset + length
  if (end > bytes.length) throw new Error('truncated DER')
  return { tag, start: pos, valueStart: offset, end }
}

/** The SubjectPublicKeyInfo (DER) of an X.509 certificate (DER). */
export function spkiFromCertificate(der) {
  const cert = readTlv(der, 0)
  if (cert.tag !== 0x30) throw new Error('not a certificate')
  const tbs = readTlv(der, cert.valueStart)
  if (tbs.tag !== 0x30) throw new Error('not a certificate')
  let field = readTlv(der, tbs.valueStart)
  if (field.tag === 0xa0) field = readTlv(der, field.end) // explicit version
  // serialNumber -> signature -> issuer -> validity -> subject -> subjectPublicKeyInfo
  for (let i = 0; i < 5; i++) field = readTlv(der, field.end)
  if (field.tag !== 0x30) throw new Error('no public key')
  return der.slice(field.start, field.end)
}

export function derFromPem(pem) {
  const match = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----/.exec(String(pem))
  if (!match) throw new Error('no certificate in PEM')
  return fromBase64(match[1].replace(/\s+/g, ''))
}

// ── Keys from AWS's certificates, cached per isolate ─────────────────────────
const keyCache = new Map()

export async function keyFromCertUrl(url, hash) {
  const cacheKey = `${hash}|${url}`
  if (keyCache.has(cacheKey)) return keyCache.get(cacheKey)
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`certificate ${res.status}`)
  const text = await res.text()
  if (text.length > 16_384) throw new Error('certificate too large')
  const key = await crypto.subtle.importKey('spki', spkiFromCertificate(derFromPem(text)),
    { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify'])
  if (keyCache.size > 20) keyCache.clear()
  keyCache.set(cacheKey, key)
  return key
}

/** The exact string SNS signs, per message type. */
export function stringToSign(message) {
  const keys = message.Type === 'Notification'
    ? ['Message', 'MessageId', ...(message.Subject !== undefined && message.Subject !== null ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
  return keys.map((k) => `${k}\n${message[k]}\n`).join('')
}

/**
 * Verifies a parsed SNS message. Returns { ok: true } or { ok: false, reason }.
 * `getKey` is replaceable in tests (it normally fetches AWS's certificate).
 */
export async function verifySnsMessage(env, message, { getKey = keyFromCertUrl, now = Date.now() } = {}) {
  const topic = env.AWS_SNS_TOPIC_ARN
  if (!topic) return { ok: false, reason: 'not_configured' }
  if (!message || typeof message !== 'object' || !TYPES.has(message.Type)) return { ok: false, reason: 'type' }
  if (message.TopicArn !== topic) return { ok: false, reason: 'topic' }
  for (const k of ['Message', 'MessageId', 'Timestamp', 'Signature', 'SigningCertURL']) {
    if (typeof message[k] !== 'string' || !message[k]) return { ok: false, reason: 'shape' }
  }
  if (message.Type !== 'Notification' && (typeof message.SubscribeURL !== 'string' || typeof message.Token !== 'string')) {
    return { ok: false, reason: 'shape' }
  }
  const hash = message.SignatureVersion === '2' ? 'SHA-256' : message.SignatureVersion === '1' ? 'SHA-1' : null
  if (!hash) return { ok: false, reason: 'signature_version' }
  if (!snsUrlAllowed(message.SigningCertURL, { pem: true })) return { ok: false, reason: 'cert_url' }
  const sent = Date.parse(message.Timestamp)
  if (!Number.isFinite(sent) || now - sent > MAX_AGE_MS || sent - now > 5 * 60 * 1000) return { ok: false, reason: 'stale' }

  try {
    const key = await getKey(message.SigningCertURL, hash)
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64(message.Signature), new TextEncoder().encode(stringToSign(message)))
    return valid ? { ok: true } : { ok: false, reason: 'signature' }
  } catch {
    return { ok: false, reason: 'signature' }
  }
}

const EVENT_TYPES = {
  send: 'send', delivery: 'delivery', bounce: 'bounce', complaint: 'complaint', reject: 'reject',
  deliverydelay: 'delivery_delay', 'rendering failure': 'rendering_failure', renderingfailure: 'rendering_failure',
}

const emails = (list, key) => (Array.isArray(list) ? list : []).map((r) => (key ? r?.[key] : r)).filter((e) => typeof e === 'string').slice(0, 50)

/**
 * An SES event (the SNS Message, parsed) as em_record_delivery_event takes it.
 * Addresses are passed for their effect on consent/suppression and are not
 * stored with the event.
 */
export function normalizeSesEvent(notificationId, event) {
  const raw = String(event?.eventType ?? event?.notificationType ?? '').toLowerCase()
  const type = EVENT_TYPES[raw] ?? 'other'
  const mail = event?.mail ?? {}
  let recipients = []
  if (type === 'bounce') recipients = emails(event.bounce?.bouncedRecipients, 'emailAddress')
  else if (type === 'complaint') recipients = emails(event.complaint?.complainedRecipients, 'emailAddress')
  else if (type === 'delivery') recipients = emails(event.delivery?.recipients)
  else recipients = emails(mail.destination)
  const tag = (name) => (Array.isArray(mail.tags?.[name]) ? String(mail.tags[name][0]).slice(0, 64) : null)
  return {
    notification_id: notificationId,
    provider_message_id: typeof mail.messageId === 'string' ? mail.messageId.slice(0, 200) : null,
    event_type: type,
    occurred_at: event?.[raw === 'deliverydelay' ? 'deliveryDelay' : type]?.timestamp ?? mail.timestamp ?? null,
    recipients,
    permanent: type === 'bounce' && event.bounce?.bounceType === 'Permanent',
    detail: {
      bounce_type: event?.bounce?.bounceType ?? null,
      bounce_subtype: event?.bounce?.bounceSubType ?? null,
      complaint_type: event?.complaint?.complaintFeedbackType ?? null,
      campaign: tag('campaign'),
      purpose: tag('purpose'),
    },
  }
}
