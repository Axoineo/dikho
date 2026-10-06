import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { test } from 'node:test'
import { LIMITS, parseContactFile, parseCsv, parseXlsx } from '../src/api/utils/parseSheet.js'

// Builds a ZIP in memory. CRCs are left at zero: the parser never checks them,
// and the tests are about structure and sizes. `flags` lets a test mark an
// entry as encrypted.
function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data, store = false, flags = 0 } of entries) {
    const nameBytes = Buffer.from(name)
    const payload = store ? Buffer.from(data) : deflateRawSync(Buffer.from(data))
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(store ? 0 : 8, 8)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(Buffer.byteLength(data), 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(store ? 0 : 8, 10)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(Buffer.byteLength(data), 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, payload)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + payload.length
  }
  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, centralBytes, eocd]))
}

const sheet = (rowsXml) => `<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`
const file = (bytes, name) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })

test('a normal workbook with shared strings parses into header and rows', async () => {
  const bytes = zip([
    { name: 'xl/sharedStrings.xml', data: '<sst><si><t>Name</t></si><si><t>Phone</t></si><si><t>Synthetic Person</t></si></sst>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet('<row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="B2"><v>919800000001</v></c></row>') },
  ])
  const table = await parseContactFile(file(bytes, 'contacts.xlsx'))
  assert.deepEqual(table.columns, ['Name', 'Phone'])
  assert.deepEqual(table.rows, [{ Name: 'Synthetic Person', Phone: '919800000001' }])
})

test('a small archive that inflates past the limit is refused, not expanded', async () => {
  // ~17 MB of zeros deflates to a few KB: a classic decompression bomb.
  const bomb = '0'.repeat(LIMITS.maxInflatedEntryBytes + 1024)
  const bytes = zip([{ name: 'xl/worksheets/sheet1.xml', data: bomb }])
  assert.ok(bytes.length < 100_000)
  await assert.rejects(parseXlsx(bytes), /expands to more data/)
})

test('entries the import never reads are not inflated at all', async () => {
  const bomb = '0'.repeat(LIMITS.maxInflatedEntryBytes + 1024)
  const bytes = zip([
    { name: 'xl/media/huge.bin', data: bomb },
    { name: 'xl/worksheets/sheet1.xml', data: sheet('<row><c r="A1" t="inlineStr"><is><t>Phone</t></is></c></row><row><c r="A2"><v>919800000001</v></c></row>') },
  ])
  const rows = await parseXlsx(bytes)
  assert.equal(rows.length, 2)
})

test('too many archive entries, encrypted entries and broken offsets are refused', async () => {
  const many = Array.from({ length: LIMITS.maxZipEntries + 1 }, (_, i) => ({ name: `x/${i}.xml`, data: 'x', store: true }))
  await assert.rejects(parseXlsx(zip(many)), /too many internal files/)

  const encrypted = zip([{ name: 'xl/worksheets/sheet1.xml', data: sheet(''), flags: 1 }])
  await assert.rejects(parseXlsx(encrypted), /Encrypted/)

  const broken = zip([{ name: 'xl/worksheets/sheet1.xml', data: sheet('') }])
  // Point the entry's local-header offset far outside the file.
  const view = new DataView(broken.buffer)
  const centralStart = view.getUint32(broken.length - 22 + 16, true)
  view.setUint32(centralStart + 42, 0x7fffffff, true)
  await assert.rejects(parseXlsx(broken), /Not a valid .xlsx file/)

  await assert.rejects(parseXlsx(new Uint8Array([0x50, 0x4b, 1, 2])), /Not a valid .xlsx file/)
})

test('a far-right cell reference cannot allocate a huge row', async () => {
  const bytes = zip([{ name: 'xl/worksheets/sheet1.xml', data: sheet('<row><c r="XFD1" t="inlineStr"><is><t>x</t></is></c></row>') }])
  await assert.rejects(parseXlsx(bytes), /more than 200 columns/)
})

test('CSV rows, columns and cell lengths are bounded', async () => {
  assert.throws(() => parseCsv(','.repeat(LIMITS.maxColumns)), /more than 200 columns/)
  assert.throws(() => parseCsv('a\n'.repeat(LIMITS.maxRows + 1)), /more than 50000 rows/)

  const longCell = `name,phone\n${'x'.repeat(LIMITS.maxCellChars + 1)},919800000001\n`
  const bytes = new TextEncoder().encode(longCell)
  await assert.rejects(parseContactFile(file(bytes, 'c.csv')), /longer than 2000 characters/)

  const fine = new TextEncoder().encode('name,phone\nSynthetic Person,919800000001\n')
  assert.equal((await parseContactFile(file(fine, 'c.csv'))).rows.length, 1)
})

test('JSON imports are held to the same column and cell limits', async () => {
  const wide = JSON.stringify([Object.fromEntries(Array.from({ length: LIMITS.maxColumns + 1 }, (_, i) => [`c${i}`, 'v']))])
  await assert.rejects(parseContactFile(file(new TextEncoder().encode(wide), 'c.json')), /more than 200 columns/)
  const long = JSON.stringify([{ phone: '919800000001', note: 'x'.repeat(LIMITS.maxCellChars + 1) }])
  await assert.rejects(parseContactFile(file(new TextEncoder().encode(long), 'c.json')), /longer than 2000/)
})
