/**
 * Regenerates src/assets/chat-doodles.svg, the doodle wallpaper behind the
 * WhatsApp inbox thread.
 *
 *   node scripts/gen-chat-doodles.mjs
 *
 * WhatsApp's own wallpaper is Meta's artwork, and this repository is public,
 * so the inbox uses an original tile in the same style instead: line-art
 * doodles in mixed sizes with small dots, dashes and rings between them. The
 * tile is drawn black on transparent and used as a CSS mask, so each theme
 * colours it with its own token (see .chat-canvas in src/index.css).
 *
 * Placement is random but seeded, so a re-run gives the same file. Distances
 * are measured on a torus and anything crossing an edge is drawn again on the
 * opposite side, which is what makes the tile repeat without a visible seam.
 */
import { writeFileSync } from 'node:fs'

const SEED = 7
const TILE = 480
const STROKE = 1.4

// 24-unit line icons, centred on (12, 12).
const ICONS = {
  chat: '<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  sparkle: '<path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z"/>',
  smiley: '<circle cx="12" cy="12" r="8.5"/><path d="M9 10h.01M15 10h.01M8.5 14a4 4 0 0 0 7 0"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.2a2.3 2.3 0 0 1 0 4.6H16"/><path d="M8.5 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3"/>',
  plane: '<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M21 3L10 13"/>',
  camera: '<path d="M4.5 8h2.8l1.6-2.2h6.2L16.7 8h2.8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-8A1.5 1.5 0 0 1 4.5 8z"/><circle cx="12" cy="13.2" r="3.4"/>',
  music: '<path d="M9 17.5V6.5l10-2.2v11"/><circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="15.3" r="2"/>',
  envelope: '<rect x="3" y="6" width="18" height="12" rx="1.6"/><path d="M3.6 7.2L12 13l8.4-5.8"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 18h2"/>',
  bulb: '<path d="M9.2 17h5.6M10.2 20h3.6"/><path d="M12 3.2a5.8 5.8 0 0 0-3.4 10.5c.6.5.9 1.2.9 2V16h5v-.3c0-.8.3-1.5.9-2A5.8 5.8 0 0 0 12 3.2z"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6-1.6A4.6 4.6 0 0 1 17.4 18z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  gift: '<rect x="4.5" y="10" width="15" height="10" rx="1"/><rect x="3.5" y="7" width="17" height="3" rx=".8"/><path d="M12 7v13"/><path d="M12 7C10.6 4 7.2 4.1 7.8 6.2 8.2 7.2 12 7 12 7zM12 7c1.4-3 4.8-2.9 4.2-.8C15.8 7.2 12 7 12 7z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l8 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M7.5 15l1 4h2.3l-1-3.4"/><path d="M18 9.4a3.2 3.2 0 0 1 0 5.2"/>',
  balloon: '<path d="M12 15.2c3.2 0 5.6-3 5.6-6.2a5.6 5.6 0 0 0-11.2 0c0 3.2 2.4 6.2 5.6 6.2z"/><path d="M11 16.7h2l-1-1.5z"/><path d="M12 16.8c-1.2 1.4 1.1 2.7 0 4.2"/>',
  icecream: '<path d="M7.6 10.6h8.8L12 21z"/><path d="M7 10.6a5 5 0 0 1 10 0"/><path d="M9.6 13.4l3.8-1.3M10.6 16.3l2.6-1"/>',
  leaf: '<path d="M5 19C5 11 10 6 19 5c-1 9-6 14-14 14z"/><path d="M5 19l8.5-8.5"/>',
  moon: '<path d="M19.5 14.8A8 8 0 0 1 9.2 4.5a8 8 0 1 0 10.3 10.3z"/>',
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.4a2 2 0 0 1-4 0"/>',
  bell: '<path d="M6.2 16v-4.8a5.8 5.8 0 0 1 11.6 0V16l1.5 2H4.7z"/><path d="M10.2 20.4a1.9 1.9 0 0 0 3.6 0"/>',
  pencil: '<path d="M15.5 4.5l4 4L9 19l-5 1 1-5z"/><path d="M13.3 6.7l4 4"/>',
  clip: '<path d="M16.5 7.5l-7 7a2 2 0 0 0 2.8 2.8l7.4-7.4a4 4 0 0 0-5.7-5.7l-7.4 7.4a6 6 0 0 0 8.5 8.5l5.4-5.4"/>',
  gem: '<path d="M7 4.5h10l4 4.8L12 20 3 9.3z"/><path d="M3 9.3h18M9.6 4.5L8 9.3l4 10.7 4-10.7-1.6-4.8"/>',
  tag: '<path d="M3.5 12V4.5a1 1 0 0 1 1-1H12l8.5 8.5-8.5 8.5z"/><circle cx="8" cy="8" r="1.5"/>',
  rocket: '<path d="M12 3c3 2 4.4 5.6 3.9 9.6L14 15h-4l-1.9-2.4C7.6 8.6 9 5 12 3z"/><circle cx="12" cy="9.3" r="1.5"/><path d="M8.3 12.4L5.8 15l.4 2.8 3-1.6M15.7 12.4l2.5 2.6-.4 2.8-3-1.6"/><path d="M11 17.5c.3 1.4.6 2.4 1 3.4.4-1 .7-2 1-3.4"/>',
  billboard: '<rect x="3" y="4.5" width="18" height="10" rx="1"/><path d="M8 14.5V21M16 14.5V21M6 21h4M14 21h4"/><path d="M6.5 8h7M6.5 11h4.5"/>',
  headphones: '<path d="M4.5 15.5V12a7.5 7.5 0 0 1 15 0v3.5"/><path d="M4.5 15a2 2 0 0 1 2-2h1v6h-1a2 2 0 0 1-2-2zM19.5 15a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z"/>',
  bag: '<path d="M6 8.5h12l-1 11.5H7z"/><path d="M9.2 8.5V7.2a2.8 2.8 0 0 1 5.6 0v1.3"/>',
  watermelon: '<path d="M3 9a9 9 0 0 0 18 0z"/><path d="M5.6 9a6.4 6.4 0 0 0 12.8 0"/><path d="M10 12.4h.01M14 12.4h.01M12 14.6h.01"/>',
  popsicle: '<path d="M8 14V7.3a4 4 0 0 1 8 0V14a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z"/><path d="M11 15h2v4.6a1 1 0 0 1-2 0z"/><path d="M10.3 9.5l3.4-1.3"/>',
  hash: '<path d="M9.5 4L7.5 20M16.5 4l-2 16M4.5 9.2h15.5M4 14.8h15.5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10.2h16M9 3.5v4M15 3.5v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>',
  chart: '<path d="M4 4.5V19.5h16"/><path d="M7.5 15l3.8-4 3 2.8 4.7-5.6"/><path d="M15.8 8.2H19v3.1"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2.5 2.5M14 9l1.8 1.8"/>',
  cupcake: '<path d="M6.5 12.5h11L16 20H8z"/><path d="M6 12.5a2.5 2.5 0 0 1 1.2-4.7 4.8 4.8 0 0 1 9.6 0 2.5 2.5 0 0 1 1.2 4.7"/><path d="M10 12.5l.6 7.5M14 12.5l-.6 7.5"/>',
}
const BIG = ['billboard', 'megaphone', 'rocket', 'camera', 'coffee', 'gift', 'umbrella', 'cupcake', 'watermelon', 'popsicle', 'headphones', 'balloon', 'cloud', 'chat', 'icecream', 'bag', 'envelope', 'calendar']
const SMALL = ['star', 'sparkle', 'heart', 'music', 'leaf', 'moon', 'key', 'tag', 'clip', 'hash', 'pin', 'bulb', 'smiley', 'sun', 'clock', 'bell', 'pencil', 'gem', 'plane', 'phone', 'chart']
const FILLERS = {
  ring: '<circle cx="0" cy="0" r="3.2"/>',
  dot: '<circle cx="0" cy="0" r="1.3"/>',
  dash: '<path d="M-5 0h10"/>',
  dashes: '<path d="M-9 0h5M2 0h5"/>',
  plus: '<path d="M0-3.5v7M-3.5 0h7"/>',
  pill: '<rect x="-7" y="-2.6" width="14" height="5.2" rx="2.6"/>',
}

