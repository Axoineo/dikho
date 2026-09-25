// Shared, dependency-free helpers for WhatsApp template variables ({{...}}).
//
// Used by BOTH the campaign wizard/preview (frontend) and the send path
// (Worker), so the mapping a user confirms in the UI is exactly what is built
// into the Meta `components` payload. Meta supports two placeholder styles:
//   • positional — {{1}}, {{2}} … sent as an ordered parameter list
//   • named      — {{name}}       sent with a `parameter_name`
// Both are handled here; the token text itself decides which.

export const TOKEN_RE = /\{\{\s*([\w.\- ]+?)\s*\}\}/g

// Ordered, de-duplicated raw tokens inside a template string.
export function extractTokens(text) {
  const tokens = []
  const seen = new Set()
  for (const [, token] of String(text ?? '').matchAll(TOKEN_RE)) {
    const trimmed = token.trim()
    if (trimmed && !seen.has(trimmed)) { seen.add(trimmed); tokens.push(trimmed) }
  }
  return tokens
}

// Every distinct token across a fetched template's header + body.
export function templateTokens(template) {
  if (!template) return []
  const merged = [...extractTokens(template.headerText), ...extractTokens(template.bodyText)]
  return [...new Set(merged)]
}

export function isPositional(token) {
  return /^\d+$/.test(String(token))
}

// Loose key for fuzzy matching a token to a column/field name: lowercase and
// drop everything that is not a letter or digit
// ("Send List - Name" -> "sendlistname", "{{ Customer_Name }}" -> "customername").
export function normalizeKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Standard contact fields usable as a variable source.
export const CONTACT_FIELDS = ['name', 'company', 'email', 'phone']

// Best-guess source for one named token, given the columns available. Returns
// a map entry ({ source, key }) or null when nothing matches (e.g. positional
// tokens, which the caller assigns by order instead).
export function guessSource(token, { fields = CONTACT_FIELDS, attributeKeys = [] } = {}) {
  if (isPositional(token)) return null
  const target = normalizeKey(token)

  const exactAttr = attributeKeys.find((key) => normalizeKey(key) === target)
  if (exactAttr) return { source: 'attribute', key: exactAttr }

  const exactField = fields.find((field) => normalizeKey(field) === target)
  if (exactField) return { source: 'field', key: exactField }

  const partialAttr = attributeKeys.find((key) => {
    const norm = normalizeKey(key)
    return norm && (norm.includes(target) || target.includes(norm))
  })
  if (partialAttr) return { source: 'attribute', key: partialAttr }

  const partialField = fields.find((field) => {
    const norm = normalizeKey(field)
    return norm.includes(target) || target.includes(norm)
  })
  if (partialField) return { source: 'field', key: partialField }

  return null
}

// Auto-build a full token->source map. Named tokens match by name; positional
// tokens are then filled, in numeric order, from the attribute columns that no
// named token already claimed.
export function autoMap(tokens, { fields = CONTACT_FIELDS, attributeKeys = [] } = {}) {
  const map = {}
  const claimed = new Set()

  for (const token of tokens.filter((t) => !isPositional(t))) {
    const guess = guessSource(token, { fields, attributeKeys })
    if (guess) {
      map[token] = guess
      if (guess.source === 'attribute') claimed.add(guess.key)
    }
  }

  const spare = attributeKeys.filter((key) => !claimed.has(key))
  let cursor = 0
  for (const token of tokens.filter(isPositional).sort((a, b) => Number(a) - Number(b))) {
    if (cursor < spare.length) map[token] = { source: 'attribute', key: spare[cursor++] }
  }

  return map
}

// Raw (unsanitised) value for a map entry against one contact.
function resolveRaw(entry, contact) {
  if (!entry) return ''
  if (entry.source === 'literal') return entry.value ?? ''
  if (entry.source === 'field') return contact?.[entry.key] ?? ''
  if (entry.source === 'attribute') return contact?.attributes?.[entry.key] ?? ''
  return ''
}

// Meta rejects parameter text containing newlines, tabs, or 4+ consecutive
// spaces, so every value is flattened to single-spaced text.
export function sanitizeParam(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

// Resolved, send-ready value for a token (sanitised, with fallback applied).
export function resolveValue(token, map, contact, { fallback = '' } = {}) {
  const entry = map?.[token]
  const value = sanitizeParam(resolveRaw(entry, contact))
  if (value) return value
  return sanitizeParam(entry?.fallback) || fallback
}

// True when a token has no usable value for this contact (drives the
// "N recipients missing {{x}}" warning and blocks a half-mapped send).
export function isMissing(token, map, contact) {
  const entry = map?.[token]
  if (!entry) return true
  const value = sanitizeParam(resolveRaw(entry, contact))
  if (value) return false
  return !sanitizeParam(entry.fallback)
}

// Substitutes tokens for the preview. Unmapped/empty tokens are left as the
// literal {{token}} so personalization gaps stay visible.
export function renderTemplateText(text, map, contact) {
  return String(text ?? '').replace(TOKEN_RE, (whole, token) => {
    const value = sanitizeParam(resolveRaw(map?.[token.trim()], contact))
    return value || whole
  })
}

// One Meta component ({ type, parameters }) for a header/body string, or null
// when the string has no variables.
function buildParamComponent(type, text, map, contact, fallback) {
  const tokens = extractTokens(text)
  if (tokens.length === 0) return null

  const positional = tokens.every(isPositional)
  const ordered = positional ? [...tokens].sort((a, b) => Number(a) - Number(b)) : tokens

  const parameters = ordered.map((token) => {
    const param = { type: 'text', text: resolveValue(token, map, contact, { fallback }) }
    if (!positional) param.parameter_name = token
    return param
  })

  return { type, parameters }
}

// Full Meta `components` array for one recipient. Empty array => static send.
export function buildComponents(template, map, contact, { fallback = ' ' } = {}) {
  const components = []
  const header = buildParamComponent('header', template?.headerText, map, contact, fallback)
  if (header) components.push(header)
  const body = buildParamComponent('body', template?.bodyText, map, contact, fallback)
  if (body) components.push(body)
  return components
}
