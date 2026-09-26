import { useState } from 'react'
import { useMediaSrc } from './MediaTicketContext'
import { formatFileSize } from './inboxUtils'

function extLabel(filename = '', mime = '') {
  const ext = filename.includes('.') ? filename.split('.').pop().toUpperCase() : ''
  if (ext) return ext.slice(0, 4)
  if (mime === 'application/pdf') return 'PDF'
  return (mime.split('/')[1] || 'FILE').toUpperCase().slice(0, 4)
}

// Renders one message's media inside a bubble. Media streams directly from the
// media route via a signed ticket URL (no blob buffering), so large video seeks
// and plays. Images/videos/documents open the full-screen viewer via onOpen;
// audio plays inline.
export function AuthedMedia({ message, onOpen }) {
  const { media_url: url, media_mime: mime = '', media_filename: filename, media_status: status, media_size: size } = message
  const { srcFor } = useMediaSrc()
  const [failed, setFailed] = useState(false)

  const isImage = mime.startsWith('image/')
  const isVideo = mime.startsWith('video/')
  const isAudio = mime.startsWith('audio/')
  const src = status === 'ready' ? srcFor(url) : null

  if (status === 'pending') {
    return <div className="flex h-40 w-52 items-center justify-center rounded-lg bg-line-soft text-xs text-muted">Downloading…</div>
  }
  if (status === 'failed' || failed) {
    return <div className="rounded-lg bg-line-soft px-3 py-6 text-center text-xs text-danger">Media unavailable</div>
  }
  if (!src) {
    return <div className="h-40 w-52 animate-pulse rounded-lg bg-line-soft" />
  }

  if (isImage) {
    return (
      <button type="button" onClick={onOpen} className="group relative block overflow-hidden rounded-lg">
        <img src={src} alt={filename || 'image'} onError={() => setFailed(true)} className="max-h-72 min-h-24 w-full max-w-[280px] cursor-pointer object-cover" />
        <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
      </button>
    )
  }
  if (isVideo) {
    // preload metadata only; playback streams via Range requests.
    return <video src={src} controls preload="metadata" onError={() => setFailed(true)} className="max-h-72 max-w-[280px] rounded-lg" />
  }
  if (isAudio) {
    return <audio src={src} controls preload="metadata" className="w-60 max-w-full" />
  }

  // Document / any other file — WhatsApp-style card with type + size; opens the viewer.
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-64 max-w-full items-center gap-3 rounded-lg bg-line-soft px-3 py-2.5 text-left hover:bg-line"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand dark:text-[#5ba0e0]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{filename || 'Document'}</span>
        <span className="block text-[11px] text-muted">{extLabel(filename, mime)}{size ? ` · ${formatFileSize(size)}` : ''}</span>
      </span>
      <span className="shrink-0 text-muted">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
      </span>
    </button>
  )
}
