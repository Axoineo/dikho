/**
 * Date calculation utilities.
 * No React, no side effects.
 */

export function campaignDays(start, end) {
  if (!start || !end) return null
  const from = new Date(start)
  const to = new Date(end)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  const days = Math.round((to - from) / 86400000) + 1
  return days > 0 ? days : null
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
