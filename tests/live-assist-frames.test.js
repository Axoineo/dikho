import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_CHUNKS, frameAssembler, isPng } from '../src/features/live-assist/frames.js'

// A phone's screen arrives as pictures cut into chunks (frames.js). Synthetic
// bytes only.
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function chunk(frame, index, count, payload) {
  const buffer = new ArrayBuffer(8 + payload.length)
  const view = new DataView(buffer)
  view.setUint32(0, frame)
  view.setUint16(4, index)
  view.setUint16(6, count)
  new Uint8Array(buffer, 8).set(payload)
  return buffer
}

test('a picture comes together from its chunks, in any order', () => {
  const picture = Uint8Array.from([...PNG_HEAD, 1, 2, 3, 4, 5, 6])
  const frames = frameAssembler()
  assert.equal(frames.add(chunk(7, 1, 2, picture.slice(8))), null)
  const whole = frames.add(chunk(7, 0, 2, picture.slice(0, 8)))
  assert.deepEqual([...whole], [...picture])
})

test('a newer picture drops an unfinished older one', () => {
  const frames = frameAssembler()
  assert.equal(frames.add(chunk(1, 0, 2, PNG_HEAD)), null)
  const next = Uint8Array.from([...PNG_HEAD, 9])
  assert.deepEqual([...frames.add(chunk(2, 0, 1, next))], [...next])
  assert.equal(frames.add(chunk(1, 1, 2, [1])), null, 'the old picture is gone')
})

test('only PNG pictures and well-formed chunks are accepted', () => {
  const frames = frameAssembler()
  assert.equal(frames.add(chunk(1, 0, 1, [0x3c, 0x73, 0x76, 0x67, 1, 2, 3, 4, 5])), null, 'not a PNG')
  assert.equal(frames.add(chunk(1, 2, 2, PNG_HEAD)), null, 'index past the count')
  assert.equal(frames.add(chunk(1, 0, 0, PNG_HEAD)), null, 'no chunks')
  assert.equal(frames.add(chunk(1, 0, MAX_CHUNKS + 1, PNG_HEAD)), null, 'too many chunks')
  assert.equal(frames.add(new ArrayBuffer(4)), null, 'too short')
  assert.equal(frames.add('text'), null, 'not binary')
  assert.equal(isPng(Uint8Array.from(PNG_HEAD)), false, 'a header alone is not a picture')
})
