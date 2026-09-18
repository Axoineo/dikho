/**
 * Schema-tolerant write engine for Supabase/PostgREST.
 *
 * `salesorder` was created outside this repo and its column types cannot be
 * introspected from the browser, so the writes below react to what PostgREST
 * reports rather than assuming:
 *
 *   PGRST204  the column is not in the table → drop it and retry
 *   23502     NOT NULL on a column left empty → fill it and retry
 *
 * Each retry strictly shrinks or completes the payload and the loop is bounded,
 * so a column this module genuinely cannot satisfy surfaces as the database's
 * own error instead of spinning. Anything else (a type mismatch, a check
 * constraint, an RLS refusal) is re-thrown untouched — those need a human, not
 * a retry.
 */

import { missingColumnFrom, notNullColumnFrom } from './status'

const MAX_WRITE_ATTEMPTS = 8

// `run` receives the (possibly adjusted) rows and performs one request. Callers
// that write a single row pass a one-element array and read `rows[0]`.
export async function writeRows(run, rows, fallbacks) {
  let current = rows.map((row) => ({ ...row }))

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { data, error } = await run(current)
    if (!error) return data

    const missing = missingColumnFrom(error)
    if (missing && current.some((row) => missing in row)) {
      current = current.map((row) => {
        const next = { ...row }
        delete next[missing]
        return next
      })
      continue
    }

    const required = notNullColumnFrom(error)
    const isEmpty = (row) => row[required] === null || row[required] === undefined
    if (required && fallbacks[required] && current.some(isEmpty)) {
      current = current.map((row, index) => (isEmpty(row) ? { ...row, [required]: fallbacks[required](rows[index] || {}, index) } : row))
      continue
    }

    throw error
  }

  throw new Error('Could not find a payload this table accepts. Compare its definition against the columns the Sales Orders module writes.')
}
