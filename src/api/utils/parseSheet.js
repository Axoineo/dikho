// Dependency-free CSV + XLSX reader for the Worker runtime.
//
// SheetJS is deliberately avoided here: it is large, and the import path only
// needs "read a flat header + rows" rather than the full OOXML feature set.
// XLSX entries are inflated with the runtime's DecompressionStream, which
// Workers provides natively.
//
// Every input here is untrusted, and a Worker has 128 MB of memory. The caller
// caps the upload's bytes; the limits below cap what those bytes can expand
// into: rows, columns, cell length, and (for XLSX, which is a ZIP) the number
// of archive entries and how far each one may inflate. A small file that
// unpacks to gigabytes of XML is refused part-way through decompression.
export const LIMITS = {
  maxRows: 50_000,
  maxColumns: 200,
  maxCellChars: 2_000,
  maxZipEntries: 1_000,
  maxInflatedEntryBytes: 16 * 1024 * 1024,
  maxInflatedTotalBytes: 24 * 1024 * 1024,
}

class SheetLimitError extends Error {}

function limitError(message) {
  return new SheetLimitError(message)
}

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

  const pushField = () => {
    if (row.length >= LIMITS.maxColumns) throw limitError(`A row has more than ${LIMITS.maxColumns} columns`)
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    if (rows.length >= LIMITS.maxRows) throw limitError(`The file has more than ${LIMITS.maxRows} rows`)
    rows.push(row)
    row = []
  }

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
    else if (char === ',') { pushField() }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      pushField()
      pushRow()
    } else { field += char }
  }

  if (field !== '' || row.length > 0) { pushField(); pushRow() }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/* ── XLSX (ZIP + OOXML) ───────────────────────────────────────────────── */

function readU16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8) }
function readU32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

// Inflates one deflate-raw entry, giving up as soon as the output passes
// `maxBytes` rather than after the whole bomb has been expanded in memory.
async function inflateRaw(bytes, maxBytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw limitError('The workbook expands to more data than an import allows')
      chunks.push(value)
    }
  } catch (err) {
    await reader.cancel().catch(() => {})
    if (err instanceof SheetLimitError) throw err
    throw new Error('Not a valid .xlsx file')
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

// Walks the ZIP central directory and inflates only the entries `wanted`
// selects, returning { [entryName]: Uint8Array }. Offsets and sizes come from
// the file itself, so each one is bounds-checked before use.
async function unzip(bytes, wanted) {
  const invalid = () => new Error('Not a valid .xlsx file')
  const inBounds = (start, length) => start >= 0 && length >= 0 && start + length <= bytes.length

  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i -= 1) {
    if (readU32(bytes, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw invalid()

  const entryCount = readU16(bytes, eocd + 10)
  if (entryCount > LIMITS.maxZipEntries) throw limitError('The workbook has too many internal files')
  let pointer = readU32(bytes, eocd + 16)

  const entries = []
  const decoder = new TextDecoder()
  for (let i = 0; i < entryCount; i += 1) {
    if (!inBounds(pointer, 46) || readU32(bytes, pointer) !== 0x02014b50) break

    const flags = readU16(bytes, pointer + 8)
    const method = readU16(bytes, pointer + 10)
    const compressedSize = readU32(bytes, pointer + 20)
    const nameLength = readU16(bytes, pointer + 28)
    const extraLength = readU16(bytes, pointer + 30)
    const commentLength = readU16(bytes, pointer + 32)
    const localOffset = readU32(bytes, pointer + 42)
    if (!inBounds(pointer + 46, nameLength)) throw invalid()
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength))
    entries.push({ name, flags, method, compressedSize, localOffset })
    pointer += 46 + nameLength + extraLength + commentLength
  }

  const files = {}
  let inflatedTotal = 0
  for (const entry of entries.filter((e) => wanted(e.name, entries))) {
    // Encrypted entries and ZIP64 sizes are never produced by a normal
    // spreadsheet export; refusing them keeps the size arithmetic honest.
    if (entry.flags & 0x1) throw limitError('Encrypted workbooks cannot be imported')
    if (entry.compressedSize === 0xffffffff || entry.localOffset === 0xffffffff) throw invalid()
    if (entry.method !== 0 && entry.method !== 8) throw invalid()

    if (!inBounds(entry.localOffset, 30) || readU32(bytes, entry.localOffset) !== 0x04034b50) throw invalid()
    const localNameLength = readU16(bytes, entry.localOffset + 26)
    const localExtraLength = readU16(bytes, entry.localOffset + 28)
    const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength
    if (!inBounds(dataStart, entry.compressedSize)) throw invalid()
    const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize)

    const budget = Math.min(LIMITS.maxInflatedEntryBytes, LIMITS.maxInflatedTotalBytes - inflatedTotal)
    let data
    if (entry.method === 0) {
      if (raw.byteLength > budget) throw limitError('The workbook expands to more data than an import allows')
      data = raw
    } else {
      data = await inflateRaw(raw, budget)
    }
    inflatedTotal += data.byteLength
    files[entry.name] = data
  }

  return files
}

