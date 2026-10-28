// "Organization" pages: Company, Regional, Lists and media. Changes here
// apply to everyone, so they need settings.manage (checked again by the
// database functions) and Company/Regional ask before saving.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { loadSettings, settingsApi, useSettings } from '../../lib/settings'
import { formatDayAs } from '../../lib/format'
import { Icon } from '../../components/Icon'
import { Field, Toast } from '../../components/crm/CrmUi'
import { SectionHead, SettingsCard, SaveBar, StatusLine } from './SettingsParts'

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/

function isNotReady(error) {
  return error?.code === 'PGRST202'
}

function NotReady() {
  return (
    <div className="crm-note crm-note--info">
      <Icon name="alert" size={17} />
      <div>These settings need a database update that has not been applied yet. Everything else keeps working meanwhile.</div>
    </div>
  )
}

/* ── Company ────────────────────────────────────────────────────────────── */

const COMPANY_FIELDS = ['legal_name', 'gstin', 'pan', 'state_code', 'address_line1', 'address_line2', 'city', 'state', 'pincode',
  'country', 'bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'bank_branch']

function companyForm(row) {
  const form = {}
  COMPANY_FIELDS.forEach((key) => { form[key] = row?.[key] == null ? '' : String(row[key]) })
  if (!form.country) form.country = 'India'
  return form
}

function companyProblems(form) {
  const found = {}
  if (!form.legal_name.trim()) found.legal_name = 'Enter the legal name.'
  if (form.gstin && !GSTIN.test(form.gstin)) found.gstin = 'A GSTIN is 15 characters, like the one on your GST certificate.'
  if (form.pan && !PAN.test(form.pan)) found.pan = 'A PAN is 10 characters: 5 letters, 4 digits, 1 letter.'
  if (form.gstin && form.pan && GSTIN.test(form.gstin) && form.gstin.slice(2, 12) !== form.pan) found.pan = 'This PAN is not the one inside the GSTIN.'
  if (!form.gstin && !/^[0-9]{2}$/.test(form.state_code)) found.state_code = 'Enter the two-digit GST state code.'
  if (!form.address_line1.trim()) found.address_line1 = 'Enter the address.'
  if (!form.city.trim()) found.city = 'Enter the city.'
  if (!form.state.trim()) found.state = 'Enter the state.'
  if ((form.country || 'India') === 'India' ? !/^[1-9][0-9]{5}$/.test(form.pincode) : !form.pincode.trim()) found.pincode = 'Enter the 6-digit PIN code.'
  if (form.bank_ifsc && !IFSC.test(form.bank_ifsc)) found.bank_ifsc = 'An IFSC is 11 characters, the fifth one a zero.'
  if (form.bank_account_number && !/^[0-9]{6,18}$/.test(form.bank_account_number)) found.bank_account_number = 'Use 6 to 18 digits.'
  return found
}

export function CompanySettings() {
  const [saved, setSaved] = useState(null)
  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [problems, setProblems] = useState({})
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const fresh = companyForm(await settingsApi.getCompany())
      setSaved(fresh)
      setForm(fresh)
      setLoadError(null)
    } catch (error) {
      setLoadError(error)
    }
  }, [])
  useEffect(() => { load() }, [load])

  if (isNotReady(loadError)) return <><SectionHead title="Company" /><NotReady /></>
  if (loadError) return <><SectionHead title="Company" /><p className="set-status is-error">{loadError.message}</p></>
  if (!form) return <><SectionHead title="Company" /><p className="set-status">Loading…</p></>

  const dirty = COMPANY_FIELDS.some((key) => form[key] !== saved[key])
  const derivedState = GSTIN.test(form.gstin) ? form.gstin.slice(0, 2) : null

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
    setProblems((current) => ({ ...current, [key]: undefined }))
  }
  const upper = (key) => (event) => update(key, event.target.value.toUpperCase().replace(/\s/g, ''))
  const text = (key) => (event) => update(key, event.target.value)
  const digits = (key, max) => (event) => update(key, event.target.value.replace(/\D/g, '').slice(0, max))

  async function save() {
    const found = companyProblems(form)
    setProblems(found)
    const first = Object.keys(found)[0]
    if (first) {
      document.getElementById(`company-${first}`)?.focus()
      return
    }
    const changes = {}
    COMPANY_FIELDS.forEach((key) => { if (form[key] !== saved[key]) changes[key] = form[key] })
    setBusy(true)
    setSaveError('')
    try {
      const fresh = companyForm(await settingsApi.updateCompany(changes))
      setSaved(fresh)
      setForm(fresh)
      setNotice('Company details saved')
    } catch (error) {
      setSaveError(error.message)
    } finally {
      setBusy(false)
    }
  }

  const field = (key, label, input, options = {}) => (
    <Field label={label} htmlFor={`company-${key}`} required={options.required} optional={options.optional}
      className={options.wide ? 'crm-span-all' : ''} hint={problems[key] || options.hint} hintTone={problems[key] ? 'error' : undefined}>
      {input}
    </Field>
  )

  return (
    <>
      <SectionHead title="Company">The business details printed on tax invoices, and where customers pay you.</SectionHead>

      <SettingsCard title="Business details" description="Invoices already issued keep the details they were issued with.">
        <div className="set-card-body">
          <div className="crm-grid">
            {field('legal_name', 'Legal name', <input id="company-legal_name" className="crm-input" value={form.legal_name} onChange={text('legal_name')} maxLength={200} aria-invalid={Boolean(problems.legal_name)} />, { required: true, wide: true })}
            {field('gstin', 'GSTIN', <input id="company-gstin" className="crm-input crm-mono-input" value={form.gstin} onChange={upper('gstin')} maxLength={15} aria-invalid={Boolean(problems.gstin)} />)}
            {field('pan', 'PAN', <input id="company-pan" className="crm-input crm-mono-input" value={form.pan} onChange={upper('pan')} maxLength={10} aria-invalid={Boolean(problems.pan)} />)}
            {derivedState
              ? field('state_code', 'GST state code', <div className="crm-readout">{derivedState}</div>, { hint: 'Taken from the GSTIN.' })
              : field('state_code', 'GST state code', <input id="company-state_code" className="crm-input crm-mono-input" inputMode="numeric" value={form.state_code} onChange={digits('state_code', 2)} aria-invalid={Boolean(problems.state_code)} />, { required: true, hint: problems.state_code ? null : 'Two digits; filled in by itself once you enter a GSTIN.' })}
            <div className="crm-hide-sm" />
            {field('address_line1', 'Address', <input id="company-address_line1" className="crm-input" value={form.address_line1} onChange={text('address_line1')} maxLength={200} aria-invalid={Boolean(problems.address_line1)} />, { required: true, wide: true })}
            {field('address_line2', 'Address line 2', <input id="company-address_line2" className="crm-input" value={form.address_line2} onChange={text('address_line2')} maxLength={200} />, { optional: true, wide: true })}
            {field('city', 'City', <input id="company-city" className="crm-input" value={form.city} onChange={text('city')} maxLength={200} aria-invalid={Boolean(problems.city)} />, { required: true })}
            {field('state', 'State', <input id="company-state" className="crm-input" value={form.state} onChange={text('state')} maxLength={200} aria-invalid={Boolean(problems.state)} />, { required: true })}
            {field('pincode', 'PIN code', <input id="company-pincode" className="crm-input crm-mono-input" inputMode="numeric" value={form.pincode} onChange={(event) => update('pincode', event.target.value.replace(/[^0-9A-Za-z -]/g, '').slice(0, 10))} aria-invalid={Boolean(problems.pincode)} />, { required: true })}
            {field('country', 'Country', <input id="company-country" className="crm-input" value={form.country} onChange={text('country')} maxLength={80} />)}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Bank account" description="Printed on invoices so customers know where to pay.">
        <div className="set-card-body">
          <div className="crm-grid">
            {field('bank_name', 'Bank', <input id="company-bank_name" className="crm-input" value={form.bank_name} onChange={text('bank_name')} maxLength={200} />)}
            {field('bank_branch', 'Branch', <input id="company-bank_branch" className="crm-input" value={form.bank_branch} onChange={text('bank_branch')} maxLength={200} />, { optional: true })}
            {field('bank_account_name', 'Account holder', <input id="company-bank_account_name" className="crm-input" value={form.bank_account_name} onChange={text('bank_account_name')} maxLength={200} />, { wide: true })}
            {field('bank_account_number', 'Account number', <input id="company-bank_account_number" className="crm-input crm-mono-input" inputMode="numeric" value={form.bank_account_number} onChange={digits('bank_account_number', 18)} aria-invalid={Boolean(problems.bank_account_number)} />)}
            {field('bank_ifsc', 'IFSC', <input id="company-bank_ifsc" className="crm-input crm-mono-input" value={form.bank_ifsc} onChange={upper('bank_ifsc')} maxLength={11} aria-invalid={Boolean(problems.bank_ifsc)} />)}
          </div>
        </div>
      </SettingsCard>

      {saveError && <div className="crm-note crm-note--danger" role="alert" style={{ marginBottom: 18 }}><Icon name="alert" size={17} /><div>{saveError}</div></div>}
      {dirty && <SaveBar busy={busy} onSave={save} onCancel={() => { setForm(saved); setProblems({}); setSaveError('') }} />}
      <Toast message={notice} onDone={() => setNotice('')} />
    </>
  )
}

