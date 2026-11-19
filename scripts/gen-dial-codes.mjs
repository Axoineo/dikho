#!/usr/bin/env node
// Generates src/features/public/dialCodes.js — a frozen country list for the
// public forms.
//
// Why: `country-state-city` drags dist/assets/city-*.js (8.4 MB raw / 2.4 MB
// gzip) into any chunk that imports it. The public forms are unauthenticated
// landing pages, so a static import there means every visitor downloads the
// world's cities just to render a "+91" dial picker and a country dropdown.
// Those two controls need four fields per country, and that list changes about
// as often as the political map — so it is generated once and committed.
//
// Usage:
//   node scripts/gen-dial-codes.mjs
//
// Re-run after bumping country-state-city, and commit the result.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Country } from 'country-state-city'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'features', 'public', 'dialCodes.js')

// The package stores some dial codes with an area-code suffix ("+1-684",
// "+358-18"). A phone field wants the country's trunk code, so keep the part
// before the hyphen — this matches the `cleanCode` helper the forms used to
// apply at runtime.
const trunkCode = (raw) => {
  const code = String(raw).startsWith('+') ? String(raw) : `+${raw}`
  return code.includes('-') ? code.split('-')[0] : code
}

// Sorted by name because the forms render them in that order, and because the
// dial picker resolves a shared code (+1 is 20-odd countries) by taking the
// first match — so the sort decides which flag "+1" shows. Sorting here keeps
// that stable instead of leaving it to the caller.
const countries = Country.getAllCountries()
  .map(c => ({ iso: c.isoCode, name: c.name, dial: trunkCode(c.phonecode), flag: c.flag }))
  .sort((a, b) => a.name.localeCompare(b.name))

const rows = countries
  .map(c => `  { iso: ${JSON.stringify(c.iso)}, name: ${JSON.stringify(c.name)}, dial: ${JSON.stringify(c.dial)}, flag: ${JSON.stringify(c.flag)} },`)
  .join('\n')

writeFileSync(OUT, `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/gen-dial-codes.mjs
//
// ${countries.length} countries, sorted by name, with the trunk dial code and
// flag. Exists so the public forms can render a country/dial picker without
// importing country-state-city, whose city dataset is 8.4 MB.

export const DIAL_CODES = Object.freeze([
${rows}
])
`)

console.log(`Wrote ${countries.length} countries to ${OUT}`)
