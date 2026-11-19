// The PostgREST filter for a search. `mobile` is a numeric column in the database, and
// ilike cannot compare a number, so including it made every search fail. A whole number,
// with or without its country code, still finds its lead.
export function leadSearchFilter(query) {
  const text = query.replace(/[%_]/g, '').replace(/[(),"\\]/g, ' ').trim()
  const parts = text ? ['company_name', 'name', 'email', 'city'].map((column) => `${column}.ilike.%${text}%`) : []
  const digits = query.replace(/[\s()+-]/g, '')
  if (/^\d{4,15}$/.test(digits)) {
    const numbers = new Set([digits, digits.length > 10 ? digits.slice(-10) : digits])
    parts.push(`mobile.in.(${[...numbers].join(',')})`)
  }
  return parts.length ? parts.join(',') : null
}
