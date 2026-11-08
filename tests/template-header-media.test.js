import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import campaigns from '../src/api/routes/campaigns/index.js'
import { errorHandler } from '../src/api/middleware/errorHandler.js'
import {
  HEADER_MEDIA_KEY, buildComponents, mediaHeaderFormat, parseHeaderMedia, templateTokens,
} from '../src/lib/templateVars.js'

// A template with a video header and a named body variable, like the one Meta
// refused with 132012 when the send carried only the body. Synthetic data only.
const VIDEO_LINK = 'https://media.example.invalid/launch.mp4'
const TEMPLATE = {
  name: '12457896',
  language: 'en',
  headerFormat: 'VIDEO',
  headerText: '',
  bodyText: 'Hello {{name}}, here is our new launch.',
  footerText: 'Dikho Global Media',
  buttons: [],
}
const map = (extra = {}) => ({ name: { source: 'field', key: 'name' }, ...extra })
const media = (value) => ({ [HEADER_MEDIA_KEY]: { source: 'media', value } })

// ── The shared builder ─────────────────────────────────────────────────────

test('a video header and a named body variable become exactly two components', () => {
  const components = buildComponents(TEMPLATE, map(media(VIDEO_LINK)), { name: 'Asha' })
  assert.deepEqual(components, [
    { type: 'header', parameters: [{ type: 'video', video: { link: VIDEO_LINK } }] },
    { type: 'body', parameters: [{ type: 'text', text: 'Asha', parameter_name: 'name' }] },
  ])
})

test('a media ID is sent as an id, and photo and document headers use their own type', () => {
  assert.deepEqual(buildComponents(TEMPLATE, map(media('1234567890')), { name: 'Asha' })[0],
    { type: 'header', parameters: [{ type: 'video', video: { id: '1234567890' } }] })
  assert.deepEqual(buildComponents({ ...TEMPLATE, headerFormat: 'IMAGE' }, map(media(VIDEO_LINK)), { name: 'A' })[0],
    { type: 'header', parameters: [{ type: 'image', image: { link: VIDEO_LINK } }] })
  assert.deepEqual(buildComponents({ ...TEMPLATE, headerFormat: 'DOCUMENT' }, map(media('42')), { name: 'A' })[0],
    { type: 'header', parameters: [{ type: 'document', document: { id: '42' } }] })
})

test('the parameter count follows the template: one per distinct variable, none for a footer', () => {
  const twice = { ...TEMPLATE, bodyText: 'Hi {{name}}. Yes, {{name}}, you.' }
  const [header, body] = buildComponents(twice, map(media(VIDEO_LINK)), { name: 'Asha' })
  assert.equal(header.parameters.length, 1)
  assert.equal(body.parameters.length, 1)
  assert.deepEqual(templateTokens(twice), ['name'], 'a media header adds no text variable')

  const positional = { headerFormat: 'TEXT', headerText: '', bodyText: 'Dear {{2}}, from {{1}}' }
  const values = { 1: { source: 'literal', value: 'Dikho' }, 2: { source: 'literal', value: 'Asha' } }
  assert.deepEqual(buildComponents(positional, values, {}), [
    { type: 'body', parameters: [{ type: 'text', text: 'Dikho' }, { type: 'text', text: 'Asha' }] },
  ], 'positional variables stay ordered and carry no parameter_name')
})

test('a video template without a file gets no header, so callers must check first', () => {
  assert.deepEqual(buildComponents(TEMPLATE, map(), { name: 'Asha' }).map((c) => c.type), ['body'])
  assert.deepEqual(buildComponents(TEMPLATE, map({ [HEADER_MEDIA_KEY]: { source: 'literal', value: VIDEO_LINK } }), { name: 'A' })
    .map((c) => c.type), ['body'], 'only a media entry counts')
})

