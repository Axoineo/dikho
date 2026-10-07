import { supabase } from './supabase'
import { DEFAULT_API_BASE } from './apiBase'

// Thin client for the Worker API. Every call carries the current Supabase
// access token, which the Worker validates before touching D1 or Meta.
//
// The API is a separate Worker from this dashboard, so these are cross-origin
// calls and the API's ALLOWED_ORIGINS must list this dashboard's origin.
// Override per environment with VITE_API_BASE in .env.local.
const BASE = `${import.meta.env.VITE_API_BASE ?? DEFAULT_API_BASE}/api`

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function unwrap(res) {
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.success === false) {
    const err = new Error(body?.error?.message || `Request failed (${res.status})`)
    // Carried alongside the message so callers can branch on the kind of
    // failure without pattern-matching the wording — the GSTIN lookup needs to
    // tell "no such GSTIN" (404) apart from "directory is down" (503).
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

export async function apiPatch(path, payload) {
  return unwrap(await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

export async function apiPut(path, payload) {
  return unwrap(await fetch(`${BASE}${path}`, {
    method: 'PUT',
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

// Unauthenticated POST to an /api/public route (the two public forms). No
// Authorization header by design: these routes carry no session and are gated
// server-side on a Cloudflare Turnstile token in the body, which the Worker
// checks against siteverify before it writes anything.
//
// The API is cross-origin from this SPA, so the Worker's ALLOWED_ORIGINS must
// list whatever origin serves the public forms.
export async function apiPublicPost(path, payload) {
  return unwrap(await fetch(`${BASE}/public${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

// Same as apiPublicPost, for a public form that carries a file. The Worker
// verifies Turnstile and then stores the file itself; the browser never writes
// to Storage directly. No Content-Type header: the browser sets the boundary.
export async function apiPublicPostForm(path, form) {
  return unwrap(await fetch(`${BASE}/public${path}`, { method: 'POST', body: form }))
}

// Unauthenticated GET for read-only public lookups (currently the GSTIN →
// taxpayer autofill, GET /api/gstn/:gstin). No Authorization header by design:
// the public vendor form has no session, and the route is protected server-side
// by a format gate plus a per-IP rate limit rather than by a token.
//
// `signal` lets the caller abandon an in-flight lookup when the user keeps
// typing, so a slow response can never land on top of a newer one.
export async function apiPublicGet(path, { signal } = {}) {
  return unwrap(await fetch(`${BASE}${path}`, { signal }))
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
  clearChat: (id) => apiPost(`/whatsapp/conversations/${id}/clear`),
  deleteChat: (id) => apiDelete(`/whatsapp/conversations/${id}`),
  block: (id) => apiPost(`/whatsapp/conversations/${id}/block`),
  unblock: (id) => apiDelete(`/whatsapp/conversations/${id}/block`),
}
