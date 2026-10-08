import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  InputError, buildContact, buildInteractive, buildLocation, formatAddress, parseInbound, serializePayload,
} from '../src/api/services/whatsapp/richContent.js'

test('inbound location, contacts and orders keep named fields only, capped', () => {
  const loc = parseInbound({ type: 'location', location: { latitude: 12.97, longitude: 77.59, name: 'Office', address: 'MG Road', url: 'javascript:alert(1)', extra: 'x' } })
  assert.equal(loc.body, '📍 Office')
  assert.deepEqual(loc.payload, { kind: 'location', latitude: 12.97, longitude: 77.59, name: 'Office', address: 'MG Road' })

  const contacts = parseInbound({ type: 'contacts', contacts: [{ name: { formatted_name: 'Asha Rao' }, phones: [{ phone: '+91 98000 00001', wa_id: '919800000001', type: 'CELL' }], emails: [{ email: 'a@example.com' }], org: { company: 'Acme' }, urls: ['https://x'] }] })
  assert.equal(contacts.body, '👤 Asha Rao')
  assert.deepEqual(contacts.payload.contacts[0], { name: 'Asha Rao', org: 'Acme', phones: [{ phone: '+91 98000 00001', wa_id: '919800000001', type: 'CELL' }], emails: ['a@example.com'] })

  const order = parseInbound({ type: 'order', order: { catalog_id: 'c1', product_items: [{ product_retailer_id: 'sku', quantity: 2, item_price: 99.5, currency: 'INR' }] } })
  assert.equal(order.body, '🛒 Order: 1 item')
  assert.equal(order.payload.items[0].quantity, 2)

  const huge = parseInbound({ type: 'location', location: { latitude: 1, longitude: 1, name: 'x'.repeat(5000) } })
  assert.equal(huge.payload.name.length, 200)
  assert.equal(parseInbound({ type: 'location', location: { latitude: 999, longitude: 1 } }).payload.latitude, undefined)
})

