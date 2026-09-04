import { useEffect, useMemo, useRef, useState } from 'react'
import { City, Country, State } from 'country-state-city'
import { supabase } from '../supabase'
import { SearchableSelect, Icon } from '../App'

/* ─────────────────────────────────────────────────────────────────────
   Cloudflare Turnstile CAPTCHA widget
   Get your free sitekey at: https://dash.cloudflare.com/?to=/:account/turnstile
   Then replace the sitekey below with your own.
   For testing, the sitekey '1x00000000000000000000AA' always passes.
───────────────────────────────────────────────────────────────────── */
const TURNSTILE_SITEKEY = '0x4AAAAAAEnxgBvSPuBu7S85' // ← replace with your real sitekey

function TurnstileWidget({ onVerify, onExpire }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)

  useEffect(() => {
    // Load the Turnstile script once
    function initWidget() {
      if (!window.turnstile || !containerRef.current) return
      if (widgetIdRef.current != null) return // already rendered
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITEKEY,
        callback: onVerify,
        'expired-callback': onExpire,
        theme: 'light',
      })
    }

    if (window.turnstile) {
      initWidget()
    } else {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
      script.async = true
      script.defer = true
      script.onload = initWidget
      document.head.appendChild(script)
    }

    return () => {
      if (widgetIdRef.current != null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch {}
        widgetIdRef.current = null
      }
    }
  }, [onVerify, onExpire])

  return <div ref={containerRef} style={{ marginTop: 8 }} />
}

/* ─── Success screen ────────────────────────────────────────────────── */
function SuccessScreen() {
  return (
    <div className="pub-success">
      <div className="pub-success-icon">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </div>
      <h2>Registration received!</h2>
      <p>Thank you for registering as a vendor. Our team will review your information and get in touch with you shortly.</p>
      <p className="pub-success-note">You can close this tab now.</p>
    </div>
  )
}

