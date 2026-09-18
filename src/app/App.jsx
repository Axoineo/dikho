import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useOutletContext } from 'react-router-dom'
import AuthenticatedLayout from '../layouts/AuthenticatedLayout'
import PublicLayout from '../layouts/PublicLayout'
import { PlaceholderPage } from '../components/PlaceholderPage'
import {
  ClientsPage,
  VendorsPage,
  SalesOrdersPage,
  PurchaseOrdersPage,
  SettingsPage,
  PublicVendorForm,
  PublicClientWelcome,
  CorporateGiftingCatalogue,
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
          <Route path="/catalogue/corporategifting" element={<CorporateGiftingCatalogue />} />
          <Route path="/catalogue/corporategifting/*" element={<CorporateGiftingCatalogue />} />
          <Route path="/Catalogue/Corporategifting" element={<CorporateGiftingCatalogue />} />
          <Route path="/Catalogue/Corporategifting/*" element={<CorporateGiftingCatalogue />} />
        </Route>

        {/* Authenticated routes — login required */}
        <Route element={<AuthenticatedLayout />}>
          <Route index element={<Navigate to="/clients" replace />} />
          <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/vendors" element={<VendorsPage />} />
          <Route path="/sales-orders" element={<SalesOrdersRoute />} />
          <Route path="/purchase-orders" element={<PurchaseOrdersRoute />} />
          <Route path="/invoices" element={<PlaceholderPage title="Invoice Notification" />} />
          <Route path="/advance-payments" element={<PlaceholderPage title="Advance Payment Receipt" />} />
          <Route path="/payment-receipts" element={<PlaceholderPage title="Payment Receipt" />} />
          <Route path="/payment-requests" element={<PlaceholderPage title="Payment Request" />} />
          <Route path="/courier" element={<PlaceholderPage title="Document Courier" />} />
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="*" element={<Navigate to="/clients" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
