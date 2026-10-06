import { Hono } from 'hono'
import { verifyMediaTicket } from '../../services/whatsapp/mediaTicket.js'

const media = new Hono()

// Customers can send any file as a WhatsApp document, and it is served from
// this API's origin. Only types a browser renders without running script are
// served inline; everything else (HTML, SVG, XML, unknown) is forced to
// download and sandboxed, so a hostile attachment cannot execute here and read
// the media ticket out of its own URL.
const INLINE_SAFE = /^(image\/(jpeg|png|webp|gif)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf)$/i

function contentHeaders(obj) {
  const type = obj.httpMetadata?.contentType || 'application/octet-stream'
  const headers = new Headers()
  headers.set('Content-Type', type)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'private, max-age=86400')
  if (!INLINE_SAFE.test(type)) {
    headers.set('Content-Disposition', 'attachment')
    headers.set('Content-Security-Policy', "sandbox; default-src 'none'")
  }
  return headers
}

// GET /api/whatsapp/media/:key — streams a re-hosted media object from R2.
//
// Self-authenticated by a short-lived signed ticket (?t=), so it is NOT behind
// requireAuth — that lets <img>/<video>/<iframe> load it directly (they can't
// send an Authorization header). Supports HTTP Range so video/large files stream
// and seek instead of being buffered whole. `{.+}` allows slashes in the key.
media.get('/:key{.+}', async (c) => {
  const ok = await verifyMediaTicket(c.env.WHATSAPP_APP_SECRET, c.req.query('t'))
  if (!ok) return c.text('Unauthorized', 401)

  const key = c.req.param('key')
  const rangeHeader = c.req.header('Range')

  if (rangeHeader) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim())
    if (m) {
      const start = Number(m[1])
      const hasEnd = m[2] !== ''
      const end = hasEnd ? Number(m[2]) : undefined
      // An inverted or unsafe range is unsatisfiable, not a server error.
      if (!Number.isSafeInteger(start) || (hasEnd && (!Number.isSafeInteger(end) || end < start))) {
        return c.body(null, 416)
      }
      const head = await c.env.MEDIA.head(key)
      if (!head) return c.notFound()
      if (start >= head.size) {
        return c.body(null, 416, { 'Content-Range': `bytes */${head.size}` })
      }
      const lastByte = Math.min(hasEnd ? end : head.size - 1, head.size - 1)
      const obj = await c.env.MEDIA.get(key, { range: { offset: start, length: lastByte - start + 1 } })
      if (!obj) return c.notFound()
      const headers = contentHeaders(obj)
      headers.set('Content-Range', `bytes ${start}-${lastByte}/${head.size}`)
      headers.set('Content-Length', String(lastByte - start + 1))
      return new Response(obj.body, { status: 206, headers })
    }
  }

  const obj = await c.env.MEDIA.get(key)
  if (!obj) return c.notFound()
  const headers = contentHeaders(obj)
  headers.set('Content-Length', String(obj.size))
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag)
  return new Response(obj.body, { headers })
})

export default media
