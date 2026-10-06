import { HTTPException } from 'hono/http-exception'
import { logError } from '../utils/logger.js'

// Server-side Supabase Storage writes with the SERVICE-ROLE key, for uploads
// that arrive through a verified Worker route (the public vendor form) instead
// of from the browser. Same conventions as services/supabaseRpc.js: plain
// fetch, bounded wait, generic errors to the caller, key never logged.
const TIMEOUT_MS = 20_000

function storageConfig(c) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = c.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new HTTPException(500, { message: 'Storage access is not configured on the server' })
  }
  return {
    base: `${SUPABASE_URL}/storage/v1/object`,
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  }
}

// Object keys here are generated server-side from fixed prefixes and UUIDs, so
// each segment only needs URL-encoding, never validation.
const encodeKey = (path) => path.split('/').map(encodeURIComponent).join('/')

/** Uploads bytes to `bucket/path`. Never overwrites an existing object. */
export async function uploadObject(c, bucket, path, bytes, contentType) {
  const { base, headers } = storageConfig(c)
  let res
  try {
    res = await fetch(`${base}/${encodeURIComponent(bucket)}/${encodeKey(path)}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'false', 'Cache-Control': 'max-age=3600' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: bytes,
    })
  } catch (err) {
    logError('storage.upload_unreachable', err)
    throw new HTTPException(503, { message: 'Could not store the document. Please try again.' })
  }
  if (!res.ok) {
    // Storage's error body names the bucket/key and a reason; the status is
    // enough to diagnose, and the key itself is not worth putting in logs.
    logError('storage.upload_failed', `HTTP ${res.status}`)
    throw new HTTPException(502, { message: 'Could not store the document. Please try again.' })
  }
}

/**
 * Best-effort delete, used to clean up an upload whose database write failed.
 * Never throws: the caller is already reporting the original failure.
 */
export async function removeObject(c, bucket, path) {
  try {
    const { base, headers } = storageConfig(c)
    const res = await fetch(`${base}/${encodeURIComponent(bucket)}`, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ prefixes: [path] }),
    })
    if (!res.ok) logError('storage.cleanup_failed', `HTTP ${res.status}`)
  } catch (err) {
    logError('storage.cleanup_failed', err)
  }
}
