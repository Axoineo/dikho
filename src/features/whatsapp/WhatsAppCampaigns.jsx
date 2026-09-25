import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { apiGet, apiPost } from '../../lib/api'
import { CampaignWizard } from './CampaignWizard'
import { Alert, Badge, EmptyState, PageHeader, Panel, Spinner, Table, Td, Th } from './ui'

const STATUS_TONE = {
  completed: 'success',
  sending: 'info',
  failed: 'danger',
  draft: 'neutral',
}

function formatDate(value) {
  if (!value) return '—'
  // D1 stores `datetime('now')` as a space-separated UTC string.
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString([], {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function WhatsAppCampaigns() {
  const [creating, setCreating] = useState(false)
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // campaignId -> { batch, remaining }. Tracked outside `campaigns` so a
  // retry's own list refresh (via load()) doesn't fight the progress display.
  const [retrying, setRetrying] = useState({})

  const load = useCallback(() => {
    setLoading(true)
    apiGet('/campaigns')
      .then((data) => setCampaigns(data.campaigns))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Retries only the contacts still marked failed for this campaign — never
  // the ones who already got the message. Loops /retry the same way the
  // wizard drives /send-batch, in case there are more failures than one
  // batch covers; each round only targets whatever is still failed after the
  // previous one, so a second retry of the same campaign only touches the
  // leftovers.
  async function retryFailed(campaign) {
    if (retrying[campaign.id]) return
    setError(null)
    setRetrying((prev) => ({ ...prev, [campaign.id]: { batch: 1 } }))
    try {
      let data = await apiPost(`/campaigns/${campaign.id}/retry`, {})
      let batch = 1
      while (data.remaining?.length > 0) {
        batch += 1
        setRetrying((prev) => ({ ...prev, [campaign.id]: { batch, remaining: data.remaining.length } }))
        // eslint-disable-next-line no-await-in-loop
        data = await apiPost(`/campaigns/${campaign.id}/retry`, { contactIds: data.remaining })
      }
    } catch (err) {
      setError(`Retry for "${campaign.name}" failed: ${err.message}`)
    } finally {
      setRetrying((prev) => {
        const next = { ...prev }
        delete next[campaign.id]
        return next
      })
      load()
    }
  }

  if (creating) {
    return (
      <>
        <PageHeader
          title="New campaign"
          subtitle="Pick an audience, choose an approved template, preview it, then send."
        />
        <CampaignWizard onDone={() => { setCreating(false); load() }} />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Campaigns" subtitle="Every bulk send, with live delivery and read counts.">
        <button type="button" className="primary-button" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> New campaign
        </button>
      </PageHeader>

      {error && <Alert tone="error">{error}</Alert>}

      <Panel>
        {loading ? (
          <EmptyState>Loading campaigns…</EmptyState>
        ) : campaigns.length === 0 ? (
          <EmptyState title="No campaigns yet">
            Create one to send your approved template to a list of contacts.
          </EmptyState>
        ) : (
          <Table
            head={
              <>
                <Th>Campaign</Th>
                <Th>Template</Th>
                <Th tight>Status</Th>
                <Th tight>Sent</Th>
                <Th tight>Failed</Th>
                <Th tight>Created</Th>
              </>
            }
          >
            {campaigns.map((campaign) => (
              <tr key={campaign.id} className="transition-colors hover:bg-brand-soft">
                <Td className="font-semibold">{campaign.name}</Td>
                <Td className="text-muted">{campaign.template_name}</Td>
                <Td tight>
                  <Badge tone={STATUS_TONE[campaign.status] ?? 'neutral'}>{campaign.status}</Badge>
                </Td>
                <Td tight>{campaign.sent_count} / {campaign.total_count}</Td>
                <Td tight className={campaign.failed_count > 0 ? 'text-danger' : 'text-muted'}>
                  <span className="flex items-center gap-2">
                    {campaign.failed_count}
                    {campaign.failed_count > 0 && (
                      retrying[campaign.id] ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-normal text-muted">
                          <Spinner />
                          {retrying[campaign.id].remaining
                            ? `Retrying (${retrying[campaign.id].remaining} left)…`
                            : 'Retrying…'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => retryFailed(campaign)}
                          disabled={campaign.status === 'sending'}
                          title="Resend only to the recipients who failed"
                          className="inline-flex items-center gap-1 rounded-full border border-line
                            px-2 py-0.5 text-[10.5px] font-semibold text-brand transition
                            hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed
                            disabled:opacity-50 dark:text-[#5ba0e0]"
                        >
                          <Icon name="retry" size={11} /> Retry
                        </button>
                      )
                    )}
                  </span>
                </Td>
                <Td tight className="text-muted">{formatDate(campaign.created_at)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  )
}
