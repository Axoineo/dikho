import { decryptToken, fromBase64url } from './crypto.js'
import { workspaceDomain } from './config.js'
import { logError } from '../../utils/logger.js'

// Google OAuth and the Gmail REST API, over plain fetch (no SDK, as with the
// rest of this Worker). Every request has a timeout. Nothing here logs a
// token, a header value or message content.
//
// Scopes: `gmail.modify` is the narrowest single scope that reads, labels,
// archives, drafts and sends; `openid email` proves which account signed in.
// The full https://mail.google.com/ scope (permanent delete) is never asked for.
export const GMAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.modify']
const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const BATCH_URL = 'https://gmail.googleapis.com/batch/gmail/v1'
const TIMEOUT_MS = 15_000

/** Google refused the stored grant (revoked, expired, password changed). */
export class GoogleAuthError extends Error {}

/** A Gmail API failure with its HTTP status; message is safe to show. */
export class GmailError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function authorizationUrl(env, { state, challenge, loginHint }) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    // Always show consent, so Google always returns a refresh token and the
    // person sees exactly what Dikho is asking for.
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  if (loginHint) params.set('login_hint', loginHint)
  const domain = workspaceDomain(env)
  if (domain) params.set('hd', domain)
  return `${AUTH_URL}?${params}`
}

async function postForm(url, form) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

function decodeJwtPayload(jwt) {
  const parts = String(jwt ?? '').split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])))
  } catch {
    return null
  }
}

/**
 * Exchanges an authorization code (with its PKCE verifier) for tokens and
 * checks who signed in. The id_token comes straight from Google's token
 * endpoint over TLS, so per OpenID Connect Core 3.1.3.7 its claims are checked
 * (issuer, audience, expiry, verified email, Workspace domain) without a
 * separate signature check. Throws Error with a fixed `code` the callback maps
 * to a message; never Google's own error text.
 */
export async function exchangeCode(env, { code, verifier }) {
  let res
  try {
    res = await postForm(TOKEN_URL, {
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    })
  } catch {
    throw Object.assign(new Error('token endpoint unreachable'), { code: 'google_unreachable' })
  }
  const body = await res.json().catch(() => null)
  if (!res.ok || !body) {
    logError('email.oauth.exchange_failed', `${res.status} ${typeof body?.error === 'string' ? body.error : ''}`)
    throw Object.assign(new Error('code exchange refused'), { code: 'exchange_failed' })
  }

  const granted = String(body.scope ?? '').split(/\s+/)
  if (!granted.includes(GMAIL_MODIFY)) {
    throw Object.assign(new Error('gmail scope not granted'), { code: 'scope_missing' })
  }
  if (typeof body.refresh_token !== 'string' || body.refresh_token.length < 10) {
    throw Object.assign(new Error('no refresh token'), { code: 'no_refresh_token' })
  }

  const claims = decodeJwtPayload(body.id_token)
  const now = Math.floor(Date.now() / 1000)
  if (!claims
      || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
      || claims.aud !== env.GOOGLE_CLIENT_ID
      || typeof claims.exp !== 'number' || claims.exp < now - 60
      || typeof claims.sub !== 'string' || !claims.sub
      || typeof claims.email !== 'string' || claims.email_verified !== true) {
    throw Object.assign(new Error('id_token claims invalid'), { code: 'identity_invalid' })
  }
  const domain = workspaceDomain(env)
  if (domain && String(claims.hd ?? '').toLowerCase() !== domain) {
    throw Object.assign(new Error('wrong workspace'), { code: 'wrong_domain' })
  }

  return {
    refreshToken: body.refresh_token,
    accessToken: typeof body.access_token === 'string' ? body.access_token : null,
    expiresIn: Number(body.expires_in) || 0,
    scopes: granted.filter(Boolean),
    email: claims.email.toLowerCase(),
    subject: claims.sub,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 120) : null,
  }
}

/** Best effort: tells Google the grant is no longer wanted. */
export async function revokeToken(token) {
  try {
    const res = await postForm(REVOKE_URL, { token })
    return res.ok
  } catch {
    return false
  }
}

