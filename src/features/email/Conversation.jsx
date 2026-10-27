import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { emailApi } from './emailApi'
import EmailFrame from './EmailFrame'
import { Banner, EmptyState } from './emailUi'
import { PROVIDER_LABELS, WORKFLOW, addressList, atLeast, formatSize, fullTime, initials, listTime, personName } from './emailFormat'

// One conversation. Message content is fetched live from Gmail each time it
// is opened (the API stores none of it) and shown through EmailFrame.
// Gmail state (read, archive, star, labels) changes Gmail; workflow state
// (status, assignee, notes, CRM links) is Dikho's own and never touches it.

// Mailbox labels change rarely; one request per mailbox per page visit.
const labelCache = new Map()
function mailboxLabels(accountId) {
  if (!labelCache.has(accountId)) {
    labelCache.set(accountId, emailApi.labels(accountId).then((r) => r.labels, () => { labelCache.delete(accountId); return [] }))
  }
  return labelCache.get(accountId)
}

async function download(threadId, messageId, attachment) {
  const blob = await emailApi.attachment(threadId, messageId, attachment.id, attachment.filename)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = attachment.filename || 'attachment'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export default function Conversation({
  ref, threadId, me, crmOpen, onToggleCrm, onBack, onPatch, onRemoveFromList, onCompose, inlineComposer, toast,
}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [labels, setLabels] = useState([])
  const [labelMenu, setLabelMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const composerAnchor = useRef(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const d = await emailApi.thread(threadId)
      setData(d)
      setExpanded((prev) => {
        if (prev.size) return prev
        const last = d.messages[d.messages.length - 1]
        return new Set(d.messages.filter((m) => m.unread || m.draft || m === last).map((m) => m.id))
      })
      // Opening marks it read, as Gmail does, for people who may change it.
      if (d.thread.unread && atLeast(d.account.role, 'responder') && d.account.capabilities?.mark_read !== false) {
        emailApi.labelThread(threadId, [], ['UNREAD']).then((r) => onPatch(threadId, { unread: r.unread, label_ids: r.label_ids }), () => {})
      }
    } catch (err) {
      setError(err.message)
    }
  }, [threadId, onPatch])

  useEffect(() => { load() }, [load])
  const labelsOk = data?.account?.capabilities?.labels !== false
  useEffect(() => {
    if (data?.account?.id && labelsOk) mailboxLabels(data.account.id).then(setLabels)
  }, [data?.account?.id, labelsOk])
  useEffect(() => {
    if (inlineComposer) composerAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [inlineComposer])

  const thread = data?.thread
  const role = data?.account?.role
  const canAct = atLeast(role, 'responder')
  const canAssign = atLeast(role, 'manager')
  const labelIds = useMemo(() => new Set(thread?.label_ids ?? []), [thread])
  // What this mailbox's provider supports. Older API answers carry no
  // capabilities and are Gmail, which supports everything shown here.
  const can = (feature) => data?.account?.capabilities?.[feature] !== false
  const lastMessage = data?.messages?.filter((m) => !m.draft).at(-1)

  async function changeLabels(add, remove, patchList) {
    setBusy(true)
    try {
      const r = await emailApi.labelThread(threadId, add, remove)
      setData((d) => ({ ...d, thread: { ...d.thread, label_ids: r.label_ids, unread: r.unread, starred: r.starred } }))
      onPatch(threadId, { label_ids: r.label_ids, unread: r.unread, starred: r.starred, ...patchList })
      return r
    } catch (err) {
      toast(err.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function updateWorkflow(patch) {
    try {
      const t = await emailApi.updateThread(threadId, patch)
      setData((d) => ({ ...d, thread: { ...d.thread, ...t } }))
      onPatch(threadId, t)
    } catch (err) {
      toast(err.message)
    }
  }

  const archive = async () => {
    if (!labelIds.has('INBOX') || !can('archive')) return
    if (await changeLabels([], ['INBOX'])) { toast('Archived.'); onRemoveFromList(threadId) }
  }
  const toggleStar = () => (can('star') ? changeLabels(thread.starred ? [] : ['STARRED'], thread.starred ? ['STARRED'] : []) : null)
  const markUnread = async () => { if (await changeLabels(['UNREAD'], [])) onBack() }

  const reply = (mode, source = lastMessage) => {
    if (!source || !canAct || !can(mode === 'forward' ? 'forward' : 'reply')) return
    onCompose({ mode, thread, source, accountId: data.account.id })
  }

  async function continueDraft(message) {
    try {
      const { drafts } = await emailApi.drafts(data.account.id)
      const match = drafts.find((d) => d.message_id === message.id)
      if (!match) { toast('This draft was changed or sent elsewhere. Refresh the conversation.'); return }
      const draft = await emailApi.draft(data.account.id, match.id)
      onCompose({ mode: lastMessage ? 'reply' : 'new', thread, source: lastMessage, accountId: data.account.id, draft })
    } catch (err) {
      toast(err.message)
    }
  }

  useImperativeHandle(ref, () => ({
    reload: load,
    handleKey: (key) => {
      if (!data || !canAct) return
      if (key === 'e') archive()
      else if (key === 's') toggleStar()
      else if (key === 'r') reply('reply')
      else if (key === 'a') reply('reply_all')
      else if (key === 'f') reply('forward')
    },
  }))

  if (error) {
    return (
      <section className="em-convo" aria-label="Conversation">
        <div className="em-convo-head"><div className="em-toolbar"><button type="button" className="em-icon-btn em-back" onClick={onBack} aria-label="Back to list"><Icon name="back" size={18} /></button></div></div>
        <div style={{ padding: 20 }}><Banner tone="danger" title="Could not open this conversation" action={<button type="button" className="em-btn" onClick={load}>Retry</button>}>{error}</Banner></div>
      </section>
    )
  }
  if (!data) {
    return (
      <section className="em-convo" aria-label="Conversation" aria-busy="true">
        <div className="em-convo-head"><div className="em-skeleton" style={{ height: 22, width: '55%' }} /></div>
        <div className="em-convo-body">{[0, 1].map((i) => <div key={i} className="em-skeleton" style={{ height: 120 }} />)}</div>
      </section>
    )
  }

  const userLabels = labels.filter((l) => labelIds.has(l.id))

  return (
    <>
      <section className="em-convo" aria-label="Conversation">
        <header className="em-convo-head">
          <div className="em-toolbar" role="toolbar" aria-label="Conversation actions">
            <button type="button" className="em-icon-btn em-back" onClick={onBack} aria-label="Back to list"><Icon name="back" size={18} /></button>
            {canAct && (
              <>
                {can('archive') && (labelIds.has('INBOX')
                  ? <button type="button" className="em-icon-btn" onClick={archive} disabled={busy} aria-label="Archive" title="Archive (e)"><Icon name="archive" size={18} /></button>
                  : <button type="button" className="em-icon-btn" onClick={() => changeLabels(['INBOX'], [])} disabled={busy} aria-label="Move to inbox" title="Move to inbox"><Icon name="inbox" size={18} /></button>)}
                {can('mark_read') && (
                  <button type="button" className="em-icon-btn" onClick={markUnread} disabled={busy} aria-label="Mark as unread" title="Mark as unread"><Icon name="unread" size={18} /></button>
                )}
                {can('star') && (
                  <button type="button" className={`em-icon-btn${thread.starred ? ' is-star' : ''}`} onClick={toggleStar} disabled={busy}
                    aria-pressed={thread.starred} aria-label={thread.starred ? 'Unstar' : 'Star'} title="Star (s)"><Icon name="star" size={18} /></button>
                )}
                {labels.length > 0 && (
                  <span style={{ position: 'relative' }}>
                    <button type="button" className="em-icon-btn" onClick={() => setLabelMenu((v) => !v)} aria-expanded={labelMenu} aria-label="Labels" title="Labels"><Icon name="filter" size={18} /></button>
                    {labelMenu && (
                      <ul className="em-suggest" style={{ width: 240, maxHeight: 300, overflowY: 'auto' }} role="menu">
                        {labels.map((l) => (
                          <li key={l.id} role="menuitemcheckbox" aria-checked={labelIds.has(l.id)} style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                            onMouseDown={(e) => { e.preventDefault(); changeLabels(labelIds.has(l.id) ? [] : [l.id], labelIds.has(l.id) ? [l.id] : []) }}>
                            <input type="checkbox" readOnly checked={labelIds.has(l.id)} tabIndex={-1} /> <span>{l.name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </span>
                )}
                <span className="em-toolbar-sep" />
              </>
            )}
            <button type="button" className="em-icon-btn" onClick={load} aria-label="Refresh conversation" title="Refresh"><Icon name="sync" size={17} /></button>
            <div className="em-toolbar-end">
              <button type="button" className={`em-btn${crmOpen ? ' em-btn-primary' : ''}`} onClick={onToggleCrm} aria-pressed={crmOpen}>
                <Icon name="clients" size={15} /> CRM
              </button>
            </div>
          </div>
          <h2 className="em-subject">{thread.subject || '(no subject)'}</h2>
          <div className="em-convo-meta">
            <span className="em-pill">{data.account.display_name || data.account.email_address}</span>
            {data.account.provider && <span className="em-pill is-brand">{PROVIDER_LABELS[data.account.provider] ?? data.account.provider}</span>}
            {userLabels.map((l) => <span key={l.id} className="em-pill is-brand">{l.name}</span>)}
            <label className="em-visually-hidden" htmlFor="em-status">Status</label>
            <select id="em-status" value={thread.workflow_status} disabled={!canAct} onChange={(e) => updateWorkflow({ workflow_status: e.target.value })}>
              {WORKFLOW.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
            </select>
            <label className="em-visually-hidden" htmlFor="em-assignee">Assigned to</label>
            <select id="em-assignee" value={thread.assigned_to ?? ''} disabled={!canAct || (!canAssign && thread.assigned_to && thread.assigned_to !== me)}
              onChange={(e) => updateWorkflow({ assigned_to: e.target.value || null })}>
              <option value="">Unassigned</option>
              {(canAssign ? data.assignable : data.assignable.filter((p) => p.user_id === me || p.user_id === thread.assigned_to))
                .map((p) => <option key={p.user_id} value={p.user_id}>{p.user_id === me ? `${p.full_name} (you)` : p.full_name}</option>)}
            </select>
          </div>
        </header>

        <div className="em-convo-body">
          {!canAct && <Banner tone="">You can read this mailbox. Replying and filing need responder access.</Banner>}
          {data.messages.length === 0 && <EmptyState icon="mail" title={`This conversation is empty in ${PROVIDER_LABELS[data.account.provider] ?? 'Gmail'}`} />}
          {data.omitted > 0 && (
            <Banner tone="">{data.omitted} earlier message{data.omitted === 1 ? ' is' : 's are'} not shown here. Open the mailbox in Hostinger Webmail for the full history.</Banner>
          )}
          {data.messages.map((m) => (
            <Message key={m.id} m={m} threadId={threadId} open={expanded.has(m.id)} canAct={canAct && can('reply')}
              onToggle={() => setExpanded((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })}
              onReply={(mode) => reply(mode, m)} onContinueDraft={() => continueDraft(m)} toast={toast} />
          ))}
          <div ref={composerAnchor}>{inlineComposer}</div>
          {!inlineComposer && canAct && lastMessage && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {can('reply') && <button type="button" className="em-btn" onClick={() => reply('reply')}><Icon name="reply" size={15} /> Reply</button>}
              {can('reply') && <button type="button" className="em-btn" onClick={() => reply('reply_all')}><Icon name="replyAll" size={15} /> Reply all</button>}
              {can('forward') && <button type="button" className="em-btn" onClick={() => reply('forward')}><Icon name="forward" size={15} /> Forward</button>}
            </div>
          )}
          <Notes threadId={threadId} notes={data.notes} canAdd={canAct}
            onAdded={(note) => { setData((d) => ({ ...d, notes: [...d.notes, note] })); onPatch(threadId, { note_count: data.notes.length + 1 }) }} toast={toast} />
        </div>
      </section>
      {crmOpen && <CrmPanel threadId={threadId} canLink={canAct} onClose={onToggleCrm} onLinked={(count) => onPatch(threadId, { link_count: count })} />}
    </>
  )
}

function Message({ m, threadId, open, canAct, onToggle, onReply, onContinueDraft, toast }) {
  const [downloading, setDownloading] = useState(null)
  const snippet = (m.text || '').replace(/\s+/g, ' ').slice(0, 140)
  const attachments = m.attachments.filter((a) => !a.inline || !m.html)

  if (!open) {
    return (
      <article className="em-msg is-collapsed" onClick={onToggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        tabIndex={0} role="button" aria-expanded="false" aria-label={`Message from ${personName(m.from)}, ${listTime(m.date)}`}>
        <div className="em-msg-head">
          <span className="em-avatar" aria-hidden="true">{initials(m.from)}</span>
          <div className="em-msg-who">
            <div className="em-msg-from"><strong>{personName(m.from)}</strong>{m.draft && <span className="em-pill is-warn">Draft</span>}</div>
            <div className="em-msg-snippet">{snippet || (attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? '' : 's'}` : '')}</div>
          </div>
          <span className="em-msg-date">{listTime(m.date)}</span>
        </div>
      </article>
    )
  }

  return (
    <article className="em-msg" aria-label={`Message from ${personName(m.from)}`}>
      <div className="em-msg-head" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <span className="em-avatar" aria-hidden="true">{initials(m.from)}</span>
        <div className="em-msg-who">
          <div className="em-msg-from">
            <strong>{personName(m.from)}</strong>
            {m.from?.name && <span>&lt;{m.from.email}&gt;</span>}
            {m.draft && <span className="em-pill is-warn">Draft</span>}
          </div>
          <div className="em-msg-to" title={[addressList(m.to), addressList(m.cc)].filter(Boolean).join('; ')}>
            to {addressList(m.to) || '(no recipients)'}{m.cc.length ? `, cc ${addressList(m.cc)}` : ''}{m.bcc.length ? `, bcc ${addressList(m.bcc)}` : ''}
          </div>
        </div>
        <time className="em-msg-date" dateTime={m.date} title={fullTime(m.date)}>{fullTime(m.date)}</time>
      </div>
      <div className="em-msg-body">
        {m.blocked_images > 0 && (
          <div className="em-msg-notice"><Icon name="shield" size={14} /> {m.blocked_images} remote image{m.blocked_images === 1 ? ' is' : 's are'} hidden so the sender cannot see when you read this.</div>
        )}
        {m.render_path
          ? <EmailFrame renderPath={m.render_path} title={`Message from ${personName(m.from)}`} />
          : <pre className="em-plain">{m.text || '(no text)'}</pre>}
        {attachments.length > 0 && (
          <div className="em-attachments">
            {attachments.map((a) => (
              <button key={a.id} type="button" className="em-attachment" disabled={downloading === a.id} title={`Download ${a.filename}`}
                onClick={async () => {
                  setDownloading(a.id)
                  try { await download(threadId, m.id, a) } catch (err) { toast(err.message || 'Download failed.') } finally { setDownloading(null) }
                }}>
                <Icon name={downloading === a.id ? 'sync' : 'paperclip'} size={14} /><span>{a.filename}</span><small>{formatSize(a.size)}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      {canAct && (
        <div className="em-msg-actions">
          {m.draft
            ? <button type="button" className="em-btn em-btn-primary" onClick={onContinueDraft}><Icon name="edit" size={15} /> Continue draft</button>
            : (
              <>
                <button type="button" className="em-btn" onClick={() => onReply('reply')}><Icon name="reply" size={15} /> Reply</button>
                <button type="button" className="em-btn" onClick={() => onReply('reply_all')}><Icon name="replyAll" size={15} /> Reply all</button>
                <button type="button" className="em-btn" onClick={() => onReply('forward')}><Icon name="forward" size={15} /> Forward</button>
              </>
            )}
        </div>
      )}
    </article>
  )
}

function Notes({ threadId, notes, canAdd, onAdded, toast }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  if (!notes.length && !canAdd) return null
  async function add(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try {
      onAdded(await emailApi.addNote(threadId, text.trim()))
      setText('')
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="em-notes" aria-labelledby={`notes-${threadId}`}>
      <h3 id={`notes-${threadId}`}><Icon name="note" size={14} /> Internal notes · only your team sees these</h3>
      {notes.map((n) => (
        <div key={n.id} className="em-note">
          <small>{n.author_name} · {fullTime(n.created_at)}</small>
          <p>{n.body}</p>
        </div>
      ))}
      {canAdd && (
        <form className="em-note-form" onSubmit={add}>
          <label className="em-visually-hidden" htmlFor={`note-${threadId}`}>Add an internal note</label>
          <input id={`note-${threadId}`} className="em-input" placeholder="Add a note for your team" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="em-btn" disabled={busy || !text.trim()}>Add</button>
        </form>
      )}
    </section>
  )
}

const TYPE_LABEL = { client: 'Client', vendor: 'Vendor', lead: 'Lead' }

function CrmPanel({ threadId, canLink, onClose, onLinked }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  useEffect(() => {
    let alive = true
    setData(null)
    emailApi.crm(threadId).then((d) => { if (alive) setData(d) }, (err) => { if (alive) setError(err.message) })
    return () => { alive = false }
  }, [threadId])

  async function toggle(r) {
    setBusy(`${r.type}:${r.id}`)
    try {
      const d = await (r.linked ? emailApi.unlink(threadId, r.type, r.id) : emailApi.link(threadId, r.type, r.id))
      setData(d)
      onLinked(d.records.filter((x) => x.linked).length)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const visible = data ? Object.entries(data.can_view).filter(([, v]) => v).map(([k]) => TYPE_LABEL[k]) : []
  return (
    <aside className="em-crm" aria-label="CRM records for this conversation">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2>CRM</h2>
        <button type="button" className="em-icon-btn" onClick={onClose} aria-label="Close CRM panel"><Icon name="close" size={17} /></button>
      </div>
      <p>Records whose email address appears in this conversation, and records linked to it.</p>
      {error && <Banner tone="danger">{error}</Banner>}
      {!data && !error && <div className="em-skeleton" style={{ height: 100 }} aria-hidden="true" />}
      {data && visible.length === 0 && <EmptyState icon="clients" title="No CRM access">You do not have permission to view clients, vendors or leads.</EmptyState>}
      {data && visible.length > 0 && data.records.length === 0 && (
        <EmptyState icon="clients" title="No matching records">No {visible.join(', ').toLowerCase()} use these email addresses.</EmptyState>
      )}
      {data?.records.map((r) => (
        <div key={`${r.type}:${r.id}`} className="em-record">
          <span className="em-record-type">{TYPE_LABEL[r.type]}{r.linked ? ' · linked' : ''}</span>
          <strong>{r.name || '(unnamed)'}</strong>
          {r.contact && r.contact !== r.name && <span>{r.contact}</span>}
          {r.email && <span>{r.email}</span>}
          {r.place && <span>{r.place}</span>}
          {canLink && (
            <button type="button" className={`em-btn${r.linked ? '' : ' em-btn-primary'}`} disabled={busy === `${r.type}:${r.id}`} onClick={() => toggle(r)}>
              <Icon name="link" size={14} /> {r.linked ? 'Unlink' : 'Link to conversation'}
            </button>
          )}
        </div>
      ))}
    </aside>
  )
}
