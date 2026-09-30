/**
 * Regenerates src/features/public/dialCodes.js from `country-state-city`.
 *
 *   node scripts/gen-dial-codes.mjs
 *
 * Why this exists: importing `country-state-city` at runtime statically pulls
 * its 8.4 MB city dataset into whatever chunk does the import. The public
 * landing pages only need a "+91" picker, so the country list is frozen into
 * a plain module at build time instead. Re-run this if the upstream data
 * changes; nothing else depends on it.
 */
import { Country } from 'country-state-city'
import { writeFileSync } from 'node:fs'

const clean = (raw) => {
  const c = String(raw || '').startsWith('+') ? String(raw) : `+${raw}`
  return c.split('-')[0]
}

const rows = Country.getAllCountries()
  .map(c => ({ iso: c.isoCode, name: c.name, dial: clean(c.phonecode), flag: c.flag }))
  .filter(c => c.dial && c.dial !== '+')
  .sort((a, b) => a.name.localeCompare(b.name))

const body = rows.map(c =>
  `  { iso: ${JSON.stringify(c.iso)}, name: ${JSON.stringify(c.name)}, dial: ${JSON.stringify(c.dial)}, flag: ${JSON.stringify(c.flag)} },`
).join('\n')

writeFileSync('src/features/public/dialCodes.js', `/**
 * Country dial codes for the public lead-capture pages. GENERATED FILE —
 * edit scripts/gen-dial-codes.mjs and re-run it instead of editing by hand.
 *
 * Frozen from \`country-state-city\` rather than imported from it: that
 * package's entry point statically drags in an 8.4 MB city dataset, and a
 * public landing page cannot ship a city database to a mobile visitor just to
 * render a "+91" picker. Same data, ~10 KB of source.
 */
export const DIAL_CODES = [
${body}
]
`)
console.log('countries:', rows.length)
