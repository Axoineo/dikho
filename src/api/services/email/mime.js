import { fromBase64url } from './crypto.js'

// Email message plumbing: reading Gmail's parsed messages, summarising a
// thread into the metadata the inbox caches, and building outgoing RFC 5322
// messages. Everything coming from Gmail is untrusted text.

const utf8 = new TextDecoder('utf-8', { fatal: false })
const enc = new TextEncoder()

// ── Addresses ────────────────────────────────────────────────────────────────
export const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value)
}

// Decodes RFC 2047 encoded words (=?utf-8?B?...?= / ?Q?) that Gmail usually,
// but not always, has already decoded.
export function decodeWords(text) {
  return String(text ?? '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset, kind, data) => {
    try {
      let bytes
      if (kind.toUpperCase() === 'B') {
        bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      } else {
        const s = data.replace(/_/g, ' ')
        const out = []
        for (let i = 0; i < s.length; i++) {
          if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2 }
          else out.push(s.charCodeAt(i))
        }
        bytes = Uint8Array.from(out)
      }
      return new TextDecoder(/utf-?8/i.test(charset) ? 'utf-8' : charset).decode(bytes)
    } catch {
      return whole
    }
  })
}

/**
 * Splits an address-list header into [{ name, email }]. Commas inside quotes
 * or angle brackets do not split. Entries without a valid address are dropped.
 */
