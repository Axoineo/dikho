import { useEffect, useRef, useState } from 'react'
import { waApi } from '../../../lib/api'
import { sessionMsLeft, displayName } from './inboxUtils'
import { EMOJIS } from './emoji'
import { snippet } from './messageModel'

// Attachments: files go straight to the picker; the rest open a form
// (SendDialogs.jsx) for a WhatsApp message kind the Cloud API supports.
const FILE_KINDS = [
  { key: 'document', label: 'Document', accept: '*/*',
    icon: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6" /> },
  { key: 'media', label: 'Photos & videos', accept: 'image/*,video/*',
    icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 16l-5-5L5 21" /></> },
  { key: 'audio', label: 'Audio', accept: 'audio/*',
    icon: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></> },
]
const COMPOSE_KINDS = [
  { key: 'location', label: 'Location', icon: <><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></> },
  { key: 'contact', label: 'Contact', icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></> },
  { key: 'buttons', label: 'Reply buttons', icon: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /></> },
  { key: 'list', label: 'List', icon: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></> },
  { key: 'cta_url', label: 'Link button', icon: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></> },
  { key: 'location_request', label: 'Ask for location', icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></> },
  { key: 'address', label: 'Ask for address', icon: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10" /></> },
  { key: 'template', label: 'Template', needsTemplate: true, icon: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></> },
]

const MAX_RECORDING_SECONDS = 10 * 60

function formatSeconds(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/* The composer is CHROME: it follows the dashboard's controls (disc icon
   buttons, a pill field, brand-blue send) rather than WhatsApp's. The thread
   above it keeps the client's palette. */
export function Composer({
  conversation, onSendText, onSendMedia, onCompose, canTemplate,
  replyTo = null, replyAuthor = '', replyMine = false, onCancelReply,
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(null) // 'attach' | 'emoji' | null
  const [recording, setRecording] = useState(null) // { seconds } while recording
  const fileRef = useRef(null)
  const textRef = useRef(null)
  const lastTypingRef = useRef(0)
  const recorderRef = useRef(null)

  const msLeft = sessionMsLeft(conversation.last_inbound_at)
  const withinWindow = msLeft > 0

  useEffect(() => { if (replyTo) textRef.current?.focus() }, [replyTo])
  useEffect(() => { setError('') }, [conversation.id])
  // Leaving the chat mid-recording throws the recording away.
  useEffect(() => () => { stopRecording(false) }, [conversation.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tell Meta to show the customer a "typing…" indicator, at most once per ~12s
  // while the agent types (Meta keeps it up for ~25s per call).
  function pingTyping() {
    const now = Date.now()
    if (now - lastTypingRef.current < 12000) return
    lastTypingRef.current = now
    waApi.typing(conversation.id).catch(() => {})
  }

  // Closed window: the composer is replaced outright, at composer height, so
  // the chat keeps its shape instead of growing an amber warning strip. Only
  // an approved template may go out now, and it re-opens the conversation.
  if (!withinWindow) {
    return (
      <div className="m-3 flex shrink-0 items-center gap-3 rounded-2xl border border-inbox-divider bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted shadow-[0_2px_10px_rgba(16,26,44,0.08)]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></svg>
        <span className="min-w-0">
          The 24-hour reply window has closed. <b className="font-semibold text-ink">{displayName(conversation)}</b> must message first, or {canTemplate ? 'you can' : 'someone who can send campaigns can'} send an approved template.
        </span>
        {canTemplate && (
          <button
            type="button"
            onClick={() => onCompose('template')}
            className="ml-auto shrink-0 rounded-full border-0 bg-brand px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Send a template
          </button>
        )}
      </div>
    )
  }

  async function submitText(e) {
    e?.preventDefault()
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setError('')
    try { await onSendText(body); setText('') }
    catch (err) { setError(err?.message || 'The message did not send.') }
    finally { setBusy(false) }
  }

  function pickFile(accept) {
    setMenu(null)
    if (fileRef.current) { fileRef.current.accept = accept; fileRef.current.click() }
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try { await onSendMedia(file, text.trim()); setText('') }
    catch (err) { setError(err?.message || 'The file did not send.') }
    finally { setBusy(false) }
  }

  // Voice messages. WhatsApp plays OGG/Opus as a voice note: Firefox records
  // that directly; Chrome and Edge record Opus in WebM, which oggOpus.js
  // re-wraps without re-encoding. Safari records AAC in MP4, which goes as an
  // ordinary audio message.
  async function startRecording() {
    setMenu(null)
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record audio.')
      return
    }
    let stream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch {
      setError('Microphone access is blocked. Allow it for this site to record a voice message.')
      return
    }
    const mimeType = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks = []
    recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data) }
    recorder.start(250)
    const started = Date.now()
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000)
      setRecording({ seconds })
      if (seconds >= MAX_RECORDING_SECONDS) stopRecording(true)
    }, 250)
    recorderRef.current = { recorder, stream, chunks, timer, started }
    setRecording({ seconds: 0 })
  }

  async function stopRecording(send) {
    const r = recorderRef.current
    if (!r) return
    recorderRef.current = null
    clearInterval(r.timer)
    const stopped = new Promise((resolve) => { r.recorder.onstop = resolve })
    if (r.recorder.state !== 'inactive') r.recorder.stop()
    await stopped
    r.stream.getTracks().forEach((t) => t.stop())
    setRecording(null)
    if (!send) return
    if (Date.now() - r.started < 1000) { setError('That recording was too short.'); return }

    const mime = r.recorder.mimeType || ''
    const blob = new Blob(r.chunks, { type: mime })
    setBusy(true)
    try {
      let file
      let voice = false
      if (mime.startsWith('audio/ogg')) {
        file = new File([blob], 'voice.ogg', { type: 'audio/ogg' })
        voice = true
      } else if (mime.startsWith('audio/webm')) {
        const { webmOpusToOgg } = await import('./oggOpus')
        file = new File([webmOpusToOgg(new Uint8Array(await blob.arrayBuffer()))], 'voice.ogg', { type: 'audio/ogg' })
        voice = true
      } else {
        file = new File([blob], 'voice.m4a', { type: 'audio/mp4' })
      }
      await onSendMedia(file, '', { voice })
    } catch (err) {
      setError(err?.message || 'The voice message did not send.')
    } finally {
      setBusy(false)
    }
  }

  const canSend = !busy && !!text.trim()
  const discBtn = 'grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-inbox-control hover:text-ink'
  const kinds = COMPOSE_KINDS.filter((k) => !k.needsTemplate || canTemplate)

  return (
    <div className="relative shrink-0 px-3 pb-3 pt-1.5">
      {/* click-away layer for popovers */}
      {menu && <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />}

      {menu === 'attach' && (
        <div className="absolute bottom-[64px] left-4 z-20 w-[22rem] max-w-[calc(100%-2rem)] overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-[0_5px_16px_rgba(24,40,65,0.10)]">
          <div className="grid grid-cols-2 gap-0.5">
            {[...FILE_KINDS.map((k) => ({ ...k, onClick: () => pickFile(k.accept) })), ...kinds.map((k) => ({ ...k, onClick: () => { setMenu(null); onCompose(k.key) } }))].map((a) => (
              <button key={a.key} type="button" onClick={a.onClick}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-inbox-row-hover">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-inbox-chip text-brand">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{a.icon}</svg>
                </span>
                <span className="truncate">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {menu === 'emoji' && (
        <div className="absolute bottom-[64px] left-4 z-20 grid w-[17rem] grid-cols-8 gap-1 rounded-2xl border border-line bg-surface p-2 shadow-[0_5px_16px_rgba(24,40,65,0.10)]">
          {EMOJIS.map((em) => (
            <button key={em} type="button" onClick={() => setText((t) => t + em)}
              className="rounded-lg p-1 text-xl transition-colors hover:bg-inbox-row-hover">{em}</button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="m-0 mb-1.5 rounded-xl bg-tint-danger px-3 py-1.5 text-[12.5px] leading-snug text-ink">{error}</p>
      )}

      {/* One rounded card floating on the canvas: the quoted message when
          replying, then the controls. */}
      <div className={`border border-inbox-divider bg-surface shadow-[0_2px_10px_rgba(16,26,44,0.08)] ${replyTo ? 'rounded-2xl' : 'rounded-[24px]'}`}>
        {replyTo && (
          <div className="mx-1.5 mt-1.5 flex items-stretch overflow-hidden rounded-xl bg-chat-quote">
            <span className={`w-1 shrink-0 ${replyMine ? 'bg-chat-quote-you' : 'bg-chat-quote-them'}`} />
            <div className="min-w-0 flex-1 px-3 py-1.5">
              <div className={`truncate text-[12.8px] font-semibold ${replyMine ? 'text-chat-quote-you' : 'text-chat-quote-them'}`}>Replying to {replyAuthor}</div>
              <div className="truncate text-[13px] text-muted">{snippet(replyTo)}</div>
            </div>
            <button type="button" onClick={onCancelReply} aria-label="Cancel reply" title="Cancel reply" className={`${discBtn} m-1 self-center`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        )}

        {recording ? (
          <div className="flex items-center gap-2 px-1.5 py-1.5" aria-live="polite">
            <button type="button" onClick={() => stopRecording(false)} title="Discard" aria-label="Discard recording" className={discBtn}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l.9 12.5h9.2L17.5 7" /></svg>
            </button>
            <span className="flex flex-1 items-center gap-2 px-2 text-[14px] tabular-nums text-ink">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
              Recording {formatSeconds(recording.seconds)}
            </span>
            <button type="button" onClick={() => stopRecording(true)} title="Send voice message" aria-label="Send voice message"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-0 bg-brand text-white hover:opacity-90">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-8.06a.5.5 0 0 0 0-.9L3.4 3.38a.5.5 0 0 0-.7.58L4.6 11 2.7 19.82a.5.5 0 0 0 .7.58z" /></svg>
            </button>
          </div>
        ) : (
          <form onSubmit={submitText} className="flex items-end gap-1 px-1.5 py-1.5">
            {/* The types WhatsApp accepts; the API enforces the same list and the
                per-type size limits (src/api/routes/whatsapp/conversations.js). */}
            <input ref={fileRef} type="file" className="hidden" onChange={onFile}
              accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg,text/plain,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" />

            <button type="button" title="Emoji" aria-label="Insert emoji" aria-expanded={menu === 'emoji'}
              onClick={() => setMenu(menu === 'emoji' ? null : 'emoji')}
              className={`${discBtn} ${menu === 'emoji' ? 'bg-inbox-control text-ink' : ''}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" strokeLinecap="round" /><circle cx="9" cy="10" r="0.7" fill="currentColor" /><circle cx="15" cy="10" r="0.7" fill="currentColor" /></svg>
            </button>

            <button type="button" title="Attach" aria-label="Attach or send something else" aria-expanded={menu === 'attach'}
              onClick={() => setMenu(menu === 'attach' ? null : 'attach')}
              className={`${discBtn} ${menu === 'attach' ? 'bg-inbox-control text-ink' : ''}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.05l-8.49 8.49a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78" /></svg>
            </button>

            <textarea
              ref={textRef}
              rows={1}
              value={text}
              disabled={busy}
              onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) pingTyping() }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitText() }
                if (e.key === 'Escape' && replyTo) onCancelReply?.()
              }}
              placeholder="Type a message"
              aria-label="Message"
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-[8px] text-[14px] leading-5 text-ink outline-none placeholder:text-muted"
            />

            {/* Mic while the field is empty, send once there is text: the
                client's own pairing. */}
            {text.trim() ? (
              <button type="submit" disabled={!canSend} title="Send" aria-label="Send message"
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-0 transition-all
                  ${canSend ? 'bg-brand text-white hover:opacity-90' : 'cursor-default text-muted opacity-50'}`}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-8.06a.5.5 0 0 0 0-.9L3.4 3.38a.5.5 0 0 0-.7.58L4.6 11 2.7 19.82a.5.5 0 0 0 .7.58z" /></svg>
              </button>
            ) : (
              <button type="button" onClick={startRecording} disabled={busy} title="Record a voice message" aria-label="Record a voice message" className={discBtn}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm6-3a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.93V22h2v-2.07A8 8 0 0 0 20 12h-2z" /></svg>
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
