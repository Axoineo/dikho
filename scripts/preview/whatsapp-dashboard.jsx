// Documentation-only preview with synthetic aggregate counts and no messages.
//
//   /scripts/preview/whatsapp-dashboard.html                the dashboard
//   /scripts/preview/whatsapp-dashboard.html?campaign=12    one campaign's page
//   &theme=dark                                              the dark theme
//   &empty=1                                                 a period with nothing sent
//   &meta=down                                               Meta unreachable (no spend or health)
//   &insights=off                                            template insights not switched on
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
// Same stylesheets, in the same order, as src/main.jsx, so the page renders
// here exactly as it does in the app.
import '../../src/index.css'
import '../../src/components/ContactDetails.css'
import '../../src/tailwind.css'
import Workspace from './Workspace.jsx'
import { analyticsFixture, campaignFixture } from './whatsapp-analytics-fixture.js'

const PARAMS = new URLSearchParams(window.location.search)
document.documentElement.dataset.theme = PARAMS.get('theme') === 'dark' ? 'dark' : 'light'
const EMPTY = PARAMS.get('empty') === '1'
const META_DOWN = PARAMS.get('meta') === 'down'
const INSIGHTS_OFF = PARAMS.get('insights') === 'off'

window.fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input.url, window.location.href)
  let data = null
  if (url.pathname.endsWith('/whatsapp/analytics')) data = analyticsFixture(Number(url.searchParams.get('days')) || 30, { empty: EMPTY, metaDown: META_DOWN, insightsOff: INSIGHTS_OFF })
  else if (/\/whatsapp\/analytics\/campaigns\/\d+$/.test(url.pathname)) {
    data = INSIGHTS_OFF ? { ...campaignFixture, taps: { ...campaignFixture.taps, links: null, linkTotal: null, linkCost: null, insights: { available: false, reason: null } } } : campaignFixture
  }
  else if (/\/campaigns\/\d+\/unsent/.test(url.pathname)) data = { recipients: [], counts: { failed: 0, never_attempted: 0 } }
  return new Response(JSON.stringify(data ? { success: true, data } : { success: false, error: { message: 'Not in the preview' } }), {
    status: data ? 200 : 404, headers: { 'content-type': 'application/json' },
  })
}

const { default: WhatsAppDashboard } = await import('../../src/features/whatsapp/WhatsAppDashboard.jsx')
const { default: CampaignPerformance } = await import('../../src/features/whatsapp/CampaignPerformance.jsx')

const start = PARAMS.get('campaign') ? `/whatsapp/campaigns/${PARAMS.get('campaign')}` : `/whatsapp?days=${PARAMS.get('days') || 30}`

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MemoryRouter initialEntries={[start]}>
      <Workspace>
        <Routes>
          <Route path="/whatsapp" element={<WhatsAppDashboard />} />
          <Route path="/whatsapp/campaigns/:id" element={<CampaignPerformance />} />
          <Route path="*" element={<p style={{ padding: 24 }}>Not in the preview.</p>} />
        </Routes>
      </Workspace>
    </MemoryRouter>
  </StrictMode>,
)
