export default {
  async fetch(request, env, ctx) {
    // Fall back to Vite assets for Cloudflare Workers
    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request)
      if (response.status === 404 && request.method === 'GET') {
        const accept = request.headers.get('Accept')
        if (accept && accept.includes('text/html')) {
          const url = new URL(request.url)
          url.pathname = '/index.html'
          return env.ASSETS.fetch(new Request(url, { headers: request.headers }))
        }
      }
      return response
    }
    return new Response('API route not found or Asset missing', { status: 404 })
  }
}
