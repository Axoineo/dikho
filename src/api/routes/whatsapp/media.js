import { Hono } from 'hono'

const media = new Hono()

// GET /api/whatsapp/media/:key — streams a re-hosted media object from R2.
//
// Mounted behind requireAuth (see ./index.js), so the bytes stay inside the
// dashboard's login boundary — we never expose Meta's temporary URLs, and we
// never make the bucket public. `{.+}` lets the key contain slashes (the objects
// are stored under `YYYY-MM-DD/<id>`). The browser fetches this with the Supabase
// bearer token and renders it via an object URL (see AuthedMedia on the client).
media.get('/:key{.+}', async (c) => {
  const key = c.req.param('key')
  const obj = await c.env.MEDIA.get(key)
  if (!obj) return c.notFound()

  const headers = new Headers()
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream')
  headers.set('Cache-Control', 'private, max-age=86400')
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag)
  return new Response(obj.body, { headers })
})

export default media
