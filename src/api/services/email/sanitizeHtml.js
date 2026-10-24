// Email HTML sanitizer: an ALLOWLIST REBUILD, not a filter. The input is
// tokenized, and the output is generated only from allowed tags and
// attributes, with every attribute value and every text run escaped by this
// file. Nothing from the input is copied through verbatim, so malformed or
// hostile markup can at worst be dropped or shown as text.
//
// It is one of two layers. The dashboard renders the result in an iframe
// with `sandbox` (no scripts, no forms) and its own Content-Security-Policy
// (no network loads), so even a sanitizer miss cannot run script or call
// home. Used for received mail (shown), mail written in Dikho (sent) and
// templates.
//
// Deliberately dropped:
//   - script/style-like containers and everything in them (script, iframe,
//     object, embed, svg, math, template, noscript, head, title, form fields);
//   - every event handler and any attribute not on the list;
//   - links that are not http(s), mailto or tel, after entity decoding;
//   - REMOTE IMAGES. Loading them would tell the sender when and where the
//     mail was opened (tracking pixels) and leak the reader's IP address.
//     Only inline data:image/... images are kept; others leave their alt text.

// Every HTML void element: they never have content or a closing tag, so one
// must never start a "skip until the closing tag" run.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

const ALLOWED = new Set([
  'a', 'abbr', 'address', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col',
  'colgroup', 'dd', 'del', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'font', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span',
  'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'tt', 'u', 'ul', 'var', 'wbr',
])

// Containers whose CONTENT is dropped too. (<head> is not one: emails keep
// their <style> there. Its other children are dropped on their own.)
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'applet', 'svg', 'math', 'template',
  'noscript', 'noembed', 'noframes', 'title', 'textarea', 'select', 'option', 'xmp', 'plaintext', 'button',
  'audio', 'video', 'canvas', 'map',
])

// Elements whose content the HTML parser treats as raw text: no tags inside.
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext'])

const GLOBAL_ATTRS = new Set(['align', 'valign', 'dir', 'lang', 'title', 'style', 'class', 'width', 'height', 'bgcolor', 'color'])
const TAG_ATTRS = {
  a: new Set(['href', 'name']),
  img: new Set(['src', 'alt', 'border', 'hspace', 'vspace']),
  font: new Set(['face', 'size']),
  ol: new Set(['start', 'type', 'reversed']),
  ul: new Set(['type']),
  li: new Set(['value']),
  table: new Set(['border', 'cellpadding', 'cellspacing', 'frame', 'rules', 'summary']),
  td: new Set(['colspan', 'rowspan', 'nowrap', 'abbr', 'scope']),
  th: new Set(['colspan', 'rowspan', 'nowrap', 'abbr', 'scope']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  blockquote: new Set(['cite']),
  q: new Set(['cite']),
  del: new Set(['cite', 'datetime']),
  ins: new Set(['cite', 'datetime']),
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n',
  lpar: '(', rpar: ')', sol: '/', bsol: '\\', semi: ';', comma: ',', period: '.', excl: '!', num: '#',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  euro: '€', pound: '£', yen: '¥', rupee: '₹', deg: '°', times: '×', zwnj: '‌',
}

/** Decodes numeric and common named character references. */
export function decodeEntities(text) {
  return String(text).replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});?/g, (whole, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�'
      return String.fromCodePoint(code)
    }
    const named = NAMED_ENTITIES[ref.toLowerCase()]
    return named ?? whole
  })
}

