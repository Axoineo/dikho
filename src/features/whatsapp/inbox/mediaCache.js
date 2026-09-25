import { apiBlob } from '../../../lib/api'

// Module-level cache of media path -> Promise<objectURL>. Auth'd media is fetched
// once and shared between the thumbnail bubble and the full-screen viewer, so
// opening the lightbox never re-downloads. Object URLs live for the session.
const cache = new Map()

export function getMediaUrl(rawPath) {
  if (!rawPath) return Promise.reject(new Error('no path'))
  // apiBlob prefixes origin + /api; drop a stray leading /api on older rows.
  const path = rawPath.startsWith('/api/') ? rawPath.slice(4) : rawPath
  if (!cache.has(path)) {
    cache.set(
      path,
      apiBlob(path)
        .then((blob) => URL.createObjectURL(blob))
        .catch((err) => { cache.delete(path); throw err }),
    )
  }
  return cache.get(path)
}
