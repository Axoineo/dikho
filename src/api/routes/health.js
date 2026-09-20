import { Hono } from 'hono'

const health = new Hono()

// Flat shape (not the {success, data} envelope) — this is what uptime
// checks and load balancers hit, so keep it exactly as specified.
health.get('/', (c) => c.json({ success: true, service: 'dikho-api', status: 'ok' }))

export default health