const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// ── Tokenizer ────────────────────────────────────────────────────────────────
// Yields { type: 'text' | 'open' | 'close', ... }. Comments, doctypes and
// processing instructions are skipped.
export function* tokenize(html) {
  const s = String(html ?? '')
  let i = 0
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    if (lt === -1) { yield { type: 'text', text: s.slice(i) }; return }
    if (lt > i) yield { type: 'text', text: s.slice(i, lt) }
    i = lt

    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4)
      i = end === -1 ? s.length : end + 3
      continue
    }
    if (s[i + 1] === '!' || s[i + 1] === '?') {
      const end = s.indexOf('>', i + 2)
      i = end === -1 ? s.length : end + 1
      continue
    }
    const closing = s[i + 1] === '/'
    const nameStart = closing ? i + 2 : i + 1
    const nameMatch = /^[A-Za-z][A-Za-z0-9:-]*/.exec(s.slice(nameStart, nameStart + 64))
    if (!nameMatch) {
      // "<" that does not start a tag is text.
      yield { type: 'text', text: '<' }
      i += 1
      continue
    }
    const name = nameMatch[0].toLowerCase()

    // Find the end of the tag, respecting quoted attribute values.
    let j = nameStart + nameMatch[0].length
    let quote = null
    while (j < s.length) {
      const ch = s[j]
      if (quote) { if (ch === quote) quote = null }
      else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '>') break
      j++
    }
    const inner = s.slice(nameStart + nameMatch[0].length, j)
    i = j + 1

    if (closing) { yield { type: 'close', name }; continue }
    yield { type: 'open', name, attrs: parseAttributes(inner), selfClosing: /\/\s*$/.test(inner) }

    if (RAW_TEXT.has(name)) {
      // Raw-text content runs to the matching close tag, whatever it contains.
      const close = new RegExp(`</${name}\\s*>`, 'i')
      const rest = s.slice(i)
      const m = close.exec(rest)
      const content = m ? rest.slice(0, m.index) : rest
      yield { type: 'raw', name, text: content }
      yield { type: 'close', name }
      i += m ? m.index + m[0].length : rest.length
    }
  }
}

function parseAttributes(text) {
  const attrs = []
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m
  while ((m = re.exec(text)) && attrs.length < 64) {
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    attrs.push([m[1].toLowerCase(), decodeEntities(value)])
  }
  return attrs
}

// ── Values ───────────────────────────────────────────────────────────────────
function safeUrl(value, { allowData = false } = {}) {
  // Browsers ignore ASCII whitespace and control characters inside a scheme,
  // so they are removed before the scheme is checked.
  const compact = [...value].filter((ch) => {
    const code = ch.codePointAt(0)
    return code > 0x20 && (code < 0x7f || code > 0x9f)
  }).join('')
  const lower = compact.toLowerCase()
  if (lower.startsWith('#')) return compact.slice(0, 2048)
  if (/^(https?:\/\/|mailto:|tel:)/.test(lower)) return compact.slice(0, 2048)
  if (allowData && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(compact) && compact.length <= 200_000) return compact
  return null
}

/** Strips CSS features that load resources or run code in old engines. */
export function sanitizeCss(css) {
  return String(css)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[<>]/g, '')
    .replace(/\\/g, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\s*\([^)]*\)?/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .replace(/(behaviou?r|-moz-binding)\s*:[^;]*;?/gi, '')
    .replace(/javascript\s*:/gi, '')
    .slice(0, 20_000)
}

function sanitizeAttr(tag, name, value) {
  if (!(GLOBAL_ATTRS.has(name) || TAG_ATTRS[tag]?.has(name))) return null
  if (name === 'href' || name === 'cite') return safeUrl(value)
  if (name === 'src') {
    const url = safeUrl(value, { allowData: true })
    return url?.startsWith('data:') ? url : null
  }
  if (name === 'style') {
    const css = sanitizeCss(value).trim()
    return css || null
  }
  return value.slice(0, 500)
}

// ── Sanitize ─────────────────────────────────────────────────────────────────
/**
 * Returns safe body HTML. Options:
 *   keepStyles  keep <style> blocks (CSS sanitized), for received mail and
 *               templates; off for mail written in the composer.
 *   maxLength   input above this is truncated before parsing (default 2 MB).
 */
