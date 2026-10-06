// Origin of the API Worker when VITE_API_BASE is not set. Kept in its own
// dependency-free module because vite.config.js also reads it, to allow this
// origin in the Content-Security-Policy it generates.
export const DEFAULT_API_BASE = 'https://dikho-api.fineeurox.workers.dev'
