import { lazy } from 'react'

/* ── Authenticated routes (lazy-loaded) ────────────────────────────────── */
export const ClientsPage = lazy(() => import('./features/clients/ClientsPage'))
export const VendorsPage = lazy(() => import('./features/vendors/VendorsPage'))
export const SalesOrdersPage = lazy(() => import('./features/sales-orders/SalesOrdersPage'))
export const PurchaseOrdersPage = lazy(() => import('./features/purchase-orders/PurchaseOrdersPage'))
export const SettingsPage = lazy(() => import('./features/settings/SettingsPage'))

/* ── Public routes (lazy-loaded, no auth required) ─────────────────────── */
export const PublicVendorForm = lazy(() => import('./features/public/PublicVendorForm'))
export const PublicClientWelcome = lazy(() => import('./features/public/PublicClientWelcome'))
export const CorporateGiftingCatalogue = lazy(() => import('./features/public/CorporateGiftingCatalogue'))
