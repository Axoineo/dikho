import { HTTPException } from 'hono/http-exception'
import { fail } from '../utils/response.js'
import { logError } from '../utils/logger.js'

// Registered via app.onError() so a malformed body, a thrown HTTPException,
// or any unexpected error in a route/service never crashes the Worker or
// leaks a stack trace to the caller.
export function errorHandler(err, c) {
  if (err instanceof HTTPException) {
    return fail(c, 'HTTP_EXCEPTION', err.message, err.status)
  }

  logError('api.error', err)
  return fail(c, 'INTERNAL_ERROR', 'Something went wrong processing this request', 500)
}

// Request bodies are parsed by utils/body.js, which bounds their size first.
