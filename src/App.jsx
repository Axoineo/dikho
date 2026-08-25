import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { Country, State, City } from 'country-state-city'

function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  const paths = {
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" /></>,
    clients: <><path d="M16 21v-1.7a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V21" /><circle cx="9" cy="7" r="3.2" /><path d="M22 21v-1.6a4 4 0 0 0-3-3.85M16.5 4.3a3.2 3.2 0 0 1 0 6.2" /></>,
    vendors: <><path d="M3 9.5 12 4l9 5.5" /><path d="M5 10.5V20h14v-9.5" /><path d="M8 20v-6h8v6" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    chevronDown: <path d="m7 9 5 5 5-5" />,
    first: <><path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" /></>,
    last: <><path d="m13 7 5 5-5 5" /><path d="m6 7 5 5-5 5" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    user: <><circle cx="12" cy="8" r="3.3" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
    expand: <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /><path d="M3 8 8 3M21 8l-5-5M21 16l-5 5M3 16l5 5" /></>,
    close: <><path d="M6 6l12 12M18 6 6 18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    alert: <><path d="M12 3.5 21 19H3l9-15.5Z" /><path d="M12 9v4M12 16.5h.01" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h5" /></>,
    eye: <><path d="M2.5 12s3.2-5 9.5-5 9.5 5 9.5 5-3.2 5-9.5 5-9.5-5-9.5-5Z" /><circle cx="12" cy="12" r="2.3" /></>,
    download: <><path d="M12 4v10" /><path d="m8 10 4 4 4-4" /><path d="M5 20h14" /></>,
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

function Login({ onLogin }) {
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
          <p className="login-subtitle">Access your Dikho SO-PO system</p>

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

function SidebarIcon({ name, size = 20 }) {
  const icons = {
    dashboard: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
    clients: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-1.7a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V21" />
        <circle cx="9" cy="7" r="3.2" />
        <path d="M22 21v-1.6a4 4 0 0 0-3-3.85M16.5 4.3a3.2 3.2 0 0 1 0 6.2" />
      </svg>
    ),
    vendors: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5 12 4l9 5.5" />
        <path d="M5 10.5V20h14v-9.5" />
        <path d="M8 20v-6h8v6" />
      </svg>
    ),

    so: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
        <path d="M14 2v4" />
      </svg>
    ),
    po: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h5M8 12h8M8 16h6" />
        <circle cx="17" cy="8" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
    combinedpo: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="13" height="16" rx="2" />
        <rect x="9" y="3" width="13" height="16" rx="2" />
        <path d="M13 8h5M13 12h5M13 16h3" />
      </svg>
    ),
    invoice: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
    ),
    paymentlink: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
        <path d="M6 15h3M15 15h3" />
      </svg>
    ),
    advance: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12c0 1.66-.4 3.22-1.1 4.6" />
        <path d="M3.51 8.83A9 9 0 1 0 21 12" />
        <path d="M12 8v4l3 3" />
        <path d="M15 3l2 2-2 2" />
        <path d="M17 5H9" />
      </svg>
    ),
    receipt: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    ),
    paymentrequest: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9h.01" />
        <path d="M9 12c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3" />
        <path d="M12 18v-3" />
      </svg>
    ),
    courier: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 10h16M4 14h10" />
        <path d="M14 17l3 3 5-5" />
      </svg>
    ),
    chevron: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 18 6-6-6-6" />
      </svg>
    ),
  }
  return icons[name] || null
}

