import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { cleanHtml } from './cleanHtml'

// Subject, preview text and body of a campaign or template. "Write" is a plain
// rich-text editor; "HTML" takes a designed email pasted from elsewhere.
// Content with its own layout (tables, <style>) stays in HTML mode, because a
// rich-text editor would flatten it. The server sanitizes whatever is saved
// and checks the placeholders; the preview shows the result.
const LAYOUT = /<(table|style|center)\b/i

export default function ContentEditor({ value, onChange, variables, disabled, resetKey }) {
  const editorRef = useRef(null)
  const subjectRef = useRef(null)
  const [mode, setMode] = useState(() => (LAYOUT.test(value.html ?? '') ? 'html' : 'write'))
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState('')
  const savedRange = useRef(null)
  const layout = LAYOUT.test(value.html ?? '')

  // The editor's DOM is the source while typing. It is filled once per
  // element: a new one mounts when the content is replaced from outside
  // (resetKey: a template applied, a reload) or when leaving the HTML view.
  const attachEditor = (el) => {
    editorRef.current = el
    if (el && !el.dataset.filled) {
      el.innerHTML = cleanHtml(value.html ?? '')
      el.dataset.filled = '1'
    }
  }

  const set = (patch) => onChange({ ...value, ...patch })
  const readEditor = () => set({ html: editorRef.current?.innerHTML ?? '' })

  function exec(command, arg) {
    editorRef.current?.focus()
    document.execCommand(command, false, arg)
    readEditor()
  }
  function rememberSelection() {
    const sel = window.getSelection()
    if (sel?.rangeCount && editorRef.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange()
  }
  function restoreSelection() {
    editorRef.current?.focus()
    if (savedRange.current) {
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(savedRange.current)
    }
  }
  function applyLink(e) {
    e.preventDefault()
    const url = linkUrl.trim()
    if (!/^(https?:\/\/|mailto:)/i.test(url)) { setLinkError('Links must start with https://, http:// or mailto:'); return }
    restoreSelection()
    document.execCommand('createLink', false, url)
    setLinkOpen(false)
    setLinkUrl('')
    setLinkError('')
    readEditor()
  }
  function onPaste(e) {
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    e.preventDefault()
    if (html) document.execCommand('insertHTML', false, cleanHtml(html))
    else document.execCommand('insertText', false, text)
    readEditor()
  }
  function insertVariable(key) {
    const token = `{{${key}}}`
    if (mode === 'write') {
      restoreSelection()
      document.execCommand('insertText', false, token)
      readEditor()
    } else {
      set({ html: `${value.html ?? ''}${token}` })
    }
  }
  function insertIntoSubject(key) {
    const input = subjectRef.current
    const at = input?.selectionStart ?? value.subject.length
    const next = `${value.subject.slice(0, at)}{{${key}}}${value.subject.slice(input?.selectionEnd ?? at)}`
    set({ subject: next.slice(0, 900) })
  }
  function switchMode(next) {
    if (next === mode) return
    if (next === 'html' && editorRef.current) set({ html: editorRef.current.innerHTML })
    setMode(next)
  }

  const varEntries = Object.entries(variables ?? {})
  const keep = (e) => e.preventDefault()

  return (
    <div className="em-content">
      <div className="em-field">
        <label htmlFor="em-c-subject">Subject</label>
        <div className="em-input-with">
          <input id="em-c-subject" ref={subjectRef} className="em-input" value={value.subject} maxLength={900} disabled={disabled}
            onChange={(e) => set({ subject: e.target.value.replace(/[\r\n]/g, ' ') })} />
          {!disabled && varEntries.length > 0 && <VariableMenu label="Add to subject" variables={varEntries} onPick={insertIntoSubject} />}
        </div>
      </div>
      <div className="em-field">
        <label htmlFor="em-c-preheader">Preview text <span className="em-optional">optional</span></label>
        <input id="em-c-preheader" className="em-input" value={value.preheader} maxLength={200} disabled={disabled}
          onChange={(e) => set({ preheader: e.target.value.replace(/[\r\n]/g, ' ') })} />
        <p className="em-help">Shown after the subject in most inboxes.</p>
      </div>

      <div className="em-field">
        <div className="em-field-head">
          <span className="em-label" id="em-c-body-label">Message</span>
          <div className="em-seg" role="tablist" aria-label="Editing mode">
            <button type="button" role="tab" aria-selected={mode === 'write'} className={mode === 'write' ? 'is-active' : ''}
              disabled={layout && mode === 'html'} title={layout ? 'This email has its own layout; edit it as HTML.' : undefined}
              onClick={() => switchMode('write')}>Write</button>
            <button type="button" role="tab" aria-selected={mode === 'html'} className={mode === 'html' ? 'is-active' : ''}
              onClick={() => switchMode('html')}>HTML</button>
          </div>
        </div>
        <div className={`em-body-editor${disabled ? ' is-disabled' : ''}`}>
          {!disabled && (
            <div className="em-editor-bar" role="toolbar" aria-label="Formatting">
              {mode === 'write' && (
                <>
                  <button type="button" className="em-icon-btn" onMouseDown={keep} onClick={() => exec('bold')} aria-label="Bold" title="Bold"><b>B</b></button>
                  <button type="button" className="em-icon-btn" onMouseDown={keep} onClick={() => exec('italic')} aria-label="Italic" title="Italic"><i>I</i></button>
                  <button type="button" className="em-icon-btn" onMouseDown={keep} onClick={() => exec('formatBlock', '<h2>')} aria-label="Heading" title="Heading"><span style={{ fontSize: 12 }}>H</span></button>
                  <button type="button" className="em-icon-btn" onMouseDown={keep} onClick={() => exec('formatBlock', '<p>')} aria-label="Paragraph" title="Paragraph"><span style={{ fontSize: 12 }}>¶</span></button>
                  <button type="button" className="em-icon-btn" onMouseDown={keep} onClick={() => exec('insertUnorderedList')} aria-label="Bulleted list" title="Bulleted list"><Icon name="listBullet" size={16} /></button>
                  <button type="button" className="em-icon-btn" onMouseDown={keep} onClick={() => exec('insertOrderedList')} aria-label="Numbered list" title="Numbered list"><Icon name="listNumber" size={16} /></button>
                  <button type="button" className="em-icon-btn" onMouseDown={(e) => { keep(e); rememberSelection() }} onClick={() => setLinkOpen((v) => !v)}
                    aria-label="Insert link" title="Insert link" aria-expanded={linkOpen}><Icon name="link" size={16} /></button>
                  <button type="button" className="em-icon-btn" onMouseDown={keep} onClick={() => exec('removeFormat')} aria-label="Clear formatting" title="Clear formatting"><span style={{ fontSize: 12 }}>Tx</span></button>
                </>
              )}
              {mode === 'html' && <span className="em-editor-hint">Paste a designed email or edit its HTML. Scripts, forms and remote images are removed on save.</span>}
              {varEntries.length > 0 && (
                <span style={{ marginLeft: 'auto' }}>
                  <VariableMenu label="Insert variable" variables={varEntries} onPick={insertVariable} onOpen={rememberSelection} />
                </span>
              )}
            </div>
          )}
          {linkOpen && mode === 'write' && (
            <form className="em-field-row" onSubmit={applyLink}>
              <label htmlFor="em-c-link">Link</label>
              <input id="em-c-link" autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setLinkOpen(false) } }} />
              <button type="submit" className="em-btn">Apply</button>
            </form>
          )}
          {linkError && <p className="em-field-error" role="alert">{linkError}</p>}
          {mode === 'write' ? (
            <div
              key={resetKey}
              ref={attachEditor}
              className="em-editor em-editor-tall"
              contentEditable={!disabled}
              role="textbox"
              aria-multiline="true"
              aria-labelledby="em-c-body-label"
              onInput={readEditor}
              onPaste={onPaste}
              onKeyUp={rememberSelection}
              onMouseUp={rememberSelection}
              onBlur={rememberSelection}
              suppressContentEditableWarning
            />
          ) : (
            <textarea className="em-html-source" aria-labelledby="em-c-body-label" spellCheck={false} disabled={disabled}
              value={value.html ?? ''} onChange={(e) => set({ html: e.target.value })} />
          )}
        </div>
        <p className="em-help">
          Images must be embedded in the HTML (small logos); linked images are removed so nothing tracks the reader.
          The unsubscribe footer is added to every email automatically.
        </p>
      </div>
    </div>
  )
}

function VariableMenu({ label, variables, onPick, onOpen }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <span className="em-menu-wrap" ref={ref}>
      <button type="button" className="em-btn em-btn-quiet" aria-haspopup="menu" aria-expanded={open}
        onMouseDown={(e) => { e.preventDefault(); onOpen?.() }} onClick={() => setOpen((v) => !v)}>
        {'{ }'} {label}
      </button>
      {open && (
        <ul className="em-menu" role="menu">
          {variables.map(([key, name]) => (
            <li key={key} role="none">
              <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(key); setOpen(false) }}>
                <span>{name}</span><code>{`{{${key}}}`}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
