import { useEffect, useState } from 'react'

/**
 * The city list for a country+state, loaded on demand.
 *
 * `country-state-city` ships its city dataset as an 8 MB JSON file that
 * lib/city.js pulls in with a plain static import, so ANY module that merely
 * names `City` drags all 8 MB into that page's chunk — even one that never
 * calls it. Nobody needs the dataset before a state has been picked, and most
 * visitors never pick one, so it is fetched only at that point.
 *
 * Two details are load-bearing:
 *
 *  - The import points at `lib/city.js`, not the package root. The root
 *    re-exports City alongside Country and State, so importing it here would
 *    put the dataset straight back into the static graph of every caller that
 *    also imports Country or State — which both current callers do.
 *  - The promise is cached module-wide, so the second form (or the second
 *    state the user tries) reuses the parsed dataset instead of re-importing.
 *
 * Returns [] until the dataset lands, which is the same thing the caller
 * rendered before this was async — an empty <select> for a moment.
 */
let cityModule = null

export function citiesOfState(countryCode, stateCode) {
  if (!countryCode || !stateCode) return Promise.resolve([])
  cityModule = cityModule || import('country-state-city/lib/city.js')
  return cityModule.then(m =>
    m.default.getCitiesOfState(countryCode, stateCode)
      .sort((a, b) => a.name.localeCompare(b.name)))
}

export function useCitiesOfState(countryCode, stateCode) {
  const [cities, setCities] = useState([])

  useEffect(() => {
    let cancelled = false
    citiesOfState(countryCode, stateCode)
      .then(list => { if (!cancelled) setCities(list) })
    // A failed chunk fetch must not blank the form: the city field stays an
    // empty list and everything else on the page keeps working.
      .catch(err => { if (!cancelled) { console.error('[cities]', err); setCities([]) } })
    return () => { cancelled = true }
  }, [countryCode, stateCode])

  return cities
}
