import { apiSetuGet } from './client.js'
import { panFromGstin } from '../../../lib/gstin.js'
import { logEvent } from '../../utils/logger.js'

/**
 * GSTN Tax Payer API V1 on API Setu — GET /gstn/v1/taxpayers/{gstin}.
 *
 * Publisher: Goods and Services Tax Network. Subscribe under Consume APIs, then
 * generate the API key once the subscription is APPROVED (a pending
 * subscription authenticates but is not entitled, which surfaces as a 401/403
 * from ./client.js, not as a 404).
 *
 * VERIFIED RESPONSE SHAPE (live call, 2026-09-29, GSTIN 27AAACR5055K1Z7):
 *
 *   {"gstin":"27AAACR5055K1Z7","legalName":"RELIANCE INDUSTRIES LIMITED",
 *    "constitution":"Public Limited Company","registrationDate":"01/07/2017",
 *    "status":"Active","taxPayerType":"Regular","centerJurisdiction":"RANGE-IV",
 *    "stateJurisdiction":"URAN_701","cancellationDate":"",
 *    "natureBusinessActivities":["Factory / Manufacturing","Retail Business",…]}
 *
 * That is the COMPLETE set of top-level keys V1 returns. Two consequences worth
 * knowing before building on this:
 *
 *   NO ADDRESS.   V1 has no `pradr` / principal-place-of-business field at all,
 *                 so street/city/pincode cannot be autofilled from it. Only the
 *                 STATE is recoverable, and from the GSTIN's own first two
 *                 digits rather than from any response field.
 *   NO TRADE NAME. V1 returns only `legalName`.
 *
 * Both are believed to need GSTN Tax Payer API **V2**, a separate subscription
 * on the same publisher. When that is approved, add a `fetchTaxpayerV2` beside
 * `fetchTaxpayer` — the field readers below already accept either spelling, so
 * the address container is the only genuinely new part.
 *
 * API Setu hands back camelCase, NOT the abbreviated shape the public GST
 * portal search uses (`lgnm`, `pradr`, `ctb`, `dty`, `sts`, `rgdt`, `nba`,
 * `stj`, `ctj`). It normalizes GSTN's raw payload before we ever see it. This
 * module originally assumed the abbreviations and silently matched nothing —
 * every lookup came back as a nameless record. The readers below therefore try
 * camelCase first and fall back to the abbreviation, so whichever shape V2 or a
 * future gateway change sends, the mapping still lands.
 *
 * Note the two spellings that do not follow from the abbreviations: it is
 * `taxPayerType` (capital P) and `centerJurisdiction` (American -er).
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
    pick(addr, 'doorNumber', 'buildingNumber', 'bno'),
    pick(addr, 'buildingName', 'bnm'),
    pick(addr, 'street', 'st'),
    pick(addr, 'location', 'locality', 'loc'),
  ]
    .filter(Boolean)
    .filter((part) => !redundant.has(part.toLowerCase()))
    .join(', ')
}

// V1 carries no address, so this returns an all-empty shape for it — the keys
// are still present so consumers never have to null-check, and
// taxpayerToVendorFields drops empty values rather than blanking a field the
// user already typed.
//
// The container is looked for under every plausible spelling because the API
// that DOES return one (V2) has not been seen yet; whichever it uses, this
// finds it instead of quietly yielding nothing the way the first cut did.
function normalizeAddress(body) {
  const container = body.principalAddress || body.pradr || body.principalPlaceOfBusiness || {}
  const addr = container.addr || container.address || container
  const city = pick(addr, 'city')
  const district = pick(addr, 'district', 'dst')

  return {
    street: streetLine(addr, city, district),
    building: pick(addr, 'buildingName', 'bnm'),
    locality: pick(addr, 'location', 'locality', 'loc'),
    city,
    district,
    state: pick(addr, 'stateName', 'state', 'stcd'),
    pincode: pick(addr, 'pincode', 'pncd'),
    country: 'India',
  }
}

/**
 * Whatever GSTN returned → a stable, named shape. Every consumer (the vendor
 * form today; internal vendor/client/SO/PO forms later) reads THIS, so a change
 * in GSTN's field names is absorbed here and nowhere else.
 */
export function normalizeTaxpayer(raw, gstin) {
  const body = raw || {}

  const nature = body.natureBusinessActivities || body.nba

  return {
    gstin: clean(body.gstin) || gstin,
    // PAN is read out of the GSTIN rather than the response: it is positionally
    // guaranteed (chars 3-12) and GSTN does not return it as its own field.
    pan: panFromGstin(gstin),
    legalName: pick(body, 'legalName', 'lgnm'),
    // Absent from V1 entirely. Kept in the shape so consumers need no change
    // once V2 supplies it.
    tradeName: pick(body, 'tradeName', 'tradeNam'),
    constitution: pick(body, 'constitution', 'ctb'),
    taxpayerType: pick(body, 'taxPayerType', 'taxpayerType', 'dty'),
    status: pick(body, 'status', 'sts'),
    registrationDate: pick(body, 'registrationDate', 'rgdt'),
    cancellationDate: pick(body, 'cancellationDate', 'cxdt'),
    natureOfBusiness: Array.isArray(nature) ? nature.map(clean).filter(Boolean) : [],
    stateJurisdiction: pick(body, 'stateJurisdiction', 'stj'),
    centreJurisdiction: pick(body, 'centerJurisdiction', 'centreJurisdiction', 'ctj'),
    address: normalizeAddress(body),
  }
}

/**
 * Fetches and normalizes one taxpayer.
 *
 * @param env    Worker env
 * @param gstin  already validated and uppercased by the caller
 * @throws ApiSetuError
 */
export async function fetchTaxpayer(env, gstin) {
  const raw = await apiSetuGet(env, `/gstn/v1/taxpayers/${encodeURIComponent(gstin)}`, 'gstn.taxpayer')
  const taxpayer = normalizeTaxpayer(raw, gstin)

  // GSTN answers an unknown GSTIN with HTTP 200 and a body carrying no name,
  // rather than the 404 ./client.js maps to 'not_found'. So a nameless record
  // is ambiguous: either the GSTIN really is unknown, or GSTN's field names
  // drifted and `lgnm`/`tradeNam` above no longer match what it sends.
  //
  // Logging the UPSTREAM keys is what separates those two. The caller cannot do
  // this — by the time it has a normalized taxpayer the raw body is gone, so it
  // could only log its own field names back at itself.
  //
  // Registry data, not user data: a GST record is public information from the
  // GST portal, and the sample is truncated and only emitted on the failure path.
  if (!taxpayer.legalName && !taxpayer.tradeName) {
    logEvent('gstn.nameless_record', {
      gstin,
      upstream_keys: raw && typeof raw === 'object' ? Object.keys(raw) : typeof raw,
      sample: JSON.stringify(raw ?? null).slice(0, 400),
    })
  }

  return taxpayer
}