let seed = SEED
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)

const placed = []
function torusDistance(a, b) {
  let dx = Math.abs(a.x - b.x)
  let dy = Math.abs(a.y - b.y)
  dx = Math.min(dx, TILE - dx)
  dy = Math.min(dy, TILE - dy)
  return Math.hypot(dx, dy)
}

// Scatters up to `count` items of radius `r`, each at least `gap` clear of
// everything already placed. Larger sizes go first so the small ones fill in.
function scatter(count, r, gap, describe) {
  for (let attempt = 0, made = 0; attempt < count * 400 && made < count; attempt++) {
    const item = { x: rand() * TILE, y: rand() * TILE, r }
    if (placed.every((other) => torusDistance(item, other) >= item.r + other.r + gap)) {
      placed.push(Object.assign(item, describe()))
      made++
    }
  }
}

const big = [...BIG].sort(() => rand() - 0.5)
const small = [...SMALL].sort(() => rand() - 0.5)
let nextBig = 0
let nextSmall = 0
const fillerNames = Object.keys(FILLERS)

scatter(13, 31, 7, () => ({ icon: big[nextBig++ % big.length], scale: 2.45 + rand() * 0.4, rotate: (rand() - 0.5) * 50 }))
scatter(22, 21, 6, () => ({
  icon: rand() < 0.5 ? big[nextBig++ % big.length] : small[nextSmall++ % small.length],
  scale: 1.7 + rand() * 0.3,
  rotate: (rand() - 0.5) * 60,
}))
scatter(16, 13, 5, () => ({ icon: small[nextSmall++ % small.length], scale: 1.12 + rand() * 0.2, rotate: (rand() - 0.5) * 70 }))
scatter(110, 5, 4, () => ({ filler: fillerNames[Math.floor(rand() * fillerNames.length)], rotate: rand() * 180 }))

function draw(item, x, y) {
  const at = `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${Math.round(item.rotate)})`
  return item.filler
    ? `<g transform="${at}">${FILLERS[item.filler]}</g>`
    : `<g transform="${at} scale(${item.scale.toFixed(2)}) translate(-12 -12)">${ICONS[item.icon]}</g>`
}

const shapes = []
for (const item of placed) {
  const reach = item.r + 4
  const xs = [item.x]
  const ys = [item.y]
  if (item.x - reach < 0) xs.push(item.x + TILE)
  if (item.x + reach > TILE) xs.push(item.x - TILE)
  if (item.y - reach < 0) ys.push(item.y + TILE)
  if (item.y + reach > TILE) ys.push(item.y - TILE)
  for (const x of xs) for (const y of ys) shapes.push(draw(item, x, y))
}

// non-scaling-stroke keeps every line the same weight whatever the icon's size.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}" fill="none" stroke="#000" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">`
  + '<!-- GENERATED by scripts/gen-chat-doodles.mjs. Original artwork for Dikho; edit the script, not this file. -->'
  + `<style>*{vector-effect:non-scaling-stroke}</style>${shapes.join('')}</svg>\n`

writeFileSync('src/assets/chat-doodles.svg', svg)
console.log(`src/assets/chat-doodles.svg: ${placed.length} shapes, ${svg.length} bytes`)
