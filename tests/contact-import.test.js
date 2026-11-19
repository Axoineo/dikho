import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectColumns, pickHeaderRow, readContactRow, readPhone, tidyName } from '../src/lib/contactImport.js'
import { parseContactFile } from '../src/lib/parseSheet.js'

// Contact sheets as people actually export them. Every number and name here is
// synthetic.

const csv = (text, name = 'contacts.csv') => ({ name, arrayBuffer: async () => new TextEncoder().encode(text).buffer })
const read = (text) => parseContactFile(csv(text), { pickHeader: pickHeaderRow })

test('Indian numbers in every common shape become one E.164 number', () => {
  for (const input of [
    '9876543210', '+91 98765 43210', '91-98765-43210', '919876543210', '09876543210', '0091 9876543210',
    '(+91) 98765-43210', "'9876543210", '9876543210.0', '9.87654321E+09', ' 98765 43210 ',
  ]) assert.deepEqual(readPhone(input), { phone: '919876543210' }, input)
})

test('a cell with two numbers gives the first usable one; foreign numbers keep their country', () => {
  assert.deepEqual(readPhone('98765 43210 / 91234 56789'), { phone: '919876543210' })
  assert.deepEqual(readPhone('12345, 9123456789'), { phone: '919123456789' })
  assert.deepEqual(readPhone('+1 415 555 2671'), { phone: '14155552671' })
  assert.deepEqual(readPhone('+971 50 123 4567'), { phone: '971501234567' })
})

test('numbers that cannot get WhatsApp are refused, with the reason', () => {
  assert.deepEqual(readPhone(''), { reason: 'empty' })
  assert.deepEqual(readPhone('   '), { reason: 'empty' })
  assert.deepEqual(readPhone('12345'), { reason: 'invalid' })
  assert.deepEqual(readPhone('5551234567'), { reason: 'invalid' }, 'Indian mobiles start 6 to 9')
  assert.deepEqual(readPhone('9999999999'), { reason: 'invalid' }, 'a placeholder')
  assert.deepEqual(readPhone('022 2345 6789'), { reason: 'landline' })
  assert.deepEqual(readPhone('9.19877E+11'), { reason: 'scientific' }, 'Excel rounded the digits away')
  assert.deepEqual(readPhone('Rahul'), { reason: 'invalid' })
  assert.deepEqual(readPhone('x'.repeat(200)), { reason: 'invalid' })
})

test('names in one case are tidied; mixed case is left as typed', () => {
  assert.equal(tidyName('RAHUL SHARMA'), 'Rahul Sharma')
  assert.equal(tidyName('  priya   nair '), 'Priya Nair')
  assert.equal(tidyName("JOHN D'SOUZA-KHAN"), "John D'Souza-Khan")
  assert.equal(tidyName('McDonald'), 'McDonald')
  assert.equal(tidyName('iPhone Ravi'), 'iPhone Ravi')
  assert.equal(tidyName('priya Khan'), 'Priya Khan')
  assert.equal(tidyName('R.K. SHARMA'), 'R.K. Sharma')
  assert.equal(tidyName(''), null)
})

const MESSY = [
  'Customer list November 2026,,,,,,,',
  'Exported by Sales,,,,,,,',
  'Sr No,Company Name,Customer Name,Mobile No,Alternate No,Email ID,City,Order ID',
  '1,Acme Traders,RAHUL SHARMA,98765 43210,,rahul@example.com,Pune,100000000001',
  '2,Blue Fern LLP,priya nair,,9123456789,priya@example.com,Delhi,100000000002',
  '3,Cedar Co,Amit Patel,022 2345 6789,,amit@example.com,Mumbai,100000000003',
  '4,Delta Inc,Sara Khan,9.19877E+11,,sara@example.com,Pune,100000000004',
  '5,Echo Ltd,Ravi Kumar,+91 99887 76655,,ravi@example.com,Goa,100000000005',
  '6,Fig Foods,Neha Joshi,9988776655,,neha@example.com,Pune,100000000006',
].join('\n')

test('title rows are skipped, and each column is recognised by its header and values', async () => {
  const table = await read(MESSY)
  assert.equal(table.headerless, false)
  assert.equal(table.rows.length, 6)
  const found = detectColumns(table.columns, table.rows)
  assert.deepEqual(found.phoneColumns, ['Mobile No', 'Alternate No'], 'the order ID is not a phone column')
  assert.equal(found.nameColumn, 'Customer Name', 'not Company Name')
  assert.equal(found.companyColumn, 'Company Name')
  assert.equal(found.emailColumn, 'Email ID')

  const rows = table.rows.map((row) => readContactRow(row, table.columns, found))
  assert.deepEqual(rows[0], { phone: '919876543210', name: 'Rahul Sharma', email: 'rahul@example.com', company: 'Acme Traders' })
  assert.equal(rows[1].phone, '919123456789', 'a blank main number falls back to the alternate')
  assert.equal(rows[1].name, 'Priya Nair')
  assert.deepEqual(rows[2], { reason: 'landline' })
  assert.deepEqual(rows[3], { reason: 'scientific' })
  assert.equal(rows[4].phone, '919988776655')
})

test('a WhatsApp column beats a Mobile column, and first and last names are joined', async () => {
  const table = await read('First Name,Last Name,Mobile,WhatsApp Number\nasha,verma,9876543210,9123456780\nRavi,Kumar,9988776655,9988776650')
  const found = detectColumns(table.columns, table.rows)
  assert.deepEqual(found.phoneColumns, ['WhatsApp Number', 'Mobile'])
  assert.equal(found.nameColumn, null)
  assert.equal(found.firstNameColumn, 'First Name')
  assert.equal(found.lastNameColumn, 'Last Name')
  assert.deepEqual(readContactRow(table.rows[0], table.columns, found), { phone: '919123456780', name: 'Asha Verma', email: null, company: null })
})

test('a sheet with no header row keeps its first contact and finds the name by its values', async () => {
  const table = await read('Rahul Sharma,9876543210,Pune\nPriya Nair,9123456789,Delhi\nAmit Patel,9988776655,Goa')
  assert.equal(table.headerless, true)
  assert.equal(table.rows.length, 3, 'the first row is a contact, not headers')
  assert.deepEqual(table.columns, ['Column A', 'Column B', 'Column C'])
  const found = detectColumns(table.columns, table.rows, { headerless: true })
  assert.deepEqual(found.phoneColumns, ['Column B'])
  assert.equal(found.nameColumn, 'Column A')
})

test('a contact with a blank phone just under the headers is not taken for the header row', async () => {
  const table = await read('Name,Phone,City\nNo Number Person,,Pune\nRahul Sharma,9876543210,Pune')
  assert.deepEqual(table.columns, ['Name', 'Phone', 'City'])
  assert.equal(table.rows.length, 2)
})

test('blank and repeated headers keep their columns instead of dropping or overwriting them', async () => {
  const table = await read('Name,Phone,,Name\nRahul,9876543210,VIP,R. Sharma')
  assert.deepEqual(table.columns, ['Name', 'Phone', 'Column C', 'Name 2'])
  assert.deepEqual(table.rows[0], { Name: 'Rahul', Phone: '9876543210', 'Column C': 'VIP', 'Name 2': 'R. Sharma' })
})

test('header words that only contain "name" do not make a column the contact name', async () => {
  const table = await read('File Name,Agent Name,Party Name,Phone\na.pdf,Staff One,Kiran Rao,9876543210\nb.pdf,Staff Two,Meera Das,9123456789')
  assert.equal(detectColumns(table.columns, table.rows).nameColumn, 'Party Name')
})
