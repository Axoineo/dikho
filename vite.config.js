import { createHash } from 'node:crypto'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { DEFAULT_API_BASE } from './src/lib/apiBase.js'

/* Public landing pages are lazy routes, so at runtime their chunk is only
   requested once the main bundle has downloaded AND parsed. The two waits then
   run back to back instead of overlapping. index.html carries a small inline script
   that preloads the chunk for the path being visited; it needs the hashed
   filenames, which only exist after the bundle is generated. This plugin fills
   them in, keyed by path so a CRM visitor never fetches a public page's code.

   Keys must stay lowercase and without a trailing slash, which is the shape the
   inline script normalises location.pathname to, which is also what lets the
   /Corporategifting capitalisation alias work. */
const PUBLIC_ROUTES = {
  '/corporategifting': 'src/features/public/PublicClientWelcome.jsx',
  '/vendor/register': 'src/features/public/PublicVendorForm.jsx',
}

function publicRoutePreload() {
  return {
    name: 'dikho-public-route-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html

        const map = {}
        for (const [routePath, source] of Object.entries(PUBLIC_ROUTES)) {
          const chunk = Object.values(ctx.bundle).find(
            (c) => c.type === 'chunk' && c.facadeModuleId && c.facadeModuleId.endsWith(source),
          )
          if (!chunk) continue
          const files = ['/' + chunk.fileName]
          for (const css of chunk.viteMetadata?.importedCss ?? []) files.push('/' + css)
          map[routePath] = files
        }

        // No matches means the route files moved. Leaving the placeholder in
        // place keeps the inline script a valid no-op rather than breaking it.
        if (Object.keys(map).length === 0) return html
        return html.replace('{/*DIKHO_PUBLIC_CHUNKS*/}', JSON.stringify(map))
      },
    },
  }
}

/* Browser security headers for Cloudflare Pages, written to dist/_headers.

   Generated rather than committed for two reasons. The Content-Security-Policy
   allows index.html's inline <script> and <style> blocks by their SHA-256
   hash, and the first script's text changes on every build (the plugin above
   writes hashed chunk names into it). And the policy has to name this
   instance's Supabase project and API origin, which come from build-time
   environment variables, so nothing project-specific is committed and a
   self-hosted build gets its own origins.

   The CSP ships as Content-Security-Policy-Report-Only: violations are printed
   in the browser console but nothing is blocked. Once a pass through every
   screen (dashboard, inbox, PDFs, both public forms with Turnstile) shows no
   violations, build with CSP_MODE=enforce (a Pages environment variable) to
   send the enforcing header instead. Report-only ignores frame-ancestors, so
   X-Frame-Options carries the anti-framing rule in the meantime. */
function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function securityHeaders(env) {
  const cspHash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`

  return {
    name: 'dikho-security-headers',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html']
      if (!html || html.type !== 'asset') {
        this.warn('index.html not found in the bundle; dist/_headers was not written')
        return
      }
      const source = String(html.source)
      const scriptHashes = [...source.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => cspHash(m[1]))
      const styleHashes = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => cspHash(m[1]))
      if (/\son[a-z]+\s*=/i.test(source.replace(/<script[\s\S]*?<\/script>/g, ''))) {
        this.error('index.html has an inline event handler attribute; the CSP cannot allow it. Use addEventListener in a script.')
      }

      const api = originOf(env.VITE_API_BASE || DEFAULT_API_BASE)
      const supabase = originOf(env.VITE_SUPABASE_URL)
      if (!supabase) this.warn('VITE_SUPABASE_URL is not set; the generated CSP will not allow the Supabase project')
      const supabaseWs = supabase && supabase.replace(/^http/, 'ws')
      const turnstile = 'https://challenges.cloudflare.com'

      const directives = {
        'default-src': ["'self'"],
        'script-src': ["'self'", ...scriptHashes, turnstile],
        'style-src': ["'self'", ...styleHashes, 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', api],
        'media-src': ["'self'", 'blob:', api],
        'connect-src': ["'self'", api, supabase, supabaseWs, 'https://api.postalpincode.in', turnstile],
        'frame-src': [turnstile, api],
        'worker-src': ["'self'", 'blob:'],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      }
      const csp = Object.entries(directives)
        .map(([name, values]) => [name, ...new Set(values.filter(Boolean))].join(' '))
        .join('; ')
      const cspHeader = env.CSP_MODE === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'

      const headers = [
        '# Generated by the dikho-security-headers plugin in vite.config.js. Do not edit.',
        '/*',
        `  ${cspHeader}: ${csp}`,
        '  X-Frame-Options: DENY',
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=()',
        '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
        '  Cross-Origin-Opener-Policy: same-origin',
        '',
      ].join('\n')

      this.emitFile({ type: 'asset', fileName: '_headers', source: headers })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' loads every variable (from .env files and the process environment), not
  // just VITE_ ones, so CSP_MODE is visible here. None of it reaches the
  // bundle: only import.meta.env.VITE_* does.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), publicRoutePreload(), securityHeaders(env)],
  }
})
