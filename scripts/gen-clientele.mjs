/**
 * Regenerates src/features/public/clientele.js from the processed logos in
 * public/clientele/.
 *
 *   node scripts/gen-clientele.mjs
 *
 * Its real job is the `scale` column. Sizing every logo to one fixed height
 * looks even on paper and wrong on screen: a square mark like SBI's ends up
 * carrying a fraction of the visual weight of a long wordmark like NTT Data's
 * at the same height. So each logo is measured for how much ink it actually
 * has — mean alpha × area, which the white-on-transparent artwork makes easy —
 * and given a height that evens out the rendered ink, damped half-way back
 * toward the flat height and clamped so nothing runs away.
 *
 * Requires ImageMagick on PATH. Run it after adding or replacing any logo.
 *
 * NOTE: the original artwork folder is no longer in the repo, so mono-logo.sh
 * cannot regenerate the existing set — it is for logos you supply from here
 * on. A few of the current files were also touched up afterwards (Gemini had
 * a detached sparkle cropped off; Gallantt and AGL had their alpha floor
 * raised to clear a faint plate), so re-running the script over a recovered
 * original would not reproduce them exactly.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

// Recognisability first — whatever is on screen when the wall starts moving
// should be a name the visitor already knows.
const ORDER = [
  ['honda', 'Honda'], ['gemini', 'Gemini'], ['kfc', 'KFC'], ['pizza-hut', 'Pizza Hut'],
  ['sbi', 'State Bank of India'], ['castrol', 'Castrol'], ['tvs', 'TVS'], ['ntt-data', 'NTT Data'],
  ['zf', 'ZF'], ['sun-pharma', 'Sun Pharma'], ['saint-gobain', 'Saint-Gobain'],
  ['bank-of-maharashtra', 'Bank of Maharashtra'], ['united-breweries', 'United Breweries'],
  ['amneal', 'Amneal Pharmaceuticals'], ['finolex-cables', 'Finolex Cables'],
  ['iifl-finance', 'IIFL Finance'], ['arvind', 'Arvind'], ['vlcc', 'VLCC'], ['supreme', 'Supreme'],
  ['amns-india', 'AM/NS India'], ['tmb', 'Tamilnad Mercantile Bank'],
  ['fedbank', 'Fedbank Financial Services'], ['titan-eyeplus', 'Titan Eyeplus'],
  ['edufund', 'EduFund'], ['exxaro-tiles', 'Exxaro Tiles'], ['agl-tiles', 'AGL Tiles'],
  ['gallantt', 'Gallantt'], ['saatvik', 'Saatvik'], ['kaizen-hospital', 'Kaizen Hospital'],
  ['davat', 'Davat Beverages'], ['mangalam-organics', 'Mangalam Organics'],
  ['aerolam', 'Aerolam Insulations'], ['ratnaakar', 'Ratnaakar'], ['sankalp', 'Sankalp'],
  ['anand-niketan', 'Anand Niketan Group of Schools'], ['rus-education', 'RUS Education'],
  ['shreehari', 'Shreehari'], ['city-square-mart', 'City Square Mart'],
  ['knownsense-studios', 'KnownSense Studios'], ['baba', 'Baba'], ['7oak-developers', '7 Oak Developers'],
]

const BASE = 38     // the flat height every scale is expressed against
const LO = 26       // floor: below this a wordmark stops being readable
const HI = 52       // ceiling: above this a square mark starts shouting

const im = (...args) => execFileSync('magick', args).toString().trim()

const measured = ORDER.map(([slug, name]) => {
  const file = `public/clientele/${slug}.webp`
  const [w, h] = im('identify', '-format', '%w %h', file).split(' ').map(Number)
  const meanAlpha = Number(im(file, '-alpha', 'extract', '-format', '%[fx:mean]', 'info:'))
  // Files in public/ are served at a fixed path with a long cache lifetime, so
  // re-rendering a logo in place leaves every returning visitor — and the
  // Pages CDN — on the old artwork. Recolouring the whole wall once already
  // made all 42 invisible for anyone who had the previous set cached. The
  // content hash means a changed logo is simply a different URL.
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8)
  return { slug, name, w, h, hash, ink: meanAlpha * w * h }
})

// Aim at the median of what the set already renders at the flat height, so
// the wall keeps its current overall weight and only the outliers move.
const target = measured
  .map(m => m.ink * (BASE / m.h) ** 2)
  .sort((a, b) => a - b)[Math.floor(measured.length / 2)]

const sized = measured.map(m => {
  const areaFit = m.h * Math.sqrt(target / m.ink)
  const damped = Math.sqrt(BASE * areaFit)
  const scale = Math.round((Math.min(HI, Math.max(LO, damped)) / BASE) * 100) / 100
  return { ...m, scale }
})

const rows = sized.map(({ slug, name, w, h, hash, scale }) =>
  `  logo('${slug}', '${hash}', ${JSON.stringify(name)}, ${w}, ${h}${scale === 1 ? '' : `, ${scale}`}),`)

writeFileSync('src/features/public/clientele.js', `/**
 * Client logos for the "Happy Clients" wall on the Corporate Gifting page.
 * GENERATED — edit scripts/gen-clientele.mjs and re-run it, not this file.
 *
 * The files in public/clientele/ are not the originals. Each is a flat DARK
 * SLATE SILHOUETTE ON TRANSPARENT produced by scripts/mono-logo.sh, which
 * flattens the artwork and uses its own greyscale as an alpha channel. That is
 * what lets a mixed bag of flat JPEGs, transparent PNGs and logos carrying
 * their own coloured plate all read as one set, with nothing behind any of
 * them. The ink is dark because the wall sits on the page's light background;
 * re-run the script with \`--ink white\` if it ever moves onto a dark one.
 *
 * \`scale\` multiplies the row's base height. It is measured, not eyeballed:
 * a square mark and a long wordmark set to the same HEIGHT do not carry the
 * same visual weight, so each logo is sized to even out its rendered ink.
 * Roughly 0.7× for the longest wordmarks, 1.3× for the most compact marks.
 *
 * The \`?v=\` on each src is a content hash. public/ is served at stable paths
 * with a long cache lifetime, so without it a re-rendered logo keeps its old
 * URL and returning visitors keep the old artwork. Re-run the generator after
 * touching any file in public/clientele/.
 *
 * To add a client:
 *   scripts/mono-logo.sh <source-image> <slug>
 *   node scripts/gen-clientele.mjs      (after adding the slug to ORDER)
 */

const logo = (file, hash, name, w, h, scale = 1) =>
  ({ src: \`/clientele/\${file}.webp?v=\${hash}\`, name, w, h, scale })

export const CLIENT_LOGOS = [
${rows.join('\n')}
]
`)

const px = sized.map(s => Math.round(BASE * s.scale))
console.log(`${rows.length} logos; display heights ${Math.min(...px)}–${Math.max(...px)}px at the ${BASE}px base`)
