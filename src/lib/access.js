import { createContext, useContext } from 'react'

// The signed-in person's access, as public.my_access() returned it on load:
// { status, user_id, session_id, full_name, system_role, developer_level,
//   theme, permissions: { 'clients.view': 'all', 'sales_orders.view': 'own', ... } }
//
// Everything here decides what to SHOW. It is not a security boundary: the
// database (RLS) and the API Worker check the same permissions on every
// request, so a hidden button that is forced back into the page still fails.
// See docs/decisions/0007-user-management-and-permissions.md.
export const AccessContext = createContext(null)

export function hasPermission(access, key) {
  const scope = access?.permissions?.[key]
  return typeof scope === 'string' && scope !== 'none'
}

/** 'own' | 'team' | 'department' | 'all' | 'none' */
export function scopeOf(access, key) {
  return access?.permissions?.[key] ?? 'none'
}

export function hasAny(access, keys) {
  return keys.some((key) => hasPermission(access, key))
}

export function useAccess() {
  const access = useContext(AccessContext)
  return {
    access,
    can: (key) => hasPermission(access, key),
    canAny: (...keys) => hasAny(access, keys),
    scope: (key) => scopeOf(access, key),
  }
}

// What each page needs (any one of the listed permissions). Sidebar entries,
// route guards and the default landing page all read this one table.
export const PAGE_ACCESS = [
  { path: '/clients', section: 'clients', any: ['clients.view'] },
  { path: '/leads', section: 'leads', any: ['leads.view'] },
  { path: '/vendors', section: 'vendors', any: ['vendors.view'] },
  { path: '/sales-orders', section: 'sales-orders', any: ['sales_orders.view'] },
  { path: '/purchase-orders', section: 'purchase-orders', any: ['purchase_orders.view'] },
  { path: '/invoices', section: 'invoices', any: ['invoices.view'] },
  { path: '/advance-payments', section: 'payments', any: ['payments.view'] },
  { path: '/payment-receipts', section: 'payments', any: ['payments.view'] },
  { path: '/payment-requests', section: 'payments', any: ['payments.view'] },
  { path: '/courier', section: 'courier', any: ['sales_orders.view', 'purchase_orders.view'] },
  { path: '/whatsapp/inbox', section: 'whatsapp-inbox', any: ['inbox.view'] },
  { path: '/whatsapp/contacts', section: 'whatsapp-contacts', any: ['wa_contacts.view'] },
  { path: '/whatsapp/campaigns', section: 'whatsapp-campaigns', any: ['campaigns.view', 'campaigns.send'] },
  { path: '/whatsapp/templates', section: 'whatsapp-templates', any: ['wa_templates.view', 'campaigns.view'] },
  { path: '/whatsapp', section: 'whatsapp', any: ['campaigns.view', 'campaigns.send'], exact: true },
  { path: '/users', section: 'users', any: ['users.view'] },
  { path: '/dashboard', section: 'dashboard', any: [] },
  { path: '/settings', section: 'settings', any: [] },
]

export function pageFor(pathname) {
  return PAGE_ACCESS.find((page) => (page.exact
    ? pathname === page.path
    : pathname === page.path || pathname.startsWith(`${page.path}/`)))
}

export function canOpen(access, path) {
  // Your own profile (sessions, what you can do) needs no users.* permission.
  if (access?.user_id && path === `/users/${access.user_id}`) return true
  const page = pageFor(path)
  if (!page) return true
  return page.any.length === 0 || hasAny(access, page.any)
}

// Where to land after sign-in or when a page is out of reach: the first page
// in the sidebar's order this person may open.
const LANDING_ORDER = ['/clients', '/sales-orders', '/purchase-orders', '/vendors', '/leads', '/whatsapp/inbox', '/whatsapp', '/invoices', '/users']
export function landingPath(access) {
  return LANDING_ORDER.find((path) => canOpen(access, path)) ?? '/settings'
}

// Short route key for the activity heartbeat ("which section are they in").
// Never the full URL: ids in paths would leak which record is open.
export function sectionFor(pathname) {
  return pageFor(pathname)?.section ?? null
}

export const SECTION_LABELS = {
  clients: 'Clients', leads: 'Leads', vendors: 'Vendors', 'sales-orders': 'Sales Orders',
  'purchase-orders': 'Purchase Orders', invoices: 'Invoices', payments: 'Payments', courier: 'Document Courier',
  whatsapp: 'WhatsApp Dashboard', 'whatsapp-inbox': 'WhatsApp Inbox', 'whatsapp-contacts': 'WhatsApp Contacts',
  'whatsapp-campaigns': 'WhatsApp Campaigns', 'whatsapp-templates': 'WhatsApp Templates', users: 'User Management',
  dashboard: 'Dashboard', settings: 'Settings',
}

export const ROLE_LABELS = { staff: 'Staff', manager: 'Manager', admin: 'Admin', owner: 'Owner' }
export const DEVELOPER_LABELS = {
  developer: 'Developer', senior_developer: 'Senior Developer', lead_developer: 'Lead Developer', system_owner: 'System Administrator',
}
