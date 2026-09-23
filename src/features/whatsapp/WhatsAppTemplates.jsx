import { useEffect, useState } from 'react'
import { apiGet } from '../../lib/api'
import { WhatsAppPreview } from './WhatsAppPreview'
import { Alert, Badge, EmptyState, PageHeader, Panel } from './ui'

export default function WhatsAppTemplates() {
  const [templates, setTemplates] = useState([])
  const [source, setSource] = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiGet('/templates')
      .then((data) => {
        setTemplates(data.templates)
        setSource(data.source)
        setSelected(data.templates[0] ?? null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Approved message templates pulled from your WhatsApp Business account."
      />

      {error && <Alert tone="error">{error}</Alert>}

      {source === 'fallback' && !error && (
        <Alert tone="info">
          Showing the local fallback template — the Meta Graph API could not be reached.
          Check that <strong>WHATSAPP_ACCESS_TOKEN</strong> and <strong>WHATSAPP_WABA_ID</strong> are set.
        </Alert>
      )}

      {loading ? (
        <Panel><EmptyState>Loading templates…</EmptyState></Panel>
      ) : (
        <div className="grid items-start gap-[18px] [grid-template-columns:minmax(0,1fr)] min-[860px]:[grid-template-columns:minmax(0,1fr)_auto]">
          <div className="grid gap-3">
            {templates.map((template) => (
              <button
                type="button"
                key={`${template.name}-${template.language}`}
                onClick={() => setSelected(template)}
                className={`rounded-xl border-[1.5px] bg-surface p-[15px] text-left text-ink transition
                  ${selected?.name === template.name
                    ? 'border-brand bg-brand-soft'
                    : 'border-line hover:-translate-y-px hover:border-brand'}`}
              >
                <div className="mb-1.5 break-words text-[13.5px] font-semibold">{template.name}</div>
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  <Badge tone="success">{template.status}</Badge>
                  <Badge>{template.language}</Badge>
                  {template.category && <Badge tone="info">{template.category}</Badge>}
                  <Badge tone={template.hasVariables ? 'warn' : 'neutral'}>
                    {template.hasVariables ? 'Has variables' : 'Static'}
                  </Badge>
                </div>
                <div className="line-clamp-3 text-[12.5px] leading-normal text-muted">
                  {template.bodyText}
                </div>
              </button>
            ))}
          </div>

          <div className="grid place-items-center py-2">
            <WhatsAppPreview template={selected} />
          </div>
        </div>
      )}
    </>
  )
}
