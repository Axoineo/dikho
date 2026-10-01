import { createApiApp } from './app.js'
import { reconcileInbound, reconcileStatuses } from './services/whatsapp/reconcile.js'
import { dispatchDueCgLeadConfirmations } from './services/whatsapp/cgLeadConfirmation.js'
import { logEvent, logError } from './utils/logger.js'

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

  // Two cron schedules (wrangler.api.jsonc), routed apart on `event.cron`:
  //
  //   * * * * *     — sends corporate-gifting confirmations whose ~7-minute
  //                   delay has elapsed. A Worker cannot wait that long inside
  //                   a request, so the send is queued in D1 and picked up
  //                   here (services/whatsapp/cgLeadConfirmation.js).
  //   */10 * * * *  — re-applies delivery receipts that arrived before their
  //                   message row had a wamid; without this sweep they sit in
  //                   webhook_events forever and our delivery numbers
  //                   under-report Meta's.
  //
  // Routing matters: the reconciler is a heavier D1 sweep, and running it
  // every minute instead of every ten would multiply its row-reads against a
  // free-tier budget that migration 0006 records running out once already.
  // Both fire together on the tens, as separate invocations.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      // Logged first and unconditionally: `event.cron` is the only way to tell
      // the two schedules apart, and an exact-string assumption about it is
      // not worth trusting silently — a mismatch would stall the outbox with
      // no visible error anywhere.
      logEvent('cron.fired', { cron: event.cron })

      // Runs on EVERY tick rather than only the every-minute schedule. It is
      // one indexed SELECT that returns nothing the vast majority of the time,
      // and making it unconditional means a cron-string surprise can never
      // strand queued confirmations.
      try {
        await dispatchDueCgLeadConfirmations(env)
      } catch (err) {
        logError('cron.cg_lead_dispatch_failed', err)
      }

      // The reconciler is the heavy D1 sweep, so it stays off the
      // every-minute schedule — running it 10x more often spends row-reads
      // against the free-tier budget migration 0006 records running out once.
      if (event.cron === '* * * * *') return

      await reconcileStatuses(env.DB)
      // processInboundMessage expects a request-shaped context; a cron only has
      // (env, ctx), so hand it the two properties it actually reads.
      await reconcileInbound({ env, executionCtx: ctx })
    })())
  },
}
