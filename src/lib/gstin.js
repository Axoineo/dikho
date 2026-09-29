/**
 * GSTIN parsing, validation and GSTN-response → form-field mapping.
 *
 * Pure: no React, no fetch, no side effects — same contract as ./gst.js. This
 * module is imported by BOTH bundles (the browser forms and the API Worker,
 * see src/api/services/apisetu/gstn.js), so it must stay runtime-agnostic.
 *
 * A GSTIN is 15 characters and entirely derivable:
 *
 *   2 7 A A B C U 9 6 0 3 R   1   Z   M
 *   └┬┘ └──────────┬───────┘ └┬┘ └┬┘ └┬┘
 *    │             │          │   │   └─ check digit (mod-36)
 *    │             │          │   └───── 'Z' for ordinary taxpayers
 *    │             │          └───────── entity number for this PAN in the state
 *    │             └──────────────────── PAN (chars 3-12)
 *    └────────────────────────────────── GST state code (chars 1-2)
 *
 * Which is why PAN and state never need a network call — see panFromGstin()
 * and stateIsoFromGstin(). Only the name/address fields require API Setu.
 */

/* ── Shape ──────────────────────────────────────────────────────────────── */

export const GSTIN_LENGTH = 15

// Position 14 is 'Z' for ordinary taxpayers, but deliberately accepted as any
// letter here: a handful of registration classes (UIN, OIDAR) use something
// else, and a too-strict regex would refuse to look up a real vendor. Being
// permissive costs at most one wasted API call; being strict costs a signup.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][A-Z][0-9A-Z]$/

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/

/** Uppercases and strips spaces/punctuation. Users paste GSTINs with spaces. */
export function normalizeGstin(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '')
}

/** Structural check only — says nothing about whether the GSTIN exists. */
export function isGstinFormatValid(raw) {
  return GSTIN_RE.test(normalizeGstin(raw))
}

/* ── Check digit ────────────────────────────────────────────────────────── */

const CHECKSUM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * The GSTIN check digit: weights alternate 1,2 across the first 14 characters,
 * each product is folded as (quotient + remainder) mod 36, and the digit is the
 * complement of the total to 36.
 *
 * Treated as ADVISORY everywhere it is used, never as a gate. A typo'd GSTIN
 * fails this, but so would a valid one if this implementation is subtly wrong,
 * and refusing to look up a real vendor is far worse than one wasted call. The
 * caller's job is to warn, then look it up anyway — API Setu is the authority
 * on whether a GSTIN exists.
 */
export function gstinCheckDigit(raw) {
  const gstin = normalizeGstin(raw)
  if (gstin.length < GSTIN_LENGTH) return null

  let sum = 0
  for (let i = 0; i < 14; i += 1) {
    const value = CHECKSUM_ALPHABET.indexOf(gstin[i])
    if (value < 0) return null
    const product = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return CHECKSUM_ALPHABET[(36 - (sum % 36)) % 36]
}

export function isGstinChecksumValid(raw) {
  const gstin = normalizeGstin(raw)
  const expected = gstinCheckDigit(gstin)
  return expected != null && expected === gstin[14]
}

/* ── Derivations that need no network call ──────────────────────────────── */

/** Chars 3-12 of the GSTIN are the holder's PAN, verbatim. */
export function panFromGstin(raw) {
  const gstin = normalizeGstin(raw)
  if (gstin.length < 12) return ''
  const pan = gstin.slice(2, 12)
  return PAN_RE.test(pan) ? pan : ''
}

/** Chars 1-2 are the GST state code, e.g. '27' for Maharashtra. */
export function gstStateCodeFromGstin(raw) {
  const gstin = normalizeGstin(raw)
  return /^[0-9]{2}/.test(gstin) ? gstin.slice(0, 2) : ''
}

/**
 * GST state code → the ISO code `country-state-city` uses for Indian states,
 * which is what the address form's State dropdown is keyed on.
 *
 * The ISO codes here were read out of the installed package rather than
 * assumed — several differ from the obvious guess: Chhattisgarh is CT (not CG),
 * Odisha OR (not OD), Telangana TG (not TS), Uttarakhand UT (not UK).
 *
 * 25 (Daman and Diu) and 28 (pre-bifurcation Andhra Pradesh) are retired but
 * still appear in older GSTINs, so both are mapped to their successors.
 * 97 (Other Territory) and 99 (Centre Jurisdiction) have no state and are absent.
 */
export const GST_STATE_ISO = {
  '01': 'JK', '02': 'HP', '03': 'PB', '04': 'CH', '05': 'UT', '06': 'HR',
  '07': 'DL', '08': 'RJ', '09': 'UP', '10': 'BR', '11': 'SK', '12': 'AR',
  '13': 'NL', '14': 'MN', '15': 'MZ', '16': 'TR', '17': 'ML', '18': 'AS',
  '19': 'WB', '20': 'JH', '21': 'OR', '22': 'CT', '23': 'MP', '24': 'GJ',
  '25': 'DH', '26': 'DH', '27': 'MH', '28': 'AP', '29': 'KA', '30': 'GA',
  '31': 'LD', '32': 'KL', '33': 'TN', '34': 'PY', '35': 'AN', '36': 'TG',
  '37': 'AP', '38': 'LA',
}

/** ISO state code for the GSTIN's state, or '' for 97/99 and malformed input. */
export function stateIsoFromGstin(raw) {
  return GST_STATE_ISO[gstStateCodeFromGstin(raw)] || ''
}

/* ── GSTN response → vendor form fields ─────────────────────────────────── */

// GSTN returns dates as DD/MM/YYYY; <input type="date"> needs YYYY-MM-DD.
function isoDate(ddmmyyyy) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(ddmmyyyy ?? '').trim())
  return match ? `${match[3]}-${match[2]}-${match[1]}` : ''
}

