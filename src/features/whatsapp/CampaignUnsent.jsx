import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { apiGet, apiPost } from '../../lib/api'
import { Alert, Badge, Spinner } from './ui'

// The outstanding-recipient list for one campaign: everyone who either failed
// or was never attempted, with a retry that sends only to them.
//
// The list is always re-fetched from the server rather than pruned locally —
// a contact drops off because their message row is now 'sent', which is the
// same source of truth the retry itself claims against. Nothing here has to
// guess which sends worked.

const REASON = {
  failed: { tone: 'danger', label: 'Failed' },
  never_attempted: { tone: 'warn', label: 'Never attempted' },
}

export function CampaignUnsent({ campaign, onChanged }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  // Sticks once the user opts into reconciling a pre-0006 campaign, so the
  // reloads after each retry keep showing the never-attempted contacts.
  const [reconciled, setReconciled] = useState(false)

  const load = useCallback((includeUnrecorded) => {
    setLoading(true)
    const query = includeUnrecorded ? '?includeUnrecorded=1' : ''
    return apiGet(`/campaigns/${campaign.id}/unsent${query}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [campaign.id])

  useEffect(() => { load(reconciled) }, [load, reconciled])

  // Loops /retry the same way the wizard drives /send-batch: each round sends
  // one batch and hands back whoever is left, so a list larger than the
  // Free-plan batch limit still drains in one click.
  async function retryAll() {
    if (progress) return
    setError(null)
    setProgress({ batch: 1 })
    try {
      let res = await apiPost(`/campaigns/${campaign.id}/retry`, { includeUnrecorded: reconciled })
      let batch = 1
      while (res.remaining?.length > 0) {
        batch += 1
        setProgress({ batch, remaining: res.remaining.length })
        // eslint-disable-next-line no-await-in-loop
        res = await apiPost(`/campaigns/${campaign.id}/retry`, { contactIds: res.remaining })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null)
      await load(reconciled)
      onChanged?.()
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 px-4 py-5 text-[12.5px] text-muted">
        <Spinner /> Checking who hasn't received this campaign…
      </div>
    )
  }

  const contacts = data?.contacts ?? []
  const counts = data?.counts ?? { total: 0, failed: 0, neverAttempted: 0 }

  return (
    <div className="space-y-3 px-4 py-4">
      {error && <Alert tone="error">{error}</Alert>}

      {/* A pre-0006 campaign never recorded its audience, so the contacts it
          never attempted can only be found by comparing against every
          contact. That is right for a send-to-everyone campaign and wrong for
          a targeted one, so it takes an explicit click. */}
      {data?.audienceSource === 'inferred' && data.unaccounted > 0 && !reconciled && (
        <Alert tone="warn">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <strong>{data.unaccounted}</strong>
            <span>
              recipients are unaccounted for. This campaign ran before audiences were
              recorded, so they can only be found by checking every contact.
            </span>
            <button
              type="button"
              onClick={() => setReconciled(true)}
              className="rounded-full border border-line px-2.5 py-0.5 text-[11px]
                font-semibold text-brand transition hover:border-brand hover:bg-brand-soft"
            >
              Check all contacts
            </button>
          </span>
        </Alert>
      )}

      {contacts.length === 0 ? (
        <p className="py-2 text-[12.5px] text-muted">
          Everyone on this campaign has been sent to. Nothing left to retry.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted">
              <strong className="text-ink">{counts.total}</strong> not delivered
              {counts.failed > 0 && <> · {counts.failed} failed</>}
              {counts.neverAttempted > 0 && <> · {counts.neverAttempted} never attempted</>}
            </p>
            {progress ? (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
                <Spinner />
                {progress.remaining ? `Retrying (${progress.remaining} left)…` : 'Retrying…'}
              </span>
            ) : (
              <button
                type="button"
                onClick={retryAll}
                disabled={campaign.status === 'sending'}
                title="Resend only to the contacts listed below"
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3
                  py-1 text-[11.5px] font-semibold text-brand transition hover:border-brand
                  hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50
                  dark:text-[#5ba0e0]"
              >
                <Icon name="retry" size={12} /> Retry all {counts.total}
              </button>
            )}
          </div>

          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-[9px] border border-line">
            {contacts.map((contact) => (
              <li key={contact.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {contact.name || contact.phone}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {contact.phone}
                    {contact.errorMessage && <> · {contact.errorMessage}</>}
                  </span>
                </span>
                <Badge tone={REASON[contact.reason]?.tone ?? 'neutral'}>
                  {REASON[contact.reason]?.label ?? contact.reason}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