function columnIndex(cellRef) {
  const letters = cellRef.match(/^[A-Z]+/)?.[0] ?? 'A'
  let index = 0
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64)
  return index - 1
}

const SHEET_ENTRY = /^xl\/worksheets\/sheet\d+\.xml$/
const SHARED_STRINGS = 'xl/sharedStrings.xml'

export async function parseXlsx(bytes) {
  // Only the shared-string table and the first worksheet are ever read, so
  // nothing else in the archive is inflated at all.
  const files = await unzip(bytes, (name, entries) =>
    name === SHARED_STRINGS || name === entries.find((e) => SHEET_ENTRY.test(e.name))?.name)
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

  const sheetName = Object.keys(files).find((name) => SHEET_ENTRY.test(name))
  if (!sheetName) throw new Error('No worksheet found in workbook')
  const sheetXml = decoder.decode(files[sheetName])

  const rows = []
  for (const [, rowXml] of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= LIMITS.maxRows) throw limitError(`The file has more than ${LIMITS.maxRows} rows`)
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

      // A cell reference like XFD1 would otherwise allocate a 16k-wide row.
      const index = ref ? columnIndex(ref) : row.length
      if (index >= LIMITS.maxColumns) throw limitError(`A row has more than ${LIMITS.maxColumns} columns`)
      row[index] = value
    }
    rows.push([...row].map((cell) => cell ?? ''))
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''))
}

/* ── JSON ─────────────────────────────────────────────────────────────── */

// Accepts a top-level array (of row objects or of arrays), or an object that
// wraps the list under contacts/rows/data/records.
export function parseJson(text) {
  const data = JSON.parse(text)
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const list = data.contacts ?? data.rows ?? data.data ?? data.records
    if (Array.isArray(list)) return list
  }
  throw new Error('JSON must be an array of rows, or an object with a contacts/rows/data array')
}

/* ── Shared entry point ───────────────────────────────────────────────── */

function checkCell(value) {
  if (String(value).length > LIMITS.maxCellChars) {
    throw limitError(`A cell is longer than ${LIMITS.maxCellChars} characters`)
  }
}

function nonEmpty(rows) {
  return rows.filter((record) => Object.values(record).some((value) => String(value).trim() !== ''))
}

// Array-of-arrays (CSV/XLSX) -> { columns, rows }, first row treated as headers.
function matrixToTable(matrix) {
  if (matrix.length === 0) return { columns: [], rows: [] }
  if (matrix.length > LIMITS.maxRows) throw limitError(`The file has more than ${LIMITS.maxRows} rows`)
  const headers = matrix[0].map((header) => String(header).trim())
  if (headers.length > LIMITS.maxColumns) throw limitError(`A row has more than ${LIMITS.maxColumns} columns`)
  const rows = matrix.slice(1).map((row) => {
    const record = {}
    headers.forEach((header, index) => {
      if (!header) return
      const value = row[index] ?? ''
      checkCell(value)
      record[header] = String(value).trim()
    })
    return record
  })
  return { columns: headers.filter(Boolean), rows: nonEmpty(rows) }
}

// A JSON list (objects or arrays) -> { columns, rows }.
function listToTable(list) {
  if (list.length === 0) return { columns: [], rows: [] }
  if (list.length > LIMITS.maxRows) throw limitError(`The file has more than ${LIMITS.maxRows} rows`)
  if (Array.isArray(list[0])) return matrixToTable(list)

  const columns = []
  const seen = new Set()
  const rows = list.map((item) => {
    const record = {}
    if (item && typeof item === 'object') {
      for (const [key, value] of Object.entries(item)) {
        const header = String(key).trim()
        if (!header) continue
        if (!seen.has(header)) {
          if (columns.length >= LIMITS.maxColumns) throw limitError(`A row has more than ${LIMITS.maxColumns} columns`)
          seen.add(header)
          columns.push(header)
        }
        if (value != null) checkCell(value)
        record[header] = value == null ? '' : String(value).trim()
      }
    }
    return record
  })
  return { columns, rows: nonEmpty(rows) }
}

// Returns { columns: [original headers], rows: [{ header: value }] }. Headers
// keep their original case so they read well as variable keys later. Detects
// XLSX by the ZIP magic, JSON by extension or a leading { / [, else CSV.
// The caller must already have bounded the file's size.
export async function parseContactFile(file) {
  const buffer = new Uint8Array(await file.arrayBuffer())
  const name = String(file.name || '').toLowerCase()

  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return matrixToTable(await parseXlsx(buffer))

  const text = new TextDecoder().decode(buffer).replace(/^\uFEFF/, '')
  const head = text.trimStart()[0]
  if (name.endsWith('.json') || head === '{' || head === '[') {
    try {
      return listToTable(parseJson(text))
    } catch (err) {
      if (name.endsWith('.json')) throw err
      // A CSV that merely starts with a brace: fall through to the CSV reader.
    }
  }

  return matrixToTable(parseCsv(text))
}
