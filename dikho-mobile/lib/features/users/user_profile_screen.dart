import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import '../live_assist/assist_protocol.dart' show staffRank;
import '../live_assist/live_assist_controller.dart';
import 'permission_editor.dart';
import 'user_forms.dart';
import 'users_admin_screens.dart';
import 'users_controller.dart';
import 'users_models.dart';
import 'users_screen.dart';

/// One person, as UserProfilePage.jsx shows them: who they are, their access, where
/// they are signed in, and what has been done to their account.
class UserProfileScreen extends StatefulWidget {
  const UserProfileScreen({
    super.key,
    required this.controller,
    required this.userId,
    required this.abilities,
    this.preview,
    this.startOnAccess = false,
    this.assist,
  });

  final UsersController controller;
  final String userId;
  final UsersAbilities abilities;

  /// Live Assist, for helping this person; null where it is not offered.
  final LiveAssistController? assist;

  /// Shown at once from the list while the full record loads.
  final Member? preview;
  final bool startOnAccess;

  @override
  State<UserProfileScreen> createState() => _UserProfileScreenState();
}

class _UserProfileScreenState extends State<UserProfileScreen> {
  late Member? _member = widget.preview;
  bool _full = false;
  String? _error;
  String? _notice;
  Timer? _presence;

  UsersController get _c => widget.controller;
  bool get _isSelf => widget.userId == widget.abilities.userId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    if (_c.catalog == null) unawaited(_c.loadCatalog().then((_) => mounted ? setState(() {}) : null));
    // "Online" follows the person coming and going while this is open.
    _presence = Timer.periodic(const Duration(seconds: 30), (_) => unawaited(_load(quiet: true)));
  }

  @override
  void dispose() {
    _presence?.cancel();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final m = await _c.member(widget.userId);
      if (!mounted) return;
      setState(() {
        _member = m;
        _full = true;
        _error = null;
      });
    } on ApiException catch (failure) {
      if (mounted && !quiet) setState(() => _error = failure.message);
    }
  }

  void _say(String text) => setState(() => _notice = text);

  /// Live Assist reaches colleagues at your own level too, not only those you manage,
  /// as canAssist on the web. The server checks again.
  bool _assistable(Member m) {
    final assist = widget.assist;
    if (assist == null || !assist.canHelp || _isSelf || m.status != 'active') return false;
    final rank = _c.catalog?.actor.rank;
    return rank == null || rank >= staffRank(m.role, m.developerLevel);
  }

  /// A sensitive change: said in plain words first, a reason asked for where useful,
  /// and the dialog stays open with the error if it is refused.
  Future<void> _confirm({
    required String title,
    required List<String> points,
    required String action,
    bool danger = true,
    bool askReason = false,
    required Future<void> Function(String reason) run,
  }) async {
    final done = await showDialog<bool>(
      context: context,
      builder: (_) => ConfirmChange(title: title, points: points, action: action, danger: danger, askReason: askReason, run: run),
    );
    if (done == true) await _load();
  }

  Future<void> _act(String which) async {
    final m = _member!;
    switch (which) {
      case 'welcome':
        try {
          final result = await _c.resendWelcome(m.userId);
          _say(result.sent ? 'Welcome message sent by ${result.channel == 'whatsapp' ? 'WhatsApp' : 'email'}.' : 'Not sent: ${result.reason}');
          await _load();
        } on ApiException catch (failure) {
          _say(failure.message);
        }
      case 'signout':
        await _confirm(
          title: 'Sign ${m.name} out everywhere?',
          points: const [
            'Every device they are signed in on is signed out immediately, including any open Dikho tab.',
            'They can sign in again with their usual code. To stop them signing in again, suspend them instead.',
          ],
          action: 'Sign out everywhere',
          run: (_) async {
            final ended = await _c.signOut(m.userId);
            _say('$ended session${ended == 1 ? '' : 's'} ended.');
          },
        );
      case 'suspend':
        await _confirm(
          title: 'Suspend ${m.name}?',
          points: const [
            'They are signed out of every device right away.',
            'They cannot sign in again until someone reactivates them.',
            'Their orders, records and history stay exactly as they are.',
          ],
          action: 'Suspend and sign out',
          askReason: true,
          run: (reason) async {
            final result = await _c.setStatus(m.userId, 'suspended', reason);
            if (!result.signInUpdated) {
              _say(
                'Suspended. Blocking new sign-ins in the sign-in service did not go through; Dikho refuses them anyway. Try again later to complete it.',
              );
            }
          },
        );
      case 'reactivate':
        await _confirm(
          title: 'Reactivate ${m.name}?',
          points: const ['They can sign in again and get the access their role, template and permissions give them.'],
          action: 'Reactivate',
          danger: false,
          run: (reason) => _c.setStatus(m.userId, 'active', reason),
        );
      case 'archive':
        await _confirm(
          title: 'Archive ${m.name}?',
          points: const [
            'Use this when someone has left the company.',
            'They are signed out and cannot sign in. They disappear from the user list unless you show archived users.',
            'Nothing is deleted: records they created still show their name, and the audit log keeps everything.',
          ],
          action: 'Archive',
          askReason: true,
          run: (reason) => _c.setStatus(m.userId, 'archived', reason),
        );
    }
  }

  Future<void> _edit() async {
    final catalog = _c.catalog;
    final m = _member;
    if (catalog == null || m == null) return;
    final saved = await Navigator.of(context).push<Member>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => EditProfileScreen(controller: _c, catalog: catalog, member: m),
      ),
    );
    if (saved != null && mounted) setState(() => _member = saved);
  }

  @override
  Widget build(BuildContext context) {
    final m = _member;
    if (m == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('User')),
        body: _error != null
            ? EmptyMessage(title: "Couldn't open this user", body: _error!, action: 'Try again', onAction: () => unawaited(_load()))
            : const Center(child: CircularProgressIndicator()),
      );
    }
    final a = widget.abilities;
    final manage = m.canManage;
    final tabs = [('Overview', 'overview'), ('Access', 'access'), if (m.hasSessions) ('Sessions', 'sessions'), if (a.audit) ('Activity', 'activity')];
    final actions = <(String, String)>[
      if (manage && m.status == 'invited' && a.create) ('welcome', 'Resend welcome'),
      if (manage && a.sessions && m.activeSessions > 0) ('signout', 'Sign out everywhere'),
      if (manage && a.suspend && (m.status == 'suspended' || m.status == 'archived')) ('reactivate', 'Reactivate'),
      if (manage && a.suspend && m.status != 'suspended' && m.status != 'archived') ('suspend', 'Suspend'),
      if (manage && a.suspend && m.status != 'archived') ('archive', 'Archive'),
    ];
    return DefaultTabController(
      length: tabs.length,
      initialIndex: widget.startOnAccess ? 1 : 0,
      child: Scaffold(
        appBar: AppBar(
          title: Text(m.name, overflow: TextOverflow.ellipsis),
          actions: [
            if (actions.isNotEmpty && _full)
              PopupMenuButton<String>(
                tooltip: 'Actions',
                onSelected: (which) => unawaited(_act(which)),
                itemBuilder: (_) => [for (final (value, label) in actions) PopupMenuItem(value: value, child: Text(label))],
              ),
          ],
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [for (final (label, _) in tabs) Tab(text: label)],
          ),
        ),
        body: TabBarView(
          children: [
            for (final (_, key) in tabs)
              switch (key) {
                'overview' => _Overview(
                  member: m,
                  now: _c.now(),
                  isSelf: _isSelf,
                  notice: _notice,
                  canEdit: manage && a.edit && _c.catalog != null,
                  onEdit: () => unawaited(_edit()),
                  assist: _assistable(m) ? widget.assist : null,
                  askingForHelp: widget.assist?.helpRequestFor(m.userId) != null,
                ),
                'access' =>
                  !_full
                      ? const Center(child: CircularProgressIndicator())
                      : _c.catalog == null
                      ? _OwnAccess(member: m)
                      : AccessTab(
                          controller: _c,
                          member: m,
                          catalog: _c.catalog!,
                          readOnly: !manage,
                          isSelf: _isSelf,
                          onSaved: (saved) => setState(() => _member = saved),
                        ),
                'sessions' => SessionsList(controller: _c, member: m, isSelf: _isSelf, canEnd: _isSelf || (manage && a.sessions), onChanged: _load),
                _ => AuditList(controller: _c, userId: m.userId),
              },
          ],
        ),
      ),
    );
  }
}

