import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

function SidebarIcon({ name, size = 20 }) {
  const icons = {
    whatsapp: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21l1.6-4.5A8.4 8.4 0 1 1 7.9 20L3 21Z" />
        <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5" />
      </svg>
    ),
    megaphone: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11v2a1 1 0 0 0 1 1h3l7 4V6l-7 4H4a1 1 0 0 0-1 1Z" />
        <path d="M18 9a3.5 3.5 0 0 1 0 6" />
      </svg>
    ),
    template: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 9v11" />
      </svg>
    ),
    contacts: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <circle cx="12" cy="10" r="2.6" />
        <path d="M8 17a4 4 0 0 1 8 0" />
      </svg>
    ),
    pulse: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
      </svg>
    ),
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

const WHATSAPP_ITEMS = [
  { to: '/whatsapp', label: 'Dashboard', icon: 'pulse', end: true },
  { to: '/whatsapp/contacts', label: 'Contacts', icon: 'contacts' },
  { to: '/whatsapp/campaigns', label: 'Campaigns', icon: 'megaphone' },
  { to: '/whatsapp/templates', label: 'Templates', icon: 'template' },
]

function WhatsAppGroup({ collapsed, onNavigate }) {
  const { pathname } = useLocation()
  const sectionActive = pathname.startsWith('/whatsapp')
  // Opens itself when you're inside the section, then stays under user control.
  const [open, setOpen] = useState(sectionActive)

  const expanded = open || sectionActive

  // The trigger reuses `.nav-item` from index.css rather than re-implementing
  // it in Tailwind — it is visually the same control as the items above it,
  // so sharing the class guarantees they stay identical.
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <button
        type="button"
        className={`nav-item ${sectionActive ? 'bg-[#185494]/[0.06] text-[#185494] dark:bg-[#185494]/[0.12] dark:text-[#5ba0e0]' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        title={collapsed ? 'WhatsApp Marketing' : undefined}
      >
        <span className="nav-icon"><SidebarIcon name="whatsapp" size={20} /></span>
        <span className="nav-label">WhatsApp Marketing</span>
        <span
          className={`inline-flex shrink-0 items-center text-[#185494]/35 transition-transform duration-200 dark:text-[#b4c3d7]/30
            ${expanded ? 'rotate-90' : ''}
            ${collapsed ? 'w-0 overflow-hidden opacity-0' : ''}`}
        >
          <SidebarIcon name="chevron" />
        </span>
      </button>

      <div
        hidden={!expanded}
        className={`ml-[21px] flex flex-col gap-0.5 border-l border-[#185494]/[0.14] pl-2.5
          dark:border-white/[0.08] ${collapsed ? 'hidden' : ''}`}
      >
        {WHATSAPP_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) => `flex min-h-[32px] items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5
              text-[12.8px] no-underline transition-colors
              ${isActive
                ? 'bg-[#185494]/10 font-semibold text-[#185494] dark:bg-[#185494]/[0.22] dark:text-[#5ba0e0]'
                : 'font-medium text-[#185494]/55 hover:bg-[#185494]/5 hover:text-[#185494]/85 dark:text-[#b4c3d7]/55 dark:hover:bg-white/5 dark:hover:text-[#c8d7e6]/90'}`}
          >
            {({ isActive }) => (
              <>
                <span className={`inline-flex shrink-0 ${isActive ? 'opacity-100' : 'opacity-70'}`}>
                  <SidebarIcon name={item.icon} size={17} />
                </span>
                <span className="nav-label">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  )
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

          <WhatsAppGroup collapsed={collapsed} onNavigate={handleNav} />
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
