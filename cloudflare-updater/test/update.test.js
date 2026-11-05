import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { handleRequest } from '../src/index.js'
import { manifestProblems, releaseProblems } from '../src/update.js'

const SHA = 'a'.repeat(64)
const RELEASE = {
  version: '1.2.0',
  versionCode: 5,
  minSupportedVersionCode: 3,
  releaseNotes: 'Bug fixes.',
  apkUrl: '/releases/dikho-crm-v1.2.0.apk',
  sha256: SHA,
  sizeBytes: 12345,
  publishedAt: '2026-11-04T00:00:00Z',
}
const MANIFEST = { schema: 1, appId: 'in.dikho.crm', channels: { stable: RELEASE, beta: null } }

const ORIGIN = 'https://updates.example.test'
const get = (path, manifest = MANIFEST, init) => handleRequest(new Request(`${ORIGIN}${path}`, init), manifest)
const check = (code, extra = '') => get(`/api/update?appId=in.dikho.crm&versionCode=${code}${extra}`)

test('no update when installed is current or newer', async () => {
  for (const code of [5, 6]) {
    const res = await check(code)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { updateAvailable: false })
  }
})

test('update available returns the full metadata with an absolute URL', async () => {
  const body = await (await check(4)).json()
  assert.deepEqual(body, {
    updateAvailable: true,
    version: '1.2.0',
    versionCode: 5,
    mandatory: false,
    releaseNotes: 'Bug fixes.',
    apkUrl: `${ORIGIN}/releases/dikho-crm-v1.2.0.apk`,
    sha256: SHA,
    sizeBytes: 12345,
    publishedAt: '2026-11-04T00:00:00Z',
  })
})

test('mandatory applies only below the minimum supported version', async () => {
  assert.equal((await (await check(3)).json()).mandatory, false)
  assert.equal((await (await check(2)).json()).mandatory, true)
})

test('a channel with nothing published reports no update', async () => {
  assert.deepEqual(await (await check(1, '&channel=beta')).json(), { updateAvailable: false })
})

test('an absolute https APK URL passes through unchanged', async () => {
  const apkUrl = 'https://downloads.example.test/dikho-crm-v1.2.0.apk'
  const manifest = { ...MANIFEST, channels: { stable: { ...RELEASE, apkUrl } } }
  const res = await get('/api/update?appId=in.dikho.crm&versionCode=1', manifest)
  assert.equal((await res.json()).apkUrl, apkUrl)
})

test('invalid input is rejected with a specific error', async () => {
  const cases = [
    ['/api/update', 'invalid_app_id'],
    ['/api/update?appId=com.other&versionCode=1', 'invalid_app_id'],
    ['/api/update?appId=in.dikho.crm', 'invalid_version_code'],
    ['/api/update?appId=in.dikho.crm&versionCode=', 'invalid_version_code'],
    ['/api/update?appId=in.dikho.crm&versionCode=abc', 'invalid_version_code'],
    ['/api/update?appId=in.dikho.crm&versionCode=-1', 'invalid_version_code'],
    ['/api/update?appId=in.dikho.crm&versionCode=0', 'invalid_version_code'],
    ['/api/update?appId=in.dikho.crm&versionCode=1.5', 'invalid_version_code'],
    ['/api/update?appId=in.dikho.crm&versionCode=1e3', 'invalid_version_code'],
    ['/api/update?appId=in.dikho.crm&versionCode=2100000001', 'invalid_version_code'],
    ['/api/update?appId=in.dikho.crm&versionCode=99999999999', 'invalid_version_code'],
    ['/api/update?appId=in.dikho.crm&versionCode=1&versionCode=2', 'duplicate_parameter'],
    ['/api/update?appId=in.dikho.crm&versionCode=1&channel=BAD!', 'invalid_channel'],
    ['/api/update?appId=in.dikho.crm&versionCode=1&platform=ios', 'invalid_platform'],
    ['/api/update?appId=in.dikho.crm&versionCode=1&deviceId=abc', 'unknown_parameter'],
  ]
  for (const [path, error] of cases) {
    const res = await get(path)
    assert.equal(res.status, 400, path)
    assert.deepEqual(await res.json(), { error }, path)
  }
})

