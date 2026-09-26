import { Fragment, useCallback, useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { apiGet } from '../../lib/api'
import { CampaignWizard } from './CampaignWizard'
import { CampaignUnsent } from './CampaignUnsent'
import { Alert, Badge, EmptyState, PageHeader, Panel, Table, Td, Th } from './ui'

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
  // Which campaign's outstanding-recipient list is open. Retrying now lives in
  // that panel, next to the names being retried, rather than behind a bare
  // count in the table.
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    apiGet('/campaigns')
      .then((data) => setCampaigns(data.campaigns))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

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
                <Th tight>Not delivered</Th>
                <Th tight>Created</Th>
              </>
            }
          >
            {campaigns.map((campaign) => {
              // Everyone the campaign was meant to reach but hasn't. Covers
              // failures *and* recipients an interrupted send never attempted,
              // which is why this is derived from total vs sent rather than
              // from failed_count alone. The panel below re-derives the exact
              // split from the messages table.
              const outstanding = Math.max(0, (campaign.total_count ?? 0) - (campaign.sent_count ?? 0))
              const isOpen = expanded === campaign.id

              return (
                <Fragment key={campaign.id}>
                  <tr className="transition-colors hover:bg-brand-soft">
                    <Td className="font-semibold">{campaign.name}</Td>
                    <Td className="text-muted">{campaign.template_name}</Td>
                    <Td tight>
                      <Badge tone={STATUS_TONE[campaign.status] ?? 'neutral'}>{campaign.status}</Badge>
                    </Td>
                    <Td tight>{campaign.sent_count} / {campaign.total_count}</Td>
                    <Td tight className={outstanding > 0 ? 'text-danger' : 'text-muted'}>
                      {outstanding === 0 ? (
                        '0'
                      ) : (
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : campaign.id)}
                          aria-expanded={isOpen}
                          title="Show who hasn't received this campaign"
                          className="inline-flex items-center gap-1 rounded-full border border-line
                            px-2 py-0.5 text-[11px] font-semibold text-brand transition
                            hover:border-brand hover:bg-brand-soft dark:text-[#5ba0e0]"
                        >
                          {outstanding}
                          <Icon name={isOpen ? 'chevronDown' : 'chevron'} size={11} />
                        </button>
                      )}
                    </Td>
                    <Td tight className="text-muted">{formatDate(campaign.created_at)}</Td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className="border-b border-line-soft bg-line-soft/40 p-0">
                        <CampaignUnsent campaign={campaign} onChanged={load} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </Table>
        )}
      </Panel>
    </>
  )
}
