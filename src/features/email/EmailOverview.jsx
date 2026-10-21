import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { useAccess } from '../../lib/access'
import { emailApi } from './emailApi'
import { Banner, EmptyState, StatusPill } from './emailUi'
import { useEmailStatus, useMailboxes, useToast } from './emailHooks'
import { ROLE_LABELS, listTime, participantLine, relativeTime } from './emailFormat'
import './email.css'

// Email Hub landing: what needs attention now, and what is not set up yet.
// Every number is real (from the mailbox cache); nothing is a placeholder.
export default function EmailOverview() {
  const { can, access } = useAccess()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useMailboxes()
  const status = useEmailStatus()
  const [unread, setUnread] = useState(null)
  const [assigned, setAssigned] = useState(null)
  const [syncing, setSyncing] = useState(null)
  const [toastNode, toast] = useToast()

  const mailboxes = useMemo(() => data?.mailboxes ?? [], [data])
  const hasMailbox = mailboxes.length > 0

  useEffect(() => {
    if (!hasMailbox || !can('email_inbox.view')) return
    let alive = true
    emailApi.threads({ folder: 'inbox', unread: true, limit: 6 }).then((r) => { if (alive) setUnread(r) }, () => {})
    emailApi.threads({ folder: 'assigned', limit: 50 }).then((r) => { if (alive) setAssigned(r) }, () => {})
    return () => { alive = false }
  }, [hasMailbox, can])

  const totalUnread = mailboxes.reduce((n, m) => n + (Number(m.unread_count) || 0), 0)
  const connected = mailboxes.filter((m) => m.status === 'connected').length
  const attention = mailboxes.filter((m) => m.status === 'reauth_required' || m.last_sync_error)
  const openAssigned = (assigned?.threads ?? []).filter((t) => t.workflow_status !== 'closed')

  async function syncNow(id) {
    setSyncing(id)
    try {
      const r = await emailApi.sync(id)
      toast(r.busy ? 'A sync is already running for this mailbox.' : 'Mailbox synced.')
      reload()
    } catch (err) {
      toast(err.message)
    } finally {
      setSyncing(null)
    }
  }

  return (
    <div className="em-page" style={{ paddingBottom: 96 }}>
      <div className="page-header">
        <div>
          <span className="page-kicker">EMAIL</span>
          <h1>Email</h1>
          <p>Your mailboxes and your team's, beside the clients and vendors they concern.</p>
        </div>
        {hasMailbox && can('email_inbox.view') && (
          <button type="button" className="em-btn em-btn-primary" onClick={() => navigate('/email/inbox')}>
            <Icon name="inbox" size={16} /> Open inbox
          </button>
        )}
      </div>

      {error && <Banner tone="danger" title="Could not load your mailboxes">{error}</Banner>}

      {loading && !data && (
        <div className="em-grid em-grid-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="em-card"><div className="em-skeleton" style={{ height: 52 }} /></div>)}
        </div>
      )}

      {data && !hasMailbox && <SetupCard data={data} status={status} />}

      {data && hasMailbox && (
        <div className="em-grid" style={{ gap: 18 }}>
          <div className="em-grid em-grid-4">
            <Stat label="Unread in inbox" value={totalUnread} sub={`across ${mailboxes.length} mailbox${mailboxes.length === 1 ? '' : 'es'}`} />
            <Stat label="Assigned to you" value={assigned ? (openAssigned.length >= 50 ? '50+' : openAssigned.length) : '–'} sub="open or waiting" />
            <Stat label="Connected" value={`${connected}/${mailboxes.length}`} sub="mailboxes syncing" />
            <Stat label="Needs attention" value={attention.length} sub={attention.length ? 'reconnect or check sync' : 'all healthy'} tone={attention.length ? 'warn' : ''} />
          </div>

          {attention.map((m) => (
            <Banner key={m.id} tone={m.status === 'reauth_required' ? 'danger' : 'warn'} title={m.email_address}
              action={m.can_configure ? <Link className="em-btn" to="/email/settings">Fix</Link> : null}>
              {m.status === 'reauth_required' ? 'Google no longer accepts Dikho\'s access. It must be reconnected.' : m.last_sync_error}
            </Banner>
          ))}

          <div className="em-grid em-grid-2">
            <section className="em-card" aria-labelledby="em-unread-title">
              <div className="em-card-head">
                <div><h2 id="em-unread-title">Unread</h2><p>Newest first, from every mailbox you can read.</p></div>
                <Link className="em-btn" to="/email/inbox">View all</Link>
              </div>
              {!unread ? <div className="em-skeleton" style={{ height: 120 }} aria-hidden="true" />
                : unread.threads.length === 0
                  ? <EmptyState icon="check" title="You're all caught up">No unread conversations.</EmptyState>
                  : (
                    <ul className="em-list">
                      {unread.threads.map((t) => (
                        <li key={t.id}>
                          <span className="em-dot is-unread" />
                          <button type="button" className="em-list-main" style={{ border: 0, background: 'none', textAlign: 'left', padding: 0, color: 'inherit' }}
                            onClick={() => navigate(`/email/inbox/${t.id}`)}>
                            <div className="em-list-title">{participantLine(t, t.account_email)}</div>
                            <div className="em-list-sub">{t.subject || '(no subject)'}</div>
                          </button>
                          <span className="em-row-time">{listTime(t.last_message_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
            </section>

            <section className="em-card" aria-labelledby="em-mailboxes-title">
              <div className="em-card-head">
                <div><h2 id="em-mailboxes-title">Mailboxes</h2><p>Only mailboxes you have been added to.</p></div>
                <Link className="em-btn" to="/email/settings">Manage</Link>
              </div>
              <ul className="em-list">
                {mailboxes.map((m) => (
                  <li key={m.id}>
                    <div className="em-list-main">
                      <div className="em-list-title">
                        {m.display_name || m.email_address}
                        <span className="em-pill">{m.kind === 'shared' ? 'Shared' : m.owner_id === access?.user_id ? 'Yours' : `${m.owner_name ?? 'Someone'}'s`}</span>
                      </div>
                      <div className="em-list-sub">
                        {m.email_address} · {ROLE_LABELS[m.role]} · synced {relativeTime(m.last_synced_at)}
                      </div>
                    </div>
                    <div className="em-list-actions">
                      {m.unread_count > 0 && <span className="em-pill is-brand">{m.unread_count} unread</span>}
                      <StatusPill status={m.status} />
                      {m.status === 'connected' && (
                        <button type="button" className="em-icon-btn" aria-label={`Sync ${m.email_address} now`} title="Sync now"
                          onClick={() => syncNow(m.id)} disabled={syncing === m.id}>
                          <Icon name="sync" size={17} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <IntegrationsCard status={status} />
        </div>
      )}
      {toastNode}
    </div>
  )
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className="em-card em-stat">
      <span className="em-stat-label">{label}</span>
      <span className="em-stat-value" style={tone === 'warn' ? { color: 'var(--em-warn)' } : undefined}>{value}</span>
      <span className="em-stat-sub">{sub}</span>
    </div>
  )
}

function SetupCard({ data, status }) {
  const gmailReady = Boolean(status?.gmail?.configured)
  const steps = [
    { done: gmailReady, title: 'Google sign-in configured on the server', note: gmailReady ? 'Ready.' : 'An administrator adds the Google OAuth client and the token key (see Email settings).' },
    { done: false, title: data.can_connect_personal ? 'Connect your own Google Workspace mailbox' : 'Ask for Email access', note: data.can_connect_personal ? 'You sign in with Google; Dikho never sees your password.' : 'You need the "Use the Email inbox" permission.' },
    ...(data.can_manage_shared ? [{ done: (data.shared_setup ?? []).some((m) => m.status === 'connected'), title: 'Set up a shared team mailbox', note: 'For example sales@ or accounts@. Choose who may read and answer it.' }] : []),
    { done: Boolean(status?.gmail?.push), title: 'Instant updates from Gmail (optional)', note: status?.gmail?.push ? 'Gmail push is configured.' : 'Without it, mailboxes refresh when someone opens Email.' },
  ]
  return (
    <section className="em-card" style={{ maxWidth: 720 }}>
      <div className="em-card-head">
        <div><h2>Get started</h2><p>Mail stays in Gmail. Dikho keeps only what it needs to list conversations.</p></div>
      </div>
      <ol className="em-checklist">
        {steps.map((s) => (
          <li key={s.title}>
            <span className={`em-check${s.done ? ' is-done' : ''}`}><Icon name="check" size={13} strokeWidth={2.6} /></span>
            <div>{s.title}<small>{s.note}</small></div>
          </li>
        ))}
      </ol>
      <div style={{ marginTop: 16 }}>
        <Link className="em-btn em-btn-primary" to="/email/settings">Go to Email settings</Link>
      </div>
    </section>
  )
}

function IntegrationsCard({ status }) {
  if (!status) return null
  const d = status.delivery ?? {}
  const rows = [
    ['Gmail sign-in', status.gmail?.configured, status.gmail?.configured ? 'Mailboxes can be connected.' : 'Not configured on the server.'],
    ['Gmail push', status.gmail?.push, status.gmail?.push ? 'Changes arrive within seconds.' : 'Off: mailboxes refresh when Email is opened.'],
    ['System email', Boolean(d.provider), d.provider === 'ses' ? 'Sent through Amazon SES.' : d.provider === 'brevo' ? 'Sent through Brevo (legacy) until SES is enabled.' : 'No sender is enabled. Amazon SES is not switched on yet.'],
  ]
  return (
    <section className="em-card" aria-labelledby="em-int-title">
      <div className="em-card-head"><div><h2 id="em-int-title">Connections</h2><p>Set on the server by an administrator.</p></div></div>
      <ul className="em-list">
        {rows.map(([name, ok, note]) => (
          <li key={name}>
            <span className={`em-dot ${ok ? 'is-ok' : 'is-warn'}`} />
            <div className="em-list-main"><div className="em-list-title">{name}</div><div className="em-list-sub">{note}</div></div>
          </li>
        ))}
      </ul>
    </section>
  )
}
