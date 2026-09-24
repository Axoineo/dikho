import { Suspense, useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Sidebar } from '../components/Sidebar'
import { Icon } from '../components/Icon'
import { MAX_SESSION_MS, INACTIVITY_MS, WARN_BEFORE_MS } from '../app/constants'
import Login from '../features/auth/Login'

export default function AuthenticatedLayout() {
  const [session, setSession] = useState(undefined)
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768)
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

  function handleThemeChange(mode) {
    localStorage.setItem('dikho-theme', mode)
    setThemeMode(mode)
  }

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
    return <div className="loading-screen">Loading...</div>
  }
  if (!session) {
    return <Login onLogin={setSession} />
  }

  const collapsed = !sidebarOpen
  const warnMins = Math.floor(warnSecsLeft / 60)
  const warnSecs = String(warnSecsLeft % 60).padStart(2, '0')

  return (
    <div className={`app-shell${collapsed ? ' sidebar-is-closed' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        onOverlayClick={isMobile ? () => setSidebarOpen(false) : null}
        onLogout={logout}
      />

      <div className="app-main">
        <header className="app-header">
          <button className="header-menu" onClick={() => setSidebarOpen((v) => !v)} aria-label="Toggle sidebar">
            <Icon name="menu" size={21} />
          </button>
          <div className="header-spacer" />
          <div className="header-right">
            <button className="header-icon" aria-label="Full screen" onClick={() => {
              if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()
              else document.exitFullscreen?.()
            }}><Icon name="expand" size={19} /></button>
            <button className="header-icon" aria-label="Account"><Icon name="user" size={20} /></button>
          </div>
        </header>

        <main className="workspace">
          <Suspense fallback={<div className="loading-screen">Loading...</div>}>
            <Outlet context={{ session, themeMode, onThemeChange: handleThemeChange }} />
          </Suspense>
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
  )
}
