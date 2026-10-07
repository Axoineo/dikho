import { supabase } from '../../lib/supabase'

// The browser-to-browser part of Live Assist.
//
// The employee's browser holds the shared tab and makes the offer; the
// helper's browser answers and receives the video. Both exchange the few
// setup messages ("signalling") over the private Realtime channel
// `assist:<session id>`, which only the two participants may join or send on
// (Realtime policies in supabase/migrations/20261007114458_live_assist.sql).
// After that, video and the pointer messages go directly between the two
// browsers, encrypted by WebRTC. Nothing passes through Dikho's servers and
// nothing is recorded.
//
// Only STUN servers are configured, which find a direct route on most
// networks. Some strict office or mobile networks need a relay (TURN); that
// would be added here, with credentials issued by the Worker.
export const ICE_SERVERS = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['stun:stun.l.google.com:19302'] },
]

function openSignal(sessionId, onMessage) {
  const channel = supabase.channel(`assist:${sessionId}`, {
    config: { private: true, broadcast: { self: false } },
  })
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => onMessage(payload))
  let ready = false
  const queue = []
  const joined = new Promise((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        ready = true
        for (const payload of queue.splice(0)) channel.send({ type: 'broadcast', event: 'signal', payload })
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reject(err ?? new Error(status))
      }
    })
  })
  return {
    joined,
    send(payload) {
      if (ready) channel.send({ type: 'broadcast', event: 'signal', payload })
      else queue.push(payload)
    },
    close() {
      supabase.removeChannel(channel)
    },
  }
}

function parseData(event) {
  try {
    const value = JSON.parse(event.data)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * Employee side: offers the shared tab to the helper.
 * onData(message) receives the helper's pointer/highlight/goto messages;
 * onState(state) receives the RTCPeerConnection connection state, or
 * 'signal_failed' when the private channel cannot be joined.
 */
export function shareTab({ sessionId, stream, onData, onState }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const data = pc.createDataChannel('assist', { ordered: true })
  for (const track of stream.getTracks()) pc.addTrack(track, stream)

  let answered = false
  let offering = null
  const pendingIce = []

  const signal = openSignal(sessionId, async (msg) => {
    if (!msg || msg.from !== 'helper') return
    try {
      if (msg.type === 'hello' && !answered) {
        await sendOffer()
      } else if (msg.type === 'answer' && !answered && msg.sdp?.type === 'answer') {
        answered = true
        await pc.setRemoteDescription(msg.sdp)
        for (const candidate of pendingIce.splice(0)) await pc.addIceCandidate(candidate)
      } else if (msg.type === 'ice' && msg.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate)
        else pendingIce.push(msg.candidate)
      }
    } catch {
      // A malformed or out-of-order message is ignored; the connection
      // either completes from the next one or times out on the helper side.
    }
  })

  async function sendOffer() {
    offering ??= pc.createOffer().then((offer) => pc.setLocalDescription(offer))
    await offering
    signal.send({ from: 'employee', type: 'offer', sdp: pc.localDescription.toJSON() })
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) signal.send({ from: 'employee', type: 'ice', candidate: e.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => onState?.(pc.connectionState)
  data.onmessage = (e) => {
    const message = parseData(e)
    if (message) onData?.(message)
  }

  signal.joined.then(() => sendOffer(), () => onState?.('signal_failed'))

  return {
    send(message) {
      if (data.readyState === 'open') data.send(JSON.stringify(message))
    },
    close() {
      try { data.close() } catch { /* already closed */ }
      pc.close()
      for (const track of stream.getTracks()) track.stop()
      signal.close()
    },
  }
}

/**
 * Helper side: receives the employee's tab.
 * onStream(mediaStream) fires once video arrives; onData receives the
 * employee's messages (current section); onState as above.
 */
export function viewTab({ sessionId, onStream, onData, onState }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  let data = null
  let gotOffer = false
  const pendingIce = []

  const signal = openSignal(sessionId, async (msg) => {
    if (!msg || msg.from !== 'employee') return
    try {
      if (msg.type === 'offer' && !gotOffer && msg.sdp?.type === 'offer') {
        gotOffer = true
        await pc.setRemoteDescription(msg.sdp)
        await pc.setLocalDescription(await pc.createAnswer())
        signal.send({ from: 'helper', type: 'answer', sdp: pc.localDescription.toJSON() })
        for (const candidate of pendingIce.splice(0)) await pc.addIceCandidate(candidate)
      } else if (msg.type === 'ice' && msg.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate)
        else pendingIce.push(msg.candidate)
      }
    } catch {
      // Ignored for the same reason as on the employee side.
    }
  })

  // The employee may join the channel before or after the helper; a hello
  // every two seconds asks for the offer until it arrives.
  const hello = setInterval(() => {
    if (gotOffer) { clearInterval(hello); return }
    signal.send({ from: 'helper', type: 'hello' })
  }, 2000)
  signal.joined.then(() => signal.send({ from: 'helper', type: 'hello' }), () => onState?.('signal_failed'))

  pc.onicecandidate = (e) => {
    if (e.candidate) signal.send({ from: 'helper', type: 'ice', candidate: e.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => onState?.(pc.connectionState)
  pc.ontrack = (e) => onStream?.(e.streams[0] ?? new MediaStream([e.track]))
  pc.ondatachannel = (e) => {
    data = e.channel
    data.onmessage = (event) => {
      const message = parseData(event)
      if (message) onData?.(message)
    }
  }

  return {
    send(message) {
      if (data?.readyState === 'open') data.send(JSON.stringify(message))
    },
    close() {
      clearInterval(hello)
      try { data?.close() } catch { /* already closed */ }
      pc.close()
      signal.close()
    },
  }
}

// Asks the employee's browser to share THIS tab. Chrome and Edge offer the
// current tab first; anything other than a browser tab (a whole screen, a
// window) is refused, so nothing outside Dikho is ever shown.
export async function captureThisTab() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    const err = new Error('unsupported')
    err.code = 'unsupported'
    throw err
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser', frameRate: { ideal: 10, max: 15 } },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude',
  })
  const [track] = stream.getVideoTracks()
  const surface = track?.getSettings?.().displaySurface
  if (surface && surface !== 'browser') {
    for (const t of stream.getTracks()) t.stop()
    const err = new Error('not a tab')
    err.code = 'not_tab'
    throw err
  }
  if (track) track.contentHint = 'detail'
  return stream
}
