import { useEffect, useRef, useState } from 'react'
import { apiUrl } from '../../lib/api'

// Shows one received message. The frame loads it from the API's /render route
// (a ten-minute ticket for this message), which serves it on the API origin
// with its own policy: sandboxed to an opaque origin, no network loads (remote
// images stay blocked), and one hash-pinned script that only reports the
// content's height. Nothing in the message can run, reach this page, or call
// home. The height arrives by postMessage and is accepted only from this
// frame's own window, and only as a number.
export default function EmailFrame({ renderPath, title }) {
  const ref = useRef(null)
  const [height, setHeight] = useState(120)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    function onMessage(event) {
      if (event.source !== ref.current?.contentWindow) return
      const h = event.data?.type === 'dikho-email-height' ? Number(event.data.height) : NaN
      if (Number.isFinite(h)) setHeight(Math.min(Math.max(Math.ceil(h) + 4, 40), 20000))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="em-paper">
      <iframe
        ref={ref}
        className="em-frame"
        title={title}
        src={apiUrl(renderPath)}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        style={{ height, opacity: loaded ? 1 : 0 }}
      />
      {!loaded && <div className="em-skeleton" style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />}
    </div>
  )
}
