import { useCallback, useEffect, useRef, useState } from 'react'
import { apiPublicGet } from './api'
import {
  GSTIN_LENGTH,
  isGstinChecksumValid,
  isGstinFormatValid,
  normalizeGstin,
  offlineVendorFields,
} from './gstin'

/**
 * Watches a GSTIN input and auto-fills from the GST directory.
 *
 * Shared on purpose. The public vendor form is the first caller, but the
 * internal vendor / client / SO / PO forms are meant to use this same hook and
 * differ only in their field mapper (see taxpayerToVendorFields in ./gstin.js).
 * Nothing here knows any form's field names.
 *
 * The contract that matters: THIS NEVER BLOCKS. Every failure path ends with
 * the user still able to type the form in by hand, and the two fields that are
 * derivable from the GSTIN itself (PAN, state) are filled even when the
 * network call fails entirely.
 *
 * @param gstin           the raw input value, re-read on every render
 * @param mapTaxpayer     (taxpayer, gstin) => fields — the ONLY form-specific
 *                        piece. The vendor form passes taxpayerToVendorFields;
 *                        a future SO/PO form passes its own mapper.
 * @param onAutofill      (fields, meta) => void — always receives mapped
 *                        fields, never a raw response, and only keys that have
 *                        values. meta.source is 'derived' for the offline pass
 *                        and 'lookup' for the API result.
 * @param debounceMs      quiet period before the call fires
 * @param enabled         set false to disable lookups entirely
 *
 * @returns { status, message, taxpayer, retry }
 *   status: 'idle'       nothing to do (empty or still being typed)
 *           'checking'   request in flight
 *           'filled'     details found and handed to onAutofill
 *           'notfound'   GSTIN is well-formed but the directory has no record
 *           'error'      lookup failed — manual entry, nothing lost
 *           'malformed'  15 characters typed but not a GSTIN shape
 *   message: a sentence safe to show the user as a gentle hint
 */
// Ceiling on the whole round trip to our Worker, which bounds its own upstream
// call at 8s. Comfortably longer than that, so a slow-but-working lookup is
// never cut off by the client first.
const LOOKUP_TIMEOUT_MS = 15_000

