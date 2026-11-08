import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { apiGet, apiPost, apiUpload } from '../../lib/api'
import { WhatsAppPreview } from './WhatsAppPreview'
import { ContactImportReview } from './ContactImport'
import {
  CONTACT_FIELDS, HEADER_MEDIA_KEY, autoMap, isMissing, mediaHeaderFormat, parseHeaderMedia, resolveValue, templateTokens,
} from '../../lib/templateVars'
import { Alert, Avatar, Badge, EmptyState, Panel, PanelHead, Spinner, Table, Td, Th, inputClass } from './ui'
import { importSummary, sentenceCase } from './labels'

// Friendly labels for the standard contact fields in the mapping dropdown.
const FIELD_LABEL = { name: 'Name', company: 'Company', email: 'Email', phone: 'Phone' }

const STEPS = ['Audience', 'Template', 'Preview', 'Send']

// Words and limits for a template's photo, video or document header. The limits
// are WhatsApp's own; Meta fetches the file when it sends.
const MEDIA_HEADER = {
  IMAGE: { noun: 'photo', label: 'Header photo', hint: 'JPEG or PNG, up to 5 MB.' },
  VIDEO: { noun: 'video', label: 'Header video', hint: 'MP4 (H.264 video, AAC audio), up to 16 MB.' },
  DOCUMENT: { noun: 'document', label: 'Header document', hint: 'PDF, up to 16 MB.' },
}

// What the upload button accepts for each header type (the API checks again).
const MEDIA_ACCEPT = {
  IMAGE: { accept: 'image/jpeg,image/png', types: ['image/jpeg', 'image/png'], maxBytes: 5 * 1024 * 1024 },
  VIDEO: { accept: 'video/mp4,video/3gpp', types: ['video/mp4', 'video/3gpp'], maxBytes: 16 * 1024 * 1024 },
  DOCUMENT: { accept: 'application/pdf', types: ['application/pdf'], maxBytes: 16 * 1024 * 1024 },
}

// How fast a campaign goes out. Messages leave in batches (40 on the Free
// plan); the pause comes between batches. A paced send gives Meta's warnings
// time to arrive, and the campaign stops itself on one (see sendHalts.js).
const PACES = {
  steady: { label: 'Steady', pauseMs: 30_000, hint: 'A batch every 30 seconds, about 80 messages a minute. Recommended.' },
  gentle: { label: 'Gentle', pauseMs: 60_000, hint: 'A batch every minute, about 40 messages a minute.' },
  fast: { label: 'No pauses', pauseMs: 0, hint: 'Batches back to back. Only for small lists.' },
}
const TYPICAL_BATCH = 40

function paceEstimate(count, pace) {
  const batches = Math.max(1, Math.ceil(count / TYPICAL_BATCH))
  const seconds = batches * 4 + (batches - 1) * (PACES[pace].pauseMs / 1000)
  if (seconds < 90) return 'about a minute'
  return `about ${Math.round(seconds / 60)} minutes`
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/* ── Step 1: audience ───────────────────────────────────────────────────── */

function Dropzone({ onFile, uploading, compact = false }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]) }}
      className={`cursor-pointer rounded-xl border-[1.5px] border-dashed text-center transition
        ${compact ? 'flex items-center justify-center gap-2 px-4 py-2.5 text-[13px]' : 'px-6 py-[30px]'}
        ${dragging
          ? 'scale-[1.008] border-brand bg-brand-soft'
          : 'border-line bg-line-soft hover:border-brand hover:bg-brand-soft'}`}
    >
      {compact ? (
        // After an import: one line, so the recipients stay near the top.
        <>
          <Icon name="upload" size={16} />
          <span>Import another file</span>
        </>
      ) : (
        <>
          <div className="mx-auto mb-3 grid h-[46px] w-[46px] place-items-center rounded-xl
            bg-brand-soft text-brand-ink dark:text-[#5ba0e0]">
            {uploading ? <Spinner /> : <Icon name="upload" size={21} />}
          </div>
          <div className="mb-1 text-sm font-medium">
            {uploading ? 'Importing contacts…' : 'Drop an Excel, CSV or JSON file here'}
          </div>
          <div className="text-[12.5px] text-muted">
            We find the WhatsApp number, name, email and company columns, check every number and add
            {' '}<strong>+91</strong> when the country code is missing. You can correct the columns before
            anything is saved. Every column is kept for template variables.
          </div>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".csv,.xlsx,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }}
      />
    </div>
  )
}

const PAGE_SIZE = 25

// "‹ 26–50 of 1,379 ›" under a long list, so nobody scrolls thousands of rows.
function Pager({ page, total, onPage, size = PAGE_SIZE }) {
  if (total <= size) return null
  const pages = Math.ceil(total / size)
  const from = page * size + 1
  const to = Math.min(total, (page + 1) * size)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-2.5 text-[12.5px] text-muted">
      <span>Showing {from}–{to} of {total.toLocaleString('en-IN')}</span>
      <span className="flex items-center gap-1.5">
        <button type="button" className="secondary-button h-8 px-3" onClick={() => onPage(page - 1)} disabled={page === 0}
          aria-label="Previous page">‹ Previous</button>
        <span className="px-1">Page {page + 1} of {pages}</span>
        <button type="button" className="secondary-button h-8 px-3" onClick={() => onPage(page + 1)} disabled={page >= pages - 1}
          aria-label="Next page">Next ›</button>
      </span>
    </div>
  )
}

function matchesSearch(contact, term) {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return [contact.name, contact.phone, contact.company].some((value) => String(value ?? '').toLowerCase().includes(needle))
}

