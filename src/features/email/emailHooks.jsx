import { useCallback, useEffect, useRef, useState } from 'react'
import { emailApi } from './emailApi'

// Data and feedback hooks shared by the Email Hub screens.

/** The mailboxes this person can use or set up (em_list_accounts). */
export function useMailboxes() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setData(await emailApi.accounts())
      setError('')
    } catch (err) {
      setError(err.message || 'Could not load mailboxes.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { reload() }, [reload])
  return { data, error, loading, reload }
}

export function useEmailStatus() {
  const [status, setStatus] = useState(null)
  useEffect(() => {
    let alive = true
    emailApi.status().then((s) => { if (alive) setStatus(s) }, () => { if (alive) setStatus(null) })
    return () => { alive = false }
  }, [])
  return status
}

/** A short-lived message at the bottom of the screen. */
export function useToast() {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)
  const show = useCallback((text) => {
    clearTimeout(timer.current)
    setToast(text)
    timer.current = setTimeout(() => setToast(null), 3800)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  const node = toast ? <div className="em-toast" role="status" aria-live="polite">{toast}</div> : null
  return [node, show]
}
