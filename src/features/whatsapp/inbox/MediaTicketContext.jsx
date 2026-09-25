import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { waApi, waMediaUrl } from '../../../lib/api'

// Holds the current signed media ticket and hands out streamable media URLs.
// Fetched once after mount and refreshed well before the 6h expiry, so <img>/
// <video>/<iframe> can point straight at the media route (with the ticket) —
// streaming and Range-seeking, no blob buffering.
const MediaTicketContext = createContext({ ticket: null, srcFor: () => null })

export function MediaTicketProvider({ children }) {
  const [ticket, setTicket] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () => waApi.mediaTicket()
      .then((d) => { if (alive) setTicket(d.ticket) })
      .catch(() => {})
    load()
    const iv = setInterval(load, 5 * 60 * 60 * 1000) // refresh before the 6h ttl
    return () => { alive = false; clearInterval(iv) }
  }, [])

  const srcFor = useCallback((path) => waMediaUrl(path, ticket), [ticket])

  return (
    <MediaTicketContext.Provider value={{ ticket, srcFor }}>
      {children}
    </MediaTicketContext.Provider>
  )
}

export function useMediaSrc() {
  return useContext(MediaTicketContext)
}
