import { createApiApp } from './app.js'

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
}
