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
function FieldGroup({ label, children, hint }) {
  return (
    <div className="pvf-field">
      <label className="pvf-label">{label}</label>
      {children}
      {hint && <span className="pvf-hint">{hint}</span>}
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
      <a
        href={DRIVE_CATALOGUE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="pvf-success-cta"
      >
        Explore Corporate Gifting Catalogue →
      </a>
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

  // Indian PIN verification
  async function verifyPin(zip) {
    if (form.country_code !== 'IN' || !/^\d{6}$/.test(zip) || !form.city) return
    setZipStatus({ type: 'checking', message: 'Verifying PIN…' })
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${zip}`)
      const json = await res.json()
      const offices = json?.[0]?.PostOffice || []
      if (!offices.length) { setZipStatus({ type: 'error', message: 'PIN code not found.' }); return }
      const sel = form.city.toLowerCase().replace(/[^a-z0-9]/g, '')
      const match = offices.some(o => {
        const n = String(o.Name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        const d = String(o.District || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        return n.includes(sel) || sel.includes(n) || d.includes(sel) || sel.includes(d)
      })
      setZipStatus(match
        ? { type: 'success', message: 'PIN code matches.' }
        : { type: 'warning', message: `PIN ${zip} may not match ${form.city} — please verify.` })
    } catch {
      setZipStatus({ type: 'warning', message: 'PIN verification unavailable. You can still continue.' })
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
    if (!form.address_line1.trim()) return { field: 'address_line1', message: 'Address line 1 is required.' }
    if (!form.state.trim()) return { field: 'state', message: 'State is required.' }
    if (!form.city.trim()) return { field: 'city', message: 'City is required.' }
    if (!form.pincode.trim()) return { field: 'pincode', message: 'Pincode is required.' }
    if (form.country_code === 'IN' && !/^\d{6}$/.test(form.pincode.trim())) {
      return { field: 'pincode', message: 'Please enter a valid 6-digit pincode.' }
    }
    if (zipStatus?.type === 'error') return { field: 'pincode', message: zipStatus.message }
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
        designation: form.designation.trim() || null,
        country_dialcode: form.country_dialcode,
        contact: ph ? Number(ph) : null,
        email: form.email.trim() || null,
        gstin: form.gstin.trim().toUpperCase() || null,
        address_line1: form.address_line1.trim(),
        address_line2: form.address_line2.trim() || null,
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
        <img src="/dikho-logo.png" alt="Dikho" className="pvf-logo" />
      </header>
      <main className="pvf-main">
        <div className="pvf-card">
          <SuccessScreen companyName={submittedCompany} />
        </div>
      </main>
    </div>
  )

  return (
    <div className="pvf-shell">
      <header className="pvf-topbar">
        <img src="/dikho-logo.png" alt="Dikho" className="pvf-logo" />
        <div className="pvf-topbar-text">
          <div className="pvf-topbar-title">Corporate Gifting</div>
          <div className="pvf-topbar-sub">Share your company details to explore our curated gifting catalogue</div>
        </div>
      </header>

      <main className="pvf-main">
        {/* Error banner */}
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
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                title="Company Information"
                subtitle="Tell us about your organisation"
              />

              <div className="pvf-grid">
                <FieldGroup label="Company Name *">
                  <input name="company_name" id="field-company_name" className={`pvf-input ${fieldError === 'company_name' ? 'has-error' : ''}`} value={form.company_name} onChange={e => { update('company_name', e.target.value); setFieldError('') }} placeholder="e.g. Acme Corporation Pvt. Ltd." required />
                </FieldGroup>

                <FieldGroup label="Contact Person *">
                  <input name="contact_person" id="field-contact_person" className={`pvf-input ${fieldError === 'contact_person' ? 'has-error' : ''}`} value={form.contact_person} onChange={e => { update('contact_person', e.target.value); setFieldError('') }} placeholder="Full name of primary contact" required />
                </FieldGroup>

                <FieldGroup label="Designation">
                  <input name="designation" id="field-designation" className={`pvf-input ${fieldError === 'designation' ? 'has-error' : ''}`} value={form.designation} onChange={e => update('designation', e.target.value)} placeholder="e.g. Procurement Manager" />
                </FieldGroup>

                <FieldGroup label="Mobile Number *">
                  <div className={`pvf-phone ${fieldError === 'contact' ? 'has-error' : ''}`}>
                    <DialCodePicker countries={allCountries} value={form.country_dialcode} onChange={val => update('country_dialcode', val)} />
                    <input name="contact" id="field-contact" className={`pvf-input ${fieldError === 'contact' ? 'has-error' : ''}`} type="tel" inputMode="numeric" maxLength={10} value={form.contact}
                      onChange={e => { update('contact', e.target.value.replace(/\D/g, '').slice(0, 10)); setFieldError('') }}
                      placeholder="98765 43210" required />
                  </div>
                </FieldGroup>

                <FieldGroup label="Email">
                  <input name="email" id="field-email" className={`pvf-input ${fieldError === 'email' ? 'has-error' : ''}`} type="email" value={form.email} onChange={e => { update('email', e.target.value); setFieldError('') }} placeholder="contact@company.com" />
                </FieldGroup>

                <FieldGroup label="GST Number">
                  <input name="gstin" id="field-gstin" className={`pvf-input pvf-mono ${fieldError === 'gstin' ? 'has-error' : ''}`} value={form.gstin} onChange={e => { update('gstin', e.target.value.toUpperCase()); setFieldError('') }} placeholder="27AABCU9603R1ZM" maxLength={15} />
                </FieldGroup>
              </div>

              <div className="pvf-divider" />

              {/* ── Address ──────────────────────────────────────────── */}
              <SectionTitle
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>}
                title="Business Address"
                subtitle="Your company's registered or office address"
              />

              <div className="pvf-grid">
                <FieldGroup label="Address Line 1 *">
                  <input name="address_line1" id="field-address_line1" className={`pvf-input ${fieldError === 'address_line1' ? 'has-error' : ''}`} value={form.address_line1} onChange={e => { update('address_line1', e.target.value); setFieldError('') }} placeholder="Building, street, area…" required />
                </FieldGroup>

                <FieldGroup label="Address Line 2">
                  <input name="address_line2" id="field-address_line2" className={`pvf-input ${fieldError === 'address_line2' ? 'has-error' : ''}`} value={form.address_line2} onChange={e => update('address_line2', e.target.value)} placeholder="Floor, landmark (optional)" />
                </FieldGroup>

                <SearchableSelect label="Country" value={form.country_code} onChange={c => { handleCountryChange(c); setFieldError('') }}
                  options={countryOptions} placeholder="Select country" searchPlaceholder="Search countries…" hasError={fieldError === 'country_code'} />

                <SearchableSelect label="State *" value={form.state_code} onChange={s => { handleStateChange(s); setFieldError('') }}
                  options={stateOptions}
                  placeholder={!form.country_code ? 'Select country first' : stateOptions.length ? 'Select state' : 'No states available'}
                  searchPlaceholder="Search states…"
                  disabled={!form.country_code || !states.length} required hasError={fieldError === 'state'} />

                <SearchableSelect label="City *" value={form.city}
                  onChange={val => { update('city', val); setZipStatus(null); setFieldError('') }}
                  options={cityOptions}
                  placeholder={!form.state_code ? 'Select state first' : cityOptions.length ? 'Select city' : 'No cities available'}
                  searchPlaceholder="Search cities…"
                  disabled={!form.state_code || !cities.length} required hasError={fieldError === 'city'} />

                <FieldGroup label="Pincode *">
                  <input name="pincode" id="field-pincode" className={`pvf-input ${fieldError === 'pincode' ? 'has-error' : ''}`} value={form.pincode}
                    onChange={e => {
                      const raw = e.target.value
                      const val = form.country_code === 'IN'
                        ? raw.replace(/\D/g, '').slice(0, 6)
                        : raw.replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 10)
                      update('pincode', val)
                      setZipStatus(null)
                      setFieldError('')
                    }}
                    onBlur={() => verifyPin(form.pincode)}
                    inputMode={form.country_code === 'IN' ? 'numeric' : 'text'}
                    placeholder={form.country_code === 'IN' ? '400001' : 'Postal code'} required />
                  {zipStatus && (
                    <span className={`pvf-hint ${zipStatus.type === 'success' ? 'pvf-hint-ok' : zipStatus.type === 'error' ? 'pvf-hint-error' : 'pvf-hint-warn'}`}>
                      {zipStatus.message}
                    </span>
                  )}
                </FieldGroup>
              </div>

              <div className="pvf-divider" />

              {/* ── Security Check ───────────────────────────────────── */}
              <SectionTitle
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}
                title="Security Check"
                subtitle="Please verify you're human before submitting"
              />

              <TurnstileWidget
                onVerify={t => { setCaptchaToken(t); setError('') }}
                onExpire={() => setCaptchaToken(null)}
              />

              <div className="pvf-disclaimer">
                By submitting, you agree your information will be used by Dikho for corporate gifting communications. Our team may reach out to you with gifting options and catalogues.
              </div>
            </div>

            {/* Navigation */}
            <div className="pvf-nav">
              <div style={{ flex: 1 }} />
              <button type="submit" className="pvf-btn-submit" disabled={saving || !captchaToken}>
                {saving ? 'Submitting…' : 'Submit Details'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
