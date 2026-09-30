import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

/* Outlined 24px glyphs on a shared 1.7 stroke, so the rail reads as one set.
   Each one names the thing rather than the money: a cart for what we sell, a
   bag for what we buy, a rupee for what we ask for, a truck for what we ship. */
function SidebarIcon({ name, size = 20 }) {
  const icons = {
    /* Redrawn as an outline rather than the filled brand glyph. Sitting in a
       column of 1.7-stroke line icons, a solid shape read as a logo dropped
       into a nav rather than a nav item — it was the one row that looked
       pasted in. Same bubble-and-handset silhouette, same stroke weight. */
    whatsapp: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.4 11.8a8.3 8.3 0 0 1-12.4 7.2l-4.5 1.2 1.3-4.4A8.3 8.3 0 1 1 20.4 11.8Z" />
        <path d="M9.3 8.9c.25-.33.72-.3.88.08l.6 1.36c.1.23.06.5-.12.67l-.45.44a6.3 6.3 0 0 0 2.5 2.5l.44-.45c.17-.18.44-.22.67-.12l1.36.6c.38.16.41.63.08.88a2.5 2.5 0 0 1-2 .43 7.4 7.4 0 0 1-4.4-4.4 2.5 2.5 0 0 1 .44-1.99Z" />
      </svg>
    ),

    /* ---- Main nav ---------------------------------------------------- */
    dashboard: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.2" y="3.2" width="7.4" height="17.6" rx="2" />
        <rect x="13.4" y="3.2" width="7.4" height="7.4" rx="2" />
        <rect x="13.4" y="13.4" width="7.4" height="7.4" rx="2" />
      </svg>
    ),
    clients: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9.2" cy="8" r="3.4" />
        <path d="M2.8 19.8a6.4 6.4 0 0 1 12.8 0" />
        <path d="M16.4 5.1a3.4 3.4 0 0 1 0 5.8" />
        <path d="M17.6 14.2a6.4 6.4 0 0 1 3.6 5.6" />
      </svg>
    ),
    vendors: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.6 20V6.4a1.6 1.6 0 0 1 1.6-1.6h6.2a1.6 1.6 0 0 1 1.6 1.6V20" />
        <path d="M13 10.8h5.4A1.6 1.6 0 0 1 20 12.4V20" />
        <path d="M2.4 20h19.2" />
        <path d="M6.6 8.6h3.4M6.6 12h3.4M6.6 15.4h3.4M16 14.4h1.4M16 17.4h1.4" />
      </svg>
    ),
    so: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.8 4h2.3l2.4 10.6h9.2L19 7.2H6" />
        <circle cx="9" cy="19" r="1.5" />
        <circle cx="16.8" cy="19" r="1.5" />
      </svg>
    ),
    po: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.6 7.6h14.8l-1.1 12.8H5.7Z" />
        <path d="M8.8 10.2V6.9a3.2 3.2 0 0 1 6.4 0v3.3" />
      </svg>
    ),
    invoice: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 3.4H6.4A1.6 1.6 0 0 0 4.8 5v14a1.6 1.6 0 0 0 1.6 1.6h5.2" />
        <path d="M13 3.4 18.2 8.6v2.2" />
        <path d="M12.6 3.8v5h4.8" />
        <path d="M8.2 11.4h3.2M8.2 14.6h2.6" />
        <path d="M21.4 19.6c0-.9-1.1-.9-1.1-3a2.1 2.1 0 1 0-4.2 0c0 2.1-1.1 2.1-1.1 3Z" />
        <path d="M17.6 21.2h1.2" />
      </svg>
    ),
    advance: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.2 8.4A2.4 2.4 0 0 1 5.6 6h10.2" />
        <rect x="3.2" y="8.4" width="17.6" height="11.4" rx="2.4" />
        <circle cx="16.4" cy="14.1" r="1.3" />
        <path d="M8.4 3.4 12 6 8.4 8.6" />
      </svg>
    ),
    receipt: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3.4v17.2l2.3-1.3 2.3 1.3 2.4-1.3 2.3 1.3 2.4-1.3 1.3.8V3.4Z" />
        <path d="m8.6 11.6 2.1 2.1 4.2-4.2" />
      </svg>
    ),
    paymentrequest: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4.6" y="2.8" width="14.8" height="18.4" rx="2.2" />
        <path d="M8.8 7.2h6.4" />
        <path d="M8.8 10.2h6.4" />
        <path d="M12.8 7.2c1.8 0 2.7 1.1 2.7 2.8s-.9 2.8-2.7 2.8H8.8l4.8 4.2" />
      </svg>
    ),
    courier: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.6 7.4a1.6 1.6 0 0 1 1.6-1.6h8.2a1.6 1.6 0 0 1 1.6 1.6v9.2H2.6Z" />
        <path d="M14 10.4h3.4l3 3.2v3H14Z" />
        <circle cx="6.8" cy="18.2" r="1.7" />
        <circle cx="17.4" cy="18.2" r="1.7" />
        <path d="M8.6 16.6h6.8" />
      </svg>
    ),

    /* ---- WhatsApp sub-items ------------------------------------------ */
    pulse: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.2 20.2v-6" />
        <path d="M9.4 20.2V8.6" />
        <path d="M14.6 20.2v-8.4" />
        <path d="M19.8 20.2V4.4" />
      </svg>
    ),
    inbox: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.2 13.6h4.2l1.3 2.4h6.6l1.3-2.4h4.2" />
        <path d="M5.8 4.8h12.4l2.6 8.8v3.8a1.8 1.8 0 0 1-1.8 1.8H5a1.8 1.8 0 0 1-1.8-1.8v-3.8Z" />
      </svg>
    ),
    contacts: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4.6" y="3" width="15" height="18" rx="2.2" />
        <circle cx="12.1" cy="10" r="2.5" />
        <path d="M8.4 17a3.8 3.8 0 0 1 7.4 0" />
        <path d="M2.6 7.4h2M2.6 12h2M2.6 16.6h2" />
      </svg>
    ),
    megaphone: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.6v2.8a1 1 0 0 0 1 1h3l7.2 4.2V5.4L7 9.6H4a1 1 0 0 0-1 1Z" />
        <path d="M18 8.8a4 4 0 0 1 0 6.4" />
        <path d="M7 14.4v3.2a1.6 1.6 0 0 0 3.2 0v-1.4" />
      </svg>
    ),
    template: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        {/* Inner rules float clear of the frame on every side. The earlier
            draw ran a divider the full width and a stem to the bottom edge,
            so the strokes fused with the border at four points and the glyph
            filled in at rail size. Three inset lines also say "message
            template" more plainly than a split panel did. */}
        <rect x="3.2" y="4" width="17.6" height="16" rx="2.8" />
        <path d="M6.8 8.6h10.4" />
        <path d="M6.8 12h10.4" />
        <path d="M6.8 15.4h6.2" />
      </svg>
    ),

    /* ---- Chrome ------------------------------------------------------ */
    caret: (
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 18 6-6-6-6" />
      </svg>
    ),
    /* Panel + arrow, pointing the way the rail is about to move. The divider
       floats clear of the frame rather than meeting it at both ends — run to
       the edges it reads as a table cell, not a panel. Carried a touch
       heavier than the nav glyphs (2.0 vs 1.7) so the one control in the
       header holds its own against the wordmark beside it. */
    panelCollapse: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="3.5" width="19" height="17" rx="3.6" />
        <path d="M9.5 7.6v8.8" />
        <path d="m16.9 9.3-2.7 2.7 2.7 2.7" />
      </svg>
    ),
    panelExpand: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="3.5" width="19" height="17" rx="3.6" />
        <path d="M9.5 7.6v8.8" />
        <path d="m14.2 9.3 2.7 2.7-2.7 2.7" />
      </svg>
    ),
    settings: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    logout: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.4 20.6H5.4a2 2 0 0 1-2-2V5.4a2 2 0 0 1 2-2h4" />
        <path d="m15.8 16.4 4.4-4.4-4.4-4.4" />
        <path d="M20.2 12H9.4" />
      </svg>
    ),
  }
  return icons[name] || null
}

