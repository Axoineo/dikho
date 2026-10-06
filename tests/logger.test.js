import assert from 'node:assert/strict'
import { test } from 'node:test'
import { logError, logEvent, redact, scrubText } from '../src/api/utils/logger.js'

test('secrets are removed and personal fields masked by key, at any depth', () => {
  const out = redact({
    token: 'synthetic-token', Authorization: 'Bearer x', otp: '123456', ticket: 't',
    phone: '919800000001', wa_id: '919800000002', gstin: '27AAAPA1234A1Z5',
    email: 'person@example.invalid', name: 'Synthetic Person', body: 'hello there',
    nested: [{ from: '919800000003', text: 'private message' }],
    message: { text: 2, image: 1 },
    templateName: 'client_confirmation', status: 'delivered', count: 3,
  })
  assert.equal(out.token, '[REDACTED]')
  assert.equal(out.Authorization, '[REDACTED]')
  assert.equal(out.otp, '[REDACTED]')
  assert.equal(out.ticket, '[REDACTED]')
  assert.equal(out.phone, '[masked …0001]')
  assert.equal(out.wa_id, '[masked …0002]')
  assert.equal(out.gstin, '[masked …A1Z5]')
  assert.equal(out.email, '[redacted 22 chars]')
  assert.equal(out.name, '[redacted 16 chars]')
  assert.equal(out.body, '[redacted 11 chars]')
  assert.deepEqual(out.nested, [{ from: '[masked …0003]', text: '[redacted 15 chars]' }])
  // Counts keyed by message type survive; only strings are personal text.
  assert.deepEqual(out.message, { text: 2, image: 1 })
  assert.equal(out.templateName, 'client_confirmation')
  assert.equal(out.status, 'delivered')
  assert.equal(out.count, 3)
})

test('free text is scrubbed of emails, phone numbers, GSTINs and PANs', () => {
  const scrubbed = scrubText(
    'duplicate key (email)=(person@example.invalid) phone 919800000001 or +919800000002 ' +
    'gstin 27AAAPA1234A1Z5 pan AAAPA1234A at 2026-09-25 12:25:42 id 42',
  )
  assert.doesNotMatch(scrubbed, /person@example\.invalid|919800000001|919800000002|27AAAPA1234A1Z5|AAAPA1234A\b/)
  assert.match(scrubbed, /\[email\]/)
  assert.match(scrubbed, /\[masked …0001\]/)
  // Dates, times and small numbers stay readable.
  assert.match(scrubbed, /2026-09-25 12:25:42 id 42/)
})

test('logEvent and logError never print the raw values', (t) => {
  const lines = []
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')))
  t.mock.method(console, 'error', (...args) => lines.push(args.join(' ')))
  logEvent('synthetic.event', { phone: '919800000001', detail: 'mail person@example.invalid' })
  logError('synthetic.error', new Error('rejected 919800000001 for person@example.invalid'))
  const output = lines.join('\n')
  assert.doesNotMatch(output, /919800000001|person@example\.invalid/)
  assert.match(output, /synthetic\.event/)
  assert.match(output, /synthetic\.error/)
})
