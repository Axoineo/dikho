import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  extractOpusFromWebm, oggCrc, opusPacketSamples, opusToOgg, webmOpusToOgg,
} from '../src/features/whatsapp/inbox/oggOpus.js'

// 2.46 s recorded by Chrome's MediaRecorder from its fake microphone (a test
// tone), so it has the live-recording shape: Segment and Cluster sizes are
// "unknown". Converted, it decodes to PCM identical to the WebM (checked
// with ffmpeg when this test was written).
const webm = new Uint8Array(readFileSync(new URL('./fixtures/chrome-fake-mic.webm', import.meta.url)))

function pages(ogg) {
  const out = []
  let pos = 0
  while (pos < ogg.length) {
    assert.equal(String.fromCharCode(...ogg.subarray(pos, pos + 4)), 'OggS', `page at ${pos}`)
    const view = new DataView(ogg.buffer, ogg.byteOffset + pos)
    const count = ogg[pos + 26]
    const lacing = [...ogg.subarray(pos + 27, pos + 27 + count)]
    const length = 27 + count + lacing.reduce((a, b) => a + b, 0)
    const page = ogg.slice(pos, pos + length)
    const stored = view.getUint32(22, true)
    page.fill(0, 22, 26)
    const packets = []
    let at = 27 + count
    let current = []
    for (const l of lacing) {
      current.push(...page.subarray(at, at + l))
      at += l
      if (l < 255) { packets.push(Uint8Array.from(current)); current = [] }
    }
    out.push({
      flags: ogg[pos + 5],
      granule: view.getUint32(6, true) + view.getUint32(10, true) * 0x100000000,
      sequence: view.getUint32(18, true),
      crcOk: oggCrc(page) === stored,
      packets,
    })
    pos += length
  }
  return out
}

test('Chrome WebM/Opus: every Opus packet comes out, with its header', () => {
  const { head, packets } = extractOpusFromWebm(webm)
  assert.equal(new TextDecoder().decode(head.subarray(0, 8)), 'OpusHead')
  assert.equal(head[9], 1, 'mono')
  assert.equal(packets.length, 41)
  assert.equal(packets.reduce((n, p) => n + opusPacketSamples(p), 0), 118080) // 2.46 s at 48 kHz
})

test('the Ogg stream is well formed: header pages, CRCs, granules, EOS', () => {
  const { packets } = extractOpusFromWebm(webm)
  const ogg = webmOpusToOgg(webm)
  const list = pages(ogg)

  assert.ok(list.every((p) => p.crcOk), 'every page CRC matches')
  assert.deepEqual(list.map((p) => p.sequence), list.map((_, i) => i))
  assert.equal(list[0].flags, 0x02, 'first page begins the stream')
  assert.equal(new TextDecoder().decode(list[0].packets[0].subarray(0, 8)), 'OpusHead')
  assert.equal(list[0].packets.length, 1, 'OpusHead alone on page one')
  assert.equal(new TextDecoder().decode(list[1].packets[0].subarray(0, 8)), 'OpusTags')
  assert.equal(list.at(-1).flags & 0x04, 0x04, 'last page ends the stream')

  const audio = list.slice(2).flatMap((p) => p.packets)
  assert.deepEqual(audio, packets, 'packets copied unchanged and in order')
  const granules = list.slice(2).map((p) => p.granule)
  assert.ok(granules.every((g, i) => i === 0 || g >= granules[i - 1]), 'granules never go back')
  assert.equal(granules.at(-1), 118080)
})

test('what the API checks for a voice note: OggS, then OpusHead after the segment table', () => {
  const ogg = webmOpusToOgg(webm)
  assert.equal(String.fromCharCode(...ogg.subarray(0, 4)), 'OggS')
  const start = 27 + ogg[26]
  assert.equal(String.fromCharCode(...ogg.subarray(start, start + 8)), 'OpusHead')
})

test('packet durations follow the TOC byte (RFC 6716)', () => {
  assert.equal(opusPacketSamples(Uint8Array.of(0xf8)), 960)          // CELT 20 ms, one frame
  assert.equal(opusPacketSamples(Uint8Array.of(0xf9)), 1920)         // two frames
  assert.equal(opusPacketSamples(Uint8Array.of(0xfb, 0x03)), 2880)   // code 3, three frames
  assert.equal(opusPacketSamples(Uint8Array.of(0x18)), 2880)         // SILK 60 ms
  assert.equal(opusPacketSamples(Uint8Array.of(0x80)), 120)          // CELT 2.5 ms
})

test('large packets span lacing values and still round-trip', () => {
  const big = new Uint8Array(600).fill(7)
  big[0] = 0xf8
  const head = new Uint8Array(19)
  head.set(new TextEncoder().encode('OpusHead'))
  const list = pages(opusToOgg({ head, packets: [big, Uint8Array.of(0xf8, 1)] }, { serial: 1 }))
  assert.deepEqual(list.slice(2).flatMap((p) => p.packets), [big, Uint8Array.of(0xf8, 1)])
})

test('not a recording: a clear error, never garbage', () => {
  assert.throws(() => extractOpusFromWebm(new Uint8Array([1, 2, 3])))
  assert.throws(() => extractOpusFromWebm(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80])), /No Opus/)
})
