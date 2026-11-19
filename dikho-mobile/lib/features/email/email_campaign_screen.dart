import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import '../settings/settings_parts.dart' show SaveBar, confirmDiscard;
import '../whatsapp/analytics_parts.dart' show FactRow, SectionCard;
import 'campaign_models.dart';
import 'email_api.dart';
import 'email_campaigns_screen.dart' show campaignTone;
import 'email_models.dart';
import 'message_body.dart';

/// One campaign from draft to sent, redesigned for a phone from CampaignEditor.jsx: the
/// web's four steps become sections of one screen. A message designed on a computer
/// (its own tables or styles) shows as a preview and can be replaced from a template,
/// but is not edited line by line here; plain messages are written as text.
class EmailCampaignScreen extends StatefulWidget {
  const EmailCampaignScreen({
    super.key,
    required this.api,
    required this.meta,
    required this.id,
    required this.userId,
    required this.canCreate,
    required this.onChanged,
    required this.onOpenPage,
    this.now,
  });

  final EmailApi api;
  final CampaignsData meta;

  /// Null for a new campaign.
  final String? id;
  final String userId;
  final bool canCreate;
  final VoidCallback onChanged;
  final ValueChanged<String> onOpenPage;
  final DateTime Function()? now;

  @override
  State<EmailCampaignScreen> createState() => _EmailCampaignScreenState();
}

class _EmailCampaignScreenState extends State<EmailCampaignScreen> {
  late String? _id = widget.id;
  Campaign? _c;
  late CampaignDraft _d = CampaignDraft.from(null, widget.meta);
  bool _dirty = false;
  bool _saving = false;
  String? _error;
  String? _loadError;
  AudiencePreview? _preview;
  String? _previewError;
  AudienceOptions? _options;
  List<EmailTemplate> _templates = const [];
  Timer? _count;
  int _contentKey = 0;

  late final _name = TextEditingController();
  late final _fromName = TextEditingController();
  late final _replyTo = TextEditingController();
  late final _subject = TextEditingController();
  late final _preheader = TextEditingController();
  late final _body = TextEditingController();

  EmailApi get _api => widget.api;
  CampaignsData get _meta => widget.meta;
  DateTime get _now => (widget.now ?? DateTime.now)();

  String get _status => _c?.status ?? 'draft';
  bool get _isNew => _id == null;
  bool get _editable => (_c != null ? _c!.canEdit : widget.canCreate) && !lockedStatuses.contains(_status) && !(_c?.started ?? false);

  @override
  void initState() {
    super.initState();
    _fill();
    unawaited(_load());
    unawaited(_api.audienceOptions().then((o) => mounted ? setState(() => _options = o) : null).catchError((Object _) {}));
    unawaited(
      _api
          .templates()
          .then((t) {
            if (mounted) setState(() => _templates = t.$1.where((x) => x.kind == 'marketing').toList());
          })
          .catchError((Object _) {}),
    );
  }

  @override
  void dispose() {
    _count?.cancel();
    for (final c in [_name, _fromName, _replyTo, _subject, _preheader, _body]) {
      c.dispose();
    }
    super.dispose();
  }

  void _fill() {
    _name.text = _d.name;
    _fromName.text = _d.fromName;
    _replyTo.text = _d.replyTo;
    _subject.text = _d.subject;
    _preheader.text = _d.preheader;
    _body.text = designedHtml(_d.html) ? '' : htmlToText(_d.html);
    _contentKey++;
  }

  Future<void> _load() async {
    final id = _id;
    if (id == null) {
      _countAudience();
      return;
    }
    try {
      final c = await _api.campaign(id);
      if (!mounted) return;
      setState(() {
        _c = c;
        _d = CampaignDraft.from(c, _meta);
        _dirty = false;
        _loadError = null;
        _fill();
      });
      _countAudience();
    } on ApiException catch (failure) {
      if (mounted) setState(() => _loadError = failure.status == 404 ? 'This campaign does not exist or was removed.' : failure.message);
    }
  }

  void _change(VoidCallback update, {bool audience = false}) {
    setState(() {
      update();
      _dirty = true;
      _error = null;
    });
    if (audience) _countAudience();
  }

  /// A live count, a moment after the last change.
  void _countAudience() {
    _count?.cancel();
    if (_d.audience.sources.isEmpty) {
      setState(() => _preview = null);
      return;
    }
    final spec = _d.audience.copy();
    _count = Timer(const Duration(milliseconds: 350), () async {
      try {
        final p = await _api.audiencePreview(spec);
        if (mounted) {
          setState(() {
            _preview = p;
            _previewError = null;
          });
        }
      } on ApiException catch (failure) {
        if (mounted) setState(() => _previewError = failure.message);
      }
    });
  }

