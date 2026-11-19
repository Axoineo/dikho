import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/platform_api.dart';
import '../../shared/values.dart';
import '../inbox/chat_theme.dart';
import 'campaign_screen.dart';
import 'campaign_sender.dart';
import 'contacts_models.dart';
import 'template_vars.dart';
import 'templates_screen.dart';
import 'whatsapp_models.dart';

/// Opens the wizard. Returns the campaign's id when one was started.
Future<int?> openCampaignWizard(BuildContext context, {required CrmApi api, required PlatformApi platform, String numberStyle = 'en-IN'}) =>
    Navigator.of(context).push<int>(
      MaterialPageRoute(
        builder: (_) => CampaignWizardScreen(api: api, platform: platform, numberStyle: numberStyle),
      ),
    );

const _fieldLabels = {'name': 'Name', 'company': 'Company', 'email': 'Email', 'phone': 'Phone'};
const _steps = ['Audience', 'Template', 'Details', 'Send'];

/// A new campaign, as the web wizard makes one: choose who, choose an approved template,
/// fill in its variables (and its header file), then send at a chosen pace.
///
/// Sending goes through [CampaignSender], which never repeats a request by itself: see
/// its notes, and "Why the new-campaign wizard" in docs/ANDROID.md.
class CampaignWizardScreen extends StatefulWidget {
  const CampaignWizardScreen({super.key, required this.api, required this.platform, this.numberStyle = 'en-IN', this.sleep});

  final CrmApi api;
  final PlatformApi platform;
  final String numberStyle;

  /// For tests: how the sender waits between batches.
  final Future<void> Function(Duration)? sleep;

  @override
  State<CampaignWizardScreen> createState() => _CampaignWizardScreenState();
}

class _CampaignWizardScreenState extends State<CampaignWizardScreen> {
  int _step = 0;

  // Audience
  List<WaContact>? _contacts;
  bool _capped = false;
  String? _contactsError;
  final _search = TextEditingController();
  final _selected = <int>{};

  // Template
  List<TemplateInfo>? _templates;
  String? _templatesError;
  TemplateInfo? _template;

  // Details
  final _name = TextEditingController();
  Map<String, VarSource> _map = {};
  final _literals = <String, TextEditingController>{};
  final _headerLink = TextEditingController();
  String _headerMedia = '';
  String? _headerFileName;
  bool _uploading = false;
  String? _uploadError;
  int _sample = 0;

  // Send
  SendPace _pace = SendPace.steady;
  CampaignSender? _sender;

  @override
  void initState() {
    super.initState();
    unawaited(_loadContacts());
    unawaited(_loadTemplates());
  }

  @override
  void dispose() {
    _search.dispose();
    _name.dispose();
    _headerLink.dispose();
    for (final controller in _literals.values) {
      controller.dispose();
    }
    _sender?.dispose();
    super.dispose();
  }

  String _count(num n) => formatCount(n, style: widget.numberStyle);

  Future<void> _loadContacts() async {
    setState(() => _contactsError = null);
    try {
      // The newest 2,000, as the web wizard reads them.
      final data = await widget.api.get('/contacts');
      final all = [
        for (final row in data['contacts'] as List? ?? const [])
          if (row is Map<String, dynamic>) WaContact.from(row),
      ];
      if (!mounted) return;
      setState(() {
        _capped = all.length >= 2000;
        // The send skips anyone who opted out, so they are not offered.
        _contacts = all.where((c) => !c.optedOut && c.phone.isNotEmpty).toList();
      });
    } on ApiException catch (failure) {
      if (mounted) setState(() => _contactsError = failure.message);
    }
  }

  Future<void> _loadTemplates() async {
    setState(() => _templatesError = null);
    try {
      final list = TemplateList.from(await widget.api.get('/templates'));
      if (!mounted) return;
      setState(() {
        _templates = list.templates;
        if (list.templates.length == 1) _chooseTemplate(list.templates.first);
      });
    } on ApiException catch (failure) {
      if (mounted) setState(() => _templatesError = failure.message);
    }
  }

  /* ── Derived ─────────────────────────────────────────────────────── */

  List<WaContact> get _shown {
    final contacts = _contacts ?? const [];
    final term = _search.text.trim().toLowerCase();
    if (term.isEmpty) return contacts;
    return contacts.where((c) => '${c.name} ${c.phone} ${c.company}'.toLowerCase().contains(term)).toList();
  }

