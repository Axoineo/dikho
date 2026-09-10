import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { City, Country, State } from 'country-state-city'
import { supabase } from '../supabase'
import { SearchableSelect } from '../App'

/* ─── Constants ────────────────────────────────────────────────────── */
const TURNSTILE_SITEKEY = '0x4AAAAAAEnxgBvSPuBu7S85'
const DRIVE_CATALOGUE_URL = 'https://drive.google.com/drive/folders/1LhjqwF2ISWLs59N2q7PUhqBHG5a47Rss?usp=drive_link'

/* ─── Cloudflare Turnstile ─────────────────────────────────────────── */
function TurnstileWidget({ onVerify, onExpire }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const stableVerify = useCallback(onVerify, [])
  const stableExpire = useCallback(onExpire, [])

  useEffect(() => {
    function init() {
      if (!window.turnstile || !containerRef.current || widgetIdRef.current != null) return
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITEKEY,
        callback: stableVerify,
        'expired-callback': stableExpire,
        theme: 'light',
        size: 'invisible',
      })
    }
    if (window.turnstile) {
      init()
    } else {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
      s.async = true; s.defer = true; s.onload = init
      document.head.appendChild(s)
    }
    return () => {
      if (widgetIdRef.current != null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch {}
        widgetIdRef.current = null
      }
    }
  }, [stableVerify, stableExpire])

  return <div ref={containerRef} />
}

/* ─── Helpers ──────────────────────────────────────────────────────── */
function FieldGroup({ label, children, hint, error }) {
  const isRequired = typeof label === 'string' && label.trim().endsWith('*')
  const cleanLabel = isRequired ? label.replace(/\s*\*\s*$/, '') : label
  
  return (
    <div className="pvf-field">
      <label className="pvf-label">
        {cleanLabel}
        {isRequired && <span style={{ color: '#e53e3e' }}> *</span>}
      </label>
      {children}
      {error && <div className="pvf-field-error">Please complete this required field.</div>}
      {hint && !error && <span className="pvf-hint">{hint}</span>}
    </div>
  )
}

function SectionTitle({ icon, title, subtitle }) {
  return (
    <div className="pvf-section-head">
      <div className="pvf-section-icon">{icon}</div>
      <div>
        <div className="pvf-section-title">{title}</div>
        {subtitle && <div className="pvf-section-subtitle">{subtitle}</div>}
      </div>
    </div>
  )
}

