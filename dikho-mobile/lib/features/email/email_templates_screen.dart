import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import '../settings/settings_parts.dart' show SaveBar, confirmDiscard;
import '../whatsapp/analytics_parts.dart' show SectionCard;
import 'campaign_models.dart';
import 'email_api.dart';
import 'email_models.dart';
import 'message_body.dart';

const templateKinds = {
  'marketing': ('Marketing', 'For campaigns. Recipients must have agreed to marketing email.'),
  'transactional': (
    'Transactional',
    'For one-to-one business email (quotes, reminders). Stored for upcoming workflows; nothing sends these automatically yet.',
  ),
};

/// Reusable email content, as EmailTemplates.jsx. Every save is a new numbered version;
/// older ones stay readable and can be restored. Campaigns copy a template's content
/// when it is applied, so changing a template never changes an approved campaign.
class EmailTemplatesScreen extends StatefulWidget {
  const EmailTemplatesScreen({super.key, required this.api, required this.canManage, required this.onOpenDrawer, this.now});

  final EmailApi api;

  /// email_templates.manage
  final bool canManage;
  final VoidCallback onOpenDrawer;
  final DateTime Function()? now;

  @override
  State<EmailTemplatesScreen> createState() => _EmailTemplatesScreenState();
}

class _EmailTemplatesScreenState extends State<EmailTemplatesScreen> {
  List<EmailTemplate>? _templates;
  Map<String, Map<String, String>> _variables = const {};
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final (list, vars) = await widget.api.templates();
      if (mounted) {
        setState(() {
          _templates = list;
          _variables = vars;
          _error = null;
        });
      }
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  Future<void> _open(String? id) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => EmailTemplateScreen(api: widget.api, id: id, canManage: widget.canManage, variables: _variables, now: widget.now),
      ),
    );
    unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final now = (widget.now ?? DateTime.now)();
    final list = _templates;
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', icon: const Icon(Icons.menu), onPressed: widget.onOpenDrawer),
        title: const Text('Email templates'),
      ),
      floatingActionButton: widget.canManage
          ? FloatingActionButton.extended(onPressed: () => unawaited(_open(null)), icon: const Icon(Icons.add), label: const Text('New template'))
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: Gap.s, bottom: 96),
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Gap.l),
              child: Text('Reusable email content. Every save is kept as a version.', style: muted),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(Gap.l),
                child: Text("Couldn't load templates. $_error", style: TextStyle(color: theme.colorScheme.error)),
              ),
            if (list == null && _error == null)
              const Padding(
                padding: EdgeInsets.all(Gap.xl),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (list != null && list.isEmpty)
              Padding(
                padding: const EdgeInsets.all(Gap.xl),
                child: Text('No templates yet.', textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
              ),
            for (final t in list ?? const <EmailTemplate>[])
              ListTile(
                title: Text(t.name),
                subtitle: Text(
                  [
                    if (t.subject.isNotEmpty) t.subject,
                    'version ${t.version}',
                    'updated ${listTime(t.updatedAt, now)}',
                    if (t.updatedByName.isNotEmpty) t.updatedByName,
                  ].join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: Pill(label: templateKinds[t.kind]?.$1 ?? t.kind, tone: t.kind == 'marketing' ? PillTone.pending : PillTone.neutral),
                onTap: () => unawaited(_open(t.id)),
              ),
          ],
        ),
      ),
    );
  }
}

/// One template: its content, its versions, and (with email_templates.manage) editing.
class EmailTemplateScreen extends StatefulWidget {
  const EmailTemplateScreen({super.key, required this.api, required this.id, required this.canManage, required this.variables, this.now});

  final EmailApi api;
  final String? id;
  final bool canManage;
  final Map<String, Map<String, String>> variables;
  final DateTime Function()? now;

  @override
  State<EmailTemplateScreen> createState() => _EmailTemplateScreenState();
}

