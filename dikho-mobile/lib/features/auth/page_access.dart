/// Which CRM pages a person may open, as PAGE_ACCESS, canOpen and sectionFor in
/// src/lib/access.js decide it, so the app's drawer shows the same pages the web
/// sidebar does. Change one side and change the other. Showing is not permission: the
/// API and RLS check every request again.
library;

import '../../app/app_config.dart';

class PageRule {
  const PageRule(this.path, this.section, this.any, {this.exact = false});

  final String path;
  final String section;

  /// Any one of these opens the page; none listed means everyone signed in.
  final List<String> any;
  final bool exact;
}

const pageRules = <PageRule>[
  PageRule('/clients', 'clients', ['clients.view']),
  PageRule('/leads', 'leads', ['leads.view']),
  PageRule('/vendors', 'vendors', ['vendors.view']),
  PageRule('/sales-orders', 'sales-orders', ['sales_orders.view']),
  PageRule('/purchase-orders', 'purchase-orders', ['purchase_orders.view']),
  PageRule('/invoices', 'invoices', ['invoices.view']),
  PageRule('/advance-payments', 'payments', ['payments.view']),
  PageRule('/payment-receipts', 'payments', ['payments.view']),
  PageRule('/payment-requests', 'payments', ['payments.view']),
  PageRule('/courier', 'courier', ['sales_orders.view', 'purchase_orders.view']),
  PageRule('/whatsapp/inbox', 'whatsapp-inbox', ['inbox.view']),
  PageRule('/whatsapp/contacts', 'whatsapp-contacts', ['wa_contacts.view']),
  PageRule('/whatsapp/campaigns', 'whatsapp-campaigns', ['campaigns.view', 'campaigns.send']),
  PageRule('/whatsapp/templates', 'whatsapp-templates', ['wa_templates.view', 'campaigns.view']),
  PageRule('/whatsapp', 'whatsapp', ['campaigns.view', 'campaigns.send'], exact: true),
  PageRule('/email/inbox', 'email-inbox', ['email_inbox.view']),
  PageRule('/email/settings', 'email-settings', ['email_inbox.view', 'email_mailboxes.manage']),
  PageRule('/email/connect', 'email-settings', ['email_inbox.view', 'email_mailboxes.manage']),
  PageRule('/email/campaigns', 'email-campaigns', ['email_campaigns.view', 'email_campaigns.create', 'email_campaigns.approve']),
  PageRule('/email/templates', 'email-templates', ['email_templates.manage', 'email_campaigns.create', 'email_campaigns.view']),
  PageRule('/email/consent', 'email-consent', ['email_consent.manage', 'email_campaigns.create']),
  PageRule('/email/analytics', 'email-analytics', ['email_campaigns.view', 'email_campaigns.approve']),
  PageRule('/email', 'email', [
    'email_inbox.view',
    'email_mailboxes.manage',
    'email_campaigns.view',
    'email_campaigns.create',
    'email_campaigns.approve',
  ], exact: true),
  PageRule('/users', 'users', ['users.view']),
  PageRule('/dashboard', 'dashboard', []),
  PageRule('/settings', 'settings', []),
];

/// The pages the drawer can link to: DRAWER_PATHS and, in a build with the Email
/// Hub, EMAIL_PATHS in src/lib/androidShell.jsx.
const drawerPaths = [
  '/clients',
  '/leads',
  '/sales-orders',
  '/vendors',
  '/purchase-orders',
  '/whatsapp',
  '/whatsapp/inbox',
  '/whatsapp/contacts',
  '/whatsapp/campaigns',
  '/whatsapp/templates',
  '/users',
  '/settings',
];
const emailPaths = ['/email', '/email/inbox', '/email/campaigns', '/email/templates', '/email/consent', '/email/analytics', '/email/settings'];

PageRule? pageFor(String path) {
  for (final rule in pageRules) {
    if (rule.exact ? path == rule.path : path == rule.path || path.startsWith('${rule.path}/')) return rule;
  }
  return null;
}

/// canOpen: a page with no rule is open to everyone signed in; your own profile needs
/// no users.* permission.
bool canOpen(Set<String> permissions, String userId, String path) {
  if (userId.isNotEmpty && path == '/users/$userId') return true;
  final rule = pageFor(path);
  if (rule == null || rule.any.isEmpty) return true;
  return rule.any.any(permissions.contains);
}

/// The short section key the heartbeat reports, never a full path: ids in paths would
/// say which record is open.
String? sectionFor(String path) => pageFor(path)?.section;

/// The drawer pages this person may open.
Set<String> allowedPaths(Set<String> permissions, String userId, {bool emailHub = AppConfig.emailHub}) => {
  for (final path in [...drawerPaths, if (emailHub) ...emailPaths])
    if (canOpen(permissions, userId, path)) path,
};
