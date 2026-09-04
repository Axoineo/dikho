import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase';
import PurchaseOrdersPage from './pages/PurchaseOrders'
import PublicVendorForm from './pages/PublicVendorForm'
import { downloadXlsx } from './xlsx'
import { Country, State, City } from 'country-state-city'

export function Icon({ name, size = 18, strokeWidth = 1.8 }) {
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
    filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m14 6 4 4" /></>,
    trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>,
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
    settings: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    logout: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    ),
  }
  return icons[name] || null
}

function Sidebar({ activePage, setActivePage, collapsed, onOverlayClick, onLogout }) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'clients', label: 'Clients', icon: 'clients' },
    { id: 'vendors', label: 'Vendors', icon: 'vendors' },
    { id: 'so', label: 'Sales Orders', icon: 'so' },
    { id: 'po', label: 'Purchase Orders', icon: 'po' },
    { id: 'invoice', label: 'Invoice Notification', icon: 'invoice' },
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
            <img src="/dikho-logo.png" alt="Dikho" className="sidebar-logo-img" />
          </div>
          <div className="sidebar-logo-icon">
            <img src="/fevicon.png" alt="Dikho" className="sidebar-favicon" />
          </div>
        </div>

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

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-footer-divider" />
          <button
            className="nav-item sidebar-footer-item"
            onClick={() => handleNav('settings')}
            title={collapsed ? 'Settings' : undefined}
          >
            <span className="nav-icon">
              <SidebarIcon name="settings" size={20} />
            </span>
            <span className="nav-label">Settings</span>
          </button>
          <button
            className="sidebar-logout-btn"
            onClick={onLogout}
            title={collapsed ? 'Log out' : undefined}
          >
            <span className="nav-icon">
              <SidebarIcon name="logout" size={18} />
            </span>
            <span className="nav-label">Log out</span>
          </button>
        </div>
      </aside>
    </>
  )
}

export function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

export function getValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') {
      return row[key]
    }
  }
  return null
}

export function isActiveStatus(value) {
  return value === 1 || value === '1' || value === true || value === 'true' || value === 'active' || value === 'Active'
}

/* ============================================================
   VENDOR FILTERING, SELECTION AND EXPORT
   ============================================================ */

const EMPTY_VENDOR_FILTERS = { media_id: '', sub_media_id: '', country: '', state: '', city: '', status: '' }

// Checkbox, ID, Vendor, Media, Location, Contact, GSTIN, Status, Actions —
// keep in step with the <thead> and the .vendors-page column widths.
const VENDOR_COLUMN_COUNT = 9

// The vendor list shows exactly one page size and never offers another.
const VENDORS_PAGE_SIZE = 15

// Country, state and city live on vendor_addresses, so every vendor query
// embeds the address rows. When one of those filters is active the embed
// becomes an inner join so non-matching vendors drop out of the result and
// the count.
const VENDOR_ADDRESS_COLUMNS = 'address,country,state,city,zipcode,is_default'

function needsAddressJoin(filters) {
  return Boolean(filters.country || filters.state || filters.city)
}

function vendorSelect(columns, filters) {
  const join = needsAddressJoin(filters) ? '!inner' : ''
  return `${columns},vendor_addresses${join}(${VENDOR_ADDRESS_COLUMNS})`
}

function applyVendorFilters(request, query, filters) {
  if (query) {
    const safeQuery = query.replace(/[%_]/g, '').replace(/[(),]/g, ' ').trim()
    if (safeQuery) {
      request = request.or(`company_name.ilike.%${safeQuery}%,alias.ilike.%${safeQuery}%,contact_person.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%,gstin.ilike.%${safeQuery}%,pan_number.ilike.%${safeQuery}%`)
    }
  }
  if (filters.media_id) request = request.eq('media_id', Number(filters.media_id))
  if (filters.sub_media_id) request = request.eq('sub_media_id', Number(filters.sub_media_id))
  if (filters.status !== '') request = request.eq('status', Number(filters.status))
  if (filters.country) request = request.eq('vendor_addresses.country', filters.country)
  if (filters.state) request = request.eq('vendor_addresses.state', filters.state)
  if (filters.city) request = request.eq('vendor_addresses.city', filters.city)
  return request
}

function primaryAddress(vendor) {
  const addresses = Array.isArray(vendor?.vendor_addresses) ? vendor.vendor_addresses : []
  return addresses.find((item) => item.is_default) || addresses[0] || null
}

/* ============================================================
   SLASH-COMMAND SEARCH
   ------------------------------------------------------------
   Typing "/" turns the search bar into a chained filter. Segments map
   positionally onto state → country → media → sub media, so
   "/gujarat/india/hoarding/banner" is the same query as picking those four
   values from the dropdowns. Segments may be partial ("/guj"), the chain may
   stop early ("/gujarat/india"), and every step only offers values that can
   still co-exist with the steps before it.
   ============================================================ */

const SLASH_CHAIN = [
  { key: 'state', field: 'state', dimension: 'State' },
  { key: 'country', field: 'country', dimension: 'Country' },
  { key: 'media', field: 'media_id', dimension: 'Media' },
  { key: 'sub_media', field: 'sub_media_id', dimension: 'Sub Media' },
]

const SLASH_PATH_HINT = `/${SLASH_CHAIN.map((step) => step.dimension.toLowerCase().replace(' ', '')).join('/')}`

// Fold case, spacing and punctuation so "New Delhi", "new-delhi" and
// "newdelhi" all resolve to the same option.
function normalizeToken(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isSlashSearch(input) {
  return typeof input === 'string' && input.trimStart().startsWith('/')
}

export function uniqueOptions(values) {
  return [...new Set(values.filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }))
}

// The candidates for one link in the chain, narrowed by the links already
// resolved ahead of it.
function slashOptions(key, catalog, resolved) {
  if (key === 'state') return uniqueOptions(catalog.facets.map((row) => row.state))
  if (key === 'country') {
    return uniqueOptions(catalog.facets
      .filter((row) => !resolved.state || row.state === resolved.state)
      .map((row) => row.country))
  }
  if (key === 'media') return catalog.media.map((item) => ({ value: item.id, label: item.name }))
  return catalog.subMedia
    .filter((item) => !resolved.media_id || String(item.media_id) === String(resolved.media_id))
    .map((item) => ({ value: item.id, label: item.name }))
}

// Exact match wins, then prefix, then substring — so "/guj" lands on Gujarat
// but "/gujarat" is never dragged onto some unrelated longer name.
function matchSlashOption(raw, options) {
  const needle = normalizeToken(raw)
  if (!needle) return null
  return options.find((option) => normalizeToken(option.label) === needle)
    || options.find((option) => normalizeToken(option.label).startsWith(needle))
    || options.find((option) => normalizeToken(option.label).includes(needle))
    || null
}

// Returns null for ordinary free-text searches. Otherwise: the filters the
// chain resolves to, one token per segment (for the chips and the suggestion
// list) and the first segment that matched nothing.
function resolveSlashSearch(input, catalog) {
  if (!isSlashSearch(input)) return null

  const written = input.trimStart().slice(1).split('/').map((part) => part.trim())
  const segments = written.slice(0, SLASH_CHAIN.length)
  const resolved = {}
  const tokens = []
  let unmatched = null

  segments.forEach((raw, index) => {
    const step = SLASH_CHAIN[index]
    // Computed before `resolved` is extended, so a step never narrows itself.
    const options = slashOptions(step.key, catalog, resolved)
    const match = raw ? matchSlashOption(raw, options) : null

    if (match) resolved[step.field] = String(match.value)
    else if (raw && !unmatched) unmatched = { ...step, raw }

    tokens.push({
      ...step,
      raw,
      options,
      match: match && { value: match.value, label: match.label },
      status: !raw ? 'pending' : match ? 'matched' : 'unmatched',
    })
  })

  return {
    filters: resolved,
    tokens,
    unmatched,
    overflow: written.length > SLASH_CHAIN.length,
    activeIndex: tokens.length - 1,
  }
}

// Rebuilds the raw input after a suggestion is picked, normalising every
// already-resolved segment to its canonical label.
function buildSlashInput(slash, index, label) {
  const parts = slash.tokens.map((token, position) => (
    position === index ? label : (token.match?.label || token.raw)
  ))
  return `/${parts.join('/')}${index < SLASH_CHAIN.length - 1 ? '/' : ''}`
}

const FETCH_CHUNK = 1000
const MAX_FETCH_ROWS = 50000

// PostgREST caps rows per response, so anything that needs the *whole* result
// set (select-all, export) pages until a request comes back empty rather than
// trusting a single request to return everything.
async function fetchAllPaged(buildRequest) {
  const rows = []
  for (;;) {
    const { data, error } = await buildRequest(rows.length, rows.length + FETCH_CHUNK - 1)
    if (error) throw error
    if (!data || data.length === 0) return rows
    rows.push(...data)
    if (rows.length >= MAX_FETCH_ROWS) {
      throw new Error(`This matches over ${MAX_FETCH_ROWS.toLocaleString()} vendors. Narrow the filters and try again.`)
    }
  }
}

const VENDOR_EXPORT_COLUMNS = [
  ['ID', (vendor) => vendor.id],
  ['Alias', (vendor) => vendor.alias],
  ['Company Name', (vendor) => vendor.company_name],
  ['Contact Person', (vendor) => vendor.contact_person],
  ['Vendor Type', (vendor) => vendor.vendor_type],
  ['Email', (vendor) => vendor.email],
  ['Contact Number', (vendor) => (vendor.contact == null ? '' : `${vendor.country_dialcode || ''} ${vendor.contact}`.trim())],
  ['Media', (vendor, maps) => maps.mediaMap[vendor.media_id] || ''],
  ['Sub Media', (vendor, maps) => maps.subMediaMap[vendor.sub_media_id] || ''],
  ['Status', (vendor) => (isActiveStatus(vendor.status) ? 'Active' : 'Inactive')],
  ['Payment Term Type', (vendor) => vendor.payment_term_type],
  ['Payment Term Date', (vendor) => vendor.payment_term_invoice_date],
  ['Payment Term (In Days)', (vendor) => vendor.payment_term_value],
  ['Registration', (vendor) => vendor.registration],
  ['GSTIN', (vendor) => vendor.gstin],
  ['GSTIN Date', (vendor) => vendor.gstin_date],
  ['PAN Number', (vendor) => vendor.pan_number],
  ['TDS Percentage', (vendor) => vendor.tds_percentage],
  ['TDS Section', (vendor) => vendor.tds_section],
  ['Opening Balance', (vendor) => vendor.opening_balance],
  ['Bank Name', (vendor) => vendor.vendor_bank_name],
  ['Bank IFSC Code', (vendor) => vendor.vendor_ifsc_code],
  ['Account Number', (vendor) => vendor.vendor_account_number],
  ['Country', (vendor) => primaryAddress(vendor)?.country],
  ['State', (vendor) => primaryAddress(vendor)?.state],
  ['City', (vendor) => primaryAddress(vendor)?.city],
  ['Zipcode', (vendor) => primaryAddress(vendor)?.zipcode],
  ['Address', (vendor) => primaryAddress(vendor)?.address],
  ['Document', (vendor) => vendor.vendor_document_file_name],
]

