import { useEffect, useState } from 'react'
import { getMediaUrl } from './mediaCache'
import { formatFileSize } from './inboxUtils'

function extLabel(filename = '', mime = '') {
  const ext = filename.includes('.') ? filename.split('.').pop().toUpperCase() : ''
  if (ext) return ext.slice(0, 4)
  if (mime === 'application/pdf') return 'PDF'
  return (mime.split('/')[1] || 'FILE').toUpperCase().slice(0, 4)
}

// Renders one message's media inside a bubble. Images/videos/documents open the
// full-screen viewer via onOpen; audio plays inline. Bytes are fetched auth'd and
// shared through mediaCache, so opening the viewer never re-downloads.
export function AuthedMedia({ message, onOpen }) {
  const { media_url: url, media_mime: mime = '', media_filename: filename, media_status: status, media_size: size } = message
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)

  const isImage = mime.startsWith('image/')
  const isVideo = mime.startsWith('video/')
  const isAudio = mime.startsWith('audio/')

  useEffect(() => {
    setSrc(null); setFailed(false)
    if (!url || status !== 'ready') return
    let alive = true
    getMediaUrl(url).then((u) => { if (alive) setSrc(u) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [url, status])

  if (status === 'pending') {
    return <div className="flex h-40 w-52 items-center justify-center rounded-lg bg-black/5 text-xs text-gray-500 dark:bg-white/10">Downloading…</div>
  }
  if (status === 'failed' || failed) {
    return <div className="rounded-lg bg-black/5 px-3 py-6 text-center text-xs text-red-500 dark:bg-white/10">Media unavailable</div>
  }
  if (!src) {
    return <div className="h-40 w-52 animate-pulse rounded-lg bg-black/5 dark:bg-white/10" />
  }

  if (isImage) {
    return (
      <button type="button" onClick={onOpen} className="group relative block overflow-hidden rounded-lg">
        <img src={src} alt={filename || 'image'} className="max-h-72 min-h-24 w-full max-w-[280px] cursor-pointer object-cover" />
        <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
      </button>
    )
  }
  if (isVideo) {
    return <video src={src} controls className="max-h-72 max-w-[280px] rounded-lg" />
  }
  if (isAudio) {
    return <audio src={src} controls className="w-60 max-w-full" />
  }

  // Document / any other file — WhatsApp-style card with type + size and download.
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-64 max-w-full items-center gap-3 rounded-lg bg-black/[0.04] px-3 py-2.5 text-left hover:bg-black/[0.07] dark:bg-white/10 dark:hover:bg-white/[0.15]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#185494]/10 text-[#185494] dark:bg-[#185494]/25 dark:text-[#7cb2ea]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-gray-900 dark:text-white">{filename || 'Document'}</span>
        <span className="block text-[11px] text-gray-500 dark:text-gray-400">{extLabel(filename, mime)}{size ? ` · ${formatFileSize(size)}` : ''}</span>
      </span>
      <span className="shrink-0 text-gray-400">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
      </span>
    </button>
  )
}
