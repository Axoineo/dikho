import { Hono } from 'hono'
import { corsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/errorHandler.js'
import health from './routes/health.js'
import whatsapp from './routes/whatsapp/index.js'

// Root Hono app for everything under /api. Kept separate from
// src/worker.js so the asset-serving fallback for the React SPA never has
// to know about API internals, and so this file stays a plain manifest of
// which route module owns which path.
export function createApiApp() {
  const app = new Hono().basePath('/api')

  app.use('*', corsMiddleware())
  app.onError(errorHandler)

  app.route('/health', health)
  app.route('/whatsapp', whatsapp)

  // Future modules mount here, each isolated in its own route file:
  // import contacts from './routes/contacts/index.js'
  // import campaigns from './routes/campaigns/index.js'
  // import reports from './routes/reports/index.js'
  // app.route('/contacts', contacts)
  // app.route('/campaigns', campaigns)
  // app.route('/reports', reports)

  return app
}
