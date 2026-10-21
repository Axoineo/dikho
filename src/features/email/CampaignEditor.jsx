import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useAccess } from '../../lib/access'
import { emailApi } from './emailApi'
import { Banner, ConfirmDialog, StatusPill } from './emailUi'
import EmailFrame from './EmailFrame'
import ContentEditor from './ContentEditor'
import AudiencePicker from './AudiencePicker'
import {
  CAMPAIGN_EVENTS, CAMPAIGN_STATUS, EMPTY_AUDIENCE, campaignCounts, formatCount, fullTime, relativeTime, toLocalInput,
} from './emailFormat'

// One campaign from draft to sent. The steps are only a way to read it; the
// rules live in the database: an edit after submission withdraws approval,
// nobody approves what they wrote or submitted, and an approval covers
// exactly the version (content, sender, schedule and recipient list) the
// approver saw, identified by its fingerprint.
const STEPS = [
  { key: 'details', label: 'Details' },
  { key: 'audience', label: 'Audience' },
  { key: 'content', label: 'Content' },
  { key: 'review', label: 'Review' },
]
const LOCKED = new Set(['sending', 'sent', 'cancelled'])
// The same sample person the server preview uses, so the subject line above
// the preview reads like the message under it.
const SAMPLE = { first_name: 'Asha', name: 'Asha Verma', company: 'Example Industries', email: 'asha@example.com' }
const sample = (text) => String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key) => SAMPLE[key] ?? whole)
const WITHDRAWS = new Set(['pending_approval', 'approved', 'paused'])

function formFrom(c, senders) {
  return {
    name: c?.name ?? '',
    from_email: c?.from_email || senders?.[0] || '',
    from_name: c?.from_name ?? '',
    reply_to: c?.reply_to ?? '',
    send_at: toLocalInput(c?.send_at),
    template_id: c?.template_id ?? null,
    audience: { ...EMPTY_AUDIENCE, ...(c?.audience ?? {}) },
    content: { subject: c?.subject ?? '', preheader: c?.preheader ?? '', html: c?.html ?? '' },
  }
}

function fieldsFrom(form) {
  return {
    name: form.name.trim(),
    from_email: form.from_email,
    from_name: form.from_name.trim(),
    reply_to: form.reply_to.trim() || null,
    send_at: form.send_at ? new Date(form.send_at).toISOString() : null,
    template_id: form.template_id,
    audience: form.audience,
    subject: form.content.subject.trim(),
    preheader: form.content.preheader.trim(),
    html: form.content.html,
  }
}

