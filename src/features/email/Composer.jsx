import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { emailApi } from './emailApi'
import { Banner } from './emailUi'
import { cleanHtml } from './cleanHtml'
import { addressList, formatSize, fullTime, newSendId, personName, prefixed } from './emailFormat'

// Writing an email from a connected mailbox: new message, reply, reply all
// or forward. Drafts are saved to the mailbox's own Gmail drafts (never to
// browser storage); the API sanitizes the HTML again before anything is sent.
//
// Sending is deliberately not retried. Each opened composer has one send id;
// sending it twice returns the first result. If Gmail did not confirm the
// send, the person is told to check Sent, and only an explicit "Send again
// anyway" makes a new id.

const EMAIL = /^[^\s@,;<>]{1,64}@[^\s@,;<>]{1,189}\.[^\s@,;<>]{2,63}$/
const MAX_TOTAL = 15 * 1024 * 1024
const MAX_FILES = 10
const AUTOSAVE_MS = 3500

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function quoteBlock(source, mode) {
  const body = source.html ? cleanHtml(source.html) : `<div style="white-space:pre-wrap">${escapeHtml(source.text)}</div>`
  if (mode === 'forward') {
    return `<br><br><div>---------- Forwarded message ---------<br>From: ${escapeHtml(personName(source.from))} &lt;${escapeHtml(source.from?.email)}&gt;<br>`
      + `Date: ${escapeHtml(fullTime(source.date))}<br>Subject: ${escapeHtml(source.subject)}<br>To: ${escapeHtml(addressList(source.to))}</div><br>${body}`
  }
  return `<br><br><div>On ${escapeHtml(fullTime(source.date))}, ${escapeHtml(personName(source.from))} wrote:</div><blockquote>${body}</blockquote>`
}

/** Recipients a reply starts with. Your own mailbox address is never one. */
function replyRecipients(source, mode, own) {
  const not = (p) => p && p.email && p.email !== own
  const fromIsMe = source.from?.email === own
  const primary = fromIsMe ? source.to : (source.reply_to?.length ? source.reply_to : [source.from])
  const to = (primary ?? []).filter(not)
  if (mode !== 'reply_all') return { to, cc: [] }
  const seen = new Set(to.map((p) => p.email))
  const more = (list) => (list ?? []).filter((p) => not(p) && !seen.has(p.email) && seen.add(p.email))
  return { to: [...to, ...(fromIsMe ? [] : more(source.to))], cc: more(source.cc) }
}

