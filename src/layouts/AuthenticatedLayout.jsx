import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import BrandLoader, { AppReady } from '../components/BrandLoader'
import RouteBoundary from '../components/RouteBoundary'
import { Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Sidebar } from '../components/Sidebar'
import { MAX_SESSION_MS, INACTIVITY_MS, WARN_BEFORE_MS } from '../app/constants'
import Login from '../features/auth/Login'
import AccessDenied from '../components/AccessDenied'
import { AccessContext, canOpen, sectionFor } from '../lib/access'
import { apiPost } from '../lib/api'
import { STAFF_EVENTS, emitStaffEvent } from '../lib/staffBus'
import LiveAssistProvider from '../features/live-assist/LiveAssistProvider'

// Why a session ended, shown on the sign-in screen afterwards.
const SIGNOUT_NOTICE_KEY = 'dikho-signout-notice'
const SIGNOUT_NOTICES = {
  forced: 'An administrator signed you out of Dikho.',
  suspended: 'Your access to Dikho has been suspended. Contact your administrator.',
  archived: 'Your Dikho account has been closed. Contact your administrator.',
  ended: 'Your session was ended. Please sign in again.',
}
const HEARTBEAT_MS = 60_000
// A heartbeat is sent only if the person has used the page this recently, so
// "Active now" means someone is at the screen, not just that a tab is open.
const HEARTBEAT_ACTIVE_WINDOW_MS = 2 * 60_000

