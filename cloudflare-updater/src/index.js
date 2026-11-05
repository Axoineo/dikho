// The update API. Read-only by design: there is no route that publishes.
// Releases go out only as a `wrangler deploy` by someone logged in to the
// Cloudflare account, see cloudflare-updater/README.md. APK files are served
// as static assets, so a download never runs this code.

import manifest from '../releases/manifest.json' with { type: 'json' }
import { latestApkUrl, manifestProblems, parseUpdateQuery, resolveUpdate } from './update.js'

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000',
}

function json(body, status, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl, ...SECURITY_HEADERS },
  })
}

const isLocal = (url) => url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '10.0.2.2'

export function handleRequest(request, release = manifest) {
  const url = new URL(request.url)

  if (url.protocol !== 'https:' && !isLocal(url)) return json({ error: 'https_required' }, 403)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const response = json({ error: 'method_not_allowed' }, 405)
    response.headers.set('Allow', 'GET, HEAD')
    return response
  }

  if (url.pathname !== '/api/update' && url.pathname !== '/download') return json({ error: 'not_found' }, 404)

  const problems = manifestProblems(release)
  // The detail stays out of the response. `npm test` names it for an operator.
  if (problems.length) return json({ error: 'release_metadata_invalid' }, 500)

  if (url.pathname === '/download') {
    const target = latestApkUrl(release, url.origin)
    if (!target) return json({ error: 'no_release' }, 404)
    return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'public, max-age=300', ...SECURITY_HEADERS } })
  }

  const query = parseUpdateQuery(url.searchParams)
  if (query.error) return json({ error: query.error }, 400)

  const answer = resolveUpdate(release, query, url.origin)
  if (answer.error) return json({ error: answer.error }, 404)
  // Five minutes: a release reaches everyone quickly, a retry storm does not
  // reach the Worker.
  return json(answer, 200, 'public, max-age=300')
}

export default {
  fetch(request) {
    return handleRequest(request)
  },
}