function vendorExportWorkbook(vendors, maps) {
  return {
    sheetName: 'Vendors',
    headers: VENDOR_EXPORT_COLUMNS.map(([header]) => header),
    rows: vendors.map((vendor) => VENDOR_EXPORT_COLUMNS.map(([, read]) => {
      const value = read(vendor, maps)
      return value === null || value === undefined ? '' : value
    })),
  }
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
  const isActive = isActiveStatus(statusValue)
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

 export function SearchableSelect({ label, value, onChange, options, placeholder, disabled = false, required = false, searchPlaceholder = 'Search...' }) {
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

      // `select()` on the insert gives us the saved row to hand straight back
      // to the list, so the new vendor can be shown without waiting on a
      // second round trip.
      const { data: savedVendor, error: vendorError } = await supabase.from('vendors').insert([vendorPayload]).select('*').single()
      if (vendorError) throw vendorError
      if (!savedVendor?.id) throw new Error('Vendor was created but no vendor ID was returned.')

      const { data: savedAddress, error: addressError } = await supabase.from('vendor_addresses').insert([{
        vendor_id: savedVendor.id,
        address: form.address.trim(),
        country: form.country_name,
        country_code: form.country_code,
        state: form.state.trim(),
        city: form.city.trim(),
        zipcode: form.zipcode.trim() || null,
        is_default: true,
      }]).select(VENDOR_ADDRESS_COLUMNS).single()
      if (addressError) {
        await supabase.from('vendors').delete().eq('id', savedVendor.id)
        throw addressError
      }

      let documentPath = null
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
        documentPath = path
      }

      onSaved({
        ...savedVendor,
        vendor_document_file_path: documentPath,
        vendor_document_file_name: documentFile?.name || null,
        vendor_addresses: savedAddress ? [savedAddress] : [],
      })
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
              <select className="dial-code-select" value={form.country_dialcode || '+91'} onChange={(e) => update('country_dialcode', e.target.value)}>
                {allCountries.map((c) => (
                  <option key={c.isoCode} value={`+${c.phonecode}`}>+{c.phonecode}</option>
                ))}
              </select>
              <input id="vf-contact" type="tel" inputMode="numeric" maxLength={10} value={form.contact} onChange={(e) => { const digits = e.target.value.replace(/\D/g, '').slice(0, 10); update('contact', digits) }} placeholder="98765 43210" />
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
            <input id="vf-pt-date" type="date" value={form.payment_term_invoice_date} onChange={(e) => update('payment_term_invoice_date', e.target.value)} placeholder="DD-MM-YYYY" />
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
            <input id="vf-gstin-date" type="date" value={form.gstin_date} onChange={(e) => update('gstin_date', e.target.value)} placeholder="DD-MM-YYYY" />
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
  // ── Catalogs that both the dropdowns and the "/" chain resolve against ────
  const [mediaOptions, setMediaOptions] = useState([])
  const [subMediaOptions, setSubMediaOptions] = useState([])
  const [addressFacets, setAddressFacets] = useState([])
  const [catalogReady, setCatalogReady] = useState(false)

  // ── Search: `searchInput` drives the UI, `appliedSearch` drives the query ─
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestIndex, setSuggestIndex] = useState(0)
  const searchInputRef = useRef(null)
  const searchShellRef = useRef(null)

  const [filters, setFilters] = useState(EMPTY_VENDOR_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [vendors, setVendors] = useState([])
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  // Bumping `refresh` re-runs the loader even when nothing else changed. It is
  // a fresh object every time on purpose: the previous implementation reset
  // page/query/filters to values they already held, React bailed out of all
  // three updates, and a newly added vendor only showed up after a reload.
  const [refresh, setRefresh] = useState({ key: 0, silent: false })

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [selectedVendorAddress, setSelectedVendorAddress] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [selectingAll, setSelectingAll] = useState(false)
  const [exporting, setExporting] = useState('')

  /* ── Data loading ─────────────────────────────────────────────────────── */

  // Reloaded after every save too: a new vendor can introduce a state, city or
  // country that the filters and the "/" chain should immediately offer.
  useEffect(() => {
    let cancelled = false

    async function loadCatalog() {
      try {
        const [media, subMedia, facets] = await Promise.all([
          supabase.from('media').select('id,name').order('name', { ascending: true }),
          supabase.from('sub_media').select('id,name,media_id').order('name', { ascending: true }),
          fetchAllPaged((from, to) => supabase
            .from('vendor_addresses')
            .select('state,city,country')
            .order('id', { ascending: true })
            .range(from, to)),
        ])
        if (cancelled) return
        setMediaOptions(media.data || [])
        setSubMediaOptions(subMedia.data || [])
        setAddressFacets(facets)
      } catch {
        if (!cancelled) setAddressFacets([])
      } finally {
        if (!cancelled) setCatalogReady(true)
      }
    }

    loadCatalog()
    return () => { cancelled = true }
  }, [refresh.key])

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
      setAppliedSearch(searchInput)
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  /* ── Slash-command parsing ────────────────────────────────────────────── */

  const slashCatalog = useMemo(
    () => ({ facets: addressFacets, media: mediaOptions, subMedia: subMediaOptions }),
    [addressFacets, mediaOptions, subMediaOptions],
  )

  // Two resolutions of the same pure function: the live one keeps the chips and
  // suggestions in step with every keystroke, the applied one is debounced so
  // typing does not fire a request per character.
  const liveSlash = useMemo(() => resolveSlashSearch(searchInput, slashCatalog), [searchInput, slashCatalog])
  const appliedSlash = useMemo(() => resolveSlashSearch(appliedSearch, slashCatalog), [appliedSearch, slashCatalog])

  const slashActive = Boolean(liveSlash)
  const textQuery = appliedSlash ? '' : appliedSearch.trim()

  // A "/" chain owns the four dimensions it addresses plus city (which hangs off
  // state); status stays under manual control because nothing in the chain
  // touches it.
  const effectiveFilters = useMemo(() => (
    appliedSlash
      ? { ...EMPTY_VENDOR_FILTERS, ...appliedSlash.filters, status: filters.status }
      : filters
  ), [appliedSlash, filters])

  const activeToken = liveSlash?.tokens[liveSlash.activeIndex] || null

  const suggestions = useMemo(() => {
    if (!activeToken) return []
    const needle = normalizeToken(activeToken.raw)
    const pool = needle
      ? activeToken.options.filter((option) => normalizeToken(option.label).includes(needle))
      : activeToken.options
    return pool.slice(0, 8)
  }, [activeToken])

  const showSuggestions = slashActive && suggestOpen && catalogReady
  const boundedSuggestIndex = suggestions.length ? Math.min(suggestIndex, suggestions.length - 1) : 0

  useEffect(() => { setSuggestIndex(0) }, [searchInput])

  // Close the suggestion list on an outside click, like the other menus here.
  useEffect(() => {
    if (!showSuggestions) return
    function handlePointerDown(event) {
      if (searchShellRef.current && !searchShellRef.current.contains(event.target)) setSuggestOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [showSuggestions])

  // "/" anywhere on the page jumps into the chained filter.
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || showForm) return
      const target = event.target
      if (target?.isContentEditable) return
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return
      event.preventDefault()
      setSearchInput((current) => (isSlashSearch(current) ? current : '/'))
      setSuggestOpen(true)
      searchInputRef.current?.focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showForm])

  function applySuggestion(option) {
    if (!liveSlash) return
    const next = buildSlashInput(liveSlash, liveSlash.activeIndex, option.label)
    setSearchInput(next)
    setAppliedSearch(next)
    setPage(1)
    setSuggestIndex(0)
    searchInputRef.current?.focus()
  }

  // Clicking a chip truncates the chain back to that step so it can be retyped.
  function editSegment(index) {
    if (!liveSlash) return
    const parts = liveSlash.tokens.slice(0, index + 1).map((token) => token.match?.label || token.raw)
    setSearchInput(`/${parts.join('/')}`)
    setSuggestOpen(true)
    setSuggestIndex(0)
    searchInputRef.current?.focus()
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'Escape') {
      setSuggestOpen(false)
      return
    }
    if (!showSuggestions || suggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSuggestIndex((current) => (current + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSuggestIndex((current) => (current - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      applySuggestion(suggestions[boundedSuggestIndex])
    }
  }

  /* ── Vendor list ──────────────────────────────────────────────────────── */

  useEffect(() => {
    // A "/" chain cannot be resolved before the catalogs are in memory, and
    // fetching early would briefly apply an empty chain — i.e. show everything.
    if (appliedSlash && !catalogReady) return

    // A segment that matches nothing is a genuinely empty result, not a reason
    // to fall back to the broader query the rest of the chain would produce.
    if (appliedSlash?.unmatched) {
      setVendors([])
      setTotalCount(0)
      setError('')
      setLoading(false)
      setRefreshing(false)
      return
    }

    let cancelled = false
    const silent = refresh.silent

    async function loadVendors() {
      if (silent) setRefreshing(true)
      else setLoading(true)
      setError('')

      const from = (page - 1) * VENDORS_PAGE_SIZE
      let request = supabase
        .from('vendors')
        .select(vendorSelect('*', effectiveFilters), { count: 'exact' })
        .order('id', { ascending: false })
        .range(from, from + VENDORS_PAGE_SIZE - 1)

      request = applyVendorFilters(request, textQuery, effectiveFilters)

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
      setRefreshing(false)
    }

    loadVendors()
    return () => { cancelled = true }
  }, [page, textQuery, effectiveFilters, appliedSlash, catalogReady, refresh])

  const mediaMap = useMemo(() => Object.fromEntries(mediaOptions.map((item) => [item.id, item.name])), [mediaOptions])
  const subMediaMap = useMemo(() => Object.fromEntries(subMediaOptions.map((item) => [item.id, item.name])), [subMediaOptions])

  const totalPages = Math.max(1, Math.ceil(totalCount / VENDORS_PAGE_SIZE))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * VENDORS_PAGE_SIZE + 1
  const pageEnd = Math.min(page * VENDORS_PAGE_SIZE, totalCount)
  const pageNumbers = useMemo(() => {
    const current = Math.min(page, totalPages)
    return [current - 2, current - 1, current, current + 1, current + 2].filter((n) => n >= 1 && n <= totalPages)
  }, [page, totalPages])

  // Deleting or filtering can shrink the result set under the current page.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  /* ── Filter option lists ──────────────────────────────────────────────── */

  const mediaFilterOptions = useMemo(() => [
    { value: '', label: 'All media' },
    ...mediaOptions.map((item) => ({ value: String(item.id), label: item.name })),
  ], [mediaOptions])

  const subMediaFilterOptions = useMemo(() => [
    { value: '', label: 'All sub media' },
    ...subMediaOptions
      .filter((item) => !filters.media_id || String(item.media_id) === String(filters.media_id))
      .map((item) => ({ value: String(item.id), label: item.name })),
  ], [subMediaOptions, filters.media_id])

  const countryFilterOptions = useMemo(() => [
    { value: '', label: 'All countries' },
    ...uniqueOptions(addressFacets.map((item) => item.country)),
  ], [addressFacets])

  const stateFilterOptions = useMemo(() => [
    { value: '', label: 'All states' },
    ...uniqueOptions(addressFacets
      .filter((item) => !filters.country || item.country === filters.country)
      .map((item) => item.state)),
  ], [addressFacets, filters.country])

  const cityFilterOptions = useMemo(() => [
    { value: '', label: 'All cities' },
    ...uniqueOptions(addressFacets
      .filter((item) => (!filters.country || item.country === filters.country) && (!filters.state || item.state === filters.state))
      .map((item) => item.city)),
  ], [addressFacets, filters.country, filters.state])

  // Chain dimensions are only manually adjustable while no "/" search owns them.
  const activeFilterCount = Object.entries(filters)
    .filter(([field, value]) => value !== '' && (!slashActive || field === 'status'))
    .length
  const hasActiveCriteria = Boolean(searchInput) || activeFilterCount > 0

  const filterChips = useMemo(() => {
    const chips = []
    const push = (field, label, value) => { if (value) chips.push({ field, label, value }) }
    if (!slashActive) {
      push('media_id', 'Media', filters.media_id && (mediaMap[Number(filters.media_id)] || filters.media_id))
      push('sub_media_id', 'Sub media', filters.sub_media_id && (subMediaMap[Number(filters.sub_media_id)] || filters.sub_media_id))
      push('country', 'Country', filters.country)
      push('state', 'State', filters.state)
      push('city', 'City', filters.city)
    }
    push('status', 'Status', filters.status === '' ? '' : (filters.status === '1' ? 'Active' : 'Inactive'))
    return chips
  }, [filters, slashActive, mediaMap, subMediaMap])

  /* ── Actions ──────────────────────────────────────────────────────────── */

  function changePage(nextPage) { setPage(Math.max(1, Math.min(nextPage, totalPages))) }

  // Dependent filters reset so an impossible combination can never be selected.
  function setFilter(field, value) {
    setActionError('')
    setFilters((current) => {
      const next = { ...current, [field]: value }
      if (field === 'media_id') next.sub_media_id = ''
      if (field === 'country') { next.state = ''; next.city = '' }
      if (field === 'state') next.city = ''
      return next
    })
    setPage(1)
  }

  function clearSearch() {
    setSearchInput('')
    setAppliedSearch('')
    setSuggestOpen(false)
    setPage(1)
  }

  function clearAllCriteria() {
    setActionError('')
    setFilters(EMPTY_VENDOR_FILTERS)
    setSearchInput('')
    setAppliedSearch('')
    setSuggestOpen(false)
    setPage(1)
  }

  function afterSaved(created) {
    setShowForm(false)
    setError('')
    setActionError('')

    // The new vendor need not match whatever is currently filtered, so return
    // the view to the top of the unfiltered list where it is guaranteed to be.
    setSearchInput('')
    setAppliedSearch('')
    setSuggestOpen(false)
    setFilters(EMPTY_VENDOR_FILTERS)
    setPage(1)

    // Optimistic: the row is on screen before the reload lands. Rows are
    // ordered by descending id, so a new vendor belongs at the top of page 1.
    if (created?.id) {
      setVendors((current) => [created, ...current.filter((vendor) => vendor.id !== created.id)].slice(0, VENDORS_PAGE_SIZE))
      setTotalCount((current) => current + 1)
    }

    // …then reconcile against the server. `silent` keeps the optimistic row
    // visible instead of replacing it with loading skeletons.
    setRefresh((current) => ({ key: current.key + 1, silent: Boolean(created?.id) }))
  }

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const currentPageIds = vendors.map((vendor) => vendor.id)
  const allCurrentSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedSet.has(id))

  function toggleSelect(id) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  function toggleSelectPage() {
    setSelectedIds((current) => {
      if (allCurrentSelected) return current.filter((id) => !currentPageIds.includes(id))
      return [...new Set([...current, ...currentPageIds])]
    })
  }

  // Selects every vendor matching the current criteria, not just this page.
  async function selectAllFiltered() {
    setSelectingAll(true)
    setActionError('')
    try {
      const rows = await fetchAllPaged((from, to) => {
        const columns = needsAddressJoin(effectiveFilters) ? 'id,vendor_addresses!inner(country,state,city)' : 'id'
        return applyVendorFilters(
          supabase.from('vendors').select(columns).order('id', { ascending: false }).range(from, to),
          textQuery,
          effectiveFilters,
        )
      })
      setSelectedIds(rows.map((row) => row.id))
    } catch (err) {
      console.error(err)
      setActionError(err?.message || 'Could not select all filtered vendors.')
    } finally {
      setSelectingAll(false)
    }
  }

  async function exportVendors(mode) {
    setExporting(mode)
    setActionError('')
    try {
      let rows
      if (mode === 'selected') {
        rows = []
        for (let index = 0; index < selectedIds.length; index += 300) {
          const chunk = selectedIds.slice(index, index + 300)
          const { data, error: fetchError } = await supabase
            .from('vendors')
            .select(`*,vendor_addresses(${VENDOR_ADDRESS_COLUMNS})`)
            .in('id', chunk)
            .order('id', { ascending: false })
          if (fetchError) throw fetchError
          rows.push(...(data || []))
        }
      } else {
        rows = await fetchAllPaged((from, to) => applyVendorFilters(
          supabase.from('vendors').select(vendorSelect('*', effectiveFilters)).order('id', { ascending: false }).range(from, to),
          textQuery,
          effectiveFilters,
        ))
      }

      if (rows.length === 0) {
        setActionError('There is nothing to export.')
        return
      }

      const stamp = new Date().toISOString().slice(0, 10)
      downloadXlsx(`dikho-vendors-${mode}-${stamp}.xlsx`, vendorExportWorkbook(rows, { mediaMap, subMediaMap }))
    } catch (err) {
      console.error(err)
      setActionError(err?.message || 'Could not export vendors.')
    } finally {
      setExporting('')
    }
  }

  const busy = Boolean(exporting) || selectingAll

  const emptyCopy = appliedSlash?.unmatched
    ? `No ${appliedSlash.unmatched.dimension.toLowerCase()} matches “${appliedSlash.unmatched.raw}”. Pick a suggestion from the search bar to correct that step.`
    : hasActiveCriteria
      ? 'No vendors match the current search and filters. Try clearing one of them.'
      : 'Add your first vendor to see it listed here.'

  return (
    <div className={`vendors-page ${selectedVendor ? 'has-selection' : ''}`}>
      <div className="vendors-main-content">
        <div className="page-header">
          <div>
            <span className="page-kicker">MASTER DATA</span>
            <h1>Vendors</h1>
            <p>{totalCount.toLocaleString()} {totalCount === 1 ? 'vendor' : 'vendors'} in view · 15 per page</p>
          </div>
          <button className="primary-button add-button" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={18} /> Add vendor
          </button>
        </div>

        {/* ── Search + actions ─────────────────────────────────────────── */}
        <div className="vendors-toolbar">
          <div className={`vendor-search ${slashActive ? 'is-chained' : ''}`} ref={searchShellRef}>
            <span className="vendor-search-icon"><Icon name="search" size={17} /></span>
            <input
              ref={searchInputRef}
              className="vendor-search-input"
              value={searchInput}
              onChange={(event) => { setSearchInput(event.target.value); setSuggestOpen(true) }}
              onFocus={() => setSuggestOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder={`Search company, email, GSTIN or PAN — or type ${SLASH_PATH_HINT}`}
              aria-label="Search vendors"
              role="combobox"
              aria-expanded={showSuggestions}
              aria-controls="vendor-slash-suggestions"
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck="false"
            />
            {slashActive
              ? <span className="vendor-search-mode">Chained filter</span>
              : <kbd className="vendor-search-kbd" title="Press / to filter by state, country, media and sub media">/</kbd>}
            {searchInput && (
              <button type="button" className="search-clear" onClick={clearSearch} aria-label="Clear search">
                <Icon name="close" size={15} />
              </button>
            )}

            {showSuggestions && activeToken && (
              <div className="slash-suggestions" id="vendor-slash-suggestions" role="listbox" aria-label={`${activeToken.dimension} suggestions`}>
                <div className="slash-suggestions-head">
                  <span className="slash-suggestions-step">Step {liveSlash.activeIndex + 1} of {SLASH_CHAIN.length} · {activeToken.dimension}</span>
                  <span className="slash-suggestions-path">{SLASH_PATH_HINT}</span>
                </div>
                {suggestions.length === 0 ? (
                  <div className="search-select-empty">
                    {activeToken.options.length === 0
                      ? `No ${activeToken.dimension.toLowerCase()} values available yet`
                      : `No ${activeToken.dimension.toLowerCase()} matches “${activeToken.raw}”`}
                  </div>
                ) : suggestions.map((option, index) => (
                  <button
                    type="button"
                    key={`${activeToken.key}-${option.value}`}
                    role="option"
                    aria-selected={index === boundedSuggestIndex}
                    className={`slash-suggestion ${index === boundedSuggestIndex ? 'is-active' : ''}`}
                    onMouseEnter={() => setSuggestIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applySuggestion(option)}
                  >
                    <span className="slash-suggestion-label">{option.label}</span>
                    <span className="slash-suggestion-hint">↵</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="toolbar-actions">
            <button
              type="button"
              className={`filter-toggle ${filtersOpen ? 'is-open' : ''}`}
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
              aria-controls="vendor-filter-grid"
            >
              <Icon name="filter" size={16} />
              Filters
              {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
              <span className="filter-toggle-caret"><Icon name="chevronDown" size={15} /></span>
            </button>
            <button className="secondary-button" onClick={() => exportVendors('all')} disabled={busy || loading || totalCount === 0}>
              <Icon name="download" size={17} /> {exporting === 'all' ? 'Exporting…' : `Export All${totalCount > 0 ? ` (${totalCount.toLocaleString()})` : ''}`}
            </button>
            <button className="secondary-button" onClick={() => exportVendors('selected')} disabled={busy || selectedIds.length === 0}>
              <Icon name="download" size={17} /> {exporting === 'selected' ? 'Exporting…' : `Export Selected${selectedIds.length > 0 ? ` (${selectedIds.length.toLocaleString()})` : ''}`}
            </button>
          </div>
        </div>

        {/* ── Active criteria ──────────────────────────────────────────── */}
        {(slashActive || filterChips.length > 0) && (
          <div className="criteria-row">
            {slashActive && liveSlash.tokens.map((token, index) => (
              <button
                type="button"
                key={token.key}
                className={`criteria-chip is-slash is-${token.status}`}
                onClick={() => editSegment(index)}
                title={`Edit the ${token.dimension.toLowerCase()} step`}
              >
                <span className="criteria-chip-key">{token.dimension}</span>
                <span className="criteria-chip-value">{token.match?.label || token.raw || 'any'}</span>
              </button>
            ))}
            {filterChips.map((chip) => (
              <span className="criteria-chip" key={chip.field}>
                <span className="criteria-chip-key">{chip.label}</span>
                <span className="criteria-chip-value">{chip.value}</span>
                <button type="button" className="criteria-chip-remove" onClick={() => setFilter(chip.field, '')} aria-label={`Remove ${chip.label} filter`}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
            {hasActiveCriteria && (
              <button type="button" className="criteria-reset" onClick={clearAllCriteria}>Reset all</button>
            )}
          </div>
        )}

        {/* ── Filters ──────────────────────────────────────────────────── */}
        {filtersOpen && (
          <section className="filter-panel" id="vendor-filter-grid">
            {slashActive && (
              <p className="filter-panel-note">
                State, country, media and sub media are coming from the <code>/</code> search. Clear it to set them here.
              </p>
            )}
            <div className="filter-grid">
              <SearchableSelect
                label="Media"
                value={filters.media_id}
                onChange={(value) => setFilter('media_id', value)}
                options={mediaFilterOptions}
                placeholder="All media"
                searchPlaceholder="Search media..."
                disabled={slashActive}
              />
              <SearchableSelect
                label="Sub Media"
                value={filters.sub_media_id}
                onChange={(value) => setFilter('sub_media_id', value)}
                options={subMediaFilterOptions}
                placeholder="All sub media"
                searchPlaceholder="Search sub media..."
                disabled={slashActive}
              />
              <SearchableSelect
                label="Country"
                value={filters.country}
                onChange={(value) => setFilter('country', value)}
                options={countryFilterOptions}
                placeholder="All countries"
                searchPlaceholder="Search countries..."
                disabled={slashActive}
              />
              <SearchableSelect
                label="State"
                value={filters.state}
                onChange={(value) => setFilter('state', value)}
                options={stateFilterOptions}
                placeholder="All states"
                searchPlaceholder="Search states..."
                disabled={slashActive}
              />
              <SearchableSelect
                label="City"
                value={filters.city}
                onChange={(value) => setFilter('city', value)}
                options={cityFilterOptions}
                placeholder="All cities"
                searchPlaceholder="Search cities..."
                disabled={slashActive}
              />
              <div className="field">
                <label htmlFor="vendor-status-filter">Vendor Status</label>
                <select id="vendor-status-filter" value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
                  <option value="">All statuses</option>
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </div>
            </div>
          </section>
        )}

        {error && (
          <div className="page-error" role="alert">
            <span className="page-error-icon"><Icon name="alert" size={18} /></span>
            <div><strong>Could not load vendors</strong><p>{error}</p></div>
          </div>
        )}

        {actionError && (
          <div className="page-error" role="alert">
            <span className="page-error-icon"><Icon name="alert" size={18} /></span>
            <div><strong>Action failed</strong><p>{actionError}</p></div>
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────────── */}
        <section className="table-card">
          <div className="table-topline">
            <div>
              <strong>All Vendors</strong>
              <span className="result-count">{totalCount.toLocaleString()} records</span>
              {refreshing && <span className="result-count">Updating…</span>}
              {textQuery && <span className="search-state">Filtered by “{textQuery}”</span>}
            </div>
            <div className="topline-right">
              <span className="selection-count"><strong>{selectedIds.length.toLocaleString()}</strong> selected</span>
              <button type="button" className="selection-link" onClick={selectAllFiltered} disabled={busy || loading || totalCount === 0}>
                {selectingAll ? 'Selecting…' : 'Select all filtered'}
              </button>
              <button type="button" className="selection-link" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0}>
                Clear selection
              </button>
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th className="check-column"><button type="button" className={`checkbox-button ${allCurrentSelected ? 'checked' : ''}`} onClick={toggleSelectPage} aria-label="Select all vendors on this page">{allCurrentSelected ? <Icon name="check" size={14} /> : null}</button></th>
                  <th>ID</th>
                  <th>Vendor</th>
                  <th>Media</th>
                  <th>Location</th>
                  <th>Contact</th>
                  <th>GSTIN</th>
                  <th>Status</th>
                  <th className="actions-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: VENDORS_PAGE_SIZE }).map((_, index) => (
                    <tr key={`vendor-skeleton-${index}`}>
                      {Array.from({ length: VENDOR_COLUMN_COUNT }).map((__, cell) => <td key={cell}><span className="skeleton skeleton-company" /></td>)}
                    </tr>
                  ))
                ) : vendors.length === 0 ? (
                  <tr>
                    <td colSpan={VENDOR_COLUMN_COUNT} className="empty-state">
                      <div className="empty-title">No vendors found</div>
                      <div className="empty-copy">{emptyCopy}</div>
                    </td>
                  </tr>
                ) : (
                  vendors.map((vendor) => {
                    const isActive = isActiveStatus(getValue(vendor, ['status']))
                    const address = primaryAddress(vendor)
                    const subtitle = getValue(vendor, ['alias', 'contact_person', 'vendor_type'])
                    const region = [address?.state, address?.country].filter(Boolean).join(' · ')
                    const phone = vendor.contact == null ? null : `${vendor.country_dialcode || ''} ${vendor.contact}`.trim()
                    return (
                      <tr
                        key={vendor.id}
                        className={selectedVendor?.id === vendor.id ? 'is-open' : ''}
                        onDoubleClick={() => setSelectedVendor(vendor)}
                      >
                        <td className="check-column"><button type="button" className={`checkbox-button ${selectedSet.has(vendor.id) ? 'checked' : ''}`} onClick={(event) => { event.stopPropagation(); toggleSelect(vendor.id) }} aria-label={`Select ${vendor.company_name}`}>{selectedSet.has(vendor.id) ? <Icon name="check" size={14} /> : null}</button></td>
                        <td className="id-cell">{formatValue(vendor.id)}</td>
                        <td>
                          <span className="cell-primary company-cell" title={vendor.company_name || ''}>{formatValue(vendor.company_name)}</span>
                          <span className="cell-secondary" title={subtitle || ''}>{formatValue(subtitle)}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatValue(mediaMap[vendor.media_id])}</span>
                          <span className="cell-secondary">{formatValue(subMediaMap[vendor.sub_media_id])}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatValue(address?.city)}</span>
                          <span className="cell-secondary" title={region}>{formatValue(region)}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatValue(phone)}</span>
                          <span className="cell-secondary" title={vendor.email || ''}>{formatValue(vendor.email)}</span>
                        </td>
                        <td className="mono-cell">{formatValue(vendor.gstin)}</td>
                        <td>
                          <span className={`status-pill ${isActive ? 'active' : 'inactive'}`}>
                            <span className="status-dot" />
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="actions-column"><button className="row-action" onClick={() => setSelectedVendor(vendor)} aria-label={`Open vendor ${vendor.company_name}`}><Icon name="chevron" size={17} /></button></td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar">
            <span className="pagination-summary">
              {totalCount === 0 ? 'No records' : <>Showing <strong>{pageStart}–{pageEnd}</strong> of {totalCount.toLocaleString()}</>}
            </span>
            <div className="pagination-meta">
              <span className="pagination-page-label">Page {Math.min(page, totalPages)} of {totalPages.toLocaleString()}</span>
              <div className="pagination-buttons">
                <button onClick={() => changePage(1)} disabled={page <= 1} aria-label="First page"><Icon name="first" size={16} /></button>
                <button onClick={() => changePage(page - 1)} disabled={page <= 1} aria-label="Previous page"><Icon name="chevron" size={16} /></button>
                {pageNumbers.map((number) => <button key={number} className={number === page ? 'current' : ''} onClick={() => changePage(number)} aria-current={number === page ? 'page' : undefined}>{number}</button>)}
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

/* ============================================================
   SALES ORDERS
   ------------------------------------------------------------
   The parent `salesorder` and its child `salesorderdocument` are both created
   by supabase/migrations/20260829_salesorder.sql. This module is the only place
   they are read or written. Both names are constants so renaming either table
   in the database is a one-line change here.
   ============================================================ */

const SALES_ORDER_TABLE = 'salesorder'
const SALES_ORDER_ITEM_TABLE = 'salesorderdocument'

// Order #, Client, Type, Campaign, Status, Total, Actions — keep in step with
// the <thead> and the .so-page column widths.
const SO_COLUMN_COUNT = 7

const SO_PAGE_SIZES = [25, 50, 75, 100]

// The three advertising categories the rest of the product is organised around.
export const ORDER_TYPE_OPTIONS = ['ATL', 'TTL', 'BTL']

// `order_status` and `purchase_status` are open text in the database, so these
// are the values this module *writes* — not a set it can enforce. Whatever the
// table already holds is merged in at runtime (see `SalesOrdersPage`) and the
// list renders any value it is given.
export const ORDER_STATUS_OPTIONS = ['Draft', 'Pending Approval', 'Approved', 'In Progress', 'Completed', 'Cancelled']
const PURCHASE_STATUS_OPTIONS = ['Not Started', 'Partial', 'Completed']

// CGST + SGST within one state, IGST across states, CGST + UTGST in a union
// territory. These are the three shapes the four child tax columns can take.
export const GST_TYPE_OPTIONS = [
  { value: 'Intra-State', label: 'Intra-State (CGST + SGST)' },
  { value: 'Inter-State', label: 'Inter-State (IGST)' },
  { value: 'Union Territory', label: 'Union Territory (CGST + UTGST)' },
]

export const GST_RATES = [0, 5, 12, 18, 28]

const SO_ITEM_TYPE_OPTIONS = ['Media', 'Production', 'Printing', 'Installation', 'Service', 'Other']

const SO_COURIER_STATUS_OPTIONS = ['Not Sent', 'Dispatched', 'In Transit', 'Delivered', 'Returned']

/* ── Money ──────────────────────────────────────────────────────────────── */

export function round2(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}

export function toAmount(value) {
  if (value === '' || value === null || value === undefined) return 0
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return formatValue(value)
  return number.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Dates come back from PostgREST as `date` or `timestamptz` strings. The rest of
// the app shows them as stored rather than reformatting, so this only trims a
// timestamp down to its day.
export function formatDate(value) {
  if (!value) return '—'
  return String(value).slice(0, 10)
}

export function campaignDays(start, end) {
  if (!start || !end) return null
  const from = new Date(start)
  const to = new Date(end)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  const days = Math.round((to - from) / 86400000) + 1
  return days > 0 ? days : null
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/* ── GST ────────────────────────────────────────────────────────────────── */

// Splits one item's tax across the four columns the child table stores. The two
// halves are derived from each other rather than both from `tax`, so
// cgst + sgst adds back up to tax exactly even when tax has an odd last paisa.
export function splitGst(gstType, taxAmount, isTaxable) {
  const zero = { cgst_amount: 0, sgst_amount: 0, igst_amount: 0, utgst_amount: 0 }
  const tax = round2(taxAmount)
  if (!isTaxable || tax === 0) return zero
  if (gstType === 'Inter-State') return { ...zero, igst_amount: tax }
  const half = round2(tax / 2)
  if (gstType === 'Union Territory') return { ...zero, cgst_amount: half, utgst_amount: round2(tax - half) }
  return { ...zero, cgst_amount: half, sgst_amount: round2(tax - half) }
}

// One form row → every money column the child table stores. Nothing downstream
// has to recompute or guess: the split is applied here and after-tax is always
// taxable + tax.
export function itemAmounts(item) {
  const taxable = round2(toAmount(item.taxable_amount))
  const isTaxable = Boolean(item.is_taxable)
  const tax = isTaxable ? round2(toAmount(item.tax_amount)) : 0
  return {
    taxable_amount: taxable,
    tax_amount: tax,
    after_tax_amount: round2(taxable + tax),
    ...splitGst(item.gst_type, tax, isTaxable),
  }
}

export function taxFromRate(taxableAmount, rate) {
  return round2(toAmount(taxableAmount) * (toAmount(rate) / 100))
}

// The child table stores amounts, not the rate that produced them, so an item
// opened for editing has its rate read back out of the two amounts. Anything
// that is not one of the standard slabs comes back as a custom rate, which hands
// the tax field to the user instead of overwriting it.
export function rateFromAmounts(taxableAmount, taxAmount) {
  const taxable = toAmount(taxableAmount)
  if (taxable <= 0) return '18'
  const rate = round2((toAmount(taxAmount) / taxable) * 100)
  return GST_RATES.includes(rate) ? String(rate) : 'custom'
}

export function gstBreakdown(row) {
  return [
    ['CGST', row.cgst_amount],
    ['SGST', row.sgst_amount],
    ['IGST', row.igst_amount],
    ['UTGST', row.utgst_amount],
  ]
    .filter(([, value]) => toAmount(value) !== 0)
    .map(([label, value]) => `${label} ${formatMoney(value)}`)
    .join(' · ')
}

/* ── Totals reconciliation ──────────────────────────────────────────────── */

// Amounts arrive from text inputs, so equality is checked to within half a
// paisa rather than exactly.
const MONEY_EPSILON = 0.005

// The parent's three totals are never taken from the form: they are recomputed
// from the child rows here, and every internal relationship is re-checked, in
// the same call that produces the numbers sent to Supabase. A failure means the
// UI and the items have drifted apart and nothing is written.
function reconcileSalesOrderTotals(items) {
  let subTotal = 0
  let taxTotal = 0
  let grandTotal = 0

  items.forEach((item, index) => {
    const amounts = itemAmounts(item)
    const position = index + 1
    const splitSum = round2(amounts.cgst_amount + amounts.sgst_amount + amounts.igst_amount + amounts.utgst_amount)

    if (Math.abs(splitSum - amounts.tax_amount) > MONEY_EPSILON) {
      throw new Error(`Item ${position}: the CGST/SGST/IGST/UTGST split (${splitSum}) does not add up to the tax amount (${amounts.tax_amount}).`)
    }
    if (Math.abs(amounts.after_tax_amount - (amounts.taxable_amount + amounts.tax_amount)) > MONEY_EPSILON) {
      throw new Error(`Item ${position}: the after-tax amount does not equal taxable + tax.`)
    }

    subTotal += amounts.taxable_amount
    taxTotal += amounts.tax_amount
    grandTotal += amounts.after_tax_amount
  })

  const totals = {
    sub_total: round2(subTotal),
    tax_total: round2(taxTotal),
    total: round2(grandTotal),
  }

  if (Math.abs(totals.total - (totals.sub_total + totals.tax_total)) > MONEY_EPSILON) {
    throw new Error(`Order total (${totals.total}) does not equal sub total + tax total (${round2(totals.sub_total + totals.tax_total)}).`)
  }

  return totals
}

// The same three numbers for rows that are already in the database, so the
// details panel can flag a parent whose stored totals no longer match its items.
export function storedItemTotals(rows) {
  return rows.reduce((accumulator, row) => ({
    sub_total: round2(accumulator.sub_total + toAmount(row.taxable_amount)),
    tax_total: round2(accumulator.tax_total + toAmount(row.tax_amount)),
    total: round2(accumulator.total + toAmount(row.after_tax_amount)),
  }), { sub_total: 0, tax_total: 0, total: 0 })
}

/* ── Writing without being able to read the schema first ────────────────── */

/*
   `salesorder` was created outside this repo and its column types cannot be
   introspected from the browser, so the writes below react to what PostgREST
   reports rather than assuming:

     PGRST204  the column is not in the table → drop it and retry
     23502     NOT NULL on a column left empty → fill it and retry

   Each retry strictly shrinks or completes the payload and the loop is bounded,
   so a column this module genuinely cannot satisfy surfaces as the database's
   own error instead of spinning. Anything else (a type mismatch, a check
   constraint, an RLS refusal) is re-thrown untouched — those need a human, not
   a retry.
*/

const MAX_WRITE_ATTEMPTS = 8

export function missingColumnFrom(error) {
  if (error?.code !== 'PGRST204') return null
  return (String(error.message || '').match(/'([^']+)' column/) || [])[1] || null
}

export function notNullColumnFrom(error) {
  if (error?.code !== '23502') return null
  const from = (text) => (String(text || '').match(/column "([^"]+)"/) || [])[1]
  return from(error.details) || from(error.message) || null
}

// Columns this module may legitimately leave empty, with the value to use if the
// database turns out to require one.
const SALES_ORDER_FALLBACKS = {
  unique_id: () => `SO-${Date.now()}`,
  crm_reference_id: () => `SO-${Date.now()}`,
  order_type: () => ORDER_TYPE_OPTIONS[0],
  order_status: () => ORDER_STATUS_OPTIONS[0],
  purchase_status: () => PURCHASE_STATUS_OPTIONS[0],
  order_date: () => todayIso(),
  order_client_fullname: (row) => row.company || 'Client',
  brand_name: (row) => row.company || 'Brand',
  multi_purpose_so: () => false,
  payment_receipt_amount: () => 0,
  created_by: () => 'Dikho',
}

const SALES_ORDER_ITEM_FALLBACKS = {
  type: () => SO_ITEM_TYPE_OPTIONS[0],
  short_name: (row) => row.name || 'Item',
  label: (row) => row.name || 'Item',
  reference_type: () => 'Sales Order',
  gst_type: () => GST_TYPE_OPTIONS[0].value,
  date: () => todayIso(),
  invoice_number: () => '',
  is_taxable: () => true,
  self_audit_completed: () => false,
}

// `run` receives the (possibly adjusted) rows and performs one request. Callers
// that write a single row pass a one-element array and read `rows[0]`.
async function writeRows(run, rows, fallbacks) {
  let current = rows.map((row) => ({ ...row }))

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { data, error } = await run(current)
    if (!error) return data

    const missing = missingColumnFrom(error)
    if (missing && current.some((row) => missing in row)) {
      current = current.map((row) => {
        const next = { ...row }
        delete next[missing]
        return next
      })
      continue
    }

    const required = notNullColumnFrom(error)
    const isEmpty = (row) => row[required] === null || row[required] === undefined
    if (required && fallbacks[required] && current.some(isEmpty)) {
      current = current.map((row, index) => (isEmpty(row) ? { ...row, [required]: fallbacks[required](rows[index] || {}, index) } : row))
      continue
    }

    throw error
  }

  throw new Error('Could not find a payload this table accepts. Compare its definition against the columns the Sales Orders module writes.')
}

/* ── Searching ──────────────────────────────────────────────────────────── */

// All three search targets are matched with `ilike`, which requires text
// columns. `company` is the only one confirmed to be text, so if the database
// rejects the wider filter the search narrows to it rather than failing.
const SO_SEARCH_COLUMNS = ['order_number', 'company', 'crm_reference_id']
const SO_SEARCH_FALLBACK_COLUMNS = ['company']

export function isIlikeTypeError(error) {
  return error?.code === '42883' || /\bilike\b/i.test(String(error?.message || ''))
}

function soSearchFilter(request, query, columns) {
  const safeQuery = query.replace(/[%_]/g, '').replace(/[(),]/g, ' ').trim()
  if (!safeQuery) return request
  return request.or(columns.map((column) => `${column}.ilike.%${safeQuery}%`).join(','))
}

/* ── Status presentation ────────────────────────────────────────────────── */

// Statuses are open text, so the pill is chosen from what the value reads like
// rather than from a fixed map — a status this module never writes still lands
// somewhere sensible.
export function statusTone(status) {
  const text = String(status ?? '').toLowerCase()
  if (!text) return 'neutral'
  if (/(cancel|reject|hold|fail|void)/.test(text)) return 'danger'
  if (/(complete|approved|closed|paid|done)/.test(text)) return 'active'
  if (/(pending|progress|partial|draft|await|open)/.test(text)) return 'pending'
  return 'neutral'
}

/* ── Form shapes ────────────────────────────────────────────────────────── */

const SO_COLOR_OPTIONS = [
  { value: '', label: 'None' },
  { value: '#185494', label: 'Blue' },
  { value: '#f9af1b', label: 'Amber' },
  { value: '#2f9e6f', label: 'Green' },
  { value: '#b23b43', label: 'Red' },
  { value: '#6c4bb6', label: 'Purple' },
  { value: '#6b7684', label: 'Slate' },
]

function blankSalesOrderForm() {
  return {
    crm_reference_id: '',
    company: '',
    order_client_fullname: '',
    order_type: ORDER_TYPE_OPTIONS[0],
    unique_id: '',
    order_number: '',
    order_date: todayIso(),
    invoice_date: '',
    campaign_start_date: '',
    campaign_end_date: '',
    brand_name: '',
    multi_purpose_so: false,
    invoice_courier: '',
    payment_receipt_amount: '',
    order_status: ORDER_STATUS_OPTIONS[0],
    purchase_status: PURCHASE_STATUS_OPTIONS[0],
    order_color: '',
    approved_by: '',
    approved_date: '',
    complete_date: '',
  }
}

function salesOrderToForm(row) {
  return {
    crm_reference_id: row.crm_reference_id ?? '',
    company: row.company ?? '',
    order_client_fullname: row.order_client_fullname ?? '',
    order_type: row.order_type ?? '',
    unique_id: row.unique_id ?? '',
    order_number: row.order_number ?? '',
    order_date: formatDateInput(row.order_date),
    invoice_date: formatDateInput(row.invoice_date),
    campaign_start_date: formatDateInput(row.campaign_start_date),
    campaign_end_date: formatDateInput(row.campaign_end_date),
    brand_name: row.brand_name ?? '',
    multi_purpose_so: Boolean(row.multi_purpose_so),
    invoice_courier: row.invoice_courier ?? '',
    payment_receipt_amount: row.payment_receipt_amount == null ? '' : String(row.payment_receipt_amount),
    order_status: row.order_status ?? '',
    purchase_status: row.purchase_status ?? '',
    order_color: row.order_color ?? '',
    approved_by: row.approved_by ?? '',
    approved_date: formatDateInput(row.approved_date),
    complete_date: formatDateInput(row.complete_date),
  }
}

// `<input type="date">` only accepts YYYY-MM-DD, so a timestamp column is
// trimmed to its day rather than silently rejected.
export function formatDateInput(value) {
  return value ? String(value).slice(0, 10) : ''
}

function blankSalesOrderItem(key) {
  return {
    key,
    id: null,
    type: SO_ITEM_TYPE_OPTIONS[0],
    name: '',
    short_name: '',
    label: '',
    reference_type: 'Sales Order',
    date: '',
    invoice_number: '',
    is_taxable: true,
    gst_type: GST_TYPE_OPTIONS[0].value,
    gst_rate: '18',
    taxable_amount: '',
    tax_amount: '',
    document_color: '',
    document_note: '',
    self_audit_completed: false,
    file_url: '',
    document_courier: '',
    courier_status: '',
    expanded: false,
  }
}

function salesOrderItemToForm(row, key) {
  return {
    key,
    id: row.id ?? null,
    type: row.type ?? '',
    name: row.name ?? '',
    short_name: row.short_name ?? '',
    label: row.label ?? '',
    reference_type: row.reference_type ?? '',
    date: formatDateInput(row.date),
    invoice_number: row.invoice_number ?? '',
    is_taxable: row.is_taxable === null || row.is_taxable === undefined ? true : Boolean(row.is_taxable),
    gst_type: row.gst_type || GST_TYPE_OPTIONS[0].value,
    gst_rate: rateFromAmounts(row.taxable_amount, row.tax_amount),
    taxable_amount: row.taxable_amount == null ? '' : String(row.taxable_amount),
    tax_amount: row.tax_amount == null ? '' : String(row.tax_amount),
    document_color: row.document_color ?? '',
    document_note: row.document_note ?? '',
    self_audit_completed: Boolean(row.self_audit_completed),
    file_url: row.file_url ?? '',
    document_courier: row.document_courier ?? '',
    courier_status: row.courier_status ?? '',
    expanded: false,
  }
}

// Rate → tax is the normal direction; choosing "Custom" hands the tax field back
// to the user, and clearing "Taxable" zeroes it whatever the rate says.
export function applyItemChange(item, field, value) {
  const next = { ...item, [field]: value }

  if (field === 'is_taxable') {
    if (!value) next.tax_amount = '0'
    else if (next.gst_rate !== 'custom') next.tax_amount = String(taxFromRate(next.taxable_amount, next.gst_rate))
    return next
  }

  if ((field === 'taxable_amount' || field === 'gst_rate') && next.is_taxable && next.gst_rate !== 'custom') {
    next.tax_amount = String(taxFromRate(next.taxable_amount, next.gst_rate))
  }

  return next
}

// `created_by` is stamped here because it is text like the rest of the payload.
// `created_by_id` is deliberately absent: its type cannot be verified from the
// browser, and a uuid sent to an integer column would fail the whole insert. It
// is stamped separately, best-effort, once the row exists.
function buildSalesOrderPayload(form, totals, session) {
  return {
    crm_reference_id: form.crm_reference_id.trim() || null,
    company: form.company.trim(),
    order_client_fullname: form.order_client_fullname.trim() || null,
    order_type: form.order_type || null,
    unique_id: form.unique_id.trim() || null,
    order_number: form.order_number.trim(),
    order_date: form.order_date || null,
    invoice_date: form.invoice_date || null,
    campaign_start_date: form.campaign_start_date || null,
    campaign_end_date: form.campaign_end_date || null,
    brand_name: form.brand_name.trim() || null,
    multi_purpose_so: Boolean(form.multi_purpose_so),
    invoice_courier: form.invoice_courier.trim() || null,
    payment_receipt_amount: form.payment_receipt_amount === '' ? null : round2(form.payment_receipt_amount),
    order_status: form.order_status || null,
    purchase_status: form.purchase_status || null,
    order_color: form.order_color || null,
    approved_by: form.approved_by.trim() || null,
    approved_date: form.approved_date || null,
    complete_date: form.complete_date || null,
    sub_total: totals.sub_total,
    tax_total: totals.tax_total,
    total: totals.total,
    created_by: sessionActor(session),
  }
}

export function sessionActor(session) {
  const user = session?.user
  return user?.user_metadata?.full_name || user?.email || null
}

function buildSalesOrderItemPayload(item, salesOrderId) {
  return {
    sales_order_id: salesOrderId,
    type: item.type.trim() || null,
    name: item.name.trim(),
    short_name: item.short_name.trim() || null,
    label: item.label.trim() || null,
    reference_type: item.reference_type.trim() || null,
    date: item.date || null,
    invoice_number: item.invoice_number.trim() || null,
    is_taxable: Boolean(item.is_taxable),
    gst_type: item.is_taxable ? (item.gst_type || null) : null,
    document_color: item.document_color || null,
    document_note: item.document_note.trim() || null,
    self_audit_completed: Boolean(item.self_audit_completed),
    file_url: item.file_url.trim() || null,
    document_courier: item.document_courier.trim() || null,
    courier_status: item.courier_status || null,
    ...itemAmounts(item),
  }
}

/* ── Details panel ──────────────────────────────────────────────────────── */

function SalesOrderItemCard({ row }) {
  const breakdown = gstBreakdown(row)
  const references = [
    row.purchase_order_id ? `PO #${row.purchase_order_id}` : null,
    row.inv_number || (row.inv_id ? `Invoice #${row.inv_id}` : null),
  ].filter(Boolean).join(' · ')

  return (
    <div className="so-detail-item">
      <div className="so-detail-item-head">
        {row.document_color && <span className="so-color-dot" style={{ background: row.document_color }} aria-hidden="true" />}
        <span className="so-detail-item-name" title={row.name || ''}>{formatValue(row.name)}</span>
        <span className="so-detail-item-total">{formatMoney(row.after_tax_amount)}</span>
      </div>

      <div className="so-detail-item-meta">
        <span>{formatValue(getValue(row, ['type', 'label', 'reference_type']))}</span>
        {row.date && <span>{formatDate(row.date)}</span>}
        {row.invoice_number && <span>Inv {row.invoice_number}</span>}
        {row.self_audit_completed && <span className="so-detail-item-flag">Self-audited</span>}
      </div>

      <div className="so-detail-item-money">
        <span>Taxable <strong>{formatMoney(row.taxable_amount)}</strong></span>
        <span>Tax <strong>{formatMoney(row.tax_amount)}</strong></span>
      </div>

      {(breakdown || row.gst_type) && (
        <div className="so-detail-item-gst">{[row.is_taxable === false ? 'Not taxable' : row.gst_type, breakdown].filter(Boolean).join(' · ')}</div>
      )}

      {references && <div className="so-detail-item-gst">{references}</div>}

      {(row.document_courier || row.courier_status) && (
        <div className="so-detail-item-gst">{[row.document_courier, row.courier_status].filter(Boolean).join(' · ')}</div>
      )}

      {row.document_note && <div className="so-detail-item-note">{row.document_note}</div>}

      {row.file_url && (
        <a className="so-detail-item-link" href={row.file_url} target="_blank" rel="noopener noreferrer">
          <Icon name="file" size={14} /> Open attachment
        </a>
      )}
    </div>
  )
}

function SalesOrderDetails({ order, items, itemsLoading, itemsError, onClose, onEdit }) {
  if (!order) return null

  const duration = campaignDays(order.campaign_start_date, order.campaign_end_date)

  // The parent carries its own totals, so a parent whose stored figures have
  // drifted from its items (edited elsewhere, a partial write) is worth saying
  // out loud rather than showing two numbers and leaving the reader to spot it.
  const stored = storedItemTotals(items)
  const drifted = !itemsLoading && !itemsError && items.length > 0
    && Math.abs(stored.total - toAmount(order.total)) > MONEY_EPSILON

  const receipt = toAmount(order.payment_receipt_amount)
  const balance = order.payment_receipt_amount == null ? null : round2(toAmount(order.total) - receipt)

  const sections = [
    { title: 'Order Info', fields: [
      ['ID', order.id],
      ['Order Number', order.order_number],
      ['CRM Reference', order.crm_reference_id],
      ['Unique ID', order.unique_id],
      ['Order Type', order.order_type],
      ['Order Date', order.order_date && formatDate(order.order_date)],
      ['Invoice Date', order.invoice_date && formatDate(order.invoice_date)],
      ['Order Status', order.order_status],
      ['Purchase Status', order.purchase_status],
      ['Multi Purpose SO', order.multi_purpose_so == null ? null : (order.multi_purpose_so ? 'Yes' : 'No')],
    ]},
    { title: 'Client', fields: [
      ['Company', order.company],
      ['Client Contact', order.order_client_fullname],
    ]},
    { title: 'Campaign', fields: [
      ['Start Date', order.campaign_start_date && formatDate(order.campaign_start_date)],
      ['End Date', order.campaign_end_date && formatDate(order.campaign_end_date)],
      ['Duration', duration && `${duration} ${duration === 1 ? 'day' : 'days'}`],
    ]},
    { title: 'Media / Brand', fields: [
      ['Brand Name', order.brand_name],
      ['Invoice Courier', order.invoice_courier],
    ]},
    { title: 'Approval', fields: [
      ['Approved By', order.approved_by],
      ['Approved Date', order.approved_date && formatDate(order.approved_date)],
      ['Completed Date', order.complete_date && formatDate(order.complete_date)],
      ['Created By', order.created_by],
      ['Created At', order.created_at && formatDate(order.created_at)],
      ['Last Updated', order.updated_at && formatDate(order.updated_at)],
    ]},
  ]

  return (
    <aside className="details-drawer" aria-label="Sales order details">
      <div className="drawer-header">
        <div>
          <span className="drawer-kicker">SALES ORDER</span>
          <h2>{formatValue(order.order_number)}</h2>
        </div>
        <div className="drawer-header-actions">
          <button className="icon-button" onClick={onEdit} aria-label="Edit sales order" title="Edit">
            <Icon name="edit" size={18} />
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={19} />
          </button>
        </div>
      </div>
      <div className="drawer-divider" />

      {/* ── Financial totals ───────────────────────────────────────────── */}
      <div className="so-total-panel">
        <div className="so-total-row">
          <span>Sub Total</span>
          <span className="mono-cell">{formatMoney(order.sub_total)}</span>
        </div>
        <div className="so-total-row">
          <span>Tax Total</span>
          <span className="mono-cell">{formatMoney(order.tax_total)}</span>
        </div>
        <div className="so-total-row is-grand">
          <span>Total</span>
          <span className="mono-cell">{formatMoney(order.total)}</span>
        </div>
        {order.payment_receipt_amount != null && (
          <>
            <div className="so-total-row">
              <span>Payment Received</span>
              <span className="mono-cell">{formatMoney(receipt)}</span>
            </div>
            <div className="so-total-row">
              <span>Balance</span>
              <span className="mono-cell">{formatMoney(balance)}</span>
            </div>
          </>
        )}
      </div>

      {drifted && (
        <div className="so-drift-note" role="status">
          The items on this order add up to {formatMoney(stored.total)}, which differs from the stored total.
          Saving the order again will recalculate it.
        </div>
      )}

      {/* ── Child items ────────────────────────────────────────────────── */}
      <div className="details-list">
        <div className="details-section-title">
          Order Items
          {!itemsLoading && !itemsError && <span className="so-item-count">{items.length}</span>}
        </div>

        {itemsLoading ? (
          <div className="so-detail-items-state">Loading items…</div>
        ) : itemsError ? (
          <div className="so-detail-items-state is-error">{itemsError}</div>
        ) : items.length === 0 ? (
          <div className="so-detail-items-state">No items recorded on this order yet.</div>
        ) : (
          <div className="so-detail-items">
            {items.map((row) => <SalesOrderItemCard key={row.id} row={row} />)}
          </div>
        )}

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

/* ── Add / Edit form ────────────────────────────────────────────────────── */

function SalesOrderItemEditor({ item, index, onChange, onRemove, onToggle, canRemove, typeOptions }) {
  const amounts = itemAmounts(item)
  const field = (name) => (event) => onChange(index, name, event.target.value)
  const breakdown = gstBreakdown(amounts)

  return (
    <div className="so-item-card">
      <div className="so-item-head">
        <span className="so-item-index">{index + 1}</span>
        {item.document_color && <span className="so-color-dot" style={{ background: item.document_color }} aria-hidden="true" />}
        <span className="so-item-title" title={item.name}>{item.name.trim() || 'Untitled item'}</span>
        <span className="so-item-amount mono-cell">{formatMoney(amounts.after_tax_amount)}</span>
        <button type="button" className="so-item-more" onClick={() => onToggle(index)} aria-expanded={item.expanded}>
          {item.expanded ? 'Fewer fields' : 'More fields'}
          <Icon name="chevronDown" size={14} />
        </button>
        <button
          type="button"
          className="icon-button small"
          onClick={() => onRemove(index)}
          disabled={!canRemove}
          title={canRemove ? 'Remove item' : 'An order needs at least one item'}
          aria-label={`Remove item ${index + 1}`}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>

      <div className="so-item-grid">
        <div className="field so-item-name">
          <label htmlFor={`so-item-name-${item.key}`}>Name *</label>
          <input id={`so-item-name-${item.key}`} value={item.name} onChange={field('name')} placeholder="What is being sold" />
        </div>

        <div className="field">
          <label htmlFor={`so-item-type-${item.key}`}>Type</label>
          <select id={`so-item-type-${item.key}`} value={item.type} onChange={field('type')}>
            <option value="">—</option>
            {typeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`so-item-date-${item.key}`}>Date</label>
          <input id={`so-item-date-${item.key}`} type="date" value={item.date} onChange={field('date')} />
        </div>

        <div className="field">
          <label htmlFor={`so-item-taxable-${item.key}`}>Taxable Amount</label>
          <input
            id={`so-item-taxable-${item.key}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={item.taxable_amount}
            onChange={field('taxable_amount')}
            placeholder="0.00"
          />
        </div>

        <div className="field so-check-field">
          <label>GST</label>
          <button
            type="button"
            className="so-check"
            onClick={() => onChange(index, 'is_taxable', !item.is_taxable)}
            aria-pressed={item.is_taxable}
          >
            <span className={`checkbox-button ${item.is_taxable ? 'checked' : ''}`}>
              {item.is_taxable ? <Icon name="check" size={13} /> : null}
            </span>
            Taxable
          </button>
        </div>

        <div className="field">
          <label htmlFor={`so-item-gst-type-${item.key}`}>GST Type</label>
          <select id={`so-item-gst-type-${item.key}`} value={item.gst_type} onChange={field('gst_type')} disabled={!item.is_taxable}>
            {GST_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`so-item-rate-${item.key}`}>GST Rate</label>
          <select id={`so-item-rate-${item.key}`} value={item.gst_rate} onChange={field('gst_rate')} disabled={!item.is_taxable}>
            {GST_RATES.map((rate) => <option key={rate} value={String(rate)}>{rate}%</option>)}
            <option value="custom">Custom</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor={`so-item-tax-${item.key}`}>Tax Amount</label>
          <input
            id={`so-item-tax-${item.key}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={item.tax_amount}
            onChange={field('tax_amount')}
            disabled={!item.is_taxable || item.gst_rate !== 'custom'}
            placeholder="0.00"
          />
        </div>
      </div>

      {item.expanded && (
        <div className="so-item-grid so-item-extra">
          <div className="field">
            <label htmlFor={`so-item-short-${item.key}`}>Short Name</label>
            <input id={`so-item-short-${item.key}`} value={item.short_name} onChange={field('short_name')} />
          </div>

          <div className="field">
            <label htmlFor={`so-item-label-${item.key}`}>Label</label>
            <input id={`so-item-label-${item.key}`} value={item.label} onChange={field('label')} />
          </div>

          <div className="field">
            <label htmlFor={`so-item-ref-${item.key}`}>Reference Type</label>
            <input id={`so-item-ref-${item.key}`} value={item.reference_type} onChange={field('reference_type')} />
          </div>

          <div className="field">
            <label htmlFor={`so-item-invoice-${item.key}`}>Invoice Number</label>
            <input id={`so-item-invoice-${item.key}`} value={item.invoice_number} onChange={field('invoice_number')} />
          </div>

          <div className="field">
            <label htmlFor={`so-item-courier-${item.key}`}>Document Courier</label>
            <input id={`so-item-courier-${item.key}`} value={item.document_courier} onChange={field('document_courier')} />
          </div>

          <div className="field">
            <label htmlFor={`so-item-courier-status-${item.key}`}>Courier Status</label>
            <select id={`so-item-courier-status-${item.key}`} value={item.courier_status} onChange={field('courier_status')}>
              <option value="">—</option>
              {SO_COURIER_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor={`so-item-color-${item.key}`}>Colour</label>
            <select id={`so-item-color-${item.key}`} value={item.document_color} onChange={field('document_color')}>
              {SO_COLOR_OPTIONS.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="field so-check-field">
            <label>Audit</label>
            <button
              type="button"
              className="so-check"
              onClick={() => onChange(index, 'self_audit_completed', !item.self_audit_completed)}
              aria-pressed={item.self_audit_completed}
            >
              <span className={`checkbox-button ${item.self_audit_completed ? 'checked' : ''}`}>
                {item.self_audit_completed ? <Icon name="check" size={13} /> : null}
              </span>
              Self audit done
            </button>
          </div>

          <div className="field field-wide">
            <label htmlFor={`so-item-file-${item.key}`}>Attachment URL</label>
            <input id={`so-item-file-${item.key}`} type="url" value={item.file_url} onChange={field('file_url')} placeholder="https://…" />
          </div>

          <div className="field field-wide">
            <label htmlFor={`so-item-note-${item.key}`}>Note</label>
            <textarea id={`so-item-note-${item.key}`} rows="2" value={item.document_note} onChange={field('document_note')} />
          </div>
        </div>
      )}

      <div className="so-item-foot">
        <span>Taxable <strong className="mono-cell">{formatMoney(amounts.taxable_amount)}</strong></span>
        <span>Tax <strong className="mono-cell">{formatMoney(amounts.tax_amount)}</strong></span>
        <span className="so-item-foot-gst">{breakdown || (item.is_taxable ? 'No GST yet' : 'Not taxable')}</span>
        <span className="so-item-foot-total">After tax <strong className="mono-cell">{formatMoney(amounts.after_tax_amount)}</strong></span>
      </div>
    </div>
  )
}

function SalesOrderFormModal({ order, session, facets, onClose, onSaved }) {
  const isEdit = Boolean(order?.id)

  const [form, setForm] = useState(() => (isEdit ? salesOrderToForm(order) : blankSalesOrderForm()))
  // Existing rows key off their database id, new ones off a counter, so the two
  // can never collide while a row is being added and removed.
  const keyRef = useRef(1)
  const [items, setItems] = useState(() => (isEdit ? [] : [blankSalesOrderItem('item-1')]))
  const [removedItemIds, setRemovedItemIds] = useState([])
  const [itemsLoading, setItemsLoading] = useState(isEdit)
  const [clients, setClients] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function nextKey() {
    keyRef.current += 1
    return `item-${keyRef.current}`
  }

  useEffect(() => {
    let cancelled = false
    async function loadClients() {
      const { data, error: fetchError } = await supabase
        .from('clients')
        .select('company_name,contact_person')
        .order('company_name', { ascending: true })
        .limit(1000)
      if (cancelled || fetchError) return
      setClients(data || [])
    }
    loadClients()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!isEdit) return undefined
    let cancelled = false

    async function loadItems() {
      setItemsLoading(true)
      const { data, error: fetchError } = await supabase
        .from(SALES_ORDER_ITEM_TABLE)
        .select('*')
        .eq('sales_order_id', order.id)
        .order('id', { ascending: true })
      if (cancelled) return

      if (fetchError) {
        setError(fetchError.message)
        setItems([blankSalesOrderItem(nextKey())])
      } else {
        const rows = (data || []).map((row) => salesOrderItemToForm(row, `existing-${row.id}`))
        setItems(rows.length > 0 ? rows : [blankSalesOrderItem(nextKey())])
      }
      setRemovedItemIds([])
      setItemsLoading(false)
    }

    loadItems()
    return () => { cancelled = true }
  }, [isEdit, order?.id])

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  // Picking a client fills both columns the parent stores: the company name and
  // that client's contact person. The contact stays editable afterwards, since
  // one client can have a different signatory per order.
  function selectClient(companyName) {
    const client = clients.find((row) => row.company_name === companyName)
    setForm((current) => ({
      ...current,
      company: companyName,
      order_client_fullname: client?.contact_person || current.order_client_fullname,
    }))
  }

  function changeItem(index, name, value) {
    setItems((current) => current.map((item, position) => (position === index ? applyItemChange(item, name, value) : item)))
  }

  function toggleItem(index) {
    setItems((current) => current.map((item, position) => (position === index ? { ...item, expanded: !item.expanded } : item)))
  }

  function addItem() {
    // The key is minted outside the updater: updaters run twice under StrictMode,
    // and bumping the counter in there would burn a key on every add.
    const blank = blankSalesOrderItem(nextKey())
    setItems((current) => [...current, blank])
  }

  function removeItem(index) {
    const removed = items[index]
    if (removed?.id) setRemovedItemIds((ids) => (ids.includes(removed.id) ? ids : [...ids, removed.id]))
    setItems((current) => current.filter((_, position) => position !== index))
  }

  const clientOptions = useMemo(() => {
    const names = clients.map((row) => row.company_name).filter(Boolean)
    // An order can name a company that is no longer in the client master; keep it
    // selectable so editing anything else does not silently rewrite the client.
    if (form.company && !names.includes(form.company)) names.unshift(form.company)
    return uniqueOptions(names.map(String))
  }, [clients, form.company])

  const orderTypeOptions = useMemo(() => uniqueOptions([...ORDER_TYPE_OPTIONS, ...(facets?.order_type || [])]), [facets])
  const orderStatusOptions = useMemo(() => uniqueOptions([...ORDER_STATUS_OPTIONS, ...(facets?.order_status || [])]), [facets])
  const purchaseStatusOptions = useMemo(() => uniqueOptions([...PURCHASE_STATUS_OPTIONS, ...(facets?.purchase_status || [])]), [facets])
  const itemTypeOptions = useMemo(() => uniqueOptions([...SO_ITEM_TYPE_OPTIONS, ...(facets?.item_type || [])]).map((option) => option.value), [facets])

  // The same function that guards the payload also produces the figures on
  // screen, so what the Summary shows is exactly what will be written — and a
  // disagreement between the two surfaces here instead of at submit time.
  const totals = useMemo(() => {
    try {
      return { ...reconcileSalesOrderTotals(items), error: '' }
    } catch (err) {
      return { sub_total: 0, tax_total: 0, total: 0, error: err.message }
    }
  }, [items])

  const campaignInvalid = Boolean(form.campaign_start_date && form.campaign_end_date && form.campaign_end_date < form.campaign_start_date)
  const duration = campaignInvalid ? null : campaignDays(form.campaign_start_date, form.campaign_end_date)
  const receiptBalance = form.payment_receipt_amount === '' ? null : round2(totals.total - toAmount(form.payment_receipt_amount))

  function validate() {
    if (!form.company.trim()) return 'Choose the client this order belongs to.'
    if (!form.order_number.trim()) return 'Enter an order number.'
    if (campaignInvalid) return 'The campaign end date must be on or after the campaign start date.'
    if (items.length === 0) return 'Add at least one order item.'
    const unnamed = items.findIndex((item) => !item.name.trim())
    if (unnamed >= 0) return `Item ${unnamed + 1} needs a name.`
    return ''
  }

  // Existing rows are updated, new rows inserted and removed rows deleted, rather
  // than clearing and re-inserting the lot: child ids are referenced elsewhere
  // (purchase_order_id, inv_id) and re-creating them would break those links.
  async function saveItems(salesOrderId) {
    if (removedItemIds.length > 0) {
      const { error: deleteError } = await supabase.from(SALES_ORDER_ITEM_TABLE).delete().in('id', removedItemIds)
      if (deleteError) throw deleteError
    }

    const stamp = new Date().toISOString()
    const existing = []
    const fresh = []
    items.forEach((item) => {
      const payload = buildSalesOrderItemPayload(item, salesOrderId)
      if (item.id) existing.push({ ...payload, id: item.id, updated_at: stamp })
      else fresh.push(payload)
    })

    if (existing.length > 0) {
      await writeRows(async (rows) => {
        for (const row of rows) {
          const { id, ...values } = row
          const { error: updateError } = await supabase.from(SALES_ORDER_ITEM_TABLE).update(values).eq('id', id)
          if (updateError) return { data: null, error: updateError }
        }
        return { data: rows, error: null }
      }, existing, SALES_ORDER_ITEM_FALLBACKS)
    }

    if (fresh.length > 0) {
      await writeRows(
        (rows) => supabase.from(SALES_ORDER_ITEM_TABLE).insert(rows).select('id'),
        fresh,
        SALES_ORDER_ITEM_FALLBACKS,
      )
    }
  }

  // `created_by_id` could be a uuid or an integer column and there is no way to
  // check from the browser, so it is stamped on its own after the order is safely
  // saved. A rejection here costs the provenance, not the order.
  async function stampCreator(salesOrderId) {
    const userId = session?.user?.id
    if (!userId) return
    const { error: stampError } = await supabase.from(SALES_ORDER_TABLE).update({ created_by_id: userId }).eq('id', salesOrderId)
    if (stampError) console.warn(`Sales order ${salesOrderId} saved, but created_by_id could not be set: ${stampError.message}`)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }

    let payloadTotals
    try {
      payloadTotals = reconcileSalesOrderTotals(items)
    } catch (err) {
      setError(err.message)
      return
    }

    setSaving(true)
    setError('')

    try {
      const payload = buildSalesOrderPayload(form, payloadTotals, session)

      if (isEdit) {
        delete payload.created_by
        payload.updated_at = new Date().toISOString()
        const saved = await writeRows(
          (rows) => supabase.from(SALES_ORDER_TABLE).update(rows[0]).eq('id', order.id).select('*').single(),
          [payload],
          SALES_ORDER_FALLBACKS,
        )
        // The parent is already committed at this point, so a failure below
        // leaves the order saved and its items partly applied. The error says so
        // and the form stays open on the same data, ready to be resubmitted.
        await saveItems(order.id)
        onSaved(saved || { ...order, ...payload })
      } else {
        const saved = await writeRows(
          (rows) => supabase.from(SALES_ORDER_TABLE).insert(rows).select('*').single(),
          [payload],
          SALES_ORDER_FALLBACKS,
        )
        if (!saved?.id) throw new Error('The sales order was created but no ID came back, so its items could not be linked to it.')

        try {
          await saveItems(saved.id)
        } catch (err) {
          // Nothing references the new order yet, so removing it is safer than
          // leaving an order behind with only some of its items.
          await supabase.from(SALES_ORDER_TABLE).delete().eq('id', saved.id)
          throw err
        }

        await stampCreator(saved.id)
        onSaved(saved)
      }
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Could not save the sales order.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card so-modal-card" onMouseDown={(event) => event.stopPropagation()}>

        <div className="modal-header">
          <div>
            <span className="drawer-kicker">SALES ORDER</span>
            <h2>{isEdit ? `Edit ${order.order_number || `order #${order.id}`}` : 'Add sales order'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={19} />
          </button>
        </div>

        {error && (
          <div className="form-error" role="alert">
            <Icon name="alert" size={17} />
            <div><strong>Could not save sales order</strong><span>{error}</span></div>
          </div>
        )}

        <form className="vendor-form so-form" onSubmit={handleSubmit}>

          {/* ── Order Info ──────────────────────────────────────────── */}
          <div className="form-section-title field-wide">Order Info</div>

          <div className="field">
            <label htmlFor="so-order-number">Order Number *</label>
            <input id="so-order-number" value={form.order_number} onChange={(event) => update('order_number', event.target.value)} required />
          </div>

          <div className="field">
            <label htmlFor="so-crm">CRM Reference ID</label>
            <input id="so-crm" value={form.crm_reference_id} onChange={(event) => update('crm_reference_id', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-unique">Unique ID</label>
            <input id="so-unique" value={form.unique_id} onChange={(event) => update('unique_id', event.target.value)} placeholder="Auto if left blank" />
          </div>

          <SearchableSelect
            label="Client"
            required
            value={form.company}
            onChange={selectClient}
            options={clientOptions}
            placeholder={clientOptions.length === 0 ? 'Loading clients…' : 'Select a client'}
            searchPlaceholder="Search clients..."
          />

          <div className="field">
            <label htmlFor="so-client-contact">Client Contact Person</label>
            <input id="so-client-contact" value={form.order_client_fullname} onChange={(event) => update('order_client_fullname', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-order-type">Order Type</label>
            <select id="so-order-type" value={form.order_type} onChange={(event) => update('order_type', event.target.value)}>
              <option value="">—</option>
              {orderTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="so-order-date">Order Date</label>
            <input id="so-order-date" type="date" value={form.order_date} onChange={(event) => update('order_date', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-invoice-date">Invoice Date</label>
            <input id="so-invoice-date" type="date" value={form.invoice_date} onChange={(event) => update('invoice_date', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-order-color">Row Colour</label>
            <select id="so-order-color" value={form.order_color} onChange={(event) => update('order_color', event.target.value)}>
              {SO_COLOR_OPTIONS.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="so-order-status">Order Status</label>
            <select id="so-order-status" value={form.order_status} onChange={(event) => update('order_status', event.target.value)}>
              <option value="">—</option>
              {orderStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="so-purchase-status">Purchase Status</label>
            <select id="so-purchase-status" value={form.purchase_status} onChange={(event) => update('purchase_status', event.target.value)}>
              <option value="">—</option>
              {purchaseStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div className="field so-check-field">
            <label>Scope</label>
            <button
              type="button"
              className="so-check"
              onClick={() => update('multi_purpose_so', !form.multi_purpose_so)}
              aria-pressed={form.multi_purpose_so}
            >
              <span className={`checkbox-button ${form.multi_purpose_so ? 'checked' : ''}`}>
                {form.multi_purpose_so ? <Icon name="check" size={13} /> : null}
              </span>
              Multi purpose SO
            </button>
          </div>

          <div className="field">
            <label htmlFor="so-approved-by">Approved By</label>
            <input id="so-approved-by" value={form.approved_by} onChange={(event) => update('approved_by', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-approved-date">Approved Date</label>
            <input id="so-approved-date" type="date" value={form.approved_date} onChange={(event) => update('approved_date', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-complete-date">Completed Date</label>
            <input id="so-complete-date" type="date" value={form.complete_date} onChange={(event) => update('complete_date', event.target.value)} />
          </div>

          {/* ── Campaign ────────────────────────────────────────────── */}
          <div className="form-section-title field-wide">Campaign</div>

          <div className="field">
            <label htmlFor="so-campaign-start">Campaign Start Date</label>
            <input id="so-campaign-start" type="date" value={form.campaign_start_date} onChange={(event) => update('campaign_start_date', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-campaign-end">Campaign End Date</label>
            <input
              id="so-campaign-end"
              type="date"
              value={form.campaign_end_date}
              min={form.campaign_start_date || undefined}
              onChange={(event) => update('campaign_end_date', event.target.value)}
              aria-invalid={campaignInvalid}
            />
          </div>

          <div className="field">
            <label>Duration</label>
            <div className={`so-readout ${campaignInvalid ? 'is-invalid' : ''}`}>
              {campaignInvalid
                ? 'End date is before the start date'
                : duration
                  ? `${duration} ${duration === 1 ? 'day' : 'days'}`
                  : 'Set both dates'}
            </div>
          </div>

          {/* ── Media / Brand ───────────────────────────────────────── */}
          <div className="form-section-title field-wide">Media / Brand</div>

          <div className="field">
            <label htmlFor="so-brand">Brand Name</label>
            <input id="so-brand" value={form.brand_name} onChange={(event) => update('brand_name', event.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="so-invoice-courier">Invoice Courier</label>
            <input id="so-invoice-courier" value={form.invoice_courier} onChange={(event) => update('invoice_courier', event.target.value)} />
          </div>

          {/* ── Order Items ─────────────────────────────────────────── */}
          <div className="form-section-title field-wide">
            Order Items
            <span className="so-item-count">{items.length}</span>
          </div>

          <div className="so-items field-wide">
            {itemsLoading ? (
              <div className="so-detail-items-state">Loading items…</div>
            ) : (
              items.map((item, index) => (
                <SalesOrderItemEditor
                  key={item.key}
                  item={item}
                  index={index}
                  onChange={changeItem}
                  onRemove={removeItem}
                  onToggle={toggleItem}
                  canRemove={items.length > 1}
                  typeOptions={itemTypeOptions}
                />
              ))
            )}

            <button type="button" className="secondary-button so-add-item" onClick={addItem}>
              <Icon name="plus" size={16} /> Add item
            </button>
          </div>

          {/* ── Summary ─────────────────────────────────────────────── */}
          <div className="form-section-title field-wide">Summary</div>

          <div className="so-summary field-wide">
            <div className="so-summary-figures">
              <div className="so-summary-cell">
                <span>Sub Total</span>
                <strong className="mono-cell">{formatMoney(totals.sub_total)}</strong>
                <small>Sum of taxable amounts</small>
              </div>
              <div className="so-summary-cell">
                <span>Tax Total</span>
                <strong className="mono-cell">{formatMoney(totals.tax_total)}</strong>
                <small>Sum of item tax</small>
              </div>
              <div className="so-summary-cell is-grand">
                <span>Total</span>
                <strong className="mono-cell">{formatMoney(totals.total)}</strong>
                <small>Sum of after-tax amounts</small>
              </div>
            </div>

            {totals.error
              ? <div className="so-summary-note is-error">{totals.error}</div>
              : <div className="so-summary-note">These three figures are written to the order exactly as shown, recalculated from the {items.length} {items.length === 1 ? 'item' : 'items'} above.</div>}
          </div>

          <div className="field">
            <label htmlFor="so-receipt">Payment Receipt Amount</label>
            <input
              id="so-receipt"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={form.payment_receipt_amount}
              onChange={(event) => update('payment_receipt_amount', event.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="field">
            <label>Balance</label>
            <div className="so-readout">{receiptBalance == null ? 'No payment recorded' : formatMoney(receiptBalance)}</div>
          </div>

          <div className="form-actions field-wide">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving || itemsLoading}>
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Sales Order'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}

function SalesOrdersPage({ session }) {
  // ── Search: `searchInput` drives the UI, `query` drives the request ──────
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')

  const [orders, setOrders] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(SO_PAGE_SIZES[0])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  // Bumping `refresh` re-runs the loader when nothing else changed — a fresh
  // object every time so React cannot bail out of an identical update.
  const [refresh, setRefresh] = useState({ key: 0, silent: false })

  const [selectedOrder, setSelectedOrder] = useState(null)
  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editingOrder, setEditingOrder] = useState(null)
  const [facets, setFacets] = useState(null)

  // Held in a ref rather than state: narrowing it happens *inside* the loader,
  // which retries immediately, so re-running the effect would only refetch what
  // the retry already has.
  const searchColumnsRef = useRef(SO_SEARCH_COLUMNS)

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchInput.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  /* ── Values already in the table ──────────────────────────────────────── */

  // `order_status`, `purchase_status` and the item `type` are open text columns,
  // so the form offers whatever this database already uses alongside this
  // module's own defaults instead of silently narrowing existing data to them.
  useEffect(() => {
    let cancelled = false

    async function loadFacets() {
      const [orderResult, itemResult] = await Promise.all([
        supabase.from(SALES_ORDER_TABLE).select('order_type,order_status,purchase_status').limit(1000),
        supabase.from(SALES_ORDER_ITEM_TABLE).select('type').limit(1000),
      ])
      if (cancelled) return

      const distinct = (rows, key) => [...new Set((rows || []).map((row) => row[key]).filter(Boolean).map(String))]
      setFacets({
        order_type: distinct(orderResult.data, 'order_type'),
        order_status: distinct(orderResult.data, 'order_status'),
        purchase_status: distinct(orderResult.data, 'purchase_status'),
        item_type: distinct(itemResult.data, 'type'),
      })
    }

    loadFacets()
    return () => { cancelled = true }
  }, [refresh.key])

  /* ── Sales order list ─────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false
    const silent = refresh.silent

    async function loadOrders() {
      if (silent) setRefreshing(true)
      else setLoading(true)
      setError('')

      const from = (page - 1) * pageSize

      function runQuery(columns) {
        const request = supabase
          .from(SALES_ORDER_TABLE)
          .select('*', { count: 'exact' })
          .order('id', { ascending: false })
          .range(from, from + pageSize - 1)
        return soSearchFilter(request, query, columns)
      }

      let result = await runQuery(searchColumnsRef.current)

      // `ilike` only applies to text columns. `company` is the one confirmed to
      // be text, so a rejected wider filter narrows to it for the rest of the
      // session rather than leaving search broken.
      if (result.error && query && isIlikeTypeError(result.error) && searchColumnsRef.current.length > 1) {
        searchColumnsRef.current = SO_SEARCH_FALLBACK_COLUMNS
        result = await runQuery(SO_SEARCH_FALLBACK_COLUMNS)
      }

      if (cancelled) return

      if (result.error) {
        setOrders([])
        setTotalCount(0)
        setError(result.error.message)
      } else {
        setOrders(result.data || [])
        setTotalCount(result.count || 0)
      }
      setLoading(false)
      setRefreshing(false)
    }

    loadOrders()
    return () => { cancelled = true }
  }, [page, pageSize, query, refresh])

  /* ── Child items for the open order ───────────────────────────────────── */

  useEffect(() => {
    const orderId = selectedOrder?.id
    if (!orderId) {
      setItems([])
      setItemsError('')
      return undefined
    }

    let cancelled = false

    async function loadItems() {
      setItemsLoading(true)
      setItemsError('')

      const { data, error: fetchError } = await supabase
        .from(SALES_ORDER_ITEM_TABLE)
        .select('*')
        .eq('sales_order_id', orderId)
        .order('id', { ascending: true })
      if (cancelled) return

      if (fetchError) {
        setItems([])
        setItemsError(fetchError.message)
      } else {
        setItems(data || [])
      }
      setItemsLoading(false)
    }

    loadItems()
    return () => { cancelled = true }
  }, [selectedOrder?.id, refresh.key])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalCount)

  const pageNumbers = useMemo(() => {
    const current = Math.min(page, totalPages)
    return [current - 2, current - 1, current, current + 1, current + 2]
      .filter((number) => number >= 1 && number <= totalPages)
  }, [page, totalPages])

  function changePage(nextPage) {
    setPage(Math.max(1, Math.min(nextPage, totalPages)))
  }

  function changePageSize(event) {
    setPageSize(Number(event.target.value))
    setPage(1)
  }

  function openAddForm() {
    setEditingOrder(null)
    setShowForm(true)
  }

  function openEditForm(order) {
    setEditingOrder(order)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingOrder(null)
  }

  // The saved row goes straight into the list so the change is visible without a
  // round trip, then a silent reload reconciles it with whatever the database
  // actually stored.
  function afterSaved(saved) {
    const wasEdit = Boolean(editingOrder?.id)
    closeForm()

    if (saved?.id) {
      setOrders((current) => (current.some((row) => row.id === saved.id)
        ? current.map((row) => (row.id === saved.id ? { ...row, ...saved } : row))
        : [saved, ...current].slice(0, pageSize)))
      setSelectedOrder((current) => (current?.id === saved.id ? { ...current, ...saved } : current))
      if (!wasEdit) setTotalCount((current) => current + 1)
    }

    setRefresh((current) => ({ key: current.key + 1, silent: Boolean(saved?.id) }))
  }

  const searchNarrowed = searchColumnsRef.current.length < SO_SEARCH_COLUMNS.length

  const emptyCopy = query
    ? 'No sales orders match this search. Try an order number, client or CRM reference.'
    : 'Add your first sales order to see it listed here.'

  return (
    <div className={`so-page ${selectedOrder ? 'has-selection' : ''}`}>
      <div className="so-main-content">
        <div className="page-header">
          <div>
            <span className="page-kicker">TRANSACTIONS</span>
            <h1>Sales Orders</h1>
            <p>{totalCount.toLocaleString()} {totalCount === 1 ? 'order' : 'orders'} in view · {pageSize} per page</p>
          </div>
          <button className="primary-button add-button" onClick={openAddForm}>
            <Icon name="plus" size={18} /> Add sales order
          </button>
        </div>

        {/* ── Search ───────────────────────────────────────────────────── */}
        <div className="vendors-toolbar">
          <div className="vendor-search">
            <span className="vendor-search-icon"><Icon name="search" size={17} /></span>
            <input
              className="vendor-search-input"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={searchNarrowed ? 'Search client company…' : 'Search order number, client or CRM reference…'}
              aria-label="Search sales orders"
              autoComplete="off"
              spellCheck="false"
            />
            {searchInput && (
              <button type="button" className="search-clear" onClick={() => setSearchInput('')} aria-label="Clear search">
                <Icon name="close" size={15} />
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="page-error" role="alert">
            <span className="page-error-icon"><Icon name="alert" size={18} /></span>
            <div>
              <strong>Could not load sales orders</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────────── */}
        <section className="table-card">
          <div className="table-topline">
            <div>
              <strong>All Sales Orders</strong>
              <span className="result-count">{totalCount.toLocaleString()} records</span>
              {refreshing && <span className="result-count">Updating…</span>}
              {query && <span className="search-state">Filtered by “{query}”</span>}
              {searchNarrowed && <span className="search-state">Searching client company only</span>}
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th className="so-total-column">Total</th>
                  <th className="actions-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: Math.min(pageSize, 10) }).map((_, index) => (
                    <tr key={`so-skeleton-${index}`}>
                      {Array.from({ length: SO_COLUMN_COUNT }).map((__, cell) => <td key={cell}><span className="skeleton skeleton-company" /></td>)}
                    </tr>
                  ))
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={SO_COLUMN_COUNT} className="empty-state">
                      <div className="empty-title">No sales orders found</div>
                      <div className="empty-copy">{emptyCopy}</div>
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => {
                    const duration = campaignDays(order.campaign_start_date, order.campaign_end_date)
                    const campaign = order.campaign_start_date || order.campaign_end_date
                      ? `${formatDate(order.campaign_start_date)} → ${formatDate(order.campaign_end_date)}`
                      : null

                    return (
                      <tr
                        key={order.id}
                        className={selectedOrder?.id === order.id ? 'is-open' : ''}
                        onDoubleClick={() => setSelectedOrder(order)}
                      >
                        <td>
                          <span className="cell-primary so-order-cell">
                            {order.order_color && <span className="so-color-dot" style={{ background: order.order_color }} aria-hidden="true" />}
                            {formatValue(order.order_number)}
                          </span>
                          <span className="cell-secondary" title={order.crm_reference_id || ''}>{formatValue(getValue(order, ['crm_reference_id', 'unique_id']))}</span>
                        </td>
                        <td>
                          <span className="cell-primary company-cell" title={order.company || ''}>{formatValue(order.company)}</span>
                          <span className="cell-secondary" title={order.order_client_fullname || ''}>{formatValue(order.order_client_fullname)}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatValue(order.order_type)}</span>
                          <span className="cell-secondary" title={order.brand_name || ''}>{formatValue(order.brand_name)}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatValue(campaign)}</span>
                          <span className="cell-secondary">{duration ? `${duration} ${duration === 1 ? 'day' : 'days'}` : '—'}</span>
                        </td>
                        <td>
                          <span className={`status-pill ${statusTone(order.order_status)}`}>
                            <span className="status-dot" />
                            {formatValue(order.order_status)}
                          </span>
                          <span className="cell-secondary">{formatValue(order.purchase_status)}</span>
                        </td>
                        <td className="so-total-column">
                          <span className="cell-primary mono-cell">{formatMoney(order.total)}</span>
                          <span className="cell-secondary mono-cell">Tax {formatMoney(order.tax_total)}</span>
                        </td>
                        <td className="actions-column">
                          <button className="row-action" onClick={() => setSelectedOrder(order)} aria-label={`Open sales order ${order.order_number || order.id}`}>
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
              <select value={pageSize} onChange={changePageSize} aria-label="Sales orders per page">
                {SO_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </div>

            <div className="pagination-meta">
              <span className="pagination-page-label">
                {totalCount === 0 ? 'No records' : <>Showing <strong>{pageStart}–{pageEnd}</strong> of {totalCount.toLocaleString()}</>}
              </span>
              <div className="pagination-buttons">
                <button onClick={() => changePage(1)} disabled={page <= 1} aria-label="First page"><Icon name="first" size={16} /></button>
                <button onClick={() => changePage(page - 1)} disabled={page <= 1} aria-label="Previous page"><Icon name="chevron" size={16} /></button>
                {pageNumbers.map((number) => <button key={number} className={number === page ? 'current' : ''} onClick={() => changePage(number)} aria-current={number === page ? 'page' : undefined}>{number}</button>)}
                <button onClick={() => changePage(page + 1)} disabled={page >= totalPages} aria-label="Next page"><Icon name="chevron" size={16} /></button>
                <button onClick={() => changePage(totalPages)} disabled={page >= totalPages} aria-label="Last page"><Icon name="last" size={16} /></button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {selectedOrder && (
        <aside className="so-side-panel">
          <SalesOrderDetails
            order={selectedOrder}
            items={items}
            itemsLoading={itemsLoading}
            itemsError={itemsError}
            onClose={() => setSelectedOrder(null)}
            onEdit={() => openEditForm(selectedOrder)}
          />
        </aside>
      )}

      {showForm && (
        <SalesOrderFormModal
          order={editingOrder}
          session={session}
          facets={facets}
          onClose={closeForm}
          onSaved={afterSaved}
        />
      )}
    </div>
  )
}

function SettingsPage({ themeMode, onThemeChange }) {
  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <span className="page-kicker">PREFERENCES</span>
          <h1>Settings</h1>
          <p>Manage your application preferences.</p>
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
          Appearance
        </h3>
        <p className="settings-card-desc">
          Choose how Dikho looks to you. Select a single theme, or sync with your system settings.
        </p>
        <div className="theme-switcher">
          <button
            className={themeMode === 'light' ? 'active' : ''}
            onClick={() => onThemeChange('light')}
          >
            <span className="theme-switcher-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </span>
            Light
          </button>
          <button
            className={themeMode === 'dark' ? 'active' : ''}
            onClick={() => onThemeChange('dark')}
          >
            <span className="theme-switcher-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </span>
            Dark
          </button>
          <button
            className={themeMode === 'system' ? 'active' : ''}
            onClick={() => onThemeChange('system')}
          >
            <span className="theme-switcher-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </span>
            System
          </button>
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          General
        </h3>
        <p className="settings-card-desc">
          More settings will be available here soon.
        </p>
      </div>
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
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('dikho-theme') || 'system')

  useEffect(() => {
    function applyTheme(mode) {
      let resolved = mode
      if (mode === 'system') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      }
      document.documentElement.dataset.theme = resolved
    }
    applyTheme(themeMode)
    if (themeMode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => applyTheme('system')
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }
  }, [themeMode])

  function handleThemeChange(mode) {
    localStorage.setItem('dikho-theme', mode)
    setThemeMode(mode)
  }

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

  // ── Public routes: bypass login entirely ─────────────────────────────
  // Anyone who visits /#/vendor-register gets the public form, no session needed.
  const [hashPath, setHashPath] = useState(() => window.location.hash)
  useEffect(() => {
    function onHashChange() { setHashPath(window.location.hash) }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  if (hashPath === '#/vendor-register') {
    return <PublicVendorForm />
  }
  // ─────────────────────────────────────────────────────────────────────

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
        onLogout={logout}
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
          </div>
        </header>

        <main className="workspace">
          {activePage === 'clients' && <ClientsPage />}
          {activePage === 'dashboard' && <PlaceholderPage title="Dashboard" />}
          {activePage === 'vendors' && <VendorsPage />}
          {activePage === 'so' && <SalesOrdersPage session={session} />}
          {activePage === 'po' && <PurchaseOrdersPage session={session} />}
          {activePage === 'invoice' && <PlaceholderPage title="Invoice Notification" />}
          {activePage === 'advance' && <PlaceholderPage title="Advance Payment Receipt" />}
          {activePage === 'receipt' && <PlaceholderPage title="Payment Receipt" />}
          {activePage === 'paymentrequest' && <PlaceholderPage title="Payment Request" />}
          {activePage === 'courier' && <PlaceholderPage title="Document Courier" />}
          {activePage === 'settings' && <SettingsPage themeMode={themeMode} onThemeChange={handleThemeChange} />}
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
export { VendorsPage as __PreviewVendorsPage }
export { SalesOrdersPage as __PreviewSalesOrdersPage }