/* ── Regional ───────────────────────────────────────────────────────────── */

const DATE_CHOICES = [
  { value: 'd MMM yyyy', title: 'Day, month name, year' },
  { value: 'dd/MM/yyyy', title: 'Day/month/year' },
  { value: 'yyyy-MM-dd', title: 'Year-month-day' },
]
const NUMBER_CHOICES = [
  { value: 'en-IN', title: 'Indian', example: '₹1,00,000.00' },
  { value: 'en-US', title: 'International', example: '₹100,000.00' },
]

function ChoiceCards({ label, value, choices, onChange }) {
  return (
    <div className="set-choices" role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <button key={choice.value} type="button" role="radio" aria-checked={value === choice.value} className="set-choice" onClick={() => onChange(choice.value)}>
          <span className="set-choice-title">{choice.title}</span>
          <span className="set-choice-example">{choice.example}</span>
        </button>
      ))}
    </div>
  )
}

export function RegionalSettings() {
  const { organization, available, loaded } = useSettings()
  const current = { date_format: organization.date_format || 'd MMM yyyy', number_format: organization.number_format || 'en-IN' }
  const [form, setForm] = useState(current)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const today = useMemo(() => new Date(), [])

  // Follow the saved values once they arrive (or change elsewhere).
  useEffect(() => { setForm({ date_format: current.date_format, number_format: current.number_format }) }, [current.date_format, current.number_format])

  if (loaded && !available) return <><SectionHead title="Regional" /><NotReady /></>

  const dirty = form.date_format !== current.date_format || form.number_format !== current.number_format

  async function save() {
    setBusy(true)
    setStatus(null)
    try {
      await settingsApi.updateOrganization(form)
      await loadSettings()
      setStatus({ tone: 'ok', text: 'Saved. Everyone else sees it the next time they open Dikho.' })
    } catch (error) {
      setStatus({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionHead title="Regional">How dates and amounts appear on everyone's screens. Exports and invoices are not affected.</SectionHead>
      <SettingsCard title="Dates">
        <div className="set-card-body">
          <ChoiceCards label="Date format" value={form.date_format} onChange={(value) => setForm((f) => ({ ...f, date_format: value }))}
            choices={DATE_CHOICES.map((choice) => ({ ...choice, example: formatDayAs(choice.value, today) }))} />
          <div style={{ height: 14 }} />
        </div>
      </SettingsCard>
      <SettingsCard title="Amounts">
        <div className="set-card-body">
          <ChoiceCards label="Number style" value={form.number_format} onChange={(value) => setForm((f) => ({ ...f, number_format: value }))} choices={NUMBER_CHOICES} />
          <div style={{ height: 14 }} />
        </div>
      </SettingsCard>
      <StatusLine status={status} />
      {dirty && <SaveBar busy={busy} onSave={save} onCancel={() => setForm(current)} />}
    </>
  )
}

/* ── Lists and media ────────────────────────────────────────────────────── */

const LISTS = [
  { key: 'order_status', title: 'Order statuses', noun: 'order status', description: 'Sales and purchase orders.' },
  { key: 'order_type', title: 'Order types', noun: 'order type', description: 'Sales and purchase orders.' },
  { key: 'purchase_status', title: 'Purchase statuses', noun: 'purchase status', description: 'How far a sales order has been bought.' },
  { key: 'item_type', title: 'Item types', noun: 'item type', description: 'Lines on sales and purchase orders.' },
  { key: 'courier_status', title: 'Courier statuses', noun: 'courier status', description: 'Documents sent by courier.' },
  { key: 'registration', title: 'Registration types', noun: 'registration type', description: 'Clients and vendors.' },
  { key: 'row_color', title: 'Row colours', noun: 'colour', description: 'To mark orders in the list.' },
]

function OptionList({ list, rows, onChanged }) {
  const [value, setValue] = useState('')
  const [color, setColor] = useState('#185494')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isColor = list.key === 'row_color'
  // The box's only label, like the department and team boxes in Users.
  const addLabel = isColor ? 'Name of the new colour' : `New ${list.noun}`

  async function run(action) {
    setBusy(true)
    setError('')
    try {
      await action()
      await onChanged()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add(event) {
    event.preventDefault()
    if (!value.trim()) { setError(isColor ? 'Name the colour.' : 'Type the new value.'); return }
    const ok = await run(() => (isColor ? settingsApi.addOption(list.key, color, value.trim()) : settingsApi.addOption(list.key, value.trim())))
    if (ok) setValue('')
  }

  return (
    <SettingsCard title={list.title} description={list.description}>
      <ul className="set-list">
        {rows.map((row, index) => (
          <li key={row.id} className={`set-list-item${row.hidden ? ' is-hidden' : ''}`}>
            {isColor && <span className="crm-swatch" style={{ background: row.value, width: 12, height: 12 }} aria-hidden="true" />}
            <span className="set-list-value" title={row.label || row.value}>{row.label || row.value}</span>
            {row.hidden && <span className="crm-tag">Hidden</span>}
            <span className="set-list-actions">
              <button type="button" className="crm-icon-btn" disabled={busy || index === 0} onClick={() => run(() => settingsApi.moveOption(row.id, -1))}
                aria-label={`Move ${row.label || row.value} up`} title="Move up"><span style={{ display: 'inline-grid', transform: 'rotate(180deg)' }}><Icon name="chevronDown" size={15} /></span></button>
              <button type="button" className="crm-icon-btn" disabled={busy || index === rows.length - 1} onClick={() => run(() => settingsApi.moveOption(row.id, 1))}
                aria-label={`Move ${row.label || row.value} down`} title="Move down"><Icon name="chevronDown" size={15} /></button>
              <button type="button" className="crm-icon-btn" disabled={busy} onClick={() => run(() => settingsApi.setOptionHidden(row.id, !row.hidden))}
                aria-label={`${row.hidden ? 'Show' : 'Hide'} ${row.label || row.value}`} title={row.hidden ? 'Show in dropdowns' : 'Hide from dropdowns'}>
                <Icon name={row.hidden ? 'eye' : 'eyeOff'} size={15} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form className="set-list-add" onSubmit={add}>
        {isColor && <input type="color" className="set-color-input" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Colour" />}
        <input className="crm-input" value={value} onChange={(event) => { setValue(event.target.value); setError('') }} maxLength={isColor ? 40 : 60}
          placeholder={addLabel} aria-label={addLabel} />
        <button type="submit" className="crm-btn crm-btn--secondary" disabled={busy}><Icon name="plus" size={15} /> Add</button>
      </form>
      {error && <p className="crm-hint is-error" style={{ margin: '-8px 20px 14px' }} role="alert">{error}</p>}
    </SettingsCard>
  )
}

function InlineRename({ name, label, onSave, onCancel }) {
  const [value, setValue] = useState(name)
  return (
    <form className="set-inline-edit" onSubmit={(event) => { event.preventDefault(); onSave(value.trim()) }}>
      <input className="crm-input" value={value} onChange={(event) => setValue(event.target.value)} maxLength={60} aria-label={label} autoFocus />
      <button type="submit" className="crm-btn crm-btn--primary crm-btn--sm">Save</button>
      <button type="button" className="crm-btn crm-btn--ghost crm-btn--sm" onClick={onCancel}>Cancel</button>
    </form>
  )
}

function MediaManager() {
  const [media, setMedia] = useState(null)
  const [subMedia, setSubMedia] = useState([])
  const [editing, setEditing] = useState(null)
  const [newMedia, setNewMedia] = useState('')
  const [newSub, setNewSub] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [mediaResult, subResult] = await Promise.all([
      supabase.from('media').select('*').order('name', { ascending: true }),
      supabase.from('sub_media').select('*').order('name', { ascending: true }),
    ])
    if (mediaResult.error || subResult.error) { setError((mediaResult.error || subResult.error).message); return }
    setMedia(mediaResult.data || [])
    setSubMedia(subResult.data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function run(action) {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      setEditing(null)
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const rowActions = (item, kind) => (
    <span className="set-list-actions">
      <button type="button" className="crm-icon-btn" disabled={busy} onClick={() => setEditing(`${kind}-${item.id}`)} aria-label={`Rename ${item.name}`} title="Rename">
        <Icon name="edit" size={15} />
      </button>
      <button type="button" className="crm-icon-btn" disabled={busy}
        onClick={() => run(() => (kind === 'media' ? settingsApi.saveMedia(item.id, null, !item.hidden) : settingsApi.saveSubMedia(item.id, null, null, !item.hidden)))}
        aria-label={`${item.hidden ? 'Show' : 'Hide'} ${item.name}`} title={item.hidden ? 'Show in pickers' : 'Hide from pickers'}>
        <Icon name={item.hidden ? 'eye' : 'eyeOff'} size={15} />
      </button>
    </span>
  )

  return (
    <SettingsCard title="Media and sub media" description="What vendors supply. Renaming updates every vendor at once; hidden ones stay on the vendors that have them.">
      {media === null && !error && <p className="set-status" style={{ margin: '10px 20px' }}>Loading…</p>}
      {(media || []).map((item) => {
        const subs = subMedia.filter((sub) => sub.media_id === item.id)
        return (
          <div key={item.id} className="set-media-group">
            <div className={`set-media-head${item.hidden ? ' is-hidden' : ''}`}>
              {editing === `media-${item.id}`
                ? <InlineRename name={item.name} label="Media name" onCancel={() => setEditing(null)} onSave={(name) => run(() => settingsApi.saveMedia(item.id, name))} />
                : <>
                    <span className="set-media-name">{item.name}</span>
                    {item.hidden && <span className="crm-tag">Hidden</span>}
                    {rowActions(item, 'media')}
                  </>}
            </div>
            <ul className="set-list">
              {subs.map((sub) => (
                <li key={sub.id} className={`set-list-item${sub.hidden ? ' is-hidden' : ''}`}>
                  {editing === `sub-${sub.id}`
                    ? <InlineRename name={sub.name} label="Sub media name" onCancel={() => setEditing(null)} onSave={(name) => run(() => settingsApi.saveSubMedia(sub.id, null, name))} />
                    : <>
                        <span className="set-list-value">{sub.name}</span>
                        {sub.hidden && <span className="crm-tag">Hidden</span>}
                        {rowActions(sub, 'sub')}
                      </>}
                </li>
              ))}
            </ul>
            <form className="set-list-add" onSubmit={async (event) => {
              event.preventDefault()
              const name = (newSub[item.id] || '').trim()
              if (!name) { setError(`Type a sub media for ${item.name}.`); return }
              if (await run(() => settingsApi.saveSubMedia(null, item.id, name))) setNewSub((current) => ({ ...current, [item.id]: '' }))
            }}>
              <input className="crm-input" value={newSub[item.id] || ''} onChange={(event) => setNewSub((current) => ({ ...current, [item.id]: event.target.value }))}
                maxLength={60} placeholder={`New sub media for ${item.name}`} aria-label={`New sub media for ${item.name}`} />
              <button type="submit" className="crm-btn crm-btn--secondary" disabled={busy}><Icon name="plus" size={15} /> Add</button>
            </form>
          </div>
        )
      })}
      <form className="set-list-add set-media-add" onSubmit={async (event) => {
        event.preventDefault()
        if (!newMedia.trim()) { setError('Type the new media type.'); return }
        if (await run(() => settingsApi.saveMedia(null, newMedia.trim()))) setNewMedia('')
      }}>
        <input className="crm-input" value={newMedia} onChange={(event) => setNewMedia(event.target.value)} maxLength={60} placeholder="New media type" aria-label="New media type" />
        <button type="submit" className="crm-btn crm-btn--secondary" disabled={busy}><Icon name="plus" size={15} /> Add</button>
      </form>
      {error && <p className="crm-hint is-error" style={{ margin: '0 20px 14px' }} role="alert">{error}</p>}
    </SettingsCard>
  )
}

export function ListsSettings() {
  const { lists, available, loaded } = useSettings()
  if (loaded && !available) return <><SectionHead title="Lists and media" /><NotReady /></>

  const refresh = () => loadSettings()
  return (
    <>
      <SectionHead title="Lists and media">
        The choices dropdowns offer. Values are hidden rather than deleted, because existing orders and vendors keep the ones they have.
      </SectionHead>
      <div className="set-lists">
        {LISTS.map((list) => (
          <div key={list.key} className="set-lists-item">
            <OptionList list={list} onChanged={refresh}
              rows={lists.filter((row) => row.list_key === list.key).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)} />
          </div>
        ))}
      </div>
      <div className="set-media"><MediaManager /></div>
    </>
  )
}
