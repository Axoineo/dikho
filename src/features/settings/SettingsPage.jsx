import { Link } from 'react-router-dom'
import { useAccess } from '../../lib/access'

export default function SettingsPage({ themeMode, onThemeChange }) {
  const { access } = useAccess()
  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <span className="page-kicker">PREFERENCES</span>
          <h1>Settings</h1>
          <p>Manage your application preferences.</p>
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
          Appearance
        </h3>
        <p className="settings-card-desc">
          Choose how Dikho looks to you. Select a single theme, or sync with your system settings.
          Your choice is saved to your account, so it follows you to any device.
        </p>
        <div className="theme-switcher">
          <button
            className={themeMode === 'light' ? 'active' : ''}
            onClick={() => onThemeChange('light')}
          >
            <span className="theme-switcher-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </span>
            Light
          </button>
          <button
            className={themeMode === 'dark' ? 'active' : ''}
            onClick={() => onThemeChange('dark')}
          >
            <span className="theme-switcher-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </span>
            Dark
          </button>
          <button
            className={themeMode === 'system' ? 'active' : ''}
            onClick={() => onThemeChange('system')}
          >
            <span className="theme-switcher-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </span>
            System
          </button>
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.1 7.5 9.5 4.4-1.4 7.5-5.1 7.5-9.5V6Z" />
          </svg>
          Your account and privacy
        </h3>
        <p className="settings-card-desc">
          Administrators can see when you were last active, which section of Dikho you are using,
          and the approximate location (city) and device of each sign-in. They can also sign you
          out of a device. With Live Assist, and only after you accept, someone helping you can see
          this Dikho tab and point at things. You always see a banner while it is on and can stop it
          at any time; they cannot click or type for you, and nothing is recorded.
        </p>
        {access?.user_id && (
          <p className="settings-card-desc">
            <Link to={`/users/${access.user_id}?tab=sessions`}>See where you are signed in</Link>
          </p>
        )}
      </div>
    </div>
  )
}
