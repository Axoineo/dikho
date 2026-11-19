import 'dart:async';

import 'package:flutter/foundation.dart' show mapEquals;
import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import 'permission_editor.dart';
import 'user_profile_screen.dart' show ConfirmChange;
import 'users_controller.dart';
import 'users_models.dart';

/// Reusable starting points for people's access (TemplatesTab.jsx). Built-in ones
/// are kept as shipped (duplicate one to change it); custom ones can be edited and,
/// once nobody uses them, deleted. A change reaches everyone on the template.
class TemplatesScreen extends StatelessWidget {
  const TemplatesScreen({super.key, required this.controller, required this.canManage});

  final UsersController controller;
  final bool canManage;

  Future<void> _open(BuildContext context, {Template? template, Template? copyOf}) => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => TemplateScreen(controller: controller, canManage: canManage, template: template, copyOf: copyOf),
    ),
  );

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final catalog = controller.catalog;
      return Scaffold(
        appBar: AppBar(title: const Text('Permission templates')),
        floatingActionButton: canManage && catalog != null
            ? FloatingActionButton.extended(
                onPressed: () => unawaited(_open(context)),
                icon: const Icon(Icons.add),
                label: const Text('New template'),
              )
            : null,
        body: catalog == null
            ? (controller.catalogError != null
                  ? EmptyMessage(
                      title: "Couldn't load templates",
                      body: controller.catalogError!,
                      action: 'Try again',
                      onAction: () => unawaited(controller.loadCatalog()),
                    )
                  : const Center(child: CircularProgressIndicator()))
            : ListView(
                padding: const EdgeInsets.only(bottom: 88),
                children: [
                  for (final t in catalog.templates)
                    ListTile(
                      title: Text(t.name),
                      subtitle: Text('${t.members} ${t.members == 1 ? 'person' : 'people'}${t.builtIn ? ' · Built-in' : ''}'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => unawaited(_open(context, template: t)),
                    ),
                ],
              ),
      );
    },
  );
}

class TemplateScreen extends StatefulWidget {
  const TemplateScreen({super.key, required this.controller, required this.canManage, this.template, this.copyOf});

  final UsersController controller;
  final bool canManage;

  /// The saved template; null for a new one, which may start as a copy of [copyOf].
  final Template? template;
  final Template? copyOf;

  @override
  State<TemplateScreen> createState() => _TemplateScreenState();
}

class _TemplateScreenState extends State<TemplateScreen> {
  late final _name = TextEditingController(text: widget.template?.name ?? (widget.copyOf == null ? '' : '${widget.copyOf!.name} (copy)'));
  late final _description = TextEditingController(text: widget.template?.description ?? widget.copyOf?.description ?? '');
  late Map<String, String> _permissions = {...?widget.template?.permissions, ...?widget.copyOf?.permissions};
  bool _saving = false;
  String? _error;

