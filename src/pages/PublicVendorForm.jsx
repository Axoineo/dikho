import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { City, Country, State } from 'country-state-city'
import { supabase } from '../supabase'
import { SearchableSelect, Icon } from '../App'

/* ─── Cloudflare Turnstile ──────────────────────────────────────────────
   Get your free sitekey: https://dash.cloudflare.com/?to=/:account/turnstile
   The key below is the always-pass TEST key. Replace with your real one.
────────────────────────────────────────────────────────────────────── */
const TURNSTILE_SITEKEY = '0x4AAAAAAEnxgBvSPuBu7S85'

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

/* ─── Step definitions ─────────────────────────────────────────────── */
const STEPS = [
  { id: 'basic',       label: 'Basic Info'   },
  { id: 'tax',         label: 'Tax & Bank'   },
  { id: 'address',     label: 'Address'      },
  { id: 'documents',   label: 'Documents'    },
]

/* ─── Helpers ──────────────────────────────────────────────────────── */
const allowedDocTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

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

/* ─── Success screen ───────────────────────────────────────────────── */
function SuccessScreen() {
  return (
    <div className="pvf-success">
      <div className="pvf-success-circle">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <h2 className="pvf-success-title">Registration submitted!</h2>
      <p className="pvf-success-body">Thank you for registering. Our team will review your details and reach out to you soon.</p>
      <p className="pvf-success-note">You may close this tab.</p>
    </div>
  )
}