  List<WaContact> get _chosen => (_contacts ?? const []).where((c) => _selected.contains(c.id)).toList();

  /// Whose columns the variables can use: the chosen people, else everyone loaded.
  List<WaContact> get _samples {
    final chosen = _chosen;
    return chosen.isNotEmpty ? chosen : (_contacts ?? const []);
  }

  List<String> get _attributeKeys {
    final keys = <String>[];
    for (final contact in _samples) {
      for (final key in contact.attributes.keys) {
        if (!keys.contains(key)) keys.add(key);
      }
    }
    return keys;
  }

  List<String> get _fields => contactFields.where((field) => _samples.any((c) => _fieldOf(c, field).isNotEmpty)).toList();

  static String _fieldOf(WaContact c, String field) => switch (field) {
    'name' => c.name,
    'company' => c.company,
    'email' => c.email,
    _ => c.phone,
  };

  List<String> get _tokens => _template == null ? const [] : templateTokens(headerText: _template!.headerText, bodyText: _template!.bodyText);

  String? get _mediaFormat => mediaHeaderFormat(_template?.headerFormat);

  bool get _allMapped => _tokens.every((token) {
    final entry = _map[token];
    if (entry == null) return false;
    return entry.source != 'literal' || sanitizeParam(entry.value).isNotEmpty;
  });

  bool get _headerReady => _mediaFormat == null || parseHeaderMedia(_headerMedia) != null;

  bool get _canAdvance => switch (_step) {
    0 => _selected.isNotEmpty,
    1 => _template != null,
    2 => _name.text.trim().isNotEmpty && _allMapped && _headerReady && !_uploading,
    _ => false,
  };

  void _chooseTemplate(TemplateInfo template) {
    _template = template;
    _sample = 0;
    _headerMedia = '';
    _headerFileName = null;
    _headerLink.clear();
    _uploadError = null;
    _map = autoMap(_tokens, fields: _fields, attributeKeys: _attributeKeys);
    _syncLiterals();
  }

  /// Variables still unmapped take the best guess; a choice already made stays.
  void _fillGaps() {
    final guess = autoMap(_tokens, fields: _fields, attributeKeys: _attributeKeys);
    for (final token in _tokens) {
      if (!_map.containsKey(token) && guess[token] != null) _map[token] = guess[token]!;
    }
  }

  void _syncLiterals() {
    for (final token in _tokens) {
      _literals.putIfAbsent(token, TextEditingController.new);
    }
  }

  Map<String, Object?> get _shared {
    final template = _template!;
    final map = <String, Object?>{for (final entry in _map.entries) entry.key: entry.value.toJson()};
    if (_mediaFormat != null) map[headerMediaKey] = VarSource.media(_headerMedia.trim()).toJson();
    return {
      'templateName': template.name,
      'templateLanguage': template.language,
      'templateHeader': template.headerText,
      'templateHeaderFormat': template.headerFormat ?? '',
      'templateBody': template.bodyText,
      'variableMap': map,
    };
  }

  /* ── Navigation ──────────────────────────────────────────────────── */

