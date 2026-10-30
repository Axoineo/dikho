// Text helpers for the WhatsApp screens.

/** "APPROVED" or "completed" as "Approved", "Completed": labels are sentence case. */
export function sentenceCase(text) {
  if (!text) return text
  const value = String(text).toLowerCase()
  return value.charAt(0).toUpperCase() + value.slice(1)
}
