import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sanitizeHtml, htmlToText, decodeEntities } from '../src/api/services/email/sanitizeHtml.js'
import {
  parseAddressList, parseRecipientInput, readMessage, summarizeThread, buildMessage, prefixedSubject, decodeWords,
} from '../src/api/services/email/mime.js'
import { base64url, encryptToken, decryptToken, pkceChallenge, safeEqual } from '../src/api/services/email/crypto.js'

// Email content handling: everything here is driven by untrusted mail.
// Synthetic data only.

const clean = (html, opts) => sanitizeHtml(html, opts).html

test('script, handlers and dangerous containers never survive', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<SCRIPT SRC=//x.example/a.js></SCRIPT>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<a href="jav&#x61;script:alert(1)">x</a>',
    '<a href="jav&#09;ascript:alert(1)">x</a>',
    '<a href=" javascript:alert(1)">x</a>',
    '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<svg onload=alert(1)><script>alert(1)</script></svg>',
    '<iframe src="https://evil.example"></iframe>',
    '<object data="x"></object><embed src="x">',
    '<form action="https://evil.example"><input name=p></form>',
    '<div style="background:url(javascript:alert(1))">x</div>',
    '<div style="width:expression(alert(1))">x</div>',
    '<style>@import url(https://evil.example/x.css); body{background:url(https://t.example/p.gif)}</style>',
    '<style></style><script>alert(1)</script>',
    '<style>p{color:red}</style ><img src=x onerror=alert(1)>',
    '<p title="x" onclick="alert(1)">x</p>',
    '<p title=\'a"><script>alert(1)</script>\'>x</p>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<base href="javascript:alert(1)//">',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    '<<script>script>alert(1)<</script>/script>',
    '<img/src="x"/onerror=alert(1)>',
    '<a href="#" style="position:fixed;top:0" onmouseover=alert(1)>x</a>',
    '<!--><script>alert(1)</script>-->',
    '<textarea><script>alert(1)</script></textarea>',
    '<template><script>alert(1)</script></template>',
  ]
  for (const p of payloads) {
    const out = clean(p)
    assert.doesNotMatch(out, /<script|<iframe|<object|<embed|<form|<input|<svg|<math|<base|<meta|<textarea|<template/i, p)
    assert.doesNotMatch(out, /\son[a-z]+\s*=/i, p)
    assert.doesNotMatch(out, /javascript:|vbscript:|data:text|expression\(|@import|url\(/i, p)
    // No raw "<" can open an element that the sanitizer did not emit itself.
    for (const tag of out.match(/<\/?([a-z0-9]+)/gi) ?? []) {
      assert.match(tag.toLowerCase(), /^<\/?(a|p|div|span|style|b|i|table|td|tr|tbody|br|img)$/, `${p} -> ${out}`)
    }
  }
})

