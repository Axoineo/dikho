import { Hono } from 'hono'
import { corsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/errorHandler.js'
import { requireAuth } from './middleware/requireAuth.js'
import health from './routes/health.js'
import whatsapp from './routes/whatsapp/index.js'
import auth from './routes/auth/index.js'
import publicRoutes from './routes/public/index.js'
import gstn from './routes/gstn/index.js'
import avatars from './routes/avatars/index.js'
import contacts from './routes/contacts/index.js'
import campaigns from './routes/campaigns/index.js'
import templates from './routes/templates/index.js'
import cgLeads from './routes/cgLeads/index.js'
import users from './routes/users/index.js'
import me from './routes/me/index.js'
import { maybeDispatchOnRequest } from './services/whatsapp/cgLeadConfirmation.js'
import { maybeReconcileOnRequest } from './services/whatsapp/reconcile.js'

// Root Hono app for everything under /api. Kept separate from src/worker.js
// so the SPA asset fallback never has to know about API internals.
export function createApiApp() {
  const app = new Hono().basePath('/api')

  app.use('*', corsMiddleware())
  app.onError(errorHandler)

  // Baseline headers on every API response. JSON is never sniffed into
  // something executable, and no URL (media tickets ride in the query string)
  // leaks to another site through Referer. The media route adds its own
  // download/sandbox headers for content that is not safe to render inline.
  app.use('*', async (c, next) => {
    await next()
    try {
      c.res.headers.set('X-Content-Type-Options', 'nosniff')
      c.res.headers.set('Referrer-Policy', 'no-referrer')
    } catch { /* immutable upstream response: leave it as it is */ }
  })

  // Drains the corporate-gifting confirmation queue off ordinary traffic,
  // because this account's Cron Triggers are not firing (verified 2026-10-01 —
  // see maybeDispatchOnRequest for the evidence). Throttled to at most once
  // every 30s per isolate and dispatched via waitUntil, so it costs the
  // request nothing and never delays a response. Registered before the routes
  // so it covers every endpoint, including the unauthenticated ones.
  // Both of these exist because this account's Cron Triggers never fire, so
  // anything that used to rely on a schedule now rides on request traffic
  // instead. Each is throttled per isolate, guarded against doing pointless
  // work, and dispatched via waitUntil — they cost the request nothing and
  // never delay a response.
  app.use('*', async (c, next) => {
    maybeDispatchOnRequest(c)   // corporate-gifting confirmation queue (30s)
    maybeReconcileOnRequest(c)  // parked WhatsApp delivery receipts (2 min)
    await next()
  })

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

  // Profile pictures. Mixed auth, so it is not in the requireAuth loop below:
  // GET /avatars/:userId is public (the URL lives in user_metadata and is
  // rendered by a plain <img>), while POST carries requireAuth on the handler
  // itself. See routes/avatars/index.js for why the read side is safe.
  app.route('/avatars', avatars)

  // Dashboard routes: require a live session of an active staff member. Both
  // the bare path and the wildcard are registered: Hono's `/x/*` does not
  // match `/x`. Each route then checks its own permission (requirePermission).
  for (const base of ['/contacts', '/campaigns', '/templates', '/cg-leads', '/users', '/me']) {
    app.use(base, requireAuth)
    app.use(`${base}/*`, requireAuth)
  }
  app.route('/contacts', contacts)
  app.route('/campaigns', campaigns)
  app.route('/templates', templates)
  app.route('/cg-leads', cgLeads)
  app.route('/users', users)
  app.route('/me', me)

  return app
}
