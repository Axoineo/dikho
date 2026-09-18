import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Icon } from '../../components/Icon'
import { SearchableSelect } from '../../components/SearchableSelect'
import { Country, State, City } from 'country-state-city'

export default function AddClientModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    company_name: '',
    contact_person: '',
    designation: '',
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
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India',
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
      designation: form.designation.trim() || null,
      contact: phoneDigits ? Number(phoneDigits) : null,
      email: form.email.trim() || null,
      gstin: form.gstin.trim() || null,
      gstin_date: form.gstin_date || null,
      tds_percentage: form.tds_percentage === '' ? null : Number(form.tds_percentage),
      tds_section: form.tds_section.trim() || null,
      registration: form.registration.trim() || null,
      pan_number: form.pan_number.trim() || null,
      status: Number(form.status),
      address_line1: form.address_line1.trim() || null,
      address_line2: form.address_line2.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      pincode: form.pincode.trim() || null,
      country: form.country.trim() || null,
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
            <label htmlFor="designation">Designation</label>
            <input id="designation" value={form.designation} onChange={(e) => update('designation', e.target.value)} placeholder="e.g. Procurement Manager" />
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

          <div className="field field-wide">
            <label htmlFor="address-line1">Address Line 1</label>
            <input id="address-line1" value={form.address_line1} onChange={(e) => update('address_line1', e.target.value)} placeholder="Building, street, area…" />
          </div>

          <div className="field field-wide">
            <label htmlFor="address-line2">Address Line 2</label>
            <input id="address-line2" value={form.address_line2} onChange={(e) => update('address_line2', e.target.value)} placeholder="Floor, landmark (optional)" />
          </div>

          <div className="field">
            <label htmlFor="client-city">City</label>
            <input id="client-city" value={form.city} onChange={(e) => update('city', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="client-state">State</label>
            <input id="client-state" value={form.state} onChange={(e) => update('state', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="client-pincode">Pincode</label>
            <input id="client-pincode" value={form.pincode} onChange={(e) => update('pincode', e.target.value)} placeholder="e.g. 400001" />
          </div>

          <div className="field">
            <label htmlFor="client-country">Country</label>
            <input id="client-country" value={form.country} onChange={(e) => update('country', e.target.value)} />
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
