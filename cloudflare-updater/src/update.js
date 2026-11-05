// Pure release logic for the update API: no I/O, so every rule can be tested
// without a Worker runtime. The manifest is data this repo controls, but it is
// still validated on every request: a bad edit must produce a clean "no
// update" for clients, never a malformed instruction to install something.

export const APP_ID = 'in.dikho.crm'

// Android's own ceiling for versionCode.
export const MAX_VERSION_CODE = 2_100_000_000
const MAX_APK_BYTES = 200 * 1024 * 1024
const MAX_NOTES_LENGTH = 2000

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/
const SHA256 = /^[0-9a-f]{64}$/
const CHANNEL = /^[a-z][a-z0-9-]{0,15}$/
const VERSION_CODE = /^[1-9]\d{0,9}$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
const APK_PATH = /^\/releases\/dikho-crm-v\d{1,4}\.\d{1,4}\.\d{1,4}\.apk$/

const isCode = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_VERSION_CODE

function apkUrlProblem(apkUrl) {
  if (typeof apkUrl !== 'string') return 'apkUrl must be a string'
  if (apkUrl.startsWith('/')) return APK_PATH.test(apkUrl) ? null : 'apkUrl path must be /releases/dikho-crm-v<version>.apk'
  let url
  try { url = new URL(apkUrl) } catch { return 'apkUrl is not a valid URL' }
  if (url.protocol !== 'https:') return 'apkUrl must use https'
  if (url.username || url.password) return 'apkUrl must not carry credentials'
  if (url.search || url.hash) return 'apkUrl must not carry a query or fragment'
  if (!url.pathname.endsWith('.apk')) return 'apkUrl must end in .apk'
  return null
}

/** Returns the problems with one channel's release; empty when it is valid. */
export function releaseProblems(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) return ['release must be an object']
  const problems = []
  if (typeof release.version !== 'string' || !VERSION.test(release.version)) problems.push('version must be x.y.z')
  if (!isCode(release.versionCode)) problems.push('versionCode must be an integer in Android\'s range')
  if (!isCode(release.minSupportedVersionCode)) problems.push('minSupportedVersionCode must be an integer in Android\'s range')
  else if (isCode(release.versionCode) && release.minSupportedVersionCode > release.versionCode) {
    problems.push('minSupportedVersionCode must not exceed versionCode')
  }
  if (typeof release.releaseNotes !== 'string' || release.releaseNotes.length > MAX_NOTES_LENGTH) {
    problems.push(`releaseNotes must be a string of at most ${MAX_NOTES_LENGTH} characters`)
  }
  const urlProblem = apkUrlProblem(release.apkUrl)
  if (urlProblem) problems.push(urlProblem)
  if (typeof release.sha256 !== 'string' || !SHA256.test(release.sha256)) problems.push('sha256 must be 64 lowercase hex characters')
  if (!Number.isInteger(release.sizeBytes) || release.sizeBytes < 1 || release.sizeBytes > MAX_APK_BYTES) {
    problems.push('sizeBytes must be a positive integer within the APK limit')
  }
  if (typeof release.publishedAt !== 'string' || !ISO_INSTANT.test(release.publishedAt) || Number.isNaN(Date.parse(release.publishedAt))) {
    problems.push('publishedAt must be an ISO 8601 UTC instant')
  }
  return problems
}

/** Returns the problems with the whole manifest; empty when it is valid. */
export function manifestProblems(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest must be an object']
  const problems = []
  if (manifest.schema !== 1) problems.push('schema must be 1')
  if (manifest.appId !== APP_ID) problems.push(`appId must be ${APP_ID}`)
  if (!manifest.channels || typeof manifest.channels !== 'object' || Array.isArray(manifest.channels)) {
    problems.push('channels must be an object')
    return problems
  }
  for (const [name, release] of Object.entries(manifest.channels)) {
    if (!CHANNEL.test(name)) { problems.push(`channel name "${name}" is not valid`); continue }
    // null means the channel exists but nothing has been published on it yet.
    if (release === null) continue
    for (const problem of releaseProblems(release)) problems.push(`${name}: ${problem}`)
  }
  return problems
}

/** Validates the query string. Unknown parameters are rejected, not ignored. */
export function parseUpdateQuery(params) {
  const allowed = new Set(['appId', 'versionCode', 'channel', 'platform'])
  for (const key of params.keys()) {
    if (!allowed.has(key)) return { error: 'unknown_parameter' }
  }
  if (params.getAll('versionCode').length > 1 || params.getAll('appId').length > 1) return { error: 'duplicate_parameter' }

  if (params.get('appId') !== APP_ID) return { error: 'invalid_app_id' }

  const rawCode = params.get('versionCode') ?? ''
  if (!VERSION_CODE.test(rawCode)) return { error: 'invalid_version_code' }
  const versionCode = Number(rawCode)
  if (versionCode > MAX_VERSION_CODE) return { error: 'invalid_version_code' }

  const channel = params.get('channel') ?? 'stable'
  if (!CHANNEL.test(channel)) return { error: 'invalid_channel' }

  const platform = params.get('platform') ?? 'android'
  if (platform !== 'android') return { error: 'invalid_platform' }

  return { versionCode, channel }
}

function absoluteApkUrl(apkUrl, origin) {
  return apkUrl.startsWith('/') ? `${origin}${apkUrl}` : apkUrl
}

/**
 * The answer for one installed version. `mandatory` is computed against the
 * caller's own version, so raising minSupportedVersionCode affects only the
 * builds below it and never everyone at once.
 */
export function resolveUpdate(manifest, { versionCode, channel }, origin) {
  if (!Object.hasOwn(manifest.channels, channel)) return { error: 'unknown_channel' }
  const release = manifest.channels[channel]
  if (release === null || versionCode >= release.versionCode) return { updateAvailable: false }
  return {
    updateAvailable: true,
    version: release.version,
    versionCode: release.versionCode,
    mandatory: versionCode < release.minSupportedVersionCode,
    releaseNotes: release.releaseNotes,
    apkUrl: absoluteApkUrl(release.apkUrl, origin),
    sha256: release.sha256,
    sizeBytes: release.sizeBytes,
    publishedAt: release.publishedAt,
  }
}

/** Where the stable "latest APK" link points, or null with nothing published. */
export function latestApkUrl(manifest, origin) {
  const release = manifest?.channels?.stable
  return release ? absoluteApkUrl(release.apkUrl, origin) : null
}
