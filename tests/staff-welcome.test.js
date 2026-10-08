import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { sendWelcome, welcomeChannelFor } from '../src/api/services/staffWelcome.js'

// The WhatsApp welcome reads the approved template's shape from Meta before
// sending, so its parameters always match. Every outbound request is answered
// by a fake. Synthetic data only.
const env = {
  WHATSAPP_ACCESS_TOKEN: 'synthetic-token',
  WHATSAPP_PHONE_NUMBER_ID: '100',
  WHATSAPP_WABA_ID: '200',
  WHATSAPP_STAFF_WELCOME_TEMPLATE_NAME: 'staff_welcome_synthetic',
  WHATSAPP_STAFF_WELCOME_TEMPLATE_LANG: 'en',
}
const person = { phone: '910000000001', fullName: 'Asha  Example (synthetic)' }

let sends
let templates
let sendReply
beforeEach((t) => {
  sends = []
  templates = async () => Response.json({ data: [] })
  sendReply = async () => Response.json({ messages: [{ id: 'wamid.synthetic' }] })
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).includes('/message_templates')) return templates()
    if (String(url).endsWith('/messages')) {
      sends.push(JSON.parse(options.body))
      return sendReply()
    }
    throw new Error(`unexpected request ${url}`)
  })
})

const approved = (body, { language = 'en', buttons } = {}) => ({
  name: 'staff_welcome_synthetic', language, status: 'APPROVED', category: 'UTILITY',
  components: [{ type: 'BODY', text: body }, ...(buttons ? [{ type: 'BUTTONS', buttons }] : [])],
})

test('WhatsApp is used when it is configured and email is not', () => {
  assert.equal(welcomeChannelFor(env, { email: 'someone@example.invalid', phone: person.phone }), 'whatsapp')
  assert.equal(welcomeChannelFor({ ...env, WHATSAPP_STAFF_WELCOME_TEMPLATE_NAME: '' }, { phone: person.phone }), null)
})

test('the first name fills the one variable, in the template\'s own language', async () => {
  templates = async () => Response.json({ data: [approved('Hi {{1}}, you have been added to Dikho CRM.', { language: 'en_US' })] })
  assert.deepEqual(await sendWelcome(env, 'whatsapp', person), { ok: true })
  assert.equal(sends.length, 1)
  assert.equal(sends[0].to, person.phone)
  assert.equal(sends[0].template.name, 'staff_welcome_synthetic')
  assert.equal(sends[0].template.language.code, 'en_US')
  assert.deepEqual(sends[0].template.components, [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }] }])
})

test('a named variable is filled by name', async () => {
  templates = async () => Response.json({ data: [approved('Hi {{first_name}}, welcome.')] })
  await sendWelcome(env, 'whatsapp', person)
  assert.deepEqual(sends[0].template.components, [{ type: 'body', parameters: [{ type: 'text', text: 'Asha', parameter_name: 'first_name' }] }])
})

test('a template without variables is sent without parameters', async () => {
  templates = async () => Response.json({ data: [approved('You have been added to Dikho CRM.')] })
  await sendWelcome(env, 'whatsapp', person)
  assert.equal('components' in sends[0].template, false)
})

test('nothing is sent when the template is not approved or needs more than the first name', async () => {
  templates = async () => Response.json({ data: [] })
  assert.equal((await sendWelcome(env, 'whatsapp', person)).ok, false)
  templates = async () => Response.json({ data: [approved('Hi {{1}}, your role is {{2}}.')] })
  assert.equal((await sendWelcome(env, 'whatsapp', person)).ok, false)
  templates = async () => Response.json({ data: [approved('Hi {{1}}.', { buttons: [{ type: 'URL', text: 'Open', url: 'https://example.invalid/{{1}}' }] })] })
  assert.equal((await sendWelcome(env, 'whatsapp', person)).ok, false)
  assert.equal(sends.length, 0)
})

test('when Meta\'s template list cannot be read, the documented one-variable shape is sent', async () => {
  templates = async () => new Response('{"error":{"code":2}}', { status: 500 })
  assert.equal((await sendWelcome(env, 'whatsapp', person)).ok, true)
  assert.equal(sends[0].template.language.code, 'en')
  assert.deepEqual(sends[0].template.components, [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }] }])
})

test('a refused send reports Meta\'s error code and nothing else', async () => {
  templates = async () => Response.json({ data: [approved('Hi {{1}}.')] })
  sendReply = async () => Response.json({ error: { code: 131026, message: 'Message undeliverable' } }, { status: 400 })
  assert.deepEqual(await sendWelcome(env, 'whatsapp', person), { ok: false, reason: 'WhatsApp error 131026' })
})