/* Header + five rows + padding. Used only to keep the hover panel on screen
   when the group sits near the bottom of a short window. */
const FLYOUT_H = 226

/* Must match the .is-leaving animations in index.css: the panel stays mounted
   for this long after it is dismissed so it can animate out. */
const EXIT_MS = 150
/* How long a panel survives the pointer leaving it, so you can cross the
   gutter between the rail and the panel without it closing underneath you. */
const HOVER_GRACE = 160

const WHATSAPP_ITEMS = [
  { to: '/whatsapp', label: 'Dashboard', icon: 'pulse', end: true },
  { to: '/whatsapp/inbox', label: 'Inbox', icon: 'inbox' },
  { to: '/whatsapp/contacts', label: 'Contacts', icon: 'contacts' },
  { to: '/whatsapp/campaigns', label: 'Campaigns', icon: 'megaphone' },
  { to: '/whatsapp/templates', label: 'Templates', icon: 'template' },
]

function WhatsAppGroup({ collapsed, onNavigate, onShowTip, onHideTip, onOpenFlyout, onCloseFlyout }) {
  const { pathname } = useLocation()
  const panelRef = useRef(null)
  const sectionActive = pathname.startsWith('/whatsapp')
  // Closed by default: the five sub-items only appear once the group is opened.
  // It opens itself on the way *into* the section (deep link, or a link from
  // another page), but never forces itself back open afterwards, so the
  // caret can always close it again.
  const [open, setOpen] = useState(sectionActive)
  const wasSectionActive = useRef(sectionActive)
  useEffect(() => {
    if (sectionActive && !wasSectionActive.current) setOpen(true)
    wasSectionActive.current = sectionActive
  }, [sectionActive])

  /* This group sits last in the rail, so opening it pushes five rows below the
     fold — on a short window they simply were not there.
     scrollIntoView({block:'nearest'}) stops the instant the panel technically
     fits, which parks the last row hard against the bottom edge and still
     reads as cut off. Scroll the nav by hand instead, to the panel's bottom
     plus a margin, so the group finishes clear of the edge. */
  useEffect(() => {
    if (!open || collapsed) return
    const id = requestAnimationFrame(() => {
      const panel = panelRef.current
      const nav = panel?.closest('.sidebar-nav')
      if (!panel || !nav) return
      const BREATHING_ROOM = 16
      const wantVisibleTo = panel.offsetTop + panel.offsetHeight + BREATHING_ROOM
      const target = Math.min(wantVisibleTo - nav.clientHeight, nav.scrollHeight - nav.clientHeight)
      if (target > nav.scrollTop) nav.scrollTo({ top: target, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(id)
  }, [open, collapsed])

  return (
    <div className="nav-group">
      {/* Plain .nav-item, with the badge and caret as .nav-badge/.nav-caret
          rather than collapsed-conditional utility classes: everything that
          hides on the rail now fades on one shared CSS timing instead of
          being switched off in a single frame by a JS prop. */}
      <button
        type="button"
        className={`nav-item${sectionActive ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-tip="WhatsApp"
        onMouseEnter={collapsed ? onOpenFlyout : onShowTip}
        onMouseLeave={collapsed ? onCloseFlyout : onHideTip}
      >
        <span className="nav-icon"><SidebarIcon name="whatsapp" size={20} /></span>
        {/* "WhatsApp" everywhere this control appears — label, rail tooltip and
            flyout header. The formal name needs 137px and the row leaves less
            than that for label *and* badge, so it truncated to "WhatsApp
            Marketi..."; having the tooltip and panel then say the longer name
            just made one control answer to two. Page titles still read
            "WhatsApp Marketing". */}
        <span className="nav-label">WhatsApp</span>
        {/* WhatsApp green (#25d366, the same value as .wa-mark), so the badge
            belongs to the module it sits on rather than to the brand blue used
            for the active nav state. The green only works as text on the dark
            sidebar — on white it is 1.98:1 — so light mode uses a deeper green
            of the same family over the same tint. */}
        <span className="nav-badge">Beta</span>
        <span className={`nav-caret${open ? ' is-open' : ''}`}>
          <SidebarIcon name="caret" />
        </span>
      </button>

      {/* Mounted only while open, rather than hidden with the `hidden`
          attribute: the UA's `[hidden] { display: none }` loses to a `display`
          declaration on the same element, and Tailwind's preflight — off in
          this project — is not there to close that gap, so the panel stayed
          visible in every state. The collapsed rail has no room for it. */}
      {/* Stays mounted while the rail collapses so it can animate shut with
          everything else; hidden from assistive tech once closed, since the
          same five links are then reachable through the rail's flyout. */}
      {open && (
        <div className="nav-subwrap" ref={panelRef} aria-hidden={collapsed || undefined}>
        <div className="nav-sublist">
          {WHATSAPP_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              tabIndex={collapsed ? -1 : undefined}
              className={({ isActive }) => `nav-subitem${isActive ? ' active' : ''}`}
            >
              <span className="nav-subicon"><SidebarIcon name={item.icon} size={17} /></span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </div>
        </div>
      )}
    </div>
  )
}

/* Who is signed in, derived from the Supabase session. Supabase only
   guarantees `email`; a name and picture are whatever the identity provider
   put in user_metadata, so both are optional and fall back to initials. The
   email is used to derive a name but is never displayed. */
function readAccount(session) {
  const user = session?.user
  const meta = user?.user_metadata || {}
  const email = user?.email || ''
  const raw = meta.full_name || meta.name || meta.user_name || (email ? email.split('@')[0] : 'Account')
  const name = raw.charAt(0).toUpperCase() + raw.slice(1)
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('') || 'A'
  return { name, initials, avatarUrl: meta.avatar_url || meta.picture || '' }
}

/* Bottom of the rail: avatar + name, with the settings gear beside it — and
   above it once collapsed. The popover holds log out and nothing else;
   settings already has a permanent control right here. */
function SidebarAccount({ collapsed, session, onLogout, onShowTip, onHideTip }) {
  const { name, initials, avatarUrl } = readAccount(session)
  /* null when closed; { leaving } while mounted, so the panel can animate out
     instead of being pulled from the DOM the moment it is dismissed. */
  const [menu, setMenu] = useState(null)
  const menuOpen = !!menu && !menu.leaving
  const menuTimer = useRef(null)
  const footerRef = useRef(null)

  useEffect(() => () => clearTimeout(menuTimer.current), [])

  const openMenu = useCallback(() => {
    clearTimeout(menuTimer.current)
    setMenu({ leaving: false })
  }, [])
  const closeMenu = useCallback((afterMs = 0) => {
    clearTimeout(menuTimer.current)
    menuTimer.current = setTimeout(() => {
      setMenu((m) => (m ? { leaving: true } : null))
      menuTimer.current = setTimeout(() => setMenu(null), EXIT_MS)
    }, afterMs)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e) {
      if (!footerRef.current?.contains(e.target)) closeMenu(0)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') closeMenu(0)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen, closeMenu])

  // The rail collapsing out from under an open popover would leave it floating
  // beside a narrow strip with no anchor — so that close is immediate.
  useEffect(() => {
    clearTimeout(menuTimer.current)
    setMenu(null)
  }, [collapsed])

  /* On the rail the panel opens on hover rather than click, matching the
     WhatsApp flyout right above it — two adjacent controls that both spawn a
     panel should not need two different gestures. Closing is deferred so the
     pointer can cross the gutter into the panel without it vanishing. */
  const hoverOpen = () => { if (collapsed) openMenu() }
  const hoverClose = () => { if (collapsed) closeMenu(HOVER_GRACE) }
  const hoverKeep = () => {
    clearTimeout(menuTimer.current)
    setMenu((m) => (m && m.leaving ? { leaving: false } : m))
  }

  return (
    <div className="sidebar-footer" ref={footerRef}>
      <div className="sidebar-footer-divider" />

      {menu && (
        <div
          className={`sidebar-account-menu${menu.leaving ? ' is-leaving' : ''}`}
          role="menu"
          onMouseEnter={hoverKeep}
          onMouseLeave={hoverClose}
        >
          <div className="sidebar-account-menu-head">{name}</div>
          <button
            type="button"
            role="menuitem"
            className="sidebar-account-menu-item is-danger"
            onClick={() => { closeMenu(0); onLogout() }}
          >
            <SidebarIcon name="logout" size={17} />
            Log out
          </button>
        </div>
      )}

      <div className="sidebar-account-row">
        <button
          type="button"
          className="sidebar-account-main"
          onClick={() => (menuOpen ? closeMenu(0) : openMenu())}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onMouseEnter={hoverOpen}
          onMouseLeave={hoverClose}
        >
          {avatarUrl
            ? <img className="sidebar-avatar" src={avatarUrl} alt="" />
            : <span className="sidebar-avatar" aria-hidden="true">{initials}</span>}
          <span className="sidebar-account-name nav-label">{name}</span>
        </button>
        <NavLink
          to="/settings"
          className={({ isActive }) => `sidebar-account-settings${isActive ? ' active' : ''}`}
          data-tip="Settings"
          onMouseEnter={onShowTip}
          onMouseLeave={onHideTip}
          aria-label="Settings"
        >
          <SidebarIcon name="settings" size={19} />
        </NavLink>
      </div>
    </div>
  )
}

/* True for the length of one width animation. Every hover affordance on the
   rail is suspended while it is set: the pointer is sitting on the toggle when
   a collapse starts and the rail then slides out from under it, so :hover flips
   mid-flight and the logo blinks. Nothing should react to hover until the rail
   has stopped moving. Kept at 320ms to clear the 300ms transition. */
function useCollapseGate(collapsed) {
  const [animating, setAnimating] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }   // not on mount
    setAnimating(true)
    const t = setTimeout(() => setAnimating(false), 320)
    return () => clearTimeout(t)
  }, [collapsed])
  return animating
}

/* The collapsed rail's labels. A CSS-only tooltip cannot work here: the row
   lives inside .sidebar-nav, and a scroll container clips both axes, so the
   bubble would be cut off at the rail's edge no matter how it is positioned.
   Reading the row's box and drawing one fixed-position bubble outside the
   <aside> is the way past that. */
function useRailTooltip(enabled) {
  const [tip, setTip] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const show = useCallback((e) => {
    if (!enabled) return
    const el = e.currentTarget
    const text = el.dataset.tip
    if (!text) return
    clearTimeout(timer.current)
    const r = el.getBoundingClientRect()
    setTip({ text, top: r.top + r.height / 2, leaving: false })
  }, [enabled])

  // Flag it leaving first, unmount only once the animation has played.
  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setTip((t) => (t ? { ...t, leaving: true } : null))
    timer.current = setTimeout(() => setTip(null), EXIT_MS)
  }, [])

  // Expanding, or collapsing, must not strand a bubble on screen — and that
  // one is abrupt on purpose, since its anchor is moving.
  useEffect(() => {
    if (!enabled) { clearTimeout(timer.current); setTip(null) }
  }, [enabled])

  return { tip, show, hide }
}

/* Which edges of the scroller still have content past them, so the rail can
   fade a cut-off row instead of slicing it in half. */
function useEdgeFade(ref) {
  const [fade, setFade] = useState('none')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    function update() {
      const atTop = el.scrollTop <= 2
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
      setFade(atTop && atBottom ? 'none' : atTop ? 'bottom' : atBottom ? 'top' : 'both')
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    // Content height changes when the WhatsApp group opens; the box size
    // changes when the rail collapses. Both move the edges.
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // The WhatsApp panel now closes by transition, not by unmounting, so its
    // height lands after the animation — neither observer above would catch
    // it and the fade would keep describing the old content height.
    el.addEventListener('transitionend', update)
    return () => {
      el.removeEventListener('scroll', update)
      el.removeEventListener('transitionend', update)
      mo.disconnect()
      ro.disconnect()
    }
  }, [ref])
  return fade
}

export function Sidebar({ collapsed, onToggle, onOverlayClick, onLogout, session }) {
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

  const navRef = useRef(null)
  const fade = useEdgeFade(navRef)
  const animating = useCollapseGate(collapsed)
  const railActive = collapsed && !animating
  const { tip, show: showTip, hide: hideTip } = useRailTooltip(railActive)

  /* Collapsing hid the WhatsApp sub-items outright — the group's panel only
     renders when the rail is open, so on the rail those five pages had no
     route in at all. They get a hover panel instead. Unlike the tooltip this
     one is interactive, so closing is deferred: the pointer has to cross the
     gap between the rail and the panel, and an immediate close would drop it
     mid-journey. */
  const [flyout, setFlyout] = useState(null)
  const flyoutTimer = useRef(null)
  const openFlyout = useCallback((e) => {
    if (!railActive) return
    clearTimeout(flyoutTimer.current)
    const r = e.currentTarget.getBoundingClientRect()
    // Anchor to the row, but never let the panel run off the bottom.
    setFlyout({ top: Math.min(r.top - 6, window.innerHeight - FLYOUT_H - 12), leaving: false })
  }, [railActive])
  const closeFlyout = useCallback(() => {
    clearTimeout(flyoutTimer.current)
    flyoutTimer.current = setTimeout(() => {
      setFlyout((f) => (f ? { ...f, leaving: true } : null))
      flyoutTimer.current = setTimeout(() => setFlyout(null), EXIT_MS)
    }, HOVER_GRACE)
  }, [])
  // Coming back mid-fade cancels the exit rather than letting it finish.
  const keepFlyout = useCallback(() => {
    clearTimeout(flyoutTimer.current)
    setFlyout((f) => (f && f.leaving ? { ...f, leaving: false } : f))
  }, [])
  useEffect(() => {
    if (!railActive) setFlyout(null)
    return () => clearTimeout(flyoutTimer.current)
  }, [railActive])

  function handleNav() {
    hideTip()
    setFlyout(null)
    if (onOverlayClick) onOverlayClick()
  }

  return (
    <>
      {/* Mobile overlay backdrop */}
      {!collapsed && onOverlayClick && (
        <div className="sidebar-overlay" onClick={onOverlayClick} aria-hidden="true" />
      )}

      <aside
        className={`sidebar${collapsed ? ' sidebar-is-collapsed' : ''}${animating ? ' is-animating' : ''}`}
        aria-label="Main navigation"
      >
        {/* Logo left, collapse control at the far right. On the rail the two
            swap roles: the mark stands in for the logo, and the toggle sits
            invisibly on top of it, surfacing on hover. */}
        <div className="sidebar-top">
          {/* Both windows point at the same SVG — one request, one cached
              decode — so the mark on the rail is not a lookalike of the
              wordmark's D, it IS the wordmark's D, left exactly where it
              was while "ikho" fades off the end. */}
          <div className="sidebar-brand" role="img" aria-label="Dikho">
            <span className="sidebar-brand-mark">
              <img src="/dikho-logo.svg" alt="" aria-hidden="true" />
            </span>
            <span className="sidebar-brand-word">
              <img src="/dikho-logo.svg" alt="" aria-hidden="true" />
            </span>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <SidebarIcon name={collapsed ? 'panelExpand' : 'panelCollapse'} size={22} />
          </button>
        </div>

        <nav className="sidebar-nav" ref={navRef} data-fade={fade}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={handleNav}
              data-tip={item.label}
              onMouseEnter={showTip}
              onMouseLeave={hideTip}
            >
              <span className="nav-icon">
                <SidebarIcon name={item.icon} size={20} />
              </span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}

          <WhatsAppGroup
            collapsed={collapsed}
            onNavigate={handleNav}
            onShowTip={showTip}
            onHideTip={hideTip}
            onOpenFlyout={openFlyout}
            onCloseFlyout={closeFlyout}
          />
        </nav>

        <SidebarAccount
          collapsed={collapsed}
          session={session}
          onLogout={onLogout}
          onShowTip={showTip}
          onHideTip={hideTip}
        />
      </aside>

      {tip && (
        <div
          className={`sidebar-tip${tip.leaving ? ' is-leaving' : ''}`}
          style={{ top: tip.top }}
          role="tooltip"
        >
          {tip.text}
        </div>
      )}

      {flyout && (
        <div
          className={`sidebar-flyout${flyout.leaving ? ' is-leaving' : ''}`}
          style={{ top: flyout.top }}
          onMouseEnter={keepFlyout}
          onMouseLeave={closeFlyout}
        >
          <div className="sidebar-flyout-head">WhatsApp</div>
          {WHATSAPP_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={handleNav}
              className={({ isActive }) => `sidebar-flyout-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-subicon"><SidebarIcon name={item.icon} size={17} /></span>
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </>
  )
}