/* ─── Dial Code Picker ─────────────────────────────────────────────── */
function DialCodePicker({ countries, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  const cleanCode = (raw) => {
    const code = raw.startsWith('+') ? raw : `+${raw}`
    return code.includes('-') ? code.split('-')[0] : code
  }

  const selected = countries.find(c => cleanCode(c.phonecode) === value)

  const filtered = countries.filter(c => {
    const q = query.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.isoCode.toLowerCase().includes(q) || cleanCode(c.phonecode).includes(q)
  }).slice(0, 80)

  return (
    <div ref={containerRef} className="dial-picker">
      <button type="button" className="dial-picker-trigger" onClick={() => setOpen(v => !v)}>
        <span className="dial-picker-flag">{selected?.flag || '🌐'}</span>
        <span className="dial-picker-code">{value}</span>
        <svg className="dial-picker-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="dial-picker-dropdown">
          <div className="dial-picker-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search country…" autoComplete="off" />
          </div>
          <div className="dial-picker-list">
            {filtered.length === 0 ? (
              <div className="dial-picker-empty">No matches</div>
            ) : filtered.map(c => {
              const code = cleanCode(c.phonecode)
              return (
                <button type="button" key={c.isoCode}
                  className={`dial-picker-option ${code === value ? 'is-selected' : ''}`}
                  onClick={() => { onChange(code); setOpen(false) }}>
                  <span className="dial-picker-option-flag">{c.flag}</span>
                  <span className="dial-picker-option-name">{c.name}</span>
                  <span className="dial-picker-option-code">{code}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Success Screen ───────────────────────────────────────────────── */
function SuccessScreen({ companyName }) {
  return (
    <div className="pvf-success">
      <div className="pvf-success-circle">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <h2 className="pvf-success-title">Welcome to Dikho Corporate Gifting</h2>
      <p className="pvf-success-body">
        Thank you, <strong>{companyName}</strong>, for sharing your details with us.
        We've received your information successfully. Explore our curated corporate gifting
        catalogue to discover options for your team, clients and business partners.
      </p>
      <div style={{ display: 'flex', gap: '0px', justifyContent: 'center', marginTop: '24px' }}>
        <a
          href={DRIVE_CATALOGUE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="pvf-btn-submit-pill"
          style={{ marginRight: '0px' }}
        >
          Explore Corporate Gifting Catalogue
        </a>
        <a 
          href={DRIVE_CATALOGUE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="pvf-btn-submit-circle"
          style={{ zIndex: 1, position: 'relative' }}
          aria-label="Explore Catalogue"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
        </a>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN FORM
   ═══════════════════════════════════════════════════════════════════ */
export default function PublicClientWelcome() {
  const allCountries = useMemo(() =>
    Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name)), [])

  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [captchaToken, setCaptchaToken] = useState(null)
  const [submittedCompany, setSubmittedCompany] = useState('')

  const [form, setForm] = useState({
    company_name: '',
    contact_person: '',
    designation: '',
    country_dialcode: '+91',
    country_code: 'IN',
    contact: '',
    email: '',
    gstin: '',
    address_line1: '',
    address_line2: '',
    country_name: 'India',
    state: '',
    state_code: '',
    city: '',
    pincode: '',
  })

  const [zipStatus, setZipStatus] = useState(null)

  function update(key, val) { setForm(f => ({ ...f, [key]: val })) }

  // Country / state / city cascades
  const states = useMemo(() =>
    form.country_code ? State.getStatesOfCountry(form.country_code).sort((a, b) => a.name.localeCompare(b.name)) : [],
    [form.country_code])
  const cities = useMemo(() =>
    form.country_code && form.state_code
      ? City.getCitiesOfState(form.country_code, form.state_code).sort((a, b) => a.name.localeCompare(b.name))
      : [],
    [form.country_code, form.state_code])

  function handleCountryChange(code) {
    const c = allCountries.find(x => x.isoCode === code)
    const raw = c?.phonecode || ''
    const dial = raw ? ((raw.startsWith('+') ? raw : `+${raw}`).split('-')[0]) : ''
    setForm(f => ({
      ...f,
      country_code: code,
      country_name: c?.name || code,
      country_dialcode: dial,
      state: '', state_code: '', city: '', pincode: '',
    }))
    setZipStatus(null)
  }
  function handleStateChange(code) {
    const s = states.find(x => x.isoCode === code)
    setForm(f => ({ ...f, state_code: code, state: s?.name || '', city: '', pincode: '' }))
    setZipStatus(null)
  }

  // Indian PIN verification and auto-fill
  async function verifyPin(zip) {
    if (form.country_code !== 'IN' || !/^\d{6}$/.test(zip)) return
    
    setZipStatus({ type: 'checking', message: 'Fetching details…' })
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${zip}`)
      const json = await res.json()
      const offices = json?.[0]?.PostOffice || []
      
      if (!offices.length) { 
        setZipStatus({ type: 'error', message: 'PIN code not found.' })
        return 
      }
      
      const office = offices[0]
      const allStates = State.getStatesOfCountry('IN')
      const stateMatch = allStates.find(s => {
        const s1 = s.name.toLowerCase().replace(/[^a-z0-9]/g, '')
        const s2 = office.State.toLowerCase().replace(/[^a-z0-9]/g, '')
        return s1 === s2 || s1.includes(s2) || s2.includes(s1)
      })
      
      if (stateMatch) {
        const citiesInState = City.getCitiesOfState('IN', stateMatch.isoCode)
        const d2 = office.District.toLowerCase().replace(/[^a-z0-9]/g, '')
        
        let cityMatch = citiesInState.find(c => {
          const cName = c.name.toLowerCase().replace(/[^a-z0-9]/g, '')
          return cName === d2 || (d2 && cName.includes(d2)) || (d2 && d2.includes(cName))
        })
        
        const cityName = cityMatch ? cityMatch.name : office.District
        
        setForm(f => ({
          ...f,
          state_code: stateMatch.isoCode,
          state: stateMatch.name,
          city: cityName
        }))
        
        setZipStatus({ type: 'success', message: `${cityName}, ${stateMatch.name}` })
      } else {
        setZipStatus({ type: 'warning', message: `Please select State manually.` })
      }
    } catch {
      setZipStatus({ type: 'warning', message: 'Auto-fetch unavailable. Please select manually.' })
    }
  }

  const [fieldError, setFieldError] = useState('')

  // Validation
  function validate() {
    if (!form.company_name.trim()) return { field: 'company_name', message: 'Company name is required.' }
    if (!form.contact_person.trim()) return { field: 'contact_person', message: 'Contact person name is required.' }
    if (!form.contact.trim()) return { field: 'contact', message: 'Mobile number is required.' }
    if (form.country_code === 'IN' && form.contact.replace(/\D/g, '').length !== 10) {
      return { field: 'contact', message: 'Please enter a valid 10-digit mobile number.' }
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return { field: 'email', message: 'Please enter a valid email address.' }
    }
    if (!form.city.trim()) return { field: 'city', message: 'City / Location is required.' }
    if (!captchaToken) return { field: 'captcha', message: 'Please complete the security check.' }
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setFieldError('')
    setError('')
    
    const err = validate()
    if (err) { 
      setError(err.message)
      setFieldError(err.field)
      
      // Auto-focus the field with the error
      setTimeout(() => {
        const el = document.querySelector(`[name="${err.field}"]`) || document.getElementById(`field-${err.field}`)
        if (el && el.focus) {
          el.focus()
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 50)
      return 
    }
    setSaving(true)

    try {
      const ph = form.contact.replace(/\D/g, '')
      const payload = {
        company_name: form.company_name.trim(),
        contact_person: form.contact_person.trim(),
        designation: null,
        country_dialcode: form.country_dialcode,
        contact: ph ? Number(ph) : null,
        email: form.email.trim() || null,
        gstin: null,
        address_line1: '-',
        address_line2: null,
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        country: form.country_name,
        status: 0, // Pending review
      }

      const { error: insertError } = await supabase.from('clients').insert([payload]).select('id').single()
      if (insertError) throw insertError

      setSubmittedCompany(form.company_name.trim())
      setSubmitted(true)
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Submission failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Options
  const countryOptions = useMemo(() => allCountries.map(c => ({ value: c.isoCode, label: `${c.name} (${c.isoCode})` })), [allCountries])
  const stateOptions = useMemo(() => states.map(s => ({ value: s.isoCode, label: s.name })), [states])
  const cityOptions = useMemo(() => cities.map(c => ({ value: c.name, label: c.name })), [cities])

  // ─── Rendered pages ────────────────────────────────────────────────────

  if (submitted) return (
    <div className="pvf-shell">
      <header className="pvf-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#718096', letterSpacing: '0.05em' }}>POWERED BY</span>
          <a href="https://dikho.in" title="Visit Dikho.in" className="pvf-logo-link">
            <img src="/dikho-logo.png" alt="Dikho" className="pvf-logo" />
          </a>
        </div>
      </header>
      <main className="pvf-main">
        <div className="pvf-card">
          <SuccessScreen companyName={submittedCompany} />
        </div>
      </main>
      <footer className="pvf-footer" style={{ padding: '16px', textAlign: 'center', fontSize: '0.9rem' }}>
        <div className="pvf-footer-copy" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M14.83 14.83a4 4 0 1 1 0-5.66"/></svg>
            <span>2026 <strong>Dikho</strong>. All Rights Reserved.</span>
          </span>
          <span style={{ color: '#cbd5e1' }}>|</span>
          <a href="https://www.facebook.com/people/Dikho/61592320121301/?rdid=KWCjR7Wc7nS3Kuim&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2F1DRPCoKmUz%2F" target="_blank" rel="noreferrer" className="pvf-footer-link" aria-label="Facebook">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          </a>
          <a href="https://www.instagram.com/dikho0/" target="_blank" rel="noreferrer" className="pvf-footer-link" aria-label="Instagram">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
          </a>
          <a href="https://www.linkedin.com/company/dikhoglobalmedia/" target="_blank" rel="noreferrer" className="pvf-footer-link" aria-label="LinkedIn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
          </a>
        </div>
      </footer>
    </div>
  )

  return (
    <div className="pvf-shell">
      <header className="pvf-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#718096', letterSpacing: '0.05em' }}>POWERED BY</span>
          <a href="https://dikho.in" title="Visit Dikho.in" className="pvf-logo-link">
            <img src="/dikho-logo.png" alt="Dikho" className="pvf-logo" />
          </a>
        </div>
      </header>

      <main className="pvf-main">
        <div className="pvf-hero">
          <h1 className="pvf-hero-title">
            Welcome to Dikho <br />
            <span className="pvf-hero-italic">Corporate Gifting.</span>
          </h1>
          <p className="pvf-hero-sub">Fill the details &amp; get instant access to 60+ exclusive Corporate &amp; Festive Gifting Catalogues 2026</p>
        </div>

        {/* Step Indicator */}
        {error && (
          <div className="pvf-error" role="alert">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {error}
          </div>
        )}

        <div className="pvf-card">
          <form onSubmit={handleSubmit}>
            <div className="pvf-step-body">
              {/* ── Company Information ──────────────────────────────── */}
              <SectionTitle
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>}
                title="Quick Access Form"
                subtitle="Please provide your details below to continue."
              />

              <div className="pvf-grid">
                <FieldGroup label="Company name *" error={fieldError === 'company_name'}>
                  <input name="company_name" id="field-company_name" className={`pvf-input ${fieldError === 'company_name' ? 'has-error' : ''}`} value={form.company_name} onChange={e => { update('company_name', e.target.value); setFieldError('') }} required />
                </FieldGroup>

                <FieldGroup label="Your Name *" error={fieldError === 'contact_person'}>
                  <input name="contact_person" id="field-contact_person" className={`pvf-input ${fieldError === 'contact_person' ? 'has-error' : ''}`} value={form.contact_person} onChange={e => { update('contact_person', e.target.value); setFieldError('') }} required />
                </FieldGroup>

                <FieldGroup label="Mobile number *" error={fieldError === 'contact'}>
                  <div className={`pvf-phone ${fieldError === 'contact' ? 'has-error' : ''}`}>
                    <DialCodePicker countries={allCountries} value={form.country_dialcode} onChange={val => update('country_dialcode', val)} />
                    <input name="contact" id="field-contact" className={`pvf-input ${fieldError === 'contact' ? 'has-error' : ''}`} type="tel" inputMode="numeric" maxLength={10} value={form.contact}
                      onChange={e => { update('contact', e.target.value.replace(/\D/g, '').slice(0, 10)); setFieldError('') }}
                      required />
                  </div>
                </FieldGroup>

                <FieldGroup label="Email ID (optional)" error={fieldError === 'email'}>
                  <input name="email" id="field-email" className={`pvf-input ${fieldError === 'email' ? 'has-error' : ''}`} type="email" value={form.email} onChange={e => { update('email', e.target.value); setFieldError('') }} />
                </FieldGroup>

                <FieldGroup label="City / Location *" error={fieldError === 'city'}>
                  <input name="city" id="field-city" className={`pvf-input ${fieldError === 'city' ? 'has-error' : ''}`} value={form.city} onChange={e => { update('city', e.target.value); setFieldError('') }} required />
                </FieldGroup>
              </div>

              <div>
                <TurnstileWidget
                  onVerify={t => { setCaptchaToken(t); setError('') }}
                  onExpire={() => setCaptchaToken(null)}
                />
              </div>
            </div>

            {/* Navigation */}
            <div className="pvf-nav" style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
              <div style={{ display: 'flex', gap: '0px' }}>
                <button type="submit" className="pvf-btn-submit-pill" disabled={saving || !captchaToken} style={{ marginRight: '0px' }}>
                  {saving ? 'Submitting…' : 'Explore The Collection'}
                </button>
                <button type="submit" className="pvf-btn-submit-circle" disabled={saving || !captchaToken} aria-label="Explore The Collection" style={{ zIndex: 1, position: 'relative' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                </button>
              </div>
              <div className="pvf-privacy-policy" style={{ textAlign: 'center', fontSize: '0.8rem', color: '#718096', lineHeight: 1.5, maxWidth: '400px' }}>
                🔒 <strong>Corporate Privacy Assured:</strong><br/>
                At Dikho, we value your time and confidentiality. Your information is strictly used for official communication only.
              </div>
            </div>
          </form>
        </div>
      </main>

      {/* Floating Contact Pill */}
      <div className="pvf-contact-pill">
        <a href="mailto:inquiry@dikho.in" className="pvf-contact-item">
          <span className="pvf-contact-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </span>
          inquiry@dikho.in
        </a>
        <div className="pvf-contact-divider" />
        <a href="tel:+918866008292" className="pvf-contact-item">
          <span className="pvf-contact-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </span>
          +91 886600 8292
        </a>
      </div>

      <footer className="pvf-footer" style={{ padding: '16px', textAlign: 'center', fontSize: '0.9rem' }}>
        <div className="pvf-footer-copy" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M14.83 14.83a4 4 0 1 1 0-5.66"/></svg>
            <span>2026 <strong>Dikho</strong>. All Rights Reserved.</span>
          </span>
          <span style={{ color: '#cbd5e1' }}>|</span>
          <a href="https://www.facebook.com/people/Dikho/61592320121301/?rdid=KWCjR7Wc7nS3Kuim&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2F1DRPCoKmUz%2F" target="_blank" rel="noreferrer" className="pvf-footer-link" aria-label="Facebook">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          </a>
          <a href="https://www.instagram.com/dikho0/" target="_blank" rel="noreferrer" className="pvf-footer-link" aria-label="Instagram">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
          </a>
          <a href="https://www.linkedin.com/company/dikhoglobalmedia/" target="_blank" rel="noreferrer" className="pvf-footer-link" aria-label="LinkedIn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
          </a>
        </div>
      </footer>
    </div>
  )
}
