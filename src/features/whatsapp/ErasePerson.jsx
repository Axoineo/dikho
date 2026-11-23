import { useState } from 'react'
import { apiPost } from '../../lib/api'

/* Erases one person by phone number: chats, messages, files, contact and gifting
 * leads (POST /api/contacts/erase). For someone who asks under India's DPDP Act to
 * have their data deleted. The number is typed twice, and the server checks both
 * the delete permissions and the match again. */
export default function ErasePerson({ onDone }) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [confirmPhone, setConfirmPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const digits = (value) => value.replace(/\D/g, '')
  const ready = digits(phone).length >= 10 && digits(phone) === digits(confirmPhone)

  function close() {
    setOpen(false)
    setPhone('')
    setConfirmPhone('')
    setError('')
  }

  async function erase(event) {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      const counts = await apiPost('/contacts/erase', { phone, confirm: confirmPhone })
      close()
      onDone?.(counts)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="erase-person-open" onClick={() => setOpen(true)}>
        Erase a person&rsquo;s data&hellip;
      </button>
    )
  }

  return (
    <form className="erase-person" onSubmit={erase} aria-labelledby="erase-person-title">
      <strong id="erase-person-title">Erase a person&rsquo;s data</strong>
      <p>
        Deletes their chats, messages, photos, voice notes and files, their contact and their gifting enquiries. Campaign
        totals keep a count without their number. This cannot be undone.
      </p>
      <label>
        <span>Phone number</span>
        <input type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </label>
      <label>
        <span>Type the number again</span>
        <input type="tel" inputMode="tel" autoComplete="off" value={confirmPhone} onChange={(e) => setConfirmPhone(e.target.value)} required />
      </label>
      <small>With the country code, or a 10-digit Indian number.</small>
      {error && <p className="erase-person-error" role="alert">{error}</p>}
      <div className="erase-person-actions">
        <button type="submit" className="danger-button" disabled={!ready || busy}>{busy ? 'Erasing…' : 'Erase permanently'}</button>
        <button type="button" className="secondary-button" onClick={close} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}
