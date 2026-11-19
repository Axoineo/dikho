import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../inbox/chat_theme.dart';
import '../sales_orders/order_parts.dart' show OrderDateField;
import '../sales_orders/sales_orders_models.dart' show todayIso;
import 'users_controller.dart';
import 'users_models.dart';

class AddedUser {
  const AddedUser(this.member, {required this.customize});

  final Member member;

  /// Open their permissions straight away.
  final bool customize;
}

Future<String?> _pickDay(BuildContext context, String current) async {
  final now = DateTime.now();
  final picked = await showDatePicker(
    context: context,
    initialDate: DateTime.tryParse(current) ?? now,
    firstDate: DateTime(1990),
    lastDate: DateTime(now.year + 2, 12, 31),
  );
  return picked == null ? null : todayIso(picked);
}

Widget _section(BuildContext context, String title) => Padding(
  padding: const EdgeInsets.only(top: Gap.s, bottom: Gap.m),
  child: Semantics(
    header: true,
    child: Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Theme.of(context).colorScheme.primary)),
  ),
);

Widget _dropdown(String label, String value, List<(String, String, bool)> items, ValueChanged<String>? onChanged, {String? helper}) {
  final options = [...items];
  if (!options.any((o) => o.$1 == value)) options.add((value, value, true));
  return Padding(
    padding: const EdgeInsets.only(bottom: Gap.m),
    child: DropdownButtonFormField<String>(
      key: ValueKey('$label-$value-${options.length}'),
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label, helperText: helper, helperMaxLines: 3),
      items: [
        for (final (v, text, enabled) in options)
          DropdownMenuItem(
            value: v,
            enabled: enabled,
            child: Text(text, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: onChanged == null ? null : (v) => onChanged(v ?? ''),
    ),
  );
}

/// Adding someone, as AddUserModal.jsx does: they sign in with a code sent to their
/// email or WhatsApp number, so one of the two is needed, and there is no password.
class AddUserScreen extends StatefulWidget {
  const AddUserScreen({super.key, required this.controller, required this.catalog});

  final UsersController controller;
  final Catalog catalog;

  @override
  State<AddUserScreen> createState() => _AddUserScreenState();
}

class _AddUserScreenState extends State<AddUserScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _employeeId = TextEditingController();
  final _designation = TextEditingController();
  String _department = '';
  String _team = '';
  String _manager = '';
  String _joined = '';
  String _role = 'staff';
  String _dev = '';
  late String _template;
  bool _customize = false;
  bool _sendWelcome = true;
  bool _saving = false;
  String? _error;
  String? _nameError;

  Catalog get _c => widget.catalog;

  @override
  void initState() {
    super.initState();
    _template = _c.templates.where((t) => t.key == 'sales_executive' && _c.withinReach(t)).firstOrNull?.id ?? '';
    if (widget.controller.members == null) unawaited(widget.controller.load().then((_) => mounted ? setState(() {}) : null));
  }

  @override
  void dispose() {
    for (final field in [_name, _email, _phone, _employeeId, _designation]) {
      field.dispose();
    }
    super.dispose();
  }

  bool get _touched => [_name, _email, _phone, _employeeId, _designation].any((f) => f.text.trim().isNotEmpty);

  Future<void> _submit() async {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _error = null;
      _nameError = _name.text.trim().isEmpty ? 'Enter their name.' : null;
    });
    if (_nameError != null) return;
    if (_email.text.trim().isEmpty && _phone.text.trim().isEmpty) {
      setState(() => _error = 'Enter an email address or a WhatsApp number. That is how they will sign in.');
      return;
    }
    final body = <String, Object?>{
      'send_welcome': _sendWelcome,
      for (final (key, value) in [
        ('full_name', _name.text.trim()),
        ('email', _email.text.trim()),
        ('phone', _phone.text.trim()),
        ('employee_id', _employeeId.text.trim()),
        ('designation', _designation.text.trim()),
        ('department_id', _department),
        ('team_id', _team),
        ('reporting_manager_id', _manager),
        ('joining_date', _joined),
        ('template_id', _template),
        if (_role != 'staff') ('system_role', _role),
        if (_dev.isNotEmpty) ('developer_level', _dev),
      ])
        if (value.isNotEmpty) key: value,
    };
    setState(() => _saving = true);
    try {
      final added = await widget.controller.create(body);
      if (!mounted) return;
      final notes = [
        if (added.reused) 'This email or number already had a sign-in account, so it was linked instead of creating a second one.',
        if (_sendWelcome && !added.welcomeSent)
          'The welcome message was not sent: ${added.welcomeReason ?? 'unknown reason'} They can still sign in with their ${added.member.email.isNotEmpty ? 'email' : 'WhatsApp number'}; you can resend it from their profile.',
      ];
      if (notes.isNotEmpty) {
        await showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: Text('${added.member.name} has been added'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final note in notes)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Gap.s),
                    child: Text(note),
                  ),
              ],
            ),
            actions: [FilledButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Done'))],
          ),
        );
      }
      if (mounted) Navigator.of(context).pop(AddedUser(added.member, customize: _customize));
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _leave() async {
    if (!_touched) {
      Navigator.of(context).pop();
      return;
    }
    final discard = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Discard this person?'),
        content: const Text('What you typed here has not been saved.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Keep editing')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Discard')),
        ],
      ),
    );
    if (discard == true && mounted) Navigator.of(context).pop();
  }

  Widget _text(
    TextEditingController controller,
    String label, {
    TextInputType? keyboard,
    String? error,
    String? helper,
    int max = 120,
    TextCapitalization caps = TextCapitalization.none,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: Gap.m),
    child: TextField(
      controller: controller,
      keyboardType: keyboard,
      textCapitalization: caps,
      maxLength: max,
      onChanged: (_) => setState(() {}),
      decoration: InputDecoration(labelText: label, errorText: error, helperText: helper, helperMaxLines: 3, counterText: ''),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final roles = _c.assignableRoles();
    final department = _c.department(_department);
    final teams = (department?.teams ?? const <OrgTeam>[]).where((t) => !t.archived).toList();
    final managers = (widget.controller.members ?? const <Member>[]).where((m) => m.status == 'active' || m.status == 'invited').toList();
    final welcomeBy = _email.text.trim().isNotEmpty ? ' by email' : (_phone.text.trim().isNotEmpty ? ' by WhatsApp' : '');
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && !_saving) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Close', onPressed: _saving ? null : () => unawaited(_leave()), icon: const Icon(Icons.close)),
          title: const Text('Add user'),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: Gap.s),
              child: _saving
                  ? const Padding(
                      padding: EdgeInsets.all(Gap.m),
                      child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                    )
                  : TextButton(onPressed: () => unawaited(_submit()), child: const Text('Add')),
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl),
          children: [
            if (_error != null)
              Container(
                margin: const EdgeInsets.only(bottom: Gap.m),
                padding: const EdgeInsets.all(Gap.m),
                decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
                child: Text('Could not add this person. $_error', style: TextStyle(color: theme.colorScheme.onErrorContainer)),
              ),
            _section(context, 'Personal'),
            _text(_name, 'Full name *', error: _nameError, caps: TextCapitalization.words),
            _text(_email, 'Email', keyboard: TextInputType.emailAddress, max: 254),
            _text(
              _phone,
              'WhatsApp number',
              keyboard: TextInputType.phone,
              max: 20,
              helper: 'They sign in with a one-time code sent to this email or WhatsApp number. There is no password.',
            ),
            _section(context, 'Employment'),
            _text(_employeeId, 'Employee ID', max: 40),
            _text(_designation, 'Designation', max: 80, caps: TextCapitalization.words),
            _dropdown(
              'Department',
              _department,
              [('', 'None', true), for (final d in _c.departments.where((d) => !d.archived)) (d.id, d.name, true)],
              (v) => setState(() {
                _department = v;
                _team = '';
              }),
            ),
            _dropdown('Team', _team, [
              ('', _department.isEmpty ? 'Choose a department first' : (teams.isEmpty ? 'No teams in this department' : 'None'), true),
              for (final t in teams) (t.id, t.name, true),
            ], teams.isEmpty ? null : (v) => setState(() => _team = v)),
            _dropdown('Reporting manager', _manager, [
              ('', 'None', true),
              for (final m in managers) (m.userId, m.name, true),
            ], (v) => setState(() => _manager = v)),
            OrderDateField(
              label: 'Joining date',
              value: _joined,
              onPick: () async {
                final day = await _pickDay(context, _joined);
                if (day != null) setState(() => _joined = day);
              },
              onClear: () => setState(() => _joined = ''),
            ),
            _section(context, 'System access'),
            _dropdown('System role', _role, [
              for (final r in roleLabels.keys) (r, '${roleLabels[r]}${roles.contains(r) ? '' : ' (above your role)'}', roles.contains(r)),
            ], (v) => setState(() => _role = v)),
            _dropdown('Permission template', _template, [
              ('', 'Custom (no template)', true),
              for (final t in _c.templates) (t.id, '${t.name}${_c.withinReach(t) ? '' : ' (beyond your access)'}', _c.withinReach(t)),
            ], (v) => setState(() => _template = v)),
            if (_c.actor.role == 'owner')
              _dropdown('Developer access', _dev, [
                ('', 'None', true),
                for (final e in developerLabels.entries) (e.key, e.value, true),
              ], (v) => setState(() => _dev = v)),
            Text(
              _dev.isNotEmpty
                  ? 'Developers can use everything in Dikho, including developer tools, and can manage everyone except Owners.'
                  : _role == 'owner'
                  ? 'Owners can use every business feature and manage everyone, including other Owners.'
                  : _role == 'admin'
                  ? 'Admins manage Staff and Managers. Their business access comes from the template.'
                  : 'The template decides which modules they can see and change.',
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: Gap.m),
            _section(context, 'Permissions'),
            RadioGroup<bool>(
              groupValue: _customize,
              onChanged: (v) => setState(() => _customize = v ?? false),
              child: const Column(
                children: [
                  RadioListTile<bool>(
                    contentPadding: EdgeInsets.zero,
                    value: false,
                    title: Text('Use the template as it is'),
                    subtitle: Text('You can change individual permissions later on their profile.'),
                  ),
                  RadioListTile<bool>(
                    contentPadding: EdgeInsets.zero,
                    value: true,
                    title: Text('Adjust permissions after adding'),
                    subtitle: Text('Opens their permissions as soon as they are added.'),
                  ),
                ],
              ),
            ),
            _section(context, 'Welcome message'),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _sendWelcome,
              onChanged: (v) => setState(() => _sendWelcome = v ?? true),
              title: Text('Send a welcome message$welcomeBy'),
              subtitle: const Text('Tells them they have been added and how to sign in. It contains no link or code.'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Profile and organisation details. Role, template and permissions are on the
/// Access tab, because they need stronger rights.
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key, required this.controller, required this.catalog, required this.member});

  final UsersController controller;
  final Catalog catalog;
  final Member member;

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  late final _name = TextEditingController(text: widget.member.raw['full_name']?.toString() ?? '');
  late final _employeeId = TextEditingController(text: widget.member.employeeId);
  late final _designation = TextEditingController(text: widget.member.designation);
  late String _department = widget.member.departmentId;
  late String _team = widget.member.teamId;
  late String _manager = widget.member.reportingManagerId;
  late String _joined = widget.member.joiningDate.length >= 10 ? widget.member.joiningDate.substring(0, 10) : widget.member.joiningDate;
  bool _saving = false;
  String? _error;

  Member get _m => widget.member;

  @override
  void initState() {
    super.initState();
    if (widget.controller.members == null) unawaited(widget.controller.load().then((_) => mounted ? setState(() {}) : null));
  }

  @override
  void dispose() {
    _name.dispose();
    _employeeId.dispose();
    _designation.dispose();
    super.dispose();
  }

  /// Only what changed, so the audit log records exactly that.
  Map<String, Object?> get _patch {
    String orig(String key) {
      final v = '${_m.raw[key] ?? ''}';
      return key == 'joining_date' && v.length >= 10 ? v.substring(0, 10) : v;
    }

    final now = {
      'full_name': _name.text.trim(),
      'employee_id': _employeeId.text.trim(),
      'designation': _designation.text.trim(),
      'department_id': _department,
      'team_id': _team,
      'reporting_manager_id': _manager,
      'joining_date': _joined,
    };
    return {
      for (final entry in now.entries)
        if (entry.value != orig(entry.key)) entry.key: entry.value.isEmpty ? null : entry.value,
    };
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter their name.');
      return;
    }
    final patch = _patch;
    if (patch.isEmpty) {
      Navigator.of(context).pop();
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final saved = await widget.controller.update(_m.userId, patch);
      if (mounted) Navigator.of(context).pop(saved);
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = widget.catalog;
    final teams = (c.department(_department)?.teams ?? const <OrgTeam>[]).where((t) => !t.archived || t.id == _m.teamId).toList();
    final managers = (widget.controller.members ?? const <Member>[]).where((m) => m.userId != _m.userId && m.status != 'archived').toList();
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Close', onPressed: _saving ? null : () => Navigator.of(context).pop(), icon: const Icon(Icons.close)),
        title: Text('Edit ${_m.name}', overflow: TextOverflow.ellipsis),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: Gap.s),
            child: _saving
                ? const Padding(
                    padding: EdgeInsets.all(Gap.m),
                    child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                : TextButton(onPressed: () => unawaited(_save()), child: const Text('Save')),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl),
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.m),
              child: Text('Could not save. $_error', style: TextStyle(color: theme.colorScheme.error)),
            ),
          for (final (controller, label, max) in [(_name, 'Full name *', 120), (_employeeId, 'Employee ID', 40), (_designation, 'Designation', 80)])
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.m),
              child: TextField(
                controller: controller,
                maxLength: max,
                decoration: InputDecoration(labelText: label, counterText: ''),
              ),
            ),
          _dropdown(
            'Department',
            _department,
            [('', 'None', true), for (final d in c.departments.where((d) => !d.archived || d.id == _m.departmentId)) (d.id, d.name, true)],
            (v) => setState(() {
              _department = v;
              _team = '';
            }),
          ),
          _dropdown('Team', _team, [
            ('', teams.isEmpty ? 'No teams' : 'None', true),
            for (final t in teams) (t.id, t.name, true),
          ], teams.isEmpty ? null : (v) => setState(() => _team = v)),
          _dropdown('Reporting manager', _manager, [
            ('', 'None', true),
            for (final m in managers) (m.userId, m.name, true),
          ], (v) => setState(() => _manager = v)),
          OrderDateField(
            label: 'Joining date',
            value: _joined,
            onPick: () async {
              final day = await _pickDay(context, _joined);
              if (day != null) setState(() => _joined = day);
            },
            onClear: () => setState(() => _joined = ''),
          ),
        ],
      ),
    );
  }
}
