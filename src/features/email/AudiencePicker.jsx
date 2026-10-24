import { useEffect, useId, useState } from 'react'
import { Icon } from '../../components/Icon'
import { emailApi } from './emailApi'
import { Banner } from './emailUi'
import { EMPTY_AUDIENCE, SOURCE_LABELS, formatCount } from './emailFormat'

// Who a campaign goes to: clients, vendors and leads from the CRM, narrowed
// by place or media. Only addresses with recorded marketing consent are ever
// sent to; the counts below say how many that is, and why the rest are out.
const SOURCE_HELP = {
  client: 'Client contact emails.',
  vendor: 'Vendor contact emails.',
  lead: 'Corporate-gifting leads.',
}

export default function AudiencePicker({ value, onChange, disabled, onPreview }) {
  const audience = { ...EMPTY_AUDIENCE, ...value }
  const [options, setOptions] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [loading, setLoading] = useState(false)
  const key = JSON.stringify(audience)

  useEffect(() => {
    let alive = true
    emailApi.audienceOptions().then((o) => { if (alive) setOptions(o) }, () => { if (alive) setOptions({}) })
    return () => { alive = false }
  }, [])

  // Live count, a moment after the last change.
  useEffect(() => {
    const spec = JSON.parse(key)
    if (!spec.sources.length) return undefined
    let alive = true
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const p = await emailApi.audiencePreview(spec)
        if (!alive) return
        setPreview(p)
        setPreviewError('')
        onPreview?.(p)
      } catch (err) {
        if (alive) setPreviewError(err.message || 'Could not count this audience.')
      } finally {
        if (alive) setLoading(false)
      }
    }, 350)
    return () => { alive = false; clearTimeout(timer) }
  }, [key, onPreview])

  const set = (patch) => onChange({ ...audience, ...patch })
  const toggleSource = (s) => set({ sources: audience.sources.includes(s) ? audience.sources.filter((x) => x !== s) : [...audience.sources, s] })
  const shown = audience.sources.length ? preview : null
  const canUse = preview?.can_use ?? {}
  const placeFilters = audience.country.length + audience.state.length > 0
  const mediaFilters = audience.media.length + audience.sub_media.length > 0
  const subMedia = (options?.sub_media ?? []).filter((s) => !audience.media.length || audience.media.includes(String(s.media_id)))

  return (
    <div className="em-audience">
      <div className="em-audience-main">
        <fieldset className="em-fieldset" disabled={disabled}>
          <legend>Send to</legend>
          <div className="em-source-grid">
            {Object.entries(SOURCE_LABELS).map(([s, label]) => {
              const on = audience.sources.includes(s)
              const blocked = canUse[s] === false
              return (
                <label key={s} className={`em-source${on ? ' is-on' : ''}${blocked ? ' is-blocked' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleSource(s)} disabled={disabled} />
                  <span className="em-check" aria-hidden="true"><Icon name="check" size={12} strokeWidth={2.6} /></span>
                  <span className="em-source-text">
                    <strong>{label}</strong>
                    <small>{blocked ? `You cannot see ${label.toLowerCase()}, so none are included.` : SOURCE_HELP[s]}</small>
                  </span>
                  {on && shown && <span className="em-source-count">{formatCount(shown.by_source?.[s])}</span>}
                </label>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="em-fieldset" disabled={disabled}>
          <legend>Narrow it down <span className="em-optional">optional</span></legend>
          <div className="em-filter-grid">
            <TokenField label="Country" values={audience.country} suggestions={options?.countries} onChange={(country) => set({ country })} disabled={disabled} />
            <TokenField label="State" values={audience.state} suggestions={options?.states} onChange={(state) => set({ state })} disabled={disabled} />
            <TokenField label="City" values={audience.city} suggestions={options?.cities} onChange={(city) => set({ city })} disabled={disabled} />
            <TokenField label="Media" values={audience.media} choices={options?.media} onChange={(media) => set({ media, sub_media: [] })} disabled={disabled} />
            <TokenField label="Sub-media" values={audience.sub_media} choices={subMedia} onChange={(sub_media) => set({ sub_media })} disabled={disabled} />
          </div>
          {(placeFilters || mediaFilters) && (
            <p className="em-help">
              {placeFilters && 'Leads have no country or state, so a country or state filter leaves them out. '}
              {mediaFilters && 'Media filters apply to vendors only; clients and leads are left out.'}
            </p>
          )}
          <label className="em-switch">
            <input type="checkbox" checked={audience.active_only} onChange={(e) => set({ active_only: e.target.checked })} disabled={disabled} />
            <span>Only active clients and vendors</span>
          </label>
        </fieldset>
      </div>

      <aside className="em-card em-audience-result" aria-live="polite" aria-busy={loading}>
        <span className="em-stat-label">Will receive this email</span>
        <span className="em-stat-value em-hero">{shown ? formatCount(shown.eligible) : '–'}</span>
        {!audience.sources.length && <p className="em-help">Choose who to send to.</p>}
        {previewError && <Banner tone="danger">{previewError}</Banner>}
        {shown && (
          <>
            <dl className="em-breakdown">
              <div><dt>Matched</dt><dd>{formatCount(shown.matched)}</dd></div>
              <div><dt>No consent recorded</dt><dd>{formatCount(shown.no_consent)}</dd></div>
              <div><dt>Unsubscribed</dt><dd>{formatCount(shown.unsubscribed)}</dd></div>
              <div><dt>Suppressed (bounced)</dt><dd>{formatCount(shown.suppressed)}</dd></div>
            </dl>
            {shown.eligible === 0 && shown.matched > 0 && (
              <Banner tone="warn" title="Nobody here has agreed to marketing email yet">
                Record consent on the Consent page (how each person agreed), then come back.
              </Banner>
            )}
            {shown.sample?.length > 0 && (
              <>
                <span className="em-stat-label" style={{ marginTop: 6 }}>First few recipients</span>
                <ul className="em-sample">
                  {shown.sample.map((r) => (
                    <li key={r.email}>
                      <span className="em-sample-name">{r.name || r.email}</span>
                      <span className="em-sample-sub">{r.name ? r.email : ''}{r.company ? `${r.name ? ' · ' : ''}${r.company}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <p className="em-help">The list is fixed when the campaign is submitted. Consent is checked again just before each email is sent.</p>
      </aside>
    </div>
  )
}

/** Several values for one filter: typed (with suggestions) or chosen from a list. */
function TokenField({ label, values, suggestions, choices, onChange, disabled }) {
  const id = useId()
  const [text, setText] = useState('')
  const nameOf = (v) => choices?.find((c) => String(c.id) === String(v))?.name ?? v
  function add(raw) {
    const v = String(raw ?? '').trim()
    if (!v || values.some((x) => String(x).toLowerCase() === v.toLowerCase()) || values.length >= 50) return
    onChange([...values, v])
    setText('')
  }
  return (
    <div className="em-field">
      <label htmlFor={id}>{label}</label>
      <div className="em-tokens">
        {values.map((v) => (
          <span key={v} className="em-recipient">
            {nameOf(v)}
            {!disabled && <button type="button" aria-label={`Remove ${nameOf(v)}`} onClick={() => onChange(values.filter((x) => x !== v))}><Icon name="close" size={11} /></button>}
          </span>
        ))}
        {choices ? (
          <select id={id} className="em-token-input" value="" disabled={disabled || !choices.length} onChange={(e) => add(e.target.value)}>
            <option value="">{choices.length ? `Add ${label.toLowerCase()}…` : 'None available'}</option>
            {choices.filter((c) => !values.includes(String(c.id))).map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        ) : (
          <>
            <input id={id} className="em-token-input" list={`${id}-list`} value={text} disabled={disabled} placeholder={`Any ${label.toLowerCase()}`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text) } }}
              onBlur={() => add(text)} />
            <datalist id={`${id}-list`}>{(suggestions ?? []).slice(0, 300).map((s) => <option key={s} value={s} />)}</datalist>
          </>
        )}
      </div>
    </div>
  )
}
