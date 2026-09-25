import { useEffect, useState } from 'react'
import { apiBlob } from '../../../lib/api'

// Renders re-hosted WhatsApp media that lives behind the API's auth. An <img>/
// <video> tag cannot attach the Supabase bearer token, so we fetch the bytes
// with the token, wrap them in an object URL, and hand that to the element.
// The object URL is revoked on unmount to avoid leaking blobs.
export function AuthedMedia({ message }) {
  const { media_url: url, media_mime: mime = '', media_filename: filename, media_status: status } = message
  const [objectUrl, setObjectUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!url || status !== 'ready') return
    let revoked = false
    let created = null
    // apiBlob prefixes origin + /api, so a stored value that still carries a
    // leading /api (older rows) would double up — normalise it here.
    const path = url.startsWith('/api/') ? url.slice(4) : url
    apiBlob(path)
      .then((blob) => {
        if (revoked) return
        created = URL.createObjectURL(blob)
        setObjectUrl(created)
      })
      .catch(() => setFailed(true))
    return () => {
      revoked = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [url, status])

  if (status === 'pending') {
    return <div className="flex h-24 w-40 items-center justify-center rounded bg-black/5 text-xs text-gray-500 dark:bg-white/10">Downloading…</div>
  }
  if (status === 'failed' || failed) {
    return <div className="rounded bg-black/5 px-3 py-2 text-xs text-red-500 dark:bg-white/10">Media unavailable</div>
  }
  if (!objectUrl) {
    return <div className="h-24 w-40 animate-pulse rounded bg-black/5 dark:bg-white/10" />
  }

  if (mime.startsWith('image/')) {
    return <img src={objectUrl} alt={filename || 'image'} className="max-h-64 max-w-full rounded" />
  }
  if (mime.startsWith('video/')) {
    return <video src={objectUrl} controls className="max-h-64 max-w-full rounded" />
  }
  if (mime.startsWith('audio/')) {
    return <audio src={objectUrl} controls className="w-56" />
  }
  return (
    <a href={objectUrl} download={filename || 'file'} className="flex items-center gap-2 rounded bg-black/5 px-3 py-2 text-sm underline dark:bg-white/10">
      📄 {filename || 'Download file'}
    </a>
  )
}
