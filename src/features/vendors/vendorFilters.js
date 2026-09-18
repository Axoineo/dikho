export const EMPTY_VENDOR_FILTERS = { media_id: '', sub_media_id: '', country: '', state: '', city: '', status: '' }

// Checkbox, ID, Vendor, Media, Location, Contact, GSTIN, Status, Actions —
// keep in step with the <thead> and the .vendors-page column widths.
export const VENDOR_COLUMN_COUNT = 9

// The vendor list shows exactly one page size and never offers another.
export const VENDORS_PAGE_SIZE = 15

// Country, state and city live on vendor_addresses, so every vendor query
// embeds the address rows. When one of those filters is active the embed
// becomes an inner join so non-matching vendors drop out of the result and
// the count.
export const VENDOR_ADDRESS_COLUMNS = 'address,country,state,city,zipcode,is_default'

export function needsAddressJoin(filters) {
  return Boolean(filters.country || filters.state || filters.city)
}

export function vendorSelect(columns, filters) {
  const join = needsAddressJoin(filters) ? '!inner' : ''
  return `${columns},vendor_addresses${join}(${VENDOR_ADDRESS_COLUMNS})`
}

export function applyVendorFilters(request, query, filters) {
  if (query) {
    const safeQuery = query.replace(/[%_]/g, '').replace(/[(),]/g, ' ').trim()
    if (safeQuery) {
      request = request.or(`company_name.ilike.%${safeQuery}%,alias.ilike.%${safeQuery}%,contact_person.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%,gstin.ilike.%${safeQuery}%,pan_number.ilike.%${safeQuery}%`)
    }
  }
  if (filters.media_id) request = request.eq('media_id', Number(filters.media_id))
  if (filters.sub_media_id) request = request.eq('sub_media_id', Number(filters.sub_media_id))
  if (filters.status !== '') request = request.eq('status', Number(filters.status))
  if (filters.country) request = request.eq('vendor_addresses.country', filters.country)
  if (filters.state) request = request.eq('vendor_addresses.state', filters.state)
  if (filters.city) request = request.eq('vendor_addresses.city', filters.city)
  return request
}

export function primaryAddress(vendor) {
  const addresses = Array.isArray(vendor?.vendor_addresses) ? vendor.vendor_addresses : []
  return addresses.find((item) => item.is_default) || addresses[0] || null
}

/* ============================================================
   SLASH-COMMAND SEARCH
   ------------------------------------------------------------
   Typing "/" turns the search bar into a chained filter. Segments map
   positionally onto state → country → media → sub media, so
   "/gujarat/india/hoarding/banner" is the same query as picking those four
   values from the dropdowns. Segments may be partial ("/guj"), the chain may
   stop early ("/gujarat/india"), and every step only offers values that can
   still co-exist with the steps before it.
   ============================================================ */

export const SLASH_CHAIN = [
  { key: 'state', field: 'state', dimension: 'State' },
  { key: 'country', field: 'country', dimension: 'Country' },
  { key: 'media', field: 'media_id', dimension: 'Media' },
  { key: 'sub_media', field: 'sub_media_id', dimension: 'Sub Media' },
]

export const SLASH_PATH_HINT = `/${SLASH_CHAIN.map((step) => step.dimension.toLowerCase().replace(' ', '')).join('/')}`

// Fold case, spacing and punctuation so "New Delhi", "new-delhi" and
// "newdelhi" all resolve to the same option.
export function normalizeToken(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function isSlashSearch(input) {
  return typeof input === 'string' && input.trimStart().startsWith('/')
}

export function uniqueOptions(values) {
  return [...new Set(values.filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }))
}

// The candidates for one link in the chain, narrowed by the links already
// resolved ahead of it.
export function slashOptions(key, catalog, resolved) {
  if (key === 'state') return uniqueOptions(catalog.facets.map((row) => row.state))
  if (key === 'country') {
    return uniqueOptions(catalog.facets
      .filter((row) => !resolved.state || row.state === resolved.state)
      .map((row) => row.country))
  }
  if (key === 'media') return catalog.media.map((item) => ({ value: item.id, label: item.name }))
  return catalog.subMedia
    .filter((item) => !resolved.media_id || String(item.media_id) === String(resolved.media_id))
    .map((item) => ({ value: item.id, label: item.name }))
}

// Exact match wins, then prefix, then substring — so "/guj" lands on Gujarat
// but "/gujarat" is never dragged onto some unrelated longer name.
export function matchSlashOption(raw, options) {
  const needle = normalizeToken(raw)
  if (!needle) return null
  return options.find((option) => normalizeToken(option.label) === needle)
    || options.find((option) => normalizeToken(option.label).startsWith(needle))
    || options.find((option) => normalizeToken(option.label).includes(needle))
    || null
}

// Returns null for ordinary free-text searches. Otherwise: the filters the
// chain resolves to, one token per segment (for the chips and the suggestion
// list) and the first segment that matched nothing.
export function resolveSlashSearch(input, catalog) {
  if (!isSlashSearch(input)) return null

  const written = input.trimStart().slice(1).split('/').map((part) => part.trim())
  const segments = written.slice(0, SLASH_CHAIN.length)
  const resolved = {}
  const tokens = []
  let unmatched = null

  segments.forEach((raw, index) => {
    const step = SLASH_CHAIN[index]
    // Computed before `resolved` is extended, so a step never narrows itself.
    const options = slashOptions(step.key, catalog, resolved)
    const match = raw ? matchSlashOption(raw, options) : null

    if (match) resolved[step.field] = String(match.value)
    else if (raw && !unmatched) unmatched = { ...step, raw }

    tokens.push({
      ...step,
      raw,
      options,
      match: match && { value: match.value, label: match.label },
      status: !raw ? 'pending' : match ? 'matched' : 'unmatched',
    })
  })

  return {
    filters: resolved,
    tokens,
    unmatched,
    overflow: written.length > SLASH_CHAIN.length,
    activeIndex: tokens.length - 1,
  }
}

// Rebuilds the raw input after a suggestion is picked, normalising every
// already-resolved segment to its canonical label.
export function buildSlashInput(slash, index, label) {
  const parts = slash.tokens.map((token, position) => (
    position === index ? label : (token.match?.label || token.raw)
  ))
  return `/${parts.join('/')}${index < SLASH_CHAIN.length - 1 ? '/' : ''}`
}

export const FETCH_CHUNK = 1000
export const MAX_FETCH_ROWS = 50000

// PostgREST caps rows per response, so anything that needs the *whole* result
// set (select-all, export) pages until a request comes back empty rather than
// trusting a single request to return everything.
export async function fetchAllPaged(buildRequest) {
  const rows = []
  for (;;) {
    const { data, error } = await buildRequest(rows.length, rows.length + FETCH_CHUNK - 1)
    if (error) throw error
    if (!data || data.length === 0) return rows
    rows.push(...data)
    if (rows.length >= MAX_FETCH_ROWS) {
      throw new Error(`This matches over ${MAX_FETCH_ROWS.toLocaleString()} vendors. Narrow the filters and try again.`)
    }
  }
}
