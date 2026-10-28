import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isActiveStatus } from '../../lib/status'
import { listValues, useSettings } from '../../lib/settings'
import { FormModal, FormSection, Field, Segmented, Disclosure } from '../../components/crm/CrmUi'

const DIAL_CODES = [
  { value: '91', label: '+91 IN' },
  { value: '1', label: '+1 US' },
  { value: '44', label: '+44 UK' },
  { value: '971', label: '+971 AE' },
  { value: '65', label: '+65 SG' },
]
const REGISTRATIONS = ['Registered', 'Unregistered', 'Composition', 'Other']

function formFrom(client) {
  const text = (value) => (value === null || value === undefined ? '' : String(value))
  return {
    company_name: text(client?.company_name),
    contact_person: text(client?.contact_person),
    designation: text(client?.designation),
    country_dialcode: client?.country_dialcode ? String(client.country_dialcode).replace(/^\+/, '') : '91',
    contact: text(client?.contact),
    email: text(client?.email),
    status: client ? (isActiveStatus(client.status) ? '1' : '0') : '1',
    gstin: text(client?.gstin),
    gstin_date: text(client?.gstin_date).slice(0, 10),
    registration: text(client?.registration),
    pan_number: text(client?.pan_number),
    tds_percentage: text(client?.tds_percentage),
    tds_section: text(client?.tds_section),
    address_line1: text(client?.address_line1),
    address_line2: text(client?.address_line2),
    city: text(client?.city),
    state: text(client?.state),
    pincode: text(client?.pincode),
    country: client ? text(client.country) : 'India',
  }
}

/**
 * Add a client, or edit one when `client` is given. The database decides
 * who may do either (clients.create / clients.edit); this only asks.
 */
