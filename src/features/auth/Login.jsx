import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Icon } from '../../components/Icon'

export default function Login({ onLogin }) {
  const [step, setStep] = useState('email') // 'email' | 'otp'
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const otpRefs = useRef([])

  // Resend countdown
  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [resendCooldown])

  async function handleSendOtp(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    })
    if (authError) {
      setError(authError.message)
    } else {
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
    const { data, error: authError } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })
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
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    if (authError) {
      setError(authError.message)
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
    return (
      <div className="login-page">
        <div className="login-left">
          <div className="login-box">
            <img src="/dikho-logo.png" alt="Dikho" className="login-logo" />

            <h1>Check your email</h1>
            <p className="login-subtitle">
              Enter the 6-digit code sent to <strong>{email}</strong>
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
                onClick={() => { setStep('email'); setError(''); setOtp(['', '', '', '', '', '']) }}
              >
                Change email
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
          <img src="/dikho-logo.png" alt="Dikho" className="login-logo" />

          <h1>Sign in to your account</h1>
          <p className="login-subtitle">Access your Dikho.</p>

          <form onSubmit={handleSendOtp}>
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
