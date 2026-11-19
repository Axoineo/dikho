// Pictures of a phone's Dikho screen, for a helper watching someone who uses the
// Android app. The app cannot share a video of its screen without Android's
// screen-recording permission, which would also show notifications and other
// apps; it sends pictures of Dikho's own screens instead, a few a second, on the
// session's `frames` data channel, directly to this browser (peer.js).
//
// Each picture is cut into chunks of at most 16,000 bytes. A chunk starts with an
// 8-byte header: the picture's number (4 bytes), the chunk's index and the number
// of chunks (2 bytes each), all big-endian. dikho-mobile/lib/features/live_assist/
// assist_link.dart (FrameChunks) sends the same. No browser APIs, so
// tests/live-assist-frames.test.js runs it in Node.

export const MAX_CHUNKS = 120
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Only a PNG is shown: anything else on the channel is dropped. */
export function isPng(bytes) {
  return bytes.length > PNG.length && PNG.every((b, i) => bytes[i] === b)
}

/**
 * Collects chunks into whole pictures. add(arrayBuffer) returns the picture's
 * bytes once its last chunk arrives, else null; a newer picture drops an
 * unfinished older one.
 */
export function frameAssembler() {
  let frame = null
  let parts = []
  return {
    add(buffer) {
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 9) return null
      const view = new DataView(buffer)
      const number = view.getUint32(0)
      const index = view.getUint16(4)
      const count = view.getUint16(6)
      if (count === 0 || count > MAX_CHUNKS || index >= count) return null
      if (number !== frame) {
        frame = number
        parts = new Array(count).fill(null)
      }
      if (parts.length !== count) return null
      parts[index] = new Uint8Array(buffer, 8)
      if (parts.some((p) => p === null)) return null
      const whole = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
      let at = 0
      for (const p of parts) { whole.set(p, at); at += p.length }
      frame = null
      parts = []
      return isPng(whole) ? whole : null
    },
  }
}
