import { useEffect, useRef, useState } from 'react'
import { PAGE_ACCESS, SECTION_LABELS } from '../../lib/access'
import HelperChat from './HelperChat'

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'them'

// Pages the helper can suggest. The employee's screen only offers "Go" for
// one their own access includes.
const SUGGESTIBLE = PAGE_ACCESS
  .filter((p) => !['/settings', '/dashboard'].includes(p.path))
  .map((p) => ({ path: p.path, label: SECTION_LABELS[p.section] ?? p.path }))

// Where the video's picture actually sits inside the element: the frame is
// letterboxed (object-fit: contain), so the edges of the element are not the
// edges of the employee's screen.
function contentRect(video) {
  const box = video.getBoundingClientRect()
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null
  const scale = Math.min(box.width / vw, box.height / vh)
  const width = vw * scale
  const height = vh * scale
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height }
}

function normalise(video, event) {
  const r = contentRect(video)
  if (!r) return null
  const x = (event.clientX - r.left) / r.width
  const y = (event.clientY - r.top) / r.height
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y }
}

export default function HelperViewer({ helper, chat, chatActions, endMessages, onSend, onEnd, onClose }) {
  const { session, phase, reason, stream, section } = helper
  const who = firstName(session.employee_name)
  const videoRef = useRef(null)
  const inputRef = useRef(null)
  const lastSent = useRef(0)
  const [ripple, setRipple] = useState(null)
  const [suggested, setSuggested] = useState('')
  const [left, setLeft] = useState(null)
  // The spot last clicked on their screen: the next message is pinned there.
  const [pin, setPin] = useState(null)

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream ?? null
  }, [stream])

  useEffect(() => {
    if (phase !== 'waiting') return
    const tick = () => setLeft(Math.max(0, Math.ceil((Date.parse(session.expires_at) - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [phase, session.expires_at])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && phase === 'ended') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onClose])

  function move(e) {
    const now = performance.now()
    if (now - lastSent.current < 50) return
    lastSent.current = now
    const point = normalise(videoRef.current, e)
    onSend(point ? { t: 'pointer', ...point } : { t: 'pointer_hide' })
  }

  function click(e) {
    const point = normalise(videoRef.current, e)
    if (!point) return
    onSend({ t: 'highlight', ...point })
    const box = e.currentTarget.getBoundingClientRect()
    setRipple({ x: e.clientX - box.left, y: e.clientY - box.top, at: Date.now() })
    setPin({ ...point, at: Date.now() })
    if (!chat.open) chatActions.open()
  }

  // Type straight after clicking; a pin nobody uses lapses after 20 seconds.
  useEffect(() => {
    if (!pin) return undefined
    inputRef.current?.focus()
    const t = setTimeout(() => setPin(null), 20_000)
    return () => clearTimeout(t)
  }, [pin])
  useEffect(() => { if (phase !== 'live') setPin(null) }, [phase])

  const chatSend = {
    ...chatActions,
    send: (text, at) => {
      chatActions.send(text, at)
      setPin(null)
    },
  }

  function suggest(path) {
    setSuggested(path)
    if (path) onSend({ t: 'goto', path })
  }

  const live = phase === 'live' && stream
  return (
    <div className="la-viewer" role="dialog" aria-modal="true" aria-labelledby="la-viewer-title">
      <header className="la-viewer-head">
        <div>
          <h2 id="la-viewer-title">Live Assist with {session.employee_name}</h2>
          <span className="la-viewer-status">
            {phase === 'waiting' && `Waiting for ${who} to accept${left != null ? ` (${left} s)` : ''}`}
            {phase === 'connecting' && `${who} accepted. Connecting…`}
            {phase === 'live' && (section ? `Live · ${who} is on ${SECTION_LABELS[section] ?? section}` : 'Live')}
            {phase === 'ended' && 'Ended'}
          </span>
        </div>
        <div className="la-viewer-tools">
          {phase === 'live' && (
            <label className="la-suggest">
              <span className="la-sr">Suggest a page</span>
              <select value={suggested} onChange={(e) => suggest(e.target.value)} aria-label="Suggest a page">
                <option value="">Suggest a page…</option>
                {SUGGESTIBLE.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}
              </select>
            </label>
          )}
          {phase === 'ended'
            ? <button type="button" className="primary-button" onClick={onClose}>Close</button>
            : <button type="button" className="la-end" onClick={onEnd}>{phase === 'waiting' ? 'Cancel' : 'End Live Assist'}</button>}
        </div>
      </header>

      <div className={`la-viewer-body${chat.open ? '' : ' is-chat-closed'}`}>
        <div className="la-viewer-main">
          <div className="la-stage">
            {/* One video element for the whole session, so the stream stays
                attached whichever message is showing over it. */}
            <div
              className={`la-screen${live ? '' : ' is-idle'}`}
              onMouseMove={live ? move : undefined}
              onMouseLeave={live ? () => onSend({ t: 'pointer_hide' }) : undefined}
              onClick={live ? click : undefined}
            >
              <video ref={videoRef} autoPlay playsInline muted />
              {ripple && live && <span key={ripple.at} className="la-ripple" style={{ left: ripple.x, top: ripple.y }} aria-hidden="true" />}
            </div>
            {!live && (
              <div className="la-stage-message">
                {phase === 'ended'
                  ? <p>{endMessages[reason] ?? 'Live Assist has ended.'}</p>
                  : <p className="la-waiting"><span className="la-spinner" aria-hidden="true" />{phase === 'waiting' ? `Asking ${who} to share their Dikho tab…` : 'Setting up the connection…'}</p>}
              </div>
            )}
          </div>
          {live && (
            <p className="la-viewer-hint">
              Move your mouse over their screen to point. Click something to highlight it, then type to pin a
              note beside it. You cannot click or type for them.
            </p>
          )}
        </div>
        <HelperChat
          who={who}
          chat={chat}
          live={Boolean(live)}
          ended={phase === 'ended'}
          pin={live ? pin : null}
          onClearPin={() => setPin(null)}
          actions={chatSend}
          inputRef={inputRef}
        />
      </div>
    </div>
  )
}
