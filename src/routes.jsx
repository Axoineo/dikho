import { lazyWithRetry } from './lib/lazyWithRetry'
import { canOpen } from './lib/access'
import { nativeScreens } from './lib/androidShell'

/* ── Authenticated routes (lazy-loaded) ────────────────────────────────── */
export const ClientsPage = lazyWithRetry(() => import('./features/clients/ClientsPage'))
export const LeadsPage = lazyWithRetry(() => import('./features/leads/LeadsPage'))
export const VendorsPage = lazyWithRetry(() => import('./features/vendors/VendorsPage'))
export const SalesOrdersPage = lazyWithRetry(() => import('./features/sales-orders/SalesOrdersPage'))
export const SalesOrderInvoicePage = lazyWithRetry(() => import('./features/sales-orders/SalesOrderInvoicePage'))
export const PurchaseOrdersPage = lazyWithRetry(() => import('./features/purchase-orders/PurchaseOrdersPage'))
export const SettingsPage = lazyWithRetry(() => import('./features/settings/SettingsPage'))
export const UsersPage = lazyWithRetry(() => import('./features/users/UsersPage'))
export const UserProfilePage = lazyWithRetry(() => import('./features/users/UserProfilePage'))

/* ── WhatsApp Marketing ────────────────────────────────────────────────── */
export const WhatsAppInbox = lazyWithRetry(() => import('./features/whatsapp/inbox/WhatsAppInbox'))
export const WhatsAppDashboard = lazyWithRetry(() => import('./features/whatsapp/WhatsAppDashboard'))
export const WhatsAppContacts = lazyWithRetry(() => import('./features/whatsapp/WhatsAppContacts'))
export const WhatsAppCampaigns = lazyWithRetry(() => import('./features/whatsapp/WhatsAppCampaigns'))
export const CampaignPerformance = lazyWithRetry(() => import('./features/whatsapp/CampaignPerformance'))
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
export const PrivacyPage = lazyWithRetry(() => import('./features/legal/PrivacyPage'))

/* ── Ahead-of-time chunk loading ───────────────────────────────────────── */

// Only the sections this person may open, in the order the drawer lists them, one
// at a time so a slow connection is never swamped. A failed fetch is left for the
// real visit to retry.
export async function preloadRoutes(access) {
  const sections = [
    ['/clients', ClientsPage], ['/leads', LeadsPage], ['/sales-orders', SalesOrdersPage],
    ['/vendors', VendorsPage], ['/purchase-orders', PurchaseOrdersPage],
    ['/whatsapp', WhatsAppDashboard], ['/whatsapp/contacts', WhatsAppContacts],
    ['/whatsapp/campaigns', WhatsAppCampaigns], ['/whatsapp/templates', WhatsAppTemplates],
    ['/users', UsersPage], ['/settings', SettingsPage],
  ]
  if (!nativeScreens.has('inbox')) sections.push(['/whatsapp/inbox', WhatsAppInbox])
  for (const [path, page] of sections) {
    // The app draws these itself, so their web code is never needed there.
    const native = { '/clients': 'clients', '/leads': 'leads', '/sales-orders': 'sales-orders', '/vendors': 'vendors', '/purchase-orders': 'purchase-orders', '/users': 'users', '/settings': 'settings', '/whatsapp': 'dashboard', '/whatsapp/contacts': 'whatsapp-contacts', '/whatsapp/campaigns': 'whatsapp-campaigns', '/whatsapp/templates': 'templates' }[path]
    if (native && nativeScreens.has(native)) continue
    if (!canOpen(access, path)) continue
    try { await page.preload() } catch { /* the visit itself retries */ }
  }
}
