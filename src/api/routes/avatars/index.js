import { Hono } from 'hono'
import { ok, fail } from '../../utils/response.js'
import { requireAuth } from '../../middleware/requireAuth.js'

const avatars = new Hono()

// Profile pictures, stored in the MEDIA bucket under an `avatars/` prefix.
//
// Unlike WhatsApp media these are served WITHOUT a signed ticket, because the
// URL is stored permanently in Supabase `user_metadata.avatar_url` and rendered
// by a plain <img> in src/components/Sidebar.jsx — a ticket would expire and the
// avatar would silently break.
//
// That makes the GET route public, and the MEDIA bucket also holds customer
// WhatsApp media, so the route must never be able to address an arbitrary key.
// It therefore takes a user id, not a key, and builds `avatars/<uuid>` itself:
// the UUID gate below admits no slashes, no "..", so nothing outside the prefix
// is reachable no matter what is sent.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_BYTES = 2 * 1024 * 1024

const keyFor = (userId) => `avatars/${userId.toLowerCase()}`

// GET /api/avatars/:userId — public. Stable URL, safe for <img src>.
avatars.get('/:userId', async (c) => {
  const userId = c.req.param('userId')
  if (!UUID.test(userId)) return c.notFound()

  const obj = await c.env.MEDIA.get(keyFor(userId))
  if (!obj) return c.notFound()

  const headers = new Headers()
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg')
  headers.set('Content-Length', String(obj.size))
  // Short cache + ETag: the URL is permanent but its content changes whenever
  // someone re-uploads, so revalidation has to stay cheap.
  headers.set('Cache-Control', 'public, max-age=300')
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag)
  return new Response(obj.body, { status: 200, headers })
})

// POST /api/avatars — authenticated; body is the raw image. A user can only
// ever write their own key, so this cannot be used to overwrite someone else's.
avatars.post('/', requireAuth, async (c) => {
  const user = c.get('user')
  const type = (c.req.header('Content-Type') || '').split(';')[0].trim().toLowerCase()
  if (!ALLOWED.has(type)) {
    return fail(c, 'unsupported_type', `Content-Type must be one of ${[...ALLOWED].join(', ')}`, 415)
  }

  const body = await c.req.arrayBuffer()
  if (body.byteLength === 0) return fail(c, 'empty_body', 'No image data received', 400)
  if (body.byteLength > MAX_BYTES) {
    return fail(c, 'too_large', `Image must be ${MAX_BYTES / 1024 / 1024} MB or smaller`, 413)
  }

  await c.env.MEDIA.put(keyFor(user.id), body, { httpMetadata: { contentType: type } })

  // Caller still has to persist this into user_metadata.avatar_url.
  const url = new URL(c.req.url)
  return ok(c, { avatar_url: `${url.origin}/api/avatars/${user.id}` })
})

export default avatars