export default function CampaignEditor({ id, meta, onChanged, toast }) {
  const navigate = useNavigate()
  const { access, can } = useAccess()
  const isNew = id === 'new'
  const [campaign, setCampaign] = useState(null)
  const [form, setForm] = useState(() => (isNew ? formFrom(null, meta?.senders) : null))
  const [dirty, setDirty] = useState(false)
  const [step, setStep] = useState('details')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [resetKey, setResetKey] = useState(0)
  const [audiencePreview, setAudiencePreview] = useState(null)
  const [templates, setTemplates] = useState(null)
  const senders = useMemo(() => meta?.senders ?? [], [meta])

  const load = useCallback(async () => {
    if (isNew) return
    try {
      const c = await emailApi.campaign(id)
      setCampaign(c)
      setForm(formFrom(c))
      setDirty(false)
      setResetKey((k) => k + 1)
      setLoadError('')
    } catch (err) {
      setLoadError(err.status === 404 ? 'This campaign does not exist or was removed.' : err.message || 'Could not load the campaign.')
    }
  }, [id, isNew])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    let alive = true
    emailApi.templates().then((r) => { if (alive) setTemplates(r.templates.filter((t) => t.kind === 'marketing')) }, () => { if (alive) setTemplates([]) })
    return () => { alive = false }
  }, [])

  // Closing the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const status = campaign?.status ?? 'draft'
  const started = Boolean(campaign?.started_at)
  const canCreate = can('email_campaigns.create')
  const editable = (campaign ? campaign.can_edit : canCreate) && !LOCKED.has(status) && !started
  const me = access?.user_id
  const wroteIt = campaign && (campaign.created_by === me || campaign.submitted_by === me)
  const counts = useMemo(() => campaignCounts(campaign?.stats), [campaign])

  const update = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); setError('') }

  async function save({ quiet } = {}) {
    setSaving(true)
    setError('')
    try {
      const fields = fieldsFrom(form)
      if (!fields.name) throw new Error('Give the campaign a name.')
      if (isNew) {
        const c = await emailApi.createCampaign(fields)
        setDirty(false)
        onChanged?.()
        toast?.('Draft saved.')
        navigate(`/email/campaigns/${c.id}`, { replace: true })
        return c
      }
      const c = await emailApi.saveCampaign(id, fields)
      setCampaign((old) => ({ ...old, ...c }))
      setDirty(false)
      onChanged?.()
      if (!quiet) toast?.(WITHDRAWS.has(status) ? 'Saved. The campaign is a draft again and needs approval.' : 'Draft saved.')
      return c
    } catch (err) {
      setError(err.message || 'The campaign could not be saved.')
      throw err
    } finally {
      setSaving(false)
    }
  }
  function requestSave() {
    if (WITHDRAWS.has(status)) {
      setDialog({
        kind: 'confirm', title: status === 'pending_approval' ? 'Withdraw from approval?' : 'Withdraw the approval?', confirmLabel: 'Save and withdraw',
        body: 'Saving a change returns this campaign to draft. It must be submitted and approved again before anything is sent.',
        run: async () => { await save(); setDialog(null); load() },
      })
    } else {
      save().catch(() => {})
    }
  }

  // Runs one action, then reloads. Errors go to whoever asked (a dialog
  // shows them in place).
  async function act(fn, message) {
    setError('')
    await fn()
    onChanged?.()
    if (message) toast?.(message)
    await load()
  }

  async function duplicate() {
    try {
      const c = await emailApi.duplicateCampaign(id)
      onChanged?.()
      toast?.('Copied as a new draft.')
      navigate(`/email/campaigns/${c.id}`)
    } catch (err) {
      setError(err.message || 'The campaign could not be copied.')
    }
  }

  async function applyTemplate(templateId) {
    if (!templateId) return
    const t = await emailApi.template(templateId)
    update({ template_id: t.id, content: { subject: t.subject, preheader: t.preheader, html: t.html } })
    setResetKey((k) => k + 1)
    toast?.(`Content replaced with "${t.name}" (version ${t.version}).`)
  }
  function requestTemplate(templateId) {
    const hasContent = form.content.html.trim() || form.content.subject.trim()
    if (!hasContent) { applyTemplate(templateId).catch((err) => setError(err.message)); return }
    setDialog({
      kind: 'confirm', tone: 'primary', title: 'Replace the content?', confirmLabel: 'Replace',
      body: 'The subject, preview text and message are replaced with the template\'s. You can still edit them afterwards.',
      run: async () => { await applyTemplate(templateId); setDialog(null) },
    })
  }

  if (loadError) {
    return (
      <div className="em-page em-campaign">
        <Link className="em-crumb" to="/email/campaigns"><Icon name="back" size={15} /> Campaigns</Link>
        <Banner tone="danger" title="Campaign unavailable">{loadError}</Banner>
      </div>
    )
  }
  if (!form) {
    return <div className="em-page em-campaign"><div className="em-skeleton" style={{ height: 320 }} aria-hidden="true" /></div>
  }

  const verifiedSender = senders.includes(form.from_email)
  const scheduleOk = !form.send_at || new Date(form.send_at).getTime() > Date.now()
  const eligible = status === 'draft' || status === 'rejected' ? audiencePreview?.eligible : campaign?.recipient_count
  const checks = [
    { ok: Boolean(form.name.trim()), label: 'Named', step: 'details' },
    { ok: verifiedSender, label: verifiedSender ? `From ${form.from_email}` : 'Choose a verified sender', step: 'details' },
    { ok: form.audience.sources.length > 0 && (eligible ?? 1) > 0, label: eligible != null ? `${formatCount(eligible)} recipient${eligible === 1 ? '' : 's'} with consent` : 'Choose an audience', step: 'audience' },
    { ok: Boolean(form.content.subject.trim() && form.content.html.trim()), label: 'Subject and message written', step: 'content' },
    { ok: scheduleOk, label: form.send_at ? (scheduleOk ? `Scheduled for ${fullTime(new Date(form.send_at).toISOString())}` : 'The scheduled time has passed') : 'Sends as soon as it is approved', step: 'details' },
  ]
  const ready = checks.every((c) => c.ok)

  return (
    <div className="em-page em-campaign">
      <Link className="em-crumb" to="/email/campaigns"><Icon name="back" size={15} /> Campaigns</Link>
      <div className="em-campaign-head">
        <div style={{ minWidth: 0 }}>
          <h1>{form.name.trim() || 'New campaign'}</h1>
          <div className="em-campaign-sub">
            <StatusPill status={status} map={CAMPAIGN_STATUS} />
            {campaign && <span>Updated {relativeTime(campaign.updated_at)}{campaign.created_by_name ? ` · created by ${campaign.created_by_name}` : ''}</span>}
            {dirty && <span className="em-unsaved">Unsaved changes</span>}
          </div>
        </div>
        <div className="em-campaign-actions">
          {campaign && canCreate && (
            <button type="button" className="em-btn" onClick={duplicate}>Duplicate</button>
          )}
          {editable && (
            <button type="button" className="em-btn em-btn-primary" onClick={requestSave} disabled={saving || (!dirty && !isNew)}>
              {saving ? 'Saving…' : isNew ? 'Save draft' : dirty ? 'Save changes' : 'Saved'}
            </button>
          )}
        </div>
      </div>

      {status === 'rejected' && campaign?.decision_note && (
        <Banner tone="danger" title="Changes requested">{campaign.decision_note}</Banner>
      )}
      {status === 'paused' && campaign?.decision_note && <Banner tone="warn" title="Paused">{campaign.decision_note}</Banner>}
      {editable && WITHDRAWS.has(status) && (
        <Banner tone="warn" title={status === 'pending_approval' ? 'Waiting for approval' : 'Approved'}>
          Any change you save withdraws {status === 'pending_approval' ? 'the submission' : 'the approval'}; it then needs approval again.
        </Banner>
      )}
      {!editable && campaign && !LOCKED.has(status) && !started && !campaign.can_edit && (
        <Banner title="Read only">You can view this campaign. Editing needs the "Create email campaigns" permission.</Banner>
      )}
      {(LOCKED.has(status) || started) && status !== 'cancelled' && (
        <Banner title="This campaign has started">What was sent is kept as the record. To change it, duplicate it and send the copy.</Banner>
      )}
      {error && <Banner tone="danger">{error}</Banner>}

      <nav className="em-steps" aria-label="Campaign steps">
        {STEPS.map((s, i) => {
          const done = s.key !== 'review' && checks.filter((c) => c.step === s.key).every((c) => c.ok)
          return (
            <button key={s.key} type="button" className={`em-step${step === s.key ? ' is-active' : ''}${done ? ' is-done' : ''}`}
              aria-current={step === s.key ? 'step' : undefined} onClick={() => setStep(s.key)}>
              <span className="em-step-num">{done ? <Icon name="check" size={12} strokeWidth={2.6} /> : i + 1}</span>{s.label}
            </button>
          )
        })}
      </nav>

      {step === 'details' && (
        <section className="em-card em-form-card">
          <div className="em-form-grid">
            <div className="em-field em-span-2">
              <label htmlFor="em-name">Campaign name <span className="em-optional">only staff see this</span></label>
              <input id="em-name" className="em-input" value={form.name} maxLength={120} disabled={!editable} autoFocus={isNew}
                onChange={(e) => update({ name: e.target.value })} placeholder="October outdoor offer" />
            </div>
            <div className="em-field">
              <label htmlFor="em-from">From address</label>
              {senders.length ? (
                <select id="em-from" className="em-select" value={form.from_email} disabled={!editable} onChange={(e) => update({ from_email: e.target.value })}>
                  {!verifiedSender && <option value={form.from_email}>{form.from_email || 'Choose…'}</option>}
                  {senders.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input id="em-from" className="em-input" value={form.from_email} disabled placeholder="No verified sender is set up" />
              )}
              <p className="em-help">Only addresses verified in Amazon SES and allowed by an administrator.</p>
            </div>
            <div className="em-field">
              <label htmlFor="em-from-name">Sender name</label>
              <input id="em-from-name" className="em-input" value={form.from_name} maxLength={120} disabled={!editable}
                onChange={(e) => update({ from_name: e.target.value.replace(/[\r\n]/g, ' ') })} placeholder="Dikho Global Media" />
            </div>
            <div className="em-field">
              <label htmlFor="em-reply">Replies go to <span className="em-optional">optional</span></label>
              <input id="em-reply" type="email" className="em-input" value={form.reply_to} maxLength={254} disabled={!editable}
                onChange={(e) => update({ reply_to: e.target.value })} placeholder="sales@yourcompany.com" />
            </div>
            <div className="em-field">
              <label htmlFor="em-send-at">Send time <span className="em-optional">optional</span></label>
              <input id="em-send-at" type="datetime-local" className="em-input" value={form.send_at} disabled={!editable}
                onChange={(e) => update({ send_at: e.target.value })} />
              <p className="em-help">{form.send_at ? 'Sending starts at this time, once approved.' : 'Empty: sending starts soon after approval.'} It goes out in batches within the daily limit.</p>
            </div>
          </div>
        </section>
      )}

      {step === 'audience' && (
        <AudiencePicker value={form.audience} onChange={(audience) => update({ audience })} disabled={!editable} onPreview={setAudiencePreview} />
      )}

      {step === 'content' && (
        <section className="em-card em-form-card">
          {editable && templates?.length > 0 && (
            <div className="em-field" style={{ maxWidth: 420 }}>
              <label htmlFor="em-template">Start from a template <span className="em-optional">optional</span></label>
              <select id="em-template" className="em-select" value="" onChange={(e) => requestTemplate(e.target.value)}>
                <option value="">Choose a template…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <ContentEditor value={form.content} onChange={(content) => update({ content })} variables={meta?.variables} disabled={!editable} resetKey={resetKey} />
        </section>
      )}

      {step === 'review' && (
        <div className="em-review">
          <section className="em-card em-review-preview" aria-labelledby="em-preview-title">
            <div className="em-card-head">
              <div><h2 id="em-preview-title">Preview</h2><p>As a recipient sees it, with sample values and the unsubscribe footer.</p></div>
              {campaign?.preview_path && !dirty && <button type="button" className="em-btn" onClick={load}><Icon name="sync" size={15} /> Refresh</button>}
            </div>
            <div className="em-inbox-mock">
              <div><span>From</span>{form.from_name || 'Dikho'} &lt;{form.from_email || 'not chosen'}&gt;</div>
              <div><span>Subject</span><strong>{sample(form.content.subject) || '(no subject)'}</strong></div>
              {form.content.preheader && <div><span>Preview</span>{sample(form.content.preheader)}</div>}
            </div>
            {dirty || isNew ? (
              <Banner tone="warn" title="Save to update the preview">The preview shows the last saved version.</Banner>
            ) : campaign?.preview_path ? (
              <EmailFrame key={campaign.preview_path} renderPath={campaign.preview_path} title="Campaign preview" />
            ) : (
              <Banner>Preview is not available.</Banner>
            )}
          </section>

          <aside className="em-review-side">
            {!LOCKED.has(status) && !started && <section className="em-card" aria-labelledby="em-check-title">
              <div className="em-card-head"><div><h2 id="em-check-title">Checklist</h2></div></div>
              <ol className="em-checklist">
                {checks.map((c) => (
                  <li key={c.label}>
                    <span className={`em-check${c.ok ? ' is-done' : ' is-todo'}`}><Icon name={c.ok ? 'check' : 'alert'} size={12} strokeWidth={2.4} /></span>
                    <div>{c.ok || !editable ? c.label : <button type="button" className="em-text-btn" onClick={() => setStep(c.step)}>{c.label}</button>}</div>
                  </li>
                ))}
              </ol>
              {!meta?.readiness?.ready && (
                <p className="em-help" style={{ marginTop: 12 }}>
                  Sending is not switched on yet (needs {meta?.readiness?.missing?.join(', ') || 'server setup'}). You can still prepare and approve campaigns.
                </p>
              )}
            </section>}

            <ActionsCard
              campaign={campaign} status={status} editable={editable} canCreate={canCreate} ready={ready} dirty={dirty || isNew}
              wroteIt={wroteIt} meta={meta} eligible={eligible} counts={counts} saving={saving}
              onSaveFirst={() => save({ quiet: true })} setDialog={setDialog} act={act} id={id}
            />

            {campaign && (started || counts.total > 0) && <ProgressCard campaign={campaign} counts={counts} />}
            {campaign?.history?.length > 0 && <HistoryCard history={campaign.history} />}
          </aside>
        </div>
      )}

      {step !== 'review' && (
        <div className="em-step-foot">
          {step !== 'details' && <button type="button" className="em-btn" onClick={() => setStep(STEPS[STEPS.findIndex((s) => s.key === step) - 1].key)}>Back</button>}
          <button type="button" className="em-btn em-btn-primary" onClick={() => setStep(STEPS[STEPS.findIndex((s) => s.key === step) + 1].key)}>
            Next: {STEPS[STEPS.findIndex((s) => s.key === step) + 1].label}
          </button>
        </div>
      )}

      {dialog?.kind === 'confirm' && (
        <ConfirmDialog title={dialog.title} confirmLabel={dialog.confirmLabel} tone={dialog.tone ?? 'danger'} onConfirm={dialog.run} onClose={() => setDialog(null)}>
          {dialog.body}
        </ConfirmDialog>
      )}
      {dialog?.kind === 'reject' && <RejectDialog onClose={() => setDialog(null)} onReject={dialog.run} />}
    </div>
  )
}

function ActionsCard({ campaign, status, editable, canCreate, ready, dirty, wroteIt, meta, eligible, counts, saving, onSaveFirst, setDialog, act, id }) {
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')
  const hash = campaign?.snapshot_hash
  const fingerprint = hash ? `${hash.slice(0, 6)} ${hash.slice(6, 12)}` : ''

  async function sendTest() {
    setTesting(true)
    setTestError('')
    try {
      if (dirty) await onSaveFirst()
      await act(() => emailApi.testCampaign(id), 'Test sent to your own address.')
    } catch (err) {
      setTestError(err.message || 'The test was not sent.')
    } finally {
      setTesting(false)
    }
  }
  function submit() {
    setDialog({
      kind: 'confirm', tone: 'primary', title: 'Submit for approval?', confirmLabel: dirty ? 'Save and submit' : 'Submit',
      body: `The recipient list is fixed now${eligible != null ? ` (${formatCount(eligible)} people with consent)` : ''}. Another person with approval rights must approve it before anything is sent.`,
      run: async () => {
        if (dirty) await onSaveFirst()
        await act(() => emailApi.submitCampaign(id), 'Submitted for approval.')
        setDialog(null)
      },
    })
  }
  function approve() {
    setDialog({
      kind: 'confirm', tone: 'primary', title: 'Approve this campaign?', confirmLabel: `Approve sending to ${formatCount(campaign.recipient_count)}`,
      body: `You approve exactly what you reviewed (fingerprint ${fingerprint}): this content, sender, schedule and the ${formatCount(campaign.recipient_count)} recipients. Any later change withdraws your approval.`,
      run: async () => { await act(() => emailApi.decideCampaign(id, true, hash, null), 'Approved.'); setDialog(null) },
    })
  }
  function reject() {
    setDialog({ kind: 'reject', run: async (note) => { await act(() => emailApi.decideCampaign(id, false, hash, note), 'Sent back with your note.'); setDialog(null) } })
  }
  const control = (action, title, body, confirmLabel, done, tone) => () => setDialog({
    kind: 'confirm', title, body, confirmLabel, tone,
    run: async () => { await act(() => emailApi.controlCampaign(id, action), done); setDialog(null) },
  })

  if (!campaign) {
    return (
      <section className="em-card">
        <p className="em-help" style={{ margin: 0 }}>Save the draft to preview it, send yourself a test and submit it for approval.</p>
      </section>
    )
  }

  return (
    <section className="em-card" aria-labelledby="em-actions-title">
      <div className="em-card-head"><div><h2 id="em-actions-title">{status === 'pending_approval' ? 'Approval' : 'Next step'}</h2></div></div>

      {(status === 'draft' || status === 'rejected') && editable && (
        <div className="em-stack">
          <button type="button" className="em-btn em-btn-primary em-btn-block" onClick={submit} disabled={!ready || saving}>
            <Icon name="shield" size={15} /> {dirty ? 'Save and submit for approval' : 'Submit for approval'}
          </button>
          <button type="button" className="em-btn em-btn-block" onClick={sendTest} disabled={testing || !meta?.readiness?.ready}
            title={meta?.readiness?.ready ? 'Sends one copy to your own address' : 'Sending is not switched on yet'}>
            <Icon name="send" size={15} /> {testing ? 'Sending test…' : 'Send a test to me'}
          </button>
          {!ready && <p className="em-help">Finish the checklist to submit.</p>}
          {testError && <Banner tone="danger">{testError}</Banner>}
        </div>
      )}
      {(status === 'draft' || status === 'rejected') && !editable && <p className="em-help">A draft. Only people who can create campaigns can submit it.</p>}

      {status === 'pending_approval' && (
        <div className="em-stack">
          <dl className="em-breakdown">
            <div><dt>Submitted by</dt><dd>{campaign.submitted_by_name ?? '—'}</dd></div>
            <div><dt>Submitted</dt><dd>{relativeTime(campaign.submitted_at)}</dd></div>
            <div><dt>Recipients (fixed)</dt><dd>{formatCount(campaign.recipient_count)}</dd></div>
            <div><dt>Fingerprint</dt><dd><code>{fingerprint}</code></dd></div>
          </dl>
          {!campaign.can_approve && <p className="em-help">Waiting for someone with approval rights.</p>}
          {campaign.can_approve && wroteIt && <Banner title="Another approver must decide">You wrote or submitted this campaign, so you cannot approve it yourself.</Banner>}
          {campaign.can_approve && !wroteIt && (
            <>
              <p className="em-help">Check the preview, the sender and the audience. Your approval covers exactly this version.</p>
              <button type="button" className="em-btn em-btn-primary em-btn-block" onClick={approve}><Icon name="check" size={15} /> Approve</button>
              <button type="button" className="em-btn em-btn-block" onClick={reject}>Request changes</button>
            </>
          )}
        </div>
      )}

      {status === 'approved' && (
        <div className="em-stack">
          <p className="em-help" style={{ margin: 0 }}>
            Approved by {campaign.approved_by_name ?? 'an approver'} {relativeTime(campaign.approved_at)}.{' '}
            {campaign.send_at && new Date(campaign.send_at) > new Date() ? `Sending starts ${fullTime(campaign.send_at)}.` : 'Sending starts within a few minutes, in batches within the daily limit.'}
          </p>
          {!meta?.readiness?.ready && <Banner tone="warn" title="Sending is not switched on">It waits until an administrator finishes the Amazon SES setup.</Banner>}
        </div>
      )}
      {status === 'sending' && <p className="em-help" style={{ margin: 0 }}>Sending in batches. {formatCount(counts.queued)} still to go.</p>}
      {status === 'paused' && <p className="em-help" style={{ margin: 0 }}>Paused. Nothing more is sent until it is resumed.</p>}
      {status === 'sent' && <p className="em-help" style={{ margin: 0 }}>Finished {relativeTime(campaign.finished_at)}.</p>}
      {status === 'cancelled' && <p className="em-help" style={{ margin: 0 }}>Cancelled {relativeTime(campaign.finished_at)}. Anything already sent stays recorded.</p>}

      {(canCreate || campaign.can_approve) && !['sent', 'cancelled'].includes(status) && (
        <div className="em-control-row">
          {['approved', 'sending'].includes(status) && (
            <button type="button" className="em-btn" onClick={control('pause', 'Pause sending?', 'No more emails go out until someone resumes it. Emails already sent are not affected.', 'Pause campaign', 'Paused.', 'primary')}>Pause</button>
          )}
          {status === 'paused' && (
            <button type="button" className="em-btn em-btn-primary" onClick={control('resume', 'Resume sending?', 'Sending continues with the approved version, within the daily limit.', 'Resume campaign', 'Resumed.', 'primary')}>Resume</button>
          )}
          <button type="button" className="em-btn em-btn-danger" onClick={control('cancel', 'Cancel this campaign?', 'Nobody else receives it. Emails already sent stay recorded. This cannot be undone; duplicate it to send again.', 'Cancel campaign', 'Cancelled.')}>Cancel campaign</button>
        </div>
      )}
    </section>
  )
}

function ProgressCard({ campaign, counts }) {
  const total = counts.total || campaign.recipient_count || 0
  const pct = total ? Math.round((counts.sent / total) * 100) : 0
  const rows = [
    ['Sent', counts.sent],
    ['Delivered', counts.delivered],
    ['Bounced', counts.bounced],
    ['Marked as spam', counts.complained],
    ['Unsubscribed', counts.unsubscribed],
    ['Failed', counts.failed],
    ['Unconfirmed', counts.uncertain],
    ['Skipped', counts.skipped],
  ].filter(([, n], i) => i < 2 || n > 0)
  return (
    <section className="em-card" aria-labelledby="em-progress-title">
      <div className="em-card-head"><div><h2 id="em-progress-title">Delivery</h2><p>From Amazon SES. Opens and clicks are not tracked.</p></div></div>
      <div className="em-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Share sent">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="em-help">{formatCount(counts.sent)} of {formatCount(total)} sent ({pct}%){counts.queued ? ` · ${formatCount(counts.queued)} waiting` : ''}</p>
      <dl className="em-breakdown">
        {rows.map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{formatCount(n)}</dd></div>)}
      </dl>
      {counts.uncertain > 0 && <p className="em-help">Unconfirmed: SES did not answer in time. They are not sent again, to avoid duplicates.</p>}
    </section>
  )
}

function HistoryCard({ history }) {
  return (
    <section className="em-card" aria-labelledby="em-history-title">
      <div className="em-card-head"><div><h2 id="em-history-title">History</h2></div></div>
      <ol className="em-timeline">
        {[...history].reverse().map((h, i) => (
          <li key={`${h.event}-${h.at}-${i}`}>
            <strong>{CAMPAIGN_EVENTS[h.event] ?? h.event.replace('email_campaign.', '')}</strong>
            <span>{h.by ?? 'System'} · {fullTime(h.at)}</span>
            {h.note && <q>{h.note}</q>}
          </li>
        ))}
      </ol>
    </section>
  )
}

function RejectDialog({ onClose, onReject }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault()
    if (!note.trim()) { setError('Say what needs to change.'); return }
    setBusy(true)
    try { await onReject(note.trim()) } catch (err) { setError(err.message || 'That did not work.'); setBusy(false) }
  }
  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <form className="modal-card em-dialog em-page" role="dialog" aria-modal="true" aria-labelledby="em-reject-title" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="em-reject-title">Request changes</h2>
        <p>The campaign goes back to its author as a draft, with your note.</p>
        <label className="em-field">
          <span className="em-label">What needs to change</span>
          <textarea className="em-textarea" autoFocus maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose() }} />
        </label>
        {error && <div style={{ marginTop: 10 }}><Banner tone="danger">{error}</Banner></div>}
        <div className="em-dialog-actions">
          <button type="button" className="em-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="em-btn em-btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send back'}</button>
        </div>
      </form>
    </div>
  )
}
