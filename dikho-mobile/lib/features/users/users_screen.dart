import 'dart:async';

import 'package:flutter/material.dart';

import '../live_assist/live_assist_controller.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import 'user_forms.dart';
import 'user_profile_screen.dart';
import 'users_admin_screens.dart';
import 'users_controller.dart';
import 'users_models.dart';

/// What this person may do in User Management; the API checks each change again.
class UsersAbilities {
  const UsersAbilities({
    this.userId = '',
    this.create = false,
    this.edit = false,
    this.permissions = false,
    this.suspend = false,
    this.sessions = false,
    this.audit = false,
    this.templates = false,
    this.departments = false,
  });

  final String userId;
  final bool create;
  final bool edit;
  final bool permissions;
  final bool suspend;
  final bool sessions;
  final bool audit;
  final bool templates;
  final bool departments;
}

/// Who can use Dikho, as the web People tab shows them: a search over name, email,
/// phone and employee ID, filters, and counts that are filters themselves.
class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key, required this.controller, required this.abilities, required this.onOpenDrawer, this.assist});

  final UsersController controller;
  final UsersAbilities abilities;
  final VoidCallback onOpenDrawer;

  /// Live Assist, for a profile's "Live Assist" button.
  final LiveAssistController? assist;

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  final _search = TextEditingController();

  UsersController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    _search.text = _c.query;
    _c.watch();
  }

  @override
  void dispose() {
    _c.unwatch();
    _search.dispose();
    super.dispose();
  }

  Future<void> _open(Member m) async {
    FocusManager.instance.primaryFocus?.unfocus();
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => UserProfileScreen(controller: _c, userId: m.userId, abilities: widget.abilities, preview: m, assist: widget.assist),
      ),
    );
    unawaited(_c.load());
  }

  Future<void> _add() async {
    final catalog = _c.catalog;
    if (catalog == null) return;
    final added = await Navigator.of(context).push<AddedUser>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => AddUserScreen(controller: _c, catalog: catalog),
      ),
    );
    if (added == null || !mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => UserProfileScreen(
          controller: _c,
          userId: added.member.userId,
          abilities: widget.abilities,
          preview: added.member,
          startOnAccess: added.customize,
          assist: widget.assist,
        ),
      ),
    );
  }

  Future<void> _filters() async {
    FocusManager.instance.primaryFocus?.unfocus();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _FilterSheet(controller: _c),
    );
  }

  void _openAdmin(String which) {
    final page = switch (which) {
      'templates' => TemplatesScreen(controller: _c, canManage: widget.abilities.templates),
      'departments' => DepartmentsScreen(controller: _c, canManage: widget.abilities.departments),
      _ => AuditScreen(controller: _c),
    };
    unawaited(Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page)));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: _c,
      builder: (context, _) {
        final counts = _c.counts;
        final f = _c.filter;
        final loaded = _c.members != null;
        return Scaffold(
          appBar: AppBar(
            leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
            title: const Text('Users'),
            actions: [
              IconButton(
                tooltip: f.narrowed ? 'Filters, some on' : 'Filters',
                onPressed: () => unawaited(_filters()),
                icon: Badge(isLabelVisible: f.narrowed, smallSize: 8, child: const Icon(Icons.filter_list)),
              ),
              PopupMenuButton<String>(
                tooltip: 'More',
                onSelected: _openAdmin,
                itemBuilder: (_) => [
                  const PopupMenuItem(value: 'templates', child: Text('Permission templates')),
                  const PopupMenuItem(value: 'departments', child: Text('Departments and teams')),
                  if (widget.abilities.audit) const PopupMenuItem(value: 'audit', child: Text('Audit log')),
                ],
              ),
            ],
          ),
          floatingActionButton: widget.abilities.create && _c.catalog != null
              ? FloatingActionButton.extended(
                  onPressed: () => unawaited(_add()),
                  icon: const Icon(Icons.person_add_alt),
                  label: const Text('Add user'),
                )
              : null,
          body: Column(
            children: [
              Container(
                color: theme.colorScheme.surface,
                padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, Gap.m, 0),
                child: TextField(
                  controller: _search,
                  onChanged: (value) {
                    setState(() {});
                    _c.setQuery(value);
                  },
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.search),
                    hintText: 'Search name, email, phone or employee ID',
                    suffixIcon: _search.text.isEmpty
                        ? null
                        : IconButton(
                            tooltip: 'Clear search',
                            onPressed: () {
                              _search.clear();
                              setState(() {});
                              _c.setQuery('');
                            },
                            icon: const Icon(Icons.close),
                          ),
                  ),
                ),
              ),
              // The counts are filters, as the web's tiles are.
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, Gap.m, Gap.s),
                child: Row(
                  children: [
                    for (final (label, value, apply, selected) in [
                      ('Users', counts.total, () => _c.setFilter(const PeopleFilter()), f.status == 'current' && f.role.isEmpty),
                      ('Online now', counts.online, null, false),
                      ('Invited', counts.invited, () => _c.setFilter(f.copyWith(status: 'invited')), f.status == 'invited'),
                      ('Suspended', counts.suspended, () => _c.setFilter(f.copyWith(status: 'suspended')), f.status == 'suspended'),
                      ('Admins and owners', counts.admins, () => _c.setFilter(f.copyWith(status: 'current', role: 'admin')), f.role == 'admin'),
                      ('Developers', counts.developers, () => _c.setFilter(f.copyWith(status: 'current', role: 'developer')), f.role == 'developer'),
                    ])
                      Padding(
                        padding: const EdgeInsets.only(right: Gap.s),
                        child: apply == null
                            ? Chip(label: Text(loaded ? '$label $value' : label), avatar: value > 0 ? const _OnlineDot() : null)
                            : FilterChip(label: Text(loaded ? '$label $value' : label), selected: selected && loaded, onSelected: (_) => apply()),
                      ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(child: _body(context)),
            ],
          ),
        );
      },
    );
  }

  Widget _body(BuildContext context) {
    final members = _c.members;
    if (members == null) {
      if (_c.error != null) {
        return EmptyMessage(title: "Couldn't load users", body: _c.error!, action: 'Try again', onAction: () => unawaited(_c.load()));
      }
      return const Center(child: CircularProgressIndicator());
    }
    final rows = _c.shown;
    if (rows.isEmpty) {
      return EmptyMessage(
        title: members.isEmpty ? 'No users yet' : 'Nobody matches these filters',
        body: members.isEmpty ? 'Add the first person with Add user.' : 'Try a different search, or clear the filters.',
      );
    }
    final now = _c.now();
    return RefreshIndicator(
      onRefresh: _c.load,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.only(bottom: widget.abilities.create ? 88 : 0),
        itemCount: rows.length,
        itemBuilder: (context, index) {
          final m = rows[index];
          return _PersonRow(
            key: ValueKey(m.userId),
            member: m,
            now: now,
            isSelf: m.userId == widget.abilities.userId,
            onTap: () => unawaited(_open(m)),
          );
        },
      ),
    );
  }
}

