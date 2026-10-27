import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { useAccess } from '../../lib/access'
import { emailApi } from './emailApi'
import { Banner, ConfirmDialog } from './emailUi'
import { useToast } from './emailHooks'
import { CONSENT_SOURCES, fullTime } from './emailFormat'
import './email.css'

// Marketing consent and suppression, one address at a time. There is
// deliberately no list of everyone: look up the person you are dealing with.
// Unsubscribe links, spam complaints and hard bounces are recorded here
// automatically; staff record how someone agreed (or asked to stop).
const RECORDABLE = ['form', 'verbal', 'written', 'imported']
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,63}$/

export default function EmailConsent() {
  const { can } = useAccess()
  const canManage = can('email_consent.manage')
  const [query, setQuery] = useState('')
  const [pref, setPref] = useState(null)
  const [error, setError] = useState('')
  const [looking, setLooking] = useState(false)
  const [mode, setMode] = useState(null) // 'subscribe' | 'unsubscribe'
  const [confirm, setConfirm] = useState(null)
  const [toastNode, toast] = useToast()

  async function lookup(e) {
    e?.preventDefault()
    const email = query.trim().toLowerCase()
    if (!EMAIL.test(email)) { setError('Enter a full email address.'); return }
    setLooking(true)
    setError('')
    setMode(null)
    try {
      setPref(await emailApi.preference(email))
    } catch (err) {
      setPref(null)
      setError(err.message || 'Could not look up that address.')
    } finally {
      setLooking(false)
    }
  }

  async function change(body, message) {
    const next = await emailApi.setPreference({ email: pref.email, ...body })
    setPref(next)
    setMode(null)
    toast(message)
  }

  const state = !pref ? null
    : pref.suppressed ? { tone: 'danger', icon: 'alert', title: 'Suppressed: no email is sent', text: pref.suppressed_reason === 'hard_bounce' ? 'The address bounced permanently.' : 'Suppressed by staff.' }
      : pref.marketing === 'subscribed' ? { tone: 'ok', icon: 'check', title: 'Agreed to marketing email', text: CONSENT_SOURCES[pref.marketing_source] ?? '' }
        : pref.marketing === 'unsubscribed' ? { tone: 'warn', icon: 'close', title: 'Unsubscribed', text: CONSENT_SOURCES[pref.marketing_source] ?? '' }
          : { tone: '', icon: 'shield', title: 'No consent recorded', text: 'Campaigns are not sent to this address.' }

  return (
    <div className="em-page" style={{ paddingBottom: 96 }}>
      <div className="page-header">
        <div>
          <span className="page-kicker">EMAIL</span>
          <h1>Consent</h1>
          <p>Who has agreed to marketing email, who asked to stop, and which addresses must not be emailed.</p>
        </div>
      </div>

      <div className="em-consent">
        <section className="em-card" aria-labelledby="em-lookup-title">
          <div className="em-card-head"><div><h2 id="em-lookup-title">Look up an address</h2><p>The record is the same wherever the address appears (client, vendor or lead).</p></div></div>
          <form className="em-lookup" onSubmit={lookup}>
            <label htmlFor="em-lookup-input" className="em-visually-hidden">Email address</label>
            <input id="em-lookup-input" type="email" className="em-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="name@company.com" autoComplete="off" />
            <button type="submit" className="em-btn em-btn-primary" disabled={looking}><Icon name="search" size={15} /> {looking ? 'Looking…' : 'Look up'}</button>
          </form>
          {error && <div style={{ marginTop: 12 }}><Banner tone="danger">{error}</Banner></div>}

          {pref && (
            <div className="em-consent-result">
              <div className="em-consent-email">{pref.email}</div>
              <Banner tone={state.tone} icon={state.icon} title={state.title}>{state.text}</Banner>
              <dl className="em-breakdown">
                <div><dt>Marketing</dt><dd>{pref.marketing === 'subscribed' ? 'Subscribed' : pref.marketing === 'unsubscribed' ? 'Unsubscribed' : 'Not recorded'}</dd></div>
                {pref.marketing_changed_at && <div><dt>Recorded</dt><dd>{fullTime(pref.marketing_changed_at)}{pref.marketing_changed_by_name ? ` by ${pref.marketing_changed_by_name}` : ''}</dd></div>}
                {pref.marketing_note && <div><dt>Note</dt><dd>{pref.marketing_note}</dd></div>}
                <div><dt>Suppressed</dt><dd>{pref.suppressed ? `Yes, since ${fullTime(pref.suppressed_at)}` : 'No'}</dd></div>
              </dl>

              {canManage && !mode && (
                <div className="em-control-row">
                  {pref.marketing !== 'subscribed' && <button type="button" className="em-btn em-btn-primary" onClick={() => setMode('subscribe')}>Record consent</button>}
                  {pref.marketing !== 'unsubscribed' && <button type="button" className="em-btn" onClick={() => setMode('unsubscribe')}>Record unsubscribe</button>}
                  {pref.suppressed
                    ? <button type="button" className="em-btn" onClick={() => setConfirm('unsuppress')}>Lift suppression</button>
                    : <button type="button" className="em-btn em-btn-danger" onClick={() => setConfirm('suppress')}>Suppress</button>}
                </div>
              )}
              {canManage && mode && <ConsentForm mode={mode} onCancel={() => setMode(null)} onSave={change} />}
              {!canManage && <p className="em-help">Changing consent needs the "Manage email consent" permission.</p>}
            </div>
          )}
        </section>

        <aside className="em-card" aria-labelledby="em-rules-title">
          <div className="em-card-head"><div><h2 id="em-rules-title">How consent works</h2></div></div>
          <ul className="em-rules">
            <li><Icon name="check" size={15} /><span>Campaigns go only to addresses marked <strong>agreed</strong>, with how they agreed on record.</span></li>
            <li><Icon name="shield" size={15} /><span>It is checked when a campaign is submitted and again just before each email is sent.</span></li>
            <li><Icon name="close" size={15} /><span>Every campaign email has an unsubscribe link (and one-click unsubscribe in Gmail and Outlook). It takes effect immediately.</span></li>
            <li><Icon name="alert" size={15} /><span>Unsubscribe links work for every campaign. Bounces and spam complaints are recorded automatically only for mail sent through Amazon SES; Gmail and Hostinger do not report them to Dikho, so suppress an address here when a bounce arrives in the sending mailbox.</span></li>
            <li><Icon name="note" size={15} /><span>Every change is kept in the audit log with who made it.</span></li>
          </ul>
        </aside>
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm === 'suppress' ? 'Suppress this address?' : 'Lift the suppression?'}
          confirmLabel={confirm === 'suppress' ? 'Suppress' : 'Lift suppression'} tone={confirm === 'suppress' ? 'danger' : 'primary'}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await change(confirm === 'suppress' ? { suppress: true } : { unsuppress: true }, confirm === 'suppress' ? 'Address suppressed.' : 'Suppression lifted.')
            setConfirm(null)
          }}>
          {confirm === 'suppress'
            ? 'No campaign email is sent to this address until the suppression is lifted.'
            : pref?.suppressed_reason === 'hard_bounce'
              ? 'This address bounced permanently. Lift it only if you know it works again: repeated bounces damage the sending reputation of every Dikho email.'
              : 'Campaign email can reach this address again if it has consent.'}
        </ConfirmDialog>
      )}
      {toastNode}
    </div>
  )
}

