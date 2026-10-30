import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useAccess } from '../../lib/access'
import { emailApi } from './emailApi'
import { Banner, ConfirmDialog, EmptyState, StatusPill } from './emailUi'
import { useEmailStatus, useMailboxes, useToast } from './emailHooks'
import { CONNECT_OUTCOMES, PROVIDER_LABELS, ROLE_HELP, ROLE_LABELS, formatSize, relativeTime } from './emailFormat'
import './email.css'

// Connecting mailboxes (Google Workspace or Hostinger) and choosing who may
// use them. The buttons follow what the API says this person may do; the
// database enforces the same rules (nobody grants themselves access, a
// personal mailbox is shared only by its owner, setting up shared mailboxes
// does not let you read them).
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
  const hostingerReady = Boolean(status?.hostinger?.configured)
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

  async function connectHostinger(accountId) {
    setConnecting(accountId ?? 'personal')
    try {
      await emailApi.connectHostinger(accountId)
      toast('Hostinger mailbox connected. The first sync is running; recent conversations appear in a minute.')
      reload()
    } catch (err) {
      toast(err.message)
    } finally {
      setConnecting(null)
    }
  }

  const reconnect = (m) => {
    const id = m.kind === 'personal' ? null : m.id
    return m.provider === 'hostinger' ? connectHostinger(id) : connect(id)
  }
  const providerReady = (m) => (m.provider === 'hostinger' ? hostingerReady : gmailReady)

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
        ? `Dikho stops using this mailbox and deletes what it cached about it: conversation list, internal notes and CRM links. Mail in ${m.provider === 'hostinger' ? 'Hostinger' : 'Gmail'} is not touched.`
        : m.provider === 'hostinger'
          ? 'Dikho stops reading and sending from this mailbox at once. Conversation list, notes and links are kept, so reconnecting picks up where it left off. Mail at Hostinger is not touched. To remove Dikho\'s access at Hostinger itself, an administrator removes the mailbox from the API token in hPanel.'
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
          <h1>Email settings</h1>
          <p>Connect mailboxes and decide who may read and answer them.</p>
        </div>
      </div>

      {outcomeCopy && <Banner tone={outcomeCopy[0]}>{outcomeCopy[1]}</Banner>}
      {error && <Banner tone="danger" title="Could not load mailboxes">{error}</Banner>}
      {status && !gmailReady && !hostingerReady && (
        <Banner tone="warn" title="No mail provider is set up yet">
          An administrator needs to add Google OAuth (with the token encryption key) or a Hostinger Mail API token to the API server before any mailbox can be connected. The setup guide explains both.
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
              <div className="em-list-actions" style={{ flexWrap: 'wrap' }}>
                {gmailReady && (
                  <button type="button" className="em-btn em-btn-primary" disabled={Boolean(connecting)} onClick={() => connect(null)}>
                    <Icon name="mail" size={16} /> {connecting === 'personal' ? 'Opening Google…' : 'Connect with Google'}
                  </button>
                )}
                {hostingerReady && (
                  <button type="button" className={`em-btn${gmailReady ? '' : ' em-btn-primary'}`} disabled={Boolean(connecting)} onClick={() => connectHostinger(null)}>
                    <Icon name="mail" size={16} /> {connecting === 'personal' && !gmailReady ? 'Connecting…' : 'Connect Hostinger mailbox'}
                  </button>
                )}
              </div>
            )}
          </div>
          {mine ? (
            <MailboxRow m={mine} onSync={syncNow} onReconnect={() => reconnect(mine)} onDisconnect={askDisconnect}
              onMembers={() => setMembersFor(mine)} ready={providerReady(mine)} connecting={connecting === 'personal'} onChanged={reload} toast={toast} />
          ) : (
            <div style={{ display: 'grid', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
              {gmailReady && <p style={{ margin: 0 }}><strong>Google Workspace:</strong> you sign in on Google's page and approve access to read, organise and send mail. Dikho never sees your password, and you can disconnect at any time.</p>}
              {hostingerReady && <p style={{ margin: 0 }}><strong>Hostinger:</strong> connects your own sign-in address{access?.email ? ` (${access.email})` : ''}, if it is a Hostinger mailbox included in Dikho's Hostinger API token. Nobody can connect a colleague's address this way.</p>}
              {!gmailReady && !hostingerReady && <p style={{ margin: 0 }}>Connecting becomes available once an administrator has set up a mail provider.</p>}
            </div>
          )}
        </section>
      )}

      {(data?.can_manage_shared || sharedAdmin.length > 0) && (
        <section className="em-card" aria-labelledby="em-shared-title">
          <div className="em-card-head">
            <div>
              <h2 id="em-shared-title">Shared mailboxes</h2>
              <p>Team addresses (for example sales@ or contact@) at Google Workspace or Hostinger. Setting one up does not let you read it; someone else adds you.</p>
            </div>
          </div>
          {data?.can_manage_shared && (
            <AddShared gmailReady={gmailReady} hostingerReady={hostingerReady} existing={sharedAdmin.map((m) => m.email_address)}
              onAdded={(provider) => { toast(provider === 'hostinger' ? 'Hostinger mailbox added and connected. Add the people who should use it.' : 'Shared mailbox added. Connect it to Google next.'); reload() }} />
          )}
          {sharedAdmin.length === 0
            ? <EmptyState icon="users" title="No shared mailboxes yet" />
            : (
              <ul className="em-list" style={{ marginTop: 8 }}>
                {sharedAdmin.map((m) => (
                  <li key={m.id} style={{ display: 'block' }}>
                    <MailboxRow m={m} onSync={syncNow} onReconnect={() => reconnect(m)} onDisconnect={askDisconnect}
                      onMembers={() => setMembersFor(m)} ready={providerReady(m)} connecting={connecting === m.id} shared onChanged={reload} toast={toast} />
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
                  <div className="em-list-title">{m.display_name || m.email_address} <ProviderPill provider={m.provider} /> <span className="em-pill">{ROLE_LABELS[m.role]}</span></div>
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
      <p className="em-footnote">
        Step-by-step setup for Google Workspace, Hostinger and campaign sending: <code>docs/runbooks/email-hub-setup-guide.md</code> in the Dikho repository.
      </p>

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

function ProviderPill({ provider }) {
  if (!provider) return null
  return <span className="em-pill is-brand" title={`Hosted at ${PROVIDER_LABELS[provider] ?? provider}`}>{PROVIDER_LABELS[provider] ?? provider}</span>
}

function MailboxRow({ m, onSync, onReconnect, onDisconnect, onMembers, ready, connecting, shared, onChanged, toast }) {
  const canConfigure = m.can_configure !== false
  const needsConnect = m.status !== 'connected'
  const hostinger = m.provider === 'hostinger'
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="em-list-main" style={{ minWidth: 220 }}>
          <div className="em-list-title">
            {m.display_name || m.email_address} <ProviderPill provider={m.provider} /> <StatusPill status={m.status} />
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
            <button type="button" className="em-btn em-btn-primary" disabled={!ready || connecting} onClick={onReconnect}
              title={ready ? undefined : `${PROVIDER_LABELS[m.provider] ?? 'This provider'} is not set up on the server.`}>
              {connecting ? (hostinger ? 'Connecting…' : 'Opening Google…') : m.status === 'pending' ? 'Connect' : 'Reconnect'}
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
      {m.status === 'connected' && m.role && <MailboxHealth m={m} />}
      {canConfigure && m.status === 'connected' && <CampaignSender m={m} onChanged={onChanged} toast={toast} />}
    </div>
  )
}

// Two separate questions, answered separately: does outside mail reach this
// mailbox (the domain's MX records), and how full is it (Hostinger only).
// Neither is implied by "Connected".
function MailboxHealth({ m }) {
  const [routing, setRouting] = useState(null)
  const [quota, setQuota] = useState(undefined)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    emailApi.routing(m.id).then((r) => { if (live) setRouting(r) }, () => { if (live) setRouting({ inbound: 'unknown', note: 'The domain\'s mail routing could not be checked just now.' }) })
    if (m.capabilities?.quota) emailApi.quota(m.id).then((r) => { if (live) setQuota(r.quota) }, () => { if (live) setQuota(null) })
    return () => { live = false }
  }, [m.id, m.capabilities?.quota])
  const tone = { direct: 'ok', elsewhere: 'warn', none: 'danger' }[routing?.inbound] ?? ''
  const label = { direct: 'Receives mail directly', elsewhere: 'Incoming mail goes elsewhere', none: 'Domain cannot receive mail', unknown: 'Receiving not checked' }[routing?.inbound]
  return (
    <div className="em-health">
      {routing ? (
        <button type="button" className={`em-pill${tone ? ` is-${tone}` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className={`em-dot${tone ? ` is-${tone}` : ''}`} />{label}
        </button>
      ) : <span className="em-pill">Checking how mail reaches it…</span>}
      {quota && quota.limit_bytes ? <span className="em-pill">Storage {formatSize(quota.used_bytes)} of {formatSize(quota.limit_bytes)} ({quota.percent}%)</span> : null}
      {open && routing && (
        <p className="em-health-note">
          {routing.note}
          {routing.mx?.length ? <> Current MX: {routing.mx.map((r) => r.host).join(', ')}.</> : null}
        </p>
      )}
    </div>
  )
}

// Campaigns may go out from this mailbox only after its owner or
// administrators allow it here, with a daily limit of their own. The
// organization-wide limit applies on top.
function CampaignSender({ m, onChanged, toast }) {
  const [editing, setEditing] = useState(false)
  const [enabled, setEnabled] = useState(Boolean(m.campaign_sender))
  const [cap, setCap] = useState(m.campaign_daily_cap ?? 50)
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await emailApi.setCampaignSender(m.id, enabled, enabled ? Number(cap) : null)
      toast(enabled ? `Campaigns may now be sent from ${m.email_address}, up to ${cap} a day.` : `Campaigns are no longer sent from ${m.email_address}.`)
      setEditing(false)
      onChanged()
    } catch (err) {
      toast(err.message)
    } finally {
      setBusy(false)
    }
  }
  if (!editing) {
    return (
      <div className="em-health">
        <span className={`em-pill${m.campaign_sender ? ' is-ok' : ''}`}>
          {m.campaign_sender ? `Campaigns: up to ${m.campaign_daily_cap} a day` : 'Campaigns: not allowed'}
        </span>
        <button type="button" className="em-link-btn" onClick={() => setEditing(true)}>Change</button>
      </div>
    )
  }
  return (
    <form className="em-form-inline" onSubmit={save}>
      <label className="em-check-label">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Allow approved campaigns from this mailbox
      </label>
      {enabled && (
        <label>Most per day (1 to 2000)
          <input className="em-input" type="number" min={1} max={2000} required value={cap} onChange={(e) => setCap(e.target.value)} />
        </label>
      )}
      <div className="em-list-actions">
        <button type="button" className="em-btn" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
        <button type="submit" className="em-btn em-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      <p className="em-health-note" style={{ gridColumn: '1 / -1' }}>
        Ordinary mailboxes are not bulk senders. Start low (for example 50 a day) and stay well under the provider's own limits: a mailbox that is limited or flagged for spam also stops working for everyday mail.
      </p>
    </form>
  )
}

function AddShared({ onAdded, gmailReady, hostingerReady, existing }) {
  const [provider, setProvider] = useState(gmailReady || !hostingerReady ? 'google' : 'hostinger')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hostingerList, setHostingerList] = useState(null)

  useEffect(() => {
    if (provider !== 'hostinger' || !hostingerReady || hostingerList) return
    emailApi.hostingerMailboxes().then((r) => setHostingerList(r.addresses ?? []), (err) => { setHostingerList([]); setError(err.message) })
  }, [provider, hostingerReady, hostingerList])

  const available = (hostingerList ?? []).filter((a) => !existing.includes(a))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await emailApi.createShared(email.trim(), name.trim(), provider)
      setEmail('')
      setName('')
      onAdded(provider)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="em-form-inline" onSubmit={submit} style={{ marginBottom: 6 }}>
      <fieldset className="em-provider-choice">
        <legend>Where is this mailbox hosted?</legend>
        <label className={provider === 'google' ? 'is-on' : ''}>
          <input type="radio" name="em-provider" value="google" checked={provider === 'google'} onChange={() => { setProvider('google'); setEmail('') }} />
          <span><strong>Google Workspace</strong><small>{gmailReady ? 'Connect securely with Google after adding it.' : 'Not set up on the server yet.'}</small></span>
        </label>
        <label className={provider === 'hostinger' ? 'is-on' : ''}>
          <input type="radio" name="em-provider" value="hostinger" checked={provider === 'hostinger'} onChange={() => { setProvider('hostinger'); setEmail('') }} />
          <span><strong>Hostinger Email</strong><small>{hostingerReady ? 'Connected through the Hostinger Mail API token.' : 'Not set up on the server yet.'}</small></span>
        </label>
      </fieldset>
      {provider === 'hostinger' ? (
        <label>Address
          <select className="em-select" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={!hostingerReady || hostingerList === null}>
            <option value="">{hostingerList === null ? 'Loading…' : available.length ? 'Choose a Hostinger mailbox…' : 'No other mailboxes in the token'}</option>
            {available.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      ) : (
        <label>Address<input className="em-input" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      )}
      <label>Name shown in Dikho<input className="em-input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button type="submit" className="em-btn em-btn-primary" disabled={busy || !email.trim() || (provider === 'hostinger' ? !hostingerReady : false)} style={{ minHeight: 36 }}>
        {busy ? 'Adding…' : provider === 'hostinger' ? 'Add and connect' : 'Add mailbox'}
      </button>
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
  return (
    <section className="em-card" aria-labelledby="em-sending-title">
      <div className="em-card-head">
        <div>
          <h2 id="em-sending-title">System email</h2>
          <p>
            Mail Dikho sends by itself, such as staff welcome emails, goes through {delivery.provider === 'brevo' ? 'Brevo' : delivery.provider === 'ses' ? 'Amazon SES' : 'no provider yet'}.
            Approved campaigns are sent from a connected mailbox that has been allowed for campaigns above; Amazon SES is optional and not required.
          </p>
        </div>
        <span className={`em-pill ${delivery.provider ? 'is-ok' : 'is-warn'}`}>
          {delivery.provider === 'ses' ? 'Amazon SES' : delivery.provider === 'brevo' ? 'Brevo' : 'Not sending'}
        </span>
      </div>
      <ul className="em-checklist">
        <li><span className={`em-check${delivery.brevo?.configured ? ' is-done' : ''}`}><Icon name="check" size={13} strokeWidth={2.6} /></span><div>Brevo configured (system email)</div></li>
        <li><span className={`em-check${ses.configured && ses.sending_enabled ? ' is-done' : ''}`}><Icon name="check" size={13} strokeWidth={2.6} /></span><div>Amazon SES (optional): {ses.sending_enabled ? 'switched on' : 'off'}</div></li>
      </ul>
    </section>
  )
}
