import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { waApi } from '../../lib/api'
import { Avatar } from './inbox/Avatar'
import { Alert, Badge, EmptyState, PageHeader, Panel, Table, Td, Th } from './ui'

// The follow-up queue for calls nobody took.
//
// A missed call is easy to lose in the inbox — it sits among every other
// conversation, and at campaign volume there are hundreds. This ranks them by
// the only thing that matters operationally: has anyone got back to this
// person yet?

const STATUS = {
  missed: { tone: 'danger', label: 'Missed' },
  rejected: { tone: 'warn', label: 'Declined' },
  completed: { tone: 'success', label: 'Answered' },
  failed: { tone: 'neutral', label: 'Failed' },
  ringing: { tone: 'info', label: 'Ringing' },
}

// "just now" / "23m ago" / "4h ago" / "3d ago" — how long this person has been
// waiting, which reads better here than a wall-clock time.
function timeAgo(value) {
  if (!value) return '—'
  const then = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  const mins = Math.floor((Date.now() - then.getTime()) / 60000)
  if (Number.isNaN(mins)) return '—'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

function exactTime(value) {
  if (!value) return ''
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function WhatsAppCalls() {
  const [calls, setCalls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [onlyMissed, setOnlyMissed] = useState(true)
  const navigate = useNavigate()

  const load = useCallback(() => {
    setLoading(true)
    waApi.calls({ status: onlyMissed ? 'missed' : undefined })
      .then((data) => setCalls(data.calls || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [onlyMissed])

  useEffect(() => { load() }, [load])

  // Same reconciliation reasoning as the inbox: a call that arrives while this
  // screen is open should not need a manual reload to show up.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    const poll = setInterval(onVisible, 30000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(poll)
    }
  }, [load])

  const waiting = calls.filter((call) => !call.followed_up).length

  return (
    <>
      <PageHeader
        title="Missed calls"
        subtitle="Customers who called and did not get through. Reply while the 24-hour window is open."
      >
        <button
          type="button"
          onClick={() => setOnlyMissed((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3
            py-1.5 text-[12px] font-semibold text-brand transition hover:border-brand
            hover:bg-brand-soft dark:text-[#5ba0e0]"
        >
          <Icon name="filter" size={13} /> {onlyMissed ? 'Show all calls' : 'Only missed'}
        </button>
      </PageHeader>

      {error && <Alert tone="error">{error}</Alert>}

      {!loading && waiting > 0 && (
        <Alert tone="warn">
          <strong>{waiting}</strong> {waiting === 1 ? 'caller has' : 'callers have'} not
          heard back yet.
        </Alert>
      )}

      <Panel>
        {loading && calls.length === 0 ? (
          <EmptyState>Loading calls…</EmptyState>
        ) : calls.length === 0 ? (
          <EmptyState title={onlyMissed ? 'No missed calls' : 'No calls yet'}>
            {onlyMissed
              ? 'Every call that came in has been answered.'
              : 'Calls to your WhatsApp business number will appear here.'}
          </EmptyState>
        ) : (
          <Table
            head={
              <>
                <Th>Caller</Th>
                <Th tight>Status</Th>
                <Th tight>When</Th>
                <Th tight>Follow-up</Th>
                <Th tight />
              </>
            }
          >
            {calls.map((call) => (
              <tr key={call.wacid} className="transition-colors hover:bg-brand-soft">
                <Td>
                  <span className="flex items-center gap-2.5">
                    <Avatar
                      name={call.display_name}
                      phone={call.phone}
                      avatarUrl={call.avatar_url}
                      size={32}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">
                        {call.display_name || `+${call.phone}`}
                      </span>
                      <span className="block text-[11.5px] text-muted">+{call.phone}</span>
                    </span>
                  </span>
                </Td>
                <Td tight>
                  <Badge tone={STATUS[call.status]?.tone ?? 'neutral'}>
                    {STATUS[call.status]?.label ?? call.status}
                  </Badge>
                </Td>
                <Td tight>
                  <span className="whitespace-nowrap text-ink">{timeAgo(call.ring_at || call.created_at)}</span>
                  <span className="block text-[11.5px] text-muted">
                    {exactTime(call.ring_at || call.created_at)}
                  </span>
                </Td>
                <Td tight>
                  {call.followed_up
                    ? <Badge tone="success">Replied</Badge>
                    : <Badge tone="danger">Waiting</Badge>}
                </Td>
                <Td tight>
                  <button
                    type="button"
                    disabled={!call.conversation_id}
                    onClick={() => navigate(`/whatsapp/inbox?c=${call.conversation_id}`)}
                    title="Open this conversation and reply"
                    className="inline-flex items-center gap-1 rounded-full border border-line px-2.5
                      py-1 text-[11px] font-semibold text-brand transition hover:border-brand
                      hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40
                      dark:text-[#5ba0e0]"
                  >
                    <Icon name="whatsapp" size={12} /> Reply
                  </button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  )
}
