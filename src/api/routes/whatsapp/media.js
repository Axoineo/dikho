import { Hono } from 'hono'
import { verifyMediaTicket } from '../../services/whatsapp/mediaTicket.js'

const media = new Hono()

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
    const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
    if (m) {
      const start = Number(m[1])
      const hasEnd = m[2] !== ''
      const end = hasEnd ? Number(m[2]) : undefined
      const obj = await c.env.MEDIA.get(key, {
        range: hasEnd ? { offset: start, length: end - start + 1 } : { offset: start },
      })
      if (!obj) return c.notFound()
      const total = obj.size
      const lastByte = hasEnd ? end : total - 1
      const headers = new Headers()
      headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream')
      headers.set('Accept-Ranges', 'bytes')
      headers.set('Content-Range', `bytes ${start}-${lastByte}/${total}`)
      headers.set('Content-Length', String(lastByte - start + 1))
      headers.set('Cache-Control', 'private, max-age=86400')
      return new Response(obj.body, { status: 206, headers })
    }
  }

  const obj = await c.env.MEDIA.get(key)
  if (!obj) return c.notFound()
  const headers = new Headers()
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream')
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Content-Length', String(obj.size))
  headers.set('Cache-Control', 'private, max-age=86400')
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag)
  return new Response(obj.body, { headers })
})

export default media