class _EmailTemplateScreenState extends State<EmailTemplateScreen> {
  late String? _id = widget.id;
  EmailTemplate? _t;
  String _kind = 'marketing';
  String _html = '';
  bool _dirty = false;
  bool _saving = false;
  String? _error;
  int _key = 0;
  final _name = TextEditingController();
  final _subject = TextEditingController();
  final _preheader = TextEditingController();
  final _body = TextEditingController();

  bool get _isNew => _id == null;

  @override
  void initState() {
    super.initState();
    if (!_isNew) unawaited(_load());
  }

  @override
  void dispose() {
    for (final c in [_name, _subject, _preheader, _body]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final t = await widget.api.template(_id!);
      if (!mounted) return;
      setState(() {
        _t = t;
        _kind = t.kind.isEmpty ? 'marketing' : t.kind;
        _name.text = t.name;
        _use(t.subject, t.preheader, t.html);
        _dirty = false;
      });
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.status == 404 ? 'This template does not exist or was archived.' : failure.message);
    }
  }

  void _use(String subject, String preheader, String html) {
    _subject.text = subject;
    _preheader.text = preheader;
    _html = html;
    _body.text = designedHtml(html) ? '' : htmlToText(html);
    _key++;
  }

  void _touch() => setState(() {
    _dirty = true;
    _error = null;
  });

  Map<String, String> get _allowed =>
      _kind == 'transactional' ? {...?widget.variables['marketing'], ...?widget.variables['transactional']} : {...?widget.variables['marketing']};

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Give the template a name.');
      return;
    }
    setState(() => _saving = true);
    final fields = {'name': _name.text.trim(), 'subject': _subject.text.trim(), 'preheader': _preheader.text.trim(), 'html': _html};
    try {
      if (_isNew) {
        final t = await widget.api.createTemplate({...fields, 'kind': _kind});
        _id = t.id;
      } else {
        await widget.api.saveTemplate(_id!, fields);
      }
      if (mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Template saved as a new version.')));
      await _load();
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _restore(int version) async {
    try {
      final old = await widget.api.template(_id!, version: version);
      if (!mounted) return;
      setState(() {
        _use(old.subject, old.preheader, old.html);
        _dirty = true;
      });
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text('Version $version loaded. Save to make it the newest version.')));
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  Future<void> _archive() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('Archive this template?'),
        content: const Text('It is no longer offered for new campaigns. Campaigns that already used it keep their own copy.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialog).pop(true), child: const Text('Archive')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api.archiveTemplate(_id!);
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (failure) {
      setState(() => _error = failure.message);
    }
  }

  Future<void> _leave() async {
    if (!_dirty || await confirmDiscard(context)) {
      if (mounted) Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = _t;
    if (!_isNew && t == null) {
      return Scaffold(
        appBar: AppBar(),
        body: _error == null ? const Center(child: CircularProgressIndicator()) : EmptyMessage(title: 'Template unavailable', body: _error!),
      );
    }
    final edit = widget.canManage;
    final designed = _html.trim().isNotEmpty && designedHtml(_html);
    final versions = [
      if (t?.raw['versions'] is List)
        for (final v in t!.raw['versions'] as List)
          if (v is Map)
            (
              version: v['version'] is num ? (v['version'] as num).toInt() : 0,
              by: '${v['saved_by_name'] ?? 'Someone'}',
              at: '${v['saved_at'] ?? ''}',
            ),
    ];
    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(_isNew ? 'New template' : (t!.name.isEmpty ? 'Template' : t.name), overflow: TextOverflow.ellipsis),
          actions: [
            if (!_isNew && edit) IconButton(tooltip: 'Archive', onPressed: () => unawaited(_archive()), icon: const Icon(Icons.archive_outlined)),
          ],
        ),
        bottomNavigationBar: edit && (_dirty || _isNew)
            ? SaveBar(busy: _saving, onSave: () => unawaited(_save()), onCancel: () => unawaited(_isNew ? _leave() : _load()))
            : null,
        body: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl * 2),
          children: [
            if (!edit)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: Text(
                  'Read only. Editing templates needs the "Manage email templates" permission.',
                  style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
              ),
            SectionCard(
              title: 'Template',
              child: Column(
                key: ValueKey('t-$_key'),
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _name,
                    enabled: edit,
                    inputFormatters: [LengthLimitingTextInputFormatter(120)],
                    onChanged: (_) => _touch(),
                    decoration: const InputDecoration(labelText: 'Name'),
                  ),
                  const SizedBox(height: Gap.m),
                  DropdownButtonFormField<String>(
                    initialValue: _kind,
                    isExpanded: true,
                    decoration: InputDecoration(labelText: 'Type', helperText: templateKinds[_kind]!.$2, helperMaxLines: 8),
                    items: [for (final e in templateKinds.entries) DropdownMenuItem(value: e.key, child: Text(e.value.$1))],
                    onChanged: edit && _isNew
                        ? (v) {
                            if (v == null) return;
                            _kind = v;
                            _touch();
                          }
                        : null,
                  ),
                  const SizedBox(height: Gap.m),
                  TextField(
                    controller: _subject,
                    enabled: edit,
                    inputFormatters: [LengthLimitingTextInputFormatter(900), FilteringTextInputFormatter.deny(RegExp(r'[\r\n]'))],
                    onChanged: (_) => _touch(),
                    decoration: const InputDecoration(labelText: 'Subject'),
                  ),
                  const SizedBox(height: Gap.m),
                  TextField(
                    controller: _preheader,
                    enabled: edit,
                    inputFormatters: [LengthLimitingTextInputFormatter(200), FilteringTextInputFormatter.deny(RegExp(r'[\r\n]'))],
                    onChanged: (_) => _touch(),
                    decoration: const InputDecoration(labelText: 'Preview text (optional)'),
                  ),
                  const SizedBox(height: Gap.m),
                  if (designed)
                    Text(
                      'This message was designed on a computer, with its own layout. It is shown below; change it on a computer.',
                      style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                    )
                  else
                    TextField(
                      controller: _body,
                      enabled: edit,
                      minLines: 6,
                      maxLines: null,
                      keyboardType: TextInputType.multiline,
                      textCapitalization: TextCapitalization.sentences,
                      onChanged: (v) {
                        _html = textToHtml(v);
                        _touch();
                      },
                      decoration: const InputDecoration(
                        labelText: 'Message',
                        alignLabelWithHint: true,
                        helperText: 'Plain text. A blank line starts a new paragraph.',
                      ),
                    ),
                  if (edit && !designed && _allowed.isNotEmpty)
                    Wrap(
                      spacing: Gap.s,
                      children: [
                        for (final e in _allowed.entries)
                          ActionChip(
                            label: Text('+ ${e.value}'),
                            tooltip: 'Add {{${e.key}}} to the message',
                            onPressed: () {
                              _body.text = '${_body.text}{{${e.key}}}';
                              _html = textToHtml(_body.text);
                              _touch();
                            },
                          ),
                      ],
                    ),
                  if (_kind == 'transactional')
                    Padding(
                      padding: const EdgeInsets.only(top: Gap.s),
                      child: Text(
                        'Transactional placeholders such as {{client_name}} show as written; the workflow that sends the email fills them.',
                        style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ),
                ],
              ),
            ),
            if (_html.trim().isNotEmpty)
              SectionCard(
                title: 'Preview',
                subtitle: 'With sample values.',
                child: MessageBody(
                  key: ValueKey('tp-$_key-${_html.length}'),
                  html: withSample(_html),
                  text: htmlToText(withSample(_html)),
                  onOpenLink: (_) async {},
                ),
              ),
            if (versions.isNotEmpty)
              SectionCard(
                title: 'Versions',
                subtitle: 'Every save is kept.',
                child: Column(
                  children: [
                    for (final v in versions)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('Version ${v.version}${v.version == t?.version ? ' (current)' : ''}'),
                        subtitle: Text('${v.by} · ${fullTime(v.at)}'),
                        trailing: v.version != t?.version && edit
                            ? TextButton(onPressed: () => unawaited(_restore(v.version)), child: const Text('Restore'))
                            : null,
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
