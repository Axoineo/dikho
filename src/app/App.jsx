import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { nativeScreens, NativeHandoff } from '../lib/androidShell'
import { useOutletContext } from 'react-router-dom'
import { landingPath, canOpen, EMAIL_HUB_BUILD } from '../lib/access'
import { getSettings } from '../lib/settings'
import AuthenticatedLayout from '../layouts/AuthenticatedLayout'
import PublicLayout from '../layouts/PublicLayout'
import { PlaceholderPage } from '../components/PlaceholderPage'
import {
  ClientsPage,
  LeadsPage,
  VendorsPage,
  SalesOrdersPage,
  SalesOrderInvoicePage,
  PurchaseOrdersPage,
  SettingsPage,
  UsersPage,
  UserProfilePage,
  PublicVendorForm,
  PublicClientWelcome,
  PrivacyPage,
  WhatsAppInbox,
  WhatsAppDashboard,
  WhatsAppContacts,
  WhatsAppCampaigns,
  CampaignPerformance,
  WhatsAppTemplates,
  EmailOverview,
  EmailInbox,
  EmailSettings,
  EmailConnect,
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
  // Their own start page (Settings > Preferences), while they can still open it.
  const start = getSettings().preferences.start_page
  return <Navigate to={start && canOpen(access, start) ? start : landingPath(access)} replace />
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
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<PrivacyPage />} />
        </Route>

        {/* Authenticated routes — login required */}
        <Route element={<AuthenticatedLayout />}>
          <Route index element={<Landing />} />
          <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
          <Route path="/clients" element={nativeScreens.has('clients') ? <NativeHandoff screen="clients" /> : <ClientsPage />} />
          <Route path="/leads" element={nativeScreens.has('leads') ? <NativeHandoff screen="leads" /> : <LeadsPage />} />
          <Route path="/vendors" element={nativeScreens.has('vendors') ? <NativeHandoff screen="vendors" /> : <VendorsPage />} />
          <Route path="/sales-orders" element={nativeScreens.has('sales-orders') ? <NativeHandoff screen="sales-orders" /> : <SalesOrdersRoute />} />
          {/* One order's tax invoice PDF; the app's native Sales orders opens this. */}
          <Route path="/sales-orders/:id/invoice" element={<SalesOrderInvoicePage />} />
          <Route path="/purchase-orders" element={nativeScreens.has('purchase-orders') ? <NativeHandoff screen="purchase-orders" /> : <PurchaseOrdersRoute />} />
          <Route path="/invoices" element={<PlaceholderPage title="Invoice Notification" />} />
          <Route path="/advance-payments" element={<PlaceholderPage title="Advance Payment Receipt" />} />
          <Route path="/payment-receipts" element={<PlaceholderPage title="Payment Receipt" />} />
          <Route path="/payment-requests" element={<PlaceholderPage title="Payment Request" />} />
          <Route path="/courier" element={<PlaceholderPage title="Document Courier" />} />
          <Route path="/whatsapp" element={nativeScreens.has('dashboard') ? <NativeHandoff screen="dashboard" /> : <WhatsAppDashboard />} />
          <Route path="/whatsapp/inbox" element={nativeScreens.has('inbox') ? <NativeHandoff screen="inbox" /> : <WhatsAppInbox />} />
          <Route path="/whatsapp/contacts" element={nativeScreens.has('whatsapp-contacts') ? <NativeHandoff screen="whatsapp-contacts" /> : <WhatsAppContacts />} />
          {/* The app draws Contacts itself and opens this for importing a spreadsheet. */}
          <Route path="/whatsapp/contacts/import" element={<WhatsAppContacts />} />
          <Route path="/whatsapp/campaigns" element={nativeScreens.has('whatsapp-campaigns') ? <NativeHandoff screen="whatsapp-campaigns" /> : <WhatsAppCampaigns />} />
          {/* Straight into the wizard; the app's native Campaigns list opens this. */}
          <Route path="/whatsapp/campaigns/new" element={<WhatsAppCampaigns startCreating />} />
          <Route path="/whatsapp/campaigns/:id" element={<CampaignPerformance />} />
          <Route path="/whatsapp/templates" element={nativeScreens.has('templates') ? <NativeHandoff screen="templates" /> : <WhatsAppTemplates />} />
          {EMAIL_HUB_BUILD && (
            <>
              <Route path="/email" element={nativeScreens.has('email') ? <NativeHandoff screen="email" /> : <EmailOverview />} />
              <Route path="/email/inbox" element={nativeScreens.has('email-inbox') ? <NativeHandoff screen="email-inbox" /> : <EmailInbox />} />
              <Route path="/email/inbox/:threadId" element={nativeScreens.has('email-inbox') ? <NativeHandoff screen="email-inbox" /> : <EmailInbox />} />
              <Route path="/email/settings" element={nativeScreens.has('email-settings') ? <NativeHandoff screen="email-settings" /> : <EmailSettings />} />
              <Route path="/email/connect" element={<EmailConnect />} />
              <Route path="/email/campaigns" element={nativeScreens.has('email-campaigns') ? <NativeHandoff screen="email-campaigns" /> : <EmailCampaigns />} />
              <Route path="/email/campaigns/:campaignId" element={nativeScreens.has('email-campaigns') ? <NativeHandoff screen="email-campaigns" /> : <EmailCampaigns />} />
              <Route path="/email/templates" element={nativeScreens.has('email-templates') ? <NativeHandoff screen="email-templates" /> : <EmailTemplates />} />
              <Route path="/email/templates/:templateId" element={nativeScreens.has('email-templates') ? <NativeHandoff screen="email-templates" /> : <EmailTemplates />} />
              <Route path="/email/consent" element={nativeScreens.has('email-consent') ? <NativeHandoff screen="email-consent" /> : <EmailConsent />} />
              <Route path="/email/analytics" element={nativeScreens.has('email-analytics') ? <NativeHandoff screen="email-analytics" /> : <EmailAnalytics />} />
            </>
          )}
          <Route path="/users" element={nativeScreens.has('users') ? <NativeHandoff screen="users" /> : <UsersPage />} />
          <Route path="/users/:userId" element={<UserProfilePage />} />
          <Route path="/settings" element={nativeScreens.has('settings') ? <NativeHandoff screen="settings" /> : <SettingsRoute />} />
          <Route path="/settings/:section" element={nativeScreens.has('settings') ? <NativeHandoff screen="settings" /> : <SettingsRoute />} />
          <Route path="*" element={<Landing />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