export function parseAddressList(header, limit = 50) {
  const text = decodeWords(header)
  const parts = []
  let current = ''
  let quoted = false
  let angle = 0
  for (const ch of text) {
    if (ch === '"' ) quoted = !quoted
    else if (!quoted && ch === '<') angle++
    else if (!quoted && ch === '>') angle = Math.max(0, angle - 1)
    if (ch === ',' && !quoted && angle === 0) { parts.push(current); current = '' } else current += ch
  }
  parts.push(current)

  const out = []
  for (const raw of parts) {
    const part = raw.trim()
    if (!part) continue
    const angled = /^(.*?)<([^<>]+)>\s*$/.exec(part)
    const email = (angled ? angled[2] : part).trim().toLowerCase()
    if (!isEmail(email)) continue
    const name = angled ? angled[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim() : ''
    out.push({ name: name.slice(0, 120) || null, email })
    if (out.length >= limit) break
  }
  return out
}

/** Parses a comma/semicolon-separated recipient field typed by a person. */
export function parseRecipientInput(value, limit) {
  if (value === undefined || value === null || value === '') return []
  if (typeof value !== 'string' || value.length > 8000) return null
  const list = parseAddressList(value.replace(/;/g, ','), limit + 1)
  const typed = value.split(/[,;]/).map((s) => s.trim()).filter(Boolean).length
  // Something typed that is not an address is an error, not silently dropped.
  if (list.length !== typed || list.length > limit) return null
  return list
}

// ── Reading Gmail messages ───────────────────────────────────────────────────
function header(headers, name) {
  const lower = name.toLowerCase()
  return headers?.find((h) => String(h?.name).toLowerCase() === lower)?.value ?? null
}

function decodeBody(data) {
  if (typeof data !== 'string' || !data) return ''
  try {
    return utf8.decode(fromBase64url(data))
  } catch {
    return ''
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,1024}$/

/**
 * Turns a Gmail `format=full` message into what the conversation view needs:
 * headers, the HTML and plain bodies (unsanitized; the caller sanitizes) and
 * attachment metadata. Walks at most 200 parts and 12 levels.
 */
export function readMessage(message) {
  const headers = message?.payload?.headers ?? []
  let html = ''
  let text = ''
  const attachments = []
  let walked = 0

  function walk(part, depth) {
    if (!part || depth > 12 || ++walked > 200) return
    const mime = String(part.mimeType || '').toLowerCase()
    const filename = typeof part.filename === 'string' ? part.filename.slice(0, 255) : ''
    const attachmentId = part.body?.attachmentId
    const disposition = String(header(part.headers, 'Content-Disposition') || '').toLowerCase()
    if (attachmentId && SAFE_ID.test(attachmentId) && (filename || disposition.startsWith('attachment') || !mime.startsWith('text/'))) {
      attachments.push({
        id: attachmentId,
        filename: filename || 'attachment',
        mime_type: mime.slice(0, 100) || 'application/octet-stream',
        size: Number(part.body?.size) || 0,
        inline: Boolean(header(part.headers, 'Content-ID')) && !disposition.startsWith('attachment'),
      })
      return
    }
    if (mime === 'text/html' && !html) html = decodeBody(part.body?.data)
    else if (mime === 'text/plain' && !text) text = decodeBody(part.body?.data)
    for (const child of Array.isArray(part.parts) ? part.parts : []) walk(child, depth + 1)
  }
  walk(message?.payload, 0)

  const labels = Array.isArray(message?.labelIds) ? message.labelIds.filter((l) => typeof l === 'string') : []
  return {
    id: message?.id,
    thread_id: message?.threadId,
    labels,
    unread: labels.includes('UNREAD'),
    date: Number(message?.internalDate) ? new Date(Number(message.internalDate)).toISOString() : null,
    subject: decodeWords(header(headers, 'Subject') || '').slice(0, 998),
    from: parseAddressList(header(headers, 'From'), 1)[0] ?? null,
    to: parseAddressList(header(headers, 'To')),
    cc: parseAddressList(header(headers, 'Cc')),
    // Bcc only appears on the sender's own copy.
    bcc: parseAddressList(header(headers, 'Bcc')),
    reply_to: parseAddressList(header(headers, 'Reply-To'), 5),
    message_id: (header(headers, 'Message-ID') || header(headers, 'Message-Id') || '').slice(0, 998),
    references: (header(headers, 'References') || '').slice(0, 4000),
    html,
    text,
    attachments,
  }
}

/** Metadata for the cache from a Gmail `format=metadata` thread. */
export function summarizeThread(thread) {
  const messages = Array.isArray(thread?.messages) ? thread.messages : []
  if (!messages.length || !/^[0-9a-f]{1,32}$/.test(thread?.id ?? '')) return null
  const labels = new Set()
  const people = new Map()
  let last = 0
  let unread = false
  let attachments = false
  for (const m of messages) {
    for (const l of Array.isArray(m.labelIds) ? m.labelIds : []) if (typeof l === 'string') labels.add(l)
    if (m.labelIds?.includes('UNREAD')) unread = true
    last = Math.max(last, Number(m.internalDate) || 0)
    const headers = m.payload?.headers ?? []
    if (/^multipart\/mixed/i.test(header(headers, 'Content-Type') || m.payload?.mimeType || '')) attachments = true
    for (const name of ['From', 'To', 'Cc']) {
      for (const person of parseAddressList(header(headers, name))) {
        if (!people.has(person.email) || (!people.get(person.email).name && person.name)) people.set(person.email, person)
      }
    }
  }
  const first = messages[0]?.payload?.headers ?? []
  return {
    id: thread.id,
    subject: decodeWords(header(first, 'Subject') || '').slice(0, 998),
    participants: [...people.values()].slice(0, 50),
    last_message_at: new Date(last || Date.now()).toISOString(),
    message_count: messages.length,
    unread,
    label_ids: [...labels].slice(0, 100),
    has_attachments: attachments,
  }
}

export const METADATA_QUERY = 'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Content-Type'

// ── Building outgoing messages ───────────────────────────────────────────────
/** True for header text that could inject a header (CR, LF or NUL). */
export const unsafeHeader = (value) => /[\r\n\0]/.test(String(value ?? ''))

function encodeWord(text) {
  // Plain printable ASCII goes as is; anything else as one UTF-8 B word per
  // ~45 bytes so lines stay short.
  if (/^[\x20-\x7e]*$/.test(text)) return text
  const bytes = enc.encode(text)
  const words = []
  for (let i = 0; i < bytes.length; i += 45) {
    let end = Math.min(i + 45, bytes.length)
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end-- // never split a character
    words.push(`=?UTF-8?B?${btoa(String.fromCharCode(...bytes.slice(i, end)))}?=`)
    i = end - 45
  }
  return words.join('\r\n ')
}

export function formatAddress({ name, email }) {
  if (!name) return email
  const safe = name.replace(/[\r\n"\\]/g, '').trim()
  return /^[\x20-\x7e]*$/.test(safe) ? `"${safe}" <${email}>` : `${encodeWord(safe)} <${email}>`
}

function wrapBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/.{1,76}/g, '$&\r\n')
}

function attachmentName(name) {
  const clean = String(name || 'attachment').replace(/[\r\n"\\/\0]/g, '_').slice(0, 180) || 'attachment'
  return /^[\x20-\x7e]*$/.test(clean) ? `"${clean}"` : `"${encodeWord(clean).replace(/\r\n /g, ' ')}"`
}

/**
 * Builds an RFC 5322 message (CRLF line endings, 7-bit: every body part is
 * base64). Header values are validated by the caller; this refuses CR/LF anyway.
 * attachments: [{ filename, mimeType, bytes: Uint8Array }]
 */
export function buildMessage({ from, to, cc = [], bcc = [], subject, html, text, inReplyTo, references, attachments = [], extraHeaders = {} }) {
  for (const value of [subject, inReplyTo, references, ...Object.values(extraHeaders)]) {
    if (unsafeHeader(value)) throw new Error('header value contains a line break')
  }
  const boundary = () => `=_dikho_${crypto.randomUUID().replace(/-/g, '')}`
  const headers = [
    `From: ${formatAddress(from)}`,
    to.length ? `To: ${to.map(formatAddress).join(', ')}` : null,
    cc.length ? `Cc: ${cc.map(formatAddress).join(', ')}` : null,
    bcc.length ? `Bcc: ${bcc.map(formatAddress).join(', ')}` : null,
    `Subject: ${encodeWord(subject || '')}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`),
    'MIME-Version: 1.0',
  ].filter(Boolean)

  const alt = boundary()
  const alternative = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(enc.encode(text || '')),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(enc.encode(html || '')),
    `--${alt}--`,
    '',
  ].join('\r\n')

  let body
  if (attachments.length) {
    const mixed = boundary()
    body = [
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      '',
      `--${mixed}`,
      alternative,
      ...attachments.flatMap((a) => [
        `--${mixed}`,
        `Content-Type: ${/^[a-z]+\/[a-z0-9.+-]+$/i.test(a.mimeType || '') ? a.mimeType : 'application/octet-stream'}; name=${attachmentName(a.filename)}`,
        `Content-Disposition: attachment; filename=${attachmentName(a.filename)}`,
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64(a.bytes),
      ]),
      `--${mixed}--`,
      '',
    ].join('\r\n')
  } else {
    body = alternative
  }
  return `${headers.join('\r\n')}\r\n${body}`
}

/** "Re: " / "Fwd: " once, not stacked. */
export function prefixedSubject(prefix, subject) {
  const clean = String(subject || '').trim()
  const re = new RegExp(`^${prefix}:\\s`, 'i')
  return re.test(clean) ? clean : `${prefix}: ${clean}`.trim()
}
