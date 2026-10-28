import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isActiveStatus } from '../../lib/status'
import { Icon } from '../../components/Icon'
import { SearchableSelect } from '../../components/SearchableSelect'
import { listValues, useSettings } from '../../lib/settings'
import { FormModal, FormSection, Field, Segmented, Disclosure } from '../../components/crm/CrmUi'
import { Country, State } from 'country-state-city'
import { useCitiesOfState } from '../../lib/useCities'
import { VENDOR_ADDRESS_COLUMNS } from './vendorFilters'

const ALLOWED_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_DOC_BYTES = 10 * 1024 * 1024
const REGISTRATIONS = ['Registered', 'Unregistered', 'Composition', 'Other']

function formFrom(vendor, address) {
  const text = (value) => (value === null || value === undefined ? '' : String(value))
  const countryCode = address?.country_code || (vendor ? '' : 'IN')
  const stateCode = countryCode && address?.state
    ? (State.getStatesOfCountry(countryCode).find((state) => state.name === address.state)?.isoCode || '')
    : ''
  const dial = text(vendor?.country_dialcode || '91').replace(/^\+?/, '+')
  return {
    company_name: text(vendor?.company_name),
    vendor_type: vendor?.vendor_type || 'Organization',
    status: vendor ? (isActiveStatus(vendor.status) ? '1' : '0') : '1',
    alias: text(vendor?.alias),
    contact_person: text(vendor?.contact_person),
    email: text(vendor?.email),
    country_dialcode: dial,
    contact: text(vendor?.contact),
    media_id: text(vendor?.media_id),
    sub_media_id: text(vendor?.sub_media_id),
    payment_term_value: text(vendor?.payment_term_value),
    payment_term_type: vendor?.payment_term_type || 'Invoice Date',
    payment_term_invoice_date: text(vendor?.payment_term_invoice_date).slice(0, 10),
    registration: text(vendor?.registration),
    gstin: text(vendor?.gstin),
    gstin_date: text(vendor?.gstin_date).slice(0, 10),
    pan_number: text(vendor?.pan_number),
    tds_percentage: text(vendor?.tds_percentage),
    tds_section: text(vendor?.tds_section),
    opening_balance: vendor ? text(vendor.opening_balance ?? '0') : '0',
    vendor_bank_name: text(vendor?.vendor_bank_name),
    vendor_ifsc_code: text(vendor?.vendor_ifsc_code),
    vendor_account_number: text(vendor?.vendor_account_number),
    vendor_confirm_account_number: text(vendor?.vendor_confirm_account_number || vendor?.vendor_account_number),
    country_code: countryCode,
    country_name: address?.country || (vendor ? '' : 'India'),
    state_code: stateCode,
    state: text(address?.state),
    city: text(address?.city),
    zipcode: text(address?.zipcode),
    address: text(address?.address),
  }
}

/**
 * Add a vendor, or edit one when `vendor` is given (with its primary
 * `address`). The database decides who may do either (vendors.create /
 * vendors.edit). Editing never deletes anything: a new document is stored
 * beside the old one and the vendor points at the new file.
 */
