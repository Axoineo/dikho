import { Hono } from 'hono'
import { verifyStandardWebhook } from '../../utils/verifyWebhook.js'
import { sendAuthTemplate } from '../../services/whatsapp/graph.js'
import { logEvent, logError } from '../../utils/logger.js'
import { callUserRpc } from '../../services/userAdmin.js'
import { readBoundedBytes } from '../../utils/body.js'

const auth = new Hono()

// --- POST /api/auth/whatsapp-otp — Supabase "Send SMS" auth hook ----------
//
// This is Supabase's login-OTP delivery hook, not a browser endpoint, so it is
// mounted OUTSIDE requireAuth. Its authenticity comes from the Standard
// Webhooks HMAC signature Supabase applies with SUPABASE_SEND_SMS_HOOK_SECRET;
// without a valid signature the request is rejected before any WhatsApp send.
//
// The SPA calls signInWithOtp with shouldCreateUser=false, but that is a
// client-side choice: while Supabase sign-up is enabled, anyone can create a
// phone user through the Auth API and make Supabase call this hook. So the
// hook itself refuses anyone who is not an ACTIVE staff member, read from the
// database (public.staff_is_active), which also refuses suspended and
// archived people. Without that check this route would send WhatsApp
// messages, at our cost and on our sender reputation, to any number a
// stranger signs up with. If the database cannot be asked, no code is sent.
//
// Error shape follows Supabase's hook contract: `{ error: { http_code, message } }`,
// which surfaces back to the caller as the reason the code could not be sent.
auth.post('/whatsapp-otp', async (c) => {
  // Raw text, not c.req.json(): the exact bytes are what the HMAC is computed
  // over, so parsing first would break verification. Bounded because it is
  // read before the signature is checked; a real hook payload is ~2 KB.
  const raw = new TextDecoder().decode(await readBoundedBytes(c, 64 * 1024))

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

  const userId = typeof payload?.user?.id === 'string' ? payload.user.id : null
  let isStaff = false
  try {
    isStaff = userId ? (await callUserRpc(c, 'staff_is_active', { p_user: userId })) === true : false
  } catch {
    logError('auth.whatsapp_otp.staff_check_failed', 'database unreachable')
    return c.json({ error: { http_code: 503, message: 'Sign-in is temporarily unavailable' } }, 503)
  }
  if (!isStaff) {
    logEvent('auth.whatsapp_otp.not_staff', { user_id: userId })
    return c.json({ error: { http_code: 403, message: 'This number is not authorized to sign in' } }, 403)
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
