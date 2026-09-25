import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { apiGet, apiPost, apiUpload } from '../../lib/api'
import { WhatsAppPreview } from './WhatsAppPreview'
import {
  CONTACT_FIELDS, autoMap, isMissing, templateTokens,
} from '../../lib/templateVars'
import {
  Alert, Avatar, Badge, EmptyState, Panel, PanelHead, Spinner, Table, Td, Th, inputClass,
} from './ui'

// Friendly labels for the standard contact fields in the mapping dropdown.
const FIELD_LABEL = { name: 'Name', company: 'Company', email: 'Email', phone: 'Phone' }

const STEPS = ['Audience', 'Template', 'Preview', 'Send']

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
        ${compact ? 'px-6 py-6' : 'px-6 py-[30px]'}
        ${dragging
          ? 'scale-[1.008] border-brand bg-brand-soft'
          : 'border-line bg-line-soft hover:border-brand hover:bg-brand-soft'}`}
    >
      <div className="mx-auto mb-3 grid h-[46px] w-[46px] place-items-center rounded-xl
        bg-brand-soft text-brand dark:text-[#5ba0e0]">
        {uploading ? <Spinner /> : <Icon name="upload" size={21} />}
      </div>
      <div className="mb-1 text-sm font-semibold">
        {uploading ? 'Importing contacts…' : 'Drop an Excel, CSV or JSON file here'}
      </div>
      <div className="text-[12.5px] text-muted">
        We auto-detect the phone column (any name works) and add <strong>+91</strong> when the
        country code is missing. Every other column is saved for use as a variable.
      </div>
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

function AudienceStep({ contacts, loading, selected, onToggle, onSelectAll, onImported, search, onSearch }) {
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState(null)

  async function handleFile(file) {
    if (!file) return
    setUploading(true)
    setNotice(null)
    try {
      const result = await apiUpload('/contacts/import', file)
      setNotice({
        tone: 'success',
        text: `Imported ${result.imported} new contact${result.imported === 1 ? '' : 's'}`
          + `${result.updated ? `, refreshed ${result.updated}` : ''}. `
          + `${result.invalid} row(s) had no usable phone number. `
          + `Phone read from “${result.phoneColumn}”.`,
      })
      onImported()
    } catch (err) {
      setNotice({ tone: 'error', text: err.message })
    } finally {
      setUploading(false)
    }
  }

  const allSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id))

  return (
    <div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <Dropzone onFile={handleFile} uploading={uploading} />

      <Panel className="mt-[18px]">
        <PanelHead
          title="Select recipients"
          subtitle={`${contacts.length} contact${contacts.length === 1 ? '' : 's'} available`}
        >
          <input
            className={`${inputClass} max-w-[260px]`}
            placeholder="Search name, phone or company"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </PanelHead>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-line
            bg-brand-soft px-3.5 py-2.5 text-[12.8px]">
            <span><strong>{selected.size}</strong> selected</span>
            <button
              type="button"
              onClick={() => onSelectAll(false)}
              className="font-semibold text-brand underline dark:text-[#5ba0e0]"
            >
              Clear selection
            </button>
          </div>
        )}

        {loading ? (
          <EmptyState>Loading contacts…</EmptyState>
        ) : contacts.length === 0 ? (
          <EmptyState title="No contacts yet">Import a spreadsheet above to get started.</EmptyState>
        ) : (
          <Table
            head={
              <>
                <Th tight>
                  <input
                    type="checkbox"
                    className="h-[15px] w-[15px] cursor-pointer accent-brand"
                    checked={allSelected}
                    onChange={(e) => onSelectAll(e.target.checked)}
                    aria-label="Select all contacts"
                  />
                </Th>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Company</Th>
              </>
            }
          >
            {contacts.map((contact) => (
              <tr
                key={contact.id}
                onClick={() => onToggle(contact.id)}
                className={`cursor-pointer transition-colors hover:bg-brand-soft
                  ${selected.has(contact.id) ? 'bg-brand-soft' : ''}`}
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
        )}
      </Panel>
    </div>
  )
}

/* ── Step 2: template ───────────────────────────────────────────────────── */

function TemplateStep({ templates, loading, selectedName, onSelect }) {
  if (loading) return <EmptyState>Loading approved templates…</EmptyState>
  if (templates.length === 0) {
    return (
      <EmptyState title="No approved templates">
        Templates must be approved in Meta Business Manager before they can be sent.
      </EmptyState>
    )
  }

  return (
    <>
      <Alert tone="info">
        Pick an approved template. Templates with <strong>{'{{variables}}'}</strong> are
        supported — you'll map each one to a contact column on the next step.
      </Alert>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {templates.map((template) => (
          <button
            type="button"
            key={`${template.name}-${template.language}`}
            onClick={() => onSelect(template)}
            className={`rounded-xl border-[1.5px] bg-surface p-[15px] text-left text-ink transition
              ${selectedName === template.name
                ? 'border-brand bg-brand-soft'
                : 'border-line hover:-translate-y-px hover:border-brand'}`}
          >
            <div className="mb-1.5 break-words text-[13.5px] font-semibold">{template.name}</div>
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              <Badge tone="success">{template.status}</Badge>
              <Badge>{template.language}</Badge>
              {template.category && <Badge tone="info">{template.category}</Badge>}
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
        ))}
      </div>
    </>
  )
}

/* ── Review rows, shared by steps 3 and 4 ───────────────────────────────── */

function ReviewList({ rows }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-line">
      {rows.map(([key, value]) => (
        <div key={key} className="flex items-center justify-between gap-4 border-b border-line-soft
          bg-surface px-3.5 py-3 text-[13px] last:border-b-0">
          <span className="text-[12.5px] text-muted">{key}</span>
          <span className="break-words text-right font-semibold">{value}</span>
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
      <div className="border-b border-line bg-line-soft px-3.5 py-2 text-[11px] font-bold
        uppercase tracking-[0.5px] text-muted">
        Map variables to your columns
      </div>
      {tokens.map((token) => {
        const entry = variableMap[token]
        return (
          <div key={token} className="flex flex-wrap items-center gap-2.5 border-b border-line-soft
            bg-surface px-3.5 py-2.5 last:border-b-0">
            <code className="rounded bg-brand-soft px-1.5 py-0.5 text-[12.5px] font-semibold
              text-brand dark:text-[#5ba0e0]">{`{{${token}}}`}</code>
            <span className="text-muted" aria-hidden="true">→</span>
            <select
              className={`${inputClass} h-9 min-w-[150px] flex-1`}
              value={sourceValue(entry)}
              onChange={(e) => onChange(token, e.target.value)}
            >
              <option value="" disabled>Choose a source…</option>
              {attributeKeys.length > 0 && (
                <optgroup label="From your file">
                  {attributeKeys.map((key) => <option key={key} value={`attr:${key}`}>{key}</option>)}
                </optgroup>
              )}
              {availableFields.length > 0 && (
                <optgroup label="Contact fields">
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

function SamplePreview({ template, variableMap, sampleContacts, sampleIndex, onSampleIndex }) {
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
      <WhatsAppPreview template={template} variableMap={variableMap} sampleContact={contact} />
    </div>
  )
}

function PreviewStep({
  template, campaignName, onCampaignName, recipientCount,
  tokens, variableMap, onVariableChange, attributeKeys, availableFields,
  sampleContacts, sampleIndex, onSampleIndex,
}) {
  const hasVars = tokens.length > 0
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
            className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.5px] text-muted">
            Campaign name
          </label>
          <input
            id="wa-campaign-name"
            className={inputClass}
            value={campaignName}
            onChange={(e) => onCampaignName(e.target.value)}
            placeholder="e.g. September Offer — Mumbai list"
          />
        </div>

        {hasVars && (
          <VariableMapper
            tokens={tokens}
            variableMap={variableMap}
            onChange={onVariableChange}
            attributeKeys={attributeKeys}
            availableFields={availableFields}
          />
        )}

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
          ['Variables', hasVars ? `${tokens.length} mapped to your columns` : 'None — static template'],
        ]} />
      </div>

      <SamplePreview
        template={template}
        variableMap={variableMap}
        sampleContacts={sampleContacts}
        sampleIndex={sampleIndex}
        onSampleIndex={onSampleIndex}
      />
    </SplitLayout>
  )
}

/* ── Step 4: send ───────────────────────────────────────────────────────── */

function SendStep({
  result, error, sending, sendProgress, partial, template, recipientCount, campaignName, variableMap, sampleContact,
}) {
  if (sending) {
    return (
      <EmptyState>
        <Spinner className="text-brand" />
        <div className="mb-1.5 mt-3 text-[15px] font-semibold text-ink">
          {partial ? 'Resuming campaign…' : 'Sending campaign…'}
        </div>
        {sendProgress
          ? <>{sendProgress.sent + sendProgress.failed} / {recipientCount} processed (batch {sendProgress.batch})…</>
          : <>Delivering {recipientCount} message{recipientCount === 1 ? '' : 's'} through the Meta Cloud API.</>}
      </EmptyState>
    )
  }

  if (error && partial) {
    const done = partial.totalSent + partial.totalFailed
    return (
      <Alert tone="error">
        {error} Campaign #{partial.campaignId} got through <strong>{done} / {done + partial.remaining.length}</strong> before
        this failed — resuming will continue with the remaining {partial.remaining.length} rather than starting over, so
        no one already messaged gets a duplicate.
      </Alert>
    )
  }

  if (error) return <Alert tone="error">{error}</Alert>

  if (result) {
    return (
      <>
        <Alert tone={result.sent > 0 ? 'success' : 'error'}>
          Campaign #{result.campaignId} finished — <strong>{result.sent} sent</strong>
          {result.failed > 0 && <>, <strong>{result.failed} failed</strong></>}.
          {result.firstError && <> First error: {result.firstError}</>}
        </Alert>
        <ReviewList rows={[
          ['Accepted by Meta', `${result.sent} / ${result.total}`],
          ['Failed', result.failed],
          ['Delivery receipts', 'Tracked live via webhook'],
        ]} />
      </>
    )
  }

  return (
    <SplitLayout>
      <div>
        <Alert tone="info">
          This sends real WhatsApp messages and consumes Meta message credits.
        </Alert>
        <ReviewList rows={[
          ['Campaign', campaignName || '—'],
          ['Template', template?.name ?? '—'],
          ['Recipients', recipientCount],
        ]} />
      </div>
      <div className="grid place-items-center py-2">
        <WhatsAppPreview template={template} variableMap={variableMap} sampleContact={sampleContact} />
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
                text-xs font-bold transition
                ${active ? 'border-brand bg-brand text-white ring-4 ring-brand-soft' : ''}
                ${done ? 'border-tint-ok-line bg-tint-ok text-ok' : ''}
                ${!active && !done ? 'border-line bg-line-soft text-muted' : ''}`}>
                {done ? <Icon name="check" size={13} /> : index + 1}
              </span>
              <span className={`whitespace-nowrap text-[12.5px] font-semibold
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

  const [contacts, setContacts] = useState([])
  const [contactsLoading, setContactsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())

  const [templates, setTemplates] = useState([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [template, setTemplate] = useState(null)

  const [campaignName, setCampaignName] = useState('')
  const [variableMap, setVariableMap] = useState({})
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
      setContacts(data.contacts.filter((contact) => !contact.opted_out))
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
    if (template && tokens.length) {
      setVariableMap(autoMap(tokens, { fields: availableFields, attributeKeys }))
    } else {
      setVariableMap({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template])

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
  const canAdvance = useMemo(() => {
    if (step === 0) return recipientCount > 0
    if (step === 1) return Boolean(template)
    if (step === 2) return campaignName.trim().length > 0 && allMapped
    return false
  }, [step, recipientCount, template, campaignName, allMapped])

  const [sendProgress, setSendProgress] = useState(null)
  // Snapshot of an in-progress campaign that stopped mid-way (a batch call
  // threw). Kept in state — not a local var — so a transient failure can be
  // resumed from where it left off instead of the recipient re-clicking
  // "Send" and re-sending to everyone from scratch (real duplicate WhatsApp
  // messages to whoever already got through, which risks the number's
  // quality rating / messaging limits with Meta).
  const [partial, setPartial] = useState(null)

  function sharedSendPayload() {
    return {
      templateName: template.name,
      templateLanguage: template.language,
      templateHeader: template.headerText || '',
      templateBody: template.bodyText || '',
      variableMap,
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

  // Drives /send-batch until `remaining` is empty, accumulating on top of
  // whatever was already sent (0 for a fresh send, or a resumed campaign's
  // running totals). Updates `partial` before every batch so a mid-loop
  // failure always leaves enough to resume from exactly this point.
  async function driveBatches(firstResponse, shared, seed = { sent: 0, failed: 0, firstError: null }) {
    let data = firstResponse
    let totalSent = seed.sent + data.sent
    let totalFailed = seed.failed + data.failed
    let firstError = seed.firstError || data.firstError
    let batch = 1

    while (data.remaining?.length > 0) {
      batch += 1
      setPartial({
        campaignId: data.campaignId, remaining: data.remaining, totalSent, totalFailed, firstError,
      })
      setSendProgress({ sent: totalSent, failed: totalFailed, batch })

      // eslint-disable-next-line no-await-in-loop
      data = await postWithRetry('/campaigns/send-batch', {
        campaignId: data.campaignId,
        contactIds: data.remaining,
        ...shared,
      })

      totalSent += data.sent
      totalFailed += data.failed
      if (!firstError && data.firstError) firstError = data.firstError
    }

    setPartial(null)
    return {
      campaignId: data.campaignId, total: totalSent + totalFailed, sent: totalSent, failed: totalFailed, firstError,
    }
  }

  async function send() {
    if (sending) return
    setSending(true)
    setError(null)
    setSendProgress(null)
    setPartial(null)
    try {
      const shared = sharedSendPayload()
      // First request creates the campaign and sends the first batch.
      const initial = await postWithRetry('/campaigns/send', {
        name: campaignName.trim(),
        contactIds: [...selected],
        ...shared,
      })
      setResult(await driveBatches(initial, shared))
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
    setError(null)
    try {
      const shared = sharedSendPayload()
      const next = await postWithRetry('/campaigns/send-batch', {
        campaignId: partial.campaignId,
        contactIds: partial.remaining,
        ...shared,
      })
      setResult(await driveBatches(next, shared, {
        sent: partial.totalSent, failed: partial.totalFailed, firstError: partial.firstError,
      }))
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
    setError(null)
  }

  return (
    <Panel>
      <Stepper step={step} />

      <div className="p-[18px]">
        {step === 0 && (
          <AudienceStep
            contacts={contacts}
            loading={contactsLoading}
            selected={selected}
            onToggle={toggle}
            onSelectAll={(checked) => setSelected(checked ? new Set(contacts.map((c) => c.id)) : new Set())}
            onImported={() => loadContacts()}
            search={search}
            onSearch={setSearch}
          />
        )}
        {step === 1 && (
          <TemplateStep
            templates={templates}
            loading={templatesLoading}
            selectedName={template?.name}
            onSelect={setTemplate}
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
          />
        )}
        {step === 3 && (
          <SendStep
            result={result}
            error={error}
            sending={sending}
            sendProgress={sendProgress}
            partial={partial}
            template={template}
            recipientCount={recipientCount}
            campaignName={campaignName}
            variableMap={variableMap}
            sampleContact={sampleContacts[Math.min(sampleIndex, Math.max(0, sampleContacts.length - 1))] || null}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3.5 border-t border-line
        bg-line-soft px-[18px] py-3.5">
        <span className="text-[12.5px] text-muted">
          <strong className="font-semibold text-ink">{recipientCount}</strong>
          {' '}recipient{recipientCount === 1 ? '' : 's'}
          {template && <> · template <strong className="font-semibold text-ink">{template.name}</strong></>}
        </span>

        <div className="flex items-center gap-2.5">
          {result ? (
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
