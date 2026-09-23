import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { apiGet, apiPost, apiUpload } from '../../lib/api'
import { WhatsAppPreview } from './WhatsAppPreview'
import {
  Alert, Avatar, Badge, EmptyState, Panel, PanelHead, Spinner, Table, Td, Th, inputClass,
} from './ui'

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
        {uploading ? 'Importing contacts…' : 'Drop an Excel (.xlsx) or CSV file here'}
      </div>
      <div className="text-[12.5px] text-muted">
        Needs a <strong>phone</strong> column. Optional: name, email, company. Duplicates are skipped.
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
        text: `Imported ${result.imported} new contact${result.imported === 1 ? '' : 's'}. `
          + `${result.duplicates} already existed, ${result.invalid} row(s) had no usable phone number.`,
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
        This phase supports <strong>static templates only</strong>. Templates containing
        variables are listed but cannot be selected until variable mapping ships.
      </Alert>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {templates.map((template) => (
          <button
            type="button"
            key={`${template.name}-${template.language}`}
            onClick={() => onSelect(template)}
            disabled={template.hasVariables}
            title={template.hasVariables ? 'Contains variables — not supported yet' : undefined}
            className={`rounded-xl border-[1.5px] bg-surface p-[15px] text-left text-ink transition
              disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0
              ${selectedName === template.name
                ? 'border-brand bg-brand-soft'
                : 'border-line hover:-translate-y-px hover:border-brand'}`}
          >
            <div className="mb-1.5 break-words text-[13.5px] font-semibold">{template.name}</div>
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              <Badge tone="success">{template.status}</Badge>
              <Badge>{template.language}</Badge>
              {template.category && <Badge tone="info">{template.category}</Badge>}
              {template.hasVariables && <Badge tone="warn">Has variables</Badge>}
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

/* ── Step 3: preview ────────────────────────────────────────────────────── */

function PreviewStep({ template, campaignName, onCampaignName, recipientCount }) {
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

        <ReviewList rows={[
          ['Template', template?.name ?? '—'],
          ['Language', template?.language ?? '—'],
          ['Recipients', recipientCount],
          ['Variables', 'None — static template'],
        ]} />
      </div>

      <div className="grid place-items-center py-2">
        <WhatsAppPreview template={template} />
      </div>
    </SplitLayout>
  )
}

/* ── Step 4: send ───────────────────────────────────────────────────────── */

function SendStep({ result, error, sending, template, recipientCount, campaignName }) {
  if (sending) {
    return (
      <EmptyState>
        <Spinner className="text-brand" />
        <div className="mb-1.5 mt-3 text-[15px] font-semibold text-ink">Sending campaign…</div>
        Delivering {recipientCount} message{recipientCount === 1 ? '' : 's'} through the Meta Cloud API.
      </EmptyState>
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
        <WhatsAppPreview template={template} />
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
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

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
        // One approved static template is the norm right now — preselect it.
        const usable = data.templates.filter((t) => !t.hasVariables)
        if (usable.length === 1) setTemplate(usable[0])
      })
      .catch((err) => setError(err.message))
      .finally(() => setTemplatesLoading(false))
  }, [])

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const recipientCount = selected.size
  const canAdvance = useMemo(() => {
    if (step === 0) return recipientCount > 0
    if (step === 1) return Boolean(template)
    if (step === 2) return campaignName.trim().length > 0
    return false
  }, [step, recipientCount, template, campaignName])

  async function send() {
    setSending(true)
    setError(null)
    try {
      const data = await apiPost('/campaigns/send', {
        name: campaignName.trim(),
        contactIds: [...selected],
        templateName: template.name,
        templateLanguage: template.language,
      })
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
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
          />
        )}
        {step === 3 && (
          <SendStep
            result={result}
            error={error}
            sending={sending}
            template={template}
            recipientCount={recipientCount}
            campaignName={campaignName}
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