export function sanitizeHtml(html, { keepStyles = true, maxLength = 2_000_000 } = {}) {
  const out = []
  const stack = []
  let skipping = null // name of a DROP_WITH_CONTENT element being skipped
  let skipDepth = 0
  let blockedImages = 0

  for (const token of tokenize(String(html ?? '').slice(0, maxLength))) {
    if (skipping) {
      if (token.type === 'open' && token.name === skipping) skipDepth++
      else if (token.type === 'close' && token.name === skipping && --skipDepth === 0) skipping = null
      continue
    }

    if (token.type === 'text') { out.push(escapeText(decodeEntities(token.text))); continue }

    // Raw-text content (script, style, title...): kept only for <style>, and
    // then only as sanitized CSS, which cannot close the element it sits in.
    if (token.type === 'raw') {
      if (token.name === 'style' && keepStyles) {
        const css = sanitizeCss(token.text).trim()
        if (css) out.push(`<style>${css}</style>`)
      }
      continue
    }

    if (token.type === 'open') {
      if (DROP_WITH_CONTENT.has(token.name)) {
        // Raw-text elements arrive as one 'raw' token, handled above.
        if (!RAW_TEXT.has(token.name) && !token.selfClosing) { skipping = token.name; skipDepth = 1 }
        continue
      }
      if (!ALLOWED.has(token.name)) continue

      const attrs = []
      let src = null
      for (const [name, value] of token.attrs) {
        if (attrs.some(([n]) => n === name)) continue
        const safe = sanitizeAttr(token.name, name, value)
        if (token.name === 'img' && name === 'src') { src = safe; if (!safe) blockedImages++; continue }
        if (safe !== null) attrs.push([name, safe])
      }
      if (token.name === 'img') {
        if (!src) {
          const alt = token.attrs.find(([n]) => n === 'alt')?.[1]
          if (alt) out.push(escapeText(`[${alt.slice(0, 200)}]`))
          continue
        }
        attrs.push(['src', src])
      }
      if (token.name === 'a' && attrs.some(([n]) => n === 'href')) {
        attrs.push(['target', '_blank'], ['rel', 'noopener noreferrer nofollow'])
      }
      out.push(`<${token.name}${attrs.map(([n, v]) => ` ${n}="${escapeAttr(v)}"`).join('')}>`)
      if (!VOID.has(token.name)) stack.push(token.name)
      continue
    }

    if (token.type === 'close') {
      const at = stack.lastIndexOf(token.name)
      if (at === -1) continue
      while (stack.length > at) out.push(`</${stack.pop()}>`)
    }
  }
  while (stack.length) out.push(`</${stack.pop()}>`)
  return { html: out.join(''), blockedImages }
}

/** Plain text from HTML (for the text/plain alternative and previews). */
export function htmlToText(html, maxLength = 200_000) {
  // <li> is handled on its own (a bullet when it opens, nothing when it closes).
  const BLOCK = new Set(['p', 'div', 'br', 'ul', 'ol', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'hr', 'table'])
  const parts = []
  let skipping = null
  for (const token of tokenize(String(html ?? '').slice(0, maxLength))) {
    if (skipping) { if (token.type === 'close' && token.name === skipping) skipping = null; continue }
    if (token.type === 'open' && DROP_WITH_CONTENT.has(token.name) && !RAW_TEXT.has(token.name)) { skipping = token.name; continue }
    if (token.type === 'text') parts.push(decodeEntities(token.text).replace(/\s+/g, ' '))
    else if (token.type === 'open' && token.name === 'li') parts.push('\n• ')
    else if ((token.type === 'open' || token.type === 'close') && BLOCK.has(token.name)) parts.push('\n')
  }
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ /g, ' ').trim()
}

/** Safe HTML for a plain-text body. */
export function textToHtml(text) {
  return `<div style="white-space:pre-wrap">${escapeText(String(text ?? ''))}</div>`
}