export default function AuthenticatedLayout() {
  const [session, setSession] = useState(undefined)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (window.innerWidth <= 768) return false
    // The toggle is now the only control that sets this, so forgetting it on
    // every reload would make the collapsed rail impossible to keep.
    const saved = localStorage.getItem('dikho-sidebar')
    return saved === null ? true : saved === 'open'
  })
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  const [showSessionWarning, setShowSessionWarning] = useState(false)
  const [warnSecsLeft, setWarnSecsLeft] = useState(300)
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('dikho-theme') || 'system')

  useEffect(() => {
    // Internal app: show the full product name in the tab (public pages use "Dikho").
    document.title = 'Dikho CRM'
  }, [])

  useEffect(() => {
    function applyTheme(mode) {
      let resolved = mode
      if (mode === 'system') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      }
      document.documentElement.dataset.theme = resolved
    }
    applyTheme(themeMode)
    if (themeMode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => applyTheme('system')
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }
  }, [themeMode])

  // The theme is saved to the person's profile too, so it follows them to
  // any device; localStorage keeps the first paint right on this one.
  function handleThemeChange(mode) {
    localStorage.setItem('dikho-theme', mode)
    setThemeMode(mode)
    supabase.rpc('set_my_theme', { p_theme: mode }).then(() => {}, () => {})
  }

  // Access: who this is and what they may do, from public.my_access(). Not a
  // security boundary (the API and RLS enforce the same permissions); this
  // turns their answers into navigation, page guards and explanations.
  //   accessState: 'checking' | 'granted' | 'not_staff' | 'suspended' | 'archived'
  //                | 'unreachable' | 'not_ready'
  const [access, setAccess] = useState(null)
  const [accessState, setAccessState] = useState('checking')
  const accessUserRef = useRef(null)

  const signOutWithNotice = useCallback((reason) => {
    try { sessionStorage.setItem(SIGNOUT_NOTICE_KEY, SIGNOUT_NOTICES[reason] ?? SIGNOUT_NOTICES.ended) } catch { /* private mode */ }
    // The server session is already gone; only this browser's copy is left.
    supabase.auth.signOut({ scope: 'local' })
  }, [])

  const loadAccess = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_access')
    if (error) {
      // An expired or revoked token comes back as an auth error.
      if (error.code === 'PGRST301' || error.code === 'PGRST303' || /jwt/i.test(error.message ?? '')) {
        signOutWithNotice('ended')
        return
      }
      // my_access() does not exist: this dashboard is newer than the
      // database (the update has not been applied yet). Not a network fault.
      const state = error.code === 'PGRST202' ? 'not_ready' : 'unreachable'
      // On first load offer a retry; on a background re-check keep what was
      // already granted.
      setAccessState((current) => (['checking', 'unreachable', 'not_ready'].includes(current) ? state : current))
      return
    }
    const status = data?.status
    if (status === 'session_ended' || status === 'signed_out') { signOutWithNotice('ended'); return }
    if (status === 'active') {
      setAccess(data)
      setAccessState('granted')
      if (data.theme && data.theme !== localStorage.getItem('dikho-theme')) {
        localStorage.setItem('dikho-theme', data.theme)
        setThemeMode(data.theme)
      }
      return
    }
    setAccess(null)
    setAccessState(status === 'suspended' || status === 'archived' ? status : 'not_staff')
  }, [signOutWithNotice])

  useEffect(() => {
    if (!session) { setAccess(null); setAccessState('checking'); accessUserRef.current = null; return }
    // A token refresh delivers a new session object for the same person:
    // re-read access quietly instead of flashing the loader.
    if (accessUserRef.current !== session.user.id) {
      accessUserRef.current = session.user.id
      setAccessState('checking')
    }
    loadAccess()
  }, [session, loadAccess])

  const lastActiveRef = useRef(Date.now())
  const sessionStartRef = useRef(null)
  const showWarningRef = useRef(false)

  useEffect(() => {
    function onResize() {
      const mobile = window.innerWidth <= 768
      setIsMobile(mobile)
      if (mobile) setSidebarOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function toggleSidebar() {
    setSidebarOpen((open) => {
      // Only the desktop rail is a persistent preference; on mobile the same
      // state drives a transient drawer and should not be remembered.
      if (window.innerWidth > 768) localStorage.setItem('dikho-sidebar', open ? 'closed' : 'open')
      return !open
    })
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) sessionStartRef.current = Date.now()
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s && !sessionStartRef.current) sessionStartRef.current = Date.now()
      if (!s) sessionStartRef.current = null
    })
    return () => subscription.unsubscribe()
  }, [])

  // Where this tab is, as a short section key for the activity heartbeat.
  const { pathname } = useLocation()
  const sectionRef = useRef(null)
  const granted = accessState === 'granted'

  const beat = useCallback(async () => {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - lastActiveRef.current > HEARTBEAT_ACTIVE_WINDOW_MS) return
    const { data, error } = await supabase.rpc('touch_session', { p_section: sectionRef.current })
    if (error) return
    if (data === 'session_ended' || data === 'signed_out') signOutWithNotice('ended')
    else if (data === 'no_access') loadAccess()
  }, [loadAccess, signOutWithNotice])

  useEffect(() => {
    if (!granted) return
    beat()
    const timer = setInterval(beat, HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [granted, beat])

  // A page change reports the new section, a moment after it settles.
  useEffect(() => {
    const section = sectionFor(pathname)
    if (!granted || section === sectionRef.current) { sectionRef.current = section; return }
    sectionRef.current = section
    const timer = setTimeout(beat, 1500)
    return () => clearTimeout(timer)
  }, [pathname, granted, beat])

  // The person's private channel: the Worker announces here when an
  // administrator ends this session, so the screen clears at once rather
  // than on the next request (which the database already refuses).
  const myId = access?.user_id
  const mySession = access?.session_id
  useEffect(() => {
    if (!granted || !myId) return
    const channel = supabase
      .channel(`staff:${myId}`, { config: { private: true } })
      .on('broadcast', { event: 'signed_out' }, ({ payload }) => {
        if (payload?.session_id && payload.session_id !== mySession) return
        signOutWithNotice(payload?.reason ?? 'forced')
      })
    // Live Assist notices ride the same channel; the provider listens on the bus.
    for (const event of STAFF_EVENTS) {
      channel.on('broadcast', { event }, ({ payload }) => emitStaffEvent(event, payload))
    }
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [granted, myId, mySession, signOutWithNotice])

  // Where this session signed in from (Cloudflare's approximate location),
  // recorded once per session for "last login" in User Management.
  useEffect(() => {
    if (!granted || !mySession) return
    try {
      if (localStorage.getItem('dikho-session-recorded') === mySession) return
      localStorage.setItem('dikho-session-recorded', mySession)
    } catch { /* storage blocked: record anyway, the server is idempotent */ }
    apiPost('/me/session', {}).catch(() => {})
  }, [granted, mySession])

  // Activity tracking + inactivity / max-session enforcement
  useEffect(() => {
    if (!session) return

    function resetActivity() {
      lastActiveRef.current = Date.now()
    }

    const events = ['mousemove', 'keydown', 'pointerdown', 'scroll']
    events.forEach((ev) => window.addEventListener(ev, resetActivity, { passive: true }))

    const tick = setInterval(() => {
      const now = Date.now()
      const idle = now - lastActiveRef.current
      const sessionAge = sessionStartRef.current ? now - sessionStartRef.current : 0

      // Hard max-session cap (security boundary is the Supabase JWT, this is UX defence)
      if (sessionAge >= MAX_SESSION_MS) {
        supabase.auth.signOut()
        return
      }

      // Inactivity logout
      if (idle >= INACTIVITY_MS) {
        supabase.auth.signOut()
        return
      }

      // 5-minute warning zone
      const timeUntilLogout = INACTIVITY_MS - idle
      if (timeUntilLogout <= WARN_BEFORE_MS) {
        const secs = Math.max(1, Math.ceil(timeUntilLogout / 1000))
        setWarnSecsLeft(secs)
        if (!showWarningRef.current) {
          showWarningRef.current = true
          setShowSessionWarning(true)
        }
      } else if (showWarningRef.current) {
        showWarningRef.current = false
        setShowSessionWarning(false)
      }
    }, 1000)

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, resetActivity))
      clearInterval(tick)
    }
  }, [session])

  function staySignedIn() {
    lastActiveRef.current = Date.now()
    showWarningRef.current = false
    setShowSessionWarning(false)
  }

  async function logout() {
    await supabase.auth.signOut()
  }

  if (session === undefined) {
    return <BrandLoader />
  }
  if (!session) {
    return (
      <>
        <Login onLogin={setSession} />
        <AppReady />
      </>
    )
  }

  if (accessState === 'checking') {
    return <BrandLoader />
  }
  if (accessState !== 'granted') {
    const copy = {
      suspended: ['Access suspended', 'An administrator has suspended this account. Contact them if you think this is a mistake.'],
      archived: ['Account closed', 'This account is no longer part of the workspace. Contact an administrator if you need access again.'],
      not_staff: ['No access to this workspace', 'You are signed in, but this account has not been added as a user. Ask an administrator to add you, then sign in again.'],
      unreachable: ['Can\'t reach Dikho', 'Your access could not be checked. Check your internet connection and try again.'],
      not_ready: ['Dikho is being updated', 'This version of Dikho needs a database update that has not been applied yet. Try again in a few minutes, or tell your administrator.'],
    }[accessState] ?? []
    return (
      <div className="session-warning-overlay" role="alertdialog" aria-modal="true" aria-labelledby="no-access-title">
        <div className="session-warning-box">
          <strong id="no-access-title">{copy[0]}</strong>
          <p>{copy[1]}</p>
          {accessState === 'unreachable' || accessState === 'not_ready'
            ? <button className="primary-button" onClick={() => { setAccessState('checking'); loadAccess() }}>Try again</button>
            : <button className="primary-button" onClick={logout}>Sign out</button>}
        </div>
        <AppReady />
      </div>
    )
  }

  const collapsed = !sidebarOpen
  const warnMins = Math.floor(warnSecsLeft / 60)
  const warnSecs = String(warnSecsLeft % 60).padStart(2, '0')

  return (
    <AccessContext.Provider value={access}>
    <LiveAssistProvider>
    <div className={`app-shell${collapsed ? ' sidebar-is-closed' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        onToggle={toggleSidebar}
        onOverlayClick={isMobile ? () => setSidebarOpen(false) : null}
        onLogout={logout}
        session={session}
      />

      {/* No header: the shell is exactly sidebar + main content, both full
          viewport height. The toggle moved into the sidebar, account and
          settings moved to the foot of the sidebar, and the full-screen
          button is gone — the layout is already edge to edge. */}
      <div className="app-main">
        <main className="workspace">
          <RouteBoundary>
            <Suspense fallback={<BrandLoader />}>
              {canOpen(access, pathname)
                ? <Outlet context={{ session, access, themeMode, onThemeChange: handleThemeChange, reloadAccess: loadAccess }} />
                : <AccessDenied />}
              <AppReady />
            </Suspense>
          </RouteBoundary>
        </main>
      </div>

      {showSessionWarning && (
        <div className="session-warning-overlay" role="dialog" aria-modal="true" aria-label="Session expiry warning">
          <div className="session-warning-box">
            <strong>Still there?</strong>
            <p>
              You'll be signed out in{' '}
              <span className="session-warning-timer">{warnMins}:{warnSecs}</span>{' '}
              due to inactivity.
            </p>
            <button className="primary-button" onClick={staySignedIn}>Stay signed in</button>
          </div>
        </div>
      )}
    </div>
    </LiveAssistProvider>
    </AccessContext.Provider>
  )
}
