import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useOutletContext } from 'react-router-dom'
import { landingPath, EMAIL_HUB_BUILD } from '../lib/access'
import AuthenticatedLayout from '../layouts/AuthenticatedLayout'
import PublicLayout from '../layouts/PublicLayout'
import { PlaceholderPage } from '../components/PlaceholderPage'
import {
  ClientsPage,
  LeadsPage,
  VendorsPage,
  SalesOrdersPage,
  PurchaseOrdersPage,
  SettingsPage,
  UsersPage,
  UserProfilePage,
  PublicVendorForm,
  PublicClientWelcome,
  WhatsAppInbox,
  WhatsAppDashboard,
  WhatsAppContacts,
  WhatsAppCampaigns,
  WhatsAppTemplates,
  EmailOverview,
  EmailInbox,
  EmailSettings,
  EmailCampaigns,
  EmailTemplates,
  EmailConsent,
  EmailAnalytics
} from '../routes'

/* ── Wrapper components that read outlet context ────────────────────────── */

function SalesOrdersRoute() {
  const { session } = useOutletContext()
  return <SalesOrdersPage session={session} />
}

function PurchaseOrdersRoute() {
  const { session } = useOutletContext()
  return <PurchaseOrdersPage session={session} />
}

function SettingsRoute() {
  const { themeMode, onThemeChange } = useOutletContext()
  return <SettingsPage themeMode={themeMode} onThemeChange={onThemeChange} />
}

// The first page this person may open, so nobody lands on a page they
// cannot use (a finance user has no Clients page, for example).
function Landing() {
  const { access } = useOutletContext()
  return <Navigate to={landingPath(access)} replace />
}

/* ── App ────────────────────────────────────────────────────────────────── */

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes — no authentication required */}
        <Route element={<PublicLayout />}>
          <Route path="/vendor/register" element={<PublicVendorForm />} />
          <Route path="/corporategifting" element={<PublicClientWelcome />} />
          <Route path="/Corporategifting" element={<PublicClientWelcome />} />
        </Route>

        {/* Authenticated routes — login required */}
        <Route element={<AuthenticatedLayout />}>
          <Route index element={<Landing />} />
          <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/vendors" element={<VendorsPage />} />
          <Route path="/sales-orders" element={<SalesOrdersRoute />} />
          <Route path="/purchase-orders" element={<PurchaseOrdersRoute />} />
          <Route path="/invoices" element={<PlaceholderPage title="Invoice Notification" />} />
          <Route path="/advance-payments" element={<PlaceholderPage title="Advance Payment Receipt" />} />
          <Route path="/payment-receipts" element={<PlaceholderPage title="Payment Receipt" />} />
          <Route path="/payment-requests" element={<PlaceholderPage title="Payment Request" />} />
          <Route path="/courier" element={<PlaceholderPage title="Document Courier" />} />
          <Route path="/whatsapp" element={<WhatsAppDashboard />} />
          <Route path="/whatsapp/inbox" element={<WhatsAppInbox />} />
          <Route path="/whatsapp/contacts" element={<WhatsAppContacts />} />
          <Route path="/whatsapp/campaigns" element={<WhatsAppCampaigns />} />
          <Route path="/whatsapp/templates" element={<WhatsAppTemplates />} />
          {EMAIL_HUB_BUILD && (
            <>
              <Route path="/email" element={<EmailOverview />} />
              <Route path="/email/inbox" element={<EmailInbox />} />
              <Route path="/email/inbox/:threadId" element={<EmailInbox />} />
              <Route path="/email/settings" element={<EmailSettings />} />
              <Route path="/email/campaigns" element={<EmailCampaigns />} />
              <Route path="/email/campaigns/:campaignId" element={<EmailCampaigns />} />
              <Route path="/email/templates" element={<EmailTemplates />} />
              <Route path="/email/templates/:templateId" element={<EmailTemplates />} />
              <Route path="/email/consent" element={<EmailConsent />} />
              <Route path="/email/analytics" element={<EmailAnalytics />} />
            </>
          )}
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/:userId" element={<UserProfilePage />} />
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="*" element={<Landing />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
