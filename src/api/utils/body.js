import { HTTPException } from 'hono/http-exception'

// Bounded request-body readers. Every route that accepts a body should read it
// through one of these instead of c.req.json()/formData()/arrayBuffer(), which
// buffer whatever the caller sends before any size check can run.
//
// Two gates: a declared Content-Length over the limit is refused before a
// single byte is read, and the stream itself is counted as it arrives, so a
// chunked body (no Content-Length) or a lying header cannot get past the cap.

function tooLarge(maxBytes) {
  const mb = maxBytes / 1024 / 1024
  const limit = mb >= 1 ? `${Math.round(mb * 10) / 10} MB` : `${Math.round(maxBytes / 1024)} KB`
  return new HTTPException(413, { message: `Request body is larger than the ${limit} limit` })
}

/** Reads the raw body as bytes, refusing anything over `maxBytes`. */
export async function readBoundedBytes(c, maxBytes) {
  const declared = c.req.header('Content-Length')
  if (declared !== undefined && declared !== '') {
    const length = Number(declared)
    if (!Number.isFinite(length) || length < 0) {
      throw new HTTPException(400, { message: 'Invalid Content-Length' })
    }
    if (length > maxBytes) throw tooLarge(maxBytes)
  }

  const stream = c.req.raw.body
  if (!stream) return new Uint8Array(0)

  const reader = stream.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw tooLarge(maxBytes)
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Reads and parses a JSON body of at most `maxBytes`. */
export async function readBoundedJson(c, maxBytes) {
  const bytes = await readBoundedBytes(c, maxBytes)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }
}

// Dashboard JSON bodies (campaign sends, bulk deletes, replies) are id lists
// and short text; 1 MB is far above any real one.
export const MAX_DASHBOARD_JSON_BYTES = 1024 * 1024

/**
 * Like readBoundedJson, but a malformed body yields `fallback` instead of a
 * 400, for handlers that validate the parsed value themselves. An oversized
 * body still fails with 413.
 */
export async function readJsonOr(c, maxBytes, fallback) {
  const bytes = await readBoundedBytes(c, maxBytes)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return fallback
  }
}

/**
 * Reads and parses a multipart/form-data body of at most `maxBytes` in total.
 * The cap covers every part together, so individual file limits still need
 * checking by the caller (they are usually smaller).
 */
export async function readBoundedFormData(c, maxBytes) {
  const contentType = c.req.header('Content-Type') || ''
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new HTTPException(415, { message: 'Expected multipart/form-data' })
  }
  const bytes = await readBoundedBytes(c, maxBytes)
  try {
    return await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData()
  } catch {
    throw new HTTPException(400, { message: 'Malformed multipart body' })
  }
}

/** Returns the named form field when it is a file, else null. */
export function formFile(form, name) {
  const value = form?.get(name)
  return value && typeof value === 'object' && typeof value.arrayBuffer === 'function' ? value : null
}
