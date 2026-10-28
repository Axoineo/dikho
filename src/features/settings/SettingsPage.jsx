// Settings: "Your account" for everyone, "Organization" for people with
// settings.manage. One page per section at /settings/<section>; on a phone
// /settings is the list and each section opens on its own.
import { Link, NavLink, useParams } from 'react-router-dom'
import { useAccess } from '../../lib/access'
import { Icon } from '../../components/Icon'
import { PageHeader } from '../../components/crm/CrmUi'
import { ProfileSettings, PreferencesSettings, SignInSettings } from './AccountSettings'
import { CompanySettings, RegionalSettings, ListsSettings } from './OrganizationSettings'
import './settings.css'

const ACCOUNT = [
  { key: 'profile', label: 'Profile', icon: 'user' },
  { key: 'preferences', label: 'Preferences', icon: 'sliders' },
  { key: 'security', label: 'Sign-in and security', icon: 'shield' },
]
const ORGANIZATION = [
  { key: 'company', label: 'Company', icon: 'building' },
  { key: 'regional', label: 'Regional', icon: 'globe' },
  { key: 'lists', label: 'Lists and media', icon: 'listBullet' },
]

export default function SettingsPage({ themeMode, onThemeChange }) {
  const { access, can } = useAccess()
  const { section } = useParams()
  const canManage = can('settings.manage')
  const known = [...ACCOUNT, ...ORGANIZATION].some((item) => item.key === section)
  const active = known ? section : 'preferences'
  const isOrganization = ORGANIZATION.some((item) => item.key === active)

  let content
  if (isOrganization && !canManage) {
    content = (
      <div className="crm-note crm-note--info">
        <Icon name="shield" size={17} />
        <div>Organization settings are changed by Owners and Admins. Ask one of them if something here needs to change.</div>
      </div>
    )
  } else if (active === 'profile') content = <ProfileSettings access={access} />
  else if (active === 'security') content = <SignInSettings access={access} />
  else if (active === 'company') content = <CompanySettings />
  else if (active === 'regional') content = <RegionalSettings />
  else if (active === 'lists') content = <ListsSettings />
  else content = <PreferencesSettings access={access} themeMode={themeMode} onThemeChange={onThemeChange} />

  const link = (item) => (
    <NavLink key={item.key} to={`/settings/${item.key}`} className={() => `set-nav-link${item.key === active && known ? ' active' : ''}${!section && item.key === 'preferences' ? ' active' : ''}`}>
      <Icon name={item.icon} size={17} /> {item.label}
      <span className="set-nav-out set-nav-drill"><Icon name="chevron" size={14} /></span>
    </NavLink>
  )

  return (
    <div className={`crm-page set-page ${section ? 'is-section' : 'is-index'}`}>
      <PageHeader title="Settings" subtitle={canManage ? 'Your own preferences, and how Dikho works for everyone.' : 'Your profile, preferences and sign-in.'} />
      <div className="set-shell">
        <nav className="set-nav" aria-label="Settings">
          <div className="set-nav-group">Your account</div>
          {ACCOUNT.map(link)}
          {canManage && (
            <>
              <div className="set-nav-group">Organization</div>
              {ORGANIZATION.map(link)}
            </>
          )}
          {can('users.view') && (
            <NavLink to="/users" className="set-nav-link">
              <Icon name="users" size={17} /> Users and roles <span className="set-nav-out"><Icon name="chevron" size={14} /></span>
            </NavLink>
          )}
        </nav>
        <div className="set-content">
          <Link to="/settings" className="crm-btn crm-btn--ghost crm-btn--sm set-back">
            <span style={{ display: 'inline-grid', transform: 'rotate(180deg)' }}><Icon name="chevron" size={15} /></span> Settings
          </Link>
          {content}
        </div>
      </div>
    </div>
  )
}
