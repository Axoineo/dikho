import { useCallback, useEffect, useRef, useState } from 'react'
import { waApi } from '../../../lib/api'

/* Answers inbound WhatsApp voice calls in the browser.

   The Worker is only a signalling relay: it hands us Meta's SDP *offer* over
   the realtime channel and posts our SDP *answer* back. The audio itself is a
   direct WebRTC session between this tab and Meta's media servers (ICE + DTLS +
   SRTP, Opus), which is why a stateless Worker can carry this at all.

   Sequence, once the agent clicks answer:
     mic -> RTCPeerConnection -> setRemoteDescription(offer)
         -> createAnswer/setLocalDescription -> wait for ICE gathering
         -> POST pre-accept(answer)  [media connects while still ringing]
         -> wait for the peer connection to come up
         -> POST accept(answer)      [only now may audio flow]

   The pre-accept/accept split is Meta's: media that flows before accept returns
   200 is discarded, so the caller loses the first words, and media that starts
   late leaves them listening to silence. Landing the connection first and then
   accepting is what makes the pickup sound instant. */

// Meta drops an unanswered call after ~30s. Give the card a little longer than
// that so the terminate webhook is normally what clears it, and this is only
// the backstop for a terminate that never arrives.
const RING_TIMEOUT_MS = 40_000

// Non-trickle: Meta takes one complete SDP with the candidates already in it,
// there is no channel to trickle them over afterwards. Waiting for gathering to
// finish is therefore mandatory — but a network where gathering stalls must not
// eat the whole answer window, so this gives up and sends what it has.
const ICE_GATHER_TIMEOUT_MS = 2500

// How long to let the peer connection settle after pre-accept before accepting
// anyway. Exceeding it is not fatal: accept still succeeds and the first moment
// of audio is just slightly clipped.
const CONNECT_WAIT_MS = 2000

const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]

function waitForIceGathering(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = () => { if (pc.iceGatheringState === 'complete') finish() }
    pc.addEventListener('icegatheringstatechange', onChange)
    const timer = setTimeout(finish, ICE_GATHER_TIMEOUT_MS)
  })
}

function waitForConnected(pc) {
  if (pc.connectionState === 'connected') return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      pc.removeEventListener('connectionstatechange', onChange)
      resolve()
    }
    const onChange = () => {
      if (['connected', 'failed', 'closed'].includes(pc.connectionState)) finish()
    }
    pc.addEventListener('connectionstatechange', onChange)
    const timer = setTimeout(finish, CONNECT_WAIT_MS)
  })
}

// Two short beeps every four seconds, synthesised rather than shipped as an
// asset. Best-effort: a tab that has never been clicked keeps its AudioContext
// suspended and simply stays silent, which is the browser's call to make, not
// something to work around.
function createRinger() {
  let ctx = null
  let timer = null

  const beep = () => {
    if (!ctx) return
    const now = ctx.currentTime
    for (const offset of [0, 0.45]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 480
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.32)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.36)
    }
  }

  return {
    start() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext
        if (!AudioCtx) return
        ctx = ctx || new AudioCtx()
        ctx.resume?.().catch(() => {})
        beep()
        timer = setInterval(beep, 4000)
      } catch { /* no audio output available; the card still shows */ }
    },
    stop() {
      clearInterval(timer)
      timer = null
      try { ctx?.close() } catch { /* already closed */ }
      ctx = null
    },
  }
}