function ConsentForm({ mode, onCancel, onSave }) {
  const [source, setSource] = useState(mode === 'subscribe' ? '' : 'request')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault()
    if (mode === 'subscribe' && !RECORDABLE.includes(source)) { setError('Choose how this person agreed.'); return }
    setBusy(true)
    setError('')
    try {
      await onSave({ marketing: mode === 'subscribe' ? 'subscribed' : 'unsubscribed', source, note: note.trim() || undefined },
        mode === 'subscribe' ? 'Consent recorded.' : 'Unsubscribe recorded.')
    } catch (err) {
      setError(err.message || 'That did not work.')
      setBusy(false)
    }
  }
  return (
    <form className="em-consent-form" onSubmit={submit}>
      {mode === 'subscribe' && (
        <div className="em-field">
          <label htmlFor="em-consent-source">How did they agree?</label>
          <select id="em-consent-source" className="em-select" value={source} onChange={(e) => setSource(e.target.value)} autoFocus>
            <option value="">Choose…</option>
            {RECORDABLE.map((s) => <option key={s} value={s}>{CONSENT_SOURCES[s]}</option>)}
          </select>
        </div>
      )}
      <div className="em-field">
        <label htmlFor="em-consent-note">Note <span className="em-optional">{mode === 'subscribe' ? 'where or when, e.g. "Expo stall form, 12 Oct"' : 'optional'}</span></label>
        <input id="em-consent-note" className="em-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value.replace(/[\r\n]/g, ' '))} />
      </div>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="em-control-row">
        <button type="submit" className="em-btn em-btn-primary" disabled={busy}>{busy ? 'Saving…' : mode === 'subscribe' ? 'Record consent' : 'Record unsubscribe'}</button>
        <button type="button" className="em-btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}