/* ─── Step indicator ───────────────────────────────────────────────── */
function StepBar({ current }) {
  return (
    <div className="pvf-steps">
      {STEPS.map((step, i) => {
        const idx = STEPS.findIndex(s => s.id === current)
        const done = i < idx
        const active = i === idx
        return (
          <div key={step.id} className={`pvf-step ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}`}>
            <div className="pvf-step-circle">
              {done ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              ) : (
                <span>{i + 1}</span>
              )}
            </div>
            <span className="pvf-step-label">{step.label}</span>
            {i < STEPS.length - 1 && <div className="pvf-step-line" />}
          </div>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN FORM
   ═══════════════════════════════════════════════════════════════════ */
export default function PublicVendorForm() {
  const allCountries = useMemo(() =>
    Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name)), [])

  const [step, setStep] = useState('basic')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [captchaToken, setCaptchaToken] = useState(null)

  const [form, setForm] = useState({
    company_name: '',
    vendor_type: 'Organization',
    alias: '',
    contact_person: '',
    email: '',
    country_dialcode: '+91',
    country_code: 'IN',
    contact: '',
    media_id: '',
    sub_media_id: '',
    payment_term_value: '',
    payment_term_type: 'Invoice Date',
    registration: '',
    gstin: '',
    gstin_date: '',
    pan_number: '',
    tds_percentage: '',
    tds_section: '',
    vendor_bank_name: '',
    vendor_ifsc_code: '',
    vendor_account_number: '',
    vendor_confirm_account_number: '',
    country_name: 'India',
    state: '',
    state_code: '',
    city: '',
    zipcode: '',
    address: '',
  })

  const [mediaOptions, setMediaOptions] = useState([])
  const [subMediaOptions, setSubMediaOptions] = useState([])
  const [mediaLoading, setMediaLoading] = useState(true)
  const [subMediaLoading, setSubMediaLoading] = useState(false)
  const [mediaError, setMediaError] = useState('')

  const [documentFile, setDocumentFile] = useState(null)
  const [dragActive, setDragActive] = useState(false)
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
    setForm(f => ({
      ...f,
      country_code: code,
      country_name: c?.name || code,
      country_dialcode: c?.phonecode ? `+${c.phonecode}` : '',
      state: '', state_code: '', city: '', zipcode: '',
    }))
    setZipStatus(null)
  }
  function handleStateChange(code) {
    const s = states.find(x => x.isoCode === code)
    setForm(f => ({ ...f, state_code: code, state: s?.name || '', city: '', zipcode: '' }))
    setZipStatus(null)
  }

  // Load media
  useEffect(() => {
    setMediaLoading(true)
    setMediaError('')
    supabase.from('media').select('id,name').order('name', { ascending: true })
      .then(({ data, error: err }) => {
        if (err) {
          setMediaError('Could not load media options. Please refresh the page.')
        } else {
          setMediaOptions(data || [])
        }
        setMediaLoading(false)
      })
  }, [])

  // Load sub-media
  useEffect(() => {
    if (!form.media_id) { setSubMediaOptions([]); return }
    setSubMediaLoading(true)
    supabase.from('sub_media').select('id,name,media_id').eq('media_id', form.media_id).order('name', { ascending: true })
      .then(({ data }) => { setSubMediaOptions(data || []); setSubMediaLoading(false) })
  }, [form.media_id])

  // Document file
  function chooseFile(file) {
    if (!file) return
    if (!allowedDocTypes.includes(file.type)) { setError('File must be PDF, JPG, PNG or WEBP.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('File must be smaller than 10 MB.'); return }
    setError('')
    setDocumentFile(file)
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

  // Validation per step
  function validateStep(s) {
    if (s === 'basic') {
      if (!form.company_name.trim()) return 'Company name is required.'
      if (!form.media_id) return 'Please select a media type.'
      if (!form.sub_media_id) return 'Please select a sub media type.'
      return ''
    }
    if (s === 'address') {
      if (!form.state.trim()) return 'State is required.'
      if (!form.city.trim()) return 'City is required.'
      if (!form.address.trim()) return 'Address is required.'
      if (zipStatus?.type === 'error') return zipStatus.message
      return ''
    }
    if (s === 'documents') {
      if (!captchaToken) return 'Please complete the security check.'
      if (form.vendor_account_number && form.vendor_account_number !== form.vendor_confirm_account_number) {
        return 'Bank account numbers do not match.'
      }
      return ''
    }
    return ''
  }

  function goNext() {
    const idx = STEPS.findIndex(s => s.id === step)
    const err = validateStep(step)
    if (err) { setError(err); return }
    setError('')
    setStep(STEPS[idx + 1].id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function goBack() {
    const idx = STEPS.findIndex(s => s.id === step)
    setError('')
    setStep(STEPS[idx - 1].id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const err = validateStep('documents')
    if (err) { setError(err); return }
    setSaving(true); setError('')

    try {
      const ph = form.contact.replace(/\D/g, '')
      const payload = {
        alias: form.alias.trim() || null,
        contact_person: form.contact_person.trim() || null,
        company_name: form.company_name.trim(),
        gstin: form.gstin.trim().toUpperCase() || null,
        gstin_date: form.gstin_date || null,
        payment_term_type: form.payment_term_type,
        payment_term_value: form.payment_term_value === '' ? null : Number(form.payment_term_value),
        vendor_type: form.vendor_type,
        country_dialcode: form.country_dialcode,
        country_code: form.country_code,
        contact: ph ? Number(ph) : null,
        email: form.email.trim() || null,
        media_id: Number(form.media_id),
        sub_media_id: Number(form.sub_media_id),
        registration: form.registration || null,
        pan_number: form.pan_number.trim().toUpperCase() || null,
        opening_balance: 0,
        tds_percentage: form.tds_percentage === '' ? null : Number(form.tds_percentage),
        tds_section: form.tds_section.trim() || null,
        vendor_bank_name: form.vendor_bank_name.trim() || null,
        vendor_ifsc_code: form.vendor_ifsc_code.trim().toUpperCase() || null,
        vendor_account_number: form.vendor_account_number.trim() || null,
        vendor_confirm_account_number: form.vendor_confirm_account_number.trim() || null,
        vendor_document_file_name: documentFile?.name || null,
        status: 0, // Pending approval
      }

      const { data: vendor, error: vErr } = await supabase.from('vendors').insert([payload]).select('id').single()
      if (vErr) throw vErr
      if (!vendor?.id) throw new Error('Vendor created but no ID returned.')

      const { error: aErr } = await supabase.from('vendor_addresses').insert([{
        vendor_id: vendor.id,
        address: form.address.trim(),
        country: form.country_name,
        country_code: form.country_code,
        state: form.state.trim(),
        city: form.city.trim(),
        zipcode: form.zipcode.trim() || null,
        is_default: true,
      }])
      if (aErr) {
        await supabase.from('vendors').delete().eq('id', vendor.id)
        throw aErr
      }

      if (documentFile) {
        const safe = documentFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `vendors_documents/${vendor.id}/${Date.now()}-${safe}`
        const { error: upErr } = await supabase.storage.from('Dikho').upload(path, documentFile, {
          cacheControl: '3600', upsert: false, contentType: documentFile.type || 'application/octet-stream',
        })
        if (!upErr) {
          await supabase.from('vendors').update({ vendor_document_file_path: path, vendor_document_file_name: documentFile.name }).eq('id', vendor.id)
        }
      }

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
          <SuccessScreen />
        </div>
      </main>
    </div>
  )

  return (
    <div className="pvf-shell">
      <header className="pvf-topbar">
        <img src="/dikho-logo.png" alt="Dikho" className="pvf-logo" />
        <div className="pvf-topbar-text">
          <div className="pvf-topbar-title">Vendor Registration</div>
          <div className="pvf-topbar-sub">Fill in your details — our team will review and onboard you</div>
        </div>
      </header>

      <main className="pvf-main">
        <StepBar current={step} />

        {/* Error banner */}
        {error && (
          <div className="pvf-error" role="alert">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {error}
          </div>
        )}

        <div className="pvf-card">
          <form onSubmit={handleSubmit}>

            {/* ══ STEP 1: Basic Info ═════════════════════════════════ */}
            {step === 'basic' && (
              <div className="pvf-step-body">
                <SectionTitle
                  icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                  title="Basic Information"
                  subtitle="Tell us about your business"
                />

                <div className="pvf-grid">
                  <FieldGroup label="Company Name *">
                    <input className="pvf-input" value={form.company_name} onChange={e => update('company_name', e.target.value)} placeholder="e.g. Acme Advertising Ltd." required />
                  </FieldGroup>

                  <FieldGroup label="Vendor Type *">
                    <div className="pvf-type-cards">
                      {['Individual', 'Organization'].map(t => (
                        <label key={t} className={`pvf-type-card ${form.vendor_type === t ? 'selected' : ''}`}>
                          <input type="radio" name="pvf-type" value={t} checked={form.vendor_type === t} onChange={() => update('vendor_type', t)} />
                          <strong>{t}</strong>
                          <small>{t === 'Individual' ? 'Person / Proprietor' : 'Company / Agency'}</small>
                        </label>
                      ))}
                    </div>
                  </FieldGroup>

                  <FieldGroup label="Alias / Trade Name">
                    <input className="pvf-input" value={form.alias} onChange={e => update('alias', e.target.value)} placeholder="Short or trade name" />
                  </FieldGroup>

                  <FieldGroup label="Contact Person">
                    <input className="pvf-input" value={form.contact_person} onChange={e => update('contact_person', e.target.value)} placeholder="Name of primary contact" />
                  </FieldGroup>

                  <FieldGroup label="Email">
                    <input className="pvf-input" type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="contact@company.com" />
                  </FieldGroup>

                  <FieldGroup label="Phone Number">
                    <div className="pvf-phone">
                      <select className="pvf-dial" value={form.country_dialcode} onChange={e => update('country_dialcode', e.target.value)}>
                        {allCountries.map(c => <option key={c.isoCode} value={`+${c.phonecode}`}>+{c.phonecode}</option>)}
                      </select>
                      <input className="pvf-input" type="tel" inputMode="numeric" maxLength={10} value={form.contact}
                        onChange={e => update('contact', e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="98765 43210" />
                    </div>
                  </FieldGroup>
                </div>

                <div className="pvf-divider" />

                <SectionTitle
                  icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>}
                  title="Media Classification"
                  subtitle="Which media type does your business operate in?"
                />

                {mediaError && (
                  <div className="pvf-media-error">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {mediaError}
                  </div>
                )}

                <div className="pvf-grid">
                  <FieldGroup label="Media *">
                    <select
                      className="pvf-select"
                      value={form.media_id}
                      onChange={e => { update('media_id', e.target.value); update('sub_media_id', '') }}
                      required
                      disabled={mediaLoading}
                    >
                      <option value="">{mediaLoading ? 'Loading…' : '— Select Media —'}</option>
                      {mediaOptions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </FieldGroup>

                  <FieldGroup label="Sub Media *">
                    <select
                      className="pvf-select"
                      value={form.sub_media_id}
                      onChange={e => update('sub_media_id', e.target.value)}
                      required
                      disabled={!form.media_id || subMediaLoading}
                    >
                      <option value="">
                        {!form.media_id ? 'Select media first' : subMediaLoading ? 'Loading…' : '— Select Sub Media —'}
                      </option>
                      {subMediaOptions.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </FieldGroup>

                  <FieldGroup label="Payment Term (Days)">
                    <input className="pvf-input" type="number" min="0" step="1" value={form.payment_term_value}
                      onChange={e => update('payment_term_value', e.target.value)} placeholder="e.g. 30" />
                  </FieldGroup>

                  <FieldGroup label="Payment Term Type">
                    <div className="pvf-seg">
                      {['Invoice Date', 'Campaign End Date'].map(t => (
                        <button key={t} type="button" className={form.payment_term_type === t ? 'active' : ''} onClick={() => update('payment_term_type', t)}>{t}</button>
                      ))}
                    </div>
                  </FieldGroup>
                </div>
              </div>
            )}

            {/* ══ STEP 2: Tax & Bank ════════════════════════════════ */}
            {step === 'tax' && (
              <div className="pvf-step-body">
                <SectionTitle
                  icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>}
                  title="Tax Information"
                  subtitle="GST, PAN and TDS details"
                />

                <div className="pvf-grid">
                  <FieldGroup label="Registration Type">
                    <select className="pvf-select" value={form.registration} onChange={e => update('registration', e.target.value)}>
                      <option value="">— Select —</option>
                      <option>Registered</option>
                      <option>Unregistered</option>
                      <option>Composition</option>
                      <option>Other</option>
                    </select>
                  </FieldGroup>

                  <FieldGroup label="GSTIN">
                    <input className="pvf-input pvf-mono" value={form.gstin} onChange={e => update('gstin', e.target.value.toUpperCase())} placeholder="27AABCU9603R1ZM" maxLength={15} />
                  </FieldGroup>

                  <FieldGroup label="GSTIN Date">
                    <input className="pvf-input" type="date" value={form.gstin_date} onChange={e => update('gstin_date', e.target.value)} />
                  </FieldGroup>

                  <FieldGroup label="PAN Number">
                    <input className="pvf-input pvf-mono" value={form.pan_number} onChange={e => update('pan_number', e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
                  </FieldGroup>

                  <FieldGroup label="TDS Percentage">
                    <div className="pvf-suffix-wrap">
                      <input className="pvf-input" type="number" min="0" max="100" step="0.01" value={form.tds_percentage} onChange={e => update('tds_percentage', e.target.value)} placeholder="0.00" />
                      <span className="pvf-suffix">%</span>
                    </div>
                  </FieldGroup>

                  <FieldGroup label="TDS Section">
                    <input className="pvf-input" value={form.tds_section} onChange={e => update('tds_section', e.target.value)} placeholder="e.g. 194C" />
                  </FieldGroup>
                </div>

                <div className="pvf-divider" />

                <SectionTitle
                  icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>}
                  title="Bank Details"
                  subtitle="For payment processing"
                />

                <div className="pvf-grid">
                  <FieldGroup label="Bank Name">
                    <input className="pvf-input" value={form.vendor_bank_name} onChange={e => update('vendor_bank_name', e.target.value)} placeholder="e.g. HDFC Bank" />
                  </FieldGroup>

                  <FieldGroup label="IFSC Code">
                    <input className="pvf-input pvf-mono" value={form.vendor_ifsc_code} onChange={e => update('vendor_ifsc_code', e.target.value.toUpperCase())} placeholder="HDFC0001234" />
                  </FieldGroup>

                  <FieldGroup label="Account Number">
                    <input className="pvf-input pvf-mono" value={form.vendor_account_number} onChange={e => update('vendor_account_number', e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Enter account number" />
                  </FieldGroup>

                  <FieldGroup label="Confirm Account Number">
                    <input className="pvf-input pvf-mono" value={form.vendor_confirm_account_number} onChange={e => update('vendor_confirm_account_number', e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Re-enter to confirm" />
                    {form.vendor_account_number && form.vendor_confirm_account_number &&
                      form.vendor_account_number !== form.vendor_confirm_account_number && (
                      <span className="pvf-hint pvf-hint-error">Account numbers do not match</span>
                    )}
                  </FieldGroup>
                </div>
              </div>
            )}

            {/* ══ STEP 3: Address ═══════════════════════════════════ */}
            {step === 'address' && (
              <div className="pvf-step-body">
                <SectionTitle
                  icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>}
                  title="Business Address"
                  subtitle="Your primary operating address"
                />

                <div className="pvf-grid">
                  <SearchableSelect label="Country *" value={form.country_code} onChange={handleCountryChange}
                    options={countryOptions} placeholder="Select country" searchPlaceholder="Search countries…" required />

                  <SearchableSelect label="State *" value={form.state_code} onChange={handleStateChange}
                    options={stateOptions}
                    placeholder={!form.country_code ? 'Select country first' : stateOptions.length ? 'Select state' : 'No states available'}
                    searchPlaceholder="Search states…"
                    disabled={!form.country_code || !states.length} required />

                  <SearchableSelect label="City *" value={form.city}
                    onChange={val => { update('city', val); setZipStatus(null) }}
                    options={cityOptions}
                    placeholder={!form.state_code ? 'Select state first' : cityOptions.length ? 'Select city' : 'No cities available'}
                    searchPlaceholder="Search cities…"
                    disabled={!form.state_code || !cities.length} required />

                  <FieldGroup label="Zipcode / PIN">
                    <input className="pvf-input" value={form.zipcode}
                      onChange={e => {
                        const raw = e.target.value
                        const val = form.country_code === 'IN'
                          ? raw.replace(/\D/g, '').slice(0, 6)
                          : raw.replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 10)
                        update('zipcode', val)
                        setZipStatus(null)
                      }}
                      onBlur={() => verifyPin(form.zipcode)}
                      inputMode={form.country_code === 'IN' ? 'numeric' : 'text'}
                      placeholder={form.country_code === 'IN' ? '380001' : 'Postal code'} />
                    {zipStatus && (
                      <span className={`pvf-hint ${zipStatus.type === 'success' ? 'pvf-hint-ok' : zipStatus.type === 'error' ? 'pvf-hint-error' : 'pvf-hint-warn'}`}>
                        {zipStatus.message}
                      </span>
                    )}
                  </FieldGroup>

                  <FieldGroup label="Street Address *" hint="Do not include State, City or Zipcode here">
                    <textarea className="pvf-input pvf-textarea" rows={3} value={form.address}
                      onChange={e => update('address', e.target.value)}
                      placeholder="Building, street, area, landmark…" required />
                  </FieldGroup>
                </div>
              </div>
            )}

            {/* ══ STEP 4: Documents & Submit ═══════════════════════ */}
            {step === 'documents' && (
              <div className="pvf-step-body">
                <SectionTitle
                  icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
                  title="Vendor Document"
                  subtitle="Upload your GST certificate, PAN card or any relevant document (optional)"
                />

                <div
                  className={`pvf-dropzone ${documentFile ? 'has-file' : ''} ${dragActive ? 'is-dragging' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragActive(true) }}
                  onDragEnter={e => { e.preventDefault(); setDragActive(true) }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={e => { e.preventDefault(); setDragActive(false); chooseFile(e.dataTransfer?.files?.[0]) }}
                  onClick={() => { if (!documentFile) document.getElementById('pvf-file')?.click() }}
                >
                  <input id="pvf-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                    onChange={e => { chooseFile(e.target.files?.[0]); e.target.value = '' }} />

                  {documentFile ? (
                    <>
                      <div className="pvf-drop-icon pvf-drop-icon-ok">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      </div>
                      <div className="pvf-drop-text">
                        <strong>{documentFile.name}</strong>
                        <small>{(documentFile.size / 1024 / 1024).toFixed(2)} MB · Ready to upload</small>
                      </div>
                      <div className="pvf-drop-actions" onClick={e => e.stopPropagation()}>
                        <label className="pvf-drop-btn">
                          Change
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                            onChange={e => { chooseFile(e.target.files?.[0]); e.target.value = '' }} />
                        </label>
                        <button type="button" className="pvf-drop-btn pvf-drop-btn-danger" onClick={() => setDocumentFile(null)}>Remove</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="pvf-drop-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                      </div>
                      <div className="pvf-drop-text">
                        <strong>Drag & drop a file here</strong>
                        <small>or click to browse · PDF, JPG, PNG, WEBP · Max 10 MB</small>
                      </div>
                    </>
                  )}
                </div>

                <div className="pvf-divider" />

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
                  By submitting, you agree your information will be used for vendor onboarding. Your registration will be reviewed before activation.
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="pvf-nav">
              {step !== 'basic' && (
                <button type="button" className="pvf-btn-back" onClick={goBack}>
                  ← Back
                </button>
              )}
              <div style={{ flex: 1 }} />
              {step !== 'documents' ? (
                <button type="button" className="pvf-btn-next" onClick={goNext}>
                  Continue →
                </button>
              ) : (
                <button type="submit" className="pvf-btn-submit" disabled={saving || !captchaToken}>
                  {saving ? 'Submitting…' : 'Submit Registration'}
                </button>
              )}
            </div>

          </form>
        </div>
      </main>
    </div>
  )
}