export default function ClientForm({ client, onClose, onSaved }) {
  const isEdit = Boolean(client?.id)
  useSettings()
  const [form, setForm] = useState(() => formFrom(client))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    if (field === 'company_name') setMissing(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.company_name.trim()) {
      setMissing(true)
      document.getElementById('client-company')?.focus()
      return
    }

    setSaving(true)
    setError('')
    const phoneDigits = form.contact.replace(/\D/g, '')
    const payload = {
      company_name: form.company_name.trim(),
      contact_person: form.contact_person.trim() || null,
      designation: form.designation.trim() || null,
      country_dialcode: phoneDigits && form.country_dialcode ? Number(form.country_dialcode) : null,
      contact: phoneDigits ? Number(phoneDigits) : null,
      email: form.email.trim() || null,
      gstin: form.gstin.trim().toUpperCase() || null,
      gstin_date: form.gstin_date || null,
      tds_percentage: form.tds_percentage === '' ? null : Number(form.tds_percentage),
      tds_section: form.tds_section.trim() || null,
      registration: form.registration || null,
      pan_number: form.pan_number.trim().toUpperCase() || null,
      status: Number(form.status),
      address_line1: form.address_line1.trim() || null,
      address_line2: form.address_line2.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      pincode: form.pincode.trim() || null,
      country: form.country.trim() || null,
    }

    const request = isEdit
      ? supabase.from('clients').update(payload).eq('id', client.id).select('*').single()
      : supabase.from('clients').insert([payload]).select('*').single()
    const { data, error: saveError } = await request
    setSaving(false)

    if (saveError) {
      // PGRST116: the update matched no row it was allowed to change.
      setError(saveError.code === 'PGRST116'
        ? 'This client could not be updated. You may not have permission to edit clients, or it was removed.'
        : saveError.message)
      return
    }
    onSaved(data || { ...client, ...payload })
  }

  const field = (name) => ({ value: form[name], onChange: (event) => update(name, event.target.value) })

  return (
    <FormModal
      title={isEdit ? 'Edit client' : 'New client'}
      subtitle={isEdit ? client.company_name : 'Only the company name is required. Everything else can be added later.'}
      onClose={onClose}
      onSubmit={handleSubmit}
      busy={saving}
      error={error}
      errorTitle="Could not save the client"
      submitLabel={isEdit ? 'Save changes' : 'Add client'}
    >
      <FormSection title="Company">
        <div className="crm-grid">
          <Field label="Company name" htmlFor="client-company" required className="crm-span-all"
            hint={missing ? 'Enter the company name.' : null} hintTone="error">
            <input id="client-company" className="crm-input" {...field('company_name')} aria-invalid={missing} />
          </Field>
          <Field label="Contact person" htmlFor="client-contact-person">
            <input id="client-contact-person" className="crm-input" {...field('contact_person')} />
          </Field>
          <Field label="Designation" htmlFor="client-designation">
            <input id="client-designation" className="crm-input" {...field('designation')} />
          </Field>
          <Field label="Email" htmlFor="client-email">
            <input id="client-email" type="email" className="crm-input" {...field('email')} />
          </Field>
          <Field label="Phone" htmlFor="client-phone">
            <div className="crm-input-group">
              <select className="crm-select is-addon" aria-label="Country code" {...field('country_dialcode')}>
                {DIAL_CODES.map((code) => <option key={code.value} value={code.value}>{code.label}</option>)}
              </select>
              <input id="client-phone" type="tel" inputMode="numeric" className="crm-input crm-mono-input" value={form.contact}
                onChange={(event) => update('contact', event.target.value.replace(/\D/g, '').slice(0, 15))} />
            </div>
          </Field>
          <Field label="Status" className="crm-span-all">
            <Segmented label="Status" value={form.status} onChange={(value) => update('status', value)}
              options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Tax">
        <div className="crm-grid">
          <Field label="GSTIN" htmlFor="client-gstin">
            <input id="client-gstin" className="crm-input crm-mono-input" value={form.gstin} maxLength={15}
              onChange={(event) => update('gstin', event.target.value.toUpperCase())} />
          </Field>
          <Field label="PAN" htmlFor="client-pan">
            <input id="client-pan" className="crm-input crm-mono-input" value={form.pan_number} maxLength={10}
              onChange={(event) => update('pan_number', event.target.value.toUpperCase())} />
          </Field>
        </div>
        <Disclosure count="4 fields" defaultOpen={Boolean(form.registration || form.gstin_date || form.tds_percentage || form.tds_section)}>
          <div className="crm-grid">
            <Field label="Registration" htmlFor="client-registration">
              <select id="client-registration" className="crm-select" {...field('registration')}>
                <option value="">Not set</option>
                {listValues('registration', REGISTRATIONS, form.registration).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label="GSTIN date" htmlFor="client-gstin-date">
              <input id="client-gstin-date" type="date" className="crm-input" {...field('gstin_date')} />
            </Field>
            <Field label="TDS" htmlFor="client-tds">
              <div className="crm-input-group">
                <input id="client-tds" type="number" min="0" max="100" step="0.01" className="crm-input" {...field('tds_percentage')} />
                <span className="crm-addon">%</span>
              </div>
            </Field>
            <Field label="TDS section" htmlFor="client-tds-section">
              <input id="client-tds-section" className="crm-input" {...field('tds_section')} />
            </Field>
          </div>
        </Disclosure>
      </FormSection>

      <FormSection title="Address">
        <div className="crm-grid">
          <Field label="Address" htmlFor="client-address-1" className="crm-span-all">
            <input id="client-address-1" className="crm-input" {...field('address_line1')} />
          </Field>
          <Field label="Address line 2" htmlFor="client-address-2" optional className="crm-span-all">
            <input id="client-address-2" className="crm-input" {...field('address_line2')} />
          </Field>
          <Field label="City" htmlFor="client-city">
            <input id="client-city" className="crm-input" {...field('city')} />
          </Field>
          <Field label="State" htmlFor="client-state">
            <input id="client-state" className="crm-input" {...field('state')} />
          </Field>
          <Field label="PIN code" htmlFor="client-pincode">
            <input id="client-pincode" inputMode="numeric" className="crm-input crm-mono-input" {...field('pincode')} />
          </Field>
          <Field label="Country" htmlFor="client-country">
            <input id="client-country" className="crm-input" {...field('country')} />
          </Field>
        </div>
      </FormSection>
    </FormModal>
  )
}