// ── Access tokens ────────────────────────────────────────────────────────────
// Kept per isolate for their lifetime minus a minute. Never persisted.
const accessTokens = new Map()

export function forgetAccessToken(accountId) {
  accessTokens.delete(accountId)
}

export function rememberAccessToken(accountId, token, expiresIn) {
  if (token && expiresIn > 120) accessTokens.set(accountId, { token, until: Date.now() + (expiresIn - 60) * 1000 })
}

/**
 * An access token for a mailbox. `account` carries id, email_address and
 * token_enc (from em_access / em_claim_sync).
 */
export async function accessTokenFor(env, account) {
  const cached = accessTokens.get(account.id)
  if (cached && cached.until > Date.now()) return cached.token
  if (!account.token_enc) throw new GoogleAuthError('mailbox has no stored grant')

  const refreshToken = await decryptToken(env, account.token_enc, account.email_address)
  let res
  try {
    res = await postForm(TOKEN_URL, {
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
  } catch {
    throw new GmailError(503, 'Could not reach Google. Please try again.')
  }
  const body = await res.json().catch(() => null)
  if (res.status === 400 || res.status === 401) {
    // invalid_grant: revoked, expired, or the password/2SV changed.
    if (body?.error === 'invalid_grant' || res.status === 401) throw new GoogleAuthError('grant refused')
  }
  if (!res.ok || typeof body?.access_token !== 'string') {
    logError('email.google.refresh_failed', `${res.status} ${typeof body?.error === 'string' ? body.error : ''}`)
    throw new GmailError(502, 'Google did not accept the request. Please try again.')
  }
  rememberAccessToken(account.id, body.access_token, Number(body.expires_in) || 0)
  return body.access_token
}

// ── Gmail REST ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A request Gmail may or may not have carried out (timeout, connection drop,
 * 5xx on a send). Never retried automatically: the mail may already be out.
 */
export class GmailUncertainError extends GmailError {}

/**
 * One Gmail API call for a mailbox. Retries twice on 429/5xx with backoff
 * (honouring Retry-After up to 4 s), and once on 401 with a fresh token.
 * `retry: false` is for calls that must not run twice (sending): a network
 * failure or 5xx then throws GmailUncertainError instead of retrying. A 401 is
 * still retried once, since Google refused it before doing anything.
 * Returns the parsed JSON (or null for 204), or a Response when `raw`.
 * `upload` sends a prepared body to the /upload endpoint instead of JSON.
 */
export async function gmail(env, account, path, { method = 'GET', body, query, raw = false, retry = true, upload } = {}) {
  const url = upload
    ? `https://gmail.googleapis.com/upload/gmail/v1/users/me${path}?uploadType=multipart`
    : `${GMAIL_API}${path}${query ? `?${query}` : ''}`
  let refreshed = false
  for (let attempt = 0; ; attempt++) {
    const token = await accessTokenFor(env, account)
    let res
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(upload ? { 'Content-Type': upload.contentType } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: upload ? upload.body : body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(upload ? TIMEOUT_MS * 4 : TIMEOUT_MS),
      })
    } catch {
      if (!retry) throw new GmailUncertainError(504, 'Gmail did not answer in time.')
      if (attempt < 2) { await sleep(300 * 2 ** attempt); continue }
      throw new GmailError(503, 'Could not reach Gmail. Please try again.')
    }

    if (res.status === 401 && !refreshed) {
      refreshed = true
      forgetAccessToken(account.id)
      continue
    }
    if (!retry && res.status >= 500) throw new GmailUncertainError(502, 'Gmail had a problem while handling the request.')
    if ((res.status === 429 || res.status >= 500) && attempt < 2 && retry) {
      const after = Number(res.headers.get('Retry-After'))
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 4) * 1000 : 400 * 2 ** attempt)
      continue
    }
    if (raw && res.ok) return res
    if (res.status === 204) return null
    const data = await res.json().catch(() => null)
    if (res.ok) return data
    if (res.status === 401) throw new GoogleAuthError('access token refused')
    if (res.status === 404) throw new GmailError(404, 'That message is no longer in Gmail.')
    if (res.status === 429) throw new GmailError(429, 'Gmail is limiting requests from this mailbox. Try again in a minute.')
    logError('email.gmail.request_failed', `${method} ${path.split('?')[0].replace(/\/[0-9a-f]{6,}/gi, '/:id')} ${res.status}`)
    throw new GmailError(res.status >= 500 ? 502 : 400, 'Gmail did not accept the request.')
  }
}

