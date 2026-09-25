import { useCallback, useEffect, useState } from 'react'
import { useMediaSrc } from './MediaTicketContext'
import { formatFileSize, formatTime } from './inboxUtils'

function IconBtn({ title, onClick, disabled, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 w-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 disabled:opacity-30"
    >
      {children}
    </button>
  )
}

// Full-screen viewer for a conversation's media, with prev/next paging, zoom
// (images), and download. Media streams directly (signed ticket URL) so video
// plays/seeks and PDFs render in a native <iframe> with free zoom/print.
export function MediaLightbox({ items, index, onIndexChange, onClose }) {
  const item = items[index]
  const { srcFor } = useMediaSrc()
  const [zoom, setZoom] = useState(1)

  useEffect(() => { setZoom(1) }, [item?.media_url])

  const prev = useCallback(() => onIndexChange(Math.max(0, index - 1)), [index, onIndexChange])
  const next = useCallback(() => onIndexChange(Math.min(items.length - 1, index + 1)), [index, items.length, onIndexChange])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, prev, next])

  if (!item) return null
  const src = srcFor(item.media_url)
  const mime = item.media_mime || ''
  const isImage = mime.startsWith('image/')
  const isVideo = mime.startsWith('video/')
  const isPdf = mime === 'application/pdf'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex items-center gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.media_filename || item.type}</div>
          <div className="text-xs text-white/60">
            {formatFileSize(item.media_size)}{item.media_size ? ' · ' : ''}{formatTime(item.wa_timestamp || item.created_at)}
          </div>
        </div>
        {isImage && (
          <>
            <IconBtn title="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.25))}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" /></svg>
            </IconBtn>
            <IconBtn title="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></svg>
            </IconBtn>
          </>
        )}
        {src && (
          <a href={src} download={item.media_filename || 'download'} title="Download"
            className="flex h-10 w-10 items-center justify-center rounded-full text-white/90 hover:bg-white/15">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" /></svg>
          </a>
        )}
        <IconBtn title="Close (Esc)" onClick={onClose}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </IconBtn>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4" onClick={(e) => e.stopPropagation()}>
        {items.length > 1 && (
          <IconBtn title="Previous (←)" onClick={prev} disabled={index === 0}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </IconBtn>
        )}

        <div className="flex max-h-full max-w-full flex-1 items-center justify-center overflow-auto">
          {!src && <div className="text-white/70">Loading…</div>}
          {src && isImage && (
            <img src={src} alt={item.media_filename || ''} style={{ transform: `scale(${zoom})` }} className="max-h-[80vh] max-w-full origin-center object-contain transition-transform" />
          )}
          {src && isVideo && <video src={src} controls autoPlay preload="metadata" className="max-h-[80vh] max-w-full" />}
          {src && isPdf && <iframe src={src} title={item.media_filename || 'document'} className="h-[82vh] w-[min(900px,90vw)] rounded bg-white" />}
          {src && !isImage && !isVideo && !isPdf && (
            <a href={src} download={item.media_filename || 'download'} className="flex flex-col items-center gap-3 rounded-xl bg-white/10 px-8 py-10 text-white">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>
              <span className="text-sm">{item.media_filename || 'Download file'}</span>
              <span className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black">Download</span>
            </a>
          )}
        </div>

        {items.length > 1 && (
          <IconBtn title="Next (→)" onClick={next} disabled={index === items.length - 1}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </IconBtn>
        )}
      </div>
    </div>
  )
}
