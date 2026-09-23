import { lazy } from 'react'

/* ── Authenticated routes (lazy-loaded) ────────────────────────────────── */
export const ClientsPage = lazy(() => import('./features/clients/ClientsPage'))
export const VendorsPage = lazy(() => import('./features/vendors/VendorsPage'))
export const SalesOrdersPage = lazy(() => import('./features/sales-orders/SalesOrdersPage'))
export const PurchaseOrdersPage = lazy(() => import('./features/purchase-orders/PurchaseOrdersPage'))
export const SettingsPage = lazy(() => import('./features/settings/SettingsPage'))

/* ── WhatsApp Marketing ────────────────────────────────────────────────── */
export const WhatsAppDashboard = lazy(() => import('./features/whatsapp/WhatsAppDashboard'))
export const WhatsAppContacts = lazy(() => import('./features/whatsapp/WhatsAppContacts'))
export const WhatsAppCampaigns = lazy(() => import('./features/whatsapp/WhatsAppCampaigns'))
export const WhatsAppTemplates = lazy(() => import('./features/whatsapp/WhatsAppTemplates'))

/* ── Public routes (lazy-loaded, no auth required) ─────────────────────── */
export const PublicVendorForm = lazy(() => import('./features/public/PublicVendorForm'))
export const PublicClientWelcome = lazy(() => import('./features/public/PublicClientWelcome'))