test('a text header with variables is unchanged', () => {
  const text = { headerFormat: 'TEXT', headerText: 'Hi {{name}}', bodyText: 'Body' }
  assert.deepEqual(buildComponents(text, map(), { name: 'Asha' }), [
    { type: 'header', parameters: [{ type: 'text', text: 'Asha', parameter_name: 'name' }] },
  ])
  assert.equal(mediaHeaderFormat(text), null)
  assert.equal(mediaHeaderFormat({ headerFormat: 'LOCATION' }), null)
  assert.equal(mediaHeaderFormat({ headerFormat: 'video' }), 'VIDEO')
})

test('only https links and digit-only media IDs are accepted as a header file', () => {
  assert.deepEqual(parseHeaderMedia(`  ${VIDEO_LINK}  `), { link: VIDEO_LINK })
  assert.deepEqual(parseHeaderMedia('987654321'), { id: '987654321' })
  for (const bad of [
    '', '   ', null, undefined, 'http://media.example.invalid/a.mp4', 'javascript:alert(1)',
    'ftp://media.example.invalid/a.mp4', 'https://user:pass@media.example.invalid/a.mp4',
    `https://media.example.invalid/${'a'.repeat(2050)}`, 'not a link', '12 34', '1'.repeat(33),
  ]) assert.equal(parseHeaderMedia(bad), null, String(bad))
})

// ── The campaign routes ────────────────────────────────────────────────────

const SENDER = { id: 'u-sender', permissions: { 'campaigns.send': 'all' } }
const CONTACTS = [{ id: 1, phone: '919800000001', name: 'Asha' }, { id: 2, phone: '919800000002', name: 'Ravi' }]

let queries
let first
let sends
let stored

function fakeDb() {
  const answer = (sql, args) => {
    queries.push({ sql, args })
    return {
      first: async () => {
        const hit = first.find(([match]) => match.test(sql))?.[1]
        return typeof hit === 'function' ? hit(args) : hit ?? null
      },
      all: async () => {
        if (/FROM contacts/.test(sql)) return { results: CONTACTS }
        if (/RETURNING contact_id/.test(sql)) return { results: [{ contact_id: args[1] }] }
        if (/status = 'failed'/.test(sql)) return { results: [] }
        return { results: [] }
      },
      run: async () => ({ meta: { changes: 1 } }),
    }
  }
  return {
    prepare: (sql) => ({ bind: (...args) => answer(sql, args), first: () => answer(sql, []).first(), all: () => answer(sql, []).all(), run: () => answer(sql, []).run() }),
    batch: async (statements) => Promise.all(statements.map((s) => s.all())),
  }
}

function request(path, body) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => { c.set('user', SENDER); await next() })
  app.route('/campaigns', campaigns)
  return app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, {
    DB: fakeDb(), WHATSAPP_ACCESS_TOKEN: 'synthetic', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_WABA_ID: '2',
  }, { waitUntil() {}, passThroughOnException() {} })
}

// What the wizard sends for TEMPLATE.
function wizardPayload(headerFile) {
  return {
    name: 'Launch',
    contactIds: [1, 2],
    templateName: TEMPLATE.name,
    templateLanguage: TEMPLATE.language,
    templateHeader: '',
    templateHeaderFormat: 'VIDEO',
    templateBody: TEMPLATE.bodyText,
    variableMap: headerFile === undefined ? map() : map(media(headerFile)),
  }
}

beforeEach((t) => {
  queries = []
  sends = []
  stored = null
  first = [
    [/INSERT INTO campaigns/, (args) => { stored = args; return { id: 7 } }],
    [/SUM\(CASE/, { sent: 2, failed: 0 }],
  ]
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url).includes('message_templates')) {
      return Response.json({
        data: [{
          name: TEMPLATE.name, language: 'en', status: 'APPROVED', category: 'MARKETING',
          components: [
            { type: 'HEADER', format: 'VIDEO' },
            { type: 'BODY', text: TEMPLATE.bodyText },
            { type: 'FOOTER', text: TEMPLATE.footerText },
          ],
        }],
      })
    }
    sends.push(JSON.parse(init.body ?? '{}'))
    return Response.json({ messages: [{ id: `wamid.${sends.length}` }] })
  })
})