  Template? get _t => widget.template;
  bool get _editable => widget.canManage && (_t == null || !_t!.builtIn);
  bool get _dirty => _t == null || _name.text != _t!.name || _description.text != _t!.description || !mapEquals(_permissions, _t!.permissions);

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.controller.saveTemplate(id: _t?.id, name: _name.text, description: _description.text, permissions: _permissions);
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _delete() async {
    final done = await showDialog<bool>(
      context: context,
      builder: (_) => ConfirmChange(
        title: 'Delete the ${_t!.name} template?',
        points: const ["Nobody uses it, so no one's access changes. This is recorded in the audit log."],
        action: 'Delete template',
        run: (_) => widget.controller.deleteTemplate(_t!.id),
      ),
    );
    if (done == true && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final catalog = widget.controller.catalog!;
    final muted = TextStyle(color: theme.colorScheme.onSurfaceVariant);
    final t = _t;
    return Scaffold(
      appBar: AppBar(
        title: Text(t?.name ?? 'New template', overflow: TextOverflow.ellipsis),
        actions: [
          if (widget.canManage && t != null)
            PopupMenuButton<String>(
              tooltip: 'Actions',
              onSelected: (which) {
                if (which == 'duplicate') {
                  unawaited(
                    Navigator.of(context).pushReplacement(
                      MaterialPageRoute<void>(
                        builder: (_) => TemplateScreen(controller: widget.controller, canManage: widget.canManage, copyOf: t),
                      ),
                    ),
                  );
                } else {
                  unawaited(_delete());
                }
              },
              itemBuilder: (_) => [
                const PopupMenuItem(value: 'duplicate', child: Text('Duplicate')),
                if (!t.builtIn)
                  PopupMenuItem(
                    value: 'delete',
                    enabled: t.members == 0,
                    child: Text(t.members == 0 ? 'Delete' : 'Delete (move everyone off it first)'),
                  ),
              ],
            ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(Gap.l),
              children: [
                if (_editable) ...[
                  TextField(
                    controller: _name,
                    maxLength: 80,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(labelText: 'Name *', counterText: ''),
                  ),
                  const SizedBox(height: Gap.m),
                  TextField(
                    controller: _description,
                    maxLength: 300,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(labelText: 'Description', counterText: ''),
                  ),
                  const SizedBox(height: Gap.m),
                ] else if ((t?.description ?? '').isNotEmpty) ...[
                  Text(t!.description, style: muted),
                  const SizedBox(height: Gap.m),
                ],
                if (t?.builtIn == true)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Gap.m),
                    child: Text('Built-in template. Duplicate it to make a version you can change.', style: muted),
                  ),
                if (_editable && (t?.members ?? 0) > 0)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Gap.m),
                    child: Text(
                      'Saving changes the access of the ${t!.members} ${t.members == 1 ? 'person' : 'people'} on this template straight away.',
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  ),
                PermissionEditor.template(
                  catalog: catalog,
                  templatePermissions: _permissions,
                  onTemplate: (next) => setState(() => _permissions = next),
                  readOnly: !_editable,
                ),
                if (_error != null) Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
              ],
            ),
          ),
          if (_editable && _dirty)
            Material(
              elevation: 3,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.s),
                  child: Row(
                    children: [
                      Expanded(child: Text(t == null ? 'New template, not saved yet.' : 'Unsaved changes to this template.')),
                      FilledButton(
                        onPressed: _saving || _name.text.trim().isEmpty ? null : () => unawaited(_save()),
                        child: Text(_saving ? 'Saving…' : 'Save'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Departments and their teams (DepartmentsTab.jsx). Nothing is deleted: archiving
/// hides a unit from new assignments while the people already in it keep it.
class DepartmentsScreen extends StatefulWidget {
  const DepartmentsScreen({super.key, required this.controller, required this.canManage});

  final UsersController controller;
  final bool canManage;

  @override
  State<DepartmentsScreen> createState() => _DepartmentsScreenState();
}

class _DepartmentsScreenState extends State<DepartmentsScreen> {
  bool _showArchived = false;

  UsersController get _c => widget.controller;

  Future<void> _run(Future<void> Function() change) async {
    try {
      await change();
    } on ApiException catch (failure) {
      if (mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(failure.message)));
    }
  }

  /// A name, typed in a dialog; null when cancelled.
  Future<String?> _askName(String title, {String initial = ''}) => showDialog<String>(
    context: context,
    builder: (dialogContext) {
      final field = TextEditingController(text: initial);
      return AlertDialog(
        title: Text(title),
        content: TextField(
          controller: field,
          autofocus: true,
          maxLength: 80,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(labelText: 'Name', counterText: ''),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(field.text.trim()), child: const Text('Save')),
        ],
      );
    },
  );

  Future<void> _addDepartment() async {
    final name = await _askName('Add department');
    if (name == null || name.isEmpty) return;
    await _run(() => _c.saveOrgUnit(kind: 'department', name: name));
  }

  Future<void> _departmentAction(Department d, String which) async {
    switch (which) {
      case 'team':
        final name = await _askName('Add a team to ${d.name}');
        if (name != null && name.isNotEmpty) await _run(() => _c.saveOrgUnit(kind: 'team', departmentId: d.id, name: name));
      case 'rename':
        final name = await _askName('Rename department', initial: d.name);
        if (name != null && name.isNotEmpty) await _run(() => _c.saveOrgUnit(kind: 'department', id: d.id, name: name));
      case 'archive':
        await _run(() => _c.saveOrgUnit(kind: 'department', id: d.id, name: d.name, archived: !d.archived));
    }
  }

  Future<void> _teamAction(OrgTeam t, String which) async {
    if (which == 'rename') {
      final name = await _askName('Rename team', initial: t.name);
      if (name != null && name.isNotEmpty) await _run(() => _c.saveOrgUnit(kind: 'team', id: t.id, name: name));
    } else {
      await _run(() => _c.saveOrgUnit(kind: 'team', id: t.id, name: t.name, archived: !t.archived));
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final theme = Theme.of(context);
      final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
      final departments = (_c.catalog?.departments ?? const <Department>[]).where((d) => _showArchived || !d.archived).toList();
      return Scaffold(
        appBar: AppBar(title: const Text('Departments and teams')),
        floatingActionButton: widget.canManage
            ? FloatingActionButton.extended(
                onPressed: () => unawaited(_addDepartment()),
                icon: const Icon(Icons.add),
                label: const Text('Add department'),
              )
            : null,
        body: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, 96),
          children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Show archived'),
              value: _showArchived,
              onChanged: (v) => setState(() => _showArchived = v),
            ),
            if (departments.isEmpty) Text('No departments yet.', style: muted),
            for (final d in departments)
              Card.outlined(
                margin: const EdgeInsets.only(bottom: Gap.m),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(Gap.m, Gap.xs, Gap.xs, Gap.s),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${d.name}${d.archived ? ' (archived)' : ''} · ${d.members} ${d.members == 1 ? 'person' : 'people'}',
                              style: theme.textTheme.titleSmall,
                            ),
                          ),
                          if (widget.canManage)
                            PopupMenuButton<String>(
                              tooltip: 'Change ${d.name}',
                              onSelected: (which) => unawaited(_departmentAction(d, which)),
                              itemBuilder: (_) => [
                                const PopupMenuItem(value: 'team', child: Text('Add a team')),
                                const PopupMenuItem(value: 'rename', child: Text('Rename')),
                                PopupMenuItem(value: 'archive', child: Text(d.archived ? 'Restore' : 'Archive')),
                              ],
                            ),
                        ],
                      ),
                      if (d.teams.where((t) => _showArchived || !t.archived).isEmpty) Text('No teams', style: muted),
                      for (final t in d.teams.where((t) => _showArchived || !t.archived))
                        Row(
                          children: [
                            Expanded(child: Text('${t.name}${t.archived ? ' (archived)' : ''}')),
                            Text('${t.members}', style: muted),
                            if (widget.canManage)
                              PopupMenuButton<String>(
                                tooltip: 'Change ${t.name}',
                                onSelected: (which) => unawaited(_teamAction(t, which)),
                                itemBuilder: (_) => [
                                  const PopupMenuItem(value: 'rename', child: Text('Rename')),
                                  PopupMenuItem(value: 'archive', child: Text(t.archived ? 'Restore' : 'Archive')),
                                ],
                              )
                            else
                              const SizedBox(width: Gap.l),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      );
    },
  );
}

class AuditScreen extends StatelessWidget {
  const AuditScreen({super.key, required this.controller});

