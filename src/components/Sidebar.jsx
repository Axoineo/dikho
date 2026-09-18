import { NavLink } from 'react-router-dom'

function SidebarIcon({ name, size = 20 }) {
  const icons = {
    dashboard: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
    clients: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-1.7a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V21" />
        <circle cx="9" cy="7" r="3.2" />
        <path d="M22 21v-1.6a4 4 0 0 0-3-3.85M16.5 4.3a3.2 3.2 0 0 1 0 6.2" />
      </svg>
    ),
    vendors: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5 12 4l9 5.5" />
        <path d="M5 10.5V20h14v-9.5" />
        <path d="M8 20v-6h8v6" />
      </svg>
    ),
    so: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
        <path d="M14 2v4" />
      </svg>
    ),
    po: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h5M8 12h8M8 16h6" />
        <circle cx="17" cy="8" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
    combinedpo: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="13" height="16" rx="2" />
        <rect x="9" y="3" width="13" height="16" rx="2" />
        <path d="M13 8h5M13 12h5M13 16h3" />
      </svg>
    ),
    invoice: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
    ),
    paymentlink: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
        <path d="M6 15h3M15 15h3" />
      </svg>
    ),
    advance: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12c0 1.66-.4 3.22-1.1 4.6" />
        <path d="M3.51 8.83A9 9 0 1 0 21 12" />
        <path d="M12 8v4l3 3" />
        <path d="M15 3l2 2-2 2" />
        <path d="M17 5H9" />
      </svg>
    ),
    receipt: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    ),
    paymentrequest: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9h.01" />
        <path d="M9 12c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3" />
        <path d="M12 18v-3" />
      </svg>
    ),
    courier: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 10h16M4 14h10" />
        <path d="M14 17l3 3 5-5" />
      </svg>
    ),
    chevron: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 18 6-6-6-6" />
      </svg>
    ),
    settings: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    logout: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    ),
  }
  return icons[name] || null
}

export function Sidebar({ collapsed, onOverlayClick, onLogout }) {
  const items = [
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/clients', label: 'Clients', icon: 'clients' },
    { to: '/vendors', label: 'Vendors', icon: 'vendors' },
    { to: '/sales-orders', label: 'Sales Orders', icon: 'so' },
    { to: '/purchase-orders', label: 'Purchase Orders', icon: 'po' },
    { to: '/invoices', label: 'Invoice Notification', icon: 'invoice' },
    { to: '/advance-payments', label: 'Advance Payment Receipt', icon: 'advance' },
    { to: '/payment-receipts', label: 'Payment Receipt', icon: 'receipt' },
    { to: '/payment-requests', label: 'Payment Request', icon: 'paymentrequest' },
    { to: '/courier', label: 'Document Courier', icon: 'courier' },
  ]

  function handleNav() {
    if (onOverlayClick) onOverlayClick()
  }

  return (
    <>
      {/* Mobile overlay backdrop */}
      {!collapsed && onOverlayClick && (
        <div className="sidebar-overlay" onClick={onOverlayClick} aria-hidden="true" />
      )}

      <aside className={`sidebar${collapsed ? ' sidebar-is-collapsed' : ''}`} aria-label="Main navigation">
        {/* Logo area */}
        <div className="sidebar-logo-area">
          <div className="sidebar-logo-full">
            <img src="/dikho-logo.png" alt="Dikho" className="sidebar-logo-img" />
          </div>
          <div className="sidebar-logo-icon">
            <img src="/fevicon.png" alt="Dikho" className="sidebar-favicon" />
          </div>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={handleNav}
              title={collapsed ? item.label : undefined}
            >
              {({ isActive }) => (
                <>
                  <span className="nav-icon">
                    <SidebarIcon name={item.icon} size={20} />
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {isActive && (
                    <span className="nav-chevron">
                      <SidebarIcon name="chevron" />
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-footer-divider" />
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item sidebar-footer-item${isActive ? ' active' : ''}`}
            onClick={handleNav}
            title={collapsed ? 'Settings' : undefined}
          >
            <span className="nav-icon">
              <SidebarIcon name="settings" size={20} />
            </span>
            <span className="nav-label">Settings</span>
          </NavLink>
          <button
            className="sidebar-logout-btn"
            onClick={onLogout}
            title={collapsed ? 'Log out' : undefined}
          >
            <span className="nav-icon">
              <SidebarIcon name="logout" size={18} />
            </span>
            <span className="nav-label">Log out</span>
          </button>
        </div>
      </aside>
    </>
  )
}
