import { lazy } from 'react'

const ATTEMPTS = 4
const BASE_DELAY = 600

/* React.lazy runs its factory exactly once and caches whatever it settles to —
 * a rejection included. A route chunk that fails on a dropped connection is
 * therefore dead for the life of the page: Suspense keeps showing the fallback
 * even after the network comes back, which reads as the loading animation
 * looping forever.
 *
 * This retries the import with backoff, and when the device reports itself
 * offline it waits for the `online` event instead of burning attempts against a
 * connection that cannot succeed.
 *
 * A request that never settles at all is a different failure and cannot be
 * fixed here — the browser keys module requests by URL, so re-importing returns
 * the same pending promise. BrandLoader offers a reload once it has been on
 * screen too long, which is the only real recovery for that case.
 */
export function lazyWithRetry(load) {
  return lazy(() => attempt(load, ATTEMPTS))
}

function attempt(load, left) {
  return load().catch((error) => {
    if (left <= 1) throw error
    return pause(BASE_DELAY * (ATTEMPTS - left + 1)).then(() => attempt(load, left - 1))
  })
}

function pause(ms) {
  return new Promise((resolve) => {
    if (navigator.onLine === false) {
      const resume = () => {
        window.removeEventListener('online', resume)
        resolve()
      }
      window.addEventListener('online', resume)
      return
    }
    setTimeout(resolve, ms)
  })
}
