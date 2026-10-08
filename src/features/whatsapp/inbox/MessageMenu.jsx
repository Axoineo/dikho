import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EMOJIS, QUICK_REACTIONS } from './emoji'

// The menu on one message: a row of quick reactions, then Reply, Copy,
// Forward, Pin, Star and Delete. Rendered into document.body with fixed
// coordinates, because the thread scrolls and clips its overflow; it closes
// on scroll, resize, Escape or a click outside.

const ICONS = {
  reply: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>,
  forward: <><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5V20" /></>,
  pin: <><path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" /><path d="M12 16v5" /></>,
  unpin: <><path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" /><path d="M12 16v5" /><path d="M4 4l16 16" /></>,
  star: <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />,
  unstar: <><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" /><path d="M4 4l16 16" /></>,
  delete: <><path d="M4 7h16" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l.9 12.5h9.2L17.5 7" /></>,
}

export function MessageMenu({ anchor, alignRight, reactions, myReaction, items, onReact, onAction, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: -9999, left: -9999 })
  const [allEmoji, setAllEmoji] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    const below = anchor.bottom + 4 + height <= window.innerHeight - margin
    const top = below ? anchor.bottom + 4 : Math.max(margin, anchor.top - 4 - height)
    const rawLeft = alignRight ? anchor.right - width : anchor.left
    const left = Math.min(Math.max(margin, rawLeft), window.innerWidth - width - margin)
    setPos({ top, left })
  }, [anchor, alignRight, allEmoji])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <div
        ref={ref}
        role="menu"
        aria-label="Message options"
        style={{ top: pos.top, left: pos.left }}
        className="fixed z-[61] w-[236px] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_24px_rgba(11,20,26,0.18)]"
      >
        {reactions.enabled && (
          <div className="border-b border-line px-1.5 py-1.5">
            <div className="flex items-center justify-between">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  title={myReaction === emoji ? 'Remove reaction' : `React ${emoji}`}
                  aria-label={myReaction === emoji ? `Remove reaction ${emoji}` : `React ${emoji}`}
                  aria-pressed={myReaction === emoji}
                  onClick={() => onReact(myReaction === emoji ? '' : emoji)}
                  className={`grid h-8 w-8 place-items-center rounded-full text-[19px] leading-none transition-transform hover:scale-110
                    ${myReaction === emoji ? 'bg-inbox-chip' : ''}`}
                >
                  {emoji}
                </button>
              ))}
              <button
                type="button"
                title="More reactions"
                aria-label="More reactions"
                aria-expanded={allEmoji}
                onClick={() => setAllEmoji((v) => !v)}
                className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-inbox-control hover:text-ink"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            </div>
            {allEmoji && (
              <div className="mt-1 grid grid-cols-7 gap-0.5">
                {EMOJIS.map((emoji) => (
                  <button key={emoji} type="button" onClick={() => onReact(myReaction === emoji ? '' : emoji)} aria-label={`React ${emoji}`}
                    className={`rounded-lg p-1 text-[18px] leading-none hover:bg-inbox-row-hover ${myReaction === emoji ? 'bg-inbox-chip' : ''}`}>{emoji}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {!reactions.enabled && reactions.reason && (
          <p className="m-0 border-b border-line px-3.5 py-2 text-[12px] leading-snug text-muted">{reactions.reason}</p>
        )}
        <div className="p-1.5">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => onAction(item.key)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13.5px] font-medium transition-colors hover:bg-inbox-row-hover
                ${item.danger ? 'text-danger' : 'text-ink'}`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">{ICONS[item.key]}</svg>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body,
  )
}
