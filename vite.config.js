import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* Public landing pages are lazy routes, so at runtime their chunk is only
   requested once the main bundle has downloaded AND parsed — the two waits run
   back to back instead of overlapping. index.html carries a small inline script
   that preloads the chunk for the path being visited; it needs the hashed
   filenames, which only exist after the bundle is generated. This plugin fills
   them in, keyed by path so a CRM visitor never fetches a public page's code.

   Keys must stay lowercase and without a trailing slash — that is the shape the
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), publicRoutePreload()],
})