function clean(value) {
  return String(value ?? '').trim()
}

// The Registration Type dropdown on the vendor form. `dty` ("taxpayer type")
// carries values like "Regular", "Composition", "Casual Taxable Person"; only
// the composition case maps to a distinct option, everything with a live GSTIN
// is Registered.
function registrationType(taxpayer) {
  const dty = clean(taxpayer.taxpayerType).toLowerCase()
  if (dty.includes('composition')) return 'Composition'
  return 'Registered'
}

/**
 * Normalized taxpayer (from src/api/services/apisetu/gstn.js) → the exact field
 * names PublicVendorForm's `form` state uses. Returns only the keys it has a
 * value for, so the caller can merge without blanking anything.
 *
 * This is the single place that knows the vendor form's field names. When the
 * internal vendor / client / SO / PO forms get the same autofill, give each its
 * own mapper here rather than teaching this one about every schema.
 */
export function taxpayerToVendorFields(taxpayer, gstin) {
  if (!taxpayer) return {}

  const address = taxpayer.address || {}
  const city = clean(address.city) || clean(address.district)
  const stateIso = stateIsoFromGstin(gstin)

  const fields = {
    company_name: clean(taxpayer.legalName),
    alias: clean(taxpayer.tradeName),
    pan_number: taxpayer.pan || panFromGstin(gstin),
    gstin_date: isoDate(taxpayer.registrationDate),
    registration: registrationType(taxpayer),
    address: clean(address.street),
    city,
    zipcode: clean(address.pincode),
    country_code: 'IN',
    country_name: 'India',
  }

  // Only set the state when the GSTIN's state code maps to a real ISO code —
  // the State dropdown renders a bare `value` it cannot find in its options, so
  // a wrong or empty code would show as raw text instead of a state name.
  //
  // `state` here is GSTN's own spelling (`stcd`), which is a display label, not
  // the dropdown's key. The caller resolves the canonical name from state_code
  // against country-state-city — that dependency stays out of this module so
  // the API Worker can import it.
  if (stateIso) {
    fields.state_code = stateIso
    fields.state = clean(address.state)
  }

  // Drop empty keys so merging never overwrites a good value with ''.
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ''))
}

/**
 * The subset of the above that needs no API call at all. Used so the PAN (and
 * the state) still get filled when API Setu is unreachable — requirement being
 * that a failed lookup must never leave the user worse off than not typing the
 * GSTIN at all.
 */
export function offlineVendorFields(gstin) {
  const fields = {}
  const pan = panFromGstin(gstin)
  const stateIso = stateIsoFromGstin(gstin)
  if (pan) fields.pan_number = pan
  if (stateIso) fields.state_code = stateIso
  return fields
}
