import { useEffect, useState } from 'react'
import { inAndroidApp } from '../lib/androidShell'

const BACK_ONLINE_MS = 3000

/* The connection notice along the bottom of every page, as video sites show it:
 * a dark "No connection" bar for as long as the browser is offline, then a green
 * "Back online" bar for a few seconds once the connection returns. The page under
 * it stays as it was, so whatever was already loaded can still be read. */
export default function ConnectionStatus() {
  // The Android app draws its own bar over every screen, this page included.
  if (inAndroidApp) return null
  return <WebConnectionStatus />
}

function WebConnectionStatus() {
  // navigator.onLine can say "online" on a network without internet, but "offline"
  // is reliable, and that is the case this bar is for.
  const [notice, setNotice] = useState(() => (navigator.onLine === false ? 'offline' : null))

  useEffect(() => {
    let timer
    const down = () => {
      clearTimeout(timer)
      setNotice('offline')
    }
    const up = () => {
      clearTimeout(timer)
      setNotice('online')
      timer = setTimeout(() => setNotice(null), BACK_ONLINE_MS)
    }
    window.addEventListener('offline', down)
    window.addEventListener('online', up)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('offline', down)
      window.removeEventListener('online', up)
    }
  }, [])

  return (
    <div className="connection-status" role="status" aria-live="polite">
      {notice === 'offline' && (
        <div className="connection-bar is-offline">
          <ConnectionIcon off />
          <span>No connection. Showing what was already loaded.</span>
        </div>
      )}
      {notice === 'online' && (
        <div className="connection-bar is-online">
          <ConnectionIcon />
          <span>Back online</span>
        </div>
      )}
    </div>
  )
}

function ConnectionIcon({ off = false }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <path d="M12 20h.01" />
      {off && <path d="M2 2l20 20" />}
    </svg>
  )
}
