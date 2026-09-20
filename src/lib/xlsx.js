// Minimal .xlsx writer — no dependencies.
//
// An .xlsx file is a ZIP archive of OOXML parts. Entries are stored
// uncompressed (method 0), which keeps the archive valid without needing a
// deflate implementation. Excel, LibreOffice and Google Sheets all open it.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[i] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value) { return [value & 0xff, (value >>> 8) & 0xff] }
function u32(value) { return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff] }

function dosTimestamp(date) {
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f),
    date: (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f),
  }
}

function buildZip(entries) {
  const encoder = new TextEncoder()
  const stamp = dosTimestamp(new Date())
  const localParts = []
  const centralParts = []
  let offset = 0

  entries.forEach((entry) => {
    const name = encoder.encode(entry.name)
    const data = entry.data
    const crc = crc32(data)

    // Flag bit 11 marks the file name as UTF-8.
    const localHeader = Uint8Array.from([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(stamp.time), ...u16(stamp.date),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0),
    ])
    localParts.push(localHeader, name, data)

    centralParts.push(Uint8Array.from([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(stamp.time), ...u16(stamp.date),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
      ...name,
    ]))

    offset += localHeader.length + name.length + data.length
  })

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const endRecord = Uint8Array.from([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ])

  return new Blob([...localParts, ...centralParts, endRecord], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function escapeXml(value) {
  return stripControlChars(String(value))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// XML 1.0 allows tab, LF and CR but no other C0 control characters; Excel
// rejects the whole workbook if any slip through.
function stripControlChars(text) {
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code > 31 || code === 9 || code === 10 || code === 13) out += text[index]
  }
  return out
}

function columnLetter(index) {
  let letters = ''
  let remaining = index + 1
  while (remaining > 0) {
    const position = (remaining - 1) % 26
    letters = String.fromCharCode(65 + position) + letters
    remaining = Math.floor((remaining - 1) / 26)
  }
  return letters
}

function cellXml(reference, value, styleIndex) {
  if (value == null || value === '') return ''
  const style = styleIndex ? ` s="${styleIndex}"` : ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"${style}><v>${value}</v></c>`
  }
  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

function rowXml(values, rowNumber, styleIndex) {
  const cells = values.map((value, column) => cellXml(`${columnLetter(column)}${rowNumber}`, value, styleIndex)).join('')
  return `<row r="${rowNumber}">${cells}</row>`
}

function columnWidths(headers, rows) {
  return headers.map((header, index) => {
    let widest = String(header ?? '').length
    rows.forEach((row) => {
      const length = String(row[index] ?? '').length
      if (length > widest) widest = length
    })
    return Math.min(52, Math.max(10, widest + 3))
  })
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

// Style 1 = bold white text on Dikho brand blue, used for the header row.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2D63A0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

/**
 * Build an .xlsx Blob from a header row and an array of value rows.
 * Finite numbers are written as numeric cells; everything else as text, so
 * long identifiers (GSTIN, account numbers) are never reformatted by Excel.
 */
export function buildXlsxBlob({ sheetName = 'Sheet1', headers = [], rows = [] }) {
  const widths = columnWidths(headers, rows)
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')
  const body = rows.map((row, index) => rowXml(row, index + 2)).join('')
  const lastColumn = columnLetter(Math.max(0, headers.length - 1))
  const lastRow = rows.length + 1

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rowXml(headers, 1, 1)}${body}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`

  const encoder = new TextEncoder()
  return buildZip([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(WORKBOOK_RELS) },
    { name: 'xl/styles.xml', data: encoder.encode(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheet) },
  ])
}

/** Build the workbook and trigger a browser download. */
export function downloadXlsx(fileName, workbook) {
  const url = URL.createObjectURL(buildXlsxBlob(workbook))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
