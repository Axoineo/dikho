import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'nav_items.dart';
import 'shell_messages.dart';

/// The app's navigation: a Material 3 drawer, grouped, showing only what this
/// person may open. Hiding is navigation, not security: the API and RLS check the
/// same permissions on every request.
class AppDrawer extends StatelessWidget {
  const AppDrawer({
    super.key,
    required this.access,
    required this.route,
    required this.native,
    required this.unreadChats,
    required this.versionName,
    required this.onSelect,
    required this.onAskForHelp,
    required this.onSignOut,
  });

  final ShellAccess access;
  final String route;
  final NativeScreen? native;
  final int unreadChats;
  final String versionName;
  final ValueChanged<NavEntry> onSelect;
  final VoidCallback onAskForHelp;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final destinations = <NavEntry>[];
    final children = <Widget>[_Header(access: access)];
    for (final group in navGroups) {
      final entries = group.entries.where((e) => e.visibleTo(access)).toList();
      if (entries.isEmpty) continue;
      children.add(_SectionTitle(group.title));
      for (final entry in entries) {
        destinations.add(entry);
        children.add(
          NavigationDrawerDestination(
            icon: _withBadge(entry, Icon(entry.icon)),
            selectedIcon: _withBadge(entry, Icon(entry.selectedIcon)),
            label: Flexible(
              child: Semantics(
                label: _showsBadge(entry) ? '${entry.label}, $unreadChats unread' : entry.label,
                excludeSemantics: true,
                child: Text(entry.label, overflow: TextOverflow.ellipsis),
              ),
            ),
          ),
        );
      }
    }
    final selected = destinations.indexWhere((e) => e.isActive(route, native));

    children.addAll([
      const Padding(padding: EdgeInsets.fromLTRB(16, 12, 16, 4), child: Divider()),
      if (access.helpOffered)
        _FooterTile(icon: Icons.support_outlined, label: access.helpRequested ? 'Help requested' : 'Ask for help', onTap: onAskForHelp),
      _FooterTile(icon: Icons.logout, label: 'Log out', color: theme.colorScheme.error, onTap: () => _confirmSignOut(context)),
      Padding(
        padding: const EdgeInsets.fromLTRB(28, 8, 16, 16),
        child: Text('Dikho CRM $versionName', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      ),
    ]);

    // Never wider than the phone leaves room for: a 360dp drawer does not fit on a
    // 320dp screen.
    final width = math.min(320.0, MediaQuery.sizeOf(context).width - 56);
    return DrawerTheme(
      data: DrawerTheme.of(context).copyWith(width: width),
      child: NavigationDrawer(
        selectedIndex: selected < 0 ? null : selected,
        onDestinationSelected: (index) => onSelect(destinations[index]),
        tilePadding: const EdgeInsets.symmetric(horizontal: 12),
        children: children,
      ),
    );
  }

  bool _showsBadge(NavEntry entry) => entry.native == NativeScreen.inbox && unreadChats > 0;

  // The number is spoken as part of the row's label, not as a separate "22".
  Widget _withBadge(NavEntry entry, Widget icon) => _showsBadge(entry)
      ? ExcludeSemantics(
          child: Badge.count(count: unreadChats, child: icon),
        )
      : icon;

  Future<void> _confirmSignOut(BuildContext context) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Log out of Dikho CRM?'),
        content: const Text('You will need a new code from your email or WhatsApp to sign in again.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Log out')),
        ],
      ),
    );
    if (yes == true) onSignOut();
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.access});

  final ShellAccess access;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 16, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Image.asset('assets/brand/logo.png', height: 28, alignment: Alignment.centerLeft),
          const SizedBox(height: 16),
          Row(
            children: [
              ExcludeSemantics(
                child: CircleAvatar(
                  radius: 20,
                  backgroundColor: theme.navigationDrawerTheme.indicatorColor,
                  child: Text(
                    access.initials,
                    style: TextStyle(color: theme.colorScheme.primary, fontWeight: FontWeight.w500, fontSize: 14),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(access.name, style: theme.textTheme.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                    if (access.email.isNotEmpty)
                      Text(
                        access.email,
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(28, 16, 16, 8),
      child: Semantics(
        header: true,
        child: Text(title, style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      ),
    );
  }
}

class _FooterTile extends StatelessWidget {
  const _FooterTile({required this.icon, required this.label, required this.onTap, this.color});

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final foreground = color ?? Theme.of(context).colorScheme.onSurface;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: onTap,
        child: SizedBox(
          height: 48,
          child: Row(
            children: [
              const SizedBox(width: 16),
              Icon(icon, size: 24, color: foreground),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(color: foreground, fontSize: 14, fontWeight: FontWeight.w500),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
