import { Hono } from 'hono'
import { corsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/errorHandler.js'
import { requireAuth } from './middleware/requireAuth.js'
import health from './routes/health.js'
import whatsapp from './routes/whatsapp/index.js'
import auth from './routes/auth/index.js'
import publicRoutes from './routes/public/index.js'
import gstn from './routes/gstn/index.js'
import contacts from './routes/contacts/index.js'
import campaigns from './routes/campaigns/index.js'
import templates from './routes/templates/index.js'

// Root Hono app for everything under /api. Kept separate from src/worker.js
// so the SPA asset fallback never has to know about API internals.
export function createApiApp() {
  const app = new Hono().basePath('/api')

  app.use('*', corsMiddleware())
  app.onError(errorHandler)

  // Public: uptime checks, Meta's webhook (authenticated by verify token on
  // GET, and by the payload's own signature contract on POST), and Supabase's
  // Send-SMS auth hook (authenticated by its Standard Webhooks HMAC signature).
  app.route('/health', health)
  app.route('/whatsapp', whatsapp)
  app.route('/auth', auth)

  // Public form writes (vendor registration, corporate-gifting lead). No
  // session by design — each route verifies a Cloudflare Turnstile token before
  // it writes, which is the only thing standing between these and a bot.
  app.route('/public', publicRoutes)

  // GSTIN → taxpayer lookup for the form autofill. Read-only, and the data is
  // already public on gst.gov.in, so this is not gated on a session: the public
  // vendor form has none, and Turnstile cannot help here either (its tokens are
  // single-use and spent at submit). What protects it is a strict format gate
  // plus a per-IP rate limit — see routes/gstn/index.js. The internal forms are
  // meant to call this same route.
  app.route('/gstn', gstn)

  // Dashboard routes — require a valid Supabase session. Both the bare path
  // and the wildcard are registered: Hono's `/x/*` does not match `/x`.
  for (const base of ['/contacts', '/campaigns', '/templates']) {
    app.use(base, requireAuth)
    app.use(`${base}/*`, requireAuth)
  }
  app.route('/contacts', contacts)
  app.route('/campaigns', campaigns)
  app.route('/templates', templates)

  return app
}
