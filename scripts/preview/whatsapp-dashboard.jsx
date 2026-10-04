// Documentation-only preview with synthetic aggregate counts and no messages.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Same stylesheets, in the same order, as src/main.jsx, so the page renders
// here exactly as it does in the app.
import '../../src/index.css'
import '../../src/components/ContactDetails.css'
import '../../src/tailwind.css'
import Workspace from './Workspace.jsx'

window.fetch = async () => new Response(JSON.stringify({
  success: true,
  data: {
    contacts: 1240,
    campaigns: 18,
    accepted: 10320,
    delivered: 9650,
    read: 7214,
    failed: 118,
    awaiting: 552,
  },
}), { status: 200, headers: { 'content-type': 'application/json' } })

const { default: WhatsAppDashboard } = await import('../../src/features/whatsapp/WhatsAppDashboard.jsx')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Workspace><WhatsAppDashboard /></Workspace>
    </BrowserRouter>
  </StrictMode>,
)
