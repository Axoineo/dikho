/**
 * Client logos for the "Happy Clients" wall on the Corporate Gifting page.
 * GENERATED — edit scripts/gen-clientele.mjs and re-run it, not this file.
 *
 * The files in public/clientele/ are not the originals. Each is a flat DARK
 * SLATE SILHOUETTE ON TRANSPARENT produced by scripts/mono-logo.sh, which
 * flattens the artwork and uses its own greyscale as an alpha channel. That is
 * what lets a mixed bag of flat JPEGs, transparent PNGs and logos carrying
 * their own coloured plate all read as one set, with nothing behind any of
 * them. The ink is dark because the wall sits on the page's light background;
 * re-run the script with `--ink white` if it ever moves onto a dark one.
 *
 * `scale` multiplies the row's base height. It is measured, not eyeballed:
 * a square mark and a long wordmark set to the same HEIGHT do not carry the
 * same visual weight, so each logo is sized to even out its rendered ink.
 * Roughly 0.7× for the longest wordmarks, 1.3× for the most compact marks.
 *
 * The `?v=` on each src is a content hash. public/ is served at stable paths
 * with a long cache lifetime, so without it a re-rendered logo keeps its old
 * URL and returning visitors keep the old artwork. Re-run the generator after
 * touching any file in public/clientele/.
 *
 * To add a client:
 *   scripts/mono-logo.sh <source-image> <slug>
 *   node scripts/gen-clientele.mjs      (after adding the slug to ORDER)
 */

const logo = (file, hash, name, w, h, scale = 1) =>
  ({ src: `/clientele/${file}.webp?v=${hash}`, name, w, h, scale })

export const CLIENT_LOGOS = [
  logo('honda', '03dd6583', "Honda", 119, 96, 1.1),
  logo('gemini', 'f74ed96e', "Gemini", 240, 88, 1.02),
  logo('kfc', 'be466c9c', "KFC", 240, 74, 0.79),
  logo('pizza-hut', '406923fc', "Pizza Hut", 95, 96, 1.19),
  logo('sbi', '19eaa56c', "State Bank of India", 127, 96, 1.12),
  logo('castrol', '528c47f0', "Castrol", 240, 57, 0.82),
  logo('tvs', 'c781a1dc', "TVS", 240, 43, 0.74),
  logo('ntt-data', '7af912bd', "NTT Data", 240, 35, 0.68),
  logo('zf', 'cba2c431', "ZF", 96, 96, 1.17),
  logo('sun-pharma', '6556265d', "Sun Pharma", 240, 86, 0.99),
  logo('saint-gobain', '9e2d9160', "Saint-Gobain", 229, 96, 1.14),
  logo('bank-of-maharashtra', 'bb0a60c1', "Bank of Maharashtra", 240, 70, 1.04),
  logo('united-breweries', '531f93ee', "United Breweries", 199, 96, 1.22),
  logo('amneal', 'd13d0707', "Amneal Pharmaceuticals", 230, 96, 1.26),
  logo('finolex-cables', '9efb0e5c', "Finolex Cables", 238, 96, 0.98),
  logo('iifl-finance', 'c003203f', "IIFL Finance", 240, 45, 0.81),
  logo('arvind', 'a93cc4e8', "Arvind", 240, 82, 1.04),
  logo('vlcc', '0e782c85', "VLCC", 240, 69, 0.89),
  logo('supreme', '1cb84093', "Supreme", 208, 64, 0.88),
  logo('amns-india', '1bab0e6f', "AM/NS India", 230, 96, 0.89),
  logo('tmb', '7f0092a0', "Tamilnad Mercantile Bank", 240, 75, 0.89),
  logo('fedbank', '897d82bf', "Fedbank Financial Services", 240, 51, 0.78),
  logo('titan-eyeplus', '3946c1a1', "Titan Eyeplus", 240, 91, 1.17),
  logo('edufund', '74c7d680', "EduFund", 240, 45, 0.74),
  logo('exxaro-tiles', 'ded22890', "Exxaro Tiles", 240, 76, 0.91),
  logo('agl-tiles', '2abd420a', "AGL Tiles", 240, 93),
  logo('gallantt', 'efa5835a', "Gallantt", 240, 45, 0.76),
  logo('saatvik', '1e674abd', "Saatvik", 240, 54),
  logo('kaizen-hospital', 'dfa22238', "Kaizen Hospital", 164, 96, 1.11),
  logo('davat', '2fc6e240', "Davat Beverages", 150, 96, 1.08),
  logo('mangalam-organics', '71e3ba71', "Mangalam Organics", 240, 76, 0.94),
  logo('aerolam', '2b0821c3', "Aerolam Insulations", 192, 96, 1.21),
  logo('ratnaakar', 'e30ce813', "Ratnaakar", 233, 46, 0.81),
  logo('sankalp', '9b82409e', "Sankalp", 159, 96, 1.22),
  logo('anand-niketan', 'afaac430', "Anand Niketan Group of Schools", 240, 89, 1.26),
  logo('rus-education', '9367e22d', "RUS Education", 240, 83, 1.14),
  logo('shreehari', '1216766b', "Shreehari", 207, 96, 1.11),
  logo('city-square-mart', '5405096b', "City Square Mart", 183, 60, 0.88),
  logo('knownsense-studios', '4d40b144', "KnownSense Studios", 181, 96, 1.31),
  logo('baba', 'f73eb164', "Baba", 240, 91, 0.89),
  logo('7oak-developers', '515e0a84', "7 Oak Developers", 218, 96, 1.12),
]
