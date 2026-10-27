import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useAccess } from '../../lib/access'
import { emailApi } from './emailApi'
import Composer from './Composer'
import Conversation from './Conversation'
import { Banner, EmptyState } from './emailUi'
import { useMailboxes, useToast } from './emailHooks'
import { FOLDERS, listTime, participantLine, relativeTime } from './emailFormat'
import './email.css'

// The inbox: mailboxes and folders, the conversation list, the open
// conversation, and (on request) the CRM records it concerns. Where the
// person is lives in the URL (folder, mailbox, search, conversation), so a
// link or a reload lands in the same place.
//
// Keyboard (outside text fields): j/k next/previous, Enter or o open,
// u or Escape back to the list, e archive, s star, r reply, a reply all,
// f forward, c compose, / search, ? shortcuts.
const PAGE = 30
const REFRESH_MS = 60_000

export default function EmailInbox() {
  const { access } = useAccess()
  const navigate = useNavigate()
  const { threadId } = useParams()
  const [params, setParams] = useSearchParams()
  const folder = FOLDERS.some((f) => f.key === params.get('folder')) ? params.get('folder') : 'inbox'
  const mailboxId = params.get('mailbox') || null
  const search = params.get('q') || ''
  const unreadOnly = params.get('unread') === '1'

  const { data: accounts, error: accountsError, reload: reloadAccounts } = useMailboxes()
  const mailboxes = useMemo(() => accounts?.mailboxes ?? [], [accounts])
  const mailbox = mailboxes.find((m) => m.id === mailboxId) ?? null

  const [list, setList] = useState({ threads: [], hasMore: false, loading: true, error: '', gmail: false })
  const [searchText, setSearchText] = useState(search)
  const [crmOpen, setCrmOpen] = useState(false)
  const [composer, setComposer] = useState(null) // { mode, source?, thread?, draft?, accountId? }
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [toastNode, toast] = useToast()
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const conversationRef = useRef(null)

  const setParam = useCallback((changes) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }, [params, setParams])

  const openThread = useCallback((id) => {
    navigate({ pathname: id ? `/email/inbox/${id}` : '/email/inbox', search: params.toString() })
  }, [navigate, params])

  // Search applies after typing pauses.
  useEffect(() => { setSearchText(search) }, [search])
  useEffect(() => {
    if (searchText === search) return undefined
    const timer = setTimeout(() => setParam({ q: searchText.trim() }), 300)
    return () => clearTimeout(timer)
  }, [searchText, search, setParam])

  // The loaded rows, read by "Load more" without making every load depend on them.
  const threadsRef = useRef([])
  threadsRef.current = list.threads

  const load = useCallback(async ({ more = false, quiet = false } = {}) => {
    if (!quiet) setList((l) => ({ ...l, loading: true, error: '', ...(more ? {} : { gmail: false }) }))
    try {
      const last = more ? threadsRef.current[threadsRef.current.length - 1] : null
      const page = await emailApi.threads({
        folder, account: mailboxId, unread: unreadOnly, search, limit: PAGE,
        before_at: last?.last_message_at, before_id: last?.id,
      })
      setList((l) => ({ threads: more ? [...l.threads, ...page.threads] : page.threads, hasMore: page.has_more, loading: false, error: '', gmail: false }))
    } catch (err) {
      setList((l) => ({ ...l, loading: false, error: err.message }))
    }
  }, [folder, mailboxId, unreadOnly, search])

  useEffect(() => { load() }, [load])

  // Quiet refresh while the page is visible; the server syncs mailboxes on
  // the way (see sync.js), so new mail appears without a reload.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !list.gmail) { load({ quiet: true }); reloadAccounts() }
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load, reloadAccounts, list.gmail])

  // Searching the provider itself (beyond what Dikho has synced) is Gmail only.
  const providerSearch = Boolean(mailboxId) && mailbox?.capabilities?.search !== false
  async function searchGmail() {
    if (!providerSearch || !search) return
    setList((l) => ({ ...l, loading: true, error: '' }))
    try {
      const r = await emailApi.search(mailboxId, search)
      setList({ threads: r.threads, hasMore: false, loading: false, error: '', gmail: true })
    } catch (err) {
      setList((l) => ({ ...l, loading: false, error: err.message }))
    }
  }

  // Keeps the list in step with what happened in the open conversation.
  const patchThread = useCallback((id, patch) => {
    setList((l) => ({ ...l, threads: l.threads.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  }, [])
  const dropThread = useCallback((id) => {
    setList((l) => ({ ...l, threads: l.threads.filter((t) => t.id !== id) }))
  }, [])

  const index = list.threads.findIndex((t) => t.id === threadId)
  const writable = mailboxes.some((m) => m.status === 'connected' && ['responder', 'manager', 'admin'].includes(m.role))
  const unreadTotal = mailboxes.reduce((n, m) => n + (Number(m.unread_count) || 0), 0)

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
      if (document.querySelector('.modal-backdrop') || composer) return
      const go = (i) => { const t = list.threads[i]; if (t) openThread(t.id) }
      switch (e.key) {
        case 'j': go(index < 0 ? 0 : Math.min(index + 1, list.threads.length - 1)); break
        case 'k': go(index < 0 ? 0 : Math.max(index - 1, 0)); break
        case 'o': case 'Enter': if (index < 0) go(0); break
        case 'u': case 'Escape': if (threadId) openThread(null); break
        case '/': e.preventDefault(); searchRef.current?.focus(); break
        case 'c': if (writable) setComposer({ mode: 'new', accountId: mailboxId }); break
        case '?': setShortcutsOpen(true); break
        default: conversationRef.current?.handleKey?.(e.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list.threads, index, threadId, openThread, composer, writable, mailboxId])

  // The selected row stays visible as j/k moves through the list.
  useEffect(() => {
    listRef.current?.querySelector('.em-row.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [threadId])

  if (accounts && mailboxes.length === 0) {
    return (
      <div className="em-page">
        <EmptyState icon="inbox" title="No mailbox yet"
          action={<Link className="em-btn em-btn-primary" to="/email/settings">Connect a mailbox</Link>}>
          Connect your Google Workspace mailbox, or ask a colleague to add you to a shared one.
        </EmptyState>
      </div>
    )
  }

  const folderLabel = FOLDERS.find((f) => f.key === folder)?.label ?? 'Inbox'
  const heading = mailbox ? `${folderLabel} · ${mailbox.display_name || mailbox.email_address}` : folderLabel

  return (
    <div className={`em-page workspace-bleed em-inbox${crmOpen && threadId ? ' has-crm' : ''}${threadId ? ' is-reading' : ''}`}>
      <nav className="em-rail" aria-label="Mail folders and mailboxes">
        <button type="button" className="em-btn em-btn-primary" disabled={!writable} onClick={() => setComposer({ mode: 'new', accountId: mailboxId })}
          title={writable ? 'New message (c)' : 'You need responder access to a connected mailbox to write'}>
          <Icon name="edit" size={16} /> Compose
        </button>
        {FOLDERS.map((f) => (
          <button key={f.key} type="button" className={`em-rail-item${folder === f.key ? ' is-active' : ''}`}
            aria-current={folder === f.key ? 'page' : undefined}
            onClick={() => { setParam({ folder: f.key === 'inbox' ? '' : f.key }); if (threadId) openThread(null) }}>
            <Icon name={f.icon} size={17} />
            <span className="em-rail-label">{f.label}</span>
            {f.key === 'inbox' && unreadTotal > 0 && <span className="em-count">{unreadTotal}</span>}
          </button>
        ))}
        <div className="em-rail-heading">Mailboxes</div>
        <button type="button" className={`em-rail-item${!mailboxId ? ' is-active' : ''}`} onClick={() => setParam({ mailbox: '' })}>
          <Icon name="mail" size={17} /><span className="em-rail-label">All mailboxes</span>
        </button>
        {mailboxes.map((m) => (
          <button key={m.id} type="button" className={`em-rail-item${mailboxId === m.id ? ' is-active' : ''}`}
            onClick={() => setParam({ mailbox: m.id })} title={m.email_address}>
            <span className={`em-dot ${m.status === 'connected' ? (m.last_sync_error ? 'is-warn' : 'is-ok') : 'is-danger'}`} />
            <span className="em-rail-label">{m.display_name || m.email_address}</span>
            {m.provider === 'hostinger' && <span className="em-rail-tag" title="Hostinger mailbox">H</span>}
            {m.unread_count > 0 && <span className="em-count">{m.unread_count}</span>}
          </button>
        ))}
        <div className="em-rail-foot">
          {mailbox
            ? <>Synced {relativeTime(mailbox.last_synced_at)}{mailbox.status !== 'connected' && <><br /><Link to="/email/settings">Reconnect this mailbox</Link></>}</>
            : <>Press <kbd>?</kbd> for keyboard shortcuts</>}
        </div>
      </nav>

      <section className="em-listpane" aria-label="Conversations">
        <div className="em-listhead">
          <div className="em-listhead-row">
            <h1>{heading}</h1>
            <button type="button" className="em-icon-btn" onClick={() => { load(); reloadAccounts() }} aria-label="Refresh" title="Refresh">
              <Icon name="sync" size={17} />
            </button>
          </div>
          <div className="em-mobile-folders">
            <div className="em-listhead-row">
              <select className="em-select" aria-label="Folder" value={folder} onChange={(e) => setParam({ folder: e.target.value === 'inbox' ? '' : e.target.value })}>
                {FOLDERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select className="em-select" aria-label="Mailbox" value={mailboxId ?? ''} onChange={(e) => setParam({ mailbox: e.target.value })}>
                <option value="">All mailboxes</option>
                {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.display_name || m.email_address}</option>)}
              </select>
              <button type="button" className="em-icon-btn" disabled={!writable} onClick={() => setComposer({ mode: 'new', accountId: mailboxId })} aria-label="Compose">
                <Icon name="edit" size={17} />
              </button>
            </div>
          </div>
          <label className="em-search">
            <span className="em-visually-hidden">Search conversations</span>
            <Icon name="search" size={16} />
            <input ref={searchRef} type="search" placeholder="Search subject, people or address" value={searchText} maxLength={100}
              onChange={(e) => setSearchText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setSearchText(''); e.currentTarget.blur() } }} />
          </label>
          <div className="em-chips" role="group" aria-label="Filter">
            <button type="button" className={`em-chip${!unreadOnly ? ' is-active' : ''}`} aria-pressed={!unreadOnly} onClick={() => setParam({ unread: '' })}>All</button>
            <button type="button" className={`em-chip${unreadOnly ? ' is-active' : ''}`} aria-pressed={unreadOnly} onClick={() => setParam({ unread: '1' })}>Unread</button>
            {list.gmail && <span className="em-pill is-brand">Results from Gmail</span>}
          </div>
        </div>

        {accountsError && <div style={{ padding: 12 }}><Banner tone="danger">{accountsError}</Banner></div>}
        {list.error && (
          <div style={{ padding: 12 }}>
            <Banner tone="danger" title="Could not load conversations" action={<button type="button" className="em-btn" onClick={() => load()}>Retry</button>}>{list.error}</Banner>
          </div>
        )}

        <ul className="em-threads" ref={listRef} aria-busy={list.loading}>
          {list.loading && list.threads.length === 0 && [0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="em-row" aria-hidden="true"><div className="em-skeleton" style={{ height: 12, width: '60%' }} /><div className="em-skeleton" style={{ height: 10, width: '85%' }} /></li>
          ))}
          {!list.loading && !list.error && list.threads.length === 0 && (
            <li>
              <EmptyState icon={search ? 'search' : 'inbox'} title={search ? 'No matches' : folder === 'inbox' ? 'Inbox zero' : `Nothing in ${folderLabel}`}>
                {search
                  ? (mailboxId ? 'Dikho keeps recent conversations. Older mail can still be found in Gmail.' : 'Pick one mailbox to search all of its Gmail, including older mail.')
                  : folder === 'inbox' ? 'New conversations will appear here as they arrive.' : null}
              </EmptyState>
            </li>
          )}
          {list.threads.map((t) => (
            <li key={t.id}>
              <button type="button" className={`em-row${t.id === threadId ? ' is-active' : ''}${t.unread ? ' is-unread' : ''}`}
                aria-current={t.id === threadId ? 'true' : undefined} onClick={() => openThread(t.id)}>
                <span className="em-row-top">
                  {t.unread && <span className="em-dot is-unread" aria-label="Unread" />}
                  <span className="em-row-from">{participantLine(t, t.account_email)}</span>
                  <span className="em-row-time">{listTime(t.last_message_at)}</span>
                </span>
                <span className="em-row-subject">{t.subject || '(no subject)'}</span>
                <span className="em-row-meta">
                  {!mailboxId && mailboxes.length > 1 && <span className="em-row-mailbox">{t.account_name || t.account_email}</span>}
                  {t.starred && <span className="em-star"><Icon name="star" size={13} /></span>}
                  {t.has_attachments && <Icon name="paperclip" size={13} />}
                  {t.link_count > 0 && <span title="Linked to CRM records"><Icon name="link" size={13} /></span>}
                  {t.note_count > 0 && <span title="Internal notes"><Icon name="note" size={13} /></span>}
                  {t.workflow_status !== 'open' && <span className={`em-pill${t.workflow_status === 'closed' ? ' is-ok' : ' is-warn'}`}>{t.workflow_status === 'closed' ? 'Done' : 'Waiting'}</span>}
                  {t.assigned_name && <span className="em-pill">{t.assigned_to === access?.user_id ? 'You' : t.assigned_name}</span>}
                </span>
              </button>
            </li>
          ))}
          {(list.hasMore || (search && providerSearch && !list.gmail && !list.loading)) && (
            <li className="em-more">
              {list.hasMore && <button type="button" className="em-btn" disabled={list.loading} onClick={() => load({ more: true })}>{list.loading ? 'Loading…' : 'Load more'}</button>}
              {search && providerSearch && !list.gmail && !list.loading && (
                <button type="button" className="em-btn" style={{ marginTop: 8 }} onClick={searchGmail}><Icon name="search" size={15} /> Search all of Gmail</button>
              )}
            </li>
          )}
        </ul>
      </section>

      {threadId ? (
        <Conversation
          ref={conversationRef}
          key={threadId}
          threadId={threadId}
          mailboxes={mailboxes}
          me={access?.user_id}
          crmOpen={crmOpen}
          onToggleCrm={() => setCrmOpen((v) => !v)}
          onBack={() => openThread(null)}
          onPatch={patchThread}
          onRemoveFromList={(id) => {
            const next = list.threads[index + 1] ?? list.threads[index - 1]
            dropThread(id)
            openThread(next?.id ?? null)
          }}
          onCompose={(c) => setComposer(c)}
          inlineComposer={composer && composer.mode !== 'new' && composer.thread?.id === threadId ? (
            <Composer {...composer} mailboxes={mailboxes} toast={toast} onClose={() => setComposer(null)} onSent={() => { load({ quiet: true }); conversationRef.current?.reload?.() }} />
          ) : null}
          toast={toast}
        />
      ) : (
        <section className="em-convo" aria-label="Conversation">
          <EmptyState icon="mail" title="Select a conversation">
            Choose a conversation to read it. Use <kbd>j</kbd> and <kbd>k</kbd> to move through the list.
          </EmptyState>
        </section>
      )}

      {composer && (composer.mode === 'new' || composer.thread?.id !== threadId) && (
        <Composer {...composer} floating mailboxes={mailboxes} toast={toast} onClose={() => setComposer(null)} onSent={() => load({ quiet: true })} />
      )}
      {shortcutsOpen && <Shortcuts onClose={() => setShortcutsOpen(false)} />}
      {toastNode}
    </div>
  )
}

function Shortcuts({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const keys = [['j / k', 'Next / previous conversation'], ['Enter or o', 'Open'], ['u or Esc', 'Back to the list'], ['e', 'Archive'],
    ['s', 'Star'], ['r', 'Reply'], ['a', 'Reply all'], ['f', 'Forward'], ['c', 'New message'], ['/', 'Search'], ['Ctrl + Enter', 'Send (in the composer)']]
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card em-dialog em-page" role="dialog" aria-modal="true" aria-labelledby="em-keys-title" onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(440px, 100%)' }}>
        <div className="modal-header" style={{ marginBottom: 8 }}>
          <h2 id="em-keys-title">Keyboard shortcuts</h2>
          <button type="button" className="em-icon-btn" onClick={onClose} aria-label="Close" autoFocus><Icon name="close" size={18} /></button>
        </div>
        <ul className="em-list">
          {keys.map(([k, label]) => <li key={k}><kbd style={{ minWidth: 92 }}>{k}</kbd><span className="em-list-main" style={{ fontSize: 13 }}>{label}</span></li>)}
        </ul>
      </div>
    </div>
  )
}