/// Said in plain words before a sensitive change, with a reason where useful.
class ConfirmChange extends StatefulWidget {
  const ConfirmChange({
    super.key,
    required this.title,
    required this.points,
    required this.action,
    required this.run,
    this.danger = true,
    this.askReason = false,
  });

  final String title;
  final List<String> points;
  final String action;
  final bool danger;
  final bool askReason;
  final Future<void> Function(String reason) run;

  @override
  State<ConfirmChange> createState() => _ConfirmChangeState();
}

class _ConfirmChangeState extends State<ConfirmChange> {
  final _reason = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _go() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.run(_reason.text.trim());
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final point in widget.points)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.s),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('•  '),
                    Expanded(child: Text(point)),
                  ],
                ),
              ),
            if (widget.askReason)
              TextField(
                controller: _reason,
                maxLength: 500,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(labelText: 'Reason (optional)'),
              ),
            if (_error != null) Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: const Text('Cancel')),
        FilledButton(
          style: widget.danger ? FilledButton.styleFrom(backgroundColor: theme.colorScheme.error, foregroundColor: theme.colorScheme.onError) : null,
          onPressed: _busy ? null : () => unawaited(_go()),
          child: Text(_busy ? 'Working…' : widget.action),
        ),
      ],
    );
  }
}

class _Overview extends StatelessWidget {
  const _Overview({
    required this.member,
    required this.now,
    required this.isSelf,
    required this.notice,
    required this.canEdit,
    required this.onEdit,
    this.assist,
    this.askingForHelp = false,
  });

