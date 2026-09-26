import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

function SidebarIcon({ name, size = 20 }) {
  const icons = {
    whatsapp: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.88 11.9L4 20l4.2-1.1a7.9 7.9 0 0 0 3.84.98h.01a7.94 7.94 0 0 0 5.55-13.56ZM12.05 18.5h-.01a6.56 6.56 0 0 1-3.35-.92l-.24-.14-2.49.65.66-2.43-.16-.25a6.55 6.55 0 1 1 12.14-3.48 6.56 6.56 0 0 1-6.55 6.57Zm3.6-4.91c-.2-.1-1.17-.58-1.35-.64-.18-.07-.31-.1-.44.1-.13.2-.5.64-.62.77-.11.13-.23.15-.43.05-.2-.1-.83-.31-1.59-.98-.59-.52-.98-1.17-1.1-1.37-.11-.2-.01-.31.09-.41.09-.09.2-.23.3-.35.1-.12.13-.2.2-.34.07-.13.03-.25-.02-.35-.05-.1-.44-1.07-.61-1.46-.16-.38-.32-.33-.44-.34l-.38-.01c-.13 0-.34.05-.52.25-.18.2-.68.67-.68 1.63s.7 1.9.8 2.03c.1.13 1.39 2.12 3.37 2.98.47.2.84.32 1.12.42.47.15.9.13 1.24.08.38-.06 1.17-.48 1.33-.94.17-.46.17-.85.12-.94-.05-.08-.18-.13-.38-.23Z" />
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
  { to: '/whatsapp/inbox', label: 'Inbox', icon: 'whatsapp' },
  { to: '/whatsapp/calls', label: 'Missed calls', icon: 'phoneMissed' },
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
        {/* "WhatsApp", not "WhatsApp Marketing": the full name needs 137px and
            the 248px row leaves ~155px for label *and* badge, so the two
            together truncated the label to "WhatsApp Marketi…". The six
            sub-items below make the module obvious, page titles still read
            "WhatsApp Marketing", and the collapsed-rail tooltip keeps the
            full name. */}
        <span className="nav-label">WhatsApp</span>
        {/* WhatsApp green (#25d366, the same value as .wa-mark), so the badge
            belongs to the module it sits on rather than to the brand blue used
            for the active nav state. The green itself only works as text on
            the dark sidebar — on white it is 1.98:1 — so light mode uses a
            deeper green of the same family over the same tint. Measured:
            5.9:1 on white, 6.3:1 on the dark sidebar. Hidden on the collapsed
            rail like the chevron; there is no room beside a bare icon. */}
        <span
          className={`ml-1.5 shrink-0 rounded-full bg-[#25d366]/[0.14] px-1.5 py-[1px] text-[9.5px]
            font-extrabold uppercase leading-[15px] tracking-[0.5px] text-[#0a6b40]
            dark:bg-[#25d366]/[0.16] dark:text-[#25d366]
            ${collapsed ? 'hidden' : ''}`}
        >
          Beta
        </span>
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
            <img src="/dikho-logo.svg" alt="Dikho" className="sidebar-logo-img" />
          </div>
          <div className="sidebar-logo-icon">
            <img src="/favicon.svg" alt="Dikho" className="sidebar-favicon" />
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
