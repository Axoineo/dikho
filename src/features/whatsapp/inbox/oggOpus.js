// WebM/Opus -> Ogg/Opus, without re-encoding.
//
// WhatsApp plays a recording as a voice note only when it is OGG with Opus
// inside. Firefox's MediaRecorder writes that directly; Chrome and Edge write
// the same Opus packets in a WebM container instead. This copies the packets
// out of the WebM (Matroska/EBML) and writes them as Ogg pages (RFC 7845):
// an OpusHead page, an OpusTags page, then the audio, with granule positions
// counted from each packet's TOC byte (RFC 6716 section 3.1).
//
// Pure functions over Uint8Array, so the same code runs in the browser and in
// node --test (tests/ogg-opus.test.js).

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Audio: 0xe1,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
}
// Containers we descend into; everything else is skipped by its size.
const MASTER = new Set([ID.Segment, ID.Tracks, ID.TrackEntry, ID.Audio, ID.Cluster, ID.BlockGroup])

function readVint(bytes, pos, keepMarker) {
  const first = bytes[pos]
  if (first === undefined) throw new Error('Truncated WebM')
  let length = 1
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++
  if (length > 8) throw new Error('Invalid WebM')
  let value = keepMarker ? first : first & (0xff >> length)
  let allOnes = (first & (0xff >> length)) === (0xff >> length)
  for (let i = 1; i < length; i++) {
    const b = bytes[pos + i]
    if (b === undefined) throw new Error('Truncated WebM')
    value = value * 256 + b
    if (b !== 0xff) allOnes = false
  }
  return { value, length, unknown: !keepMarker && allOnes }
}

function readUint(bytes, start, end) {
  let v = 0
  for (let i = start; i < end; i++) v = v * 256 + bytes[i]
  return v
}

// Walks the element tree and hands every element to `visit`. Live recordings
// leave the Segment and Cluster sizes "unknown", meaning "until the parent
// ends", so an unknown size runs to `end`.
function walk(bytes, start, end, visit) {
  let pos = start
  while (pos < end) {
    const id = readVint(bytes, pos, true)
    const size = readVint(bytes, pos + id.length, false)
    const dataStart = pos + id.length + size.length
    const dataEnd = size.unknown ? end : Math.min(end, dataStart + size.value)
    if (MASTER.has(id.value)) {
      visit(id.value, dataStart, dataEnd, true)
      walk(bytes, dataStart, dataEnd, visit)
    } else visit(id.value, dataStart, dataEnd, false)
    pos = dataEnd
  }
}

export function extractOpusFromWebm(bytes) {
  const tracks = []
  let current = null
  const frames = []
  walk(bytes, 0, bytes.length, (id, start, end, entering) => {
    if (entering) {
      if (id === ID.TrackEntry) { current = {}; tracks.push(current) }
      return
    }
    if (id === ID.TrackNumber && current) current.number = readUint(bytes, start, end)
    else if (id === ID.CodecID && current) current.codec = new TextDecoder().decode(bytes.subarray(start, end))
    else if (id === ID.CodecPrivate && current) current.head = bytes.slice(start, end)
    else if (id === ID.Channels && current) current.channels = readUint(bytes, start, end)
    else if (id === ID.SimpleBlock || id === ID.Block) {
      const track = readVint(bytes, start, false)
      const flags = bytes[start + track.length + 2]
      if ((flags & 0x06) !== 0) throw new Error('Laced WebM blocks are not supported')
      frames.push({ track: track.value, data: bytes.slice(start + track.length + 3, end) })
    }
  })
  const opus = tracks.find((t) => t.codec === 'A_OPUS')
  if (!opus) throw new Error('No Opus audio in this recording')
  return {
    head: opus.head ?? defaultOpusHead(opus.channels ?? 1),
    packets: frames.filter((f) => f.track === opus.number && f.data.length > 0).map((f) => f.data),
  }
}

function defaultOpusHead(channels) {
  const head = new Uint8Array(19)
  head.set(new TextEncoder().encode('OpusHead'))
  const view = new DataView(head.buffer)
  head[8] = 1
  head[9] = channels
  view.setUint16(10, 312, true)     // pre-skip, the libopus default
  view.setUint32(12, 48000, true)   // input sample rate, informational
  return head
}

// Samples (at 48 kHz) in one Opus packet, from its TOC byte.
export function opusPacketSamples(packet) {
  const toc = packet[0]
  const config = toc >> 3
  let ms
  if (config < 12) ms = [10, 20, 40, 60][config % 4]
  else if (config < 16) ms = [10, 20][config % 2]
  else ms = [2.5, 5, 10, 20][config % 4]
  const code = toc & 3
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2
  return Math.round(frames * ms * 48)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0
    table[i] = r >>> 0
  }
  return table
})()

export function oggCrc(bytes) {
  let crc = 0
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0
  return crc >>> 0
}

function oggPage({ packets, granule, serial, sequence, flags }) {
  const segments = []
  for (const p of packets) {
    let left = p.length
    while (left >= 255) { segments.push(255); left -= 255 }
    segments.push(left)
  }
  const bodyLength = packets.reduce((n, p) => n + p.length, 0)
  const page = new Uint8Array(27 + segments.length + bodyLength)
  const view = new DataView(page.buffer)
  page.set([0x4f, 0x67, 0x67, 0x53]) // "OggS"
  page[4] = 0
  page[5] = flags
  view.setUint32(6, granule % 0x100000000, true)
  view.setUint32(10, Math.floor(granule / 0x100000000), true)
  view.setUint32(14, serial, true)
  view.setUint32(18, sequence, true)
  page[26] = segments.length
  page.set(segments, 27)
  let at = 27 + segments.length
  for (const p of packets) { page.set(p, at); at += p.length }
  view.setUint32(22, oggCrc(page), true)
  return page
}

export function opusToOgg({ head, packets }, { serial = (Math.random() * 0xffffffff) >>> 0, vendor = 'Dikho' } = {}) {
  const tagsVendor = new TextEncoder().encode(vendor)
  const tags = new Uint8Array(8 + 4 + tagsVendor.length + 4)
  tags.set(new TextEncoder().encode('OpusTags'))
  new DataView(tags.buffer).setUint32(8, tagsVendor.length, true)
  tags.set(tagsVendor, 12)

  const pages = [
    oggPage({ packets: [head], granule: 0, serial, sequence: 0, flags: 0x02 }),
    oggPage({ packets: [tags], granule: 0, serial, sequence: 1, flags: 0 }),
  ]
  let sequence = 2
  let granule = 0
  let batch = []
  let segments = 0
  const flush = (last) => {
    pages.push(oggPage({ packets: batch, granule, serial, sequence: sequence++, flags: last ? 0x04 : 0 }))
    batch = []
    segments = 0
  }
  packets.forEach((packet, i) => {
    const needed = Math.floor(packet.length / 255) + 1
    if (segments + needed > 255 || batch.length >= 50) flush(false)
    batch.push(packet)
    segments += needed
    granule += opusPacketSamples(packet)
    if (i === packets.length - 1) flush(true)
  })
  if (packets.length === 0) pages.push(oggPage({ packets: [], granule: 0, serial, sequence, flags: 0x04 }))

  const out = new Uint8Array(pages.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of pages) { out.set(p, at); at += p.length }
  return out
}

export function webmOpusToOgg(bytes) {
  return opusToOgg(extractOpusFromWebm(bytes))
}