  final Member member;
  final DateTime now;
  final bool isSelf;
  final String? notice;
  final bool canEdit;
  final VoidCallback onEdit;

  /// Set when Live Assist is offered with this person.
  final LiveAssistController? assist;
  final bool askingForHelp;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final m = member;
    final muted = TextStyle(color: theme.colorScheme.onSurfaceVariant);
    return ListView(
      padding: const EdgeInsets.all(Gap.l),
      children: [
        Row(
          children: [
            MemberAvatar(member: m, size: 56),
            const SizedBox(width: Gap.m),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(isSelf ? '${m.name} (you)' : m.name, style: theme.textTheme.titleLarge),
                  const SizedBox(height: Gap.xs),
                  Wrap(
                    spacing: Gap.s,
                    runSpacing: Gap.xs,
                    children: [
                      Pill(label: m.roleLabel, tone: m.isAdminOrOwner ? PillTone.pending : PillTone.neutral),
                      if (m.developerLabel != null) Pill(label: m.developerLabel!),
                      Pill(label: m.statusLabel, tone: statusTone(m.status)),
                    ],
                  ),
                  const SizedBox(height: Gap.xs),
                  Text(m.activity(now), style: muted),
                  if (askingForHelp) ...[const SizedBox(height: Gap.xs), const Pill(label: 'Asking for help', tone: PillTone.pending)],
                ],
              ),
            ),
          ],
        ),
        if (assist != null)
          ListenableBuilder(
            listenable: assist!,
            builder: (context, _) {
              final c = assist!;
              final note = c.busy
                  ? 'Finish your current Live Assist session first.'
                  : m.online
                  ? "See ${m.name}'s Dikho screen, with their OK, and point at things."
                  : '${m.name} is not online right now.';
              return Padding(
                padding: const EdgeInsets.only(top: Gap.m),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    FilledButton.icon(
                      onPressed: !m.online || c.busy
                          ? null
                          : () => unawaited(c.startAssist(m.userId, m.name, helpRequestId: c.helpRequestFor(m.userId)?.id)),
                      icon: const Icon(Icons.screen_share_outlined),
                      label: const Text('Live Assist'),
                    ),
                    Text(note, style: muted),
                  ],
                ),
              );
            },
          ),
        if (notice != null) ...[const SizedBox(height: Gap.m), Semantics(liveRegion: true, child: Text(notice!))],
        if (!m.canManage && !isSelf) ...[
          const SizedBox(height: Gap.m),
          Text('You can view ${m.name}, but their role is at or above yours, so only someone higher can change their access.', style: muted),
        ],
        const SizedBox(height: Gap.l),
        if (m.status == 'suspended' || m.status == 'archived')
          Container(
            margin: const EdgeInsets.only(bottom: Gap.l),
            padding: const EdgeInsets.all(Gap.m),
            decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
            child: Text(
              '${m.status == 'archived' ? 'Archived' : 'Suspended'} ${relativeTime(m.statusChangedAt, now) ?? ''}. ${m.statusReason.isEmpty ? 'No reason was given.' : m.statusReason}',
              style: TextStyle(color: theme.colorScheme.onErrorContainer),
            ),
          ),
        DetailsCard(
          title: 'Contact and sign-in',
          rows: [
            ('Email', m.email),
            ('WhatsApp number', m.phone.isEmpty ? '' : '+${m.phone}'),
            ('Last sign-in', m.lastSignInAt.isEmpty ? 'Never signed in' : dateTime(m.lastSignInAt)),
            (
              'Welcome message',
              m.welcomeSentAt.isEmpty
                  ? 'Not sent'
                  : 'Sent by ${m.welcomeChannel == 'whatsapp' ? 'WhatsApp' : 'email'}, ${relativeTime(m.welcomeSentAt, now)}',
            ),
            ('Added', dateOnly(m.createdAt)),
          ],
        ),
        DetailsCard(
          title: 'Organisation',
          rows: [
            ('Employee ID', m.employeeId),
            ('Designation', m.designation),
            ('Department', m.department),
            ('Team', m.team),
            ('Reporting manager', m.reportingManager),
            ('Joining date', dateOnly(m.joiningDate)),
          ],
        ),
        if (canEdit)
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(onPressed: onEdit, icon: const Icon(Icons.edit_outlined), label: const Text('Edit details')),
          ),
      ],
    );
  }
}

