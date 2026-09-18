import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Icon } from '../../components/Icon'
import { SearchableSelect } from '../../components/SearchableSelect'
import { Country, State, City } from 'country-state-city'
import { VENDOR_ADDRESS_COLUMNS } from './vendorFilters'

export default function AddVendorModal({ onClose, onSaved }) {
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
    const raw = country?.phonecode || ''
    const dial = raw ? ((raw.startsWith('+') ? raw : `+${raw}`).split('-')[0]) : ''
    setForm((current) => ({
      ...current,
      country_code: code,
      country_name: country?.name || code,
      country_dialcode: dial,
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
                {allCountries.map((c) => {
                  const raw = c.phonecode.startsWith('+') ? c.phonecode : `+${c.phonecode}`
                  const dialCode = raw.includes('-') ? raw.split('-')[0] : raw
                  return <option key={c.isoCode} value={dialCode}>{c.flag} {c.isoCode} ({dialCode})</option>
                })}
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
