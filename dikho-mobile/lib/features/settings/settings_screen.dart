import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import '../shell/shell_controller.dart';
import '../shell/shell_messages.dart';
import '../users/user_profile_screen.dart';
import '../users/users_controller.dart';
import '../users/users_models.dart';
import '../users/users_screen.dart';
import 'organization_settings.dart';
import 'settings_controller.dart';
import 'settings_models.dart';
import 'settings_parts.dart';

/// What this person may do in Settings, from their access. The database checks the
/// same again on every change.
class SettingsAbilities {
  const SettingsAbilities({required this.access, required this.manage, required this.viewUsers, required this.emailHub});

  final ShellAccess access;

  /// settings.manage: the organization's settings (Company, Regional, Lists).
  final bool manage;

  /// users.view: a way on to Users and roles.
  final bool viewUsers;
  final bool emailHub;
}

/// Settings, redesigned for a phone from SettingsPage.jsx: the web's side menu becomes
/// this list, and each section opens as its own screen.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.controller,
    required this.users,
    required this.usersAbilities,
    required this.shell,
    required this.abilities,
    required this.onOpenDrawer,
    required this.onOpenUsers,
  });

  final SettingsController controller;
  final UsersController users;
  final UsersAbilities usersAbilities;
  final ShellController shell;
  final SettingsAbilities abilities;
  final VoidCallback onOpenDrawer;
  final VoidCallback onOpenUsers;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.usePreferences(widget.abilities.access.preferences);
  }

  void _open(Widget screen) => unawaited(Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen)));

  void _openProfile() => _open(UserProfileScreen(controller: widget.users, userId: widget.abilities.access.userId, abilities: widget.usersAbilities));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final a = widget.abilities;
    final c = widget.controller;
    Widget tile(IconData icon, String title, String subtitle, VoidCallback onTap) =>
        ListTile(leading: Icon(icon), title: Text(title), subtitle: Text(subtitle), trailing: const Icon(Icons.chevron_right), onTap: onTap);
    Widget heading(String text) => Padding(
      padding: const EdgeInsets.fromLTRB(Gap.l, Gap.l, Gap.l, Gap.xs),
      child: Semantics(
        header: true,
        child: Text(text, style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary)),
      ),
    );
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', icon: const Icon(Icons.menu), onPressed: widget.onOpenDrawer),
        title: const Text('Settings'),
      ),
      body: ListView(
        padding: const EdgeInsets.only(bottom: Gap.xl),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, 0),
            child: Text(
              a.manage ? 'Your own preferences, and how Dikho works for everyone.' : 'Your profile, preferences and sign-in.',
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
          heading('Your account'),
          tile(
            Icons.person_outline,
            'Profile',
            'How you appear in Dikho',
            () => _open(ProfileSettingsScreen(controller: c, access: a.access, onOpenProfile: _openProfile)),
          ),
          tile(
            Icons.tune,
            'Preferences',
            'Theme and where Dikho opens',
            () => _open(PreferencesScreen(controller: c, shell: widget.shell, abilities: a)),
          ),
          tile(
            Icons.shield_outlined,
            'Sign-in and security',
            'The devices you are signed in on',
            () => _open(SignInSettingsScreen(controller: c, users: widget.users, access: a.access)),
          ),
          if (a.manage) ...[
            heading('Organization'),
            tile(Icons.business_outlined, 'Company', 'Details printed on tax invoices', () => _open(CompanySettingsScreen(controller: c))),
            tile(Icons.public, 'Regional', 'How dates and amounts appear', () => _open(RegionalSettingsScreen(controller: c))),
            tile(Icons.format_list_bulleted, 'Lists and media', 'The choices dropdowns offer', () => _open(ListsSettingsScreen(controller: c))),
          ] else
            const Padding(
              padding: EdgeInsets.fromLTRB(Gap.l, Gap.l, Gap.l, 0),
              child: InfoNote(
                icon: Icons.shield_outlined,
                text: 'Organization settings are changed by Owners and Admins. Ask one of them if something there needs to change.',
              ),
            ),
          if (a.viewUsers) ...[
            const SizedBox(height: Gap.s),
            tile(Icons.manage_accounts_outlined, 'Users and roles', 'Who can sign in, and what they can do', widget.onOpenUsers),
          ],
        ],
      ),
    );
  }
}

/* ── Profile ──────────────────────────────────────────────────────────────── */

class ProfileSettingsScreen extends StatefulWidget {
  const ProfileSettingsScreen({super.key, required this.controller, required this.access, required this.onOpenProfile});

