import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formFile, readBoundedBytes, readBoundedFormData, readBoundedJson } from '../src/api/utils/body.js'
import { safeDisplayName, sniffType } from '../src/api/utils/fileType.js'

// A minimal stand-in for Hono's context: just the raw Request and header().
function context(request) {
  return { req: { raw: request, header: (name) => request.headers.get(name) ?? undefined } }
}

function streamOf(chunks) {
  let pulled = 0
  // highWaterMark 0: nothing is pulled until the code under test reads, so
  // `pulled` counts exactly what it consumed.
  const stream = new ReadableStream({
    pull(controller) {
      if (pulled < chunks.length) controller.enqueue(chunks[pulled++])
      else controller.close()
    },
  }, { highWaterMark: 0 })
  return { stream, pulled: () => pulled }
}

test('a declared Content-Length over the limit is refused before any byte is read', async () => {
  const { stream, pulled } = streamOf([new Uint8Array(10)])
  const request = new Request('https://api.example.invalid/x', {
    method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Length': '1048577' },
  })
  await assert.rejects(readBoundedBytes(context(request), 1024 * 1024), { status: 413 })
  assert.equal(pulled(), 0)
})

test('a body without Content-Length is cut off as soon as it passes the limit', async () => {
  const chunk = new Uint8Array(400)
  const { stream, pulled } = streamOf([chunk, chunk, chunk, chunk, chunk, chunk])
  const request = new Request('https://api.example.invalid/x', { method: 'POST', body: stream, duplex: 'half' })
  await assert.rejects(readBoundedBytes(context(request), 1000), { status: 413 })
  assert.ok(pulled() <= 4, `read ${pulled()} chunks after the cap was exceeded`)
})

test('bodies within the limit are returned intact, and malformed lengths are rejected', async () => {
  const ok = new Request('https://api.example.invalid/x', { method: 'POST', body: 'abc' })
  assert.deepEqual([...await readBoundedBytes(context(ok), 3)], [97, 98, 99])

  const bad = new Request('https://api.example.invalid/x', { method: 'POST', body: 'abc', headers: { 'Content-Length': 'x' } })
  await assert.rejects(readBoundedBytes(context(bad), 10), { status: 400 })
})

test('JSON and multipart readers reject malformed or mislabelled bodies', async () => {
  const json = new Request('https://api.example.invalid/x', { method: 'POST', body: '{"a":1' })
  await assert.rejects(readBoundedJson(context(json), 100), { status: 400 })

  const notMultipart = new Request('https://api.example.invalid/x', {
    method: 'POST', body: 'a=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  await assert.rejects(readBoundedFormData(context(notMultipart), 100), { status: 415 })

  const broken = new Request('https://api.example.invalid/x', {
    method: 'POST', body: 'not multipart at all', headers: { 'Content-Type': 'multipart/form-data; boundary=zzz' },
  })
  await assert.rejects(readBoundedFormData(context(broken), 100), { status: 400 })
})

test('multipart bodies within the limit parse, and formFile only returns files', async () => {
  const form = new FormData()
  form.append('payload', '{}')
  form.append('file', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'a.pdf')
  const request = new Request('https://api.example.invalid/x', { method: 'POST', body: form })
  const parsed = await readBoundedFormData(context(request), 10_000)
  assert.equal(formFile(parsed, 'payload'), null)
  assert.equal(formFile(parsed, 'missing'), null)
  assert.equal((await formFile(parsed, 'file').text()), '%PDF-1.7')
})

test('file types come from the bytes, not from names or declared types', () => {
  const bytes = (...values) => new Uint8Array(values)
  const text = (value) => new TextEncoder().encode(value)
  assert.equal(sniffType(text('%PDF-1.7\n')), 'application/pdf')
  assert.equal(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), 'image/png')
  assert.equal(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg')
  assert.equal(sniffType(text('GIF89a....')), 'image/gif')
  assert.equal(sniffType(text('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp')
  for (const hostile of ['<html><script>1</script>', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'RIFF\0\0\0\0WAVE', '', '%PD']) {
    assert.equal(sniffType(text(hostile)), null, hostile)
  }
})

test('display names lose paths and control characters and stay bounded', () => {
  assert.equal(safeDisplayName('../../etc/passwd'), 'passwd')
  assert.equal(safeDisplayName('C:\\Users\\x\\GST cert.pdf'), 'GST cert.pdf')
  assert.equal(safeDisplayName('a\u0000b\nc.pdf'), 'abc.pdf')
  assert.equal(safeDisplayName('x'.repeat(500)).length, 120)
  assert.equal(safeDisplayName('   '), 'document')
})