/**
 * Body for Gmail's multipart upload (messages.send, drafts.create/update):
 * JSON metadata (thread id, draft id) plus the RFC 5322 message itself, so
 * attachments are not limited by the JSON request size.
 */
export function uploadBody(metadata, rawMessage) {
  const boundary = `upload_${crypto.randomUUID().replace(/-/g, '')}`
  return {
    contentType: `multipart/related; boundary=${boundary}`,
    body: [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata ?? {}),
      `--${boundary}`,
      'Content-Type: message/rfc822',
      '',
      rawMessage,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
  }
}

/**
 * GETs many Gmail resources in one HTTP request (Gmail's batch endpoint), to
 * stay well inside the Worker's per-request subrequest budget. `paths` are
 * relative to the user, e.g. `/threads/abc?format=metadata`. Returns an array
 * aligned with `paths`: parsed JSON, or { error: status } for a failed part.
 * At most 50 paths per call (Google's advice for Gmail batches).
 */
export async function gmailBatchGet(env, account, paths) {
  if (paths.length === 0) return []
  if (paths.length > 50) throw new Error('gmailBatchGet takes at most 50 paths')
  const boundary = `batch_${crypto.randomUUID().replace(/-/g, '')}`
  const body = paths.map((path, i) => [
    `--${boundary}`,
    'Content-Type: application/http',
    `Content-ID: <item${i}>`,
    '',
    `GET /gmail/v1/users/me${path}`,
    '',
    '',
  ].join('\r\n')).join('') + `--${boundary}--\r\n`

  let refreshed = false
  for (let attempt = 0; ; attempt++) {
    const token = await accessTokenFor(env, account)
    let res
    try {
      res = await fetch(BATCH_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/mixed; boundary=${boundary}` },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS * 2),
      })
    } catch {
      if (attempt < 2) { await sleep(300 * 2 ** attempt); continue }
      throw new GmailError(503, 'Could not reach Gmail. Please try again.')
    }
    if (res.status === 401 && !refreshed) { refreshed = true; forgetAccessToken(account.id); continue }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await sleep(400 * 2 ** attempt); continue }
    if (res.status === 401) throw new GoogleAuthError('access token refused')
    if (!res.ok) throw new GmailError(502, 'Gmail did not accept the request.')

    const results = parseBatchResponse(res.headers.get('Content-Type') || '', await res.text(), paths.length)
    // A part refused for its own token means the whole grant is gone.
    if (results.some((r) => r && r.error === 401)) throw new GoogleAuthError('access token refused')
    return results
  }
}

/** Parses a multipart/mixed batch response into results by Content-ID. */
export function parseBatchResponse(contentType, text, count) {
  const match = /boundary=("?)([^";]+)\1/i.exec(contentType)
  const results = new Array(count).fill(null).map(() => ({ error: 502 }))
  if (!match) return results
  for (const part of text.split(`--${match[2]}`)) {
    const id = /Content-ID:\s*<?response-item(\d+)>?/i.exec(part)
    if (!id) continue
    const index = Number(id[1])
    if (!(index >= 0 && index < count)) continue
    const status = /HTTP\/1\.1\s+(\d{3})/.exec(part)
    const code = status ? Number(status[1]) : 502
    if (code < 200 || code >= 300) { results[index] = { error: code }; continue }
    const jsonStart = part.indexOf('{')
    const jsonEnd = part.lastIndexOf('}')
    try {
      results[index] = JSON.parse(part.slice(jsonStart, jsonEnd + 1))
    } catch {
      results[index] = { error: 502 }
    }
  }
  return results
}