/// For someone looking at their own profile without users.view: what they can do,
/// without the editor.
class _OwnAccess extends StatelessWidget {
  const _OwnAccess({required this.member});

  final Member member;

  @override
  Widget build(BuildContext context) {
    final keys = member.permissions.keys.toList()..sort();
    return ListView(
      padding: const EdgeInsets.all(Gap.l),
      children: [
        Text('What you can do in Dikho', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: Gap.s),
        Text('Role: ${member.roleLabel}${member.template.isEmpty ? '' : ' · Template: ${member.template}'}'),
        const SizedBox(height: Gap.m),
        for (final key in keys)
          ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text(key), trailing: Text('${member.permissions[key]?['scope'] ?? ''}')),
      ],
    );
  }
}

/// Role, template, developer access and this person's own changes, saved together.
class AccessTab extends StatefulWidget {
  const AccessTab({
    super.key,
    required this.controller,
    required this.member,
    required this.catalog,
    required this.readOnly,
    required this.isSelf,
    required this.onSaved,
  });

  final UsersController controller;
  final Member member;
  final Catalog catalog;
  final bool readOnly;
  final bool isSelf;
  final ValueChanged<Member> onSaved;

  @override
  State<AccessTab> createState() => _AccessTabState();
}

class _AccessTabState extends State<AccessTab> {
  late String _role;
  late String _dev;
  late String _template;
  late Map<String, Map<String, String>> _overrides;
  String _saved = '';
  bool _saving = false;
  String? _error;

  Member get _m => widget.member;

  String _savedOf(Member m) => '${m.role}|${m.developerLevel}|${m.templateId}|${m.overrides}';

  void _reset() {
    _role = _m.role;
    _dev = _m.developerLevel;
    _template = _m.templateId;
    _overrides = _m.overrides;
    _saved = _savedOf(_m);
    _error = null;
  }

  @override
  void initState() {
    super.initState();
    _reset();
  }

  /// Presence refreshes every 30 seconds; an edit in progress survives them, and only
  /// a change to the saved access resets the form.
  @override
  void didUpdateWidget(AccessTab old) {
    super.didUpdateWidget(old);
    if (_savedOf(_m) != _saved) _reset();
  }

  bool get _superuser => _role == 'owner' || _dev.isNotEmpty;
  bool get _roleChanged => _role != _m.role;
  bool get _devChanged => _dev != _m.developerLevel;
  bool get _templateChanged => _template != _m.templateId;
  bool get _overridesChanged => !sameOverrides(_overrides, _m.overrides);
  bool get _dirty => _roleChanged || _devChanged || _templateChanged || _overridesChanged;