test('a campaign send carries the video header and the named body parameter', async () => {
  const res = await request('/campaigns/send', wizardPayload(VIDEO_LINK))
  assert.equal(res.status, 200)
  assert.equal(sends.length, 2)
  const [asha] = sends
  assert.equal(asha.template.name, '12457896')
  assert.deepEqual(asha.template.components, [
    { type: 'header', parameters: [{ type: 'video', video: { link: VIDEO_LINK } }] },
    { type: 'body', parameters: [{ type: 'text', text: 'Asha', parameter_name: 'name' }] },
  ])
  assert.equal(sends[1].template.components[1].parameters[0].text, 'Ravi')

  const variables = JSON.parse(stored[5])
  assert.deepEqual(variables[HEADER_MEDIA_KEY], { source: 'media', value: VIDEO_LINK }, 'kept for a retry')
})

test('a video template with no file, or a bad one, is refused before anything is stored or sent', async () => {
  for (const headerFile of [undefined, '', 'http://media.example.invalid/a.mp4', 'javascript:alert(1)']) {
    queries = []
    const res = await request('/campaigns/send', wizardPayload(headerFile))
    assert.equal(res.status, 400, String(headerFile))
    assert.match((await res.json()).error.message, /video header/)
    assert.equal(sends.length, 0)
    assert.ok(!queries.some((q) => /INSERT/.test(q.sql)), 'no campaign row or claim')
  }
})

test('a text-header campaign is unaffected by a stray header entry, which is not stored', async () => {
  const res = await request('/campaigns/send', {
    ...wizardPayload(VIDEO_LINK), templateHeaderFormat: 'TEXT', templateBody: 'Hi {{name}}',
  })
  assert.equal(res.status, 200)
  assert.deepEqual(sends[0].template.components.map((c) => c.type), ['body'])
  assert.equal(JSON.parse(stored[5])[HEADER_MEDIA_KEY], undefined)
})

test('a later batch sends the header too', async () => {
  const { templateName, templateLanguage, templateHeader, templateHeaderFormat, templateBody, variableMap } = wizardPayload('5551234')
  const res = await request('/campaigns/send-batch', { campaignId: 7, contactIds: [1, 2], templateName, templateLanguage, templateHeader, templateHeaderFormat, templateBody, variableMap })
  assert.equal(res.status, 200)
  assert.deepEqual(sends[0].template.components[0], { type: 'header', parameters: [{ type: 'video', video: { id: '5551234' } }] })
})

test('a retry reads the header from Meta and the file from the campaign', async () => {
  first.unshift([/FROM campaigns WHERE id = \?/, {
    id: 7, template_name: TEMPLATE.name, template_language: 'en', total_count: 2, audience: '[1,2]',
    variables: JSON.stringify(map(media(VIDEO_LINK))),
  }])
  const res = await request('/campaigns/7/retry', { contactIds: [1, 2] })
  assert.equal(res.status, 200)
  assert.equal(sends.length, 2)
  assert.deepEqual(sends[0].template.components[0], { type: 'header', parameters: [{ type: 'video', video: { link: VIDEO_LINK } }] })
})

test('a retry of a campaign saved without its file is refused, with nothing claimed or sent', async () => {
  first.unshift([/FROM campaigns WHERE id = \?/, {
    id: 7, template_name: TEMPLATE.name, template_language: 'en', total_count: 2, audience: '[1,2]',
    variables: JSON.stringify(map()),
  }])
  const res = await request('/campaigns/7/retry', { contactIds: [1, 2] })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error.message, /cannot be retried/)
  assert.equal(sends.length, 0)
  assert.ok(!queries.some((q) => /RETURNING contact_id/.test(q.sql)))
})