// Recipients. After a file is imported the list shows only that file's
// contacts, all selected, 25 to a page; "All contacts" shows everyone else.
function AudienceStep({
  contacts, fileContacts, fileName, loading, selected, onToggle, onSelectMany, onImported, onContinue, search, onSearch,
}) {
  const [pendingFile, setPendingFile] = useState(null)
  const [notice, setNotice] = useState(null)
  const [view, setView] = useState(fileContacts.length ? 'file' : 'all')
  const [page, setPage] = useState(0)

  useEffect(() => { if (fileContacts.length) setView('file') }, [fileContacts])
  useEffect(() => { setPage(0) }, [view, search, fileContacts])

  function handleImported(result) {
    setPendingFile(null)
    const chosen = result.contacts?.length ?? 0
    setNotice({
      tone: 'success',
      chosen,
      text: `${importSummary(result)} All ${chosen} contact${chosen === 1 ? '' : 's'} from this file are selected`
        + `${result.optedOut ? ` (${result.optedOut} who opted out were left out)` : ''}.`,
    })
    onImported(result.contacts ?? [], result.fileName)
  }

  const rows = view === 'file' ? fileContacts.filter((contact) => matchesSearch(contact, search)) : contacts
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const allSelected = rows.length > 0 && rows.every((c) => selected.has(c.id))

  return (
    <div>
      {notice && (
        <Alert tone={notice.tone}>
          <span>{notice.text}</span>
          {notice.chosen > 0 && (
            <button type="button" className="primary-button ml-3 mt-1 h-8 px-3 align-middle" onClick={onContinue}>
              Continue with {notice.chosen.toLocaleString('en-IN')} contacts
            </button>
          )}
        </Alert>
      )}

      {pendingFile
        ? <ContactImportReview file={pendingFile} onCancel={() => setPendingFile(null)} onImported={handleImported} />
        : <Dropzone onFile={(file) => { if (file) { setNotice(null); setPendingFile(file) } }} uploading={false} compact={fileContacts.length > 0} />}

      <Panel className="mt-[18px]">
        <PanelHead
          title="Recipients"
          subtitle={view === 'file'
            ? `${fileContacts.length.toLocaleString('en-IN')} from ${fileName || 'your file'}`
            : `${contacts.length.toLocaleString('en-IN')} contact${contacts.length === 1 ? '' : 's'} available`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {fileContacts.length > 0 && (
              <div className="flex overflow-hidden rounded-lg border border-line text-[12.5px]" role="group" aria-label="Which contacts to show">
                {[['file', 'This file'], ['all', 'All contacts']].map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}
                    className={`px-3 py-1.5 ${view === key ? 'bg-brand text-white' : 'bg-surface text-ink hover:bg-line-soft'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <input
              className={`${inputClass} max-w-[240px]`}
              placeholder="Search name, phone or company"
              aria-label="Search recipients"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        </PanelHead>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-line
            bg-brand-soft px-3.5 py-2.5 text-[12.8px]">
            <span><strong>{selected.size.toLocaleString('en-IN')}</strong> selected for this campaign</span>
            <button
              type="button"
              onClick={() => onSelectMany([...selected], false)}
              className="font-medium text-brand-ink underline dark:text-[#5ba0e0]"
            >
              Clear selection
            </button>
          </div>
        )}

        {loading && view === 'all' ? (
          <EmptyState>Loading contacts…</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title={search ? 'No matches' : 'No contacts yet'}>
            {search ? 'Try another name or number.' : 'Import a spreadsheet above to get started.'}
          </EmptyState>
        ) : (
          <>
            <Table
              head={
                <>
                  <Th tight>
                    <input
                      type="checkbox"
                      className="h-[15px] w-[15px] cursor-pointer accent-brand"
                      checked={allSelected}
                      onChange={(e) => onSelectMany(rows.map((c) => c.id), e.target.checked)}
                      aria-label={`Select all ${rows.length} shown`}
                    />
                  </Th>
                  <Th>Name</Th>
                  <Th>Phone</Th>
                  <Th>Company</Th>
                </>
              }
            >
              {pageRows.map((contact) => (
                <tr
                  key={contact.id}
                  onClick={() => onToggle(contact.id)}
                  className={`cursor-pointer transition-colors
                    ${selected.has(contact.id) ? 'bg-brand-soft' : 'hover:bg-line-soft'}`}
                >
                  <Td tight onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-[15px] w-[15px] cursor-pointer accent-brand"
                      checked={selected.has(contact.id)}
                      onChange={() => onToggle(contact.id)}
                      aria-label={`Select ${contact.name || contact.phone}`}
                    />
                  </Td>
                  <Td>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={contact.name} phone={contact.phone} />
                      {contact.name || <span className="text-muted">Unnamed</span>}
                    </span>
                  </Td>
                  <Td>+{contact.phone}</Td>
                  <Td className="text-muted">{contact.company || '—'}</Td>
                </tr>
              ))}
            </Table>
            <Pager page={page} total={rows.length} onPage={setPage} />
          </>
        )}
      </Panel>
    </div>
  )
}

/* ── Step 2: template ───────────────────────────────────────────────────── */

// Approved templates as cards. The chosen one is unmistakable (brand ring,
// tick and "Selected"), and the phone preview beside the cards shows exactly
// what was picked.
function TemplateStep({ templates, loading, selectedName, selectedLanguage, onSelect, preview }) {
  if (loading) return <EmptyState>Loading approved templates…</EmptyState>
  if (templates.length === 0) {
    return (
      <EmptyState title="No approved templates">
        Templates must be approved in Meta Business Manager before they can be sent.
      </EmptyState>
    )
  }

  return (
    <SplitLayout>
      <div>
        <Alert tone="info">
          Pick an approved template. You map each <strong>{'{{variable}}'}</strong> to a column of your file on the next step.
        </Alert>

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]" role="radiogroup" aria-label="Template">
          {templates.map((template) => {
            const chosen = selectedName === template.name && selectedLanguage === template.language
            return (
              <button
                type="button"
                role="radio"
                aria-checked={chosen}
                key={`${template.name}-${template.language}`}
                onClick={() => onSelect(template)}
                className={`relative rounded-xl p-[15px] text-left text-ink transition
                  ${chosen
                    ? 'border-2 border-brand bg-brand-soft shadow-[0_0_0_3px_rgba(33,102,173,0.18)]'
                    : 'border-[1.5px] border-line bg-surface hover:-translate-y-px hover:border-brand'}`}
              >
                {chosen && (
                  <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5
                    text-[11.5px] font-medium text-white">
                    <Icon name="check" size={12} /> Selected
                  </span>
                )}
                <div className={`mb-1.5 break-words text-[13.5px] font-medium ${chosen ? 'pr-[84px]' : ''}`}>{template.name}</div>
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  <Badge tone="success">{sentenceCase(template.status)}</Badge>
                  <Badge>{template.language}</Badge>
                  {template.category && <Badge tone="info">{sentenceCase(template.category)}</Badge>}
                  {mediaHeaderFormat(template) && (
                    <Badge>{`${sentenceCase(MEDIA_HEADER[mediaHeaderFormat(template)].noun)} header`}</Badge>
                  )}
                  {template.hasVariables && (
                    <Badge tone="warn">
                      {template.variables?.length ?? 0} variable{(template.variables?.length ?? 0) === 1 ? '' : 's'}
                    </Badge>
                  )}
                </div>
                <div className="line-clamp-3 text-[12.5px] leading-normal text-muted">
                  {template.bodyText}
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid place-items-center gap-2 py-2">
        <div className="text-[12px] text-muted">
          {selectedName ? <>Selected: <strong className="text-ink">{selectedName}</strong></> : 'No template selected yet'}
        </div>
        {preview}
      </div>
    </SplitLayout>
  )
}

function ReviewList({ rows }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-line">
      {rows.map(([key, value]) => (
        <div key={key} className="flex items-center justify-between gap-4 border-b border-line-soft
          bg-surface px-3.5 py-3 text-[13px] last:border-b-0">
          <span className="text-[12.5px] text-muted">{key}</span>
          <span className="break-words text-right font-medium">{value}</span>
        </div>
      ))}
    </div>
  )
}

// Two-up on wide screens, stacked below 860px so the phone mockup keeps its width.
function SplitLayout({ children }) {
  return (
    <div className="grid items-start gap-[18px] [grid-template-columns:minmax(0,1fr)] min-[860px]:[grid-template-columns:minmax(0,1fr)_auto]">
      {children}
    </div>
  )
}

/* ── Step 3: preview + variable mapping ─────────────────────────────────── */

// The <select> value encodes where a variable's value comes from:
// "attr:<header>" (an uploaded column), "field:<name>" (a contact field), or
// "literal" (fixed text typed alongside).
function sourceValue(entry) {
  if (!entry) return ''
  if (entry.source === 'literal') return 'literal'
  return `${entry.source === 'attribute' ? 'attr' : 'field'}:${entry.key}`
}

function VariableMapper({ tokens, variableMap, onChange, attributeKeys, availableFields }) {
  return (
    <div className="mb-4 overflow-hidden rounded-[10px] border border-line">
      <div className="border-b border-line bg-surface px-3 py-2 text-[12px] text-muted">
        Map variables to your columns
      </div>
      {tokens.map((token) => {
        const entry = variableMap[token]
        return (
          <div key={token} className="flex flex-wrap items-center gap-2.5 border-b border-line-soft
            bg-surface px-3.5 py-2.5 last:border-b-0">
            <code className="rounded bg-brand-soft px-1.5 py-0.5 text-[12.5px] font-medium
              text-brand-ink dark:text-[#5ba0e0]">{`{{${token}}}`}</code>
            <span className="text-muted" aria-hidden="true">→</span>
            <select
              className={`${inputClass} h-9 min-w-[150px] flex-1`}
              value={sourceValue(entry)}
              onChange={(e) => onChange(token, e.target.value)}
            >
              <option value="" disabled>Choose a source…</option>
              {attributeKeys.length > 0 && (
                <optgroup label="Columns in your file">
                  {attributeKeys.map((key) => <option key={key} value={`attr:${key}`}>{key}</option>)}
                </optgroup>
              )}
              {availableFields.length > 0 && (
                <optgroup label="Saved contact details">
                  {availableFields.map((field) => (
                    <option key={field} value={`field:${field}`}>{FIELD_LABEL[field]}</option>
                  ))}
                </optgroup>
              )}
              <option value="literal">Custom text…</option>
            </select>
            {entry?.source === 'literal' && (
              <input
                className={`${inputClass} h-9 min-w-[150px] flex-1`}
                placeholder="Same text for everyone"
                value={entry.value || ''}
                onChange={(e) => onChange(token, 'literal', e.target.value)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// What each person will actually get: their number and the value every
// variable takes from their own row, 10 to a page. A blank shows in amber.
function RecipientCheck({ tokens, variableMap, contacts }) {
  const [page, setPage] = useState(0)
  const size = 10
  useEffect(() => { setPage(0) }, [contacts.length])
  if (tokens.length === 0 || contacts.length === 0) return null
  const rows = contacts.slice(page * size, (page + 1) * size)
  return (
    <div className="mb-4 overflow-hidden rounded-[10px] border border-line">
      <div className="border-b border-line bg-surface px-3 py-2 text-[12px] text-muted">
        Check each person: every value comes from that person's own row
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-line-soft text-left text-muted">
              <th className="px-3 py-2 font-medium">Phone</th>
              {tokens.map((token) => <th key={token} className="px-3 py-2 font-medium">{`{{${token}}}`}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((contact) => (
              <tr key={contact.id} className="border-t border-line-soft">
                <td className="whitespace-nowrap px-3 py-2">+{contact.phone}</td>
                {tokens.map((token) => {
                  const value = isMissing(token, variableMap, contact) ? '' : resolveValue(token, variableMap, contact)
                  return (
                    <td key={token} className="px-3 py-2">
                      {value || <span className="rounded bg-amber-400/25 px-1">blank</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={contacts.length} onPage={setPage} size={size} />
    </div>
  )
}

// The file a photo, video or document header shows. Without it Meta refuses
// every message in the campaign, so Next stays off until it is valid. Upload
// sends the file to Meta once and fills in the media ID it returns.
function HeaderMediaField({ format, value, onChange, uploaded, onUploaded }) {
  const media = MEDIA_HEADER[format]
  const rule = MEDIA_ACCEPT[format]
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const invalid = value.trim() !== '' && !parseHeaderMedia(value)

  async function upload(file) {
    if (!file) return
    setUploadError(null)
    if (!rule.types.includes(file.type)) {
      setUploadError(format === 'VIDEO' ? 'Choose an MP4 video.' : format === 'IMAGE' ? 'Choose a JPEG or PNG image.' : 'Choose a PDF.')
      return
    }
    if (file.size > rule.maxBytes) {
      setUploadError(`The ${media.noun} must be ${rule.maxBytes / 1024 / 1024} MB or smaller.`)
      return
    }
    setUploading(true)
    try {
      const result = await apiUpload(`/campaigns/header-media?format=${format}`, file)
      onChange(result.mediaId)
      onUploaded({ name: file.name, size: file.size, url: URL.createObjectURL(file), mediaId: result.mediaId })
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mb-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="wa-header-media" className="text-[12px] text-muted">{media.label}</label>
        <button type="button" className="secondary-button h-8 px-3 text-[12.5px]"
          onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : `Upload ${media.noun}`}
        </button>
        <input ref={inputRef} type="file" className="hidden" accept={rule.accept}
          onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      <input
        id="wa-header-media"
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
        aria-describedby="wa-header-media-hint"
      />
      <p id="wa-header-media-hint" className={`m-0 mt-1 text-[12px] ${invalid || uploadError ? 'text-danger' : 'text-muted'}`}>
        {uploadError
          || (invalid
            ? 'Enter a link starting with https:// or a WhatsApp media ID (digits only).'
            : uploaded && uploaded.mediaId === value.trim()
              ? `Uploaded ${uploaded.name} (${uploaded.size < 1024 * 1024 ? `${Math.max(1, Math.round(uploaded.size / 1024))} KB` : `${(uploaded.size / 1024 / 1024).toFixed(1)} MB`}) to WhatsApp. Meta keeps it for about 30 days.`
              : `Upload the ${media.noun}, or paste a public https link to it or its WhatsApp media ID. ${media.hint} Everyone gets the same ${media.noun}.`)}
      </p>
    </div>
  )
}

function SamplePreview({ template, variableMap, sampleContacts, sampleIndex, onSampleIndex, mediaPreview }) {
  const total = sampleContacts.length
  const index = Math.min(sampleIndex, Math.max(0, total - 1))
  const contact = total ? sampleContacts[index] : null
  const label = contact ? (contact.name || `+${contact.phone}`) : '—'

  return (
    <div className="grid place-items-center gap-2 py-2">
      {total > 1 && (
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <button type="button" className="secondary-button h-7 px-2"
            onClick={() => onSampleIndex(index - 1)} disabled={index <= 0}>‹</button>
          <span>Previewing <strong className="text-ink">{label}</strong> · {index + 1}/{total}</span>
          <button type="button" className="secondary-button h-7 px-2"
            onClick={() => onSampleIndex(index + 1)} disabled={index >= total - 1}>›</button>
        </div>
      )}
      <WhatsAppPreview template={template} variableMap={variableMap} sampleContact={contact} mediaPreview={mediaPreview} />
    </div>
  )
}

function PreviewStep({
  template, campaignName, onCampaignName, recipientCount,
  tokens, variableMap, onVariableChange, attributeKeys, availableFields,
  sampleContacts, sampleIndex, onSampleIndex, headerMedia, onHeaderMedia, headerUpload, onHeaderUpload,
}) {
  const hasVars = tokens.length > 0
  const mediaFormat = mediaHeaderFormat(template)
  const gaps = hasVars
    ? tokens
      .map((token) => ({ token, missing: sampleContacts.filter((ct) => isMissing(token, variableMap, ct)).length }))
      .filter((gap) => gap.missing > 0)
    : []

  return (
    <SplitLayout>
      <div>
        <div className="mb-4">
          <label htmlFor="wa-campaign-name"
            className="mb-1 block text-[12px] text-muted">
            Campaign name
          </label>
          <input
            id="wa-campaign-name"
            className={inputClass}
            value={campaignName}
            onChange={(e) => onCampaignName(e.target.value)}
          />
        </div>

        {mediaFormat && (
          <HeaderMediaField format={mediaFormat} value={headerMedia} onChange={onHeaderMedia}
            uploaded={headerUpload} onUploaded={onHeaderUpload} />
        )}

        {hasVars && (
          <VariableMapper
            tokens={tokens}
            variableMap={variableMap}
            onChange={onVariableChange}
            attributeKeys={attributeKeys}
            availableFields={availableFields}
          />
        )}

        {hasVars && <RecipientCheck tokens={tokens} variableMap={variableMap} contacts={sampleContacts} />}

        {gaps.length > 0 && (
          <Alert tone="warn">
            {gaps.map((gap) => `${gap.missing} recipient${gap.missing === 1 ? '' : 's'} `
              + `have no value for {{${gap.token}}}`).join('; ')}
            . They'll see a blank there unless you pick another column or add custom text.
          </Alert>
        )}

        <ReviewList rows={[
          ['Template', template?.name ?? '—'],
          ['Language', template?.language ?? '—'],
          ['Recipients', recipientCount],
          ...(mediaFormat ? [[MEDIA_HEADER[mediaFormat].label, parseHeaderMedia(headerMedia) ? 'Added' : 'Not added yet']] : []),
          ['Variables', hasVars ? `${tokens.length} mapped to your columns` : 'None — static template'],
        ]} />
      </div>

      <SamplePreview
        template={template}
        variableMap={variableMap}
        sampleContacts={sampleContacts}
        sampleIndex={sampleIndex}
        onSampleIndex={onSampleIndex}
        mediaPreview={headerUpload && headerUpload.mediaId === headerMedia.trim() ? headerUpload.url : null}
      />
    </SplitLayout>
  )
}

/* ── Step 4: send ───────────────────────────────────────────────────────── */

function SendStep({
  result, error, sending, resuming, sendProgress, partial, halted, stopped, template, recipientCount, campaignName,
  variableMap, sampleContact, pace, onPace, onStop, stopRequested, mediaPreview,
}) {
  if (sending) {
    const done = sendProgress ? sendProgress.sent + sendProgress.failed : 0
    const total = sendProgress?.total || recipientCount
    const waiting = sendProgress?.waitSeconds > 0
    return (
      <div className="grid place-items-center gap-3 px-4 py-8 text-center">
        <Spinner className="text-brand-ink" />
        <div className="text-[15px] font-medium text-ink">
          {stopRequested ? 'Stopping after this batch…' : resuming ? 'Resuming campaign…' : 'Sending campaign…'}
        </div>
        <div className="w-full max-w-[420px]">
          <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar"
            aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${total ? Math.min(100, (done / total) * 100) : 0}%` }} />
          </div>
          <div className="mt-2 text-[12.5px] text-muted">
            {done} of {total} done
            {sendProgress && <> · {sendProgress.sent} accepted by Meta{sendProgress.failed > 0 && <>, {sendProgress.failed} failed</>}</>}
            {waiting && !stopRequested && <> · next batch in {sendProgress.waitSeconds}s</>}
          </div>
        </div>
        <p className="m-0 max-w-[460px] text-[12px] text-muted">
          Keep this tab open while it sends. If Meta reports a spam or account problem, sending stops by itself.
        </p>
        {!stopRequested && (
          <button type="button" className="secondary-button" onClick={onStop}>Stop sending</button>
        )}
      </div>
    )
  }

  if (halted && partial) {
    return (
      <Alert tone="error">
        <strong>Sending stopped by itself.</strong> {halted.reason} Campaign #{partial.campaignId} reached{' '}
        {partial.totalSent} people; <strong>{partial.remaining.length} were not sent</strong>
        {halted.resumable
          ? '. When it is fixed, resume to send to them. No one already messaged gets it twice.'
          : '. They stay on the campaign: once the problem is fixed, send them from Campaigns, Unsent. Do not resume today.'}
      </Alert>
    )
  }

  if (stopped && partial) {
    return (
      <Alert tone="info">
        Stopped. Campaign #{partial.campaignId} reached {partial.totalSent} people; {partial.remaining.length} are
        still to send. Resume whenever you are ready; no one already messaged gets it twice.
      </Alert>
    )
  }

  if (error && partial) {
    const done = partial.totalSent + partial.totalFailed
    return (
      <Alert tone="error">
        {error} Campaign #{partial.campaignId} got through <strong>{done} / {done + partial.remaining.length}</strong> before
        this failed. Resuming continues with the remaining {partial.remaining.length} rather than starting over, so
        no one already messaged gets a duplicate.
      </Alert>
    )
  }

  if (error) return <Alert tone="error">{error}</Alert>

  if (result) {
    return (
      <>
        <Alert tone={result.sent > 0 ? 'success' : 'error'}>
          Campaign #{result.campaignId} finished: <strong>{result.sent} accepted by Meta</strong>
          {result.failed > 0 && <>, <strong>{result.failed} failed</strong></>}.
          {result.firstError && <> First error: {result.firstError}</>}
        </Alert>
        <ReviewList rows={[
          ['Accepted by Meta', `${result.sent} / ${result.total}`],
          ['Failed', result.failed],
          ['Delivery receipts', 'Tracked live via webhook'],
        ]} />
        <p className="mt-3 text-[12px] text-muted">
          Accepted is not delivered: Meta can still hold a marketing message back (error 131049) when a person has
          had many recently. Delivered and read counts update on the Campaigns page. People who tap Stop promotions
          are opted out automatically.
        </p>
      </>
    )
  }

  return (
    <SplitLayout>
      <div>
        <Alert tone="info">
          This sends real WhatsApp messages and consumes Meta message credits.
        </Alert>
        <fieldset className="mb-4 rounded-[10px] border border-line px-3.5 pb-3 pt-2">
          <legend className="px-1 text-[12px] text-muted">Sending pace</legend>
          {Object.entries(PACES).map(([key, option]) => (
            <label key={key} className="flex cursor-pointer items-start gap-2.5 py-1.5 text-[13px]">
              <input type="radio" name="wa-pace" value={key} checked={pace === key} onChange={() => onPace(key)}
                className="mt-[3px] accent-brand" />
              <span>
                <span className="font-medium text-ink">{option.label}</span>
                <span className="block text-[12px] text-muted">{option.hint}</span>
              </span>
            </label>
          ))}
          <p className="m-0 mt-1 text-[12px] text-muted">
            {recipientCount} message{recipientCount === 1 ? '' : 's'} at this pace take {paceEstimate(recipientCount, pace)}.
            Sending stops by itself if Meta reports a spam limit, a paused template or an account block.
          </p>
        </fieldset>
        <ReviewList rows={[
          ['Campaign', campaignName || '—'],
          ['Template', template?.name ?? '—'],
          ['Recipients', recipientCount],
        ]} />
      </div>
      <div className="grid place-items-center py-2">
        <WhatsAppPreview template={template} variableMap={variableMap} sampleContact={sampleContact} mediaPreview={mediaPreview} />
      </div>
    </SplitLayout>
  )
}

/* ── Wizard shell ───────────────────────────────────────────────────────── */

function Stepper({ step }) {
  return (
    <div className="flex items-center overflow-x-auto border-b border-line px-[18px] py-4">
      {STEPS.map((label, index) => {
        const done = index < step
        const active = index === step
        return (
          <div key={label} className="flex items-center">
            {index > 0 && (
              <span className={`mx-3 h-[1.5px] w-[42px] shrink-0
                ${index <= step ? 'bg-tint-ok-line' : 'bg-line'}`} />
            )}
            <div className="flex shrink-0 items-center gap-2.5">
              <span className={`grid h-[27px] w-[27px] place-items-center rounded-full border
                text-xs font-medium transition
                ${active ? 'border-brand bg-brand text-white ring-4 ring-brand-soft' : ''}
                ${done ? 'border-tint-ok-line bg-tint-ok text-ok' : ''}
                ${!active && !done ? 'border-line bg-line-soft text-muted' : ''}`}>
                {done ? <Icon name="check" size={13} /> : index + 1}
              </span>
              <span className={`whitespace-nowrap text-[12.5px] font-medium
                ${active ? 'text-ink' : 'text-muted'}`}>
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function CampaignWizard({ onDone }) {
  const [step, setStep] = useState(0)

  const [loadedContacts, setLoadedContacts] = useState([])
  // The contacts of a file imported here. The list endpoint returns the newest
  // 2,000, which can leave out older people in the file, so they are kept too.
  const [fileContacts, setFileContacts] = useState([])
  const [fileName, setFileName] = useState('')
  const [contactsLoading, setContactsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const contacts = useMemo(() => {
    if (search.trim() || fileContacts.length === 0) return loadedContacts
    const ids = new Set(fileContacts.map((contact) => contact.id))
    return [...fileContacts, ...loadedContacts.filter((contact) => !ids.has(contact.id))]
  }, [search, fileContacts, loadedContacts])

  const [templates, setTemplates] = useState([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [template, setTemplate] = useState(null)

  const [campaignName, setCampaignName] = useState('')
  const [variableMap, setVariableMap] = useState({})
  // The file for a photo, video or document header, as typed or as the media ID
  // an upload returned (headerUpload keeps that file for the preview).
  const [headerMedia, setHeaderMedia] = useState('')
  const [headerUpload, setHeaderUpload] = useState(null)
  const [pace, setPace] = useState('steady')
  const [halted, setHalted] = useState(null)
  const [stopped, setStopped] = useState(false)
  const [stopRequested, setStopRequested] = useState(false)
  const [resuming, setResuming] = useState(false)
  const stopRef = useRef(false)
  const [sampleIndex, setSampleIndex] = useState(0)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  // The contacts backing the preview + variable options: those selected (falling
  // back to the loaded list if a search has scrolled the selection out of view).
  const sampleContacts = useMemo(() => {
    const chosen = contacts.filter((contact) => selected.has(contact.id))
    return chosen.length ? chosen : contacts
  }, [contacts, selected])

  // Distinct uploaded-column headers across those contacts — the file variables.
  const attributeKeys = useMemo(() => {
    const keys = []
    const seen = new Set()
    for (const contact of sampleContacts) {
      for (const key of Object.keys(contact.attributes || {})) {
        if (!seen.has(key)) { seen.add(key); keys.push(key) }
      }
    }
    return keys
  }, [sampleContacts])

  const availableFields = useMemo(
    () => CONTACT_FIELDS.filter((field) => sampleContacts.some((contact) => contact[field])),
    [sampleContacts],
  )

  const tokens = useMemo(() => templateTokens(template), [template])

  async function loadContacts(term = search) {
    setContactsLoading(true)
    try {
      const data = await apiGet(`/contacts?search=${encodeURIComponent(term)}`)
      // The send endpoint skips opted-out contacts, so don't offer them here —
      // otherwise the selected count would not match the number actually sent.
      setLoadedContacts(data.contacts.filter((contact) => !contact.opted_out))
    } catch (err) {
      setError(err.message)
    } finally {
      setContactsLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => loadContacts(search), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => {
    apiGet('/templates')
      .then((data) => {
        setTemplates(data.templates)
        // Preselect when there is only one approved template to choose from.
        if (data.templates.length === 1) setTemplate(data.templates[0])
      })
      .catch((err) => setError(err.message))
      .finally(() => setTemplatesLoading(false))
  }, [])

  // Auto-map the template's variables to the best-matching columns whenever the
  // chosen template changes. Keyed on the template only, so a later selection
  // change (which shifts attributeKeys) never discards manual mappings.
  useEffect(() => {
    setSampleIndex(0)
    setHeaderMedia('')
    setHeaderUpload(null)
    if (template && tokens.length) {
      setVariableMap(autoMap(tokens, { fields: availableFields, attributeKeys }))
    } else {
      setVariableMap({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template])

  // Columns can arrive after the template was chosen (contacts still loading,
  // or a file imported later). Fill any variable still unmapped, never one the
  // person already set.
  useEffect(() => {
    if (!template || tokens.length === 0) return
    setVariableMap((prev) => {
      const missing = tokens.filter((token) => !prev[token])
      if (missing.length === 0) return prev
      const guess = autoMap(tokens, { fields: availableFields, attributeKeys })
      const found = missing.filter((token) => guess[token])
      if (found.length === 0) return prev
      return { ...prev, ...Object.fromEntries(found.map((token) => [token, guess[token]])) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attributeKeys, availableFields])

  // Frees the preview copy of an uploaded header file.
  useEffect(() => () => { if (headerUpload?.url) URL.revokeObjectURL(headerUpload.url) }, [headerUpload])

  function handleVariableChange(token, value, literalText) {
    setVariableMap((prev) => {
      const next = { ...prev }
      if (value === 'literal') {
        next[token] = { source: 'literal', value: literalText ?? prev[token]?.value ?? '' }
      } else {
        const [kind, ...rest] = value.split(':')
        next[token] = { source: kind === 'attr' ? 'attribute' : 'field', key: rest.join(':') }
      }
      return next
    })
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const recipientCount = selected.size
  const allMapped = tokens.every((token) => variableMap[token])
  const mediaFormat = mediaHeaderFormat(template)
  const headerMediaReady = !mediaFormat || Boolean(parseHeaderMedia(headerMedia))
  const canAdvance = useMemo(() => {
    if (step === 0) return recipientCount > 0
    if (step === 1) return Boolean(template)
    if (step === 2) return campaignName.trim().length > 0 && allMapped && headerMediaReady
    return false
  }, [step, recipientCount, template, campaignName, allMapped, headerMediaReady])

  const [sendProgress, setSendProgress] = useState(null)
  // Snapshot of an in-progress campaign that stopped mid-way (a batch call
  // threw). Kept in state — not a local var — so a transient failure can be
  // resumed from where it left off instead of the recipient re-clicking
  // "Send" and re-sending to everyone from scratch (real duplicate WhatsApp
  // messages to whoever already got through, which risks the number's
  // quality rating / messaging limits with Meta).
  const [partial, setPartial] = useState(null)

  // A media header's file rides in the variable map (HEADER_MEDIA_KEY), so the
  // campaign keeps it for /send-batch and for a later retry.
  function sharedSendPayload() {
    return {
      templateName: template.name,
      templateLanguage: template.language,
      templateHeader: template.headerText || '',
      templateHeaderFormat: template.headerFormat || '',
      templateBody: template.bodyText || '',
      variableMap: mediaFormat
        ? { ...variableMap, [HEADER_MEDIA_KEY]: { source: 'media', value: headerMedia.trim() } }
        : variableMap,
    }
  }

  // A single flaky round trip shouldn't force a manual resume — retry a
  // couple of times with backoff before surfacing it as an error.
  async function postWithRetry(path, payload, attempts = 3) {
    for (let i = 1; i <= attempts; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await apiPost(path, payload)
      } catch (err) {
        if (i === attempts) throw err
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 1000 * i))
      }
    }
    return undefined
  }

  // Waits between batches, a second at a time so Stop takes effect at once and
  // the countdown stays honest even when a background tab slows the timers.
  async function pauseBetweenBatches(ms, progress) {
    const end = Date.now() + ms
    while (!stopRef.current && Date.now() < end) {
      setSendProgress({ ...progress, waitSeconds: Math.ceil((end - Date.now()) / 1000) })
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.min(1000, end - Date.now()))
    }
    setSendProgress({ ...progress, waitSeconds: 0 })
  }

  // Drives /send-batch until `remaining` is empty, accumulating on top of
  // whatever was already sent (0 for a fresh send, or a resumed campaign's
  // running totals), pausing between batches at the chosen pace. Updates
  // `partial` before every batch so a mid-loop failure, a Stop or a halt
  // always leaves enough to resume from exactly this point. Returns null when
  // the run ended early (stopped or halted), else the finished result.
  async function driveBatches(firstResponse, shared, seed = { sent: 0, failed: 0, firstError: null }) {
    let data = firstResponse
    let totalSent = seed.sent + data.sent
    let totalFailed = seed.failed + data.failed
    let firstError = seed.firstError || data.firstError
    let batch = 1
    const total = seed.sent + seed.failed + recipientTotal(firstResponse)

    while (data.remaining?.length > 0) {
      batch += 1
      const progress = { sent: totalSent, failed: totalFailed, batch, total }
      setPartial({ campaignId: data.campaignId, remaining: data.remaining, totalSent, totalFailed, firstError })
      setSendProgress(progress)
      // eslint-disable-next-line no-await-in-loop
      if (PACES[pace].pauseMs > 0) await pauseBetweenBatches(PACES[pace].pauseMs, progress)
      if (stopRef.current) { setStopped(true); return null }

      // eslint-disable-next-line no-await-in-loop
      data = await postWithRetry('/campaigns/send-batch', {
        campaignId: data.campaignId,
        contactIds: data.remaining,
        ...shared,
      })

      totalSent += data.sent
      totalFailed += data.failed
      if (!firstError && data.firstError) firstError = data.firstError
      setSendProgress({ sent: totalSent, failed: totalFailed, batch, total })
    }

    // Meta reported a stop-the-campaign error: the API sent `notSent` instead
    // of `remaining`, so the loop above has ended.
    if (data.halted) {
      setPartial({ campaignId: data.campaignId, remaining: data.notSent ?? [], totalSent, totalFailed, firstError })
      setHalted(data.halted)
      return null
    }

    setPartial(null)
    return {
      campaignId: data.campaignId, total: totalSent + totalFailed, sent: totalSent, failed: totalFailed, firstError,
    }
  }

  // Everyone this run will reach: the first batch plus what it handed back.
  function recipientTotal(response) {
    return response.sent + response.failed + (response.remaining?.length ?? response.notSent?.length ?? 0)
  }

  function resetRunState() {
    stopRef.current = false
    setStopRequested(false)
    setStopped(false)
    setHalted(null)
    setError(null)
  }

  function requestStop() {
    stopRef.current = true
    setStopRequested(true)
  }

  async function send() {
    if (sending) return
    setSending(true)
    setResuming(false)
    resetRunState()
    setSendProgress({ sent: 0, failed: 0, batch: 1, total: recipientCount })
    setPartial(null)
    try {
      const shared = sharedSendPayload()
      // First request creates the campaign and sends the first batch.
      const initial = await postWithRetry('/campaigns/send', {
        name: campaignName.trim(),
        contactIds: [...selected],
        ...shared,
      })
      const finished = await driveBatches(initial, shared)
      if (finished) setResult(finished)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
      setSendProgress(null)
    }
  }

  // Continues a campaign left mid-way by `partial`, instead of starting a
  // new one over the full original recipient list.
  async function resumeSend() {
    if (sending || !partial) return
    setSending(true)
    setResuming(true)
    resetRunState()
    try {
      const shared = sharedSendPayload()
      const next = await postWithRetry('/campaigns/send-batch', {
        campaignId: partial.campaignId,
        contactIds: partial.remaining,
        ...shared,
      })
      const finished = await driveBatches(next, shared, {
        sent: partial.totalSent, failed: partial.totalFailed, firstError: partial.firstError,
      })
      if (finished) setResult(finished)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
      setSendProgress(null)
    }
  }

  function discardPartial() {
    if (!window.confirm(
      `Campaign #${partial.campaignId} already sent to ${partial.totalSent + partial.totalFailed} of `
      + `${partial.totalSent + partial.totalFailed + partial.remaining.length} recipients. Starting a new `
      + 'campaign will re-message everyone in your current selection, including those already sent to. Continue?',
    )) return
    setPartial(null)
    resetRunState()
  }

  return (
    <Panel>
      <Stepper step={step} />

      <div className="p-[18px]">
        {step === 0 && (
          <AudienceStep
            contacts={contacts}
            fileContacts={fileContacts}
            fileName={fileName}
            loading={contactsLoading}
            selected={selected}
            onToggle={toggle}
            onSelectMany={(ids, checked) => setSelected((prev) => {
              const next = new Set(prev)
              for (const id of ids) { if (checked) next.add(id); else next.delete(id) }
              return next
            })}
            onImported={(imported, name) => {
              setFileContacts(imported)
              setFileName(name || '')
              setSearch('')
              setSelected(new Set(imported.map((contact) => contact.id)))
              loadContacts('')
            }}
            onContinue={() => setStep(1)}
            search={search}
            onSearch={setSearch}
          />
        )}
        {step === 1 && (
          <TemplateStep
            templates={templates}
            loading={templatesLoading}
            selectedName={template?.name}
            selectedLanguage={template?.language}
            onSelect={setTemplate}
            preview={(
              <WhatsAppPreview template={template} variableMap={variableMap}
                sampleContact={sampleContacts[0] ?? null} />
            )}
          />
        )}
        {step === 2 && (
          <PreviewStep
            template={template}
            campaignName={campaignName}
            onCampaignName={setCampaignName}
            recipientCount={recipientCount}
            tokens={tokens}
            variableMap={variableMap}
            onVariableChange={handleVariableChange}
            attributeKeys={attributeKeys}
            availableFields={availableFields}
            sampleContacts={sampleContacts}
            sampleIndex={sampleIndex}
            onSampleIndex={setSampleIndex}
            headerMedia={headerMedia}
            onHeaderMedia={setHeaderMedia}
            headerUpload={headerUpload}
            onHeaderUpload={setHeaderUpload}
          />
        )}
        {step === 3 && (
          <SendStep
            result={result}
            error={error}
            sending={sending}
            resuming={resuming}
            sendProgress={sendProgress}
            partial={partial}
            halted={halted}
            stopped={stopped}
            template={template}
            recipientCount={recipientCount}
            campaignName={campaignName}
            variableMap={variableMap}
            sampleContact={sampleContacts[Math.min(sampleIndex, Math.max(0, sampleContacts.length - 1))] || null}
            pace={pace}
            onPace={setPace}
            onStop={requestStop}
            stopRequested={stopRequested}
            mediaPreview={headerUpload && headerUpload.mediaId === headerMedia.trim() ? headerUpload.url : null}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3.5 border-t border-line
        bg-line-soft px-[18px] py-3.5">
        <span className="text-[12.5px] text-muted">
          <strong className="font-medium text-ink">{recipientCount}</strong>
          {' '}recipient{recipientCount === 1 ? '' : 's'}
          {template && <> · template <strong className="font-medium text-ink">{template.name}</strong></>}
        </span>

        <div className="flex items-center gap-2.5">
          {result || (halted && !halted.resumable && !sending) ? (
            <button type="button" className="primary-button" onClick={onDone}>
              Back to campaigns
            </button>
          ) : (
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={() => (step === 0 ? onDone() : setStep((s) => s - 1))}
                disabled={sending}
              >
                {step === 0 ? 'Cancel' : 'Back'}
              </button>

              {step < 3 ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setStep((s) => s + 1)}
                  disabled={!canAdvance}
                >
                  Continue
                </button>
              ) : sending ? (
                <button type="button" className="primary-button" disabled>
                  {resuming ? 'Resuming…' : 'Sending…'}
                </button>
              ) : partial ? (
                <>
                  <button type="button" className="secondary-button" onClick={discardPartial} disabled={sending}>
                    Start over instead
                  </button>
                  <button type="button" className="primary-button" onClick={resumeSend} disabled={sending}>
                    {sending ? 'Resuming…' : `Resume — ${partial.remaining.length} left`}
                  </button>
                </>
              ) : (
                <button type="button" className="primary-button" onClick={send} disabled={sending}>
                  {sending ? 'Sending…' : `Send campaign to ${recipientCount}`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Panel>
  )
}