  void _next() {
    if (!_canAdvance) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _step += 1;
      if (_step == 2) _fillGaps();
    });
  }

  void _back() {
    FocusManager.instance.primaryFocus?.unfocus();
    if (_step == 0) {
      Navigator.of(context).maybePop();
    } else {
      setState(() => _step -= 1);
    }
  }

  bool get _sending => _sender?.state == SendState.sending;

  Future<void> _onPop() async {
    if (_sending) {
      final stop = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Stop sending?'),
          content: const Text('The batch going out now finishes; nobody else is messaged. You can resume from the campaign later.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep sending')),
            FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Stop')),
          ],
        ),
      );
      if (stop == true) _sender?.stop();
      return;
    }
    if (_step > 0 && _sender == null) {
      _back();
      return;
    }
    if (mounted) Navigator.of(context).pop(_sender?.campaignId);
  }

  /* ── Header file ─────────────────────────────────────────────────── */

  Future<void> _pickHeaderFile() async {
    final format = _mediaFormat;
    if (format == null) return;
    final rule = mediaRules[format]!;
    final picked = await widget.platform.pickFiles(rule.types, false);
    if (picked.isEmpty || !mounted) return;
    setState(() {
      _uploading = true;
      _uploadError = null;
    });
    File? copy;
    try {
      final file = await widget.platform.copyPicked(picked.first);
      if (file?.path == null) throw const ApiException('That file could not be read.');
      copy = File(file!.path!);
      final size = await copy.length();
      if (file.tooLarge || size > rule.maxBytes) throw ApiException('The ${rule.noun} must be ${rule.maxBytes ~/ (1024 * 1024)} MB or smaller.');
      if (!rule.types.contains(file.mime.toLowerCase())) throw ApiException('That is not a supported ${rule.noun}. ${rule.hint}');
      final data = await widget.api.upload('/campaigns/header-media?format=$format', file: copy, filename: file.name, mime: file.mime);
      final id = data['mediaId'];
      if (id is! String || parseHeaderMedia(id) == null) throw const ApiException('WhatsApp did not return the file.');
      if (!mounted) return;
      setState(() {
        _headerMedia = id;
        _headerFileName = file.name;
        _headerLink.clear();
      });
    } on ApiException catch (failure) {
      if (mounted) setState(() => _uploadError = failure.message);
    } finally {
      if (copy != null && await copy.exists()) await copy.delete();
      if (mounted) setState(() => _uploading = false);
    }
  }

  /* ── Send ────────────────────────────────────────────────────────── */

  Future<void> _confirmAndSend() async {
    final count = _selected.length;
    final agreed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Send to ${_count(count)} ${count == 1 ? 'person' : 'people'}?'),
        content: Text(
          'This sends real WhatsApp messages using ${_template!.name}, and Meta charges for them. '
          'It takes ${_pace.estimate(count)}. Keep the app open until it finishes.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Send')),
        ],
      ),
    );
    if (agreed != true || !mounted) return;
    final sender = CampaignSender(
      api: widget.api,
      name: _name.text.trim(),
      contactIds: _selected.toList(),
      shared: _shared,
      pace: _pace,
      sleep: widget.sleep,
    );
    setState(() => _sender = sender);
    await sender.start();
  }

  Future<void> _openCampaign() async {
    final id = _sender?.campaignId;
    if (id == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => CampaignScreen(api: widget.api, id: id, title: _name.text.trim(), numberStyle: widget.numberStyle, canSend: true),
      ),
    );
  }

  /* ── Build ───────────────────────────────────────────────────────── */

  @override
  Widget build(BuildContext context) {
    final sender = _sender;
    final body = switch (_step) {
      0 => _audience(context),
      1 => _templateStep(context),
      2 => _details(context),
      _ => sender == null ? _review(context) : ListenableBuilder(listenable: sender, builder: (context, _) => _progress(context, sender)),
    };
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_onPop());
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('New campaign'),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(28),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.s),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Step ${_step + 1} of ${_steps.length}: ${_steps[_step]}',
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ),
            ),
          ),
        ),
        body: body,
        bottomNavigationBar: _step < 3 ? _bar(context) : null,
      ),
    );
  }

  Widget _bar(BuildContext context) => SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.m),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '${_count(_selected.length)} ${_selected.length == 1 ? 'recipient' : 'recipients'}'
              '${_template == null ? '' : ', ${_template!.name}'}',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          const SizedBox(width: Gap.s),
          TextButton(onPressed: _back, child: Text(_step == 0 ? 'Cancel' : 'Back')),
          const SizedBox(width: Gap.xs),
          FilledButton(onPressed: _canAdvance ? _next : null, child: const Text('Continue')),
        ],
      ),
    ),
  );

  Widget _audience(BuildContext context) {
    final theme = Theme.of(context);
    final contacts = _contacts;
    if (contacts == null) {
      return _contactsError == null
          ? const Center(child: CircularProgressIndicator())
          : _Problem(text: _contactsError!, onRetry: () => unawaited(_loadContacts()));
    }
    final shown = _shown;
    final allShownChosen = shown.isNotEmpty && shown.every((c) => _selected.contains(c.id));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, Gap.m, 0),
          child: TextField(
            controller: _search,
            onChanged: (_) => setState(() {}),
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search name, phone or company'),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.xs, Gap.s, 0),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '${_count(_selected.length)} selected of ${_count(contacts.length)}'
                  '${_capped ? ' (the newest 2,000)' : ''}',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ),
              TextButton(
                onPressed: shown.isEmpty
                    ? null
                    : () => setState(() {
                        if (allShownChosen) {
                          _selected.removeAll(shown.map((c) => c.id));
                        } else {
                          _selected.addAll(shown.map((c) => c.id));
                        }
                      }),
                child: Text(allShownChosen ? 'Clear these' : (_search.text.trim().isEmpty ? 'Select all' : 'Select these')),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Gap.l),
          child: Text(
            'People who opted out are left out. To add people from a spreadsheet, import them in Contacts first.',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ),
        const Divider(),
        Expanded(
          child: shown.isEmpty
              ? Center(child: Text(contacts.isEmpty ? 'No contacts to send to yet.' : 'Nobody matches that search.'))
              : ListView.builder(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  itemCount: shown.length,
                  itemBuilder: (context, index) {
                    final contact = shown[index];
                    return CheckboxListTile(
                      key: ValueKey(contact.id),
                      value: _selected.contains(contact.id),
                      onChanged: (checked) => setState(() {
                        if (checked == true) {
                          _selected.add(contact.id);
                        } else {
                          _selected.remove(contact.id);
                        }
                      }),
                      title: Text(contact.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                      subtitle: Text(contact.subtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _templateStep(BuildContext context) {
    final templates = _templates;
    if (templates == null) {
      return _templatesError == null
          ? const Center(child: CircularProgressIndicator())
          : _Problem(text: _templatesError!, onRetry: () => unawaited(_loadTemplates()));
    }
    if (templates.isEmpty) return const Center(child: Text('No approved templates yet.'));
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(Gap.l),
      children: [
        Text('Choose an approved template.', style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        const SizedBox(height: Gap.m),
        RadioGroup<String>(
          groupValue: _template?.key,
          onChanged: (key) => setState(() => _chooseTemplate(templates.firstWhere((t) => t.key == key))),
          child: Column(
            children: [
              for (final template in templates)
                Card.outlined(
                  margin: const EdgeInsets.only(bottom: Gap.s),
                  child: RadioListTile<String>(
                    value: template.key,
                    title: Text(template.name),
                    subtitle: Text(
                      [
                        template.language,
                        sentenceCase(template.category),
                        if (template.mediaLabel != null) '${template.mediaLabel} header',
                        if (template.hasVariables) 'Has variables',
                      ].where((part) => part.isNotEmpty).join(', '),
                    ),
                  ),
                ),
            ],
          ),
        ),
        if (_template != null) ...[const SizedBox(height: Gap.m), TemplateBubble(template: _template!)],
      ],
    );
  }

  Widget _details(BuildContext context) {
    final theme = Theme.of(context);
    final template = _template!;
    final chosen = _chosen;
    final sample = chosen.isEmpty ? null : chosen[_sample.clamp(0, chosen.length - 1)];
    final format = _mediaFormat;
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return ListView(
      padding: const EdgeInsets.all(Gap.l),
      children: [
        TextField(
          controller: _name,
          onChanged: (_) => setState(() {}),
          textCapitalization: TextCapitalization.sentences,
          maxLength: 120,
          decoration: const InputDecoration(labelText: 'Campaign name', helperText: 'Only you see this, in Campaigns.'),
        ),
        if (_tokens.isNotEmpty) ...[
          const SizedBox(height: Gap.m),
          Text('Variables', style: theme.textTheme.titleSmall),
          Text('Choose where each value comes from.', style: muted),
          const SizedBox(height: Gap.s),
          for (final token in _tokens) _variable(context, token, chosen),
        ],
        if (format != null) ...[
          const SizedBox(height: Gap.m),
          Text('Header ${mediaRules[format]!.noun}', style: theme.textTheme.titleSmall),
          Text('The same file goes to everyone. ${mediaRules[format]!.hint}', style: muted),
          const SizedBox(height: Gap.s),
          Row(
            children: [
              OutlinedButton.icon(
                onPressed: _uploading ? null : () => unawaited(_pickHeaderFile()),
                icon: _uploading
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.upload_file),
                label: Text(_uploading ? 'Uploading…' : 'Choose a file'),
              ),
              const SizedBox(width: Gap.m),
              if (_headerFileName != null && _headerMedia.isNotEmpty)
                Expanded(child: Text('Ready: $_headerFileName', maxLines: 2, overflow: TextOverflow.ellipsis)),
            ],
          ),
          if (_uploadError != null)
            Padding(
              padding: const EdgeInsets.only(top: Gap.xs),
              child: Text(_uploadError!, style: TextStyle(color: theme.colorScheme.error)),
            ),
          const SizedBox(height: Gap.s),
          TextField(
            controller: _headerLink,
            onChanged: (value) => setState(() {
              _headerMedia = value.trim();
              _headerFileName = null;
            }),
            keyboardType: TextInputType.url,
            decoration: InputDecoration(
              labelText: 'Or a link or media ID',
              helperText: 'An https link to the file, or a WhatsApp media ID.',
              errorText: _headerLink.text.trim().isNotEmpty && parseHeaderMedia(_headerLink.text) == null ? 'Use an https link or a media ID.' : null,
            ),
          ),
        ],
        const SizedBox(height: Gap.l),
        Row(
          children: [
            Expanded(child: Text('Preview', style: theme.textTheme.titleSmall)),
            if (chosen.length > 1) ...[
              IconButton(
                tooltip: 'Previous person',
                onPressed: _sample > 0 ? () => setState(() => _sample -= 1) : null,
                icon: const Icon(Icons.chevron_left),
              ),
              Text('${_sample + 1} of ${_count(chosen.length)}', style: muted),
              IconButton(
                tooltip: 'Next person',
                onPressed: _sample < chosen.length - 1 ? () => setState(() => _sample += 1) : null,
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ],
        ),
        if (sample != null) Text('As ${sample.title} gets it', style: muted),
        const SizedBox(height: Gap.s),
        TemplateBubble(
          template: template,
          headerText: format == null ? renderTemplateText(template.headerText, _map, sample) : template.headerText,
          bodyText: renderTemplateText(template.bodyText, _map, sample),
          mediaNote: format == null
              ? null
              : (_headerFileName ?? (parseHeaderMedia(_headerMedia) == null ? 'No file chosen yet' : 'The file you linked')),
        ),
      ],
    );
  }

  Widget _variable(BuildContext context, String token, List<WaContact> chosen) {
    final theme = Theme.of(context);
    final entry = _map[token];
    final value = entry == null
        ? null
        : switch (entry.source) {
            'field' => 'field:${entry.key}',
            'attribute' => 'attr:${entry.key}',
            _ => 'literal',
          };
    final options = <String, String>{
      for (final field in _fields) 'field:$field': _fieldLabels[field] ?? field,
      for (final key in _attributeKeys) 'attr:$key': 'From the sheet: $key',
      'literal': 'Fixed text for everyone',
    };
    final missing = entry == null || entry.source == 'literal' ? 0 : chosen.where((c) => isMissing(token, _map, c)).length;
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.m),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          DropdownButtonFormField<String>(
            initialValue: options.containsKey(value) ? value : null,
            isExpanded: true,
            decoration: InputDecoration(labelText: '{{$token}}'),
            items: [
              for (final option in options.entries)
                DropdownMenuItem(
                  value: option.key,
                  child: Text(option.value, overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: (choice) => setState(() {
              if (choice == null) return;
              if (choice == 'literal') {
                _map[token] = VarSource.literal(_literals[token]!.text);
              } else if (choice.startsWith('attr:')) {
                _map[token] = VarSource.attribute(choice.substring(5));
              } else {
                _map[token] = VarSource.field(choice.substring(6));
              }
            }),
          ),
          if (entry?.source == 'literal')
            Padding(
              padding: const EdgeInsets.only(top: Gap.s),
              child: TextField(
                controller: _literals[token],
                maxLength: 200,
                onChanged: (text) => setState(() => _map[token] = VarSource.literal(text)),
                decoration: InputDecoration(labelText: 'Text for {{$token}}'),
              ),
            ),
          if (missing > 0)
            Padding(
              padding: const EdgeInsets.only(top: Gap.xs),
              child: Text(
                '${_count(missing)} of ${_count(chosen.length)} have no value here, so theirs would be blank. Choose another column or fixed text.',
                style: TextStyle(color: theme.colorScheme.error, fontSize: 12.5),
              ),
            ),
        ],
      ),
    );
  }

  Widget _review(BuildContext context) {
    final theme = Theme.of(context);
    final count = _selected.length;
    return ListView(
      padding: const EdgeInsets.all(Gap.l),
      children: [
        _Fact(label: 'Campaign', value: _name.text.trim()),
        _Fact(label: 'Template', value: _template!.name),
        _Fact(label: 'Recipients', value: _count(count)),
        const SizedBox(height: Gap.l),
        Text('Pace', style: theme.textTheme.titleSmall),
        const SizedBox(height: Gap.s),
        SegmentedButton<SendPace>(
          showSelectedIcon: false,
          segments: [for (final pace in SendPace.values) ButtonSegment(value: pace, label: Text(pace.label))],
          selected: {_pace},
          onSelectionChanged: (value) => setState(() => _pace = value.first),
        ),
        const SizedBox(height: Gap.xs),
        Text(
          '${_pace.hint} This list takes ${_pace.estimate(count)}.',
          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: Gap.xl),
        FilledButton.icon(
          onPressed: () => unawaited(_confirmAndSend()),
          icon: const Icon(Icons.send),
          label: Text('Send to ${_count(count)} ${count == 1 ? 'person' : 'people'}'),
        ),
        const SizedBox(height: Gap.s),
        TextButton(onPressed: () => setState(() => _step = 2), child: const Text('Back')),
      ],
    );
  }

  Widget _progress(BuildContext context, CampaignSender sender) {
    final theme = Theme.of(context);
    final done = sender.sent + sender.failed;
    final share = sender.total > 0 ? (done / sender.total).clamp(0.0, 1.0) : 0.0;
    final (String title, String? detail) = switch (sender.state) {
      SendState.sending => (
        sender.stopRequested ? 'Stopping after this batch…' : 'Sending…',
        sender.waitSeconds > 0 ? 'Next batch in ${sender.waitSeconds} s. Keep the app open.' : 'Batch ${sender.batch + 1}. Keep the app open.',
      ),
      SendState.done => ('Sent', sender.failed > 0 ? 'Some could not be delivered. The campaign shows why.' : null),
      SendState.stopped => ('Stopped', '${_count(sender.remaining.length)} not sent yet. Resume sends only to them.'),
      SendState.halted => ('Meta stopped this campaign', sender.halt?.reason),
      SendState.failed => (
        sender.startUnconfirmed ? 'We could not confirm the campaign started' : "Couldn't finish sending",
        sender.startUnconfirmed
            ? '${sender.error} Trying again is safe: it cannot start the same campaign twice.'
            : '${sender.error}${sender.remaining.isNotEmpty ? ' ${_count(sender.remaining.length)} not sent yet. Resume sends only to them.' : ''}',
      ),
      SendState.ready => ('Starting…', null),
    };
    return ListView(
      padding: const EdgeInsets.all(Gap.l),
      children: [
        Text(title, style: theme.textTheme.titleLarge),
        if (detail != null) ...[const SizedBox(height: Gap.xs), Text(detail)],
        const SizedBox(height: Gap.l),
        Semantics(
          label: '${(share * 100).round()} percent',
          child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: share, minHeight: 8),
          ),
        ),
        const SizedBox(height: Gap.s),
        Text(
          '${_count(sender.sent)} sent, ${_count(sender.failed)} failed, of ${_count(sender.total)}',
          style: theme.textTheme.bodyMedium?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
        ),
        if (sender.firstError != null && sender.failed > 0) ...[
          const SizedBox(height: Gap.xs),
          Text('First error: ${sender.firstError}', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        ],
        const SizedBox(height: Gap.xl),
        if (sender.state == SendState.sending)
          OutlinedButton.icon(
            onPressed: sender.stopRequested ? null : sender.stop,
            icon: const Icon(Icons.stop_circle_outlined),
            label: const Text('Stop'),
          ),
        if (sender.canResume)
          FilledButton(
            onPressed: () => unawaited(sender.resume()),
            child: Text(sender.campaignId == null ? 'Try again' : 'Resume, ${_count(sender.remaining.length)} left'),
          ),
        if (sender.state != SendState.sending) ...[
          const SizedBox(height: Gap.s),
          if (sender.campaignId != null) OutlinedButton(onPressed: () => unawaited(_openCampaign()), child: const Text('Open the campaign')),
          const SizedBox(height: Gap.s),
          TextButton(onPressed: () => Navigator.of(context).pop(sender.campaignId), child: const Text('Done')),
        ],
      ],
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Gap.xs + 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 110,
              child: Text(label, style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
            ),
            Expanded(child: Text(value, style: theme.textTheme.bodyLarge)),
          ],
        ),
      ),
    );
  }
}

class _Problem extends StatelessWidget {
  const _Problem({required this.text, required this.onRetry});

  final String text;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(Gap.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(text, textAlign: TextAlign.center),
          const SizedBox(height: Gap.m),
          FilledButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    ),
  );
}
