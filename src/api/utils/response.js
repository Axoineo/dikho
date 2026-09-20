// Standard response envelope used by every /api route except /api/health,
// which returns a flat shape to match Meta/monitoring conventions.

export function ok(c, data, status = 200) {
  return c.json({ success: true, data }, status)
}

export function fail(c, code, message, status = 400) {
  return c.json({ success: false, error: { code, message } }, status)
}
