import { useEffect, useState } from 'react'

/* The Dikho mark, running the same sequence as the boot splash: the D alone,
 * then the letters leaving it one at a time, then the dot rising into place.
 *
 * Both the glyph paths and the keyframes live in index.html, because the splash
 * has to paint before any JavaScript arrives and so cannot depend on the bundle.
 * This component references those paths by id instead of shipping a second copy
 * — about 6 KB of path data that would otherwise sit in the main chunk — which
 * is also why the splash's <svg id="dk-defs"> block is never removed from the
 * DOM. Element order matters: the dot is painted before the word so the i hides
 * it until it clears the stem.
 */
const STALL_MS = 8000

export default function BrandLoader() {
  /* A chunk request that never settles cannot be retried — the browser keys
   * module requests by URL — so after a while the only way out is a fresh load.
   * Without this the animation just loops, which reads as a hung page. */
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), STALL_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="brand-loader" role="status" aria-label="Loading">
      <svg className="dk-mark" viewBox="0 0 1241 420" aria-hidden="true">
        <g className="dk-logo">
          <use className="dk-dot" href="#dk-dot" />
          <use className="dk-d" href="#dk-d" />
          <g className="dk-word" clipPath="url(#dk-tunnel)">
            {['i', 'k', 'h', 'o'].map((glyph, n) => (
              <use key={glyph} className={`dk-g dk-g${n + 1}`} href={`#dk-${glyph}`} />
            ))}
          </g>
        </g>
      </svg>

      {stalled && (
        <div className="brand-loader-stall">
          <span>Still loading &mdash; your connection may have dropped.</span>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
    </div>
  )
}

/* Dismisses the boot splash. Rendered inside the Suspense boundary so it only
 * mounts once the route's chunk has resolved, and waits a frame so the handover
 * happens after the real content has painted rather than before it. */
export function AppReady() {
  useEffect(() => {
    let handed = false
    const hand = () => {
      if (handed) return
      handed = true
      window.__dikhoAppReady?.()
    }

    // The frame is the normal path — it lets the route paint first. The timer
    // is the backstop: requestAnimationFrame is throttled to a standstill in a
    // background tab, and without it a page opened in one would sit behind the
    // splash until the 10s failsafe in index.html fired.
    const frame = requestAnimationFrame(hand)
    const timer = setTimeout(hand, 150)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [])

  return null
}
