import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import 'chat_theme.dart';
import 'inbox_api.dart';

/// Pick an approved template, fill its variables, see exactly what goes out, send.
/// Used by the chat composer and by Phone contacts. [onSend] throws to report a
/// refusal, which stays on the sheet.
///
/// [askConsent] is for numbers from outside the CRM: messaging people who never
/// agreed breaks WhatsApp's rules and can lower the business number's rating.
Future<bool?> showTemplateSheet(
  BuildContext context, {
  required InboxApi api,
  required String recipient,
  required Future<void> Function(ChatTemplate template, Map<String, String> values) onSend,
  bool askConsent = false,
}) => showModalBottomSheet<bool>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (_) => TemplateSheet(api: api, recipient: recipient, onSend: onSend, askConsent: askConsent),
);

class TemplateSheet extends StatefulWidget {
  const TemplateSheet({super.key, required this.api, required this.recipient, required this.onSend, this.askConsent = false});

  final InboxApi api;
  final String recipient;
  final Future<void> Function(ChatTemplate template, Map<String, String> values) onSend;
  final bool askConsent;

  @override
  State<TemplateSheet> createState() => _TemplateSheetState();
}

class _TemplateSheetState extends State<TemplateSheet> {
  late Future<List<ChatTemplate>> _templates = widget.api.templates();
  final _search = TextEditingController();
  final _fields = <String, TextEditingController>{};
  String _query = '';
  ChatTemplate? _chosen;
  bool _consented = false;
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _search.dispose();
    for (final field in _fields.values) {
      field.dispose();
    }
    super.dispose();
  }

  void _choose(ChatTemplate? template) {
    for (final field in _fields.values) {
      field.dispose();
    }
    _fields.clear();
    if (template != null) {
      for (final variable in template.variables) {
        _fields[variable] = TextEditingController()..addListener(() => setState(() {}));
      }
    }
    setState(() {
      _chosen = template;
      _error = null;
      _consented = false;
    });
  }

  Map<String, String> get _values => {for (final e in _fields.entries) e.key: e.value.text};

  bool get _ready => _chosen != null && !_sending && (!widget.askConsent || _consented) && _fields.values.every((f) => f.text.trim().isNotEmpty);

  Future<void> _send() async {
    final template = _chosen;
    if (template == null) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await widget.onSend(template, _values);
      if (mounted) Navigator.of(context).pop(true);
    } on Exception catch (error) {
      if (mounted) {
        setState(() {
          _sending = false;
          _error = friendlyError(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.85),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.m),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Send an approved template', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 2),
                  Text(
                    'To ${widget.recipient}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            const Divider(),
            Flexible(
              child: FutureBuilder<List<ChatTemplate>>(
                future: _templates,
                builder: (context, snapshot) {
                  if (snapshot.hasError) return _failed();
                  final all = snapshot.data;
                  if (all == null) {
                    return const Padding(
                      padding: EdgeInsets.all(Gap.xl),
                      child: Center(child: CircularProgressIndicator()),
                    );
                  }
                  return _chosen == null ? _list(all) : _form(_chosen!);
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _failed() => Padding(
    padding: const EdgeInsets.all(Gap.xl),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text('Could not load the approved templates.', textAlign: TextAlign.center),
        const SizedBox(height: Gap.m),
        FilledButton(onPressed: () => setState(() => _templates = widget.api.templates()), child: const Text('Try again')),
      ],
    ),
  );

  Widget _list(List<ChatTemplate> all) {
    final theme = Theme.of(context);
    final usable = all.where((t) => t.usable).toList();
    final hidden = all.length - usable.length;
    final q = _query.toLowerCase();
    final shown = q.isEmpty ? usable : usable.where((t) => t.name.toLowerCase().contains(q) || t.bodyText.toLowerCase().contains(q)).toList();
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.all(Gap.m),
          child: TextField(
            controller: _search,
            onChanged: (value) => setState(() => _query = value.trim()),
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search templates'),
          ),
        ),
        Flexible(
          child: shown.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(Gap.xl),
                  child: Text(
                    usable.isEmpty ? 'No approved templates can be sent from here yet.' : 'No templates match that search.',
                    textAlign: TextAlign.center,
                  ),
                )
              : ListView.builder(
                  shrinkWrap: true,
                  itemCount: shown.length,
                  itemBuilder: (context, index) {
                    final template = shown[index];
                    return ListTile(
                      minTileHeight: 64,
                      title: Text(template.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                      subtitle: Text(template.bodyText, maxLines: 2, overflow: TextOverflow.ellipsis),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => _choose(template),
                    );
                  },
                ),
        ),
        if (hidden > 0)
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.m),
            child: Text(
              'Templates with a photo, video or document header, or a link with a variable, are not listed: they need values this form does not collect.',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
      ],
    );
  }

  Widget _form(ChatTemplate template) {
    final theme = Theme.of(context);
    return ListView(
      shrinkWrap: true,
      padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.l),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: _sending ? null : () => _choose(null),
            icon: const Icon(Icons.arrow_back, size: 18),
            label: const Text('All templates'),
          ),
        ),
        Text(template.name, style: theme.textTheme.titleSmall),
        const SizedBox(height: Gap.m),
        for (final entry in _fields.entries) ...[
          TextField(
            controller: entry.value,
            enabled: !_sending,
            maxLength: 1024,
            decoration: InputDecoration(labelText: '{{${entry.key}}}', counterText: ''),
          ),
          const SizedBox(height: Gap.m),
        ],
        _Preview(header: template.headerText, body: template.preview(_values), footer: template.footerText),
        const SizedBox(height: Gap.s),
        Text(
          'WhatsApp charges this as a ${template.category.toLowerCase()} conversation.',
          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        if (widget.askConsent)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _consented,
            onChanged: _sending ? null : (value) => setState(() => _consented = value == true),
            title: const Text('This person agreed to hear from us on WhatsApp'),
          ),
        if (_error != null)
          Container(
            margin: const EdgeInsets.only(top: Gap.s),
            padding: const EdgeInsets.all(Gap.m),
            decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
            child: Text(_error!, style: TextStyle(color: theme.colorScheme.onErrorContainer)),
          ),
        const SizedBox(height: Gap.m),
        FilledButton(onPressed: _ready ? () => unawaited(_send()) : null, child: Text(_sending ? 'Sending…' : 'Send')),
      ],
    );
  }
}

class _Preview extends StatelessWidget {
  const _Preview({required this.header, required this.body, required this.footer});

  final String header;
  final String body;
  final String footer;

  @override
  Widget build(BuildContext context) {
    final chat = ChatColors.of(context);
    return Container(
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(color: chat.canvas, borderRadius: BorderRadius.circular(12)),
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
        decoration: BoxDecoration(color: chat.bubbleOut, borderRadius: BorderRadius.circular(8)),
        child: DefaultTextStyle.merge(
          style: TextStyle(fontSize: 13.5, height: 1.35, color: chat.bubbleOutText),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (header.isNotEmpty) Text(header, style: const TextStyle(fontWeight: FontWeight.w500)),
              Text(body),
              if (footer.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(footer, style: TextStyle(fontSize: 12, color: chat.meta)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
