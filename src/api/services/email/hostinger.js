import { logError } from '../../utils/logger.js'

// Hostinger Mail API (https://api.mail.hostinger.com, OpenAPI 1.3.0), over
// plain fetch like the rest of this Worker. Nothing here logs the token, a
// header value, an address or message content.
//
// Authentication: one API token created in the Hostinger Panel. It is scoped
// to a single Hostinger order and may be restricted to chosen mailboxes in
// that order, so access is partial unless GET /api/v1/me lists the mailbox.
// The token is a Worker secret (HOSTINGER_MAIL_API_TOKEN); it is never stored
// in the database and never sent to the browser.
//
// Every call is addressed to a mailbox by its Hostinger resource id, which
// Dikho learns only from /me (never from the browser) and keeps on the
// mailbox row (email_accounts.provider_account_id).
//
// Responses wrap their payload in { data } (and { pagination } for lists);
// errors are { error, code, params }. Rate limiting answers 429, and
// repeated 429s can get the caller's IP blocked for a while, so reads back
// off at most twice and sends are never retried.

export const HOSTINGER_API = 'https://api.mail.hostinger.com/api/v1'
const TIMEOUT_MS = 15_000
const RESOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/
const ADDRESS = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,63}$/
const MAX_MAILBOXES = 500

/** The token is unset, invalid, expired or revoked. */
export class HostingerAuthError extends Error {}

/** A Hostinger API failure with its HTTP status and code; message is safe to show. */
export class HostingerError extends Error {
  constructor(status, message, code = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** A send Hostinger may or may not have carried out. Never retried automatically. */
export class HostingerUncertainError extends HostingerError {}

export function hostingerConfigured(env) {
  const token = env.HOSTINGER_MAIL_API_TOKEN
  return typeof token === 'string' && token.length >= 20 && token.length <= 4096 && !/\s/.test(token)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// For logs only: the path with ids, folders and uids replaced.
const pathShape = (path) => path.split('?')[0]
  .replace(/\/mailboxes\/[^/]+/, '/mailboxes/:id')
  .replace(/\/folders\/[^/]+/, '/folders/:folder')
  .replace(/\/messages\/\d+/, '/messages/:uid')
  .replace(/\/attachments\/[^/]+/, '/attachments/:id')
  .replace(/\/webhooks\/[^/]+/, '/webhooks/:id')

function friendly(status, code) {
  if (status === 403) return 'Dikho\'s Hostinger API token does not cover this mailbox. An administrator needs to include it in the token.'
  if (status === 404) return 'That message or folder is no longer in the Hostinger mailbox.'
  if (status === 422) return 'Hostinger did not accept the request.'
  if (status === 429) return 'Hostinger is limiting requests. Try again in a minute.'
  if (code === 'ERR_MAILBOX_NOT_FOUND') return 'Hostinger no longer has this mailbox.'
  return 'Hostinger had a problem while handling the request. Try again.'
}

/**
 * One Hostinger Mail API call. `path` starts with '/', e.g. '/me'.
 * `retry: false` is for calls that must not run twice (sending): a timeout,
 * a dropped connection or a 5xx/504 then throws HostingerUncertainError.
 * Returns the parsed body ({ data, pagination? }), null for 204, or the
 * Response itself when `raw` (binary downloads).
 */
export async function hostinger(env, path, { method = 'GET', body, query, raw = false, retry = method === 'GET', timeoutMs = TIMEOUT_MS } = {}) {
  if (!hostingerConfigured(env)) throw new HostingerAuthError('Hostinger API token is not configured')
  const url = `${HOSTINGER_API}${path}${query ? `?${query}` : ''}`
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${env.HOSTINGER_MAIL_API_TOKEN}`,
          Accept: raw ? '*/*' : 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      if (!retry) throw new HostingerUncertainError(504, 'Hostinger did not answer in time.')
      if (attempt < 2) { await sleep(300 * 2 ** attempt); continue }
      throw new HostingerError(503, 'Could not reach Hostinger. Please try again.')
    }

    if (!retry && (res.status >= 500 || res.status === 504)) {
      throw new HostingerUncertainError(502, 'Hostinger had a problem while handling the request.')
    }
    if ((res.status === 429 || res.status >= 500) && retry && attempt < 2) {
      const after = Number(res.headers.get('Retry-After'))
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 4) * 1000 : 500 * 2 ** attempt)
      continue
    }
    if (raw && res.ok) return res
    if (res.status === 204) return null
    const data = await res.json().catch(() => null)
    if (res.ok) {
      if (!data || typeof data !== 'object') throw new HostingerError(502, 'Hostinger returned an unexpected answer.')
      return data
    }
    const code = typeof data?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(data.code) ? data.code : null
    if (res.status === 401) throw new HostingerAuthError('token refused')
    if (res.status !== 404) logError('email.hostinger.request_failed', `${method} ${pathShape(path)} ${res.status} ${code ?? ''}`.trim())
    throw new HostingerError(res.status >= 500 ? 502 : res.status, friendly(res.status, code), code)
  }
}

/**
 * The mailboxes the token may manage, from GET /me: [{ resourceId, address }].
 * Malformed entries are dropped; addresses are lower-cased.
 */
export async function listManagedMailboxes(env) {
  const result = await hostinger(env, '/me')
  const list = result?.data?.mailboxes
  if (!Array.isArray(list)) throw new HostingerError(502, 'Hostinger returned an unexpected answer.')
  const out = []
  const seen = new Set()
  for (const m of list.slice(0, MAX_MAILBOXES)) {
    const address = typeof m?.address === 'string' ? m.address.trim().toLowerCase() : ''
    const resourceId = typeof m?.resourceId === 'string' ? m.resourceId : ''
    if (!ADDRESS.test(address) || address.length > 254 || !RESOURCE_ID.test(resourceId) || seen.has(address)) continue
    seen.add(address)
    out.push({ resourceId, address })
  }
  return out
}

/** Storage use of one mailbox, or null when the server does not report it. */
export async function mailboxQuota(env, resourceId) {
  if (!RESOURCE_ID.test(resourceId ?? '')) throw new HostingerError(400, 'Invalid mailbox')
  const result = await hostinger(env, `/mailboxes/${encodeURIComponent(resourceId)}/quota`)
  const q = result?.data
  if (!q || q.supported !== true) return null
  const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null)
  return { used_bytes: n(q.totalUsage), limit_bytes: n(q.totalLimit), percent: n(q.totalPercentage) }
}