  void _say(String text) {
    if (mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));
  }

  Future<bool> _save({bool quiet = false}) async {
    if (_d.name.trim().isEmpty) {
      setState(() => _error = 'Give the campaign a name.');
      return false;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final fields = _d.toFields();
      if (_isNew) {
        final c = await _api.createCampaign(fields);
        _id = c.id;
        if (!quiet) _say('Draft saved.');
      } else {
        await _api.saveCampaign(_id!, fields);
        if (!quiet) _say(withdrawingStatuses.contains(_status) ? 'Saved. The campaign is a draft again and needs approval.' : 'Draft saved.');
      }
      widget.onChanged();
      await _load();
      return true;
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
      return false;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _requestSave() async {
    if (withdrawingStatuses.contains(_status)) {
      final ok = await _confirm(
        title: _status == 'pending_approval' ? 'Withdraw from approval?' : 'Withdraw the approval?',
        body: 'Saving a change returns this campaign to draft. It must be submitted and approved again before anything is sent.',
        action: 'Save and withdraw',
      );
      if (!ok) return;
    }
    await _save();
  }

  Future<bool> _confirm({required String title, required String body, required String action, bool danger = false}) async {
    final theme = Theme.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Not now')),
          FilledButton(
            style: danger ? FilledButton.styleFrom(backgroundColor: theme.colorScheme.error, foregroundColor: theme.colorScheme.onError) : null,
            onPressed: () => Navigator.of(dialog).pop(true),
            child: Text(action),
          ),
        ],
      ),
    );
    return ok == true;
  }

  /// One action, then the campaign again.
  Future<void> _act(Future<void> Function() run, String done) async {
    setState(() => _error = null);
    try {
      await run();
      widget.onChanged();
      _say(done);
      await _load();
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  Future<void> _applyTemplate(EmailTemplate summary) async {
    final hasContent = _d.subject.trim().isNotEmpty || _d.html.trim().isNotEmpty;
    if (hasContent &&
        !await _confirm(
          title: 'Replace the content?',
          body: "The subject, preview text and message are replaced with the template's. You can still change them afterwards.",
          action: 'Replace',
        )) {
      return;
    }
    try {
      final t = await _api.template(summary.id);
      _change(() {
        _d
          ..templateId = t.id
          ..subject = t.subject
          ..preheader = t.preheader
          ..html = t.html;
        _subject.text = t.subject;
        _preheader.text = t.preheader;
        _body.text = designedHtml(t.html) ? '' : htmlToText(t.html);
        _contentKey++;
      });
      _say('Content replaced with "${t.name}" (version ${t.version}).');
    } on ApiException catch (failure) {
      setState(() => _error = failure.message);
    }
  }

  Future<void> _pickSendAt() async {
    final now = _now;
    final day = await showDatePicker(context: context, initialDate: _d.sendAt ?? now, firstDate: now, lastDate: now.add(const Duration(days: 365)));
    if (day == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_d.sendAt ?? now.add(const Duration(hours: 1))));
    if (time == null) return;
    _change(() => _d.sendAt = DateTime(day.year, day.month, day.day, time.hour, time.minute));
  }

  Future<void> _leave() async {
    if (!_dirty || await confirmDiscard(context)) {
      if (mounted) Navigator.of(context).pop();
    }
  }

  int? get _eligible => _status == 'draft' || _status == 'rejected' ? _preview?.eligible : _c?.recipientCount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (_loadError != null) {
      return Scaffold(
        appBar: AppBar(),
        body: EmptyMessage(title: 'Campaign unavailable', body: _loadError!),
      );
    }
    if (!_isNew && _c == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    final c = _c;
    final editable = _editable;
    final checks = campaignChecks(_d, _meta, eligible: _eligible, now: _now);
    final ready = checks.every((x) => x.ok);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    return PopScope(
      canPop: !_dirty,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(_d.name.trim().isEmpty ? 'New campaign' : _d.name.trim(), overflow: TextOverflow.ellipsis),
          actions: [
            if (c != null && widget.canCreate)
              IconButton(
                tooltip: 'Duplicate',
                icon: const Icon(Icons.copy_outlined),
                onPressed: () => unawaited(() async {
                  try {
                    final copy = await _api.duplicateCampaign(c.id);
                    widget.onChanged();
                    _say('Copied as a new draft.');
                    if (!mounted) return;
                    setState(() {
                      _id = copy.id;
                      _c = null;
                    });
                    await _load();
                  } on ApiException catch (failure) {
                    setState(() => _error = failure.message);
                  }
                }()),
              ),
          ],
        ),
        bottomNavigationBar: editable && (_dirty || _isNew)
            ? SaveBar(busy: _saving, onSave: () => unawaited(_requestSave()), onCancel: () => unawaited(_cancelEdits()))
            : null,
        body: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl * 2),
            children: [
              Wrap(
                spacing: Gap.s,
                runSpacing: Gap.xs,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Pill(label: campaignStatusLabels[_status] ?? _status, tone: campaignTone(_status)),
                  if (c != null)
                    Text('Updated ${syncedAgo(c.updatedAt, _now)}${c.createdByName.isEmpty ? '' : ' · created by ${c.createdByName}'}', style: muted),
                  if (_dirty) Text('Unsaved changes', style: muted.copyWith(color: theme.colorScheme.primary)),
                ],
              ),
              const SizedBox(height: Gap.m),
              if (_status == 'rejected' && (c?.decisionNote ?? '').isNotEmpty) _note(context, 'Changes requested: ${c!.decisionNote}', danger: true),
              if (_status == 'paused' && (c?.decisionNote ?? '').isNotEmpty) _note(context, 'Paused: ${c!.decisionNote}'),
              if (editable && withdrawingStatuses.contains(_status))
                _note(
                  context,
                  'Any change you save withdraws ${_status == 'pending_approval' ? 'the submission' : 'the approval'}; it then needs approval again.',
                ),
              if (!editable && c != null && !lockedStatuses.contains(_status) && !c.started && !c.canEdit)
                _note(context, 'You can view this campaign. Editing needs the "Create email campaigns" permission.'),
              if ((lockedStatuses.contains(_status) || (c?.started ?? false)) && _status != 'cancelled')
                _note(context, 'This campaign has started. What was sent is kept as the record. To change it, duplicate it and send the copy.'),
              if (_error != null) _note(context, _error!, danger: true),
              _details(context, editable),
              _audience(context, editable),
              _content(context, editable),
              _previewCard(context),
              if (!lockedStatuses.contains(_status) && !(c?.started ?? false)) _checklist(context, checks),
              _actions(context, ready),
              if (c != null && (c.started || c.counts.total > 0)) _progress(context, c),
              if (c != null && c.history.isNotEmpty) _history(context, c),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _cancelEdits() async {
    if (_isNew) {
      await _leave();
      return;
    }
    await _load();
  }

  Widget _note(BuildContext context, String text, {bool danger = false}) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: Gap.m),
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(
        color: danger ? theme.colorScheme.errorContainer : theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Semantics(
        liveRegion: danger,
        child: Text(text, style: TextStyle(color: danger ? theme.colorScheme.onErrorContainer : null)),
      ),
    );
  }

  Widget _details(BuildContext context, bool editable) {
    final mailboxes = _meta.senderMailboxes;
    final mailbox = mailboxes.where((m) => m.id == _d.senderAccountId).firstOrNull;
    final hostinger = _d.senderAccountId != null && mailbox?.provider == 'hostinger';
    final value = _d.senderAccountId != null ? 'mb:${_d.senderAccountId}' : (_d.fromEmail.isNotEmpty ? 'ses:${_d.fromEmail}' : null);
    final options = [
      for (final m in mailboxes)
        ('mb:${m.id}', '${m.email} · ${providerLabels[m.provider] ?? m.provider} · ${formatCount(m.sentToday)} of ${formatCount(m.dailyCap)} today'),
      for (final s in _meta.senders) ('ses:$s', '$s · Amazon SES'),
    ];
    final known = options.any((o) => o.$1 == value);
    return SectionCard(
      title: 'Details',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _name,
            enabled: editable,
            textCapitalization: TextCapitalization.sentences,
            inputFormatters: [LengthLimitingTextInputFormatter(120)],
            onChanged: (v) => _change(() => _d.name = v),
            decoration: const InputDecoration(labelText: 'Campaign name', helperText: 'Only staff see this.'),
          ),
          const SizedBox(height: Gap.m),
          DropdownButtonFormField<String>(
            key: ValueKey('from-$value'),
            initialValue: known ? value : null,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Send from',
              helperMaxLines: 8,
              helperText: options.isEmpty
                  ? "Ask a mailbox's administrator to allow it for campaigns in Email settings, with a daily limit."
                  : 'Only connected mailboxes an administrator has allowed for campaigns. Each has its own daily limit.'
                        '${mailbox != null && mailbox.cooldownUntil.isNotEmpty ? ' The provider limited this mailbox recently; it rests until ${fullTime(mailbox.cooldownUntil)}.' : ''}',
            ),
            hint: Text(value != null && !known ? '${mailbox?.email ?? _d.fromEmail} (not available to you)' : 'Choose a mailbox'),
            items: [
              for (final (key, label) in options)
                DropdownMenuItem(
                  value: key,
                  child: Text(label, overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: !editable
                ? null
                : (picked) {
                    if (picked == null) return;
                    final id = picked.substring(3);
                    _change(() {
                      if (picked.startsWith('mb:')) {
                        final m = mailboxes.firstWhere((x) => x.id == id);
                        _d
                          ..senderAccountId = id
                          ..fromEmail = m.email;
                        if (m.provider == 'hostinger') {
                          _d.replyTo = '';
                          _replyTo.text = '';
                        }
                      } else {
                        _d
                          ..senderAccountId = null
                          ..fromEmail = id;
                      }
                    });
                  },
          ),
          const SizedBox(height: Gap.m),
          TextField(
            controller: _fromName,
            enabled: editable,
            textCapitalization: TextCapitalization.words,
            inputFormatters: [LengthLimitingTextInputFormatter(120), FilteringTextInputFormatter.deny(RegExp(r'[\r\n]'))],
            onChanged: (v) => _change(() => _d.fromName = v),
            decoration: const InputDecoration(labelText: 'Sender name'),
          ),
          const SizedBox(height: Gap.m),
          TextField(
            controller: _replyTo,
            enabled: editable && !(hostinger && _d.replyTo.isEmpty),
            keyboardType: TextInputType.emailAddress,
            inputFormatters: [LengthLimitingTextInputFormatter(254)],
            onChanged: (v) => _change(() => _d.replyTo = v),
            decoration: InputDecoration(
              labelText: 'Replies go to (optional)',
              helperText: hostinger ? 'Hostinger cannot set a separate reply-to address: replies go to the sending mailbox.' : null,
              helperMaxLines: 8,
            ),
          ),
          const SizedBox(height: Gap.m),
          InputDecorator(
            decoration: InputDecoration(
              labelText: 'Send time (optional)',
              helperMaxLines: 8,
              helperText:
                  '${_d.sendAt != null ? 'Sending starts at or after this time, once approved.' : 'Empty: sending starts after approval.'} It goes out in batches within the daily limits.'
                  '${_meta.scheduler ? '' : ' No unattended scheduler is set up, so batches go out while someone is using Dikho, or when someone presses Send next batch.'}',
            ),
            child: Row(
              children: [
                Expanded(child: Text(_d.sendAt == null ? 'As soon as approved' : fullTime(_d.sendAt!.toUtc().toIso8601String()))),
                if (editable) TextButton(onPressed: () => unawaited(_pickSendAt()), child: const Text('Choose')),
                if (editable && _d.sendAt != null) TextButton(onPressed: () => _change(() => _d.sendAt = null), child: const Text('Clear')),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _audience(BuildContext context, bool editable) {
    final theme = Theme.of(context);
    final a = _d.audience;
    final p = a.sources.isEmpty ? null : _preview;
    final o = _options;
    final subMedia = (o?.subMedia ?? const []).where((s) => a.media.isEmpty || a.media.contains(s.mediaId)).toList();
    return SectionCard(
      title: 'Audience',
      subtitle: 'Only addresses with recorded marketing consent are ever sent to.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final e in sourceLabels.entries)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: a.sources.contains(e.key),
              onChanged: !editable ? null : (on) => _change(() => on == true ? a.sources.add(e.key) : a.sources.remove(e.key), audience: true),
              title: Text(e.value),
              subtitle: Text(p?.canUse[e.key] == false ? 'You cannot see ${e.value.toLowerCase()}, so none are included.' : sourceHelp[e.key]!),
              secondary: a.sources.contains(e.key) && p != null ? Text(formatCount(p.bySource[e.key] ?? 0)) : null,
            ),
          const SizedBox(height: Gap.s),
          Text('Narrow it down (optional)', style: theme.textTheme.titleSmall),
          _Tokens(
            label: 'Country',
            values: a.country,
            suggestions: o?.countries ?? const [],
            enabled: editable,
            onChanged: () => _change(() {}, audience: true),
          ),
          _Tokens(
            label: 'State',
            values: a.state,
            suggestions: o?.states ?? const [],
            enabled: editable,
            onChanged: () => _change(() {}, audience: true),
          ),
          _Tokens(
            label: 'City',
            values: a.city,
            suggestions: o?.cities ?? const [],
            enabled: editable,
            onChanged: () => _change(() {}, audience: true),
          ),
          _Tokens(
            label: 'Media',
            values: a.media,
            choices: [for (final m in o?.media ?? const <({String id, String name})>[]) (m.id, m.name)],
            enabled: editable,
            onChanged: () => _change(() => a.subMedia.clear(), audience: true),
          ),
          _Tokens(
            label: 'Sub media',
            values: a.subMedia,
            choices: [for (final s in subMedia) (s.id, s.name)],
            enabled: editable,
            onChanged: () => _change(() {}, audience: true),
          ),
          if (a.country.isNotEmpty || a.state.isNotEmpty || a.media.isNotEmpty || a.subMedia.isNotEmpty)
            Text(
              [
                if (a.country.isNotEmpty || a.state.isNotEmpty) 'Leads have no country or state, so a country or state filter leaves them out.',
                if (a.media.isNotEmpty || a.subMedia.isNotEmpty) 'Media filters apply to vendors only; clients and leads are left out.',
              ].join(' '),
              style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
            ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: a.activeOnly,
            onChanged: !editable ? null : (v) => _change(() => a.activeOnly = v, audience: true),
            title: const Text('Only active clients and vendors'),
          ),
          const Divider(),
          Semantics(
            liveRegion: true,
            child: Text(
              p == null ? (a.sources.isEmpty ? 'Choose who to send to.' : 'Counting…') : '${formatCount(p.eligible)} will receive this email',
              style: theme.textTheme.titleMedium,
            ),
          ),
          if (_previewError != null) Text(_previewError!, style: TextStyle(color: theme.colorScheme.error)),
          if (p != null) ...[
            FactRow(label: 'Matched', child: Text(formatCount(p.matched))),
            FactRow(label: 'No consent recorded', child: Text(formatCount(p.noConsent))),
            FactRow(label: 'Unsubscribed', child: Text(formatCount(p.unsubscribed))),
            FactRow(label: 'Suppressed (bounced)', child: Text(formatCount(p.suppressed))),
            if (p.eligible == 0 && p.matched > 0)
              Padding(
                padding: const EdgeInsets.only(top: Gap.s),
                child: Row(
                  children: [
                    const Expanded(child: Text('Nobody here has agreed to marketing email yet. Record consent first.')),
                    TextButton(onPressed: () => widget.onOpenPage('/email/consent'), child: const Text('Consent')),
                  ],
                ),
              ),
            if (p.sample.isNotEmpty) ...[
              const SizedBox(height: Gap.s),
              Text('First few recipients', style: theme.textTheme.labelLarge),
              for (final r in p.sample)
                Text(
                  '${r.name.isEmpty ? r.email : r.name}${r.name.isEmpty ? '' : ' · ${r.email}'}${r.company.isEmpty ? '' : ' · ${r.company}'}',
                  style: const TextStyle(fontSize: 13),
                ),
            ],
          ],
          const SizedBox(height: Gap.s),
          Text(
            'The list is fixed when the campaign is submitted. Consent is checked again just before each email is sent.',
            style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }

  Widget _content(BuildContext context, bool editable) {
    final theme = Theme.of(context);
    final designed = _d.html.trim().isNotEmpty && designedHtml(_d.html);
    final variables = _meta.variables;
    return SectionCard(
      title: 'Content',
      child: Column(
        key: ValueKey('content-$_contentKey'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (editable && _templates.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.m),
              child: DropdownButtonFormField<String>(
                key: ValueKey('template-$_contentKey'),
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Start from a template (optional)'),
                items: [
                  for (final t in _templates)
                    DropdownMenuItem(
                      value: t.id,
                      child: Text(t.name, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (id) {
                  final t = _templates.where((x) => x.id == id).firstOrNull;
                  if (t != null) unawaited(_applyTemplate(t));
                },
              ),
            ),
          TextField(
            controller: _subject,
            enabled: editable,
            inputFormatters: [LengthLimitingTextInputFormatter(900), FilteringTextInputFormatter.deny(RegExp(r'[\r\n]'))],
            onChanged: (v) => _change(() => _d.subject = v),
            decoration: const InputDecoration(labelText: 'Subject'),
          ),
          if (editable && variables.isNotEmpty)
            Wrap(
              spacing: Gap.s,
              children: [
                for (final e in variables.entries)
                  ActionChip(
                    label: Text('+ ${e.value}'),
                    tooltip: 'Add {{${e.key}}} to the subject',
                    onPressed: () => _change(() {
                      _d.subject = '${_d.subject}{{${e.key}}}';
                      _subject.text = _d.subject;
                    }),
                  ),
              ],
            ),
          const SizedBox(height: Gap.m),
          TextField(
            controller: _preheader,
            enabled: editable,
            inputFormatters: [LengthLimitingTextInputFormatter(200), FilteringTextInputFormatter.deny(RegExp(r'[\r\n]'))],
            onChanged: (v) => _change(() => _d.preheader = v),
            decoration: const InputDecoration(labelText: 'Preview text (optional)', helperText: 'Shown after the subject in most inboxes.'),
          ),
          const SizedBox(height: Gap.m),
          if (designed)
            Text(
              'This message was designed on a computer, with its own layout, so it is shown below as recipients see it. '
              'Change it on a computer, or replace it from a template.',
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            )
          else
            TextField(
              controller: _body,
              enabled: editable,
              minLines: 6,
              maxLines: null,
              keyboardType: TextInputType.multiline,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (v) => _change(() => _d.html = textToHtml(v)),
              decoration: const InputDecoration(
                labelText: 'Message',
                alignLabelWithHint: true,
                helperText: 'Plain text. A blank line starts a new paragraph. The unsubscribe footer is added for you.',
                helperMaxLines: 8,
              ),
            ),
          if (editable && variables.isNotEmpty && !designed)
            Wrap(
              spacing: Gap.s,
              children: [
                for (final e in variables.entries)
                  ActionChip(
                    label: Text('+ ${e.value}'),
                    tooltip: 'Add {{${e.key}}} to the message',
                    onPressed: () => _change(() {
                      _body.text = '${_body.text}{{${e.key}}}';
                      _d.html = textToHtml(_body.text);
                    }),
                  ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _previewCard(BuildContext context) {
    final mailbox = _meta.senderMailboxes.where((m) => m.id == _d.senderAccountId).firstOrNull;
    final from = mailbox?.email ?? _d.fromEmail;
    return SectionCard(
      title: 'Preview',
      subtitle: 'With sample values. The unsubscribe footer is added when it is sent.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          FactRow(label: 'From', child: Text('${_d.fromName.isEmpty ? 'Dikho' : _d.fromName} <${from.isEmpty ? 'not chosen' : from}>')),
          FactRow(label: 'Subject', child: Text(_d.subject.isEmpty ? '(no subject)' : withSample(_d.subject))),
          if (_d.preheader.isNotEmpty) FactRow(label: 'Preview', child: Text(withSample(_d.preheader))),
          const SizedBox(height: Gap.m),
          if (_d.html.trim().isEmpty)
            const Text('No message yet.')
          else
            MessageBody(
              key: ValueKey('preview-$_contentKey-${_d.html.length}'),
              html: withSample(_d.html),
              text: htmlToText(withSample(_d.html)),
              onOpenLink: (_) async {},
            ),
        ],
      ),
    );
  }

  Widget _checklist(BuildContext context, List<Check> checks) {
    final theme = Theme.of(context);
    return SectionCard(
      title: 'Checklist',
      footnote: _meta.ready
          ? null
          : 'Sending is not switched on yet (needs ${_meta.missing.isEmpty ? 'server setup' : _meta.missing}). You can still prepare and approve campaigns.',
      child: Column(
        children: [
          for (final x in checks)
            MergeSemantics(
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                leading: Icon(
                  x.ok ? Icons.check_circle : Icons.error_outline,
                  color: x.ok ? Colors.green.shade700 : theme.colorScheme.error,
                  semanticLabel: x.ok ? 'Done' : 'To do',
                ),
                title: Text(x.label),
              ),
            ),
        ],
      ),
    );
  }

  Widget _actions(BuildContext context, bool ready) {
    final theme = Theme.of(context);
    final c = _c;
    final muted = TextStyle(color: theme.colorScheme.onSurfaceVariant);
    if (c == null) {
      return SectionCard(
        title: 'Next step',
        child: Text('Save the draft to send yourself a test and submit it for approval.', style: muted),
      );
    }
    final status = _status;
    final canControl = widget.canCreate || c.canApprove;
    final wrote = c.wroteIt(widget.userId);
    final children = <Widget>[];
    if ((status == 'draft' || status == 'rejected') && _editable) {
      children.addAll([
        FilledButton.icon(
          onPressed: !ready || _saving
              ? null
              : () async {
                  final ok = await _confirm(
                    title: 'Submit for approval?',
                    body:
                        'The recipient list is fixed now${_eligible != null ? ' (${formatCount(_eligible!)} people with consent)' : ''}. Another person with approval rights must approve it before anything is sent.',
                    action: _dirty ? 'Save and submit' : 'Submit',
                  );
                  if (!ok) return;
                  if (_dirty && !await _save(quiet: true)) return;
                  await _act(() => _api.submitCampaign(c.id), 'Submitted for approval.');
                },
          icon: const Icon(Icons.verified_user_outlined),
          label: Text(_dirty ? 'Save and submit for approval' : 'Submit for approval'),
        ),
        OutlinedButton.icon(
          onPressed: !_meta.ready
              ? null
              : () async {
                  if (_dirty && !await _save(quiet: true)) return;
                  await _act(() => _api.testCampaign(c.id), 'Test sent to your own address.');
                },
          icon: const Icon(Icons.send_outlined),
          label: const Text('Send a test to me'),
        ),
        if (!ready) Text('Finish the checklist to submit.', style: muted),
      ]);
    } else if (status == 'draft' || status == 'rejected') {
      children.add(Text('A draft. Only people who can create campaigns can submit it.', style: muted));
    }
    if (status == 'pending_approval') {
      children.addAll([
        FactRow(label: 'Submitted by', child: Text(c.submittedByName.isEmpty ? '–' : c.submittedByName)),
        FactRow(label: 'Submitted', child: Text(syncedAgo(c.submittedAt, _now))),
        FactRow(label: 'Recipients (fixed)', child: Text(formatCount(c.recipientCount))),
        FactRow(
          label: 'Fingerprint',
          child: Text(c.fingerprint, style: const TextStyle(fontFamily: 'monospace')),
        ),
        if (!c.canApprove) Text('Waiting for someone with approval rights.', style: muted),
        if (c.canApprove && wrote) Text('You wrote, edited or submitted this campaign, so another approver must decide.', style: muted),
        if (c.canApprove && !wrote) ...[
          Text('Check the preview, the sender and the audience. Your approval covers exactly this version.', style: muted),
          FilledButton.icon(
            onPressed: () async {
              final ok = await _confirm(
                title: 'Approve this campaign?',
                body:
                    'You approve exactly what you reviewed (fingerprint ${c.fingerprint}): this content, sender, schedule and the ${formatCount(c.recipientCount)} recipients. Any later change withdraws your approval.',
                action: 'Approve sending to ${formatCount(c.recipientCount)}',
              );
              if (ok) await _act(() => _api.decideCampaign(c.id, approve: true, hash: c.snapshotHash), 'Approved.');
            },
            icon: const Icon(Icons.check),
            label: const Text('Approve'),
          ),
          OutlinedButton(
            onPressed: () async {
              final note = await showDialog<String>(context: context, builder: (_) => const _RequestChanges());
              if (note != null) {
                await _act(() => _api.decideCampaign(c.id, approve: false, hash: c.snapshotHash, note: note), 'Sent back with your note.');
              }
            },
            child: const Text('Request changes'),
          ),
        ],
      ]);
    }
    if (status == 'approved') {
      final later = DateTime.tryParse(c.raw['send_at']?.toString() ?? '')?.isAfter(_now) ?? false;
      children.add(
        Text(
          'Approved by ${c.approvedByName.isEmpty ? 'an approver' : c.approvedByName} ${syncedAgo(c.approvedAt, _now)}. '
          '${later ? 'Sending starts at or after ${fullTime(c.sendAt)}.' : 'Sending has been released, in batches within the daily limits.'}'
          '${_meta.scheduler ? '' : ' Batches go out while someone is using Dikho, or with Send next batch.'}',
          style: muted,
        ),
      );
    }
    if (status == 'sending') children.add(Text('Sending in batches. ${formatCount(c.counts.queued)} still to go.', style: muted));
    if ({'approved', 'sending'}.contains(status) && canControl && _meta.ready) {
      children.add(
        OutlinedButton.icon(
          onPressed: () => unawaited(_act(_api.dispatchCampaigns, 'Batch processed. The counts update in a moment.')),
          icon: const Icon(Icons.send_outlined),
          label: const Text('Send next batch now'),
        ),
      );
    }
    if (status == 'paused') children.add(Text('Paused. Nothing more is sent until it is resumed.', style: muted));
    if (status == 'sent') children.add(Text('Finished ${syncedAgo(c.finishedAt, _now)}.', style: muted));
    if (status == 'cancelled') children.add(Text('Cancelled ${syncedAgo(c.finishedAt, _now)}. Anything already sent stays recorded.', style: muted));
    if (canControl && !{'sent', 'cancelled'}.contains(status)) {
      children.add(
        Wrap(
          spacing: Gap.s,
          runSpacing: Gap.s,
          children: [
            if ({'approved', 'sending'}.contains(status))
              OutlinedButton(
                onPressed: () async {
                  if (await _confirm(
                    title: 'Pause sending?',
                    body: 'No more emails go out until someone resumes it. Emails already sent are not affected.',
                    action: 'Pause campaign',
                  )) {
                    await _act(() => _api.controlCampaign(c.id, 'pause'), 'Paused.');
                  }
                },
                child: const Text('Pause'),
              ),
            if (status == 'paused')
              FilledButton(
                onPressed: () async {
                  if (await _confirm(
                    title: 'Resume sending?',
                    body: 'Sending continues with the approved version, within the daily limit.',
                    action: 'Resume campaign',
                  )) {
                    await _act(() => _api.controlCampaign(c.id, 'resume'), 'Resumed.');
                  }
                },
                child: const Text('Resume'),
              ),
            OutlinedButton(
              style: OutlinedButton.styleFrom(foregroundColor: theme.colorScheme.error),
              onPressed: () async {
                if (await _confirm(
                  title: 'Cancel this campaign?',
                  body: 'Nobody else receives it. Emails already sent stay recorded. This cannot be undone; duplicate it to send again.',
                  action: 'Cancel campaign',
                  danger: true,
                )) {
                  await _act(() => _api.controlCampaign(c.id, 'cancel'), 'Cancelled.');
                }
              },
              child: const Text('Cancel campaign'),
            ),
          ],
        ),
      );
    }
    return SectionCard(
      title: status == 'pending_approval' ? 'Approval' : 'Next step',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final w in children)
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.s),
              child: w,
            ),
        ],
      ),
    );
  }

  Widget _progress(BuildContext context, Campaign c) {
    final counts = c.counts;
    final total = counts.total > 0 ? counts.total : c.recipientCount;
    final share = total > 0 ? counts.sent / total : 0.0;
    final rows = [
      ('Sent', counts.sent, true),
      ('Delivered', counts.delivered, true),
      ('Bounced', counts.bounced, false),
      ('Marked as spam', counts.complained, false),
      ('Unsubscribed', counts.n('unsubscribed'), false),
      ('Failed', counts.failed, false),
      ('Unconfirmed', counts.uncertain, false),
      ('Skipped', counts.skipped, false),
    ].where((r) => r.$3 || r.$2 > 0);
    return SectionCard(
      title: 'Delivery',
      subtitle: 'Sent means the mail provider accepted the message, which is not proof it arrived. Opens and clicks are not tracked.',
      footnote: counts.uncertain > 0
          ? 'Unconfirmed: the mail provider did not answer in time, so these may or may not have gone out. They are not sent again, to avoid duplicates.'
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            label: 'Share sent',
            value: '${(share * 100).round()}%',
            child: LinearProgressIndicator(value: share, minHeight: 8, borderRadius: BorderRadius.circular(4)),
          ),
          const SizedBox(height: Gap.xs),
          Text(
            '${formatCount(counts.sent)} of ${formatCount(total)} sent (${(share * 100).round()}%)${counts.queued > 0 ? ' · ${formatCount(counts.queued)} waiting' : ''}',
          ),
          for (final (label, n, _) in rows) FactRow(label: label, child: Text(formatCount(n))),
        ],
      ),
    );
  }

  Widget _history(BuildContext context, Campaign c) {
    final muted = TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurfaceVariant);
    return SectionCard(
      title: 'History',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final h in c.history.reversed)
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.s),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(campaignEvents[h.event] ?? h.event.replaceFirst('email_campaign.', ''), style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text('${h.by.isEmpty ? 'System' : h.by} · ${fullTime(h.at)}', style: muted),
                  if (h.note.isNotEmpty) Text('"${h.note}"'),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// "Request changes": the note the author gets back with their draft.
class _RequestChanges extends StatefulWidget {
  const _RequestChanges();

  @override
  State<_RequestChanges> createState() => _RequestChangesState();
}

class _RequestChangesState extends State<_RequestChanges> {
  final _note = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Request changes'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text('The campaign goes back to its author as a draft, with your note.'),
        const SizedBox(height: Gap.m),
        TextField(
          controller: _note,
          autofocus: true,
          minLines: 2,
          maxLines: 5,
          textCapitalization: TextCapitalization.sentences,
          inputFormatters: [LengthLimitingTextInputFormatter(500)],
          decoration: InputDecoration(labelText: 'What needs to change', errorText: _error),
        ),
      ],
    ),
    actions: [
      TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
      FilledButton(
        onPressed: () {
          final note = _note.text.trim();
          if (note.isEmpty) {
            setState(() => _error = 'Say what needs to change.');
            return;
          }
          Navigator.of(context).pop(note);
        },
        child: const Text('Send back'),
      ),
    ],
  );
}

/// Several values for one filter: typed with suggestions, or chosen from a list.
class _Tokens extends StatefulWidget {
  const _Tokens({
    required this.label,
    required this.values,
    required this.enabled,
    required this.onChanged,
    this.suggestions = const [],
    this.choices,
  });

  final String label;
  final List<String> values;
  final List<String> suggestions;
  final List<(String, String)>? choices;
  final bool enabled;
  final VoidCallback onChanged;

  @override
  State<_Tokens> createState() => _TokensState();
}

class _TokensState extends State<_Tokens> {
  String _name(String v) => widget.choices?.where((c) => c.$1 == v).firstOrNull?.$2 ?? v;

  void _add(String raw) {
    final v = raw.trim();
    if (v.isEmpty || widget.values.any((x) => x.toLowerCase() == v.toLowerCase()) || widget.values.length >= 50) return;
    widget.values.add(v);
    widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final choices = widget.choices;
    return Padding(
      padding: const EdgeInsets.only(top: Gap.s),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.values.isNotEmpty)
            Wrap(
              spacing: Gap.s,
              children: [
                for (final v in widget.values)
                  InputChip(
                    label: Text(_name(v)),
                    deleteButtonTooltipMessage: 'Remove ${_name(v)}',
                    onDeleted: widget.enabled
                        ? () {
                            widget.values.remove(v);
                            widget.onChanged();
                          }
                        : null,
                  ),
              ],
            ),
          if (choices != null)
            DropdownButtonFormField<String>(
              key: ValueKey('${widget.label}-${widget.values.length}-${choices.length}'),
              isExpanded: true,
              decoration: InputDecoration(labelText: widget.label),
              hint: Text(choices.isEmpty ? 'None available' : 'Add ${widget.label.toLowerCase()}'),
              items: [
                for (final (id, name) in choices)
                  if (!widget.values.contains(id))
                    DropdownMenuItem(
                      value: id,
                      child: Text(name, overflow: TextOverflow.ellipsis),
                    ),
              ],
              onChanged: widget.enabled && choices.isNotEmpty ? (v) => v == null ? null : _add(v) : null,
            )
          else
            Autocomplete<String>(
              optionsBuilder: (value) {
                final typed = value.text.trim().toLowerCase();
                if (typed.isEmpty) return const Iterable<String>.empty();
                return widget.suggestions.where((s) => s.toLowerCase().contains(typed)).take(12);
              },
              onSelected: (v) => _add(v),
              fieldViewBuilder: (context, controller, focus, submit) => TextField(
                controller: controller,
                focusNode: focus,
                enabled: widget.enabled,
                textCapitalization: TextCapitalization.words,
                onSubmitted: (v) {
                  _add(v);
                  controller.clear();
                },
                decoration: InputDecoration(labelText: widget.label),
              ),
            ),
        ],
      ),
    );
  }
}