function RecipientField({ id, label, people, setPeople, autoFocus, after }) {
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    const q = text.trim()
    if (q.length < 2) { setSuggestions([]); return undefined }
    const timer = setTimeout(() => {
      emailApi.recipients(q).then((list) => { setSuggestions(list.filter((s) => !people.some((p) => p.email === s.email))); setActive(0) }, () => setSuggestions([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [text, people])

  function commit(raw) {
    const parts = String(raw).split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    setPeople((list) => {
      const next = [...list]
      for (const part of parts) {
        const m = /^(.*?)<([^<>]+)>$/.exec(part)
        const email = (m ? m[2] : part).trim().toLowerCase()
        if (!next.some((p) => p.email === email)) next.push({ email, name: m ? m[1].trim().replace(/^"|"$/g, '') || null : null })
      }
      return next
    })
    setText('')
    setSuggestions([])
  }

  function onKeyDown(e) {
    if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && text.trim())) {
      if (suggestions.length && e.key !== ',' && e.key !== ';') {
        e.preventDefault()
        const s = suggestions[active]
        setPeople((list) => [...list, { email: s.email, name: s.name || null }])
        setText('')
        setSuggestions([])
      } else if (text.trim()) {
        e.preventDefault()
        commit(text)
      }
    } else if (e.key === 'Backspace' && !text && people.length) {
      setPeople((list) => list.slice(0, -1))
    } else if (e.key === 'Escape' && suggestions.length) {
      e.stopPropagation()
      setSuggestions([])
    }
  }

  return (
    <div className="em-field-row">
      <label htmlFor={id}>{label}</label>
      <div className="em-recipients" onClick={() => inputRef.current?.focus()}>
        {people.map((p) => (
          <span key={p.email} className={`em-recipient${EMAIL.test(p.email) ? '' : ' is-invalid'}`} title={p.email}>
            {p.name || p.email}
            <button type="button" aria-label={`Remove ${p.email}`} onClick={(e) => { e.stopPropagation(); setPeople((list) => list.filter((x) => x.email !== p.email)) }}>
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          value={text}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          onChange={(e) => { const v = e.target.value; if (/[,;]$/.test(v)) commit(v.slice(0, -1)); else setText(v) }}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => { if (text.trim()) commit(text); setSuggestions([]) }, 150)}
          onPaste={(e) => { const v = e.clipboardData.getData('text'); if (/[,;\n]/.test(v)) { e.preventDefault(); commit(v) } }}
        />
        {suggestions.length > 0 && (
          <ul className="em-suggest" id={`${id}-list`} role="listbox">
            {suggestions.map((s, i) => (
              <li key={s.email} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''}
                onMouseDown={(e) => { e.preventDefault(); setPeople((list) => [...list, { email: s.email, name: s.name || null }]); setText(''); setSuggestions([]) }}>
                <span>{s.name || s.email}</span>
                <small>{s.name ? `${s.email} · ` : ''}{s.source === 'recent' ? 'Recent' : s.source === 'client' ? 'Client' : s.source === 'vendor' ? 'Vendor' : 'Lead'}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
      {after}
    </div>
  )
}

export default function Composer({ mailboxes, accountId: initialAccount, mode = 'new', thread, source, draft, floating, onClose, onSent, toast }) {
  const writable = useMemo(() => mailboxes.filter((m) => m.status === 'connected' && ['responder', 'manager', 'admin'].includes(m.role)), [mailboxes])
  const [accountId, setAccountId] = useState(initialAccount ?? writable[0]?.id ?? null)
  const account = writable.find((m) => m.id === accountId) ?? null
  const own = account?.email_address
  // What the chosen mailbox's provider supports (older answers: Gmail, all).
  const sendAsOk = account?.capabilities?.send_as !== false
  const draftsOk = account?.capabilities?.drafts !== false

  // Only when the composer opens; later edits are the person's.
  const [initialRecipients] = useState(() => (source && (mode === 'reply' || mode === 'reply_all') ? replyRecipients(source, mode, own) : { to: [], cc: [] }))
  const [to, setTo] = useState(draft?.to ?? initialRecipients.to)
  const [cc, setCc] = useState(draft?.cc ?? initialRecipients.cc)
  const [bcc, setBcc] = useState(draft?.bcc ?? [])
  const [showCc, setShowCc] = useState(Boolean((draft?.cc ?? initialRecipients.cc).length))
  const [showBcc, setShowBcc] = useState(Boolean(draft?.bcc?.length))
  const [subject, setSubject] = useState(draft?.subject ?? (source ? prefixed(mode === 'forward' ? 'Fwd' : 'Re', source.subject || thread?.subject || '') : ''))
  const [files, setFiles] = useState([])
  const [forwarded, setForwarded] = useState(() => (mode === 'forward' && source ? source.attachments.filter((a) => !a.inline) : []))
  const [identities, setIdentities] = useState([])
  const [from, setFrom] = useState('')
  const [draftId, setDraftId] = useState(draft?.id ?? null)
  const [sendId, setSendId] = useState(newSendId)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const editorRef = useRef(null)
  const savedRange = useRef(null)
  const fileRef = useRef(null)

  // The body starts with the draft, or a quote of what is being answered.
  // Once: after that the editor belongs to the person typing.
  const initialised = useRef(false)
  useEffect(() => {
    if (!editorRef.current || initialised.current) return
    initialised.current = true
    editorRef.current.innerHTML = draft?.html ? cleanHtml(draft.html) : source ? quoteBlock(source, mode) : ''
    if (mode !== 'new' && !draft) {
      // Cursor at the top, above the quote.
      const range = document.createRange()
      range.setStart(editorRef.current, 0)
      range.collapse(true)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      editorRef.current.focus()
    }
  }, [draft, source, mode])

  // Addresses this mailbox may send as, with their signatures.
  useEffect(() => {
    if (!accountId || !sendAsOk) return undefined
    let alive = true
    emailApi.sendAs(accountId).then((r) => {
      if (!alive) return
      setIdentities(r.identities)
      setFrom((r.identities.find((i) => i.is_default) ?? r.identities.find((i) => i.is_primary))?.email ?? '')
    }, () => { if (alive) setIdentities([]) })
    return () => { alive = false }
  }, [accountId, sendAsOk])
  // A provider without send-as sends only as the mailbox itself.
  const senderIdentities = sendAsOk ? identities : []
  const identity = senderIdentities.find((i) => i.email === from)

  const totalBytes = files.reduce((n, f) => n + f.size, 0) + forwarded.reduce((n, a) => n + (a.size || 0), 0)
  const invalid = [...to, ...cc, ...bcc].filter((p) => !EMAIL.test(p.email))
  const touch = () => { setDirty(true); setError('') }
  const hasContent = useCallback(() => Boolean(to.length || cc.length || bcc.length || subject.trim() || (editorRef.current?.textContent ?? '').trim()), [to, cc, bcc, subject])

  const buildForm = useCallback((forSend) => {
    const form = new FormData()
    const join = (list) => list.map((p) => (p.name ? `"${p.name.replace(/"/g, '')}" <${p.email}>` : p.email)).join(', ')
    form.append('mode', mode)
    if (thread?.id && mode !== 'new') form.append('thread_id', thread.id)
    if (source?.id && mode !== 'new') form.append('source_message_id', source.id)
    if (from && sendAsOk) form.append('from', from)
    form.append('to', join(to))
    form.append('cc', join(cc))
    form.append('bcc', join(bcc))
    form.append('subject', subject)
    form.append('html', editorRef.current?.innerHTML ?? '')
    if (forSend) {
      form.append('send_id', sendId)
      if (draftId) form.append('draft_id', draftId)
      for (const f of files) form.append('attachment', f, f.name)
      if (forwarded.length) form.append('forward_attachments', JSON.stringify(forwarded.map((a) => ({ id: a.id, filename: a.filename, mime_type: a.mime_type }))))
    }
    return form
  }, [mode, thread, source, from, sendAsOk, to, cc, bcc, subject, sendId, draftId, files, forwarded])

  // Autosave to Gmail drafts a moment after typing stops.
  const saveDraft = useCallback(async () => {
    if (!accountId || sending || !hasContent() || !draftsOk) return
    setSaving(true)
    try {
      const r = await emailApi.saveDraft(accountId, buildForm(false), draftId)
      if (r?.id) setDraftId(r.id)
      setDirty(false)
      setSavedAt(new Date())
    } catch (err) {
      setError(`Draft not saved: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }, [accountId, sending, buildForm, draftId, hasContent, draftsOk])

  useEffect(() => {
    if (!dirty) return undefined
    const timer = setTimeout(saveDraft, AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [dirty, saveDraft, to, cc, bcc, subject])

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function send() {
    if (!account) { setError('Choose a connected mailbox you can send from.'); return }
    if (!to.length && !cc.length && !bcc.length) { setError('Add at least one recipient.'); return }
    if (invalid.length) { setError(`Check ${invalid.map((p) => p.email).join(', ')}: not a valid address.`); return }
    if (totalBytes > MAX_TOTAL) { setError('Attachments add up to more than 15 MB.'); return }
    if (!subject.trim() && !window.confirm('Send this message without a subject?')) return
    setSending(true)
    setError('')
    setUncertain(false)
    try {
      const r = await emailApi.send(account.id, buildForm(true))
      if (r.duplicate && r.status !== 'sent') {
        setUncertain(r.status === 'uncertain' || r.status === 'sending')
        setError(r.status === 'failed' ? 'This message failed earlier. Use "Send again anyway" to try once more.' : '')
        return
      }
      setDirty(false)
      toast?.('Message sent.')
      onSent?.()
      onClose()
    } catch (err) {
      if (/Check the Sent folder/.test(err.message)) setUncertain(true)
      else setError(err.message)
    } finally {
      setSending(false)
    }
  }

  function sendAgainAnyway() {
    setSendId(newSendId())
    setUncertain(false)
    setError('Ready to send again. Press Send.')
  }

  async function discard() {
    if (draftId) await emailApi.deleteDraft(accountId, draftId).catch(() => {})
    setDirty(false)
    onClose()
  }

  function requestClose() {
    if (!dirty || !hasContent()) onClose()
    else if (draftsOk) { saveDraft(); onClose() }
    // Nowhere to keep it: ask before throwing the message away.
    else setConfirmDiscard(true)
  }

  // ── Editor ─────────────────────────────────────────────────────────────────
  function exec(command, value) {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    touch()
  }
  function rememberSelection() {
    const sel = window.getSelection()
    if (sel?.rangeCount && editorRef.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange()
  }
  function applyLink(e) {
    e.preventDefault()
    const url = linkUrl.trim()
    if (!/^(https?:\/\/|mailto:)/i.test(url)) { setError('Links must start with https://, http:// or mailto:'); return }
    editorRef.current?.focus()
    if (savedRange.current) {
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(savedRange.current)
    }
    document.execCommand('createLink', false, url)
    setLinkOpen(false)
    setLinkUrl('')
    touch()
  }
  function onPaste(e) {
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    e.preventDefault()
    if (html) document.execCommand('insertHTML', false, cleanHtml(html))
    else document.execCommand('insertText', false, text)
    touch()
  }
  function insertSignature() {
    if (!identity?.signature) return
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, `<br><div class="em-signature">-- <br>${cleanHtml(identity.signature)}</div>`)
    touch()
  }
  function addFiles(list) {
    const next = [...files, ...list]
    if (next.length + forwarded.length > MAX_FILES) { setError(`Attach at most ${MAX_FILES} files.`); return }
    if (next.reduce((n, f) => n + f.size, 0) + forwarded.reduce((n, a) => n + (a.size || 0), 0) > MAX_TOTAL) { setError('Attachments add up to more than 15 MB.'); return }
    setFiles(next)
    touch()
  }

  const title = mode === 'new' ? 'New message' : mode === 'forward' ? 'Forward' : mode === 'reply_all' ? 'Reply all' : 'Reply'

  return (
    <section
      className={`em-compose${floating ? ' is-floating' : ''}`}
      aria-label={title}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send() }
        if (e.key === 'Escape' && !linkOpen) { e.stopPropagation(); requestClose() }
      }}
    >
      <div className="em-compose-head">
        <strong>{title}</strong>
        <button type="button" className="em-icon-btn" onClick={requestClose} aria-label={draftsOk ? 'Close and keep as draft' : 'Close'} title={draftsOk ? 'Close (kept as draft)' : 'Close (this mailbox cannot keep drafts)'}>
          <Icon name="close" size={17} />
        </button>
      </div>

      <div className="em-compose-fields" onInput={touch}>
        {(writable.length > 1 || senderIdentities.length > 1) && (
          <div className="em-field-row">
            <label htmlFor="em-from">From</label>
            {mode === 'new' && writable.length > 1 ? (
              <select id="em-from" value={accountId ?? ''} onChange={(e) => { setAccountId(e.target.value); setDraftId(null); touch() }}>
                {writable.map((m) => <option key={m.id} value={m.id}>{m.display_name ? `${m.display_name} <${m.email_address}>` : m.email_address}</option>)}
              </select>
            ) : (
              <select id="em-from" value={from} onChange={(e) => { setFrom(e.target.value); touch() }}>
                {(senderIdentities.length ? senderIdentities : [{ email: own }]).map((i) => <option key={i.email} value={i.email}>{i.display_name ? `${i.display_name} <${i.email}>` : i.email}</option>)}
              </select>
            )}
          </div>
        )}
        <RecipientField id="em-to" label="To" people={to} setPeople={(v) => { setTo(v); touch() }} autoFocus={mode === 'new' || mode === 'forward'}
          after={!showCc || !showBcc ? (
            <span style={{ display: 'flex', gap: 2 }}>
              {!showCc && <button type="button" className="em-link-btn" onClick={() => setShowCc(true)}>Cc</button>}
              {!showBcc && <button type="button" className="em-link-btn" onClick={() => setShowBcc(true)}>Bcc</button>}
            </span>
          ) : null} />
        {showCc && <RecipientField id="em-cc" label="Cc" people={cc} setPeople={(v) => { setCc(v); touch() }} />}
        {showBcc && <RecipientField id="em-bcc" label="Bcc" people={bcc} setPeople={(v) => { setBcc(v); touch() }} />}
        <div className="em-field-row">
          <label htmlFor="em-subject">Subject</label>
          <input id="em-subject" value={subject} maxLength={900} onChange={(e) => { setSubject(e.target.value.replace(/[\r\n]/g, ' ')); touch() }} />
        </div>
      </div>

      <div className="em-editor-bar" role="toolbar" aria-label="Formatting">
        <button type="button" className="em-icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} aria-label="Bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" className="em-icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} aria-label="Italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button type="button" className="em-icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} aria-label="Underline" title="Underline (Ctrl+U)"><u>U</u></button>
        <button type="button" className="em-icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} aria-label="Bulleted list" title="Bulleted list"><Icon name="listBullet" size={16} /></button>
        <button type="button" className="em-icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')} aria-label="Numbered list" title="Numbered list"><Icon name="listNumber" size={16} /></button>
        <button type="button" className="em-icon-btn" onMouseDown={(e) => { e.preventDefault(); rememberSelection() }} onClick={() => setLinkOpen((v) => !v)} aria-label="Insert link" title="Insert link" aria-expanded={linkOpen}><Icon name="link" size={16} /></button>
        <button type="button" className="em-icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')} aria-label="Clear formatting" title="Clear formatting"><span style={{ fontSize: 12 }}>Tx</span></button>
        {identity?.signature && (
          <button type="button" className="em-icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={insertSignature} aria-label="Insert signature" title="Insert signature"><Icon name="signature" size={16} /></button>
        )}
      </div>
      {linkOpen && (
        <form className="em-field-row" onSubmit={applyLink}>
          <label htmlFor="em-link">Link</label>
          <input id="em-link" autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setLinkOpen(false) } }} />
          <button type="submit" className="em-btn">Apply</button>
        </form>
      )}

      <div
        ref={editorRef}
        className="em-editor"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        data-placeholder="Write your message"
        onInput={touch}
        onPaste={onPaste}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        suppressContentEditableWarning
      />

      {(files.length > 0 || forwarded.length > 0) && (
        <div className="em-compose-files">
          {forwarded.map((a) => (
            <span key={a.id} className="em-attachment" title="From the original message">
              <Icon name="paperclip" size={14} /><span>{a.filename}</span><small>{formatSize(a.size)}</small>
              <button type="button" className="em-icon-btn" style={{ width: 22, height: 22 }} aria-label={`Leave out ${a.filename}`} onClick={() => setForwarded((l) => l.filter((x) => x.id !== a.id))}><Icon name="close" size={12} /></button>
            </span>
          ))}
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="em-attachment">
              <Icon name="paperclip" size={14} /><span>{f.name}</span><small>{formatSize(f.size)}</small>
              <button type="button" className="em-icon-btn" style={{ width: 22, height: 22 }} aria-label={`Remove ${f.name}`} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>
            </span>
          ))}
        </div>
      )}

      {uncertain && (
        <div className="em-compose-error">
          <Banner tone="warn" title="Gmail did not confirm the send"
            action={<button type="button" className="em-btn" onClick={sendAgainAnyway}>Send again anyway</button>}>
            Check this mailbox's Sent folder first: the message may already have gone out.
          </Banner>
        </div>
      )}
      {error && <div className="em-compose-error"><Banner tone="danger">{error}</Banner></div>}

      <div className="em-compose-foot">
        <button type="button" className="em-btn em-btn-primary" onClick={send} disabled={sending || uncertain || !account}>
          <Icon name="send" size={15} /> {sending ? 'Sending…' : 'Send'}
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }} />
        <button type="button" className="em-icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach files" title="Attach files (up to 15 MB)">
          <Icon name="paperclip" size={17} />
        </button>
        <span className="em-status" aria-live="polite">
          {!draftsOk ? 'Drafts are not saved for this mailbox' : saving ? 'Saving draft…' : savedAt ? `Draft saved ${savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
          {(files.length > 0 || forwarded.length > 0) && draftId ? ' · attachments are added when you send' : ''}
          {totalBytes > 0 ? ` · ${formatSize(totalBytes)}` : ''}
        </span>
        {confirmDiscard ? (
          <>
            <span style={{ fontSize: 12.5 }}>Discard this message?</span>
            <button type="button" className="em-btn em-btn-danger" onClick={discard}>Discard</button>
            <button type="button" className="em-btn" onClick={() => setConfirmDiscard(false)}>Keep</button>
          </>
        ) : (
          <button type="button" className="em-icon-btn" aria-label="Discard" title="Discard"
            onClick={() => (hasContent() ? setConfirmDiscard(true) : onClose())}>
            <Icon name="trash" size={17} />
          </button>
        )}
      </div>
    </section>
  )
}
