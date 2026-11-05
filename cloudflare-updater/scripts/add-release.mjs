#!/usr/bin/env node
// Records a built APK as the channel's latest release: checks it, copies it to
// public/releases under its immutable name and updates releases/manifest.json.
// It never deploys. Review the diff, then deploy as a separate deliberate step.
//
//   node cloudflare-updater/scripts/add-release.mjs \
//     --apk <file> --notes "<text>" [--channel stable] [--min-supported <code>] \
//     [--apk-url <https url>] [--allow-new-cert]
//
// Version, versionCode, application ID and signing certificate are read from
// the APK itself, so the manifest cannot disagree with what was built.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, createReadStream, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { APP_ID, manifestProblems, releaseProblems } from '../src/update.js'

// Cloudflare Workers Static Assets' limit for one file.
const STATIC_ASSET_LIMIT = 25 * 1024 * 1024

const here = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(here, '..', 'releases', 'manifest.json')
const releasesDir = join(here, '..', 'public', 'releases')

function fail(message) {
  console.error(`add-release: ${message}`)
  process.exit(1)
}

function buildTool(name) {
  const sdk = process.env.ANDROID_HOME
  if (!sdk) fail('ANDROID_HOME is not set. Run: source ~/.local/share/dikho-android/env.sh')
  const dir = join(sdk, 'build-tools')
  const versions = existsSync(dir) ? readdirSync(dir).sort() : []
  if (!versions.length) fail('no Android build-tools found under ANDROID_HOME')
  return join(dir, versions.at(-1), name)
}

/** Reads identity from the APK's own manifest and signature block. */
function inspectApk(apk) {
  const badging = execFileSync(buildTool('aapt2'), ['dump', 'badging', apk], { encoding: 'utf8' })
  const match = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m)
  if (!match) fail('could not read the package line from the APK')
  const certs = execFileSync(buildTool('apksigner'), ['verify', '--print-certs', apk], { encoding: 'utf8' })
  const cert = certs.match(/certificate SHA-256 digest: ([0-9a-f]{64})/)
  if (!cert) fail('the APK has no verifiable v2+ signature')
  return { appId: match[1], versionCode: Number(match[2]), version: match[3], cert: cert[1] }
}

async function sha256Of(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

const { values } = parseArgs({
  options: {
    apk: { type: 'string' },
    notes: { type: 'string' },
    channel: { type: 'string', default: 'stable' },
    'min-supported': { type: 'string' },
    'apk-url': { type: 'string' },
    'allow-new-cert': { type: 'boolean', default: false },
  },
})

if (!values.apk || !existsSync(values.apk)) fail('--apk must name an existing file')
if (typeof values.notes !== 'string' || !values.notes.trim()) fail('--notes is required')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const before = manifestProblems(manifest)
if (before.length) fail(`the current manifest is invalid:\n  ${before.join('\n  ')}`)

const apk = inspectApk(values.apk)
if (apk.appId !== APP_ID) fail(`the APK is ${apk.appId}, expected ${APP_ID}`)

// A release signed by another key can never install over existing copies, so
// publishing one strands every user. The pinned certificate stops that, and
// also stops a test-signed build going out by accident.
if (manifest.signingCertSha256 && manifest.signingCertSha256 !== apk.cert && !values['allow-new-cert']) {
  fail('the APK is signed by a different certificate than this manifest pins. Existing installs could not update to it.')
}

const current = Object.hasOwn(manifest.channels, values.channel) ? manifest.channels[values.channel] : null
if (current && apk.versionCode <= current.versionCode) {
  fail(`versionCode ${apk.versionCode} must be higher than the published ${current.versionCode}`)
}

const size = statSync(values.apk).size
const fileName = `dikho-crm-v${apk.version}.apk`
const target = join(releasesDir, fileName)

if (!values['apk-url']) {
  if (size > STATIC_ASSET_LIMIT) {
    fail(`the APK is ${size} bytes, over the 25 MiB Static Assets limit. Host it elsewhere and pass --apk-url (see README).`)
  }
  if (existsSync(target)) fail(`${fileName} already exists. Versioned files are immutable: raise the version instead.`)
}

const minSupported = values['min-supported'] === undefined
  ? (current?.minSupportedVersionCode ?? apk.versionCode)
  : Number(values['min-supported'])

const release = {
  version: apk.version,
  versionCode: apk.versionCode,
  minSupportedVersionCode: minSupported,
  releaseNotes: values.notes.trim(),
  apkUrl: values['apk-url'] ?? `/releases/${fileName}`,
  sha256: await sha256Of(values.apk),
  sizeBytes: size,
  publishedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
}

const problems = releaseProblems(release)
if (problems.length) fail(`the release is invalid:\n  ${problems.join('\n  ')}`)

if (!values['apk-url']) copyFileSync(values.apk, target)
manifest.signingCertSha256 = apk.cert
manifest.channels[values.channel] = release
const temp = `${manifestPath}.tmp`
writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`)
renameSync(temp, manifestPath)

console.log(`Recorded ${apk.version} (code ${apk.versionCode}) on ${values.channel}, ${size} bytes, sha256 ${release.sha256}`)
console.log('Review the manifest diff, then deploy with: npx wrangler deploy -c cloudflare-updater/wrangler.jsonc')
