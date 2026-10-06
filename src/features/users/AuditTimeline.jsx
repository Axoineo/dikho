import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usersApi } from './usersApi'
import { dateTime, describeChange, describeEvent, eventParts } from './userFormat'

function renderSentence(e, linkTarget) {
  const [lead, target, tail] = eventParts(e)
  if (!linkTarget || !target || !e.target_user_id) return describeEvent(e)
  return <>{lead} <Link to={`/users/${e.target_user_id}`}>{target}</Link>{tail ? ` ${tail}` : ''}</>
}

// Who changed whose access, when, and from where. Read-only by design: the
// log is append-only in the database and nothing in the app can edit it.
export default function AuditTimeline({ catalog, userId = null }) {
  const [events, setEvents] = useState(null)
  const [error, setError] = useState('')
  const [more, setMore] = useState(true)
  const [loading, setLoading] = useState(false)

  const lookup = useMemo(() => ({
    permissionsByKey: Object.fromEntries((catalog?.permissions ?? []).map((p) => [p.key, p])),
  }), [catalog])

  const load = useCallback(async (before) => {
    setLoading(true)
    try {
      const page = await usersApi.audit({ user: userId, before })
      setEvents((prev) => (before ? [...(prev ?? []), ...page] : page))
      setMore(page.length === 50)
      setError('')
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { setEvents(null); load() }, [load])

  if (error && !events) return <p className="um-inline-error" role="alert">Could not load the audit log: {error}</p>
  if (!events) return <div className="um-loading">Loading…</div>
  if (events.length === 0) return <p className="um-muted um-empty">Nothing recorded yet.</p>

  // Grouped by day for scanning.
  const groups = []
  for (const e of events) {
    const day = new Date(e.occurred_at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] })
    groups.at(-1).items.push(e)
  }

  return (
    <div className="um-audit">
      {groups.map((g) => (
        <section key={g.day}>
          <h4 className="um-audit-day">{g.day}</h4>
          <ol>
            {g.items.map((e) => {
              const details = describeChange(e, lookup)
              return (
                <li key={e.id} className={`um-audit-item${e.event_type === 'access.denied' ? ' is-denied' : ''}`}>
                  <time dateTime={e.occurred_at} title={dateTime(e.occurred_at)}>
                    {new Date(e.occurred_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                  </time>
                  <div>
                    <p>{renderSentence(e, !userId)}</p>
                    {details.length > 0 && (
                      <ul className="um-audit-details">{details.map((d) => <li key={d}>{d}</li>)}</ul>
                    )}
                    {e.ip && <span className="um-sub">From {e.ip}</span>}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      {more && (
        <button type="button" className="secondary-button um-more" onClick={() => load(events.at(-1).id)} disabled={loading}>
          {loading ? 'Loading…' : 'Show older'}
        </button>
      )}
    </div>
  )
}