test('inbound choices, address replies, system notices, referrals and forwards', () => {
  const choice = parseInbound({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'row_2', title: 'Hoardings', description: 'Outdoor' } } })
  assert.equal(choice.body, 'Hoardings')
  assert.deepEqual(choice.payload, { kind: 'choice', reply: { id: 'row_2', title: 'Hoardings', description: 'Outdoor' } })

  const address = parseInbound({ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { name: 'address_message', response_json: JSON.stringify({ values: { name: 'Asha', building_name: 'Tower 2', city: 'Pune', in_pin_code: '411001', nested: { a: 1 } } }) } } })
  assert.equal(address.body, '📍 Address: Asha, Tower 2, Pune, 411001')
  assert.deepEqual(address.payload.values, { name: 'Asha', building_name: 'Tower 2', city: 'Pune', in_pin_code: '411001' })
  assert.equal(parseInbound({ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', response_json: 'not json' } } }).payload.values, undefined)

  const system = parseInbound({ type: 'system', system: { body: 'Customer changed their number', type: 'user_changed_number' } })
  assert.equal(system.type, 'system')
  assert.equal(system.payload.system_type, 'user_changed_number')

  const fromAd = parseInbound({ type: 'text', text: { body: 'Hi' }, referral: { source_url: 'https://fb.me/ad', source_type: 'ad', headline: 'Diwali offer', ctwa_clid: 'tracking', image_url: 'https://cdn/x.jpg' } })
  assert.deepEqual(fromAd.payload, { kind: 'text', referral: { source_type: 'ad', source_url: 'https://fb.me/ad', headline: 'Diwali offer' } })

  assert.equal(parseInbound({ type: 'text', text: { body: 'fwd' }, context: { forwarded: true } }).payload.forwarded, 'once')
  assert.equal(parseInbound({ type: 'text', text: { body: 'fwd' }, context: { frequently_forwarded: true } }).payload.forwarded, 'many')
  assert.equal(parseInbound({ type: 'text', text: { body: 'plain' } }).payload, null)
  assert.deepEqual(parseInbound({ type: 'audio', audio: { id: 'm', voice: true } }).payload, { kind: 'voice' })
  assert.equal(parseInbound({ type: 'mystery' }).body, '[mystery]')
})

test('outbound builders follow Meta limits and say what to fix', () => {
  assert.deepEqual(buildLocation({ latitude: '18.52', longitude: 73.85, name: 'Office' }).message, { type: 'location', location: { latitude: 18.52, longitude: 73.85, name: 'Office' } })
  assert.throws(() => buildLocation({ latitude: 91, longitude: 0 }), InputError)

  const contact = buildContact({ name: 'Ravi Kumar', phone: '+91 98000 00002', email: 'ravi@example.com', company: 'Dikho' })
  assert.deepEqual(contact.message.contacts[0].name, { formatted_name: 'Ravi Kumar', first_name: 'Ravi' })
  assert.throws(() => buildContact({ name: 'X', phone: 'call me' }), /valid phone/)
  assert.throws(() => buildContact({ name: 'X', phone: '9800000000', email: 'nope' }), /valid email/)

  const buttons = buildInteractive({ kind: 'buttons', body: 'Pick one', buttons: ['Yes', 'No', ''] })
  assert.deepEqual(buttons.message.interactive.action.buttons.map((b) => b.reply), [{ id: 'btn_1', title: 'Yes' }, { id: 'btn_2', title: 'No' }])
  assert.throws(() => buildInteractive({ kind: 'buttons', body: 'x', buttons: ['a', 'b', 'c', 'd'] }), /one to three/)
  assert.throws(() => buildInteractive({ kind: 'buttons', body: 'x', buttons: ['a'.repeat(21)] }), /20 characters/)
  assert.throws(() => buildInteractive({ kind: 'buttons', body: 'x', buttons: ['Yes', 'yes'] }), /different label/)

  const list = buildInteractive({ kind: 'list', body: 'Services', button: 'Choose', sections: [{ rows: [{ title: 'Hoardings', description: 'Outdoor' }, { title: 'Radio' }] }] })
  assert.deepEqual(list.message.interactive.action.sections[0].rows.map((r) => r.id), ['row_1', 'row_2'])
  assert.throws(() => buildInteractive({ kind: 'list', body: 'x', button: 'Go', sections: [{ rows: Array.from({ length: 11 }, (_, i) => ({ title: `r${i}` })) }] }), /one to ten/)
  assert.throws(() => buildInteractive({ kind: 'list', body: 'x', button: 'Go', sections: [{ rows: [{ title: 'a' }] }, { rows: [{ title: 'b' }] }] }), /section needs a title/)

  const link = buildInteractive({ kind: 'cta_url', body: 'See the rate card', label: 'Open', url: 'https://dikho.in/rates' })
  assert.deepEqual(link.message.interactive.action, { name: 'cta_url', parameters: { display_text: 'Open', url: 'https://dikho.in/rates' } })
  assert.throws(() => buildInteractive({ kind: 'cta_url', body: 'x', label: 'Go', url: 'http://dikho.in' }), /https/)
  assert.throws(() => buildInteractive({ kind: 'cta_url', body: 'x', label: 'Go', url: 'javascript:alert(1)' }), /https/)

  assert.deepEqual(buildInteractive({ kind: 'location_request', body: 'Share your location' }).message.interactive.action, { name: 'send_location' })
  assert.deepEqual(buildInteractive({ kind: 'address', body: 'Where should we deliver?' }).message.interactive.action, { name: 'address_message', parameters: { country: 'IN' } })
  assert.throws(() => buildInteractive({ kind: 'flow', body: 'x' }), /Unknown/)
  assert.throws(() => buildInteractive({ kind: 'buttons', body: '', buttons: ['a'] }), /Message is required/)
})

test('payloads stay small and address lines read in order', () => {
  assert.equal(serializePayload(null), null)
  assert.equal(JSON.parse(serializePayload({ kind: 'x', big: 'y'.repeat(9000) })).truncated, true)
  assert.equal(formatAddress({ city: 'Pune', name: 'Asha', in_pin_code: '411001' }), 'Asha, Pune, 411001')
})
