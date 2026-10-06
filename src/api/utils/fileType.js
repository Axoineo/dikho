// Identifies a file from its leading bytes. The caller-supplied filename and
// Content-Type are both attacker-controlled, so anything stored or served on
// the strength of its type must match one of these signatures as well.

function startsWith(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false
  }
  return true
}

const ascii = (text) => [...text].map((char) => char.charCodeAt(0))

const PDF = ascii('%PDF-')
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const GIF87 = ascii('GIF87a')
const GIF89 = ascii('GIF89a')
const RIFF = ascii('RIFF')
const WEBP = ascii('WEBP')

/** Returns the sniffed MIME type, or null when the bytes match none we accept. */
export function sniffType(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (startsWith(bytes, PDF)) return 'application/pdf'
  if (startsWith(bytes, PNG)) return 'image/png'
  if (startsWith(bytes, JPEG)) return 'image/jpeg'
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return 'image/gif'
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp'
  return null
}

export const EXTENSION_FOR = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/**
 * A display-only filename: no path, no control characters, bounded length.
 * Never use the result as a storage key; keys are generated server-side.
 */
export function safeDisplayName(name, fallback = 'document') {
  const base = String(name ?? '').split(/[\\/]/).pop()
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)
  return cleaned || fallback
}
