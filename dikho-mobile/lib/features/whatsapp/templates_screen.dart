import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../../shared/values.dart';
import '../inbox/chat_theme.dart';
import 'whatsapp_models.dart';

/// The approved templates from the WhatsApp Business account, each with a preview of
/// how it arrives, as the web Templates page shows them.
class TemplatesScreen extends StatefulWidget {
  const TemplatesScreen({super.key, required this.api, required this.onOpenDrawer});

  final CrmApi api;
  final VoidCallback onOpenDrawer;

  @override
  State<TemplatesScreen> createState() => _TemplatesScreenState();
}

class _TemplatesScreenState extends State<TemplatesScreen> {
  TemplateList? _list;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/templates');
      if (mounted) {
        setState(() {
          _list = TemplateList.from(data);
          _error = null;
        });
      }
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  void _open(TemplateInfo template) {
    unawaited(Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => TemplatePreviewScreen(template: template))));
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
        title: const Text('Templates'),
      ),
      body: list == null
          ? (_error == null
                ? const Center(child: CircularProgressIndicator())
                : EmptyMessage(title: "Couldn't load templates", body: _error!, action: 'Try again', onAction: () => unawaited(_load())))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(Gap.l),
                children: [
                  Text(
                    'Approved message templates pulled from your WhatsApp Business account.',
                    style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: Gap.m),
                  if (list.fallback) ...[
                    _Notice(
                      text:
                          'Showing the local fallback template, because the WhatsApp Business account could not be reached. '
                          'An administrator should check the WhatsApp settings on the server.',
                    ),
                    const SizedBox(height: Gap.m),
                  ],
                  if (list.templates.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: Gap.xl),
                      child: Text('No approved templates yet.', textAlign: TextAlign.center),
                    ),
                  for (final template in list.templates) ...[
                    _TemplateCard(key: ValueKey(template.key), template: template, onTap: () => _open(template)),
                    const SizedBox(height: Gap.s),
                  ],
                ],
              ),
            ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(color: scheme.secondaryContainer, borderRadius: BorderRadius.circular(12)),
      child: Text(text, style: TextStyle(color: scheme.onSecondaryContainer)),
    );
  }
}

class _TemplateCard extends StatelessWidget {
  const _TemplateCard({super.key, required this.template, required this.onTap});

  final TemplateInfo template;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: theme.colorScheme.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(Gap.m),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(template.name, style: theme.textTheme.titleSmall),
              const SizedBox(height: Gap.s),
              _Badges(template: template),
              const SizedBox(height: Gap.s),
              Text(
                template.bodyText,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Badges extends StatelessWidget {
  const _Badges({required this.template});

  final TemplateInfo template;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: Gap.xs,
    runSpacing: Gap.xs,
    children: [
      if (template.status.isNotEmpty) Pill(label: sentenceCase(template.status), tone: PillTone.active),
      if (template.language.isNotEmpty) Pill(label: template.language),
      if (template.category.isNotEmpty) Pill(label: sentenceCase(template.category)),
      if (template.mediaLabel != null) Pill(label: '${template.mediaLabel} header'),
      Pill(label: template.hasVariables ? 'Has variables' : 'Static', tone: template.hasVariables ? PillTone.pending : PillTone.neutral),
    ],
  );
}

/// One template, as the person receiving it sees it in WhatsApp.
class TemplatePreviewScreen extends StatelessWidget {
  const TemplatePreviewScreen({super.key, required this.template});

  final TemplateInfo template;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(template.name, maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: ListView(
        padding: const EdgeInsets.all(Gap.l),
        children: [
          _Badges(template: template),
          const SizedBox(height: Gap.l),
          TemplateBubble(template: template),
          const SizedBox(height: Gap.m),
          if (template.hasVariables)
            Text(
              'Values in {{double braces}} are filled in for each person when the template is sent.',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
        ],
      ),
    );
  }
}

/// The message as it arrives in WhatsApp, on WhatsApp's own colours, because it is a
/// picture of their app. [headerText] and [bodyText] replace the template's own, for a
/// preview with one person's values filled in.
class TemplateBubble extends StatelessWidget {
  const TemplateBubble({super.key, required this.template, this.headerText, this.bodyText, this.mediaNote});

  final TemplateInfo template;
  final String? headerText;
  final String? bodyText;

  /// What fills a photo, video or document header, such as the chosen file's name.
  final String? mediaNote;

  static const _canvas = Color(0xFF0B141A);
  static const _bubble = Color(0xFF005C4B);
  static const _text = Color(0xFFE9EDEF);
  static const _soft = Color(0xB3E9EDEF);

  @override
  Widget build(BuildContext context) {
    final header = headerText ?? template.headerText;
    final body = bodyText ?? template.bodyText;
    return Semantics(
      label: 'Preview of the message as it arrives in WhatsApp',
      child: Container(
        padding: const EdgeInsets.fromLTRB(Gap.m, Gap.l, Gap.m, Gap.xl),
        decoration: BoxDecoration(color: _canvas, borderRadius: BorderRadius.circular(20)),
        child: Align(
          alignment: Alignment.centerRight,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 320),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.fromLTRB(Gap.s + 2, Gap.s, Gap.s + 2, Gap.xs + 2),
                  decoration: const BoxDecoration(
                    color: _bubble,
                    borderRadius: BorderRadius.only(
                      topLeft: Radius.circular(10),
                      bottomLeft: Radius.circular(10),
                      bottomRight: Radius.circular(10),
                      topRight: Radius.circular(2),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (template.mediaLabel != null)
                        Container(
                          height: 140,
                          margin: const EdgeInsets.only(bottom: Gap.s),
                          padding: const EdgeInsets.all(Gap.s),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(8)),
                          child: Text(
                            mediaNote ?? template.mediaLabel!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: _soft, fontWeight: FontWeight.w500),
                          ),
                        ),
                      if (header.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 3),
                          child: Text(
                            header,
                            style: const TextStyle(color: _text, fontWeight: FontWeight.w700),
                          ),
                        ),
                      Text(body, style: const TextStyle(color: _text, fontSize: 14.5, height: 1.4)),
                      if (template.footerText.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: Gap.xs),
                          child: Text(template.footerText, style: const TextStyle(color: _soft, fontSize: 12)),
                        ),
                      const Align(
                        alignment: Alignment.centerRight,
                        child: Padding(
                          padding: EdgeInsets.only(top: 2),
                          child: Icon(Icons.done_all, size: 16, color: Color(0xFF53BDEB)),
                        ),
                      ),
                    ],
                  ),
                ),
                for (final button in template.buttons)
                  Container(
                    margin: const EdgeInsets.only(top: 2),
                    padding: const EdgeInsets.symmetric(vertical: Gap.s + 2),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: _bubble, borderRadius: BorderRadius.circular(8)),
                    child: Text(
                      button,
                      style: const TextStyle(color: Color(0xFF53BDEB), fontWeight: FontWeight.w500),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
