// Dependency-free CSV + XLSX reader for the Worker runtime.
//
// SheetJS is deliberately avoided here: it is large, and the import path only
// needs "read a flat header + rows" rather than the full OOXML feature set.
// XLSX entries are inflated with the runtime's DecompressionStream, which
// Workers provides natively.

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return XML_ENTITIES[entity] ?? match
  })
}

/* ── CSV ──────────────────────────────────────────────────────────────── */

// Handles quoted fields, escaped quotes (""), and CRLF/LF line endings.
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else { quoted = false }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') { quoted = true }
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else { field += char }
  }

  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/* ── XLSX (ZIP + OOXML) ───────────────────────────────────────────────── */

function readU16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8) }
function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// Walks the ZIP central directory and returns { [entryName]: Uint8Array }.
async function unzip(bytes) {
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i -= 1) {
    if (readU32(bytes, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file')

  const entryCount = readU16(bytes, eocd + 10)
  let pointer = readU32(bytes, eocd + 16)
  const files = {}
  const decoder = new TextDecoder()

  for (let i = 0; i < entryCount; i += 1) {
    if (readU32(bytes, pointer) !== 0x02014b50) break

    const method = readU16(bytes, pointer + 10)
    const compressedSize = readU32(bytes, pointer + 20)
    const nameLength = readU16(bytes, pointer + 28)
    const extraLength = readU16(bytes, pointer + 30)
    const commentLength = readU16(bytes, pointer + 32)
    const localOffset = readU32(bytes, pointer + 42)
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength))

    // Local header repeats the name/extra lengths; the payload follows them.
    const localNameLength = readU16(bytes, localOffset + 26)
    const localExtraLength = readU16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)

    files[name] = method === 0 ? raw : await inflateRaw(raw)
    pointer += 46 + nameLength + extraLength + commentLength
  }

  return files
}

function columnIndex(cellRef) {
  const letters = cellRef.match(/^[A-Z]+/)?.[0] ?? 'A'
  let index = 0
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64)
  return index - 1
}

export async function parseXlsx(bytes) {
  const files = await unzip(bytes)
  const decoder = new TextDecoder()

  const sharedStrings = []
  if (files['xl/sharedStrings.xml']) {
    const xml = decoder.decode(files['xl/sharedStrings.xml'])
    for (const [, block] of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      // Rich-text runs split a single string across several <t> nodes.
      const text = [...block.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')
      sharedStrings.push(decodeXml(text))
    }
  }

  const sheetName = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
  if (!sheetName) throw new Error('No worksheet found in workbook')
  const sheetXml = decoder.decode(files[sheetName])

  const rows = []
  for (const [, rowXml] of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = []
    for (const cell of rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cell[1]
      const body = cell[2]
      const type = attrs.match(/t="([^"]+)"/)?.[1]
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1]

      let value = ''
      if (type === 'inlineStr') {
        value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''))
      } else {
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        if (raw !== undefined) {
          value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : decodeXml(raw)
        }
      }

      row[ref ? columnIndex(ref) : row.length] = value
    }
    rows.push([...row].map((cell) => cell ?? ''))
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''))
}

/* ── Shared entry point ───────────────────────────────────────────────── */

// Returns array-of-objects keyed by the (lowercased) header row.
export async function parseContactFile(file) {
  const buffer = new Uint8Array(await file.arrayBuffer())
  const isXlsx = buffer[0] === 0x50 && buffer[1] === 0x4b // "PK" zip magic

  const rows = isXlsx ? await parseXlsx(buffer) : parseCsv(new TextDecoder().decode(buffer))
  if (rows.length === 0) return []

  const headers = rows[0].map((h) => String(h).trim().toLowerCase())
  return rows.slice(1).map((row) => {
    const record = {}
    headers.forEach((header, index) => { record[header] = String(row[index] ?? '').trim() })
    return record
  })
}
