import { supabase } from './supabase'

// Thin client for the Worker API. Every call carries the current Supabase
// access token, which the Worker validates before touching D1 or Meta.
//
// The API is a separate Worker from this dashboard, so these are cross-origin
// calls and the API's ALLOWED_ORIGINS must list this dashboard's origin.
// Override per environment with VITE_API_BASE in .env.local.
const BASE = `${import.meta.env.VITE_API_BASE ?? 'https://dikho-api.fineeurox.workers.dev'}/api`

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function unwrap(res) {
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) {
    const err = new Error(body?.error?.message || `Request failed (${res.status})`)
    // The envelope's machine-readable code, so a caller can tell an ordinary
    // outcome (CALL_UNAVAILABLE — another tab picked up) from a real failure
    // without string-matching the message.
    err.code = body?.error?.code ?? null
    err.status = res.status
    throw err
  }
  return body.data
}

export async function apiGet(path) {
  return unwrap(await fetch(`${BASE}${path}`, { headers: await authHeader() }))
}

export async function apiPost(path, payload) {
  return unwrap(await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

export async function apiDelete(path, payload) {
  return unwrap(await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

// Builds a direct, streamable URL for re-hosted media using a signed ticket, so
// <img>/<video>/<iframe> can load it without an Authorization header. Returns
// null until a ticket is available.
export function waMediaUrl(path, ticket) {
  if (!path || !ticket) return null
  const p = path.startsWith('/api/') ? path.slice(4) : path
  return `${BASE}${p}?t=${encodeURIComponent(ticket)}`
}

export async function apiUpload(path, file) {
  const form = new FormData()
  form.append('file', file)
  // No Content-Type header: the browser must set the multipart boundary.
  return unwrap(await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: await authHeader(),
    body: form,
  }))
}

// Fetches a protected binary (re-hosted WhatsApp media) with the session token
// and returns a Blob. The caller turns it into an object URL for <img>/<a>,
// since those elements cannot send an Authorization header themselves.
export async function apiBlob(path) {
  const res = await fetch(`${BASE}${path}`, { headers: await authHeader() })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.blob()
}

/* ── WhatsApp inbox ─────────────────────────────────────────────────────── */
export const waApi = {
  conversations: () => apiGet('/whatsapp/conversations'),
  messages: (id) => apiGet(`/whatsapp/conversations/${id}/messages`),
  markRead: (id) => apiPost(`/whatsapp/conversations/${id}/read`),
  sendText: (id, body) => apiPost(`/whatsapp/conversations/${id}/messages`, { body }),
  sendMedia: async (id, file, caption = '') => {
    const form = new FormData()
    form.append('file', file)
    if (caption) form.append('caption', caption)
    return unwrap(await fetch(`${BASE}/whatsapp/conversations/${id}/media`, {
      method: 'POST',
      headers: await authHeader(),
      body: form,
    }))
  },
  uploadAvatar: async (id, file) => {
    const form = new FormData()
    form.append('file', file)
    return unwrap(await fetch(`${BASE}/whatsapp/conversations/${id}/avatar`, {
      method: 'POST',
      headers: await authHeader(),
      body: form,
    }))
  },
  mediaTicket: () => apiGet('/whatsapp/media-ticket'),
  typing: (id) => apiPost(`/whatsapp/conversations/${id}/typing`),

  /* ── Voice calls ──────────────────────────────────────────────────────
     Signalling only. The audio never goes through the Worker — these just
     relay the browser's SDP answer to Meta. See inbox/useWhatsAppCall.js. */
  calls: ({ conversationId, status } = {}) => {
    const params = new URLSearchParams()
    if (conversationId) params.set('conversationId', conversationId)
    if (status) params.set('status', status)
    const query = params.toString()
    return apiGet(`/whatsapp/calls${query ? `?${query}` : ''}`)
  },
  callPreAccept: (wacid, sdp, phone) =>
    apiPost(`/whatsapp/calls/${encodeURIComponent(wacid)}/pre-accept`, { sdp, phone }),
  callAccept: (wacid, sdp, phone) =>
    apiPost(`/whatsapp/calls/${encodeURIComponent(wacid)}/accept`, { sdp, phone }),
  callReject: (wacid) => apiPost(`/whatsapp/calls/${encodeURIComponent(wacid)}/reject`),
  callHangUp: (wacid) => apiPost(`/whatsapp/calls/${encodeURIComponent(wacid)}/terminate`),
}
