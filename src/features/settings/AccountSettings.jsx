// "Your account" pages: Profile, Preferences, Sign-in and security. Everyone
// has these; nothing here changes anyone else's Dikho.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usersApi } from '../users/usersApi'
import { SessionsTab } from '../users/UserProfilePage'
import { roleLabel, developerLabel } from '../users/userFormat'
import { canOpen, EMAIL_HUB_BUILD } from '../../lib/access'
import { formatDisplayDate } from '../../lib/format'
import { applyPreferences, settingsApi, useSettings } from '../../lib/settings'
import { Segmented } from '../../components/crm/CrmUi'
import { SectionHead, SettingsCard, SettingRow, StatusLine } from './SettingsParts'

// Pages someone may choose to open first, in sidebar order.
const START_PAGES = [
  ['/clients', 'Clients'],
  ['/leads', 'Leads'],
  ['/vendors', 'Vendors'],
  ['/sales-orders', 'Sales orders'],
  ['/purchase-orders', 'Purchase orders'],
  ['/whatsapp/inbox', 'WhatsApp inbox'],
  ['/whatsapp', 'WhatsApp overview'],
  ...(EMAIL_HUB_BUILD ? [['/email/inbox', 'Email inbox']] : []),
  ['/users', 'Users'],
  ['/settings', 'Settings'],
]

function useMe() {
  const [member, setMember] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    usersApi.me().then((data) => { setMember(data || null); setError('') }, (err) => setError(err.message || 'Could not load your profile.'))
  }, [])
  useEffect(() => { load() }, [load])
  return { member, error, reload: load }
}

export function ProfileSettings({ access }) {
  const { member, error } = useMe()
  const person = member || access || {}
  const rows = [
    ['Name', person.full_name],
    ['Email', person.email],
    ['Phone', person.phone && `+${String(person.phone).replace(/^\+/, '')}`],
    ['Role', [roleLabel(person), developerLabel(person.developer_level)].filter(Boolean).join(' · ')],
    ['Designation', member?.designation],
    ['Department', [member?.department, member?.team].filter(Boolean).join(' · ')],
    ['Reports to', member?.reporting_manager],
    ['Employee ID', member?.employee_id],
    ['Joined', member?.joining_date && formatDisplayDate(member.joining_date)],
  ].filter(([, value]) => value)

  return (
    <>
      <SectionHead title="Profile">
        How you appear in Dikho. Your administrator keeps these details up to date; ask them if something is wrong.
      </SectionHead>
      <SettingsCard>
        {rows.map(([label, value]) => (
          <SettingRow key={label} title={label}><span className="set-value">{value}</span></SettingRow>
        ))}
      </SettingsCard>
      {error && <p className="set-status is-error">{error}</p>}
      {access?.user_id && (
        <p className="set-status">
          <Link to={`/users/${access.user_id}`}>Open your full profile</Link>, including what you have access to.
        </p>
      )}
    </>
  )
}

export function PreferencesSettings({ access, themeMode, onThemeChange }) {
  const { preferences } = useSettings()
  const [status, setStatus] = useState(null)

  async function save(changes) {
    const previous = preferences
    const next = { ...preferences, ...changes }
    Object.keys(next).forEach((key) => { if (next[key] === null) delete next[key] })
    applyPreferences(next)
    setStatus({ text: 'Saving…' })
    try {
      applyPreferences(await settingsApi.setMyPreferences(changes))
      setStatus({ tone: 'ok', text: 'Saved. Your preferences follow you to every device.' })
    } catch (error) {
      if (error.code === 'PGRST202') {
        setStatus({ tone: 'ok', text: 'Saved on this device. After the next update it will follow you to every device.' })
      } else {
        applyPreferences(previous)
        setStatus({ tone: 'error', text: error.message })
      }
    }
  }

  function changeTheme(mode) {
    onThemeChange(mode)
    setStatus({ tone: 'ok', text: 'Saved. Your theme follows you to every device.' })
  }

  const startOptions = START_PAGES.filter(([path]) => canOpen(access, path))

  return (
    <>
      <SectionHead title="Preferences">How Dikho looks and behaves for you. Changes save as you make them.</SectionHead>
      <SettingsCard title="Appearance">
        <SettingRow title="Theme" hint="Light, dark, or the same as your device." id="pref-theme">
          <Segmented label="Theme" value={themeMode} onChange={changeTheme}
            options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} />
        </SettingRow>
        <SettingRow title="Table density" hint="Compact rows fit more clients, vendors and orders on the screen." id="pref-density">
          <Segmented label="Table density" value={preferences.density === 'compact' ? 'compact' : 'comfortable'}
            onChange={(value) => save({ density: value })}
            options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Working with lists">
        <SettingRow title="Start page" hint="Where Dikho opens after you sign in." id="pref-start">
          <select className="crm-select" aria-labelledby="pref-start" value={preferences.start_page || ''}
            onChange={(event) => save({ start_page: event.target.value || null })}>
            <option value="">The first page you can open</option>
            {startOptions.map(([path, label]) => <option key={path} value={path}>{label}</option>)}
          </select>
        </SettingRow>
        <SettingRow title="Rows per page" hint="How many clients, vendors or orders a list shows before the next page." id="pref-rows">
          <Segmented label="Rows per page" value={String(preferences.page_size || 25)}
            onChange={(value) => save({ page_size: Number(value) })}
            options={[{ value: '25', label: '25' }, { value: '50', label: '50' }, { value: '100', label: '100' }]} />
        </SettingRow>
      </SettingsCard>
      <StatusLine status={status} />
    </>
  )
}

export function SignInSettings({ access }) {
  const { member, error, reload } = useMe()
  return (
    <>
      <SectionHead title="Sign-in and security">
        The devices you are signed in on. Sign one out if you no longer use it or do not recognise it.
      </SectionHead>
      {error && <p className="set-status is-error">{error}</p>}
      {/* The same cards as the sessions list in Users, so the page reads as one. */}
      <div className="um-sessions set-sessions">
        {member?.sessions
          ? <SessionsTab member={member} isSelf canEnd onChanged={reload} />
          : !error && <p className="set-status">Loading your devices…</p>}
        <section className="um-card">
          <header><h3>What administrators can see</h3></header>
          <p className="set-card-copy" style={{ margin: 0 }}>
            Administrators can see when you were last active, which part of Dikho you are using, and the
            approximate city and device of each sign-in. They can also sign you out of a device. With Live
            Assist, and only after you accept, someone helping you can see your Dikho tab and point at things.
            You always see a banner while it is on and can stop it at any time; they cannot click or type for
            you, and nothing is recorded.
          </p>
        </section>
      </div>
      {access?.user_id && <p className="set-status">Signed in as {access.email || access.phone || access.full_name}.</p>}
    </>
  )
}
