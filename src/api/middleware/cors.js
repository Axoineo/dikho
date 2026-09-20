import { cors } from 'hono/cors'

// Dashboard origins are configured via env (comma-separated), never via "*",
// so authenticated routes added in later phases stay locked down.
// Set ALLOWED_ORIGINS in .dev.vars / Cloudflare secrets, e.g.:
//   ALLOWED_ORIGINS=https://manage.dikho.in,http://localhost:5173
export function corsMiddleware() {
  return cors({
    origin: (origin, c) => {
      const allowed = (c.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
      return allowed.includes(origin) ? origin : null
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
}
