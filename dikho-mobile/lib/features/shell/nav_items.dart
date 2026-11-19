import 'package:flutter/material.dart';

import 'shell_messages.dart';

/// Screens drawn by the app rather than by the CRM page.
enum NativeScreen {
  inbox,
  clients,
  leads,
  salesOrders,
  vendors,
  purchaseOrders,
  dashboard,
  waContacts,
  waCampaigns,
  templates,
  deviceContacts,
  users,
  settings,
  emailInbox,
  emailOverview,
  emailAnalytics,
  emailCampaigns,
  emailTemplates,
  emailConsent,
  emailSettings,
}

/// One row of the drawer: a CRM page, or a native screen.
class NavEntry {
  const NavEntry({required this.label, required this.icon, required this.selectedIcon, this.path, this.native, this.requires});

  final String label;
  final IconData icon;
  final IconData selectedIcon;

  /// The page's route, also what decides visibility (the CRM reports which it
  /// allows). For the inbox the route decides visibility and [native] draws it.
  final String? path;
  final NativeScreen? native;

  /// For a native screen with no CRM route of its own: null means everyone.
  final String? requires;

  bool visibleTo(ShellAccess access) {
    final route = path;
    if (route != null) return access.mayOpen(route);
    final permission = requires;
    return permission == null || access.can(permission);
  }

  bool isActive(String route, NativeScreen? screen) {
    if (screen != null) return native == screen;
    return native == null && path != null && route == path;
  }
}

class NavGroup {
  const NavGroup(this.title, this.entries);
  final String title;
  final List<NavEntry> entries;
}

/// The whole drawer. The grouping is the drawer's own; the order within each group
/// follows the agreed web sidebar.
const navGroups = <NavGroup>[
  NavGroup('CRM', [
    NavEntry(label: 'Clients', icon: Icons.group_outlined, selectedIcon: Icons.group, path: '/clients', native: NativeScreen.clients),
    NavEntry(label: 'Leads', icon: Icons.filter_alt_outlined, selectedIcon: Icons.filter_alt, path: '/leads', native: NativeScreen.leads),
  ]),
  NavGroup('Sales and purchasing', [
    NavEntry(
      label: 'Sales orders',
      icon: Icons.shopping_cart_outlined,
      selectedIcon: Icons.shopping_cart,
      path: '/sales-orders',
      native: NativeScreen.salesOrders,
    ),
    NavEntry(label: 'Vendors', icon: Icons.store_outlined, selectedIcon: Icons.store, path: '/vendors', native: NativeScreen.vendors),
    NavEntry(
      label: 'Purchase orders',
      icon: Icons.shopping_bag_outlined,
      selectedIcon: Icons.shopping_bag,
      path: '/purchase-orders',
      native: NativeScreen.purchaseOrders,
    ),
  ]),
  NavGroup('WhatsApp', [
    NavEntry(label: 'Inbox', icon: Icons.chat_bubble_outline, selectedIcon: Icons.chat_bubble, path: '/whatsapp/inbox', native: NativeScreen.inbox),
    NavEntry(label: 'Dashboard', icon: Icons.insights_outlined, selectedIcon: Icons.insights, path: '/whatsapp', native: NativeScreen.dashboard),
    NavEntry(
      label: 'Contacts',
      icon: Icons.contacts_outlined,
      selectedIcon: Icons.contacts,
      path: '/whatsapp/contacts',
      native: NativeScreen.waContacts,
    ),
    NavEntry(
      label: 'Campaigns',
      icon: Icons.campaign_outlined,
      selectedIcon: Icons.campaign,
      path: '/whatsapp/campaigns',
      native: NativeScreen.waCampaigns,
    ),
    NavEntry(
      label: 'Templates',
      icon: Icons.article_outlined,
      selectedIcon: Icons.article,
      path: '/whatsapp/templates',
      native: NativeScreen.templates,
    ),
  ]),
  NavGroup('On this phone', [
    NavEntry(
      label: 'Phone contacts',
      icon: Icons.perm_contact_calendar_outlined,
      selectedIcon: Icons.perm_contact_calendar,
      native: NativeScreen.deviceContacts,
    ),
  ]),
  NavGroup('Email', [
    NavEntry(label: 'Overview', icon: Icons.mail_outline, selectedIcon: Icons.mail, path: '/email', native: NativeScreen.emailOverview),
    NavEntry(label: 'Email inbox', icon: Icons.inbox_outlined, selectedIcon: Icons.inbox, path: '/email/inbox', native: NativeScreen.emailInbox),
    NavEntry(
      label: 'Email campaigns',
      icon: Icons.send_outlined,
      selectedIcon: Icons.send,
      path: '/email/campaigns',
      native: NativeScreen.emailCampaigns,
    ),
    NavEntry(
      label: 'Email templates',
      icon: Icons.description_outlined,
      selectedIcon: Icons.description,
      path: '/email/templates',
      native: NativeScreen.emailTemplates,
    ),
    NavEntry(
      label: 'Consent',
      icon: Icons.verified_user_outlined,
      selectedIcon: Icons.verified_user,
      path: '/email/consent',
      native: NativeScreen.emailConsent,
    ),
    NavEntry(
      label: 'Analytics',
      icon: Icons.query_stats_outlined,
      selectedIcon: Icons.query_stats,
      path: '/email/analytics',
      native: NativeScreen.emailAnalytics,
    ),
    NavEntry(
      label: 'Email settings',
      icon: Icons.tune_outlined,
      selectedIcon: Icons.tune,
      path: '/email/settings',
      native: NativeScreen.emailSettings,
    ),
  ]),
  NavGroup('Admin', [
    NavEntry(label: 'Users', icon: Icons.manage_accounts_outlined, selectedIcon: Icons.manage_accounts, path: '/users', native: NativeScreen.users),
    NavEntry(label: 'Settings', icon: Icons.settings_outlined, selectedIcon: Icons.settings, path: '/settings', native: NativeScreen.settings),
  ]),
];

/// The CRM route the page hands over to this native screen, or null when the screen has
/// none of its own (Phone contacts).
String? handoffPathFor(NativeScreen screen) {
  for (final group in navGroups) {
    for (final entry in group.entries) {
      if (entry.native == screen) return entry.path;
    }
  }
  return null;
}
