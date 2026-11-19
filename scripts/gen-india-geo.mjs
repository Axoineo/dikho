#!/usr/bin/env node
// Generates src/features/public/indiaGeo.js — the state and city lists for
// India, frozen so the public forms can render their address cascade without
// loading country-state-city's 8.4 MB city dataset.
//
// Why only India: the public forms default to country IN, default the dial
// code to +91, and autofill their address from a GSTIN — an Indian tax id.
// India is 4,242 of the package's 148,038 cities, so freezing just this one
// country covers nearly every real submission for ~3% of the payload. Any
// other country still works: the forms fall back to a dynamic import of
// country-state-city the moment a non-IN country is picked.
//
// Usage:
//   node scripts/gen-india-geo.mjs
//
// Re-run after bumping country-state-city, and commit the result.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { City, State } from 'country-state-city'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'features', 'public', 'indiaGeo.js')

// Sorted by name to match how the forms render them, and — more importantly —
// so the ISO codes here stay the same ones src/lib/gstin.js maps GST state
// codes onto. Both sides are derived from this package; regenerating together
// is what keeps them in step.
const states = State.getStatesOfCountry('IN')
  .map(s => ({ iso: s.isoCode, name: s.name }))
  .sort((a, b) => a.name.localeCompare(b.name))

// Only the name is kept. The forms store and submit the city as a string; the
// package's latitude/longitude/countryCode fields are never read, and they are
// most of the dataset's weight.
const citiesByState = {}
let cityCount = 0
for (const s of states) {
  const names = City.getCitiesOfState('IN', s.iso)
    .map(c => c.name)
    .sort((a, b) => a.localeCompare(b))
  citiesByState[s.iso] = names
  cityCount += names.length
}

const stateRows = states
  .map(s => `  { iso: ${JSON.stringify(s.iso)}, name: ${JSON.stringify(s.name)} },`)
  .join('\n')

const cityRows = states
  .map(s => `  ${JSON.stringify(s.iso)}: ${JSON.stringify(citiesByState[s.iso])},`)
  .join('\n')

writeFileSync(OUT, `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/gen-india-geo.mjs
//
// ${states.length} states/UTs and ${cityCount} cities for India, sorted by name.
// Exists so the public forms can run their address cascade for the common case
// without importing country-state-city, whose city dataset is 8.4 MB.

export const IN_STATES = Object.freeze([
${stateRows}
])

export const IN_CITIES_BY_STATE = Object.freeze({
${cityRows}
})
`)

console.log(`Wrote ${states.length} states and ${cityCount} cities to ${OUT}`)
