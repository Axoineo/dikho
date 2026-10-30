import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useAccess } from '../../lib/access'
import { emailApi } from './emailApi'
import { Banner, ConfirmDialog, EmptyState } from './emailUi'
import { useToast } from './emailHooks'
import EmailFrame from './EmailFrame'
import ContentEditor from './ContentEditor'
import { fullTime, listTime, relativeTime } from './emailFormat'
import './email.css'

// Reusable email content. Every save is a new numbered version; older ones
// stay readable and can be restored (restoring saves a new version, so
// nothing is overwritten). Campaigns copy a template's content when it is
// applied, so changing a template never changes a campaign already approved.
const KINDS = {
  marketing: { label: 'Marketing', help: 'For campaigns. Recipients must have agreed to marketing email.' },
  transactional: { label: 'Transactional', help: 'For one-to-one business email (quotes, reminders). Stored for upcoming workflows; nothing sends these automatically yet.' },
}

export default function EmailTemplates() {
  const { templateId } = useParams()
  const navigate = useNavigate()
  const { can } = useAccess()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [toastNode, toast] = useToast()

  const reload = useCallback(async () => {
    try {
      setData(await emailApi.templates())
      setError('')
    } catch (err) {
      setError(err.message || 'Could not load templates.')
    }
  }, [])
  useEffect(() => { reload() }, [reload])

  if (templateId) {
    if (!data) return <div className="em-page em-campaign">{error ? <Banner tone="danger">{error}</Banner> : <div className="em-skeleton" style={{ height: 320 }} aria-hidden="true" />}</div>
    return (
      <>
        <TemplateEditor key={templateId} id={templateId} variables={data.variables} onChanged={reload} toast={toast} />
        {toastNode}
      </>
    )
  }

  const canManage = can('email_templates.manage')
  const templates = data?.templates ?? []
  return (
    <div className="em-page" style={{ paddingBottom: 96 }}>
      <div className="page-header">
        <div>
          <h1>Templates</h1>
          <p>Approved wording and layouts your team starts from, with every earlier version kept.</p>
        </div>
        {canManage && (
          <button type="button" className="em-btn em-btn-primary" onClick={() => navigate('/email/templates/new')}>
            <Icon name="plus" size={16} /> New template
          </button>
        )}
      </div>
      {error && <Banner tone="danger" title="Could not load templates">{error}</Banner>}
      {!data && !error && <div className="em-card"><div className="em-skeleton" style={{ height: 160 }} aria-hidden="true" /></div>}
      {data && (templates.length === 0 ? (
        <section className="em-card">
          <EmptyState icon="file" title="No templates yet"
            action={canManage ? <button type="button" className="em-btn em-btn-primary" onClick={() => navigate('/email/templates/new')}>Create a template</button> : null}>
            Save wording you use often, such as a monthly offer or a payment reminder.
          </EmptyState>
        </section>
      ) : (
        <div className="em-template-grid">
          {templates.map((t) => (
            <Link key={t.id} to={`/email/templates/${t.id}`} className="em-card em-template-card">
              <span className={`em-pill${t.kind === 'marketing' ? ' is-brand' : ''}`}>{KINDS[t.kind]?.label ?? t.kind}</span>
              <strong>{t.name}</strong>
              <span className="em-template-subject">{t.subject || 'No subject'}</span>
              <small>Version {t.version} · {listTime(t.updated_at)}{t.updated_by_name ? ` · ${t.updated_by_name}` : ''}</small>
            </Link>
          ))}
        </div>
      ))}
      {toastNode}
    </div>
  )
}