  final SettingsController controller;
  final ShellAccess access;
  final VoidCallback onOpenProfile;

  @override
  State<ProfileSettingsScreen> createState() => _ProfileSettingsScreenState();
}

class _ProfileSettingsScreenState extends State<ProfileSettingsScreen> {
  Member? _me;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final me = await widget.controller.me();
      if (mounted) setState(() => _me = me);
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = _me;
    final a = widget.access;
    final phone = me?.phone ?? '';
    final rows = <(String, String)>[
      ('Name', me?.name ?? a.name),
      ('Email', me?.email ?? a.email),
      if (phone.isNotEmpty) ('Phone', '+${phone.replaceFirst(RegExp(r'^\+'), '')}'),
      if (me != null) ('Role', [me.roleLabel, ?me.developerLabel].join(' · ')),
      if (me != null && me.designation.isNotEmpty) ('Designation', me.designation),
      if (me != null && (me.department.isNotEmpty || me.team.isNotEmpty))
        ('Department', [me.department, me.team].where((p) => p.isNotEmpty).join(' · ')),
      if (me != null && me.reportingManager.isNotEmpty) ('Reports to', me.reportingManager),
      if (me != null && me.employeeId.isNotEmpty) ('Employee ID', me.employeeId),
      if (me != null && me.joiningDate.isNotEmpty) ('Joined', dateOnly(me.joiningDate)),
    ].where((row) => row.$2.isNotEmpty).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(Gap.l),
        children: [
          const SettingsIntro('How you appear in Dikho. Your administrator keeps these details up to date; ask them if something is wrong.'),
          if (me == null && _error == null) const LinearProgressIndicator(),
          const SizedBox(height: Gap.s),
          DetailsCard(title: 'Your details', rows: rows),
          if (_error != null) StatusText(text: _error, error: true),
          if (a.userId.isNotEmpty)
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: widget.onOpenProfile,
                icon: const Icon(Icons.badge_outlined),
                label: const Text('Your full profile and access'),
              ),
            ),
        ],
      ),
    );
  }
}

/* ── Preferences ──────────────────────────────────────────────────────────── */

class PreferencesScreen extends StatefulWidget {
  const PreferencesScreen({super.key, required this.controller, required this.shell, required this.abilities});

  final SettingsController controller;
  final ShellController shell;
  final SettingsAbilities abilities;

  @override
  State<PreferencesScreen> createState() => _PreferencesScreenState();
}

class _PreferencesScreenState extends State<PreferencesScreen> {
  String? _status;
  bool _error = false;

  SettingsController get _c => widget.controller;

  void _say(String text, {bool error = false}) {
    if (!mounted) return;
    setState(() {
      _status = text;
      _error = error;
    });
  }

  /// Applied at once; put back if it cannot be saved.
  Future<void> _theme(String mode) async {
    final before = widget.shell.themeChoice;
    widget.shell.chooseTheme(mode);
    setState(() {});
    _say('Saving…');
    try {
      await _c.saveTheme(mode);
      _say('Saved. Your theme follows you to every device.');
    } on ApiException catch (failure) {
      widget.shell.chooseTheme(before);
      _say(failure.message, error: true);
    }
  }

