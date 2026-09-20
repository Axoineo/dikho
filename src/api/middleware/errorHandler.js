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

// Used inside route handlers wrapping request.json() so a bad payload from
// a client (or a Meta retry with an unexpected shape) returns a clean 400
// instead of bubbling up as an unhandled rejection.
export async function parseJson(c) {
  try {
    return await c.req.json()
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }
}