class _OnlineDot extends StatelessWidget {
  const _OnlineDot();

  @override
  Widget build(BuildContext context) => Container(
    width: 8,
    height: 8,
    decoration: const BoxDecoration(color: Color(0xFF1E8E3E), shape: BoxShape.circle),
  );
}

/// A person's initials, with a green dot when they are online.
class MemberAvatar extends StatelessWidget {
  const MemberAvatar({super.key, required this.member, this.size = 44});

  final Member member;
  final double size;

  @override
  Widget build(BuildContext context) => Stack(
    clipBehavior: Clip.none,
    children: [
      Initials(text: initials(member.name), size: size),
      if (member.online)
        Positioned(
          right: 0,
          bottom: 0,
          child: Container(
            width: size * 0.28,
            height: size * 0.28,
            decoration: BoxDecoration(
              color: const Color(0xFF1E8E3E),
              shape: BoxShape.circle,
              border: Border.all(color: Theme.of(context).colorScheme.surface, width: 2),
            ),
          ),
        ),
    ],
  );
}

PillTone statusTone(String status) => switch (status) {
  'active' => PillTone.active,
  'invited' => PillTone.pending,
  'suspended' => PillTone.danger,
  _ => PillTone.neutral,
};

class _PersonRow extends StatelessWidget {
  const _PersonRow({super.key, required this.member, required this.now, required this.isSelf, required this.onTap});

  final Member member;
  final DateTime now;
  final bool isSelf;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final role = [member.roleLabel, ?member.developerLabel].join(' · ');
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Gap.m, vertical: Gap.m),
        child: Row(
          children: [
            MemberAvatar(member: member),
            const SizedBox(width: Gap.m),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    isSelf ? '${member.name} (you)' : member.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                  ),
                  if (member.contactLine.isNotEmpty) Text(member.contactLine, maxLines: 1, overflow: TextOverflow.ellipsis, style: muted),
                  Text('$role · ${member.activity(now)}', maxLines: 1, overflow: TextOverflow.ellipsis, style: muted),
                ],
              ),
            ),
            if (member.status != 'active') ...[const SizedBox(width: Gap.s), Pill(label: member.statusLabel, tone: statusTone(member.status))],
            Icon(Icons.chevron_right, color: theme.colorScheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}

class _FilterSheet extends StatefulWidget {
  const _FilterSheet({required this.controller});

  final UsersController controller;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late PeopleFilter _f = widget.controller.filter;

  Widget _dropdown(String label, String value, List<(String, String)> items, ValueChanged<String> onChanged) => Padding(
    padding: const EdgeInsets.only(bottom: Gap.m),
    child: DropdownButtonFormField<String>(
      initialValue: items.any((i) => i.$1 == value) ? value : items.first.$1,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final (v, text) in items)
          DropdownMenuItem(
            value: v,
            child: Text(text, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (v) => setState(() => onChanged(v ?? '')),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final catalog = widget.controller.catalog;
    return Padding(
      padding: EdgeInsets.fromLTRB(Gap.l, Gap.l, Gap.l, Gap.l + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Filters', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: Gap.m),
            _dropdown('Status', _f.status, [
              ('current', 'Current users'),
              ('', 'Everyone, including archived'),
              for (final s in statusLabels.entries) (s.key, s.value),
            ], (v) => _f = _f.copyWith(status: v)),
            _dropdown('Role', _f.role, [
              ('', 'All roles'),
              for (final r in const ['owner', 'admin', 'manager', 'staff']) (r, roleLabels[r]!),
              ('developer', 'Developers'),
            ], (v) => _f = _f.copyWith(role: v)),
            _dropdown('Department', _f.department, [
              ('', 'All departments'),
              for (final d in catalog?.departments ?? const <Department>[]) (d.id, d.name),
            ], (v) => _f = _f.copyWith(department: v)),
            _dropdown('Permission template', _f.template, [
              ('', 'All templates'),
              ('none', 'Custom (no template)'),
              for (final t in catalog?.templates ?? const <Template>[]) (t.id, t.name),
            ], (v) => _f = _f.copyWith(template: v)),
            Row(
              children: [
                TextButton(
                  onPressed: () {
                    widget.controller.setFilter(const PeopleFilter());
                    Navigator.of(context).pop();
                  },
                  child: const Text('Clear all'),
                ),
                const Spacer(),
                FilledButton(
                  onPressed: () {
                    widget.controller.setFilter(_f);
                    Navigator.of(context).pop();
                  },
                  child: const Text('Show people'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
