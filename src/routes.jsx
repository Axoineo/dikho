import { lazyWithRetry } from './lib/lazyWithRetry'

/* ── Authenticated routes (lazy-loaded) ────────────────────────────────── */
export const ClientsPage = lazyWithRetry(() => import('./features/clients/ClientsPage'))
export const LeadsPage = lazyWithRetry(() => import('./features/leads/LeadsPage'))
export const VendorsPage = lazyWithRetry(() => import('./features/vendors/VendorsPage'))
export const SalesOrdersPage = lazyWithRetry(() => import('./features/sales-orders/SalesOrdersPage'))
export const PurchaseOrdersPage = lazyWithRetry(() => import('./features/purchase-orders/PurchaseOrdersPage'))
export const SettingsPage = lazyWithRetry(() => import('./features/settings/SettingsPage'))
export const UsersPage = lazyWithRetry(() => import('./features/users/UsersPage'))
export const UserProfilePage = lazyWithRetry(() => import('./features/users/UserProfilePage'))

/* ── WhatsApp Marketing ────────────────────────────────────────────────── */
export const WhatsAppInbox = lazyWithRetry(() => import('./features/whatsapp/inbox/WhatsAppInbox'))
export const WhatsAppDashboard = lazyWithRetry(() => import('./features/whatsapp/WhatsAppDashboard'))
export const WhatsAppContacts = lazyWithRetry(() => import('./features/whatsapp/WhatsAppContacts'))
export const WhatsAppCampaigns = lazyWithRetry(() => import('./features/whatsapp/WhatsAppCampaigns'))
export const WhatsAppTemplates = lazyWithRetry(() => import('./features/whatsapp/WhatsAppTemplates'))

/* ── Email Hub (built only with VITE_EMAIL_HUB=true) ───────────────────── */
export const EmailOverview = lazyWithRetry(() => import('./features/email/EmailOverview'))
export const EmailInbox = lazyWithRetry(() => import('./features/email/EmailInbox'))
export const EmailSettings = lazyWithRetry(() => import('./features/email/EmailSettings'))
export const EmailConnect = lazyWithRetry(() => import('./features/email/EmailConnect'))
export const EmailCampaigns = lazyWithRetry(() => import('./features/email/EmailCampaigns'))
export const EmailTemplates = lazyWithRetry(() => import('./features/email/EmailTemplates'))
export const EmailConsent = lazyWithRetry(() => import('./features/email/EmailConsent'))
export const EmailAnalytics = lazyWithRetry(() => import('./features/email/EmailAnalytics'))

/* ── Public routes (lazy-loaded, no auth required) ─────────────────────── */
export const PublicVendorForm = lazyWithRetry(() => import('./features/public/PublicVendorForm'))
export const PublicClientWelcome = lazyWithRetry(() => import('./features/public/PublicClientWelcome'))
