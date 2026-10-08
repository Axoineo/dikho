import { useEffect, useMemo, useRef, useState } from 'react'
import { waApi } from '../../../lib/api'
import { displayName } from './inboxUtils'

// Forms for the WhatsApp message kinds beyond text and files. The limits
// shown are Meta's; the API checks the same ones
// (src/api/services/whatsapp/richContent.js), so the counters only spare the
// agent a round trip.

const TITLES = {
  location: 'Send a location',
  contact: 'Send a contact',
  buttons: 'Message with reply buttons',
  list: 'Message with a list',
  cta_url: 'Message with a link button',
  location_request: 'Ask for their location',
  address: 'Ask for a delivery address',
  template: 'Send an approved template',
}

const field = 'w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-inbox-focus'

function Field({ label, value, onChange, max, placeholder, multiline = false, required = false, type = 'text', hint }) {
  const over = max && value.length > max
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-[12.5px] font-medium text-muted">
        <span>{label}{required ? '' : ' (optional)'}</span>
        {max && <span className={`tabular-nums ${over ? 'text-danger' : ''}`}>{value.length}/{max}</span>}
      </span>
      {multiline
        ? <textarea rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${field} resize-y`} />
        : <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={field} />}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  )
}

// "https://maps.google.com/?q=18.52,73.85" or ".../@18.52,73.85,15z" -> numbers.
function coordsFromLink(link) {
  const m = String(link).match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || String(link).match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
  return m ? { latitude: m[1], longitude: m[2] } : null
}

function LocationForm({ input, set }) {
  const [link, setLink] = useState('')
  return (
    <>
      <Field label="Google Maps link" value={link} placeholder="Paste a link to fill in the coordinates"
        onChange={(v) => { setLink(v); const c = coordsFromLink(v); if (c) set(c) }} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude" required value={input.latitude ?? ''} onChange={(v) => set({ latitude: v })} placeholder="18.5204" />
        <Field label="Longitude" required value={input.longitude ?? ''} onChange={(v) => set({ longitude: v })} placeholder="73.8567" />
      </div>
      <Field label="Place name" max={100} value={input.name ?? ''} onChange={(v) => set({ name: v })} />
      <Field label="Address" max={300} value={input.address ?? ''} onChange={(v) => set({ address: v })} />
    </>
  )
}

function ContactForm({ input, set }) {
  return (
    <>
      <Field label="Name" required max={100} value={input.name ?? ''} onChange={(v) => set({ name: v })} />
      <Field label="Phone number" required max={30} value={input.phone ?? ''} onChange={(v) => set({ phone: v })} placeholder="+91 98000 00000" />
      <Field label="Email" max={120} type="email" value={input.email ?? ''} onChange={(v) => set({ email: v })} />
      <Field label="Company" max={100} value={input.company ?? ''} onChange={(v) => set({ company: v })} />
    </>
  )
}

function Decorations({ input, set, bodyMax = 1024 }) {
  return (
    <>
      <Field label="Header" max={60} value={input.header ?? ''} onChange={(v) => set({ header: v })} />
      <Field label="Message" required multiline max={bodyMax} value={input.body ?? ''} onChange={(v) => set({ body: v })} />
      <Field label="Footer" max={60} value={input.footer ?? ''} onChange={(v) => set({ footer: v })} />
    </>
  )
}

function ButtonsForm({ input, set }) {
  const buttons = input.buttons ?? ['', '', '']
  return (
    <>
      <Decorations input={input} set={set} />
      <div className="grid gap-2">
        {buttons.map((b, i) => (
          <Field key={i} label={`Button ${i + 1}`} required={i === 0} max={20} value={b}
            onChange={(v) => set({ buttons: buttons.map((x, j) => (j === i ? v : x)) })} />
        ))}
      </div>
    </>
  )
}

function ListForm({ input, set }) {
  const rows = input.rows ?? [{ title: '', description: '' }]
  const setRows = (next) => set({ rows: next })
  return (
    <>
      <Decorations input={input} set={set} bodyMax={4096} />
      <Field label="List button label" required max={20} value={input.button ?? ''} onChange={(v) => set({ button: v })} placeholder="See options" />
      <Field label="Section title" max={24} value={input.sectionTitle ?? ''} onChange={(v) => set({ sectionTitle: v })} />
      <div className="grid gap-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-end gap-2">
            <Field label={`Option ${i + 1}`} required={i === 0} max={24} value={r.title} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, title: v } : x)))} />
            <Field label="Description" max={72} value={r.description} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, description: v } : x)))} />
            <button type="button" aria-label={`Remove option ${i + 1}`} disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              className="mb-1 grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-inbox-control hover:text-ink disabled:opacity-40">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        ))}
      </div>
      {rows.length < 10 && (
        <button type="button" onClick={() => setRows([...rows, { title: '', description: '' }])}
          className="justify-self-start rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-inbox-control">
          Add an option
        </button>
      )}
    </>
  )
}

function CtaForm({ input, set }) {
  return (
    <>
      <Decorations input={input} set={set} />
      <Field label="Button label" required max={20} value={input.label ?? ''} onChange={(v) => set({ label: v })} placeholder="Open" />
      <Field label="Link" required value={input.url ?? ''} onChange={(v) => set({ url: v })} placeholder="https://" />
    </>
  )
}

function RequestForm({ input, set, note }) {
  return (
    <>
      <Field label="Message" required multiline max={1024} value={input.body ?? ''} onChange={(v) => set({ body: v })} />
      <p className="m-0 text-[12.5px] leading-relaxed text-muted">{note}</p>
    </>
  )
}

// The inbox fills in text variables only; a media header or a link button
// with a variable needs a value it does not collect (the API refuses those).
function usable(t) {
  return t.category !== 'AUTHENTICATION'
    && (!t.headerFormat || t.headerFormat === 'TEXT')
    && !(t.buttons ?? []).some((b) => /\{\{/.test(b?.url ?? ''))
}

function TemplateForm({ input, set, setReady }) {
  const [state, setState] = useState({ loading: true, error: '', templates: [], source: 'meta' })
  useEffect(() => {
    let alive = true
    waApi.templates()
      .then((d) => { if (alive) setState({ loading: false, error: '', templates: d.templates ?? [], source: d.source }) })
      .catch((err) => { if (alive) setState({ loading: false, error: err?.message || 'Could not load templates.', templates: [], source: 'meta' }) })
    return () => { alive = false }
  }, [])
  const list = state.templates.filter(usable)
  const chosen = list.find((t) => `${t.name}|${t.language}` === input.key)
  const values = useMemo(() => input.values ?? {}, [input.values])
  useEffect(() => {
    setReady(Boolean(chosen) && (chosen.variables ?? []).every((v) => String(values[v] ?? '').trim()))
  }, [chosen, values, setReady])

  const preview = chosen
    ? String(chosen.bodyText ?? '').replace(/\{\{\s*([\w.\- ]+?)\s*\}\}/g, (whole, token) => String(values[token.trim()] ?? '').trim() || whole)
    : ''

  if (state.loading) return <p className="m-0 text-[13px] text-muted">Loading approved templates…</p>
  if (state.error) return <p className="m-0 rounded-xl bg-tint-danger px-3 py-2 text-[13px] text-ink">{state.error}</p>
  return (
    <>
      {state.source === 'fallback' && (
        <p className="m-0 rounded-xl bg-tint-warn px-3 py-2 text-[12.5px] text-ink">WhatsApp's template list could not be reached, so this may be incomplete.</p>
      )}
      <label className="block">
        <span className="mb-1 block text-[12.5px] font-medium text-muted">Template</span>
        <select value={input.key ?? ''} onChange={(e) => set({ key: e.target.value, values: {} })} className={field}>
          <option value="">Choose a template</option>
          {list.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}) · {t.category?.toLowerCase()}</option>)}
        </select>
        {state.templates.length > list.length && (
          <span className="mt-1 block text-[12px] text-muted">Templates with a photo, video or document header, or a link with a variable, are not listed: the inbox cannot fill those in.</span>
        )}
      </label>
      {chosen && (
        <>
          {(chosen.variables ?? []).map((v) => (
            <Field key={v} label={`{{${v}}}`} required max={1024} value={values[v] ?? ''} onChange={(x) => set({ values: { ...values, [v]: x } })} />
          ))}
          <div className="rounded-xl bg-chat-canvas p-3">
            <div className="max-w-[90%] rounded-bubble bg-chat-bubble-out px-[9px] py-[5px] text-[13.5px] leading-[19px] text-chat-bubble-out-text shadow-bubble">
              {chosen.headerText && <p className="m-0 font-semibold">{chosen.headerText}</p>}
              <p className="m-0 whitespace-pre-wrap">{preview}</p>
              {chosen.footerText && <p className="m-0 mt-0.5 text-[12px] opacity-70">{chosen.footerText}</p>}
            </div>
          </div>
          <p className="m-0 text-[12.5px] text-muted">A template is charged by WhatsApp as a {chosen.category?.toLowerCase()} conversation.</p>
        </>
      )}
    </>
  )
}

// What each form sends to the API.
function toRequest(kind, input) {
  switch (kind) {
    case 'location': return { latitude: Number(input.latitude), longitude: Number(input.longitude), name: input.name, address: input.address }
    case 'contact': return { name: input.name, phone: input.phone, email: input.email, company: input.company }
    case 'buttons': return { kind, header: input.header, body: input.body, footer: input.footer, buttons: (input.buttons ?? []).filter((b) => b.trim()) }
    case 'list': return {
      kind, header: input.header, body: input.body, footer: input.footer, button: input.button,
      sections: [{ title: input.sectionTitle, rows: (input.rows ?? []).filter((r) => r.title.trim()) }],
    }
    case 'cta_url': return { kind, header: input.header, body: input.body, footer: input.footer, label: input.label, url: input.url }
    case 'location_request':
    case 'address': return { kind, body: input.body }
    case 'template': {
      const [name, language] = String(input.key ?? '').split('|')
      return { name, language, values: input.values ?? {} }
    }
    default: return {}
  }
}

const DEFAULTS = {
  location_request: { body: 'Could you share your location, please?' },
  address: { body: 'Please share your delivery address.' },
}

export function ComposeDialog({ kind, conversation, onSend, onClose }) {
  const [input, setInput] = useState(DEFAULTS[kind] ?? {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [templateReady, setTemplateReady] = useState(false)
  const firstRef = useRef(null)
  const set = (patch) => setInput((prev) => ({ ...prev, ...patch }))

  useEffect(() => {
    firstRef.current?.querySelector('input, textarea, select')?.focus()
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const ready = useMemo(() => {
    if (kind === 'template') return templateReady
    if (kind === 'location') return input.latitude !== undefined && input.latitude !== '' && input.longitude !== undefined && input.longitude !== ''
    if (kind === 'contact') return Boolean(input.name?.trim() && input.phone?.trim())
    if (kind === 'list') return Boolean(input.body?.trim() && input.button?.trim() && (input.rows ?? []).some((r) => r.title.trim()))
    if (kind === 'buttons') return Boolean(input.body?.trim() && (input.buttons ?? []).some((b) => b.trim()))
    if (kind === 'cta_url') return Boolean(input.body?.trim() && input.label?.trim() && input.url?.trim())
    return Boolean(input.body?.trim())
  }, [kind, input, templateReady])

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSend(kind, toRequest(kind, input))
      onClose()
    } catch (err) {
      setError(err?.message || 'That did not send.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,20,26,0.45)] p-4" onMouseDown={() => { if (!busy) onClose() }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
        onSubmit={send}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-[480px] flex-col rounded-2xl border border-line bg-surface shadow-[0_17px_50px_rgba(11,20,26,0.19)]"
      >
        <div className="border-b border-line px-6 pb-3 pt-5">
          <h2 id="compose-title" className="m-0 text-[17px] font-semibold text-ink">{TITLES[kind]}</h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-muted">To {displayName(conversation)}</p>
        </div>
        <div ref={firstRef} className="inbox-scroll grid min-h-0 flex-1 gap-3 overflow-y-auto px-6 py-4">
          {kind === 'location' && <LocationForm input={input} set={set} />}
          {kind === 'contact' && <ContactForm input={input} set={set} />}
          {kind === 'buttons' && <ButtonsForm input={input} set={set} />}
          {kind === 'list' && <ListForm input={input} set={set} />}
          {kind === 'cta_url' && <CtaForm input={input} set={set} />}
          {kind === 'location_request' && <RequestForm input={input} set={set} note="They get a Send location button. Their pin arrives in this chat." />}
          {kind === 'address' && <RequestForm input={input} set={set} note="They get a form for a delivery address in India, which arrives in this chat when they send it." />}
          {kind === 'template' && <TemplateForm input={input} set={set} setReady={setTemplateReady} />}
          {error && <p role="alert" className="m-0 rounded-xl bg-tint-danger px-3 py-2 text-[13px] leading-snug text-ink">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-3.5">
          <button type="button" onClick={onClose} disabled={busy}
            className="h-9 rounded-full border border-line px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-inbox-control disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy || !ready}
            className="h-9 rounded-full border-0 bg-brand px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}