  final UsersController controller;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Audit log')),
    body: AuditList(controller: controller),
  );
}

/// Who changed whose access, when, and from where, newest first, by day. Read-only by
/// design: the log is append-only in the database.
class AuditList extends StatefulWidget {
  const AuditList({super.key, required this.controller, this.userId});

  final UsersController controller;

  /// One person's history; null for everyone's.
  final String? userId;

  @override
  State<AuditList> createState() => _AuditListState();
}

class _AuditListState extends State<AuditList> {
  List<AuditEvent>? _events;
  bool _more = true;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load({String? before}) async {
    setState(() => _loading = true);
    try {
      final page = await widget.controller.audit(user: widget.userId, before: before);
      if (!mounted) return;
      setState(() {
        _events = before == null ? page : [...?_events, ...page];
        _more = page.length == 50;
        _error = null;
      });
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  static const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final events = _events;
    if (events == null) {
      return _error != null
          ? EmptyMessage(title: "Couldn't load the audit log", body: _error!, action: 'Try again', onAction: () => unawaited(_load()))
          : const Center(child: CircularProgressIndicator());
    }
    if (events.isEmpty) return const EmptyMessage(title: 'Nothing recorded yet', body: 'Changes to people and their access show here.');
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final children = <Widget>[];
    String? day;
    for (final e in events) {
      final at = DateTime.tryParse(e.occurredAt)?.toLocal();
      final thisDay = at == null ? '' : '${_weekdays[at.weekday - 1]}, ${dateOnly(e.occurredAt)}';
      if (thisDay != day) {
        day = thisDay;
        children.add(
          Padding(
            padding: const EdgeInsets.only(top: Gap.m, bottom: Gap.s),
            child: Semantics(
              header: true,
              child: Text(thisDay, style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            ),
          ),
        );
      }
      final details = e.details(widget.controller.catalog);
      final time = at == null ? '' : '${at.hour % 12 == 0 ? 12 : at.hour % 12}:${at.minute.toString().padLeft(2, '0')} ${at.hour < 12 ? 'am' : 'pm'}';
      children.add(
        MergeSemantics(
          child: Padding(
            padding: const EdgeInsets.only(bottom: Gap.m),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 72, child: Text(time, style: muted)),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(e.sentence, style: e.type == 'access.denied' ? TextStyle(color: theme.colorScheme.error) : null),
                      for (final line in details) Text(line, style: muted),
                      if (e.ip.isNotEmpty) Text('From ${e.ip}', style: muted),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
    if (_more) {
      children.add(
        Center(
          child: OutlinedButton(
            onPressed: _loading ? null : () => unawaited(_load(before: events.last.id)),
            child: Text(_loading ? 'Loading…' : 'Show older'),
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.xl), children: children),
    );
  }
}
