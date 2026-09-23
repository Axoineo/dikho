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
    throw new Error(body?.error?.message || `Request failed (${res.status})`)
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
