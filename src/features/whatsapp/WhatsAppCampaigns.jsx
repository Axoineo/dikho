import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { apiGet } from '../../lib/api'
import { CampaignWizard } from './CampaignWizard'
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
                  {campaign.failed_count}
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
