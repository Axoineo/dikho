import { apiSetuGet } from './client.js'
import { panFromGstin } from '../../../lib/gstin.js'
import { logEvent } from '../../utils/logger.js'

/**
 * GSTN Tax Payer API on API Setu — V1 and V2, normalized to one shape.
 *
 * Publisher: Goods and Services Tax Network. Each version is its OWN
 * subscription: being entitled to V1 says nothing about V2, and an unentitled
 * API answers 401/403 via ./client.js rather than 404.
 *
 * **V2 is the default and the one to use.** It is a strict superset: trade name
 * and the principal place of business exist only there. V1 remains wired up
 * solely as an escape hatch (GSTN_API_VERSION=v1) for if the V2 subscription
 * lapses, because a 403 would otherwise take autofill down completely.
 *
 * ── V2 vs V1: NOT ONE FIELD NAME IS SHARED ──────────────────────────────────
 *
 *   V1 (verified live)        V2 (per contract)
 *   gstin                     gstIdentificationNumber
 *   legalName                 legalNameOfBusiness
 *   —                         tradeName
 *   constitution              constitutionOfBusiness
 *   taxPayerType  (capital P) taxpayerType  (lower p)
 *   status                    gstnStatus
 *   registrationDate          dateOfRegistration
 *   cancellationDate          dateOfCancellation
 *   natureBusinessActivities  natureOfBusinessActivity
 *   —                         lastUpdatedDate
 *   —                         principalPlaceOfBusinessFields
 *                               .principalPlaceOfBusinessAddress
 *                                 .{buildingNumber,buildingName,streetName,
 *                                   location,locality,city,districtName,
 *                                   stateName,pincode,floorNumber}
 *   —                         additionalPlaceOfBusinessFields[]  (not read)
 *
 * That total divergence is why there are two normalizers instead of one reader
 * with more fallbacks: a merged `pick` chain would happily find a V1 name in a
 * V2 body, produce a half-filled record, and look like it worked.
 *
 * ── Things both contracts get wrong ─────────────────────────────────────────
 *
 * An unknown GSTIN is documented as `404 record_not_found`. In practice V1
 * answers **HTTP 200 with every key present and every value null** (verified
 * 2026-09-29 with 07AAAAA0000A1Z5). Hence the nameless-record guard below and
 * the route's own 404 — without them a null body would autofill blanks.
 *
 * V2's `required` list names `taxPayerType`, which its properties block never
 * defines, and gives `stateJurisdictionCode` `minLength: 15` against a 5-char
 * example (`UP333`). Trust the properties block, not the required list.
 *
 * API Setu returns camelCase, NOT the abbreviated shape the public GST portal
 * search uses (`lgnm`, `pradr`, `ctb`, `dty`, `sts`, `rgdt`, `nba`, `stj`,
 * `ctj`) — it normalizes GSTN's raw payload before we see it. The first cut of
 * this module assumed the abbreviations, matched nothing, and reported every
 * lookup as a nameless record. The abbreviations are kept as trailing fallbacks
 * in the V1 reader only, and cost nothing.
 */

function clean(value) {
  return String(value ?? '').trim()
}

// Reads one logical field under either spelling: API Setu's camelCase (what it
// actually sends) or the GST-portal abbreviation. Cheap insurance against the
// gateway shape, which is not contractual and has already surprised us once.
function pick(body, ...names) {
  for (const name of names) {
    const value = clean(body[name])
    if (value) return value
  }
  return ''
}

// The form's Street Address field is captioned "Do not include State, City or
// Zipcode here", so the street line is built from the building-level parts
// only. `loc` is included but dropped when it merely repeats the city or
// district, which GSTN records do often enough to look like a bug.
function streetLine(addr, city, district) {
  const redundant = new Set([city, district]
    .map((v) => clean(v).toLowerCase())
    .filter(Boolean))

  return [
    pick(addr, 'floorNumber', 'flno'),
    pick(addr, 'buildingNumber', 'doorNumber', 'bno'),
    pick(addr, 'buildingName', 'bnm'),
    pick(addr, 'streetName', 'street', 'st'),
    pick(addr, 'location', 'locality', 'loc'),
  ]
    .filter(Boolean)
    .filter((part) => !redundant.has(part.toLowerCase()))
    .join(', ')
}

// One shape for both versions, so consumers never branch on which API answered
// and never have to null-check. taxpayerToVendorFields drops empty values, so an
// all-empty address blanks nothing the user already typed.
function emptyAddress() {
  return {
    street: '', building: '', locality: '', city: '',
    district: '', state: '', pincode: '', country: 'India',
  }
}

// V2's principal place of business. Field names here are V2's own and share
// nothing with V1 — see the header note. `lattitude` really is spelled with two
// t's in the contract; it is not read, but do not "fix" it if it ever is.
function normalizeAddressV2(body) {
  const container = body.principalPlaceOfBusinessFields || {}
  const addr = container.principalPlaceOfBusinessAddress || {}

  const city = pick(addr, 'city')
  const district = pick(addr, 'districtName')

  return {
    street: streetLine(addr, city, district),
    building: pick(addr, 'buildingName'),
    locality: pick(addr, 'locality', 'location'),
    city,
    district,
    state: pick(addr, 'stateName'),
    pincode: pick(addr, 'pincode'),
    country: 'India',
  }
}

