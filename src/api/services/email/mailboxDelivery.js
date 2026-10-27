import { gmail, uploadBody, GmailError, GmailUncertainError, GoogleAuthError } from './google.js'
import { hostinger, HostingerAuthError, HostingerError, HostingerUncertainError } from './hostinger.js'
import { TokenKeyError } from './crypto.js'
import { buildMessage, formatAddress } from './mime.js'
import { logError } from '../../utils/logger.js'

// Campaign and test mail sent through a connected mailbox (Gmail or
// Hostinger) instead of Amazon SES. One message, one recipient, one attempt.
//
// Outcomes, never thrown:
//   { ok, messageId }            the provider accepted it (not proof of delivery)
//   { uncertain, reason }        it may have gone out: never resent automatically
//   { retryable, cooldown, reason }  the provider is limiting this mailbox: the
//                                recipient goes back to the queue and the
//                                mailbox rests for `cooldown` seconds
//   { pause, reason }            the mailbox itself was refused: stop the campaign
//   { failed, reason }           this message was refused
//
// Mailbox providers are not bulk services. Limits are Dikho's own (the
// organization and per-mailbox daily caps); a provider limit is respected,
// never worked around, and nothing switches to another mailbox.

const GMAIL_LIMIT_REASONS = new Set(['dailyLimitExceeded', 'userRateLimitExceeded', 'rateLimitExceeded', 'quotaExceeded'])

async function viaGmail(env, sender, message) {
  const account = { id: sender.id, email_address: sender.email_address, token_enc: sender.token_enc }
  const extraHeaders = { ...(message.headers ?? {}) }
  if (message.replyTo?.[0]?.email) extraHeaders['Reply-To'] = formatAddress({ email: message.replyTo[0].email })
  let raw
  try {
    raw = buildMessage({
      from: { email: sender.email_address, name: message.from?.name || sender.display_name || null },
      to: message.to, subject: message.subject, html: message.html, text: message.text, extraHeaders,
    })
  } catch {
    return { failed: true, reason: 'The message could not be built.' }
  }
  try {
    const sent = await gmail(env, account, '/messages/send', { method: 'POST', retry: false, upload: uploadBody({}, raw) })
    return { ok: true, messageId: typeof sent?.id === 'string' ? sent.id : null }
  } catch (err) {
    if (err instanceof GmailUncertainError) return { uncertain: true, reason: 'Gmail did not confirm the send.' }
    if (err instanceof GoogleAuthError || err instanceof TokenKeyError) {
      return { pause: true, reason: 'Google no longer accepts Dikho\'s access to the sending mailbox. Reconnect it, then resume.' }
    }
    if (err instanceof GmailError && (err.status === 429 || GMAIL_LIMIT_REASONS.has(err.reason))) {
      return { retryable: true, cooldown: err.reason === 'dailyLimitExceeded' ? 6 * 3600 : 15 * 60, reason: 'Gmail is limiting sends from this mailbox.' }
    }
    if (err instanceof GmailError) return { failed: true, reason: err.message }
    logError('email.mailbox_send.gmail_error', err)
    return { uncertain: true, reason: 'Unexpected error while sending.' }
  }
}

async function viaHostinger(env, sender, message) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sender.provider_account_id ?? '')) {
    return { pause: true, reason: 'The sending mailbox needs to be connected to Hostinger again.' }
  }
  // Hostinger's send API takes no custom headers and no Reply-To: the
  // unsubscribe link is in the footer only (submission refuses a reply-to).
  const body = {
    to: message.to.map((r) => r.email),
    subject: message.subject,
    html: message.html,
    text: message.text,
    displayName: String(message.from?.name || sender.display_name || '').replace(/[\r\n"]/g, '').slice(0, 120) || undefined,
  }
  try {
    await hostinger(env, `/mailboxes/${encodeURIComponent(sender.provider_account_id)}/send`, { method: 'POST', body, retry: false, timeoutMs: 30_000 })
    return { ok: true, messageId: null }
  } catch (err) {
    if (err instanceof HostingerUncertainError) return { uncertain: true, reason: 'Hostinger did not confirm the send.' }
    if (err instanceof HostingerAuthError) return { pause: true, reason: 'Hostinger did not accept Dikho\'s API token.' }
    if (err instanceof HostingerError && err.status === 429) return { retryable: true, cooldown: 15 * 60, reason: 'Hostinger is limiting sends.' }
    if (err instanceof HostingerError && (err.status === 403 || err.code === 'ERR_MAILBOX_NOT_FOUND')) {
      return { pause: true, reason: 'Dikho\'s Hostinger API token no longer covers the sending mailbox.' }
    }
    if (err instanceof HostingerError) return { failed: true, reason: err.message }
    logError('email.mailbox_send.hostinger_error', err)
    return { uncertain: true, reason: 'Unexpected error while sending.' }
  }
}

/** Sends one prepared campaign message (buildCampaignMessage) through `sender`. */
export async function sendThroughMailbox(env, sender, message) {
  if (sender?.provider === 'google') return viaGmail(env, sender, message)
  if (sender?.provider === 'hostinger') return viaHostinger(env, sender, message)
  return { pause: true, reason: 'The sending mailbox uses an unknown provider.' }
}
