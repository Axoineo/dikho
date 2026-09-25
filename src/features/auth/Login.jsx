import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Icon } from '../../components/Icon'

const DEFAULT_COUNTRY_CODE = '91'

// Normalises user input to E.164 with a leading "+", which is what Supabase
// phone auth expects. Mirrors the Worker's src/api/utils/phone.js rules so a
// number entered here matches the one stored on the Supabase user.
function toE164(input) {
  const digits = String(input ?? '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) return `+${DEFAULT_COUNTRY_CODE}${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`
  return null
}

// Supabase returns a generic error when shouldCreateUser is false and the phone
// isn't a known user; make that human instead of leaking the raw code.
function friendlyError(method, message) {
  if (method === 'whatsapp' && /signups? not allowed|otp_disabled|not found/i.test(message || '')) {
    return "This number isn't authorized. Contact an admin to get access."
  }
  return message
}

export default function Login({ onLogin }) {
  const [method, setMethod] = useState('email') // 'email' | 'whatsapp'
  const [step, setStep] = useState('entry') // 'entry' | 'otp'
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const otpRefs = useRef([])

  // The E.164 phone actually sent to Supabase — kept so verify/resend use the
  // exact same value the code was requested for.
  const [sentPhone, setSentPhone] = useState('')

  // Resend countdown
  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [resendCooldown])

  function switchMethod(next) {
    if (next === method) return
    setMethod(next)
    setStep('entry')
    setError('')
    setOtp(['', '', '', '', '', ''])
  }

  // Requests an OTP for whichever method is active. Shared by the entry form
  // and the resend button.
  async function requestOtp() {
    if (method === 'whatsapp') {
      const e164 = toE164(phone)
      if (!e164) {
        setError('Enter a valid phone number.')
        return { error: true }
      }
      setSentPhone(e164)
      const { error: authError } = await supabase.auth.signInWithOtp({
        phone: e164,
        options: { shouldCreateUser: false },
      })
      return { error: authError ? friendlyError('whatsapp', authError.message) : null }
    }

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    })
    return { error: authError ? friendlyError('email', authError.message) : null }
  }

  async function handleSendOtp(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error: authError } = await requestOtp()
    if (authError) {
      setError(authError)
    } else if (authError !== true) {
      setStep('otp')
      setResendCooldown(60)
      setTimeout(() => otpRefs.current[0]?.focus(), 50)
    }
    setLoading(false)
  }

  async function handleVerifyOtpValues(values) {
    const token = values.join('')
    if (token.length !== 6) return
    setLoading(true)
    setError('')
    const params =
      method === 'whatsapp'
        ? { phone: sentPhone, token, type: 'sms' }
        : { email, token, type: 'email' }
    const { data, error: authError } = await supabase.auth.verifyOtp(params)
    if (authError) {
      setError(authError.message)
      setOtp(['', '', '', '', '', ''])
      setTimeout(() => otpRefs.current[0]?.focus(), 0)
    } else {
      checkDevice()
      onLogin(data.session)
    }
    setLoading(false)
  }

  function checkDevice() {
    try {
      let deviceId = localStorage.getItem('dikho_device_id')
      if (!deviceId) {
        deviceId = crypto.randomUUID()
        localStorage.setItem('dikho_device_id', deviceId)
      }
      supabase.functions.invoke('device-check', { body: { device_id: deviceId } }).catch(() => {})
    } catch {
      // Never block login on device-check failure
    }
  }

  function handleOtpChange(index, value) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = otp.slice()
    next[index] = digit
    setOtp(next)
    if (digit && index < 5) otpRefs.current[index + 1]?.focus()
    if (digit && next.every((d) => d !== '')) handleVerifyOtpValues(next)
  }

  function handleOtpKeyDown(index, e) {
    if (e.key === 'Backspace' && otp[index] === '' && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && index > 0) otpRefs.current[index - 1]?.focus()
    if (e.key === 'ArrowRight' && index < 5) otpRefs.current[index + 1]?.focus()
  }

  function handleOtpPaste(e) {
    e.preventDefault()
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!text) return
    const next = ['', '', '', '', '', '']
    for (let i = 0; i < text.length; i++) next[i] = text[i]
    setOtp(next)
    otpRefs.current[Math.min(text.length, 5)]?.focus()
    if (text.length === 6) handleVerifyOtpValues(next)
  }

  async function handleResend() {
    setError('')
    setOtp(['', '', '', '', '', ''])
    const { error: authError } = await requestOtp()
    if (authError && authError !== true) {
      setError(authError)
    } else {
      setResendCooldown(60)
      setTimeout(() => otpRefs.current[0]?.focus(), 50)
    }
  }

  const rightPanel = (
    <div className="login-right">
      <div className="background-logo">dikho</div>
      <div className="welcome-content">
        <div className="orange-mark" />
        <h2>Welcome to<br />Dikho</h2>
        <p>Manage your clients, vendors and business operations in one place.</p>
      </div>
    </div>
  )

  if (step === 'otp') {
    const sentTo = method === 'whatsapp' ? sentPhone : email
    return (
      <div className="login-page">
        <div className="login-left">
          <div className="login-box">
            <img src="/dikho-logo.svg" alt="Dikho" className="login-logo" />

            <h1>{method === 'whatsapp' ? 'Check WhatsApp' : 'Check your email'}</h1>
            <p className="login-subtitle">
              Enter the 6-digit code sent to <strong>{sentTo}</strong>
            </p>

            <form onSubmit={(e) => { e.preventDefault(); handleVerifyOtpValues(otp) }}>
              <div className="otp-row" onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el }}
                    className="otp-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    aria-label={`Digit ${i + 1} of 6`}
                    disabled={loading}
                  />
                ))}
              </div>

              {error && (
                <div className="auth-error" role="alert">
                  <span className="auth-error-icon"><Icon name="alert" size={17} /></span>
                  <div>
                    <strong>Invalid code</strong>
                    <p>{error}</p>
                  </div>
                </div>
              )}

              <button
                className="primary-button login-button"
                type="submit"
                disabled={loading || otp.join('').length !== 6}
              >
                {loading ? 'Verifying…' : 'Verify code'}
              </button>
            </form>

            <div className="otp-footer">
              {resendCooldown > 0 ? (
                <span className="otp-cooldown">Resend in {resendCooldown}s</span>
              ) : (
                <button type="button" className="otp-link" onClick={handleResend}>
                  Resend code
                </button>
              )}
              <span className="otp-sep">·</span>
              <button
                type="button"
                className="otp-link"
                onClick={() => { setStep('entry'); setError(''); setOtp(['', '', '', '', '', '']) }}
              >
                {method === 'whatsapp' ? 'Change number' : 'Change email'}
              </button>
            </div>
          </div>
        </div>
        {rightPanel}
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="login-box">
          <img src="/dikho-logo.svg" alt="Dikho" className="login-logo" />

          <h1>Sign in to your account</h1>
          <p className="login-subtitle">Access your Dikho.</p>

          <div className="login-method-toggle" role="tablist" aria-label="Sign-in method">
            <button
              type="button"
              role="tab"
              aria-selected={method === 'email'}
              className={`login-method-btn${method === 'email' ? ' active' : ''}`}
              onClick={() => switchMethod('email')}
            >
              <Icon name="mail" size={16} /> Email
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === 'whatsapp'}
              className={`login-method-btn${method === 'whatsapp' ? ' active' : ''}`}
              onClick={() => switchMethod('whatsapp')}
            >
              <Icon name="whatsapp" size={16} /> WhatsApp
            </button>
          </div>

          <form onSubmit={handleSendOtp}>
            {method === 'whatsapp' ? (
              <>
                <label htmlFor="login-phone">Phone number</label>
                <input
                  id="login-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  autoComplete="tel"
                  required
                />
              </>
            ) : (
              <>
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  autoComplete="email"
                  required
                />
              </>
            )}

            {error && (
              <div className="auth-error" role="alert">
                <span className="auth-error-icon"><Icon name="alert" size={17} /></span>
                <div>
                  <strong>Unable to send code</strong>
                  <p>{error}</p>
                </div>
              </div>
            )}

            <button className="primary-button login-button" disabled={loading}>
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>
        </div>
      </div>
      {rightPanel}
    </div>
  )
}