/* ─── Main public form ──────────────────────────────────────────────── */
export default function PublicVendorForm() {
  const allCountries = useMemo(() =>
    Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name)), [])

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
  const [captchaToken, setCaptchaToken] = useState(null)
  const [submitted, setSubmitted] = useState(false)

  const allowedDocTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  const maxDocSize = 10 * 1024 * 1024

  const states = useMemo(() =>
    form.country_code ? State.getStatesOfCountry(form.country_code).sort((a, b) => a.name.localeCompare(b.name)) : [],
    [form.country_code])

  const cities = useMemo(() =>
    form.country_code && form.state_code
      ? City.getCitiesOfState(form.country_code, form.state_code).sort((a, b) => a.name.localeCompare(b.name))
      : [],
    [form.country_code, form.state_code])

  // Load media on mount
  useEffect(() => {
    supabase.from('media').select('id,name').order('name', { ascending: true })
      .then(({ data }) => { setMediaOptions(data || []); setLoadingMedia(false) })
  }, [])

  // Load sub-media when media changes
  useEffect(() => {
    if (!form.media_id) { setSubMediaOptions([]); return }
    setLoadingSubMedia(true)
    supabase.from('sub_media').select('id,name,media_id').eq('media_id', form.media_id).order('name', { ascending: true })
      .then(({ data }) => { setSubMediaOptions(data || []); setLoadingSubMedia(false) })
  }, [form.media_id])

  function update(field, value) { setForm(c => ({ ...c, [field]: value })) }

  function handleCountryChange(code) {
    const country = allCountries.find(c => c.isoCode === code)
    setForm(c => ({
      ...c,
      country_code: code,
      country_name: country?.name || code,
      country_dialcode: country?.phonecode ? `+${country.phonecode}` : '',
      state: '', state_code: '', city: '', zipcode: '',
    }))
    setZipStatus(null)
  }

  function handleStateChange(code) {
    const state = states.find(s => s.isoCode === code)
    setForm(c => ({ ...c, state_code: code, state: state?.name || '', city: '', zipcode: '' }))
    setZipStatus(null)
  }

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
    chooseDocumentFile(e.dataTransfer?.files?.[0])
  }

  async function verifyIndianZip(zip) {
    if (form.country_code !== 'IN' || !/^\d{6}$/.test(zip) || !form.city) return
    setZipStatus({ type: 'checking', message: 'Checking PIN code…' })
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${zip}`)
      if (!res.ok) throw new Error()
      const result = await res.json()
      const offices = result?.[0]?.PostOffice || []
      if (!offices.length) { setZipStatus({ type: 'error', message: 'PIN code not found.' }); return }
      const selected = form.city.toLowerCase().replace(/[^a-z0-9]/g, '')
      const matches = offices.some(office => {
        const name = String(office.Name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        const district = String(office.District || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        return name.includes(selected) || selected.includes(name) || district.includes(selected) || selected.includes(district)
      })
      setZipStatus(matches
        ? { type: 'success', message: 'PIN code matches the selected city/area.' }
        : { type: 'error', message: `PIN ${zip} does not appear to match ${form.city}. Please verify.` })
    } catch {
      setZipStatus({ type: 'warning', message: 'PIN verification unavailable. You can still continue.' })
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!captchaToken) { setError('Please complete the security check before submitting.'); return }
    if (!form.company_name.trim()) { setError('Company Name is required.'); return }
    if (!form.vendor_type) { setError('Vendor Type is required.'); return }
    if (!form.media_id || !form.sub_media_id) { setError('Please select Media and Sub Media.'); return }
    if (!form.state.trim()) { setError('State is required.'); return }
    if (!form.city.trim()) { setError('City is required.'); return }
    if (!form.address.trim()) { setError('Address is required.'); return }
    if (zipStatus?.type === 'error') { setError(zipStatus.message); return }
    if (form.vendor_account_number !== form.vendor_confirm_account_number) {
      setError('Bank account numbers do not match.')
      return
    }

    setSaving(true)
    try {
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
        opening_balance: 0,
        tds_percentage: form.tds_percentage === '' ? null : Number(form.tds_percentage),
        tds_section: form.tds_section.trim() || null,
        vendor_bank_name: form.vendor_bank_name.trim() || null,
        vendor_ifsc_code: form.vendor_ifsc_code.trim().toUpperCase() || null,
        vendor_account_number: form.vendor_account_number.trim() || null,
        vendor_confirm_account_number: form.vendor_confirm_account_number.trim() || null,
        vendor_document_file_name: documentFile?.name || null,
        status: 0, // Pending approval — admin must activate in Dikho
      }

      const { data: savedVendor, error: vendorErr } = await supabase
        .from('vendors').insert([vendorPayload]).select('*').single()
      if (vendorErr) throw vendorErr
      if (!savedVendor?.id) throw new Error('Vendor created but no ID returned.')

      const { error: addrErr } = await supabase.from('vendor_addresses').insert([{
        vendor_id: savedVendor.id,
        address: form.address.trim(),
        country: form.country_name,
        country_code: form.country_code,
        state: form.state.trim(),
        city: form.city.trim(),
        zipcode: form.zipcode.trim() || null,
        is_default: true,
      }])
      if (addrErr) {
        await supabase.from('vendors').delete().eq('id', savedVendor.id)
        throw addrErr
      }

      if (documentFile) {
        const safeName = documentFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `vendors_documents/${savedVendor.id}/${Date.now()}-${safeName}`
        const { error: uploadErr } = await supabase.storage.from('Dikho').upload(path, documentFile, {
          cacheControl: '3600', upsert: false, contentType: documentFile.type || 'application/octet-stream',
        })
        if (!uploadErr) {
          await supabase.from('vendors').update({
            vendor_document_file_path: path,
            vendor_document_file_name: documentFile.name,
          }).eq('id', savedVendor.id)
        }
        // If upload fails we still consider the vendor registered — don't block submission
      }

      setSubmitted(true)
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Could not submit your registration. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const countryOptions = useMemo(() => allCountries.map(c => ({ value: c.isoCode, label: `${c.name} (${c.isoCode})` })), [allCountries])
  const stateOptions = useMemo(() => states.map(s => ({ value: s.isoCode, label: s.name })), [states])
  const cityOptions = useMemo(() => cities.map(c => ({ value: c.name, label: c.name })), [cities])
  const mediaSimple = mediaOptions.map(m => ({ value: m.id, label: m.name }))
  const subMediaSimple = subMediaOptions.map(m => ({ value: m.id, label: m.name }))

  if (submitted) return (
    <div className="pub-shell">
      <div className="pub-header">
        <img src="/dikho-logo.png" alt="Dikho" className="pub-logo" />
      </div>
      <div className="pub-card">
        <SuccessScreen />
      </div>
    </div>
  )

  return (
    <div className="pub-shell">
      <div className="pub-header">
        <img src="/dikho-logo.png" alt="Dikho" className="pub-logo" />
        <div>
          <h1 className="pub-title">Vendor Registration</h1>
          <p className="pub-subtitle">Fill in your details below. Our team will review and onboard you shortly.</p>
        </div>
      </div>

      <div className="pub-card">

        {error && (
          <div className="form-error" role="alert">
            <Icon name="alert" size={17} />
            <div><strong>Please fix the following</strong><span>{error}</span></div>
          </div>
        )}

        <form className="vendor-form so-form" onSubmit={handleSubmit}>

          {/* ── Basic Information ──────────────────────────────── */}
          <div className="form-section-title field-wide">Basic Information</div>

          <div className="field field-wide">
            <label htmlFor="pvf-company">Company Name *</label>
            <input id="pvf-company" value={form.company_name} onChange={e => update('company_name', e.target.value)} required />
          </div>

          <div className="field field-wide">
            <label>Vendor Type *</label>
            <div className="choice-cards">
              <label className={`choice-card ${form.vendor_type === 'Individual' ? 'selected' : ''}`}>
                <input type="radio" name="pvf-vendor-type" value="Individual" checked={form.vendor_type === 'Individual'} onChange={e => update('vendor_type', e.target.value)} />
                <span><strong>Individual</strong><small>Single person / proprietor</small></span>
              </label>
              <label className={`choice-card ${form.vendor_type === 'Organization' ? 'selected' : ''}`}>
                <input type="radio" name="pvf-vendor-type" value="Organization" checked={form.vendor_type === 'Organization'} onChange={e => update('vendor_type', e.target.value)} />
                <span><strong>Organization</strong><small>Company / agency / business</small></span>
              </label>
            </div>
          </div>

          <div className="field">
            <label htmlFor="pvf-alias">Alias / Trade Name</label>
            <input id="pvf-alias" value={form.alias} onChange={e => update('alias', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="pvf-contact-person">Contact Person</label>
            <input id="pvf-contact-person" value={form.contact_person} onChange={e => update('contact_person', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="pvf-email">Email</label>
            <input id="pvf-email" type="email" value={form.email} onChange={e => update('email', e.target.value)} />
          </div>

          <div className="field field-phone">
            <label htmlFor="pvf-contact">Contact No.</label>
            <div className="phone-control">
              <select className="dial-code-select" value={form.country_dialcode || '+91'} onChange={e => update('country_dialcode', e.target.value)}>
                {allCountries.map(c => (
                  <option key={c.isoCode} value={`+${c.phonecode}`}>+{c.phonecode}</option>
                ))}
              </select>
              <input id="pvf-contact" type="tel" inputMode="numeric" maxLength={10} value={form.contact}
                onChange={e => update('contact', e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="98765 43210" />
            </div>
          </div>

          {/* ── Classification & Payment ───────────────────────── */}
          <div className="form-section-title field-wide">Classification &amp; Payment</div>

          <div className="field">
            <label htmlFor="pvf-media">Media *</label>
            <select id="pvf-media" value={form.media_id}
              onChange={e => { update('media_id', e.target.value); update('sub_media_id', '') }}
              required disabled={loadingMedia}>
              <option value="">{loadingMedia ? 'Loading media…' : 'Select media'}</option>
              {mediaSimple.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="pvf-sub-media">Sub Media *</label>
            <select id="pvf-sub-media" value={form.sub_media_id}
              onChange={e => update('sub_media_id', e.target.value)}
              required disabled={!form.media_id || loadingSubMedia}>
              <option value="">{!form.media_id ? 'Select media first' : loadingSubMedia ? 'Loading…' : 'Select sub media'}</option>
              {subMediaSimple.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="pvf-pt-days">Payment Term (Days)</label>
            <input id="pvf-pt-days" type="number" min="0" step="1" value={form.payment_term_value}
              onChange={e => update('payment_term_value', e.target.value)} placeholder="e.g. 30" />
          </div>

          <div className="field field-wide">
            <label>Payment Term Type</label>
            <div className="segmented-control">
              <button type="button" className={form.payment_term_type === 'Invoice Date' ? 'active' : ''} onClick={() => update('payment_term_type', 'Invoice Date')}>Invoice Date</button>
              <button type="button" className={form.payment_term_type === 'Campaign End Date' ? 'active' : ''} onClick={() => update('payment_term_type', 'Campaign End Date')}>Campaign End Date</button>
            </div>
          </div>

          {/* ── Tax Information ────────────────────────────────── */}
          <div className="form-section-title field-wide">Tax Information</div>

          <div className="field">
            <label htmlFor="pvf-registration">Registration</label>
            <select id="pvf-registration" value={form.registration} onChange={e => update('registration', e.target.value)}>
              <option value="">Select registration</option>
              <option value="Registered">Registered</option>
              <option value="Unregistered">Unregistered</option>
              <option value="Composition">Composition</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="pvf-gstin">GSTIN</label>
            <input id="pvf-gstin" value={form.gstin} onChange={e => update('gstin', e.target.value.toUpperCase())} placeholder="e.g. 27AABCU9603R1ZM" />
          </div>

          <div className="field">
            <label htmlFor="pvf-gstin-date">GSTIN Date</label>
            <input id="pvf-gstin-date" type="date" value={form.gstin_date} onChange={e => update('gstin_date', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="pvf-pan">PAN Number</label>
            <input id="pvf-pan" value={form.pan_number} onChange={e => update('pan_number', e.target.value.toUpperCase())} />
          </div>

          <div className="field">
            <label htmlFor="pvf-tds-pct">TDS Percentage</label>
            <div className="input-with-suffix">
              <input id="pvf-tds-pct" type="number" min="0" max="100" step="0.01" value={form.tds_percentage}
                onChange={e => update('tds_percentage', e.target.value)} />
              <span>%</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="pvf-tds-section">TDS Section</label>
            <input id="pvf-tds-section" value={form.tds_section} onChange={e => update('tds_section', e.target.value)} placeholder="e.g. 194C" />
          </div>

          {/* ── Bank Details ───────────────────────────────────── */}
          <div className="form-section-title field-wide">Bank Details</div>

          <div className="field">
            <label htmlFor="pvf-bank-name">Bank Name</label>
            <input id="pvf-bank-name" value={form.vendor_bank_name} onChange={e => update('vendor_bank_name', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="pvf-ifsc">Bank IFSC Code</label>
            <input id="pvf-ifsc" value={form.vendor_ifsc_code} onChange={e => update('vendor_ifsc_code', e.target.value.toUpperCase())} />
          </div>

          <div className="field">
            <label htmlFor="pvf-acc-num">Bank Account Number</label>
            <input id="pvf-acc-num" value={form.vendor_account_number}
              onChange={e => update('vendor_account_number', e.target.value.replace(/\D/g, ''))}
              inputMode="numeric" />
          </div>

          <div className="field">
            <label htmlFor="pvf-acc-confirm">Confirm Account Number</label>
            <input id="pvf-acc-confirm" value={form.vendor_confirm_account_number}
              onChange={e => update('vendor_confirm_account_number', e.target.value.replace(/\D/g, ''))}
              inputMode="numeric" />
          </div>

          {/* ── Address ────────────────────────────────────────── */}
          <div className="form-section-title field-wide">Address</div>

          <SearchableSelect label="Country" value={form.country_code} onChange={handleCountryChange}
            options={countryOptions} placeholder="Select country" searchPlaceholder="Search countries…" required />

          <SearchableSelect label="State" value={form.state_code} onChange={handleStateChange}
            options={stateOptions}
            placeholder={!form.country_code ? 'Select country first' : stateOptions.length ? 'Select state' : 'No states available'}
            searchPlaceholder="Search states…" disabled={!form.country_code || !states.length} required />

          <SearchableSelect label="City" value={form.city} onChange={val => { update('city', val); setZipStatus(null) }}
            options={cityOptions}
            placeholder={!form.state_code ? 'Select state first' : cityOptions.length ? 'Select city' : 'No cities available'}
            searchPlaceholder="Search cities…" disabled={!form.state_code || !cities.length} required />

          <div className="field">
            <label htmlFor="pvf-zip">Zipcode / PIN</label>
            <input id="pvf-zip" value={form.zipcode}
              onChange={e => {
                const raw = e.target.value
                const val = form.country_code === 'IN'
                  ? raw.replace(/\D/g, '').slice(0, 6)
                  : raw.replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 10)
                update('zipcode', val)
                setZipStatus(null)
              }}
              onBlur={() => verifyIndianZip(form.zipcode)}
              inputMode={form.country_code === 'IN' ? 'numeric' : 'text'}
              placeholder={form.country_code === 'IN' ? '380001' : 'Postal code'} />
            {zipStatus && <div className={`zip-status ${zipStatus.type}`}>{zipStatus.message}</div>}
          </div>

          <div className="field field-wide">
            <label htmlFor="pvf-address">Address *</label>
            <textarea id="pvf-address" value={form.address} onChange={e => update('address', e.target.value)} rows="3"
              placeholder="Street address, building, area, landmark" required />
            <small className="field-help">Do not add State, City or Zipcode in this field.</small>
          </div>

          {/* ── Vendor Document ─────────────────────────────────── */}
          <div className="form-section-title field-wide">Vendor Document</div>

          <div className="field field-wide">
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="document-file-input" id="pvf-doc"
              onChange={e => { chooseDocumentFile(e.target.files?.[0]); e.target.value = '' }} />
            <div
              className={`document-dropzone ${documentFile ? 'has-file' : ''} ${dragActive ? 'drag-active' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragActive(true) }}
              onDragEnter={e => { e.preventDefault(); setDragActive(true) }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => { if (!documentFile) document.getElementById('pvf-doc')?.click() }}
            >
              <div className="document-drop-icon"><Icon name={documentFile ? 'file' : 'upload'} size={20} /></div>
              <div className="document-drop-copy">
                <strong>{documentFile ? documentFile.name : 'Upload vendor document'}</strong>
                <small>{documentFile
                  ? `${(documentFile.size / 1024 / 1024).toFixed(2)} MB · Ready to upload`
                  : 'Drag & drop or click to browse · PDF, JPG, PNG, WEBP · Max 10 MB'}</small>
              </div>
              {documentFile ? (
                <div className="document-panel-actions">
                  <label className="document-browse" style={{ position: 'relative' }}>
                    Change
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                      onChange={e => { chooseDocumentFile(e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                  <button type="button" className="document-browse" onClick={e => { e.stopPropagation(); setDocumentFile(null) }}>Remove</button>
                </div>
              ) : (
                <span className="document-browse">Browse</span>
              )}
            </div>
          </div>

          {/* ── Security Check ─────────────────────────────────── */}
          <div className="form-section-title field-wide">Security Check</div>

          <div className="field field-wide">
            <label>Please complete the verification below *</label>
            <TurnstileWidget
              onVerify={token => { setCaptchaToken(token); setError('') }}
              onExpire={() => setCaptchaToken(null)}
            />
          </div>

          <div className="form-actions field-wide" style={{ paddingTop: 8 }}>
            <button type="submit" className="primary-button" disabled={saving || !captchaToken} style={{ width: '100%' }}>
              {saving ? 'Submitting…' : 'Submit Registration'}
            </button>
          </div>

          <p className="pub-disclaimer">
            By submitting this form you agree that your information will be stored and used for vendor onboarding purposes.
            Your registration will be reviewed by our team before activation. Status: <strong>Pending Approval</strong>.
          </p>

        </form>
      </div>
    </div>
  )
}
