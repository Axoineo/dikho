import { Hono } from 'hono'
import { verifyStandardWebhook } from '../../utils/verifyWebhook.js'
import { sendAuthTemplate } from '../../services/whatsapp/graph.js'
import { logEvent, logError } from '../../utils/logger.js'

const auth = new Hono()

// --- POST /api/auth/whatsapp-otp — Supabase "Send SMS" auth hook ----------
//
// This is Supabase's login-OTP delivery hook, not a browser endpoint, so it is
// mounted OUTSIDE requireAuth. Its authenticity comes from the Standard
// Webhooks HMAC signature Supabase applies with SUPABASE_SEND_SMS_HOOK_SECRET;
// without a valid signature the request is rejected before any WhatsApp send.
//
// The whitelist is enforced upstream: the SPA calls signInWithOtp with
// shouldCreateUser=false, so Supabase never generates a code — and never calls
// this hook — for a phone that is not already a Supabase user.
//
// Error shape follows Supabase's hook contract: `{ error: { http_code, message } }`,
// which surfaces back to the caller as the reason the code could not be sent.
auth.post('/whatsapp-otp', async (c) => {
  // Raw text, not c.req.json(): the exact bytes are what the HMAC is computed
  // over, so parsing first would break verification.
  const raw = await c.req.text()

  const verification = await verifyStandardWebhook({
    secret: c.env.SUPABASE_SEND_SMS_HOOK_SECRET,
    headers: c.req.raw.headers,
    body: raw,
  })
  if (!verification.ok) {
    logError('auth.whatsapp_otp.signature_rejected', verification.reason)
    return c.json({ error: { http_code: 401, message: 'Invalid hook signature' } }, 401)
  }

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return c.json({ error: { http_code: 400, message: 'Invalid JSON body' } }, 400)
  }

  // Supabase phone is bare E.164 digits (e.g. "919812345678"), exactly what the
  // Meta `to` field expects — no reformatting needed.
  const phone = payload?.user?.phone
  const code = payload?.sms?.otp
  if (!phone || !code) {
    return c.json({ error: { http_code: 400, message: 'Missing phone or otp' } }, 400)
  }

  // `code` is deliberately never passed to the logger.
  logEvent('auth.whatsapp_otp.sending', { phone })

  const result = await sendAuthTemplate(c.env, { to: phone, code })
  if (!result.ok) {
    logError('auth.whatsapp_otp.send_failed', `${result.errorCode}: ${result.errorMessage}`)
    return c.json(
      { error: { http_code: 502, message: 'Failed to deliver code via WhatsApp' } },
      502,
    )
  }

  logEvent('auth.whatsapp_otp.sent', { phone, messageId: result.messageId })
  return c.json({}, 200)
})

export default auth