function TemplateEditor({ id, variables, onChanged, toast }) {
  const navigate = useNavigate()
  const { can } = useAccess()
  const isNew = id === 'new'
  const canManage = can('email_templates.manage')
  const [template, setTemplate] = useState(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('marketing')
  const [content, setContent] = useState({ subject: '', preheader: '', html: '' })
  const [dirty, setDirty] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [confirmArchive, setConfirmArchive] = useState(false)

  const fill = useCallback((t) => {
    setName(t.name)
    setKind(t.kind)
    setContent({ subject: t.subject ?? '', preheader: t.preheader ?? '', html: t.html ?? '' })
    setResetKey((k) => k + 1)
  }, [])

  const load = useCallback(async () => {
    if (isNew) return
    try {
      const t = await emailApi.template(id)
      setTemplate(t)
      fill(t)
      setDirty(false)
      setLoadError('')
    } catch (err) {
      setLoadError(err.status === 404 ? 'This template does not exist or was archived.' : err.message || 'Could not load the template.')
    }
  }, [id, isNew, fill])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const allowed = useMemo(() => (kind === 'transactional' ? { ...variables?.marketing, ...variables?.transactional } : variables?.marketing), [kind, variables])
  const touch = () => { setDirty(true); setError('') }

  async function save() {
    setSaving(true)
    setError('')
    try {
      if (!name.trim()) throw new Error('Give the template a name.')
      const fields = { name: name.trim(), subject: content.subject.trim(), preheader: content.preheader.trim(), html: content.html }
      if (isNew) {
        const t = await emailApi.createTemplate({ ...fields, kind })
        setDirty(false)
        onChanged()
        toast('Template created.')
        navigate(`/email/templates/${t.id}`, { replace: true })
        return
      }
      const t = await emailApi.saveTemplate(id, fields)
      setTemplate((old) => ({ ...old, ...t }))
      setDirty(false)
      onChanged()
      toast(`Saved as version ${t.version}.`)
    } catch (err) {
      setError(err.message || 'The template could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function restore(version) {
    try {
      const old = await emailApi.template(id, version)
      setContent({ subject: old.subject, preheader: old.preheader, html: old.html })
      setResetKey((k) => k + 1)
      setDirty(true)
      toast(`Version ${version} loaded. Save to make it the newest version.`)
    } catch (err) {
      setError(err.message || 'That version could not be loaded.')
    }
  }

  if (loadError) {
    return (
      <div className="em-page em-campaign">
        <Link className="em-crumb" to="/email/templates"><Icon name="back" size={15} /> Templates</Link>
        <Banner tone="danger" title="Template unavailable">{loadError}</Banner>
      </div>
    )
  }
  if (!isNew && !template) return <div className="em-page em-campaign"><div className="em-skeleton" style={{ height: 320 }} aria-hidden="true" /></div>

  return (
    <div className="em-page em-campaign">
      <Link className="em-crumb" to="/email/templates"><Icon name="back" size={15} /> Templates</Link>
      <div className="em-campaign-head">
        <div style={{ minWidth: 0 }}>
          <h1>{name.trim() || 'New template'}</h1>
          <div className="em-campaign-sub">
            <span className={`em-pill${kind === 'marketing' ? ' is-brand' : ''}`}>{KINDS[kind].label}</span>
            {template && <span>Version {template.version} · saved {relativeTime(template.updated_at)}{template.updated_by_name ? ` by ${template.updated_by_name}` : ''}</span>}
            {dirty && <span className="em-unsaved">Unsaved changes</span>}
          </div>
        </div>
        {canManage && (
          <div className="em-campaign-actions">
            {template && <button type="button" className="em-btn em-btn-danger" onClick={() => setConfirmArchive(true)}>Archive</button>}
            <button type="button" className="em-btn em-btn-primary" onClick={save} disabled={saving || (!dirty && !isNew)}>
              {saving ? 'Saving…' : isNew ? 'Create template' : dirty ? 'Save as new version' : 'Saved'}
            </button>
          </div>
        )}
      </div>
      {!canManage && <Banner title="Read only">Editing templates needs the "Manage email templates" permission.</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}

      <div className="em-review">
        <section className="em-card em-form-card">
          <div className="em-form-grid">
            <div className="em-field">
              <label htmlFor="em-t-name">Template name</label>
              <input id="em-t-name" className="em-input" value={name} maxLength={120} disabled={!canManage} autoFocus={isNew}
                onChange={(e) => { setName(e.target.value.replace(/[\r\n]/g, ' ')); touch() }} />
            </div>
            <div className="em-field">
              <label htmlFor="em-t-kind">Type</label>
              <select id="em-t-kind" className="em-select" value={kind} disabled={!isNew || !canManage} onChange={(e) => { setKind(e.target.value); touch() }}>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <p className="em-help">{KINDS[kind].help}</p>
            </div>
          </div>
          <ContentEditor value={content} onChange={(c) => { setContent(c); touch() }} variables={allowed} disabled={!canManage} resetKey={resetKey} />
        </section>

        <aside className="em-review-side">
          <section className="em-card" aria-labelledby="em-t-preview">
            <div className="em-card-head">
              <div><h2 id="em-t-preview">Preview</h2><p>Sample values; the unsubscribe footer as campaigns add it.</p></div>
              {template?.preview_path && !dirty && <button type="button" className="em-icon-btn" onClick={load} aria-label="Refresh preview" title="Refresh preview"><Icon name="sync" size={16} /></button>}
            </div>
            {dirty || isNew ? <Banner tone="warn" title="Save to update the preview" />
              : template?.preview_path ? <EmailFrame key={template.preview_path} renderPath={template.preview_path} title="Template preview" />
                : <Banner>Preview is not available.</Banner>}
            {kind === 'transactional' && <p className="em-help">Transactional placeholders such as {'{{client_name}}'} show as written; the workflow that sends the email fills them.</p>}
          </section>

          {template?.versions?.length > 0 && (
            <section className="em-card" aria-labelledby="em-t-versions">
              <div className="em-card-head"><div><h2 id="em-t-versions">Versions</h2><p>Every save is kept.</p></div></div>
              <ol className="em-timeline">
                {template.versions.map((v) => (
                  <li key={v.version}>
                    <strong>Version {v.version}{v.version === template.version ? ' (current)' : ''}</strong>
                    <span>{v.saved_by_name ?? 'Someone'} · {fullTime(v.saved_at)}</span>
                    {v.version !== template.version && canManage && (
                      <button type="button" className="em-text-btn" onClick={() => restore(v.version)}>Restore this version</button>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>

      {confirmArchive && (
        <ConfirmDialog title="Archive this template?" confirmLabel="Archive" onClose={() => setConfirmArchive(false)}
          onConfirm={async () => { await emailApi.archiveTemplate(id); onChanged(); toast('Template archived.'); navigate('/email/templates') }}>
          It disappears from the list and cannot be chosen for new campaigns. Campaigns that already used it keep their copy.
        </ConfirmDialog>
      )}
    </div>
  )
}
