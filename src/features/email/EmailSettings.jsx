import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useAccess } from '../../lib/access'
import { emailApi } from './emailApi'
import { Banner, ConfirmDialog, EmptyState, StatusPill } from './emailUi'
import { useEmailStatus, useMailboxes, useToast } from './emailHooks'
import { CONNECT_OUTCOMES, ROLE_HELP, ROLE_LABELS, relativeTime } from './emailFormat'
import './email.css'

// Connecting mailboxes and choosing who may use them. The buttons follow
// what the API says this person may do; the database enforces the same rules
// (nobody grants themselves access, a personal mailbox is shared only by its
// owner, setting up shared mailboxes does not let you read them).
export default function EmailSettings() {
  const { access } = useAccess()
  const [params, setParams] = useSearchParams()
  const { data, error, reload } = useMailboxes()
  const status = useEmailStatus()
  const [toastNode, toast] = useToast()
  const [confirm, setConfirm] = useState(null)
  const [membersFor, setMembersFor] = useState(null)
  const [connecting, setConnecting] = useState(null)

  // Outcome of the Google round trip, then out of the address bar.
  const [outcome] = useState(() => params.get('connect'))
  useEffect(() => {
    if (params.has('connect')) setParams({}, { replace: true })
  }, [params, setParams])

  const gmailReady = Boolean(status?.gmail?.configured)
  const mailboxes = useMemo(() => data?.mailboxes ?? [], [data])
  const mine = mailboxes.find((m) => m.kind === 'personal' && m.owner_id === access?.user_id)
  const sharedAdmin = useMemo(() => {
    const byId = new Map()
    for (const m of data?.shared_setup ?? []) byId.set(m.id, { ...m, can_configure: true })
    for (const m of mailboxes) if (m.kind === 'shared' && (m.can_configure || byId.has(m.id))) byId.set(m.id, { ...byId.get(m.id), ...m })
    return [...byId.values()].sort((a, b) => a.email_address.localeCompare(b.email_address))
  }, [data, mailboxes])
  // Mailboxes this person can read but not set up; the rest are listed above.
  const sharedWithMe = mailboxes.filter((m) => m !== mine && !sharedAdmin.some((x) => x.id === m.id))

  async function connect(accountId) {
    setConnecting(accountId ?? 'personal')
    try {
      const { url } = await emailApi.startConnect(accountId)
      window.location.assign(url)
    } catch (err) {
      toast(err.message)
      setConnecting(null)
    }
  }

  async function syncNow(id) {
    try {
      const r = await emailApi.sync(id)
      toast(r.busy ? 'A sync is already running.' : 'Mailbox synced.')
      reload()
    } catch (err) {
      toast(err.message)
    }
  }

  function askDisconnect(m, remove) {
    setConfirm({
      title: remove ? `Remove ${m.email_address}?` : `Disconnect ${m.email_address}?`,
      label: remove ? 'Remove mailbox' : 'Disconnect',
      body: remove
        ? 'Dikho stops using this mailbox and deletes what it cached about it: conversation list, internal notes and CRM links. Mail in Gmail is not touched.'
        : 'Dikho stops reading and sending from this mailbox at once and revokes its access at Google. Conversation list, notes and links are kept, so reconnecting picks up where it left off. Mail in Gmail is not touched.',
      run: async () => {
        await (remove ? emailApi.removeAccount(m.id) : emailApi.disconnect(m.id))
        setConfirm(null)
        toast(remove ? 'Mailbox removed.' : 'Mailbox disconnected.')
        reload()
      },
    })
  }

  const outcomeCopy = outcome ? CONNECT_OUTCOMES[outcome] ?? CONNECT_OUTCOMES.failed : null

  return (
    <div className="em-page em-settings">
      <div className="page-header">
        <div>
          <span className="page-kicker">EMAIL</span>
          <h1>Email settings</h1>
          <p>Connect mailboxes and decide who may read and answer them.</p>
        </div>
      </div>

      {outcomeCopy && <Banner tone={outcomeCopy[0]}>{outcomeCopy[1]}</Banner>}
      {error && <Banner tone="danger" title="Could not load mailboxes">{error}</Banner>}
      {status && !gmailReady && (
        <Banner tone="warn" title="Google sign-in is not set up yet">
          An administrator needs to add the Google OAuth client and the token encryption key to the API server before any mailbox can be connected.
        </Banner>
      )}

      {data?.can_connect_personal && (
        <section className="em-card" aria-labelledby="em-mine-title">
          <div className="em-card-head">
            <div>
              <h2 id="em-mine-title">Your mailbox</h2>
              <p>Only you can read it, unless you add someone below. Owners and administrators do not get access by their role.</p>
            </div>
            {!mine && (
              <button type="button" className="em-btn em-btn-primary" disabled={!gmailReady || connecting} onClick={() => connect(null)}>
                <Icon name="mail" size={16} /> {connecting === 'personal' ? 'Opening Google…' : 'Connect with Google'}
              </button>
            )}
          </div>
          {mine ? (
            <MailboxRow m={mine} onSync={syncNow} onReconnect={() => connect(null)} onDisconnect={askDisconnect}
              onMembers={() => setMembersFor(mine)} gmailReady={gmailReady} connecting={connecting === 'personal'} />
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
              You will sign in on Google's page and approve access to read, organise and send mail. Dikho never sees your password,
              and you can disconnect at any time.
            </p>
          )}
        </section>
      )}

      {(data?.can_manage_shared || sharedAdmin.length > 0) && (
        <section className="em-card" aria-labelledby="em-shared-title">
          <div className="em-card-head">
            <div>
              <h2 id="em-shared-title">Shared mailboxes</h2>
              <p>Team addresses that are their own Google accounts (for example sales@). Setting one up does not let you read it; add yourself through someone else.</p>
            </div>
          </div>
          {data?.can_manage_shared && <AddShared onAdded={() => { toast('Shared mailbox added. Connect it to Google next.'); reload() }} />}
          {sharedAdmin.length === 0
            ? <EmptyState icon="users" title="No shared mailboxes yet" />
            : (
              <ul className="em-list" style={{ marginTop: 8 }}>
                {sharedAdmin.map((m) => (
                  <li key={m.id} style={{ display: 'block' }}>
                    <MailboxRow m={m} onSync={syncNow} onReconnect={() => connect(m.id)} onDisconnect={askDisconnect}
                      onMembers={() => setMembersFor(m)} gmailReady={gmailReady} connecting={connecting === m.id} shared />
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}

      {sharedWithMe.length > 0 && (
        <section className="em-card" aria-labelledby="em-with-me-title">
          <div className="em-card-head"><div><h2 id="em-with-me-title">Shared with you</h2><p>Mailboxes someone else has added you to.</p></div></div>
          <ul className="em-list">
            {sharedWithMe.map((m) => (
              <li key={m.id}>
                <div className="em-list-main">
                  <div className="em-list-title">{m.display_name || m.email_address} <span className="em-pill">{ROLE_LABELS[m.role]}</span></div>
                  <div className="em-list-sub">{m.email_address}{m.kind === 'personal' && m.owner_name ? ` · ${m.owner_name}'s mailbox` : ''}</div>
                </div>
                <StatusPill status={m.status} />
                <button type="button" className="em-btn" onClick={() => setMembersFor(m)}>People</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {status && <SendingCard delivery={status.delivery} />}

      {membersFor && <MembersDialog mailbox={membersFor} me={access?.user_id} onClose={() => { setMembersFor(null); reload() }} />}
      {confirm && (
        <ConfirmDialog title={confirm.title} confirmLabel={confirm.label} onConfirm={confirm.run} onClose={() => setConfirm(null)}>
          {confirm.body}
        </ConfirmDialog>
      )}
      {toastNode}
    </div>
  )
}

function MailboxRow({ m, onSync, onReconnect, onDisconnect, onMembers, gmailReady, connecting, shared }) {
  const canConfigure = m.can_configure !== false
  const needsConnect = m.status !== 'connected'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div className="em-list-main" style={{ minWidth: 220 }}>
        <div className="em-list-title">
          {m.display_name || m.email_address} <StatusPill status={m.status} />
          {shared && m.role && <span className="em-pill">You: {ROLE_LABELS[m.role]}</span>}
        </div>
        <div className="em-list-sub">
          {m.email_address}
          {m.status === 'connected' && ` · synced ${relativeTime(m.last_synced_at)}`}
          {shared && typeof m.member_count === 'number' && ` · ${m.member_count} ${m.member_count === 1 ? 'person' : 'people'}`}
        </div>
        {m.last_sync_error && <div className="em-list-sub" style={{ color: 'var(--danger)', whiteSpace: 'normal' }}>{m.last_sync_error}</div>}
      </div>
      <div className="em-list-actions" style={{ flexWrap: 'wrap' }}>
        {m.status === 'connected' && m.role && (
          <button type="button" className="em-btn" onClick={() => onSync(m.id)}><Icon name="sync" size={15} /> Sync now</button>
        )}
        {canConfigure && needsConnect && (
          <button type="button" className="em-btn em-btn-primary" disabled={!gmailReady || connecting} onClick={onReconnect}>
            {connecting ? 'Opening Google…' : m.status === 'pending' ? 'Connect' : 'Reconnect'}
          </button>
        )}
        <button type="button" className="em-btn" onClick={onMembers}><Icon name="users" size={15} /> People</button>
        {canConfigure && m.status === 'connected' && (
          <button type="button" className="em-btn em-btn-danger" onClick={() => onDisconnect(m, false)}>Disconnect</button>
        )}
        {canConfigure && m.status !== 'connected' && (
          <button type="button" className="em-btn em-btn-danger" onClick={() => onDisconnect(m, true)}>Remove</button>
        )}
      </div>
    </div>
  )
}

function AddShared({ onAdded }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await emailApi.createShared(email.trim(), name.trim())
      setEmail('')
      setName('')
      onAdded()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="em-form-inline" onSubmit={submit} style={{ marginBottom: 6 }}>
      <label>Address<input className="em-input" type="email" required maxLength={254} placeholder="sales@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Name shown in Dikho<input className="em-input" maxLength={120} placeholder="Sales team" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button type="submit" className="em-btn em-btn-primary" disabled={busy || !email.trim()} style={{ minHeight: 36 }}>{busy ? 'Adding…' : 'Add mailbox'}</button>
      {error && <div style={{ gridColumn: '1 / -1' }}><Banner tone="danger">{error}</Banner></div>}
    </form>
  )
}

function MembersDialog({ mailbox, me, onClose }) {
  const [state, setState] = useState(null)
  const [directory, setDirectory] = useState([])
  const [error, setError] = useState('')
  const [adding, setAdding] = useState({ user: '', role: 'responder' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setState(await emailApi.members(mailbox.id))
    } catch (err) {
      setError(err.message)
    }
  }, [mailbox.id])
  useEffect(() => { load() }, [load])
  useEffect(() => { emailApi.directory().then(setDirectory, () => {}) }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const personal = mailbox.kind === 'personal'
  const roles = personal ? ['viewer', 'responder', 'manager'] : ['viewer', 'responder', 'manager', 'admin']
  const memberIds = new Set((state?.members ?? []).map((m) => m.user_id))
  const candidates = directory.filter((p) => !memberIds.has(p.user_id) && p.user_id !== me)

  async function change(fn) {
    setBusy(true)
    setError('')
    try {
      setState(await fn())
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => { if (!busy) onClose() }}>
      <div className="modal-card em-dialog em-page" role="dialog" aria-modal="true" aria-labelledby="em-members-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ marginBottom: 8 }}>
          <div>
            <h2 id="em-members-title">People with access</h2>
            <p style={{ margin: '2px 0 0', color: 'var(--muted)', fontSize: 13 }}>{mailbox.email_address}</p>
          </div>
          <button type="button" className="em-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        {error && <div style={{ marginBottom: 12 }}><Banner tone="danger">{error}</Banner></div>}
        {!state ? <div className="em-skeleton" style={{ height: 120 }} aria-hidden="true" /> : (
          <>
            <ul className="em-list">
              {state.members.length === 0 && <li><span className="em-list-sub">Nobody can read this mailbox yet.</span></li>}
              {state.members.map((p) => (
                <li key={p.user_id}>
                  <span className="em-avatar" aria-hidden="true">{(p.full_name || '?').slice(0, 1).toUpperCase()}</span>
                  <div className="em-list-main">
                    <div className="em-list-title">{p.full_name}{p.user_id === me ? ' (you)' : ''}{!p.active && <span className="em-pill is-warn">Inactive</span>}</div>
                    <div className="em-list-sub">{p.is_owner ? 'Owner of this mailbox' : `${ROLE_HELP[p.role]}${p.granted_by_name ? ` Added by ${p.granted_by_name}.` : ''}`}</div>
                  </div>
                  {state.can_configure && !p.is_owner && p.user_id !== me ? (
                    <div className="em-list-actions">
                      <select className="em-role-select" aria-label={`Role for ${p.full_name}`} value={p.role} disabled={busy}
                        onChange={(e) => change(() => emailApi.setMember(mailbox.id, p.user_id, e.target.value))}>
                        {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                      <button type="button" className="em-icon-btn" aria-label={`Remove ${p.full_name}`} title="Remove" disabled={busy}
                        onClick={() => change(() => emailApi.removeMember(mailbox.id, p.user_id))}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  ) : <span className="em-pill">{ROLE_LABELS[p.role]}</span>}
                  {p.user_id === me && !p.is_owner && (
                    <button type="button" className="em-btn em-btn-danger" disabled={busy}
                      onClick={() => change(async () => { await emailApi.removeMember(mailbox.id, me); onClose(); return state })}>Leave</button>
                  )}
                </li>
              ))}
            </ul>

            {state.can_configure ? (
              <form className="em-form-inline" style={{ marginTop: 14 }} onSubmit={(e) => {
                e.preventDefault()
                if (adding.user) change(async () => { const r = await emailApi.setMember(mailbox.id, adding.user, adding.role); setAdding({ user: '', role: adding.role }); return r })
              }}>
                <label>Add a person
                  <select className="em-select" value={adding.user} onChange={(e) => setAdding((a) => ({ ...a, user: e.target.value }))}>
                    <option value="">Choose…</option>
                    {candidates.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}{p.has_inbox ? '' : ' (needs Email permission)'}</option>)}
                  </select>
                </label>
                <label>Role
                  <select className="em-select" value={adding.role} onChange={(e) => setAdding((a) => ({ ...a, role: e.target.value }))}>
                    {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </label>
                <button type="submit" className="em-btn em-btn-primary" disabled={busy || !adding.user} style={{ minHeight: 36 }}>Add</button>
              </form>
            ) : (
              <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--muted)' }}>Only the mailbox's owner or its administrators can change who has access.</p>
            )}
            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
              {ROLE_HELP[adding.role]} Every change is recorded in the audit log. Nobody can give themselves access.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function SendingCard({ delivery }) {
  if (!delivery) return null
  const ses = delivery.ses ?? {}
  const rows = [
    ['Amazon SES credentials', ses.configured],
    ['SES sending switched on', ses.sending_enabled],
    ['Sender address set', delivery.from_configured],
    ['Delivery, bounce and complaint events', ses.events_configured && ses.notifications_configured],
  ]
  return (
    <section className="em-card" aria-labelledby="em-sending-title">
      <div className="em-card-head">
        <div>
          <h2 id="em-sending-title">System email</h2>
          <p>Mail Dikho sends by itself (welcome emails, alerts, approved campaigns) goes through Amazon SES, not a person's mailbox. Set on the server by an administrator.</p>
        </div>
        <span className={`em-pill ${delivery.provider ? 'is-ok' : 'is-warn'}`}>
          {delivery.provider === 'ses' ? 'Amazon SES' : delivery.provider === 'brevo' ? 'Brevo (legacy)' : 'Not sending'}
        </span>
      </div>
      <ul className="em-checklist">
        {rows.map(([label, done]) => (
          <li key={label}><span className={`em-check${done ? ' is-done' : ''}`}><Icon name="check" size={13} strokeWidth={2.6} /></span><div>{label}</div></li>
        ))}
      </ul>
      {delivery.provider === 'brevo' && <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>Brevo stays in use only until SES is switched on.</p>}
    </section>
  )
}
