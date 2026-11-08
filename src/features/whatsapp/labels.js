// Text helpers for the WhatsApp screens.

/** "APPROVED" or "completed" as "Approved", "Completed": labels are sentence case. */
export function sentenceCase(text) {
  if (!text) return text
  const value = String(text).toLowerCase()
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// The one-line summary shown after an import.
export function importSummary(result) {
  const parts = [`Imported ${result.imported} new contact${result.imported === 1 ? '' : 's'}`]
  if (result.updated) parts.push(`updated ${result.updated}`)
  if (result.unchanged) parts.push(`${result.unchanged} already up to date`)
  const skipped = Object.values(result.skipped ?? {}).reduce((sum, n) => sum + n, 0) + (result.invalid ?? 0)
  return `${parts.join(', ')}.${skipped ? ` ${skipped} row${skipped === 1 ? ' was' : 's were'} skipped.` : ''}`
}
