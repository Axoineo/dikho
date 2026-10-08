// Message kinds that are more than text or a file, in both directions.
//
// Inbound: turns a webhook `message` into { type, body, media, payload }.
// `body` is a plain-text summary (what the chat list, search and older
// dashboards show); `payload` is the structured version the thread renders,
// stored as JSON in messages.payload (migration 0012). Every field is copied
// out by name and capped in length: provider payloads are untrusted, and the
// column must not become a dump of whatever Meta (or a forger who got past the
// signature) sends.
//
// Outbound: validates what an agent composed against Meta's limits and
// returns the Graph request part, the stored payload and the summary. A
// refusal throws InputError with a message the agent can act on.

export class InputError extends Error {}

const MAX_PAYLOAD_CHARS = 8000

function text(value, max) {
  if (value === undefined || value === null) return null
  const s = String(value).trim()
  return s ? s.slice(0, max) : null
}

function number(value, min, max) {
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

// Drops nulls and empty arrays so the stored JSON stays small and readable.
function compact(obj) {
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out
}

export function serializePayload(payload) {
  if (!payload) return null
  const json = JSON.stringify(payload)
  // Every writer caps its fields, so this only trips on a pathological
  // payload; dropping it keeps the row (and its summary) rather than failing.
  return json.length <= MAX_PAYLOAD_CHARS ? json : JSON.stringify({ kind: payload.kind, truncated: true })
}

/* ── Inbound ───────────────────────────────────────────────────────────── */

function contactCard(c) {
  return compact({
    name: text(c?.name?.formatted_name, 120) ?? text([c?.name?.first_name, c?.name?.last_name].filter(Boolean).join(' '), 120),
    org: text(c?.org?.company, 120),
    phones: (c?.phones ?? []).slice(0, 5).map((p) => compact({ phone: text(p?.phone, 40), wa_id: text(p?.wa_id, 20), type: text(p?.type, 20) })).filter((p) => p.phone),
    emails: (c?.emails ?? []).slice(0, 5).map((e) => text(e?.email, 120)).filter(Boolean),
  })
}

// A submitted address (address_message) or Flow arrives as nfm_reply with a
// JSON string. Only flat string/number values are kept, at most 30 of them.
function formResponse(raw) {
  let parsed = null
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const source = parsed.values && typeof parsed.values === 'object' ? parsed.values : parsed
  const out = {}
  for (const [key, value] of Object.entries(source).slice(0, 30)) {
    if (typeof value === 'string' || typeof value === 'number') out[String(key).slice(0, 40)] = String(value).slice(0, 300)
  }
  return Object.keys(out).length ? out : null
}

const ADDRESS_ORDER = ['name', 'phone_number', 'house_number', 'floor_number', 'tower_number', 'building_name', 'address', 'landmark_area', 'city', 'state', 'in_pin_code', 'country']

export function formatAddress(values) {
  if (!values) return ''
  return ADDRESS_ORDER.map((key) => values[key]).filter(Boolean).join(', ')
}

function parseKind(m) {
  switch (m.type) {
    case 'text': return { type: 'text', body: m.text?.body ?? '', media: null, payload: null }
    case 'image': return { type: 'image', body: m.image?.caption ?? '', media: m.image, payload: null }
    case 'document': return { type: 'document', body: m.document?.caption ?? '', media: m.document, payload: null }
    case 'audio': return { type: 'audio', body: '', media: m.audio, payload: m.audio?.voice ? { kind: 'voice' } : null }
    case 'video': return { type: 'video', body: m.video?.caption ?? '', media: m.video, payload: null }
    case 'sticker': return { type: 'sticker', body: '', media: m.sticker, payload: null }
    case 'reaction': return { type: 'reaction', body: m.reaction?.emoji ?? '', media: null, payload: null }
    case 'location': {
      const location = compact({
        latitude: number(m.location?.latitude, -90, 90),
        longitude: number(m.location?.longitude, -180, 180),
        name: text(m.location?.name, 200),
        address: text(m.location?.address, 300),
        url: /^https:\/\//i.test(m.location?.url ?? '') ? text(m.location.url, 500) : null,
      })
      const label = location.name ?? location.address ?? 'Location'
      return { type: 'location', body: `📍 ${label}`, media: null, payload: { kind: 'location', ...location } }
    }
    case 'contacts': {
      const contacts = (m.contacts ?? []).slice(0, 10).map(contactCard)
      const names = contacts.map((c) => c.name).filter(Boolean).join(', ') || 'Contact'
      return { type: 'contacts', body: `👤 ${names}`.slice(0, 300), media: null, payload: { kind: 'contacts', contacts } }
    }
    // A tap on reply buttons or a list row carries the option chosen; an
    // address or Flow form carries its fields as nfm_reply.
    case 'interactive': {
      const i = m.interactive ?? {}
      const choice = i.button_reply ?? i.list_reply
      if (choice) {
        const reply = compact({ id: text(choice.id, 200), title: text(choice.title, 100), description: text(choice.description, 200) })
        return { type: 'interactive', body: reply.title ?? '[interactive]', media: null, payload: { kind: 'choice', reply } }
      }
      if (i.nfm_reply) {
        const name = text(i.nfm_reply.name, 40)
        const values = formResponse(i.nfm_reply.response_json)
        const body = name === 'address_message' ? `📍 Address: ${formatAddress(values) || 'sent'}` : (text(i.nfm_reply.body, 300) ?? 'Form submitted')
        return { type: 'interactive', body: body.slice(0, 500), media: null, payload: compact({ kind: 'form_reply', name, values }) }
      }
      return { type: 'interactive', body: '[interactive]', media: null, payload: null }
    }
    // A quick-reply button on a template.
    case 'button': {
      const reply = compact({ title: text(m.button?.text, 100), id: text(m.button?.payload, 200) })
      return { type: 'button', body: reply.title ?? '[button]', media: null, payload: { kind: 'choice', reply } }
    }
    case 'order': {
      const items = (m.order?.product_items ?? []).slice(0, 30).map((p) => compact({
        product: text(p?.product_retailer_id, 100),
        quantity: number(p?.quantity, 0, 1e6),
        price: number(p?.item_price, 0, 1e9),
        currency: text(p?.currency, 3),
      }))
      return {
        type: 'order',
        body: `🛒 Order: ${items.length} item${items.length === 1 ? '' : 's'}`,
        media: null,
        payload: compact({ kind: 'order', catalog_id: text(m.order?.catalog_id, 60), text: text(m.order?.text, 500), items }),
      }
    }
    // WhatsApp's own notices, e.g. the customer changed their number.
    case 'system': return { type: 'system', body: text(m.system?.body, 300) ?? 'System notice', media: null, payload: compact({ kind: 'system', system_type: text(m.system?.type, 40) }) }
    default: return { type: m.type ?? 'unknown', body: `[${m.type ?? 'unsupported message'}]`, media: null, payload: null }
  }
}

// Click-to-WhatsApp ad that started the chat. The ad's own tracking id
// (ctwa_clid) and image URL are not kept: one is marketing tracking, the
// other an external URL the dashboard would have to load.
function referral(m) {
  const r = m.referral
  if (!r) return null
  return compact({
    source_type: text(r.source_type, 20),
    source_url: /^https:\/\//i.test(r.source_url ?? '') ? text(r.source_url, 500) : null,
    headline: text(r.headline, 200),
    body: text(r.body, 300),
    media_type: text(r.media_type, 20),
  })
}

export function parseInbound(m) {
  const parsed = parseKind(m)
  const extra = compact({
    referral: referral(m),
    forwarded: m.context?.frequently_forwarded ? 'many' : m.context?.forwarded ? 'once' : null,
  })
  if (Object.keys(extra).length) parsed.payload = { kind: parsed.payload?.kind ?? parsed.type, ...parsed.payload, ...extra }
  return parsed
}

/* ── Outbound ──────────────────────────────────────────────────────────── */

function required(value, label, max) {
  const s = text(value, Infinity)
  if (!s) throw new InputError(`${label} is required.`)
  if (s.length > max) throw new InputError(`${label} can be at most ${max} characters.`)
  return s
}

function optional(value, label, max) {
  const s = text(value, Infinity)
  if (s && s.length > max) throw new InputError(`${label} can be at most ${max} characters.`)
  return s
}

export function buildLocation(input) {
  const latitude = number(input?.latitude, -90, 90)
  const longitude = number(input?.longitude, -180, 180)
  if (latitude === null || longitude === null) throw new InputError('Enter a valid latitude and longitude.')
  const name = optional(input?.name, 'Place name', 100)
  const address = optional(input?.address, 'Address', 300)
  const location = compact({ latitude, longitude, name, address })
  return {
    message: { type: 'location', location },
    payload: { kind: 'location', ...location },
    body: `📍 ${name ?? address ?? 'Location'}`,
  }
}

export function buildContact(input) {
  const name = required(input?.name, 'Name', 100)
  const phone = required(input?.phone, 'Phone number', 30)
  if (!/^\+?[\d\s()-]{6,30}$/.test(phone)) throw new InputError('Enter a valid phone number.')
  const email = optional(input?.email, 'Email', 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('Enter a valid email address.')
  const company = optional(input?.company, 'Company', 100)
  const card = compact({
    name: { formatted_name: name, first_name: name.split(/\s+/)[0] },
    phones: [{ phone, type: 'WORK' }],
    emails: email ? [{ email, type: 'WORK' }] : null,
    org: company ? { company } : null,
  })
  return {
    message: { type: 'contacts', contacts: [card] },
    payload: { kind: 'contacts', contacts: [compact({ name, org: company, phones: [{ phone, type: 'WORK' }], emails: email ? [email] : null })] },
    body: `👤 ${name}`,
  }
}

// Meta's limits for each interactive kind:
// https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages
const INTERACTIVE_KINDS = new Set(['buttons', 'list', 'cta_url', 'location_request', 'address'])

export function buildInteractive(input) {
  const kind = input?.kind
  if (!INTERACTIVE_KINDS.has(kind)) throw new InputError('Unknown message kind.')
  const body = required(input?.body, 'Message', kind === 'list' ? 4096 : 1024)
  const canDecorate = kind === 'buttons' || kind === 'list' || kind === 'cta_url'
  const header = canDecorate ? optional(input?.header, 'Header', 60) : null
  const footer = canDecorate ? optional(input?.footer, 'Footer', 60) : null
  const interactive = compact({
    header: header ? { type: 'text', text: header } : null,
    body: { text: body },
    footer: footer ? { text: footer } : null,
  })
  const payload = compact({ kind: 'interactive', interactive_type: kind, header, body, footer })

  if (kind === 'buttons') {
    const titles = (Array.isArray(input.buttons) ? input.buttons : []).map((b) => text(b, Infinity)).filter(Boolean)
    if (titles.length < 1 || titles.length > 3) throw new InputError('Add one to three buttons.')
    for (const t of titles) if (t.length > 20) throw new InputError('A button can be at most 20 characters.')
    if (new Set(titles.map((t) => t.toLowerCase())).size !== titles.length) throw new InputError('Each button needs a different label.')
    interactive.type = 'button'
    interactive.action = { buttons: titles.map((title, i) => ({ type: 'reply', reply: { id: `btn_${i + 1}`, title } })) }
    payload.buttons = titles
  } else if (kind === 'list') {
    const button = required(input.button, 'List button label', 20)
    const sections = (Array.isArray(input.sections) ? input.sections : []).map((s) => ({
      title: optional(s?.title, 'Section title', 24),
      rows: (Array.isArray(s?.rows) ? s.rows : []).map((r) => ({
        title: optional(r?.title, 'Option', 24),
        description: optional(r?.description, 'Option description', 72),
      })).filter((r) => r.title),
    })).filter((s) => s.rows.length)
    const rowCount = sections.reduce((n, s) => n + s.rows.length, 0)
    if (sections.length < 1 || sections.length > 10) throw new InputError('Add between one and ten sections.')
    if (rowCount < 1 || rowCount > 10) throw new InputError('A list can have one to ten options in total.')
    if (sections.length > 1 && sections.some((s) => !s.title)) throw new InputError('With more than one section, every section needs a title.')
    let n = 0
    interactive.type = 'list'
    interactive.action = {
      button,
      sections: sections.map((s) => compact({
        title: s.title,
        rows: s.rows.map((r) => compact({ id: `row_${++n}`, title: r.title, description: r.description })),
      })),
    }
    payload.button = button
    payload.sections = sections.map((s) => compact({ title: s.title, rows: s.rows.map((r) => compact(r)) }))
  } else if (kind === 'cta_url') {
    const label = required(input.label, 'Button label', 20)
    const url = required(input.url, 'Link', 2000)
    let parsed
    try { parsed = new URL(url) } catch { throw new InputError('Enter a full link starting with https://') }
    if (parsed.protocol !== 'https:') throw new InputError('Enter a full link starting with https://')
    interactive.type = 'cta_url'
    interactive.action = { name: 'cta_url', parameters: { display_text: label, url: parsed.href } }
    payload.label = label
    payload.url = parsed.href
  } else if (kind === 'location_request') {
    interactive.type = 'location_request_message'
    interactive.action = { name: 'send_location' }
  } else {
    // Address messages are an India-only Cloud API feature.
    interactive.type = 'address_message'
    interactive.action = { name: 'address_message', parameters: { country: 'IN' } }
  }

  return { message: { type: 'interactive', interactive }, payload, body }
}