test('an unknown channel is a 404, including inherited object keys', async () => {
  for (const channel of ['nightly', 'constructor']) {
    const res = await check(1, `&channel=${channel}`)
    assert.equal(res.status, 404, channel)
    assert.deepEqual(await res.json(), { error: 'unknown_channel' })
  }
})

test('malformed metadata answers 500 and reveals nothing', async () => {
  const bad = { ...MANIFEST, channels: { stable: { ...RELEASE, sha256: 'nope' } } }
  const res = await get('/api/update?appId=in.dikho.crm&versionCode=1', bad)
  assert.equal(res.status, 500)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await res.json(), { error: 'release_metadata_invalid' })
})

test('the validators catch each malformed release field', () => {
  const broken = {
    version: ['1.2', 'v1.2.0', 7],
    versionCode: [0, -1, 1.5, '5', 2100000001],
    minSupportedVersionCode: [0, 6, null],
    releaseNotes: [null, 'x'.repeat(2001)],
    apkUrl: [
      'http://downloads.example.test/a.apk',
      'https://user:pw@downloads.example.test/a.apk',
      'https://downloads.example.test/a.apk?token=1',
      'https://downloads.example.test/a.exe',
      '/releases/../secret.apk',
      '/other/dikho-crm-v1.2.0.apk',
      'not a url',
      7,
    ],
    sha256: ['abc', 'A'.repeat(64), 'g'.repeat(64)],
    sizeBytes: [0, -1, 1.5, '1', 300 * 1024 * 1024],
    publishedAt: ['yesterday', '2026-13-45T00:00:00Z', 7],
  }
  for (const [field, values] of Object.entries(broken)) {
    for (const value of values) {
      assert.ok(releaseProblems({ ...RELEASE, [field]: value }).length > 0, `${field}=${value}`)
    }
  }
  assert.deepEqual(releaseProblems(RELEASE), [])
  assert.ok(manifestProblems(null).length > 0)
  assert.ok(manifestProblems({ ...MANIFEST, schema: 2 }).length > 0)
  assert.ok(manifestProblems({ ...MANIFEST, appId: 'x' }).length > 0)
  assert.ok(manifestProblems({ ...MANIFEST, channels: [] }).length > 0)
})

test('only GET and HEAD are accepted, so nothing can publish through the API', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await get('/api/update?appId=in.dikho.crm&versionCode=1', MANIFEST, { method })
    assert.equal(res.status, 405, method)
    assert.equal(res.headers.get('allow'), 'GET, HEAD')
  }
  assert.equal((await get('/api/update?appId=in.dikho.crm&versionCode=1', MANIFEST, { method: 'HEAD' })).status, 200)
})

test('plain http is refused off localhost and allowed for local development', async () => {
  const insecure = handleRequest(new Request('http://updates.example.test/api/update'), MANIFEST)
  assert.equal(insecure.status, 403)
  const local = handleRequest(new Request('http://127.0.0.1:8799/api/update?appId=in.dikho.crm&versionCode=1'), MANIFEST)
  assert.equal(local.status, 200)
})

test('/download redirects to the current stable APK', async () => {
  const res = await get('/download')
  assert.equal(res.status, 302)
  assert.equal(res.headers.get('location'), `${ORIGIN}/releases/dikho-crm-v1.2.0.apk`)
  const empty = await get('/download', { ...MANIFEST, channels: { stable: null } })
  assert.equal(empty.status, 404)
})

test('unknown paths are 404 and responses carry the safety headers', async () => {
  assert.equal((await get('/api/publish')).status, 404)
  const res = await check(1)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.match(res.headers.get('content-type'), /^application\/json/)
})

test('the manifest committed to this repo is valid', () => {
  const committed = JSON.parse(readFileSync(new URL('../releases/manifest.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifestProblems(committed), [])
})
