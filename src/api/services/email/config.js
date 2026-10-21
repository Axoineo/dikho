import { tokenKeyConfigured } from './crypto.js'

// Email Hub configuration, read from the API Worker's env. One place decides
// whether the module and each integration are switched on, so a missing
// setting turns a feature off instead of half-working. Reports presence only:
// never a value, an id or a secret (docs/CONFIGURATION.md).
//
//   EMAIL_HUB_ENABLED            'true' turns the module on; anything else, off.
//   GOOGLE_CLIENT_ID             OAuth client (Google Cloud, type Web, Internal).
//   GOOGLE_CLIENT_SECRET         secret.
//   GOOGLE_OAUTH_REDIRECT_URI    https://<api origin>/api/email/oauth/google/callback
//   GOOGLE_WORKSPACE_DOMAIN      optional; only accounts of this domain may connect.
//   EMAIL_TOKEN_KEY              secret; 32 random bytes, base64.
//   GOOGLE_PUBSUB_TOPIC          optional; projects/<p>/topics/<t> for Gmail push.
//   GOOGLE_PUBSUB_AUDIENCE       the push subscription's OIDC audience.
//   GOOGLE_PUBSUB_SERVICE_ACCOUNT the push subscription's service account email.
//   APP_URL                      dashboard origin, for the post-connect redirect.
//   EMAIL_SYNC_DAYS / EMAIL_SYNC_MAX_THREADS   first-sync window and size.

export function emailHubEnabled(env) {
  return env.EMAIL_HUB_ENABLED === 'true'
}

export async function gmailConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI)
    && /^https:\/\//.test(env.GOOGLE_OAUTH_REDIRECT_URI)
    && await tokenKeyConfigured(env)
}

export function pushConfigured(env) {
  return Boolean(env.GOOGLE_PUBSUB_TOPIC && env.GOOGLE_PUBSUB_AUDIENCE && env.GOOGLE_PUBSUB_SERVICE_ACCOUNT)
    && /^projects\/[a-z][a-z0-9-]{4,29}\/topics\/[A-Za-z][\w.~+%-]{2,254}$/.test(env.GOOGLE_PUBSUB_TOPIC)
}

export function workspaceDomain(env) {
  const domain = (env.GOOGLE_WORKSPACE_DOMAIN || '').trim().toLowerCase()
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null
}

function intIn(value, fallback, min, max) {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

export const syncDays = (env) => intIn(env.EMAIL_SYNC_DAYS, 60, 1, 365)
export const syncMaxThreads = (env) => intIn(env.EMAIL_SYNC_MAX_THREADS, 150, 10, 500)

/** Where the browser lands after Google sends it back. */
export function settingsUrl(env, params) {
  const base = (env.APP_URL || '').replace(/\/+$/, '')
  if (!/^https?:\/\/[^/]+$/.test(base)) return null
  return `${base}/email/settings?${new URLSearchParams(params)}`
}