export function useGstinLookup(gstin, { mapTaxpayer, onAutofill, debounceMs = 500, enabled = true } = {}) {
  const [state, setState] = useState({ status: 'idle', message: '', taxpayer: null })

  // Held in refs so inline arrow callbacks from the form do not restart the
  // debounce on every keystroke-driven re-render.
  const autofillRef = useRef(onAutofill)
  autofillRef.current = onAutofill
  const mapRef = useRef(mapTaxpayer)
  mapRef.current = mapTaxpayer

  // Monotonic id per attempt. A response whose id is stale is discarded rather
  // than applied, so a slow lookup can never overwrite a newer one's fields.
  const attemptRef = useRef(0)
  const abortRef = useRef(null)

  // Last GSTIN that produced a verdict, so re-focusing the field or tabbing
  // back does not spend another call on an answer we already have.
  const settledRef = useRef('')

  const run = useCallback(async (value, { force = false } = {}) => {
    const clean = normalizeGstin(value)

    if (!force && settledRef.current === clean) return

    const attempt = attemptRef.current + 1
    attemptRef.current = attempt

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const isCurrent = () => attemptRef.current === attempt

    // The Worker bounds its own call to API Setu, but nothing bounds the hop to
    // the Worker. Without this a stalled connection leaves the field spinning
    // with no way out. Flagged rather than just aborted, because an abort from
    // a keystroke is ignored on purpose and a timeout must not be.
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, LOOKUP_TIMEOUT_MS)

    // PAN and state code come out of the GSTIN's own characters, so they are
    // applied immediately and unconditionally — before the network is even
    // touched, and therefore still correct if it never answers.
    const derived = offlineVendorFields(clean)
    if (Object.keys(derived).length) autofillRef.current?.(derived, { source: 'derived' })

    setState({ status: 'checking', message: 'Looking up GST details…', taxpayer: null })

    try {
      const data = await apiPublicGet(`/gstn/${clean}`, { signal: controller.signal })
      if (!isCurrent()) return

      settledRef.current = clean
      const taxpayer = data?.taxpayer ?? null
      const fields = mapRef.current?.(taxpayer, clean) ?? {}
      if (Object.keys(fields).length) {
        autofillRef.current?.(fields, { source: 'lookup', gstin: clean, taxpayer })
      }

      const name = taxpayer?.tradeName || taxpayer?.legalName || 'GST details'
      const inactive = taxpayer?.status && !/^active$/i.test(taxpayer.status)

      setState({
        status: 'filled',
        message: inactive
          ? `Found ${name}, but this GSTIN is ${taxpayer.status}. Please check before submitting.`
          : `Auto-filled from ${name}. Please review and edit anything that is out of date.`,
        taxpayer,
      })
    } catch (err) {
      // An aborted request is usually a newer keystroke, not a failure — leave
      // the status alone so the UI does not flash an error mid-typing. A
      // timeout aborts too, and that one DOES have to surface.
      if ((err?.name === 'AbortError' && !timedOut) || !isCurrent()) return

      settledRef.current = clean

      const text = timedOut ? 'GST lookup timed out.' : String(err?.message || '')
      const notFound = err?.status === 404

      setState({
        status: notFound ? 'notfound' : 'error',
        // No checksum caveat here any more: a bad check digit never reaches
        // this point, so a 404 means the directory genuinely has no such
        // taxpayer rather than "you may have mistyped it".
        message: notFound
          ? 'No details found for this GSTIN. You can still fill the form in manually.'
          : `${text || 'GST lookup is unavailable.'} Please fill the remaining fields manually.`,
        taxpayer: null,
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined

    const clean = normalizeGstin(gstin)

    // The trigger condition: exactly 15 characters, nothing sooner.
    if (clean.length !== GSTIN_LENGTH) {
      abortRef.current?.abort()
      attemptRef.current += 1 // invalidate anything still in flight
      settledRef.current = ''
      setState((prev) => (prev.status === 'idle' ? prev : { status: 'idle', message: '', taxpayer: null }))
      return undefined
    }

    if (!isGstinFormatValid(clean)) {
      abortRef.current?.abort()
      attemptRef.current += 1
      setState({
        status: 'malformed',
        message: 'That does not look like a GSTIN. Check it, or just fill the form in manually.',
        taxpayer: null,
      })
      return undefined
    }

    // A failed check digit means a typo: the last character is derived from the
    // other fourteen, so at a full 15 characters this is arithmetic, not an
    // incomplete entry. The route enforces this too and would answer 400, so
    // calling it would spend a round trip and a rate-limit slot to be told what
    // we already know. Stopping here is also what keeps a mistyped GSTIN from
    // costing anything at all against the daily lookup budget.
    if (!isGstinChecksumValid(clean)) {
      abortRef.current?.abort()
      attemptRef.current += 1
      setState({
        status: 'malformed',
        message: 'That GSTIN does not look right — please check it for a typo.',
        taxpayer: null,
      })
      return undefined
    }

    const timer = setTimeout(() => { run(clean) }, debounceMs)
    return () => clearTimeout(timer)
  }, [gstin, enabled, debounceMs, run])

  // Abort whatever is in flight when the form unmounts, so a late response
  // cannot call setState on a dead component.
  useEffect(() => () => abortRef.current?.abort(), [])

  const retry = useCallback(() => {
    const clean = normalizeGstin(gstin)
    if (clean.length === GSTIN_LENGTH && isGstinFormatValid(clean) && isGstinChecksumValid(clean)) run(clean, { force: true })
  }, [gstin, run])

  return { ...state, retry }
}
