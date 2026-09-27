import { createApiApp } from './app.js'
import { reconcileInbound, reconcileStatuses } from './services/whatsapp/reconcile.js'

// Entry point for the standalone `dikho-api` Worker
// (https://dikho-api.fineeurox.workers.dev).
//
// This Worker serves ONLY the API. The dashboard SPA is a separate Worker
// (see wrangler.jsonc / src/worker.js) deployed to manage.dikho.in, which is
// why CORS is enforced rather than incidental — the browser calls this
// Worker cross-origin.
const app = createApiApp()

export default {
  fetch: app.fetch,

  // Cron (wrangler.api.jsonc). Re-applies delivery receipts that arrived
  // before their message row had a wamid — without this sweep they sit in
  // webhook_events forever and our delivery numbers under-report Meta's.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      await reconcileStatuses(env.DB)
      // processInboundMessage expects a request-shaped context; a cron only has
      // (env, ctx), so hand it the two properties it actually reads.
      await reconcileInbound({ env, executionCtx: ctx })
    })())
  },
}