/**
 * V1 response → the shared shape. V1 has no address and no trade name, so both
 * come back empty; see the header note.
 */
export function normalizeTaxpayerV1(raw, gstin) {
  const body = raw || {}
  const nature = body.natureBusinessActivities || body.nba

  return {
    gstin: clean(body.gstin) || gstin,
    // PAN is read out of the GSTIN rather than the response: it is positionally
    // guaranteed (chars 3-12) and neither version returns it as its own field.
    pan: panFromGstin(gstin),
    legalName: pick(body, 'legalName', 'lgnm'),
    tradeName: '',
    constitution: pick(body, 'constitution', 'ctb'),
    taxpayerType: pick(body, 'taxPayerType', 'taxpayerType', 'dty'),
    status: pick(body, 'status', 'sts'),
    registrationDate: pick(body, 'registrationDate', 'rgdt'),
    cancellationDate: pick(body, 'cancellationDate', 'cxdt'),
    lastUpdatedDate: '',
    natureOfBusiness: Array.isArray(nature) ? nature.map(clean).filter(Boolean) : [],
    stateJurisdiction: pick(body, 'stateJurisdiction', 'stj'),
    centreJurisdiction: pick(body, 'centerJurisdiction', 'centreJurisdiction', 'ctj'),
    address: emptyAddress(),
    apiVersion: 'v1',
  }
}

/**
 * V2 response → the same shape. Note that V2 shares NOT ONE field name with V1
 * (see the header note), which is why this is a separate function rather than
 * more fallbacks bolted onto the V1 reader: a single `pick` chain covering both
 * would silently read a V1 name out of a V2 body and look like it worked.
 */
export function normalizeTaxpayerV2(raw, gstin) {
  const body = raw || {}
  const nature = body.natureOfBusinessActivity

  return {
    gstin: pick(body, 'gstIdentificationNumber') || gstin,
    pan: panFromGstin(gstin),
    legalName: pick(body, 'legalNameOfBusiness'),
    tradeName: pick(body, 'tradeName'),
    constitution: pick(body, 'constitutionOfBusiness'),
    // Lower-case 'p' here, against V1's capital 'P'. The V2 contract's own
    // `required` list asks for BOTH spellings and only defines this one, so
    // trusting that list over the properties block would read undefined.
    taxpayerType: pick(body, 'taxpayerType'),
    status: pick(body, 'gstnStatus'),
    registrationDate: pick(body, 'dateOfRegistration'),
    cancellationDate: pick(body, 'dateOfCancellation'),
    // V2 only: when GSTN last touched the record. Useful for telling a stale
    // autofill from a wrong one.
    lastUpdatedDate: pick(body, 'lastUpdatedDate'),
    natureOfBusiness: Array.isArray(nature) ? nature.map(clean).filter(Boolean) : [],
    stateJurisdiction: pick(body, 'stateJurisdiction'),
    centreJurisdiction: pick(body, 'centerJurisdiction'),
    address: normalizeAddressV2(body),
    apiVersion: 'v2',
  }
}

// Default v2: it is a strict superset — trade name and the principal place of
// business are only there. v1 stays reachable through GSTN_API_VERSION purely as
// an escape hatch if the v2 subscription ever lapses, since a 403 from an
// unentitled API would otherwise take autofill down entirely.
const VERSIONS = {
  v1: { path: 'v1', normalize: normalizeTaxpayerV1 },
  v2: { path: 'v2', normalize: normalizeTaxpayerV2 },
}

/**
 * Fetches and normalizes one taxpayer, from whichever API version is
 * configured. Callers get an identical shape either way and must not care
 * which answered — `apiVersion` on the result is for logging, not branching.
 *
 * @param env    Worker env (reads GSTN_API_VERSION, default 'v2')
 * @param gstin  already validated and uppercased by the caller
 * @throws ApiSetuError
 */
export async function fetchTaxpayer(env, gstin) {
  const requested = clean(env.GSTN_API_VERSION).toLowerCase() || 'v2'
  const version = VERSIONS[requested] || VERSIONS.v2
  if (!VERSIONS[requested]) {
    logEvent('gstn.unknown_version', { requested, using: 'v2' })
  }

  const raw = await apiSetuGet(
    env,
    `/gstn/${version.path}/taxpayers/${encodeURIComponent(gstin)}`,
    `gstn.taxpayer.${version.path}`,
  )
  const taxpayer = version.normalize(raw, gstin)

  // GSTN answers an unknown GSTIN with HTTP 200 and a body carrying no name,
  // rather than the 404 its own contract documents and ./client.js maps to
  // 'not_found'. So a nameless record is ambiguous: either the GSTIN really is
  // unknown, or GSTN's field names drifted and the readers above no longer
  // match what it sends.
  //
  // Logging the UPSTREAM keys is what separates those two. The caller cannot do
  // this — by the time it has a normalized taxpayer the raw body is gone, so it
  // could only log its own field names back at itself.
  //
  // Registry data, not user data: a GST record is public information from the
  // GST portal, and the sample is truncated and only emitted on the failure path.
  if (!taxpayer.legalName && !taxpayer.tradeName) {
    logEvent('gstn.nameless_record', {
      version: version.path,
      gstin,
      upstream_keys: raw && typeof raw === 'object' ? Object.keys(raw) : typeof raw,
      sample: JSON.stringify(raw ?? null).slice(0, 400),
    })
  }

  return taxpayer
}