export function useWhatsAppCall() {
  // { callId, phone, waName, sdp, at, state, error }
  // state: ringing | connecting | active | ended
  const [call, setCall] = useState(null)
  const [muted, setMuted] = useState(false)

  const callRef = useRef(null)
  const pcRef = useRef(null)
  const streamRef = useRef(null)
  const audioRef = useRef(null)
  const ringerRef = useRef(null)
  const ringTimerRef = useRef(null)

  useEffect(() => { callRef.current = call }, [call])

  // Detached element rather than one rendered by the overlay: the remote track
  // can arrive before the overlay's ref is attached, and dropping it there
  // produces a call that connects with no sound.
  const remoteAudio = useCallback(() => {
    if (!audioRef.current) {
      const el = new Audio()
      el.autoplay = true
      audioRef.current = el
    }
    return audioRef.current
  }, [])

  const teardown = useCallback(() => {
    clearTimeout(ringTimerRef.current)
    ringTimerRef.current = null

    ringerRef.current?.stop()
    ringerRef.current = null

    try { pcRef.current?.close() } catch { /* already closed */ }
    pcRef.current = null

    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.srcObject = null
    }
    setMuted(false)
  }, [])

  const dismiss = useCallback((patch) => {
    teardown()
    if (!patch) return setCall(null)
    // Leave the card up briefly with a final line ("Answered on another
    // device", "Microphone blocked") instead of having it vanish unexplained.
    setCall((prev) => (prev ? { ...prev, state: 'ended', ...patch } : null))
    setTimeout(() => setCall((prev) => (prev?.state === 'ended' ? null : prev)), 3500)
  }, [teardown])

  /* ── Realtime handlers, wired into useInboxRealtime ────────────────── */

  const onCallIncoming = useCallback((payload) => {
    if (!payload?.callId || !payload?.sdp) return

    const current = callRef.current
    // Redelivered ring for the call already on screen — ignore rather than
    // restarting the card and losing the agent's place.
    if (current?.callId === payload.callId) return
    // One line, one call: a second ring while a call is up is not ours to take.
    if (current && current.state !== 'ended') return

    setCall({ ...payload, state: 'ringing', error: null })

    ringerRef.current = createRinger()
    ringerRef.current.start()

    ringTimerRef.current = setTimeout(() => {
      if (callRef.current?.state === 'ringing') dismiss({ error: 'Missed call' })
    }, RING_TIMEOUT_MS)
  }, [dismiss])

  const onCallEnded = useCallback((payload) => {
    if (!payload?.callId || callRef.current?.callId !== payload.callId) return
    dismiss({ error: callRef.current?.state === 'active' ? null : 'Call ended' })
  }, [dismiss])

  // Another tab won the race. We only ever see this as "not us" — had we
  // claimed it, our own accept would already have moved us off 'ringing'.
  const onCallClaimed = useCallback((payload) => {
    if (!payload?.callId || callRef.current?.callId !== payload.callId) return
    if (callRef.current?.state !== 'ringing') return
    dismiss({ error: 'Answered on another device' })
  }, [dismiss])

  /* ── Agent actions ─────────────────────────────────────────────────── */

  const answer = useCallback(async () => {
    const current = callRef.current
    if (!current || current.state !== 'ringing') return

    ringerRef.current?.stop()
    clearTimeout(ringTimerRef.current)
    setCall((prev) => ({ ...prev, state: 'connecting', error: null }))

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
    } catch {
      // No mic, no call. Decline it so the customer hears a clean end instead
      // of ringing out into nothing.
      waApi.callReject(current.callId).catch(() => {})
      return dismiss({ error: 'Microphone unavailable — check browser permissions' })
    }

    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' })
      pcRef.current = pc

      stream.getTracks().forEach((track) => pc.addTrack(track, stream))

      pc.ontrack = (event) => {
        const el = remoteAudio()
        el.srcObject = event.streams[0]
        el.play().catch(() => {})
      }

      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState) && callRef.current?.state === 'active') {
          waApi.callHangUp(callRef.current.callId).catch(() => {})
          dismiss({ error: 'Connection lost' })
        }
      }

      await pc.setRemoteDescription({ type: 'offer', sdp: current.sdp })
      await pc.setLocalDescription(await pc.createAnswer())
      await waitForIceGathering(pc)

      const sdp = pc.localDescription?.sdp
      if (!sdp) throw new Error('Could not build an SDP answer')

      await waApi.callPreAccept(current.callId, sdp, current.phone)
      await waitForConnected(pc)
      await waApi.callAccept(current.callId, sdp, current.phone)

      setCall((prev) => (prev ? { ...prev, state: 'active', startedAt: Date.now() } : prev))
    } catch (err) {
      if (err?.code === 'CALL_UNAVAILABLE') return dismiss({ error: 'Answered on another device' })
      waApi.callReject(current.callId).catch(() => {})
      dismiss({ error: err?.message || 'Could not connect the call' })
    }
  }, [dismiss, remoteAudio])

  const decline = useCallback(() => {
    const current = callRef.current
    if (!current) return
    waApi.callReject(current.callId).catch(() => {})
    dismiss()
  }, [dismiss])

  const hangUp = useCallback(() => {
    const current = callRef.current
    if (!current) return
    waApi.callHangUp(current.callId).catch(() => {})
    dismiss()
  }, [dismiss])

  const toggleMute = useCallback(() => {
    const tracks = streamRef.current?.getAudioTracks() ?? []
    if (!tracks.length) return
    const next = !tracks[0].enabled
    tracks.forEach((t) => { t.enabled = next })
    setMuted(!next)
  }, [])

  // A backgrounded tab is exactly where a ringing call gets missed, so put it
  // in the one place that shows through: the tab title.
  useEffect(() => {
    if (call?.state !== 'ringing') return undefined
    const original = document.title
    let on = false
    const flash = setInterval(() => {
      on = !on
      document.title = on ? '📞 Incoming call…' : original
    }, 900)
    return () => { clearInterval(flash); document.title = original }
  }, [call?.state])

  useEffect(() => teardown, [teardown])

  return {
    call,
    muted,
    answer,
    decline,
    hangUp,
    toggleMute,
    onCallIncoming,
    onCallEnded,
    onCallClaimed,
  }
}