  Future<void> _save(Map<String, Object?> changes) async {
    _say('Saving…');
    try {
      await _c.savePreferences(changes);
      _say('Saved. Your preferences follow you to every device.');
    } on ApiException catch (failure) {
      _say(failure.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final starts = startPagesFor(widget.abilities.access, emailHub: widget.abilities.emailHub);
    return ListenableBuilder(
      listenable: _c,
      builder: (context, _) {
        final p = _c.preferences;
        final start = starts.any((s) => s.$1 == p.startPage) ? p.startPage : '';
        // A setting's name and hint read as one item, so "Light, Dark, System" that
        // follows has a name for someone using a screen reader.
        Widget label(String title, String hint) => Padding(
          padding: const EdgeInsets.only(bottom: Gap.s),
          child: MergeSemantics(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: theme.textTheme.titleSmall),
                Text(hint, style: muted),
              ],
            ),
          ),
        );
        return Scaffold(
          appBar: AppBar(title: const Text('Preferences')),
          body: ListView(
            padding: const EdgeInsets.all(Gap.l),
            children: [
              const SettingsIntro('How Dikho looks and behaves for you. Changes save as you make them.'),
              SettingsGroup(
                title: 'Appearance',
                children: [
                  label('Theme', 'Light, dark, or the same as your phone.'),
                  SegmentedButton<String>(
                    segments: [for (final (value, text) in themeChoices) ButtonSegment(value: value, label: Text(text))],
                    selected: {widget.shell.themeChoice ?? 'system'},
                    onSelectionChanged: (picked) => unawaited(_theme(picked.first)),
                  ),
                ],
              ),
              SettingsGroup(
                title: 'When you sign in',
                children: [
                  DropdownButtonFormField<String>(
                    key: ValueKey('start-$start'),
                    initialValue: start,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Start page', helperText: 'Where Dikho opens after you sign in.'),
                    items: [
                      const DropdownMenuItem(value: '', child: Text('The first page you can open')),
                      for (final (path, text) in starts) DropdownMenuItem(value: path, child: Text(text)),
                    ],
                    onChanged: (value) {
                      if (value != null && value != start) unawaited(_save({'start_page': value.isEmpty ? null : value}));
                    },
                  ),
                ],
              ),
              SettingsGroup(
                title: 'On a computer',
                description: 'These shape the tables of Dikho in a web browser. Lists in this app load more as you scroll.',
                children: [
                  label('Table density', 'Compact rows fit more clients, vendors and orders on the screen.'),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(value: 'comfortable', label: Text('Comfortable')),
                      ButtonSegment(value: 'compact', label: Text('Compact')),
                    ],
                    selected: {p.density},
                    onSelectionChanged: (picked) => unawaited(_save({'density': picked.first})),
                  ),
                  const SizedBox(height: Gap.l),
                  label('Rows per page', 'How many clients, vendors or orders a list shows before the next page.'),
                  SegmentedButton<int>(
                    segments: const [
                      ButtonSegment(value: 25, label: Text('25')),
                      ButtonSegment(value: 50, label: Text('50')),
                      ButtonSegment(value: 100, label: Text('100')),
                    ],
                    selected: {p.pageSize},
                    onSelectionChanged: (picked) => unawaited(_save({'page_size': picked.first})),
                  ),
                ],
              ),
              StatusText(text: _status, error: _error),
            ],
          ),
        );
      },
    );
  }
}

/* ── Sign-in and security ─────────────────────────────────────────────────── */

class SignInSettingsScreen extends StatefulWidget {
  const SignInSettingsScreen({super.key, required this.controller, required this.users, required this.access});

  final SettingsController controller;
  final UsersController users;
  final ShellAccess access;

  @override
  State<SignInSettingsScreen> createState() => _SignInSettingsScreenState();
}

class _SignInSettingsScreenState extends State<SignInSettingsScreen> {
  Member? _me;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final me = await widget.controller.me();
      if (mounted) {
        setState(() {
          _me = me;
          _error = null;
        });
      }
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final me = _me;
    const intro = SettingsIntro('The devices you are signed in on. End a session if you no longer use that device or do not recognise it.');
    final who = widget.access.email.isNotEmpty ? widget.access.email : widget.access.name;
    return Scaffold(
      appBar: AppBar(title: const Text('Sign-in and security')),
      body: me == null
          ? ListView(
              padding: const EdgeInsets.all(Gap.l),
              children: [
                intro,
                if (_error == null)
                  const LinearProgressIndicator()
                else ...[
                  StatusText(text: _error, error: true),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: OutlinedButton(onPressed: () => unawaited(_load()), child: const Text('Try again')),
                  ),
                ],
              ],
            )
          : SessionsList(
              controller: widget.users,
              member: me,
              isSelf: true,
              canEnd: true,
              onChanged: _load,
              header: const [intro],
              footer: [
                const SizedBox(height: Gap.l),
                Card.outlined(
                  child: Padding(
                    padding: const EdgeInsets.all(Gap.l),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Semantics(header: true, child: Text('What administrators can see', style: theme.textTheme.titleSmall)),
                        const SizedBox(height: Gap.s),
                        const Text(
                          'Administrators can see when you were last active, which part of Dikho you are using, and the '
                          'approximate city and device of each sign-in. They can also sign you out of a device. With Live '
                          'Assist, and only after you accept, someone helping you can see your Dikho screen and point at things. '
                          'You always see a banner while it is on and can stop it at any time; they cannot tap or type for '
                          'you, and nothing is recorded.',
                        ),
                      ],
                    ),
                  ),
                ),
                if (who.isNotEmpty) StatusText(text: 'Signed in as $who.'),
              ],
            ),
    );
  }
}