test('ordinary email formatting is kept', () => {
  const html = `<html><head><meta charset="utf-8"><title>T</title><style>.x{color:#123}</style></head>
    <body><table width="600" cellpadding="4"><tr><td class="x" style="font-family:Arial;color:#333">Hello <b>there</b> &amp; welcome</td></tr></table>
    <p><a href="https://example.com/offer?a=1&amp;b=2">Offer</a> <a href="mailto:sales@example.com">Mail us</a></p>
    <ul><li>One</li><li>Two</li></ul></body></html>`
  const out = clean(html)
  assert.match(out, /<style>\.x\{color:#123\}<\/style>/)
  assert.match(out, /<table width="600" cellpadding="4">/)
  assert.match(out, /<td class="x" style="font-family:Arial;color:#333">Hello <b>there<\/b> &amp; welcome<\/td>/)
  assert.match(out, /<a href="https:\/\/example\.com\/offer\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">Offer<\/a>/)
  assert.match(out, /href="mailto:sales@example\.com"/)
  assert.match(out, /<ul><li>One<\/li><li>Two<\/li><\/ul>/)
  assert.doesNotMatch(out, /<title|<meta|<html|<body|<head/)
})

test('remote images are blocked (no tracking pixels), inline data images and alt text stay', () => {
  const r = sanitizeHtml('<img src="https://t.example/open.gif?u=1" alt="Logo"><img src="cid:abc"><img src="data:image/png;base64,iVBORw0KGgo=" alt="i">')
  assert.equal(r.blockedImages, 2)
  assert.doesNotMatch(r.html, /t\.example|cid:/)
  assert.match(r.html, /\[Logo\]/)
  assert.match(r.html, /<img alt="i" src="data:image\/png;base64,iVBORw0KGgo=">/)
})

test('unbalanced markup is closed and stray closers are ignored', () => {
  assert.equal(clean('<div><b>bold'), '<div><b>bold</b></div>')
  assert.equal(clean('</div></td>text<p>a</b>b</p>'), 'text<p>ab</p>')
  assert.equal(clean('a < b and c > d'), 'a &lt; b and c &gt; d')
  assert.equal(clean('<svg><svg></svg>still hidden</svg>shown'), 'shown')
})

test('composer mode drops <style> blocks', () => {
  assert.equal(clean('<style>p{}</style><p>x</p>', { keepStyles: false }), '<p>x</p>')
})

test('htmlToText and entity decoding', () => {
  assert.equal(htmlToText('<p>Hello&nbsp;<b>world</b></p><ul><li>A</li><li>B &amp; C</li></ul><script>x()</script>'), 'Hello world\n\n• A\n• B & C')
  assert.equal(decodeEntities('&#60;&lt;&#x3e;&unknown;&amp;'), '<<>&unknown;&')
})

test('address lists: quotes, encoded words and junk', () => {
  assert.deepEqual(parseAddressList('"Doe, Jane" <Jane@Example.com>, bob@example.org, not an address, <x@y>'), [
    { name: 'Doe, Jane', email: 'jane@example.com' },
    { name: null, email: 'bob@example.org' },
  ])
  assert.equal(decodeWords('=?UTF-8?B?w6l0w6k=?= =?utf-8?Q?caf=C3=A9_ok?='), 'été café ok')
  assert.deepEqual(parseRecipientInput('a@example.com; b@example.com', 5).map((p) => p.email), ['a@example.com', 'b@example.com'])
  assert.equal(parseRecipientInput('a@example.com, nonsense', 5), null, 'typed junk is an error, not dropped')
  assert.equal(parseRecipientInput('a@example.com, b@example.com', 1), null, 'over the limit')
  assert.deepEqual(parseRecipientInput('', 5), [])
})

const b64 = (s) => base64url(new TextEncoder().encode(s))

test('reading a Gmail message: bodies, attachments, headers', () => {
  const m = readMessage({
    id: '18c0a1', threadId: '18c0a0', labelIds: ['INBOX', 'UNREAD'], internalDate: '1760000000000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Subject', value: 'Rates' }, { name: 'From', value: 'Client <c@client.example>' },
        { name: 'To', value: 'sales@example.com' }, { name: 'Message-ID', value: '<abc@client.example>' },
      ],
      parts: [
        { mimeType: 'multipart/alternative', parts: [
          { mimeType: 'text/plain', body: { data: b64('Plain body') } },
          { mimeType: 'text/html', body: { data: b64('<p>HTML body</p>') } },
        ] },
        { mimeType: 'application/pdf', filename: 'rates.pdf', headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { attachmentId: 'ANGjdJ_abc-123', size: 2048 } },
        { mimeType: 'application/pdf', filename: 'evil.pdf', body: { attachmentId: '../../etc', size: 1 } },
      ],
    },
  })
  assert.equal(m.text, 'Plain body')
  assert.equal(m.html, '<p>HTML body</p>')
  assert.equal(m.unread, true)
  assert.deepEqual(m.from, { name: 'Client', email: 'c@client.example' })
  assert.equal(m.message_id, '<abc@client.example>')
  assert.deepEqual(m.attachments, [{ id: 'ANGjdJ_abc-123', filename: 'rates.pdf', mime_type: 'application/pdf', size: 2048, inline: false }])
})