export default function VendorForm({ vendor, address, onClose, onSaved }) {
  const isEdit = Boolean(vendor?.id)
  useSettings()
  const allCountries = useMemo(() => Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name)), [])
  const [form, setForm] = useState(() => formFrom(vendor, address))
  const [errors, setErrors] = useState({})
  const [mediaOptions, setMediaOptions] = useState([])
  const [subMediaOptions, setSubMediaOptions] = useState([])
  const [loadingMedia, setLoadingMedia] = useState(true)
  const [loadingSubMedia, setLoadingSubMedia] = useState(false)
  const [documentFile, setDocumentFile] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [zipStatus, setZipStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef(null)

  const states = useMemo(() => (form.country_code ? State.getStatesOfCountry(form.country_code).sort((a, b) => a.name.localeCompare(b.name)) : []), [form.country_code])
  const cities = useCitiesOfState(form.country_code, form.state_code)

  useEffect(() => {
    let cancelled = false
    // select('*') so this works with or without the `hidden` column.
    supabase.from('media').select('*').order('name', { ascending: true }).then(({ data, error: fetchError }) => {
      if (cancelled) return
      if (fetchError) setError(fetchError.message)
      else setMediaOptions(data || [])
      setLoadingMedia(false)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!form.media_id) { setSubMediaOptions([]); return undefined }
    let cancelled = false
    setLoadingSubMedia(true)
    supabase.from('sub_media').select('*').eq('media_id', form.media_id).order('name', { ascending: true }).then(({ data, error: fetchError }) => {
      if (cancelled) return
      if (fetchError) setError(fetchError.message)
      else setSubMediaOptions(data || [])
      setLoadingSubMedia(false)
    })
    return () => { cancelled = true }
  }, [form.media_id])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function handleCountryChange(code) {
    const country = allCountries.find((item) => item.isoCode === code)
    const raw = country?.phonecode || ''
    const dial = raw ? ((raw.startsWith('+') ? raw : `+${raw}`).split('-')[0]) : ''
    setForm((current) => ({ ...current, country_code: code, country_name: country?.name || code, country_dialcode: dial || current.country_dialcode, state: '', state_code: '', city: '', zipcode: '' }))
    setZipStatus(null)
  }

  function handleStateChange(code) {
    const state = states.find((item) => item.isoCode === code)
    setForm((current) => ({ ...current, state_code: code, state: state?.name || '', city: '', zipcode: '' }))
    setErrors((current) => ({ ...current, state: undefined }))
    setZipStatus(null)
  }

  function chooseDocument(file) {
    if (!file) return
    if (!ALLOWED_DOC_TYPES.includes(file.type)) { setErrors((current) => ({ ...current, document: 'Use a PDF, JPG, PNG or WEBP file.' })); return }
    if (file.size > MAX_DOC_BYTES) { setErrors((current) => ({ ...current, document: 'The file must be smaller than 10 MB.' })); return }
    setErrors((current) => ({ ...current, document: undefined }))
    setDocumentFile(file)
  }

  async function verifyIndianZip(zip) {
    if (form.country_code !== 'IN' || !/^\d{6}$/.test(zip) || !form.city) return
    setZipStatus({ type: 'checking', message: 'Checking PIN code…' })
    try {
      const response = await fetch(`https://api.postalpincode.in/pincode/${zip}`)
      if (!response.ok) throw new Error('PIN lookup failed')
      const result = await response.json()
      const offices = result?.[0]?.PostOffice || []
      if (!offices.length) { setZipStatus({ type: 'error', message: 'PIN code not found.' }); return }
      const selected = form.city.toLowerCase().replace(/[^a-z0-9]/g, '')
      const matches = offices.some((office) => {
        const name = String(office.Name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        const district = String(office.District || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        return name.includes(selected) || selected.includes(name) || district.includes(selected) || selected.includes(district)
      })
      setZipStatus(matches
        ? { type: 'ok', message: 'PIN code matches the city.' }
        : { type: 'error', message: `PIN ${zip} does not seem to be in ${form.city}. Check the city and PIN.` })
    } catch {
      setZipStatus({ type: 'warning', message: 'Could not check the PIN right now. You can still save.' })
    }
  }

  function validate() {
    const found = {}
    if (!form.company_name.trim()) found.company_name = 'Enter the company name.'
    if (!form.media_id) found.media_id = 'Choose a media type.'
    if (!form.sub_media_id) found.sub_media_id = 'Choose a sub media type.'
    if (form.vendor_account_number !== form.vendor_confirm_account_number) found.vendor_confirm_account_number = 'Account numbers do not match.'
    if (!form.state.trim()) found.state = 'Choose a state.'
    if (!form.city.trim()) found.city = 'Choose a city.'
    if (!form.address.trim()) found.address = 'Enter the street address.'
    return found
  }

  function vendorPayload() {
    const phoneDigits = form.contact.replace(/\D/g, '')
    return {
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
      status: Number(form.status),
    }
  }

  function addressPayload(vendorId) {
    return {
      vendor_id: vendorId,
      address: form.address.trim(),
      country: form.country_name,
      country_code: form.country_code,
      state: form.state.trim(),
      city: form.city.trim(),
      zipcode: form.zipcode.trim() || null,
      is_default: true,
    }
  }

  async function uploadDocument(vendorId) {
    const safeName = documentFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `vendors_documents/${vendorId}/${Date.now()}-${safeName}`
    const { error: uploadError } = await supabase.storage.from('Dikho').upload(path, documentFile, { cacheControl: '3600', upsert: false, contentType: documentFile.type || 'application/octet-stream' })
    if (uploadError) throw uploadError
    return path
  }

  async function createVendor() {
    const { data: savedVendor, error: vendorError } = await supabase.from('vendors')
      .insert([{ ...vendorPayload(), vendor_document_file_name: documentFile?.name || null }]).select('*').single()
    if (vendorError) throw vendorError
    if (!savedVendor?.id) throw new Error('The vendor was created but no ID came back.')

    const { data: savedAddress, error: addressError } = await supabase.from('vendor_addresses')
      .insert([addressPayload(savedVendor.id)]).select(VENDOR_ADDRESS_COLUMNS).single()
    if (addressError) {
      await supabase.from('vendors').delete().eq('id', savedVendor.id)
      throw addressError
    }

    let documentPath = null
    if (documentFile) {
      try {
        documentPath = await uploadDocument(savedVendor.id)
      } catch (uploadError) {
        await supabase.from('vendor_addresses').delete().eq('vendor_id', savedVendor.id)
        await supabase.from('vendors').delete().eq('id', savedVendor.id)
        throw new Error(`The document could not be uploaded, so the vendor was not added: ${uploadError.message}`)
      }
      const { error: pathError } = await supabase.from('vendors').update({ vendor_document_file_path: documentPath, vendor_document_file_name: documentFile.name }).eq('id', savedVendor.id)
      if (pathError) {
        await supabase.storage.from('Dikho').remove([documentPath])
        await supabase.from('vendor_addresses').delete().eq('vendor_id', savedVendor.id)
        await supabase.from('vendors').delete().eq('id', savedVendor.id)
        throw pathError
      }
    }

    return {
      vendor: { ...savedVendor, vendor_document_file_path: documentPath, vendor_document_file_name: documentFile?.name || null, vendor_addresses: savedAddress ? [savedAddress] : [] },
      address: savedAddress,
    }
  }

  async function updateVendor() {
    const { data: savedVendor, error: vendorError } = await supabase.from('vendors')
      .update(vendorPayload()).eq('id', vendor.id).select('*').single()
    if (vendorError) {
      // PGRST116: the update matched no row this person may change.
      if (vendorError.code === 'PGRST116') throw new Error('This vendor could not be updated. You may not have permission to edit vendors, or it was removed.')
      throw vendorError
    }

    // The vendor row is committed from here on, so a later failure says
    // exactly what did and did not save rather than pretending nothing did.
    const fresh = addressPayload(vendor.id)
    const { data: savedAddress, error: addressError } = address?.id
      ? await supabase.from('vendor_addresses').update(fresh).eq('id', address.id).select('*').single()
      : await supabase.from('vendor_addresses').insert([fresh]).select('*').single()
    if (addressError) throw new Error(`The vendor details were saved, but the address was not: ${addressError.message}`)

    let documentFields = {}
    if (documentFile) {
      let path
      try {
        path = await uploadDocument(vendor.id)
      } catch (uploadError) {
        throw new Error(`The vendor details were saved, but the document was not uploaded: ${uploadError.message}`)
      }
      const { error: pathError } = await supabase.from('vendors').update({ vendor_document_file_path: path, vendor_document_file_name: documentFile.name }).eq('id', vendor.id)
      if (pathError) {
        await supabase.storage.from('Dikho').remove([path])
        throw new Error(`The vendor details were saved, but the new document could not be attached: ${pathError.message}`)
      }
      documentFields = { vendor_document_file_path: path, vendor_document_file_name: documentFile.name }
    }

    return {
      vendor: { ...vendor, ...savedVendor, ...documentFields, vendor_addresses: savedAddress ? [savedAddress] : [] },
      address: savedAddress,
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const found = validate()
    if (zipStatus?.type === 'error') found.zipcode = zipStatus.message
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) {
      setError('')
      document.querySelector(`[data-vendor-field="${first}"] input, [data-vendor-field="${first}"] select, [data-vendor-field="${first}"] textarea, [data-vendor-field="${first}"] button`)?.focus()
      return
    }

    setSaving(true)
    setError('')
    try {
      const result = isEdit ? await updateVendor() : await createVendor()
      onSaved(result.vendor, result.address)
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Could not save the vendor.')
    } finally {
      setSaving(false)
    }
  }

  const field = (name) => ({ value: form[name], onChange: (event) => update(name, event.target.value) })
  const accountMismatch = form.vendor_account_number && form.vendor_confirm_account_number && form.vendor_account_number !== form.vendor_confirm_account_number

  return (
    <FormModal
      title={isEdit ? 'Edit vendor' : 'New vendor'}
      subtitle={isEdit ? vendor.company_name : 'Required: company, media, and address. Everything else can wait.'}
      onClose={onClose}
      onSubmit={handleSubmit}
      busy={saving}
      error={error}
      errorTitle="Could not save the vendor"
      submitLabel={isEdit ? 'Save changes' : 'Add vendor'}
    >
      <FormSection title="Vendor">
        <div className="crm-grid">
          <Field label="Company name" htmlFor="vf-company" required className="crm-span-all" hint={errors.company_name} hintTone="error">
            <div data-vendor-field="company_name">
              <input id="vf-company" className="crm-input" {...field('company_name')} aria-invalid={Boolean(errors.company_name)} />
            </div>
          </Field>
          <Field label="Type">
            <Segmented label="Vendor type" block value={form.vendor_type} onChange={(value) => update('vendor_type', value)}
              options={[{ value: 'Organization', label: 'Organization' }, { value: 'Individual', label: 'Individual' }]} />
          </Field>
          <Field label="Status">
            <Segmented label="Status" block value={form.status} onChange={(value) => update('status', value)}
              options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]} />
          </Field>
          <Field label="Contact person" htmlFor="vf-contact-person">
            <input id="vf-contact-person" className="crm-input" {...field('contact_person')} />
          </Field>
          <Field label="Alias" htmlFor="vf-alias" optional hint="The short name your team uses for them.">
            <input id="vf-alias" className="crm-input" {...field('alias')} />
          </Field>
          <Field label="Email" htmlFor="vf-email">
            <input id="vf-email" type="email" className="crm-input" {...field('email')} />
          </Field>
          <Field label="Phone" htmlFor="vf-contact">
            <div className="crm-input-group">
              <select className="crm-select is-addon" aria-label="Country code" value={form.country_dialcode} onChange={(event) => update('country_dialcode', event.target.value)}>
                {allCountries.map((country) => {
                  const raw = country.phonecode.startsWith('+') ? country.phonecode : `+${country.phonecode}`
                  const dial = raw.includes('-') ? raw.split('-')[0] : raw
                  return <option key={country.isoCode} value={dial}>{dial} {country.isoCode}</option>
                })}
              </select>
              <input id="vf-contact" type="tel" inputMode="numeric" className="crm-input crm-mono-input" value={form.contact}
                onChange={(event) => update('contact', event.target.value.replace(/\D/g, '').slice(0, 10))} />
            </div>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Media and payment terms">
        <div className="crm-grid">
          <Field label="Media" htmlFor="vf-media" required hint={errors.media_id} hintTone="error">
            <div data-vendor-field="media_id">
              <select id="vf-media" className="crm-select" value={form.media_id} disabled={loadingMedia} aria-invalid={Boolean(errors.media_id)}
                onChange={(event) => { update('media_id', event.target.value); update('sub_media_id', '') }}>
                <option value="">{loadingMedia ? 'Loading…' : 'Choose media'}</option>
                {mediaOptions.filter((item) => !item.hidden || String(item.id) === String(form.media_id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
          </Field>
          <Field label="Sub media" htmlFor="vf-sub-media" required hint={errors.sub_media_id} hintTone="error">
            <div data-vendor-field="sub_media_id">
              <select id="vf-sub-media" className="crm-select" {...field('sub_media_id')} disabled={!form.media_id || loadingSubMedia} aria-invalid={Boolean(errors.sub_media_id)}>
                <option value="">{!form.media_id ? 'Choose media first' : loadingSubMedia ? 'Loading…' : 'Choose sub media'}</option>
                {subMediaOptions.filter((item) => !item.hidden || String(item.id) === String(form.sub_media_id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
          </Field>
          <Field label="Payment term" htmlFor="vf-pt-days">
            <div className="crm-input-group">
              <input id="vf-pt-days" type="number" min="0" step="1" className="crm-input" {...field('payment_term_value')} />
              <span className="crm-addon">days</span>
            </div>
          </Field>
          <Field label="Counted from">
            <Segmented label="Payment term counted from" block value={form.payment_term_type} onChange={(value) => update('payment_term_type', value)}
              options={[{ value: 'Invoice Date', label: 'Invoice date' }, { value: 'Campaign End Date', label: 'Campaign end' }]} />
          </Field>
        </div>
        <Disclosure count="1 field" defaultOpen={Boolean(form.payment_term_invoice_date)}>
          <div className="crm-grid">
            <Field label="Payment term date" htmlFor="vf-pt-date">
              <input id="vf-pt-date" type="date" className="crm-input" {...field('payment_term_invoice_date')} />
            </Field>
          </div>
        </Disclosure>
      </FormSection>

      <FormSection title="Tax">
        <div className="crm-grid">
          <Field label="GSTIN" htmlFor="vf-gstin">
            <input id="vf-gstin" className="crm-input crm-mono-input" maxLength={15} value={form.gstin} onChange={(event) => update('gstin', event.target.value.toUpperCase())} />
          </Field>
          <Field label="PAN" htmlFor="vf-pan">
            <input id="vf-pan" className="crm-input crm-mono-input" maxLength={10} value={form.pan_number} onChange={(event) => update('pan_number', event.target.value.toUpperCase())} />
          </Field>
        </div>
        <Disclosure count="5 fields" defaultOpen={Boolean(form.registration || form.gstin_date || form.tds_percentage || form.tds_section || (form.opening_balance && Number(form.opening_balance) !== 0))}>
          <div className="crm-grid">
            <Field label="Registration" htmlFor="vf-registration">
              <select id="vf-registration" className="crm-select" {...field('registration')}>
                <option value="">Not set</option>
                {listValues('registration', REGISTRATIONS, form.registration).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label="GSTIN date" htmlFor="vf-gstin-date">
              <input id="vf-gstin-date" type="date" className="crm-input" {...field('gstin_date')} />
            </Field>
            <Field label="TDS" htmlFor="vf-tds">
              <div className="crm-input-group">
                <input id="vf-tds" type="number" min="0" max="100" step="0.01" className="crm-input" {...field('tds_percentage')} />
                <span className="crm-addon">%</span>
              </div>
            </Field>
            <Field label="TDS section" htmlFor="vf-tds-section">
              <input id="vf-tds-section" className="crm-input" {...field('tds_section')} />
            </Field>
            <Field label="Opening balance" htmlFor="vf-opening">
              <div className="crm-input-group">
                <span className="crm-addon">₹</span>
                <input id="vf-opening" type="number" step="0.01" className="crm-input crm-mono-input" {...field('opening_balance')} />
              </div>
            </Field>
          </div>
        </Disclosure>
      </FormSection>

      <FormSection title="Bank account" description="Where payments to this vendor go.">
        <div className="crm-grid">
          <Field label="Bank name" htmlFor="vf-bank">
            <input id="vf-bank" className="crm-input" {...field('vendor_bank_name')} />
          </Field>
          <Field label="IFSC" htmlFor="vf-ifsc">
            <input id="vf-ifsc" className="crm-input crm-mono-input" maxLength={11} value={form.vendor_ifsc_code} onChange={(event) => update('vendor_ifsc_code', event.target.value.toUpperCase())} />
          </Field>
          <Field label="Account number" htmlFor="vf-account">
            <input id="vf-account" inputMode="numeric" className="crm-input crm-mono-input" value={form.vendor_account_number} onChange={(event) => update('vendor_account_number', event.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Confirm account number" htmlFor="vf-account-confirm"
            hint={errors.vendor_confirm_account_number || (accountMismatch ? 'Account numbers do not match.' : null)} hintTone="error">
            <div data-vendor-field="vendor_confirm_account_number">
              <input id="vf-account-confirm" inputMode="numeric" className="crm-input crm-mono-input" value={form.vendor_confirm_account_number}
                onChange={(event) => update('vendor_confirm_account_number', event.target.value.replace(/\D/g, ''))} aria-invalid={Boolean(accountMismatch)} />
            </div>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Address">
        <div className="crm-grid">
          <SearchableSelect label="Country" value={form.country_code} onChange={handleCountryChange} options={allCountries.map((country) => ({ value: country.isoCode, label: country.name }))}
            placeholder="Choose a country" searchPlaceholder="Search countries…" required />
          <div data-vendor-field="state">
            <SearchableSelect label="State" value={form.state_code} onChange={handleStateChange} options={states.map((state) => ({ value: state.isoCode, label: state.name }))}
              placeholder={!form.country_code ? 'Choose a country first' : states.length ? 'Choose a state' : 'No states listed'}
              searchPlaceholder="Search states…" disabled={!form.country_code || !states.length} required hasError={Boolean(errors.state)} error={Boolean(errors.state)} />
          </div>
          <div data-vendor-field="city">
            <SearchableSelect label="City" value={form.city} onChange={(value) => { update('city', value); setZipStatus(null) }} options={cities.map((city) => ({ value: city.name, label: city.name }))}
              placeholder={!form.state_code ? 'Choose a state first' : cities.length ? 'Choose a city' : 'No cities listed'}
              searchPlaceholder="Search cities…" disabled={!form.state_code || !cities.length} required hasError={Boolean(errors.city)} error={Boolean(errors.city)} />
          </div>
          <Field label="PIN code" htmlFor="vf-zip" hint={errors.zipcode || zipStatus?.message} hintTone={errors.zipcode || zipStatus?.type === 'error' ? 'error' : zipStatus?.type === 'ok' ? 'ok' : undefined}>
            <div data-vendor-field="zipcode">
              <input id="vf-zip" className="crm-input crm-mono-input" value={form.zipcode}
                inputMode={form.country_code === 'IN' ? 'numeric' : 'text'}
                onChange={(event) => {
                  const raw = event.target.value
                  update('zipcode', form.country_code === 'IN' ? raw.replace(/\D/g, '').slice(0, 6) : raw.replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 10))
                  setZipStatus(null)
                }}
                onBlur={() => verifyIndianZip(form.zipcode)} />
            </div>
          </Field>
          <Field label="Street address" htmlFor="vf-address" required className="crm-span-all"
            hint={errors.address || 'Building, street, area and landmark. City, state and PIN go in their own fields.'} hintTone={errors.address ? 'error' : undefined}>
            <div data-vendor-field="address">
              <textarea id="vf-address" rows={2} className="crm-textarea" {...field('address')} aria-invalid={Boolean(errors.address)} />
            </div>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Document" description={isEdit && vendor.vendor_document_file_name
        ? `On file: ${vendor.vendor_document_file_name}. Choosing a new file attaches it instead; the old one is kept.`
        : 'GST certificate, PAN card or agreement. Optional.'}>
        <input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" hidden onChange={(event) => { chooseDocument(event.target.files?.[0]); event.target.value = '' }} />
        <div
          className={`crm-drop${documentFile ? ' has-file' : ''}${dragActive ? ' is-dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragActive(true) }}
          onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => { event.preventDefault(); setDragActive(false); chooseDocument(event.dataTransfer?.files?.[0]) }}
          onClick={() => { if (!documentFile) fileInput.current?.click() }}
          role="button"
          tabIndex={documentFile ? -1 : 0}
          onKeyDown={(event) => { if (!documentFile && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); fileInput.current?.click() } }}
        >
          <span className="crm-file-icon"><Icon name={documentFile ? 'file' : 'upload'} size={18} /></span>
          <div className="crm-drop-main">
            <div className="crm-drop-title">{documentFile ? documentFile.name : 'Drop a file here or click to choose'}</div>
            <div className="crm-drop-copy">{documentFile ? `${(documentFile.size / 1024 / 1024).toFixed(2)} MB, ready to upload` : 'PDF, JPG, PNG or WEBP, up to 10 MB'}</div>
          </div>
          {documentFile && (
            <>
              <button type="button" className="crm-btn crm-btn--ghost crm-btn--sm" onClick={(event) => { event.stopPropagation(); fileInput.current?.click() }}>Change</button>
              <button type="button" className="crm-btn crm-btn--ghost crm-btn--sm" onClick={(event) => { event.stopPropagation(); setDocumentFile(null) }}>Remove</button>
            </>
          )}
        </div>
        {errors.document && <span className="crm-hint is-error">{errors.document}</span>}
      </FormSection>
    </FormModal>
  )
}
