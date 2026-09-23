import { Hono } from 'hono'
import { corsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/errorHandler.js'
import { requireAuth } from './middleware/requireAuth.js'
import health from './routes/health.js'
import whatsapp from './routes/whatsapp/index.js'
import contacts from './routes/contacts/index.js'
import campaigns from './routes/campaigns/index.js'
import templates from './routes/templates/index.js'

// Root Hono app for everything under /api. Kept separate from src/worker.js
// so the SPA asset fallback never has to know about API internals.
export function createApiApp() {
  const app = new Hono().basePath('/api')

  app.use('*', corsMiddleware())
  app.onError(errorHandler)

  // Public: uptime checks, and Meta's webhook (authenticated by verify token
  // on GET, and by the payload's own signature contract on POST).
  app.route('/health', health)
  app.route('/whatsapp', whatsapp)

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