function Sidebar({ activePage, setActivePage, collapsed, onOverlayClick }) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'clients', label: 'Clients', icon: 'clients' },
    { id: 'vendors', label: 'Vendors', icon: 'vendors' },
    { id: 'so', label: 'SO', icon: 'so' },
    { id: 'po', label: 'PO', icon: 'po' },
    { id: 'combinedpo', label: 'Combined PO', icon: 'combinedpo' },
    { id: 'invoice', label: 'Invoice Notification', icon: 'invoice' },
    { id: 'paymentlink', label: 'Payment Link', icon: 'paymentlink' },
    { id: 'advance', label: 'Advance Payment Receipt', icon: 'advance' },
    { id: 'receipt', label: 'Payment Receipt', icon: 'receipt' },
    { id: 'paymentrequest', label: 'Payment Request', icon: 'paymentrequest' },
    { id: 'courier', label: 'Document Courier', icon: 'courier' },
  ]

  function handleNav(id) {
    setActivePage(id)
    if (onOverlayClick) onOverlayClick()
  }

  return (
    <>
      {/* Mobile overlay backdrop */}
      {!collapsed && onOverlayClick && (
        <div className="sidebar-overlay" onClick={onOverlayClick} aria-hidden="true" />
      )}

      <aside className={`sidebar${collapsed ? ' sidebar-is-collapsed' : ''}`} aria-label="Main navigation">
        {/* Logo area */}
        <div className="sidebar-logo-area">
          <div className="sidebar-logo-full">
            <img src="/dikho-logo1.png" alt="Dikho" className="sidebar-logo-img" />
          </div>
          <div className="sidebar-logo-icon">
            <img src="/fevicon.png" alt="Dikho" className="sidebar-favicon" />
          </div>
        </div>

        {/* Divider */}
        <div className="sidebar-divider" />

        {/* Navigation */}
        <nav className="sidebar-nav">
          {items.map((item) => {
            const isActive = activePage === item.id
            return (
              <button
                key={item.id}
                className={`nav-item${isActive ? ' active' : ''}`}
                onClick={() => handleNav(item.id)}
                title={collapsed ? item.label : undefined}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="nav-icon">
                  <SidebarIcon name={item.icon} size={20} />
                </span>
                <span className="nav-label">{item.label}</span>
                {isActive && (
                  <span className="nav-chevron">
                    <SidebarIcon name="chevron" />
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </aside>
    </>
  )
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function getValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
      return row[key]
    }
  }
  return null
}

function ClientDetails({ client, onClose }) {
  if (!client) return null

  const statusValue = getValue(client, ['status', 'is_active'])
  const fields = [
    ['ID', getValue(client, ['id'])],
    ['Company Name', getValue(client, ['company_name'])],
    ['Contact Person', getValue(client, ['contact_person'])],
    ['Contact Number', getValue(client, ['contact', 'contact_number', 'phone'])],
    ['Email', getValue(client, ['email', 'email_address'])],
    ['Status', statusValue === 1 || statusValue === '1' || statusValue === true || statusValue === 'true' || statusValue === 'active' || statusValue === 'Active' ? 'Active' : 'Inactive'],
    ['TDS Percentage', getValue(client, ['tds_percentage', 'tds_percent', 'tdsPercentage'])],
    ['TDS Section', getValue(client, ['tds_section', 'tdsSection'])],
    ['Registration', getValue(client, ['registration', 'registration_type', 'registrationType'])],
    ['GSTIN', getValue(client, ['gstin', 'gstin_number'])],
    ['GSTIN Date', getValue(client, ['gstin_date', 'gstinDate'])],
    ['PAN Number', getValue(client, ['pan_number', 'pan'])],
  ]

  return (
    <aside className="details-drawer" aria-label="Client details">
      <div className="drawer-header">
        <div>
          <span className="drawer-kicker">Client details</span>
          <h2>{formatValue(client.company_name)}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="close" size={19} />
        </button>
      </div>

      <div className="drawer-divider" />

      <div className="details-list">
        {fields.map(([label, value]) => (
          <div className="detail-row" key={label}>
            <span className="detail-label">{label}</span>
            <span className="detail-value">{formatValue(value)}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}

function AddClientModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    company_name: '',
    contact_person: '',
    contact: '',
    country_code: '+91',
    email: '',
    gstin: '',
    gstin_date: '',
    tds_percentage: '',
    tds_section: '',
    registration: '',
    pan_number: '',
    status: '1',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const phoneDigits = form.contact.replace(/\D/g, '')
    const payload = {
      company_name: form.company_name.trim(),
      contact_person: form.contact_person.trim() || null,
      contact: phoneDigits ? Number(phoneDigits) : null,
      email: form.email.trim() || null,
      gstin: form.gstin.trim() || null,
      gstin_date: form.gstin_date || null,
      tds_percentage: form.tds_percentage === '' ? null : Number(form.tds_percentage),
      tds_section: form.tds_section.trim() || null,
      registration: form.registration.trim() || null,
      pan_number: form.pan_number.trim() || null,
      status: Number(form.status),
    }

    const { error: insertError } = await supabase.from('clients').insert([payload])
    if (insertError) {
      setError(insertError.message)
      setSaving(false)
      return
    }

    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card add-client-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="drawer-kicker">CLIENT MASTER</span>
            <h2>Add client</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={19} /></button>
        </div>

        {error && (
          <div className="form-error" role="alert">
            <Icon name="alert" size={17} />
            <div><strong>Could not save client</strong><span>{error}</span></div>
          </div>
        )}

        <form className="client-form" onSubmit={handleSubmit}>
          <div className="field field-wide">
            <label htmlFor="company-name">Company Name</label>
            <input id="company-name" value={form.company_name} onChange={(e) => update('company_name', e.target.value)} required />
          </div>

          <div className="field">
            <label htmlFor="contact-person">Contact Person</label>
            <input id="contact-person" value={form.contact_person} onChange={(e) => update('contact_person', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
          </div>

          <div className="field field-phone">
            <label htmlFor="contact-number">Contact Number</label>
            <div className="phone-control">
              <select aria-label="Country code" value={form.country_code} onChange={(e) => update('country_code', e.target.value)}>
                <option value="+91">🇮🇳 +91</option>
                <option value="+1">🇺🇸 +1</option>
                <option value="+44">🇬🇧 +44</option>
                <option value="+971">🇦🇪 +971</option>
                <option value="+65">🇸🇬 +65</option>
              </select>
              <input id="contact-number" type="tel" inputMode="numeric" value={form.contact} onChange={(e) => update('contact', e.target.value.replace(/\D/g, ''))} placeholder="98765 43210" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="status">Status</label>
            <select id="status" value={form.status} onChange={(e) => update('status', e.target.value)}>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="gstin">GSTIN</label>
            <input id="gstin" value={form.gstin} onChange={(e) => update('gstin', e.target.value.toUpperCase())} />
          </div>

          <div className="field">
            <label htmlFor="gstin-date">GSTIN Date</label>
            <input id="gstin-date" type="date" value={form.gstin_date} onChange={(e) => update('gstin_date', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="tds-percentage">TDS Percentage</label>
            <div className="input-with-suffix">
              <input id="tds-percentage" type="number" min="0" max="100" step="0.01" value={form.tds_percentage} onChange={(e) => update('tds_percentage', e.target.value)} placeholder="e.g. 10" />
              <span>%</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="tds-section">TDS Section</label>
            <input id="tds-section" value={form.tds_section} onChange={(e) => update('tds_section', e.target.value)} placeholder="e.g. 194C" />
          </div>

          <div className="field">
            <label htmlFor="registration">Registration</label>
            <select id="registration" value={form.registration} onChange={(e) => update('registration', e.target.value)}>
              <option value="">Select registration</option>
              <option value="Registered">Registered</option>
              <option value="Unregistered">Unregistered</option>
              <option value="Composition">Composition</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="pan-number">PAN Number</label>
            <input id="pan-number" value={form.pan_number} onChange={(e) => update('pan_number', e.target.value.toUpperCase())} />
          </div>

          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save Client'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ClientsPage() {
  const [clients, setClients] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [selectedClient, setSelectedClient] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchInput.trim())
      setPage(1)
    }, 250)

    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false

    async function loadClients() {
      setLoading(true)
      setError('')

      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let request = supabase
        .from('clients')
        .select('*', { count: 'exact' })
        .order('id', { ascending: false })
        .range(from, to)

      if (query) {
        const safeQuery = query
          .replace(/[%_]/g, '')
          .replace(/[(),]/g, ' ')
          .trim()

        if (safeQuery) {
          request = request.or(
            `company_name.ilike.%${safeQuery}%,contact_person.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%,gstin.ilike.%${safeQuery}%,pan_number.ilike.%${safeQuery}%`
          )
        }
      }

      const { data, count, error: fetchError } = await request

      if (cancelled) return

      if (fetchError) {
        console.error(fetchError)
        setClients([])
        setTotalCount(0)
        setError(fetchError.message)
      } else {
        setClients(data || [])
        setTotalCount(count || 0)
      }

      setLoading(false)
    }

    loadClients()

    return () => {
      cancelled = true
    }
  }, [page, pageSize, query])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalCount)

  const pageNumbers = useMemo(() => {
    const current = Math.min(page, totalPages)
    const candidates = [current - 2, current - 1, current, current + 1, current + 2]
    return candidates.filter((number) => number >= 1 && number <= totalPages)
  }, [page, totalPages])

  function changePage(nextPage) {
    const safePage = Math.max(1, Math.min(nextPage, totalPages))
    setPage(safePage)
  }

  function changePageSize(e) {
    setPageSize(Number(e.target.value))
    setPage(1)
  }

  function afterSaved() {
    setShowForm(false)
    setPage(1)
    setQuery('')
    setSearchInput('')
  }

  const currentPageIds = clients.map((client) => client.id)
  const allCurrentSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.includes(id))

  function toggleSelect(id) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  function toggleSelectPage() {
    setSelectedIds((current) => {
      if (allCurrentSelected) return current.filter((id) => !currentPageIds.includes(id))
      return [...new Set([...current, ...currentPageIds])]
    })
  }

  return (
    <div className={`clients-page ${selectedClient ? 'has-selection' : ''}`}>
      <div className="clients-main-content">
      <div className="page-header">
        <div>
          <span className="page-kicker">MASTER DATA</span>
          <h1>Clients</h1>
          <p>Manage your client database</p>
        </div>

        <button className="primary-button add-button" onClick={() => setShowForm(true)}>
          <Icon name="plus" size={18} />
          Add
        </button>
      </div>

      <div className="list-toolbar">
        <div className="search-box">
          <Icon name="search" size={18} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search company, contact, email, GSTIN or PAN..."
            aria-label="Search clients"
          />
          {searchInput && (
            <button className="search-clear" onClick={() => setSearchInput('')} aria-label="Clear search">
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="page-error" role="alert">
          <span className="page-error-icon"><Icon name="alert" size={18} /></span>
          <div>
            <strong>Could not load clients</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <section className="table-card">
        <div className="table-topline">
          <div>
            <strong>All Clients</strong>
            <span className="result-count">{totalCount.toLocaleString()} records</span>
          </div>
          {query && <span className="search-state">Filtered by “{query}”</span>}
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th className="check-column"><button type="button" className={`checkbox-button ${allCurrentSelected ? 'checked' : ''}`} onClick={toggleSelectPage} aria-label="Select all clients on this page">{allCurrentSelected ? <Icon name="check" size={14} /> : null}</button></th>
                <th>ID</th>
                <th>Company Name</th>
                <th>GSTIN</th>
                <th>PAN Number</th>
                <th>Status</th>
                <th className="actions-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: Math.min(pageSize, 8) }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className="skeleton-row">
                    <td><span className="skeleton skeleton-check" /></td>
                    <td><span className="skeleton skeleton-id" /></td>
                    <td><span className="skeleton skeleton-company" /></td>
                    <td><span className="skeleton skeleton-gstin" /></td>
                    <td><span className="skeleton skeleton-pan" /></td>
                    <td><span className="skeleton skeleton-status" /></td>
                    <td><span className="skeleton skeleton-action" /></td>
                  </tr>
                ))
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-state">
                    <div className="empty-title">No clients found</div>
                    <div className="empty-copy">Try a different company name, GSTIN or PAN.</div>
                  </td>
                </tr>
              ) : (
                clients.map((client) => {
                  const status = getValue(client, ['status', 'is_active'])
                  const isActive = status === 1 || status === '1' || status === true || status === 'true' || status === 'active' || status === 'Active'

                  return (
                    <tr key={client.id} onDoubleClick={() => setSelectedClient(client)}>
                      <td className="check-column"><button type="button" className={`checkbox-button ${selectedIds.includes(client.id) ? 'checked' : ''}`} onClick={(e) => { e.stopPropagation(); toggleSelect(client.id) }} aria-label={`Select ${client.company_name}`}>{selectedIds.includes(client.id) ? <Icon name="check" size={14} /> : null}</button></td>
                      <td className="id-cell">{formatValue(client.id)}</td>
                      <td className="company-cell">{formatValue(client.company_name)}</td>
                      <td>{formatValue(client.gstin)}</td>
                      <td>{formatValue(getValue(client, ['pan_number', 'pan']))}</td>
                      <td>
                        <span className={`status-icon ${isActive ? 'active' : 'inactive'}`} title={isActive ? 'Active' : 'Inactive'}>
                          {isActive ? <Icon name="check" size={17} /> : '—'}
                        </span>
                      </td>
                      <td className="actions-column">
                        <button className="row-action" onClick={() => setSelectedClient(client)} aria-label={`Open client ${client.company_name}`}>
                          <Icon name="chevron" size={17} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination-bar">
          <div className="page-size-control">
            <span>Items per page</span>
            <select value={pageSize} onChange={changePageSize}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="75">75</option>
              <option value="100">100</option>
            </select>
          </div>

          <div className="pagination-meta">
            <span>{pageStart} – {pageEnd} of {totalCount.toLocaleString()}</span>
            <div className="pagination-buttons">
              <button onClick={() => changePage(1)} disabled={page <= 1} aria-label="First page"><Icon name="first" size={16} /></button>
              <button onClick={() => changePage(page - 1)} disabled={page <= 1} aria-label="Previous page"><Icon name="chevron" size={16} style={{ transform: 'rotate(180deg)' }} /></button>
              {pageNumbers.map((number) => (
                <button key={number} className={number === page ? 'current' : ''} onClick={() => changePage(number)}>{number}</button>
              ))}
              <button onClick={() => changePage(page + 1)} disabled={page >= totalPages} aria-label="Next page"><Icon name="chevron" size={16} /></button>
              <button onClick={() => changePage(totalPages)} disabled={page >= totalPages} aria-label="Last page"><Icon name="last" size={16} /></button>
            </div>
          </div>
        </div>
      </section>
      </div>

      {selectedClient && (
        <aside className="clients-side-panel"><ClientDetails client={selectedClient} onClose={() => setSelectedClient(null)} /></aside>
      )}

      {showForm && (
        <AddClientModal onClose={() => setShowForm(false)} onSaved={afterSaved} />
      )}
    </div>
  )
}


function VendorDetails({ vendor, address, onClose, mediaMap, subMediaMap }) {
  const [documentLoading, setDocumentLoading] = useState(false)

  if (!vendor) return null

  const statusValue = getValue(vendor, ['status'])
  const isActive = statusValue === 1 || statusValue === '1' || statusValue === true || statusValue === 'true' || statusValue === 'active' || statusValue === 'Active'
  const mediaName = mediaMap?.[vendor.media_id] || getValue(vendor, ['media'])
  const subMediaName = subMediaMap?.[vendor.sub_media_id] || getValue(vendor, ['sub_media'])

  const documentPath = vendor.vendor_document_file_path
  const documentName = vendor.vendor_document_file_name

  async function getSignedUrl() {
    if (!documentPath) return null
    const { data, error } = await supabase
      .storage
      .from('Dikho')
      .createSignedUrl(documentPath, 60 * 10)
    if (error) throw error
    return data?.signedUrl
  }

  async function openDocument() {
    if (!documentPath) return
    setDocumentLoading(true)
    try {
      const url = await getSignedUrl()
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      console.error(error)
      window.alert(`Could not open document: ${error.message}`)
    } finally {
      setDocumentLoading(false)
    }
  }

  async function downloadDocument() {
    if (!documentPath) return
    setDocumentLoading(true)
    try {
      const url = await getSignedUrl()
      if (url) {
        const a = document.createElement('a')
        a.href = url
        a.download = documentName || 'document'
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch (error) {
      console.error(error)
      window.alert(`Could not download document: ${error.message}`)
    } finally {
      setDocumentLoading(false)
    }
  }

  const sections = [
    { title: 'Basic Information', fields: [
      ['ID', vendor.id],
      ['Alias', vendor.alias],
      ['Company Name', vendor.company_name],
      ['Contact Person', vendor.contact_person],
      ['Vendor Type', vendor.vendor_type],
      ['Email', vendor.email],
      ['Contact Number', vendor.contact == null ? null : `${vendor.country_dialcode || ''} ${vendor.contact}`.trim()],
      ['Status', isActive ? 'Active' : 'Inactive'],
    ]},
    { title: 'Classification', fields: [
      ['Media', mediaName],
      ['Sub Media', subMediaName],
    ]},
    { title: 'Payment Terms', fields: [
      ['Payment Term Type', vendor.payment_term_type],
      ['Payment Term Date', vendor.payment_term_invoice_date],
      ['Payment Term (In Days)', vendor.payment_term_value],
    ]},
    { title: 'Tax Information', fields: [
      ['Registration', vendor.registration],
      ['GSTIN', vendor.gstin],
      ['GSTIN Date', vendor.gstin_date],
      ['PAN Number', vendor.pan_number],
      ['TDS Percentage', vendor.tds_percentage == null ? null : `${vendor.tds_percentage}%`],
      ['TDS Section', vendor.tds_section],
      ['Opening Balance', vendor.opening_balance],
    ]},
    { title: 'Bank Details', fields: [
      ['Bank Name', vendor.vendor_bank_name],
      ['Bank IFSC Code', vendor.vendor_ifsc_code],
      ['Account Number', vendor.vendor_account_number],
    ]},
    { title: 'Address', fields: [
      ['Country', address?.country],
      ['State', address?.state],
      ['City', address?.city],
      ['Zipcode', address?.zipcode],
      ['Address', address?.address],
    ]},
  ]

  return (
    <aside className="details-drawer" aria-label="Vendor details">
      <div className="drawer-header">
        <div>
          <span className="drawer-kicker">VENDOR DETAILS</span>
          <h2>{formatValue(vendor.company_name)}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="close" size={19} />
        </button>
      </div>
      <div className="drawer-divider" />

      {documentPath && (
        <div className="document-panel">
          <div className="document-panel-icon"><Icon name="file" size={20} /></div>
          <div className="document-panel-main">
            <div className="document-panel-title">Vendor document</div>
            <div className="document-panel-name" title={documentName || documentPath}>{formatValue(documentName)}</div>
          </div>
          <div className="document-panel-actions">
            <button className="icon-button small" onClick={openDocument} disabled={documentLoading} aria-label="View vendor document" title="View">
              {documentLoading ? '…' : <Icon name="eye" size={17} />}
            </button>
            <button className="icon-button small" onClick={downloadDocument} disabled={documentLoading} aria-label="Download vendor document" title="Download">
              <Icon name="download" size={17} />
            </button>
          </div>
        </div>
      )}

      <div className="details-list">
        {sections.map((section) => (
          <div key={section.title}>
            <div className="details-section-title">{section.title}</div>
            {section.fields.map(([label, value]) => (
              <div className="detail-row" key={label}>
                <span className="detail-label">{label}</span>
                <span className="detail-value">{formatValue(value)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}

 function SearchableSelect({ label, value, onChange, options, placeholder, disabled = false, required = false, searchPlaceholder = 'Search...' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const selected = options.find((item) => String(item.value) === String(value))
  const filtered = options
    .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 150)

  return (
    <div ref={containerRef} className={`search-select-wrap ${open ? 'is-open' : ''}`}>
      <label>{label}{required ? ' *' : ''}</label>
      <button
        type="button"
        className={`search-select-trigger ${open ? 'open' : ''}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
        <span className={selected ? '' : 'search-select-placeholder'}>{selected?.label || placeholder}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="search-select-menu">
          <div className="search-select-search">
            <Icon name="search" size={15} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} name="search-dropdown" autoComplete="new-password" />
          </div>
          <div className="search-select-options">
            {filtered.length === 0 ? (
              <div className="search-select-empty">No matches found</div>
            ) : filtered.map((item) => (
              <button
                type="button"
                key={item.value}
                className={`search-select-option ${String(item.value) === String(value) ? 'selected' : ''}`}
                onClick={() => { onChange(item.value); setOpen(false) }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AddVendorModal({ onClose, onSaved }) {
  const allCountries = useMemo(() => Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name)), [])
  const [form, setForm] = useState({
    alias: '',
    contact_person: '',
    company_name: '',
    gstin: '',
    gstin_date: '',
    payment_term_invoice_date: '',
    payment_term_value: '',
    payment_term_type: 'Invoice Date',
    vendor_type: 'Organization',
    country_dialcode: '+91',
    country_code: 'IN',
    contact: '',
    email: '',
    media_id: '',
    sub_media_id: '',
    registration: '',
    pan_number: '',
    opening_balance: '0',
    tds_percentage: '',
    tds_section: '',
    vendor_bank_name: '',
    vendor_ifsc_code: '',
    vendor_account_number: '',
    vendor_confirm_account_number: '',
    state: '',
    state_code: '',
    city: '',
    zipcode: '',
    address: '',
    country_name: 'India',
    status: '1',
  })
  const [mediaOptions, setMediaOptions] = useState([])
  const [subMediaOptions, setSubMediaOptions] = useState([])
  const [documentFile, setDocumentFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [zipStatus, setZipStatus] = useState(null)
  const [loadingMedia, setLoadingMedia] = useState(true)
  const [loadingSubMedia, setLoadingSubMedia] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const allowedDocTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  const maxDocSize = 10 * 1024 * 1024

  function chooseDocumentFile(file) {
    if (!file) return
    if (!allowedDocTypes.includes(file.type)) { setError('Document must be PDF, JPG, PNG or WEBP.'); return }
    if (file.size > maxDocSize) { setError('Document must be smaller than 10 MB.'); return }
    setError('')
    setDocumentFile(file)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) chooseDocumentFile(file)
  }

  const states = useMemo(() => form.country_code ? State.getStatesOfCountry(form.country_code).sort((a, b) => a.name.localeCompare(b.name)) : [], [form.country_code])
  const cities = useMemo(() => form.country_code && form.state_code ? City.getCitiesOfState(form.country_code, form.state_code).sort((a, b) => a.name.localeCompare(b.name)) : [], [form.country_code, form.state_code])

  useEffect(() => {
    async function loadMedia() {
      const { data, error: fetchError } = await supabase.from('media').select('id,name').order('name', { ascending: true })
      if (fetchError) setError(fetchError.message)
      else setMediaOptions(data || [])
      setLoadingMedia(false)
    }
    loadMedia()
  }, [])

  useEffect(() => {
    async function loadSubMedia() {
      if (!form.media_id) { setSubMediaOptions([]); return }
      setLoadingSubMedia(true)
      const { data, error: fetchError } = await supabase.from('sub_media').select('id,name,media_id').eq('media_id', form.media_id).order('name', { ascending: true })
      if (fetchError) setError(fetchError.message)
      else setSubMediaOptions(data || [])
      setLoadingSubMedia(false)
    }
    loadSubMedia()
  }, [form.media_id])

  function update(field, value) { setForm((current) => ({ ...current, [field]: value })) }

  function handleCountryChange(code) {
    const country = allCountries.find((item) => item.isoCode === code)
    setForm((current) => ({
      ...current,
      country_code: code,
      country_name: country?.name || code,
      country_dialcode: country?.phonecode ? `+${country.phonecode}` : '',
      state: '', state_code: '', city: '', zipcode: '',
    }))
    setZipStatus(null)
  }

  function handleStateChange(code) {
    const state = states.find((item) => item.isoCode === code)
    setForm((current) => ({ ...current, state_code: code, state: state?.name || '', city: '', zipcode: '' }))
    setZipStatus(null)
  }

  async function verifyIndianZip(zip) {
    if (form.country_code !== 'IN' || !/^\d{6}$/.test(zip) || !form.city) return
    setZipStatus({ type: 'checking', message: 'Checking PIN code…' })
    try {
      const response = await fetch(`https://api.postalpincode.in/pincode/${zip}`)
      if (!response.ok) throw new Error('PIN lookup failed')
      const result = await response.json()
      const offices = result?.[0]?.PostOffice || []
      if (!offices.length) {
        setZipStatus({ type: 'error', message: 'PIN code not found.' })
        return
      }
      const selected = form.city.toLowerCase().replace(/[^a-z0-9]/g, '')
      const matches = offices.some((office) => {
        const name = String(office.Name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        const district = String(office.District || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        return name.includes(selected) || selected.includes(name) || district.includes(selected) || selected.includes(district)
      })
      if (matches) setZipStatus({ type: 'success', message: 'PIN code matches the selected city/area.' })
      else setZipStatus({ type: 'error', message: `PIN ${zip} does not appear to match ${form.city}. Please verify City and PIN.` })
    } catch {
      setZipStatus({ type: 'warning', message: 'PIN verification is temporarily unavailable. You can still continue.' })
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      if (!form.company_name.trim()) throw new Error('Company Name is required.')
      if (!form.vendor_type) throw new Error('Vendor Type is required.')
      if (!form.media_id || !form.sub_media_id) throw new Error('Please select Media and Sub Media.')
      if (!form.state.trim()) throw new Error('State is required.')
      if (!form.city.trim()) throw new Error('City is required.')
      if (!form.address.trim()) throw new Error('Address is required.')
      if (zipStatus?.type === 'error') throw new Error(zipStatus.message)
      if (form.vendor_account_number !== form.vendor_confirm_account_number) throw new Error('Bank Account Number and Confirm Bank Account Number do not match.')
      if (documentFile && documentFile.size > 10 * 1024 * 1024) throw new Error('Vendor document must be smaller than 10 MB.')

      const phoneDigits = form.contact.replace(/\D/g, '')
      const vendorPayload = {
        alias: form.alias.trim() || null,
        contact_person: form.contact_person.trim() || null,
        company_name: form.company_name.trim(),
        gstin: form.gstin.trim().toUpperCase() || null,
        gstin_date: form.gstin_date || null,
        payment_term_invoice_date: form.payment_term_invoice_date || null,
        payment_term_type: form.payment_term_type,
        payment_term_value: form.payment_term_value === '' ? null : Number(form.payment_term_value),
        vendor_type: form.vendor_type,
        country_dialcode: form.country_dialcode,
        country_code: form.country_code,
        contact: phoneDigits ? Number(phoneDigits) : null,
        email: form.email.trim() || null,
        media_id: Number(form.media_id),
        sub_media_id: Number(form.sub_media_id),
        registration: form.registration || null,
        pan_number: form.pan_number.trim().toUpperCase() || null,
        opening_balance: form.opening_balance === '' ? 0 : Number(form.opening_balance),
        tds_percentage: form.tds_percentage === '' ? null : Number(form.tds_percentage),
        tds_section: form.tds_section.trim() || null,
        vendor_bank_name: form.vendor_bank_name.trim() || null,
        vendor_ifsc_code: form.vendor_ifsc_code.trim().toUpperCase() || null,
        vendor_account_number: form.vendor_account_number.trim() || null,
        vendor_confirm_account_number: form.vendor_confirm_account_number.trim() || null,
        vendor_document_file_name: documentFile?.name || null,
        status: Number(form.status),
      }

      const { data: savedVendor, error: vendorError } = await supabase.from('vendors').insert([vendorPayload]).select('id').single()
      if (vendorError) throw vendorError
      if (!savedVendor?.id) throw new Error('Vendor was created but no vendor ID was returned.')

      const { error: addressError } = await supabase.from('vendor_addresses').insert([{
        vendor_id: savedVendor.id,
        address: form.address.trim(),
        country: form.country_name,
        country_code: form.country_code,
        state: form.state.trim(),
        city: form.city.trim(),
        zipcode: form.zipcode.trim() || null,
        is_default: true,
      }])
      if (addressError) {
        await supabase.from('vendors').delete().eq('id', savedVendor.id)
        throw addressError
      }

      if (documentFile) {
        const safeName = documentFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `vendors_documents/${savedVendor.id}/${Date.now()}-${safeName}`
        const { error: uploadError } = await supabase.storage.from('Dikho').upload(path, documentFile, { cacheControl: '3600', upsert: false, contentType: documentFile.type || 'application/octet-stream' })
        if (uploadError) {
          await supabase.from('vendor_addresses').delete().eq('vendor_id', savedVendor.id)
          await supabase.from('vendors').delete().eq('id', savedVendor.id)
          throw new Error(`Vendor was created, but document upload failed: ${uploadError.message}`)
        }
        const { error: pathError } = await supabase.from('vendors').update({ vendor_document_file_path: path, vendor_document_file_name: documentFile.name }).eq('id', savedVendor.id)
        if (pathError) {
          await supabase.storage.from('Dikho').remove([path])
          await supabase.from('vendor_addresses').delete().eq('vendor_id', savedVendor.id)
          await supabase.from('vendors').delete().eq('id', savedVendor.id)
          throw pathError
        }
      }

      onSaved()
    } catch (err) {
      console.error(err); setError(err?.message || 'Could not save vendor.')
    } finally { setSaving(false) }
  }

  const countryOptions = allCountries.map((c) => ({ value: c.isoCode, label: `${c.name} (${c.isoCode})` }))
  const stateOptions = states.map((s) => ({ value: s.isoCode, label: s.name }))
  const cityOptions = cities.map((c) => ({ value: c.name, label: c.name }))
  const mediaSimple = mediaOptions.map((m) => ({ value: m.id, label: m.name }))
  const subMediaSimple = subMediaOptions.map((m) => ({ value: m.id, label: m.name }))

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card vendor-modal-card" onMouseDown={(e) => e.stopPropagation()}>

        <div className="modal-header">
          <div>
            <span className="drawer-kicker">VENDOR MASTER</span>
            <h2>Add vendor</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={19} />
          </button>
        </div>

        {error && (
          <div className="form-error" role="alert">
            <Icon name="alert" size={17} />
            <div><strong>Could not save vendor</strong><span>{error}</span></div>
          </div>
        )}

        <form className="vendor-form" onSubmit={handleSubmit}>

          {/* ── Basic Information ───────────────────────────────── */}
          <div className="form-section-title field-wide">Basic Information</div>

          <div className="field field-wide">
            <label htmlFor="vf-company">Company Name *</label>
            <input id="vf-company" value={form.company_name} onChange={(e) => update('company_name', e.target.value)} required />
          </div>

          <div className="field field-wide">
            <label>Vendor Type *</label>
            <div className="choice-cards">
              <label className={`choice-card ${form.vendor_type === 'Individual' ? 'selected' : ''}`}>
                <input type="radio" name="vendor-type" value="Individual" checked={form.vendor_type === 'Individual'} onChange={(e) => update('vendor_type', e.target.value)} />
                <span><strong>Individual</strong><small>Single person / proprietor</small></span>
              </label>
              <label className={`choice-card ${form.vendor_type === 'Organization' ? 'selected' : ''}`}>
                <input type="radio" name="vendor-type" value="Organization" checked={form.vendor_type === 'Organization'} onChange={(e) => update('vendor_type', e.target.value)} />
                <span><strong>Organization</strong><small>Company / agency / business</small></span>
              </label>
            </div>
          </div>

          <div className="field">
            <label htmlFor="vf-alias">Alias</label>
            <input id="vf-alias" value={form.alias} onChange={(e) => update('alias', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="vf-contact-person">Contact Person</label>
            <input id="vf-contact-person" value={form.contact_person} onChange={(e) => update('contact_person', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="vf-status">Status</label>
            <select id="vf-status" value={form.status} onChange={(e) => update('status', e.target.value)}>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="vf-email">Email</label>
            <input id="vf-email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
          </div>

          <div className="field field-phone">
            <label htmlFor="vf-contact">Contact No.</label>
            <div className="phone-control">
              <div className="dial-code-display">{form.country_dialcode || '+91'}</div>
              <input id="vf-contact" type="tel" inputMode="numeric" value={form.contact} onChange={(e) => update('contact', e.target.value.replace(/\D/g, ''))} placeholder="98765 43210" />
            </div>
          </div>

          {/* ── Classification & Payment ─────────────────────────── */}
          <div className="form-section-title field-wide">Classification &amp; Payment</div>

          <div className="field">
            <label htmlFor="vf-media">Media *</label>
            <select id="vf-media" value={form.media_id} onChange={(e) => { update('media_id', e.target.value); update('sub_media_id', '') }} required disabled={loadingMedia}>
              <option value="">{loadingMedia ? 'Loading media...' : 'Select media'}</option>
              {mediaSimple.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="vf-sub-media">Sub Media *</label>
            <select id="vf-sub-media" value={form.sub_media_id} onChange={(e) => update('sub_media_id', e.target.value)} required disabled={!form.media_id || loadingSubMedia}>
              <option value="">{!form.media_id ? 'Select media first' : loadingSubMedia ? 'Loading...' : 'Select sub media'}</option>
              {subMediaSimple.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="vf-pt-days">Payment Term (In Days)</label>
            <input id="vf-pt-days" type="number" min="0" step="1" value={form.payment_term_value} onChange={(e) => update('payment_term_value', e.target.value)} placeholder="e.g. 30" />
          </div>

          <div className="field field-wide">
            <label>Payment Term Type</label>
            <div className="segmented-control">
              <button type="button" className={form.payment_term_type === 'Invoice Date' ? 'active' : ''} onClick={() => update('payment_term_type', 'Invoice Date')}>Invoice Date</button>
              <button type="button" className={form.payment_term_type === 'Campaign End Date' ? 'active' : ''} onClick={() => update('payment_term_type', 'Campaign End Date')}>Campaign End Date</button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="vf-pt-date">Payment Term Date</label>
            <input id="vf-pt-date" type="date" value={form.payment_term_invoice_date} onChange={(e) => update('payment_term_invoice_date', e.target.value)} />
          </div>

          {/* ── Tax Information ──────────────────────────────────── */}
          <div className="form-section-title field-wide">Tax Information</div>

          <div className="field">
            <label htmlFor="vf-registration">Registration</label>
            <select id="vf-registration" value={form.registration} onChange={(e) => update('registration', e.target.value)}>
              <option value="">Select registration</option>
              <option value="Registered">Registered</option>
              <option value="Unregistered">Unregistered</option>
              <option value="Composition">Composition</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="vf-gstin">GSTIN</label>
            <input id="vf-gstin" value={form.gstin} onChange={(e) => update('gstin', e.target.value.toUpperCase())} placeholder="e.g. 27AABCU9603R1ZM" />
          </div>

          <div className="field">
            <label htmlFor="vf-gstin-date">GSTIN Date</label>
            <input id="vf-gstin-date" type="date" value={form.gstin_date} onChange={(e) => update('gstin_date', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="vf-pan">PAN Number</label>
            <input id="vf-pan" value={form.pan_number} onChange={(e) => update('pan_number', e.target.value.toUpperCase())} />
          </div>

          <div className="field">
            <label htmlFor="vf-tds-pct">TDS Percentage</label>
            <div className="input-with-suffix">
              <input id="vf-tds-pct" type="number" min="0" max="100" step="0.01" value={form.tds_percentage} onChange={(e) => update('tds_percentage', e.target.value)} />
              <span>%</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="vf-tds-section">TDS Section</label>
            <input id="vf-tds-section" value={form.tds_section} onChange={(e) => update('tds_section', e.target.value)} placeholder="e.g. 194C" />
          </div>

          <div className="field">
            <label htmlFor="vf-opening-bal">Opening Balance</label>
            <input id="vf-opening-bal" type="number" step="0.01" value={form.opening_balance} onChange={(e) => update('opening_balance', e.target.value)} />
          </div>

          {/* ── Bank Details ─────────────────────────────────────── */}
          <div className="form-section-title field-wide">Bank Details</div>

          <div className="field">
            <label htmlFor="vf-bank-name">Bank Name</label>
            <input id="vf-bank-name" value={form.vendor_bank_name} onChange={(e) => update('vendor_bank_name', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="vf-ifsc">Bank IFSC Code</label>
            <input id="vf-ifsc" value={form.vendor_ifsc_code} onChange={(e) => update('vendor_ifsc_code', e.target.value.toUpperCase())} />
          </div>

          <div className="field">
            <label htmlFor="vf-acc-num">Bank Account Number</label>
            <input id="vf-acc-num" value={form.vendor_account_number} onChange={(e) => update('vendor_account_number', e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </div>

          <div className="field">
            <label htmlFor="vf-acc-confirm">Confirm Account Number</label>
            <input id="vf-acc-confirm" value={form.vendor_confirm_account_number} onChange={(e) => update('vendor_confirm_account_number', e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </div>

          {/* ── Address ──────────────────────────────────────────── */}
          <div className="form-section-title field-wide">Address</div>

          <SearchableSelect
            label="Country"
            value={form.country_code}
            onChange={handleCountryChange}
            options={countryOptions}
            placeholder="Select country"
            searchPlaceholder="Search countries..."
            required
          />

          <SearchableSelect
            label="State"
            value={form.state_code}
            onChange={handleStateChange}
            options={stateOptions}
            placeholder={!form.country_code ? 'Select country first' : stateOptions.length ? 'Select state' : 'No states available'}
            searchPlaceholder="Search states..."
            disabled={!form.country_code || !states.length}
            required
          />

          <SearchableSelect
            label="City"
            value={form.city}
            onChange={(val) => { update('city', val); setZipStatus(null) }}
            options={cityOptions}
            placeholder={!form.state_code ? 'Select state first' : cityOptions.length ? 'Select city' : 'No cities available'}
            searchPlaceholder="Search cities..."
            disabled={!form.state_code || !cities.length}
            required
          />

          <div className="field">
            <label htmlFor="vf-zip">Zipcode / PIN</label>
            <input
              id="vf-zip"
              value={form.zipcode}
              onChange={(e) => {
                const raw = e.target.value
                const value = form.country_code === 'IN'
                  ? raw.replace(/\D/g, '').slice(0, 6)
                  : raw.replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 10)
                update('zipcode', value)
                setZipStatus(null)
              }}
              onBlur={() => verifyIndianZip(form.zipcode)}
              inputMode={form.country_code === 'IN' ? 'numeric' : 'text'}
              placeholder={form.country_code === 'IN' ? '380001' : 'Postal code'}
            />
            {zipStatus && <div className={`zip-status ${zipStatus.type}`}>{zipStatus.message}</div>}
          </div>

          <div className="field field-wide">
            <label htmlFor="vf-address">Address *</label>
            <textarea id="vf-address" value={form.address} onChange={(e) => update('address', e.target.value)} rows="3" placeholder="Street address, building, area, landmark" required />
            <small className="field-help">Please do not add State, City, Zipcode etc. in the Address field.</small>
          </div>

          {/* ── Vendor Document ──────────────────────────────────── */}
          <div className="form-section-title field-wide">Vendor Document</div>

          <div className="field field-wide">
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="document-file-input" id="vendor-doc-input" onChange={(e) => { chooseDocumentFile(e.target.files?.[0]); e.target.value = '' }} />
            <div
              className={`document-dropzone ${documentFile ? 'has-file' : ''} ${dragActive ? 'drag-active' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
              onDragEnter={(e) => { e.preventDefault(); setDragActive(true) }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => { if (!documentFile) document.getElementById('vendor-doc-input')?.click() }}
            >
              <div className="document-drop-icon"><Icon name={documentFile ? 'file' : 'upload'} size={20} /></div>
              <div className="document-drop-copy">
                <strong>{documentFile ? documentFile.name : 'Upload vendor document'}</strong>
                <small>{documentFile ? `${(documentFile.size / 1024 / 1024).toFixed(2)} MB · Ready to upload` : 'Drag & drop here or click to browse · PDF, JPG, PNG, WEBP · Max 10 MB'}</small>
              </div>
              {documentFile ? (
                <div className="document-panel-actions">
                  <label className="document-browse" style={{ position: 'relative' }}>
                    Change
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} onChange={(e) => { chooseDocumentFile(e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                  <button type="button" className="document-browse" onClick={(e) => { e.stopPropagation(); setDocumentFile(null) }}>Remove</button>
                </div>
              ) : (
                <span className="document-browse">Browse</span>
              )}
            </div>
          </div>

          <div className="form-actions field-wide">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save Vendor'}</button>
          </div>

        </form>
      </div>
    </div>
  )
}

function VendorsPage() {
  const [vendors, setVendors] = useState([])
  const [mediaOptions, setMediaOptions] = useState([])
  const [subMediaOptions, setSubMediaOptions] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [selectedVendorAddress, setSelectedVendorAddress] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  useEffect(() => {
    let cancelled = false

    async function loadSelectedVendorAddress() {
      if (!selectedVendor?.id) {
        setSelectedVendorAddress(null)
        return
      }

      const { data, error: addressError } = await supabase
        .from('vendor_addresses')
        .select('*')
        .eq('vendor_id', selectedVendor.id)
        .order('is_default', { ascending: false })
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (cancelled) return
      setSelectedVendorAddress(addressError ? null : data)
    }

    loadSelectedVendorAddress()
    return () => { cancelled = true }
  }, [selectedVendor])


  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchInput.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    async function loadMedia() {
      const [{ data: mediaData }, { data: subMediaData }] = await Promise.all([
        supabase.from('media').select('id,name').order('name', { ascending: true }),
        supabase.from('sub_media').select('id,name,media_id').order('name', { ascending: true }),
      ])
      setMediaOptions(mediaData || [])
      setSubMediaOptions(subMediaData || [])
    }
    loadMedia()
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadVendors() {
      setLoading(true)
      setError('')

      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      let request = supabase
        .from('vendors')
        .select('*', { count: 'exact' })
        .order('id', { ascending: false })
        .range(from, to)

      if (query) {
        const safeQuery = query.replace(/[%_]/g, '').replace(/[(),]/g, ' ').trim()
        if (safeQuery) {
          request = request.or(`company_name.ilike.%${safeQuery}%,alias.ilike.%${safeQuery}%,contact_person.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%,gstin.ilike.%${safeQuery}%,pan_number.ilike.%${safeQuery}%`)
        }
      }

      const { data, count, error: fetchError } = await request
      if (cancelled) return

      if (fetchError) {
        setVendors([])
        setTotalCount(0)
        setError(fetchError.message)
      } else {
        setVendors(data || [])
        setTotalCount(count || 0)
      }
      setLoading(false)
    }

    loadVendors()
    return () => { cancelled = true }
  }, [page, pageSize, query])

  const mediaMap = useMemo(() => Object.fromEntries(mediaOptions.map((item) => [item.id, item.name])), [mediaOptions])
  const subMediaMap = useMemo(() => Object.fromEntries(subMediaOptions.map((item) => [item.id, item.name])), [subMediaOptions])
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalCount)
  const pageNumbers = useMemo(() => {
    const current = Math.min(page, totalPages)
    return [current - 2, current - 1, current, current + 1, current + 2].filter((n) => n >= 1 && n <= totalPages)
  }, [page, totalPages])

  function changePage(nextPage) { setPage(Math.max(1, Math.min(nextPage, totalPages))) }
  function changePageSize(e) { setPageSize(Number(e.target.value)); setPage(1) }
  function afterSaved() { setShowForm(false); setPage(1); setQuery(''); setSearchInput('') }

  const currentPageIds = vendors.map((vendor) => vendor.id)
  const allCurrentSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.includes(id))

  function toggleSelect(id) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  function toggleSelectPage() {
    setSelectedIds((current) => {
      if (allCurrentSelected) return current.filter((id) => !currentPageIds.includes(id))
      return [...new Set([...current, ...currentPageIds])]
    })
  }

  return (
    <div className={`vendors-page ${selectedVendor ? 'has-selection' : ''}`}>
      <div className="vendors-main-content">
        <div className="page-header">
          <div>
            <span className="page-kicker">MASTER DATA</span>
            <h1>Vendors</h1>
            <p>Manage your vendor database</p>
          </div>
          <button className="primary-button add-button" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={18} /> Add
          </button>
        </div>

        <div className="list-toolbar">
          <div className="search-box">
            <Icon name="search" size={18} />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search company, email, GSTIN or PAN..." aria-label="Search vendors" />
            {searchInput && <button className="search-clear" onClick={() => setSearchInput('')} aria-label="Clear search"><Icon name="close" size={15} /></button>}
          </div>
        </div>

        {error && (
          <div className="page-error" role="alert">
            <span className="page-error-icon"><Icon name="alert" size={18} /></span>
            <div><strong>Could not load vendors</strong><p>{error}</p></div>
          </div>
        )}

        <section className="table-card">
          <div className="table-topline">
            <div><strong>All Vendors</strong><span className="result-count">{totalCount.toLocaleString()} records</span></div>
            {query && <span className="search-state">Filtered by “{query}”</span>}
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th className="check-column"><button type="button" className={`checkbox-button ${allCurrentSelected ? 'checked' : ''}`} onClick={toggleSelectPage} aria-label="Select all vendors on this page">{allCurrentSelected ? <Icon name="check" size={14} /> : null}</button></th>
                  <th>ID</th>
                  <th>Company Name</th>
                  <th>Media</th>
                  <th>Sub Media</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>GSTIN</th>
                  <th>Status</th>
                  <th className="actions-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: Math.min(pageSize, 8) }).map((_, index) => (
                    <tr key={`vendor-skeleton-${index}`}>
                      {Array.from({ length: 10 }).map((__, cell) => <td key={cell}><span className="skeleton skeleton-company" /></td>)}
                    </tr>
                  ))
                ) : vendors.length === 0 ? (
                  <tr><td colSpan="10" className="empty-state"><div className="empty-title">No vendors found</div><div className="empty-copy">Try a different company name, email, GSTIN or PAN.</div></td></tr>
                ) : (
                  vendors.map((vendor) => {
                    const status = getValue(vendor, ['status'])
                    const isActive = status === 1 || status === '1' || status === true || status === 'true' || status === 'active' || status === 'Active'
                    return (
                      <tr key={vendor.id} onDoubleClick={() => setSelectedVendor(vendor)}>
                        <td className="check-column"><button type="button" className={`checkbox-button ${selectedIds.includes(vendor.id) ? 'checked' : ''}`} onClick={(e) => { e.stopPropagation(); toggleSelect(vendor.id) }} aria-label={`Select ${vendor.company_name}`}>{selectedIds.includes(vendor.id) ? <Icon name="check" size={14} /> : null}</button></td>
                        <td className="id-cell">{formatValue(vendor.id)}</td>
                        <td className="company-cell">{formatValue(vendor.company_name)}</td>
                        <td>{formatValue(mediaMap[vendor.media_id])}</td>
                        <td>{formatValue(subMediaMap[vendor.sub_media_id])}</td>
                        <td>{formatValue(vendor.contact == null ? null : `${vendor.country_dialcode || ''} ${vendor.contact}`.trim())}</td>
                        <td>{formatValue(vendor.email)}</td>
                        <td>{formatValue(vendor.gstin)}</td>
                        <td><span className={`status-icon ${isActive ? 'active' : 'inactive'}`} title={isActive ? 'Active' : 'Inactive'}>{isActive ? <Icon name="check" size={17} /> : '—'}</span></td>
                        <td className="actions-column"><button className="row-action" onClick={() => setSelectedVendor(vendor)} aria-label={`Open vendor ${vendor.company_name}`}><Icon name="chevron" size={17} /></button></td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar">
            <div className="page-size-control"><span>Items per page</span><select value={pageSize} onChange={changePageSize}><option value="25">25</option><option value="50">50</option><option value="75">75</option><option value="100">100</option></select></div>
            <div className="pagination-meta">
              <span>{pageStart} – {pageEnd} of {totalCount.toLocaleString()}</span>
              <div className="pagination-buttons">
                <button onClick={() => changePage(1)} disabled={page <= 1} aria-label="First page"><Icon name="first" size={16} /></button>
                <button onClick={() => changePage(page - 1)} disabled={page <= 1} aria-label="Previous page"><Icon name="chevron" size={16} /></button>
                {pageNumbers.map((number) => <button key={number} className={number === page ? 'current' : ''} onClick={() => changePage(number)}>{number}</button>)}
                <button onClick={() => changePage(page + 1)} disabled={page >= totalPages} aria-label="Next page"><Icon name="chevron" size={16} /></button>
                <button onClick={() => changePage(totalPages)} disabled={page >= totalPages} aria-label="Last page"><Icon name="last" size={16} /></button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {selectedVendor && <aside className="vendors-side-panel"><VendorDetails vendor={selectedVendor} address={selectedVendorAddress} onClose={() => setSelectedVendor(null)} mediaMap={mediaMap} subMediaMap={subMediaMap} /></aside>}
      {showForm && <AddVendorModal onClose={() => setShowForm(false)} onSaved={afterSaved} />}
    </div>
  )
}

function PlaceholderPage({ title }) {
  return (
    <div className="placeholder">
      <span className="page-kicker">MODULE</span>
      <h1>{title}</h1>
      <p>This section will be added next.</p>
    </div>
  )
}

// Session timing constants (module-level — stable, never in deps arrays)
const MAX_SESSION_MS = 8 * 60 * 60 * 1000  // 8 hours absolute maximum
const INACTIVITY_MS = 45 * 60 * 1000        // 45-minute inactivity timeout
const WARN_BEFORE_MS = 5 * 60 * 1000        // show warning 5 min before inactivity logout

function App() {
  const [session, setSession] = useState(undefined)
  const [activePage, setActivePage] = useState('clients')
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768)
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  const [showSessionWarning, setShowSessionWarning] = useState(false)
  const [warnSecsLeft, setWarnSecsLeft] = useState(300)

  const lastActiveRef = useRef(Date.now())
  const sessionStartRef = useRef(null)
  const showWarningRef = useRef(false)

  useEffect(() => {
    function onResize() {
      const mobile = window.innerWidth <= 768
      setIsMobile(mobile)
      if (mobile) setSidebarOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) sessionStartRef.current = Date.now()
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s && !sessionStartRef.current) sessionStartRef.current = Date.now()
      if (!s) sessionStartRef.current = null
    })
    return () => subscription.unsubscribe()
  }, [])

  // Activity tracking + inactivity / max-session enforcement
  useEffect(() => {
    if (!session) return

    function resetActivity() {
      lastActiveRef.current = Date.now()
    }

    const events = ['mousemove', 'keydown', 'pointerdown', 'scroll']
    events.forEach((ev) => window.addEventListener(ev, resetActivity, { passive: true }))

    const tick = setInterval(() => {
      const now = Date.now()
      const idle = now - lastActiveRef.current
      const sessionAge = sessionStartRef.current ? now - sessionStartRef.current : 0

      // Hard max-session cap (security boundary is the Supabase JWT, this is UX defence)
      if (sessionAge >= MAX_SESSION_MS) {
        supabase.auth.signOut()
        return
      }

      // Inactivity logout
      if (idle >= INACTIVITY_MS) {
        supabase.auth.signOut()
        return
      }

      // 5-minute warning zone
      const timeUntilLogout = INACTIVITY_MS - idle
      if (timeUntilLogout <= WARN_BEFORE_MS) {
        const secs = Math.max(1, Math.ceil(timeUntilLogout / 1000))
        setWarnSecsLeft(secs)
        if (!showWarningRef.current) {
          showWarningRef.current = true
          setShowSessionWarning(true)
        }
      } else if (showWarningRef.current) {
        showWarningRef.current = false
        setShowSessionWarning(false)
      }
    }, 1000)

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, resetActivity))
      clearInterval(tick)
    }
  }, [session])

  function staySignedIn() {
    lastActiveRef.current = Date.now()
    showWarningRef.current = false
    setShowSessionWarning(false)
  }

  async function logout() {
    await supabase.auth.signOut()
  }

  if (session === undefined) {
    return <div className="loading-screen">Loading...</div>
  }
  if (!session) {
    return <Login onLogin={setSession} />
  }

  const collapsed = !sidebarOpen
  const warnMins = Math.floor(warnSecsLeft / 60)
  const warnSecs = String(warnSecsLeft % 60).padStart(2, '0')

  return (
    <div className={`app-shell${collapsed ? ' sidebar-is-closed' : ''}`}>
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        collapsed={collapsed}
        onOverlayClick={isMobile ? () => setSidebarOpen(false) : null}
      />

      <div className="app-main">
        <header className="app-header">
          <button className="header-menu" onClick={() => setSidebarOpen((v) => !v)} aria-label="Toggle sidebar">
            <Icon name="menu" size={21} />
          </button>
          <div className="header-spacer" />
          <div className="header-right">
            <button className="header-icon" aria-label="Full screen" onClick={() => {
              if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()
              else document.exitFullscreen?.()
            }}><Icon name="expand" size={19} /></button>
            <button className="header-icon" aria-label="Account"><Icon name="user" size={20} /></button>
            <button className="logout-link" onClick={logout}>Logout</button>
          </div>
        </header>

        <main className="workspace">
          {activePage === 'clients' && <ClientsPage />}
          {activePage === 'dashboard' && <PlaceholderPage title="Dashboard" />}
          {activePage === 'vendors' && <VendorsPage />}
          {activePage === 'so' && <PlaceholderPage title="SO" />}
          {activePage === 'po' && <PlaceholderPage title="PO" />}
          {activePage === 'combinedpo' && <PlaceholderPage title="Combined PO" />}
          {activePage === 'invoice' && <PlaceholderPage title="Invoice Notification" />}
          {activePage === 'paymentlink' && <PlaceholderPage title="Payment Link" />}
          {activePage === 'advance' && <PlaceholderPage title="Advance Payment Receipt" />}
          {activePage === 'receipt' && <PlaceholderPage title="Payment Receipt" />}
          {activePage === 'paymentrequest' && <PlaceholderPage title="Payment Request" />}
          {activePage === 'courier' && <PlaceholderPage title="Document Courier" />}
        </main>
      </div>

      {showSessionWarning && (
        <div className="session-warning-overlay" role="dialog" aria-modal="true" aria-label="Session expiry warning">
          <div className="session-warning-box">
            <strong>Still there?</strong>
            <p>
              You'll be signed out in{' '}
              <span className="session-warning-timer">{warnMins}:{warnSecs}</span>{' '}
              due to inactivity.
            </p>
            <button className="primary-button" onClick={staySignedIn}>Stay signed in</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App