  Map<String, Map<String, dynamic>> get _effective {
    if (!_roleChanged && !_devChanged) return _m.permissions;
    return {
      for (final p in widget.catalog.permissions)
        if (_dev.isNotEmpty || !p.developerOnly) p.key: {'scope': 'all', 'source': _dev.isNotEmpty ? 'developer' : 'owner'},
    };
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      var next = _m;
      final patch = <String, Object?>{
        if (_roleChanged) 'system_role': _role,
        if (_devChanged) 'developer_level': _dev.isEmpty ? null : _dev,
        if (_templateChanged) 'template_id': _template.isEmpty ? null : _template,
      };
      if (patch.isNotEmpty) next = await widget.controller.update(_m.userId, patch);
      if (_overridesChanged && !_superuser) next = await widget.controller.setOverrides(_m.userId, _overrides);
      widget.onSaved(next);
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Crossing the Admin line, or developer access, is asked about first.
  Future<void> _requestSave() async {
    final crossesAdmin = _roleChanged && const ['admin', 'owner'].any((r) => r == _role || r == _m.role);
    if (!crossesAdmin && !_devChanged) return _save();
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text("Change ${_m.name}'s access level?"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_roleChanged) Text('System role: ${roleLabels[_m.role]} → ${roleLabels[_role]}'),
            if (_devChanged) Text('Developer access: ${developerLabels[_m.developerLevel] ?? 'None'} → ${developerLabels[_dev] ?? 'None'}'),
            if (_role == 'owner' || _dev.isNotEmpty) ...[
              const SizedBox(height: Gap.s),
              Text(
                _role == 'owner'
                    ? 'Owners can use everything and manage everyone.'
                    : 'Developers can use everything and manage everyone except Owners.',
              ),
            ],
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Change access')),
        ],
      ),
    );
    if (ok == true) await _save();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = widget.catalog;
    final roles = c.assignableRoles();
    final readOnly = widget.readOnly;
    final muted = TextStyle(color: theme.colorScheme.onSurfaceVariant);
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(Gap.l),
            children: [
              if (readOnly)
                Padding(
                  padding: const EdgeInsets.only(bottom: Gap.m),
                  child: Text(
                    widget.isSelf ? "You can't change your own access. Ask another administrator." : "You can't change this person's access.",
                    style: muted,
                  ),
                ),
              DropdownButtonFormField<String>(
                initialValue: _role,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'System role'),
                items: [
                  for (final r in roleLabels.keys)
                    DropdownMenuItem(value: r, enabled: r == _m.role || roles.contains(r), child: Text(roleLabels[r]!)),
                ],
                onChanged: readOnly ? null : (v) => setState(() => _role = v ?? _role),
              ),
              const SizedBox(height: Gap.m),
              DropdownButtonFormField<String>(
                initialValue: _template,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Permission template'),
                items: [
                  const DropdownMenuItem(value: '', child: Text('Custom (no template)')),
                  for (final t in c.templates)
                    DropdownMenuItem(
                      value: t.id,
                      enabled: t.id == _m.templateId || c.withinReach(t),
                      child: Text(
                        '${t.name}${t.id == _m.templateId || c.withinReach(t) ? '' : ' (beyond your access)'}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: readOnly || _superuser ? null : (v) => setState(() => _template = v ?? ''),
              ),
              if (c.actor.role == 'owner' || _m.developerLevel.isNotEmpty) ...[
                const SizedBox(height: Gap.m),
                DropdownButtonFormField<String>(
                  initialValue: _dev,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Developer access'),
                  items: [
                    const DropdownMenuItem(value: '', child: Text('None')),
                    for (final entry in developerLabels.entries) DropdownMenuItem(value: entry.key, child: Text(entry.value)),
                  ],
                  onChanged: readOnly || c.actor.role != 'owner' ? null : (v) => setState(() => _dev = v ?? ''),
                ),
              ],
              const SizedBox(height: Gap.m),
              if (_superuser)
                Padding(
                  padding: const EdgeInsets.only(bottom: Gap.m),
                  child: Text(
                    _dev.isNotEmpty
                        ? 'Developers hold every permission, including developer tools, and are not limited by templates or individual changes.'
                        : 'Owners hold every business permission and are not limited by templates or individual changes.',
                    style: muted,
                  ),
                ),
              PermissionEditor.user(
                catalog: c,
                inherited: c.inherited(_template, _role),
                overrides: _overrides,
                onOverrides: (next) => setState(() => _overrides = next),
                readOnly: readOnly,
                superuser: _superuser,
                effective: _effective,
              ),
              if (_error != null) Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
            ],
          ),
        ),
        if (!readOnly && _dirty)
          Material(
            elevation: 3,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.s),
                child: Row(
                  children: [
                    const Expanded(child: Text('Unsaved changes to their access.')),
                    TextButton(onPressed: _saving ? null : () => setState(_reset), child: const Text('Discard')),
                    const SizedBox(width: Gap.s),
                    FilledButton(onPressed: _saving ? null : () => unawaited(_requestSave()), child: Text(_saving ? 'Saving…' : 'Save')),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Where someone is signed in, and their recent sign-ins. Settings shows your own,
/// with its own words above and below ([header], [footer]).
class SessionsList extends StatefulWidget {
  const SessionsList({
    super.key,
    required this.controller,
    required this.member,
    required this.isSelf,
    required this.canEnd,
    required this.onChanged,
    this.header = const [],
    this.footer = const [],
  });

  final UsersController controller;
  final Member member;
  final bool isSelf;
  final bool canEnd;
  final Future<void> Function() onChanged;
  final List<Widget> header;
  final List<Widget> footer;

  @override
  State<SessionsList> createState() => _SessionsListState();
}

class _SessionsListState extends State<SessionsList> {
  String? _busy;
  String? _error;

  Future<void> _end(String sessionId) async {
    setState(() {
      _busy = sessionId;
      _error = null;
    });
    try {
      await widget.controller.signOut(widget.member.userId, sessionId: sessionId);
      await widget.onChanged();
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final now = widget.controller.now();
    final sessions = widget.member.sessions;
    final recent = widget.member.recentSignIns;
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    return ListView(
      padding: const EdgeInsets.all(Gap.l),
      children: [
        ...widget.header,
        Text('Signed in now · ${sessions.length} device${sessions.length == 1 ? '' : 's'}', style: theme.textTheme.titleSmall),
        const SizedBox(height: Gap.s),
        if (sessions.isEmpty) Text('Not signed in on any device.', style: muted),
        for (final s in sessions)
          Card.outlined(
            margin: const EdgeInsets.only(bottom: Gap.s),
            child: Padding(
              padding: const EdgeInsets.all(Gap.m),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(isPhoneDevice('${s['user_agent'] ?? ''}') ? Icons.smartphone : Icons.computer, color: theme.colorScheme.onSurfaceVariant),
                  const SizedBox(width: Gap.m),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${deviceLabel('${s['user_agent'] ?? ''}')}${s['current'] == true ? ' · This device' : ''}',
                          style: const TextStyle(fontWeight: FontWeight.w500),
                        ),
                        Text(
                          [
                            locationLabel(s) == null ? 'Location unknown' : 'Near ${locationLabel(s)}',
                            if ('${s['ip'] ?? ''}'.isNotEmpty) '${s['ip']}',
                          ].join(' · '),
                          style: muted,
                        ),
                        Text(
                          'Signed in ${dateTime('${s['signed_in_at'] ?? ''}')} · Active ${relativeTime('${s['last_seen_at'] ?? ''}', now) ?? 'unknown'}'
                          '${sectionLabel('${s['section'] ?? ''}') == null ? '' : ' in ${sectionLabel('${s['section']}')}'}',
                          style: muted,
                        ),
                        if (widget.canEnd && s['current'] != true)
                          Align(
                            alignment: Alignment.centerLeft,
                            child: OutlinedButton(
                              onPressed: _busy == s['session_id'] ? null : () => unawaited(_end('${s['session_id']}')),
                              child: Text(_busy == s['session_id'] ? 'Ending…' : 'End session'),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        if (_error != null) Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
        Text(
          'Locations are estimated from the internet connection and can be wrong by a city or more, especially on mobile data or a VPN.'
          '${widget.isSelf ? ' Ending a session signs that device out immediately.' : ''}',
          style: muted,
        ),
        const SizedBox(height: Gap.l),
        Text('Recent sign-ins', style: theme.textTheme.titleSmall),
        const SizedBox(height: Gap.s),
        if (recent.isEmpty) Text('No sign-ins recorded yet.', style: muted),
        for (final r in recent)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('${dateTime('${r['signed_in_at'] ?? ''}')} · ${deviceLabel('${r['user_agent'] ?? ''}')}'),
            subtitle: Text(
              [
                locationLabel(r) ?? 'Location unknown',
                switch ('${r['ended_at'] ?? ''}') {
                  '' => 'Still open or expired',
                  final ended =>
                    'Ended ${relativeTime(ended, now) ?? ''}${switch (r['ended_reason']) {
                      'forced' => ' (signed out by an admin)',
                      'suspended' => ' (suspended)',
                      'archived' => ' (archived)',
                      _ => '',
                    }}',
                },
              ].join(' · '),
            ),
          ),
        ...widget.footer,
      ],
    );
  }
}