test('thread summary for the cache', () => {
  const s = summarizeThread({
    id: '18c0a0',
    messages: [
      { labelIds: ['INBOX'], internalDate: '1000', payload: { headers: [{ name: 'Subject', value: 'First' }, { name: 'From', value: 'A <a@example.com>' }] } },
      { labelIds: ['INBOX', 'UNREAD'], internalDate: '2000', payload: { headers: [{ name: 'From', value: 'b@example.com' }, { name: 'Cc', value: 'A Again <a@example.com>' }, { name: 'Content-Type', value: 'multipart/mixed; boundary=x' }] } },
    ],
  })
  assert.equal(s.subject, 'First')
  assert.equal(s.unread, true)
  assert.equal(s.has_attachments, true)
  assert.equal(s.message_count, 2)
  assert.equal(s.last_message_at, new Date(2000).toISOString())
  assert.deepEqual(s.participants.map((p) => p.email), ['a@example.com', 'b@example.com'])
  assert.equal(summarizeThread({ id: 'NOT-HEX', messages: [{}] }), null)
})

test('outgoing messages: headers cannot be injected, non-ASCII is encoded', () => {
  assert.throws(() => buildMessage({ from: { email: 'a@example.com' }, to: [], subject: 'Hi\r\nBcc: x@example.com', html: '', text: '' }))
  const raw = buildMessage({
    from: { name: 'Sälës', email: 'sales@example.com' },
    to: [{ name: 'Client "Q"', email: 'c@client.example' }],
    subject: 'Prix spéciaux',
    html: '<p>Bonjour</p>', text: 'Bonjour',
    inReplyTo: '<abc@client.example>', references: '<abc@client.example>',
    attachments: [{ filename: 'a"b\r\n.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }],
  })
  const text = raw
  assert.match(text, /^From: =\?UTF-8\?B\?[^?]+\?= <sales@example\.com>\r\n/)
  assert.match(text, /\r\nTo: "Client Q" <c@client\.example>\r\n/)
  assert.match(text, /\r\nSubject: =\?UTF-8\?B\?/)
  assert.match(text, /\r\nIn-Reply-To: <abc@client\.example>\r\n/)
  assert.match(text, /filename="a_b__\.pdf"/)
  assert.doesNotMatch(text, /\r\nBcc:/)
  assert.equal(prefixedSubject('Re', 'RE: Rates'), 'RE: Rates')
  assert.equal(prefixedSubject('Fwd', 'Rates'), 'Fwd: Rates')
})

test('refresh tokens: encrypted, bound to their mailbox, rotatable', async () => {
  const key = Buffer.alloc(32, 7).toString('base64')
  const env = { EMAIL_TOKEN_KEY: key }
  const stored = await encryptToken(env, '1//synthetic-refresh-token', 'sam@example.com')
  assert.match(stored, /^k[0-9a-f]{8}\./)
  assert.doesNotMatch(stored, /synthetic/)
  assert.equal(await decryptToken(env, stored, 'sam@example.com'), '1//synthetic-refresh-token')
  await assert.rejects(decryptToken(env, stored, 'ria@example.com'), /could not be decrypted/, 'copied to another mailbox')
  await assert.rejects(decryptToken({ EMAIL_TOKEN_KEY: Buffer.alloc(32, 8).toString('base64') }, stored, 'sam@example.com'), /no configured key/)
  const rotated = { EMAIL_TOKEN_KEY: Buffer.alloc(32, 8).toString('base64'), EMAIL_TOKEN_KEY_PREVIOUS: key }
  assert.equal(await decryptToken(rotated, stored, 'sam@example.com'), '1//synthetic-refresh-token')
  await assert.rejects(encryptToken({ EMAIL_TOKEN_KEY: 'short' }, 'x', 'a@example.com'), /32 bytes/)
  const tampered = stored.slice(0, -2) + (stored.endsWith('A') ? 'BB' : 'AA')
  await assert.rejects(decryptToken(env, tampered, 'sam@example.com'))
})

test('PKCE S256 matches RFC 7636 appendix B', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abd'), false)
  assert.equal(safeEqual('abc', 'abcd'), false)
})
