// Media re-hosting for the WhatsApp inbox.
//
// Inbound: Meta's media URLs expire in minutes and require the access token to
// fetch, so we pull the bytes and re-host them in R2, then serve them back
// through our own authenticated route. Meta's temporary URL never reaches the
// browser (per the brief's constraint).
//
// Outbound: our R2 route is behind auth, so Meta cannot fetch it by `link`.
// Instead we upload the agent's file to Meta's /media endpoint to get a media
// id, and separately keep a copy in R2 so the thread can render what was sent.

import { broadcast } from './realtime.js'
import { logError } from '../../utils/logger.js'

const GRAPH_VERSION = 'v21.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

function keyFor(id, ext = '') {
  const day = new Date().toISOString().slice(0, 10)
  return `${day}/${id}${ext}`
}

// Stores raw bytes in R2 and returns the path our media route serves, RELATIVE
// to the API base. The frontend's api client already prefixes the origin + /api,
// so this must NOT include /api or the request doubles up (`/api/api/...` → 404).
async function putToR2(env, key, bytes, contentType) {
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } })
  return `/whatsapp/media/${key}`
}

// Downloads an inbound media object from Meta (two-step: resolve id -> signed
// URL, then GET the bytes; both need the Bearer token) and re-hosts it in R2.
// Called via ctx.waitUntil so the webhook's 200 stays fast.
export async function ingestMedia(env, { messageId, mediaId }) {
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  })
  if (!metaRes.ok) throw new Error(`media meta lookup failed (HTTP ${metaRes.status})`)
  const meta = await metaRes.json()

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
  })
  if (!fileRes.ok) throw new Error(`media download failed (HTTP ${fileRes.status})`)
  const bytes = await fileRes.arrayBuffer()

  const url = await putToR2(env, keyFor(mediaId), bytes, meta.mime_type)
  const size = Number(meta.file_size) || bytes.byteLength || null

  await env.DB.prepare(
    `UPDATE messages SET media_url = ?1, media_mime = ?2, media_size = ?3, media_status = 'ready' WHERE id = ?4`,
  ).bind(url, meta.mime_type, size, messageId).run()

  const row = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(messageId).first()
  await broadcast(env, 'message:updated', { message: row })
  return url
}

// Marks an inbound media message as failed so the UI can show a retry affordance
// instead of an eternal spinner.
export async function markMediaFailed(env, messageId) {
  try {
    await env.DB.prepare(`UPDATE messages SET media_status = 'failed' WHERE id = ?`).bind(messageId).run()
    const row = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(messageId).first()
    await broadcast(env, 'message:updated', { message: row })
  } catch (err) {
    logError('whatsapp.media.mark_failed', err)
  }
}

// Uploads an outbound file to Meta and returns its media id (used as the send
// payload). Meta requires multipart with messaging_product=whatsapp.
export async function uploadMediaToMeta(env, { bytes, mime, filename }) {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('file', new Blob([bytes], { type: mime }), filename || 'upload')

  const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    body: form,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = body?.error ?? {}
    return { ok: false, errorCode: String(error.code ?? res.status), errorMessage: error.message ?? 'Media upload failed' }
  }
  return { ok: true, mediaId: body.id }
}

// Keeps a copy of an outbound file in R2 so the thread can render it. Returns the
// path our media route serves. The key is a plain UUID (no filename) to keep it
// free of spaces/special characters — the display name lives in media_filename.
export async function storeOutboundCopy(env, { bytes, mime }) {
  return putToR2(env, keyFor(crypto.randomUUID()), bytes, mime)
}
