import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/crm_api.dart';
import '../inbox/chat_theme.dart';
import '../whatsapp/analytics_parts.dart' show SectionCard;
import 'consent_models.dart';
import 'email_api.dart';

/// Marketing consent and suppression, one address at a time, as EmailConsent.jsx.
/// There is deliberately no list of everyone: staff look up the person they deal
/// with. Unsubscribe links, spam complaints and hard bounces are recorded by the
/// server; staff record how someone agreed, or asked to stop.
class EmailConsentScreen extends StatefulWidget {
  const EmailConsentScreen({super.key, required this.api, required this.canManage, required this.onOpenDrawer});

  final EmailApi api;

  /// email_consent.manage. Looking up needs it or email_campaigns.create.
  final bool canManage;
  final VoidCallback onOpenDrawer;

  @override
  State<EmailConsentScreen> createState() => _EmailConsentScreenState();
}

class _EmailConsentScreenState extends State<EmailConsentScreen> {
  final _query = TextEditingController();

  /// The field's own node: unfocusing the page's scope would leave the field as the
  /// scope's remembered child, and closing the form would hand it the keyboard again.
  final _queryFocus = FocusNode();
  ConsentRecord? _record;
  String? _fieldError;
  String? _error;
  bool _looking = false;
  bool _busy = false;

  /// Only the newest look-up may show its answer.
  int _asked = 0;

  @override
  void dispose() {
    _query.dispose();
    _queryFocus.dispose();
    super.dispose();
  }

  Future<void> _lookup() async {
    final email = lookupAddress(_query.text);
    if (email == null) {
      setState(() => _fieldError = 'Enter a full email address.');
      return;
    }
    _queryFocus.unfocus();
    final asked = ++_asked;
    setState(() {
      _looking = true;
      _fieldError = null;
      _error = null;
    });
    try {
      final record = await widget.api.preference(email);
      if (!mounted || asked != _asked) return;
      setState(() {
        _record = record;
        _looking = false;
      });
    } on ApiException catch (failure) {
      if (!mounted || asked != _asked) return;
      setState(() {
        _record = null;
        _error = failure.message;
        _looking = false;
      });
    }
  }

  /// Saves a change to the record on screen. Throws the server's refusal.
  Future<void> _change(Map<String, Object?> change, String done) async {
    final record = _record;
    if (record == null) return;
    setState(() => _busy = true);
    try {
      final next = await widget.api.setPreference(record.email, change);
      if (!mounted) return;
      setState(() => _record = next);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _recordChange({required bool subscribe}) async {
    final record = _record;
    if (record == null) return;
    // Closing the form would otherwise hand focus back to the address field, and its
    // keyboard would cover the result just saved.
    _queryFocus.unfocus();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheet) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheet).bottom),
        child: ConsentForm(
          email: record.email,
          subscribe: subscribe,
          onSave: (change) async {
            await _change(change, subscribe ? 'Consent recorded.' : 'Unsubscribe recorded.');
            if (sheet.mounted) Navigator.of(sheet).pop();
          },
        ),
      ),
    );
  }

  Future<void> _suppression({required bool suppress}) async {
    final record = _record;
    if (record == null) return;
    final theme = Theme.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text(suppress ? 'Suppress this address?' : 'Lift the suppression?'),
        content: Text(
          suppress
              ? 'No campaign email is sent to this address until the suppression is lifted.'
              : record.suppressedReason == 'hard_bounce'
              ? 'This address bounced permanently. Lift it only if you know it works again: repeated bounces damage the sending reputation of every Dikho email.'
              : 'Campaign email can reach this address again if it has consent.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Cancel')),
          FilledButton(
            style: suppress ? FilledButton.styleFrom(backgroundColor: theme.colorScheme.error, foregroundColor: theme.colorScheme.onError) : null,
            onPressed: () => Navigator.of(dialog).pop(true),
            child: Text(suppress ? 'Suppress' : 'Lift suppression'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await _change(suppress ? {'suppress': true} : {'unsuppress': true}, suppress ? 'Address suppressed.' : 'Suppression lifted.');
    } on ApiException catch (failure) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(failure.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final record = _record;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', icon: const Icon(Icons.menu), onPressed: widget.onOpenDrawer),
        title: const Text('Consent'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl * 2),
        children: [
          Text('Who has agreed to marketing email, who asked to stop, and which addresses must not be emailed.', style: muted),
          const SizedBox(height: Gap.m),
          SectionCard(
            title: 'Look up an address',
            subtitle: 'The record is the same wherever the address appears (client, vendor or lead).',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _query,
                  focusNode: _queryFocus,
                  decoration: InputDecoration(labelText: 'Email address', errorText: _fieldError),
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.search,
                  autocorrect: false,
                  enableSuggestions: false,
                  onChanged: (_) {
                    if (_fieldError != null) setState(() => _fieldError = null);
                  },
                  onSubmitted: (_) => unawaited(_lookup()),
                ),
                const SizedBox(height: Gap.m),
                Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton.icon(
                    onPressed: _looking ? null : () => unawaited(_lookup()),
                    icon: const Icon(Icons.search),
                    label: Text(_looking ? 'Looking…' : 'Look up'),
                  ),
                ),
              ],
            ),
          ),
          if (_error != null)
            Container(
              margin: const EdgeInsets.only(bottom: Gap.m),
              padding: const EdgeInsets.all(Gap.m),
              decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
              child: Semantics(
                liveRegion: true,
                child: Text(_error!, style: TextStyle(color: theme.colorScheme.onErrorContainer)),
              ),
            ),
          if (record != null) _result(context, record, muted),
          const SectionCard(title: 'How consent works', child: _Rules()),
        ],
      ),
    );
  }

  Widget _result(BuildContext context, ConsentRecord record, TextStyle muted) {
    final (tone, title, text) = record.state;
    return SectionCard(
      title: record.email,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _StateBanner(tone: tone, title: title, text: text),
          const SizedBox(height: Gap.m),
          _Detail(label: 'Marketing', value: record.marketingLabel),
          if (record.recorded.isNotEmpty) _Detail(label: 'Recorded', value: record.recorded),
          if (record.note.isNotEmpty) _Detail(label: 'Note', value: record.note),
          _Detail(label: 'Suppressed', value: record.suppressedLabel),
          const SizedBox(height: Gap.m),
          if (widget.canManage)
            Wrap(
              spacing: Gap.s,
              runSpacing: Gap.s,
              children: [
                if (!record.subscribed)
                  FilledButton(onPressed: _busy ? null : () => unawaited(_recordChange(subscribe: true)), child: const Text('Record consent')),
                if (!record.unsubscribed)
                  OutlinedButton(onPressed: _busy ? null : () => unawaited(_recordChange(subscribe: false)), child: const Text('Record unsubscribe')),
                if (record.suppressed)
                  OutlinedButton(onPressed: _busy ? null : () => unawaited(_suppression(suppress: false)), child: const Text('Lift suppression'))
                else
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
                    onPressed: _busy ? null : () => unawaited(_suppression(suppress: true)),
                    child: const Text('Suppress'),
                  ),
              ],
            )
          else
            Text('Changing consent needs the "Manage email consent" permission.', style: muted),
        ],
      ),
    );
  }
}

class _StateBanner extends StatelessWidget {
  const _StateBanner({required this.tone, required this.title, required this.text});

  final ConsentTone tone;
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    // The same greens and ambers as the status pills.
    final (Color ground, Color ink, IconData icon) = switch (tone) {
      ConsentTone.agreed =>
        dark
            ? (const Color(0xFF1F3B2A), const Color(0xFF8FD6A7), Icons.check_circle_outline)
            : (const Color(0xFFE6F4EA), const Color(0xFF1E6B3A), Icons.check_circle_outline),
      ConsentTone.stopped =>
        dark
            ? (const Color(0xFF3D3016), const Color(0xFFF2C46B), Icons.do_not_disturb_on_outlined)
            : (const Color(0xFFFFF4DE), const Color(0xFF8A5A00), Icons.do_not_disturb_on_outlined),
      ConsentTone.suppressed => (scheme.errorContainer, scheme.onErrorContainer, Icons.block),
      ConsentTone.none => (scheme.surfaceContainerHighest, scheme.onSurfaceVariant, Icons.shield_outlined),
    };
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(Gap.m),
        decoration: BoxDecoration(color: ground, borderRadius: BorderRadius.circular(12)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 20, color: ink),
            const SizedBox(width: Gap.m),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(fontWeight: FontWeight.w600, color: ink),
                  ),
                  if (text.isNotEmpty) Text(text, style: TextStyle(color: ink)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Detail extends StatelessWidget {
  const _Detail({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Gap.xs),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 104,
              child: Text(label, style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
            ),
            Expanded(child: Text(value)),
          ],
        ),
      ),
    );
  }
}

class _Rules extends StatelessWidget {
  const _Rules();

  static const _rules = [
    (Icons.check_circle_outline, 'Campaigns go only to addresses marked agreed, with how they agreed on record.'),
    (Icons.shield_outlined, 'It is checked when a campaign is submitted and again just before each email is sent.'),
    (
      Icons.unsubscribe_outlined,
      'Every campaign email has an unsubscribe link (and one-click unsubscribe in Gmail and Outlook). It takes effect immediately.',
    ),
    (
      Icons.report_outlined,
      'Unsubscribe links work for every campaign. Bounces and spam complaints are recorded automatically only for mail sent through Amazon SES; Gmail and Hostinger do not report them to Dikho, so suppress an address here when a bounce arrives in the sending mailbox.',
    ),
    (Icons.history, 'Every change is kept in the audit log with who made it.'),
  ];

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Column(
      children: [
        for (final (icon, text) in _rules)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: Gap.xs),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ExcludeSemantics(child: Icon(icon, size: 18, color: muted)),
                const SizedBox(width: Gap.m),
                Expanded(child: Text(text)),
              ],
            ),
          ),
      ],
    );
  }
}

/// Recording consent (how they agreed, required) or an unsubscribe, with a note.
class ConsentForm extends StatefulWidget {
  const ConsentForm({super.key, required this.email, required this.subscribe, required this.onSave});

  final String email;
  final bool subscribe;

  /// Saves the change. Throws the server's refusal, which the form shows.
  final Future<void> Function(Map<String, Object?> change) onSave;

  @override
  State<ConsentForm> createState() => _ConsentFormState();
}

class _ConsentFormState extends State<ConsentForm> {
  final _note = TextEditingController();
  String? _source;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (widget.subscribe && !recordableSources.contains(_source)) {
      setState(() => _error = 'Choose how this person agreed.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final note = _note.text.trim();
    try {
      await widget.onSave({
        'marketing': widget.subscribe ? 'subscribed' : 'unsubscribed',
        'source': widget.subscribe ? _source : 'request',
        if (note.isNotEmpty) 'note': note,
      });
    } on ApiException catch (failure) {
      if (mounted) {
        setState(() {
          _error = failure.message;
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final action = widget.subscribe ? 'Record consent' : 'Record unsubscribe';
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.l),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, child: Text(action, style: theme.textTheme.titleLarge)),
          Text(widget.email, style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: Gap.l),
          if (widget.subscribe) ...[
            DropdownButtonFormField<String>(
              initialValue: _source,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'How did they agree?'),
              hint: const Text('Choose'),
              items: [for (final s in recordableSources) DropdownMenuItem(value: s, child: Text(consentSources[s]!))],
              onChanged: _busy ? null : (value) => setState(() => _source = value),
            ),
            const SizedBox(height: Gap.m),
          ],
          TextField(
            controller: _note,
            enabled: !_busy,
            maxLength: 300,
            // Wraps to stay readable, but stays one line of text, as the web form keeps it:
            // a pasted line break becomes a space and the keyboard offers Done.
            minLines: 1,
            maxLines: 4,
            keyboardType: TextInputType.text,
            inputFormatters: [FilteringTextInputFormatter.deny(RegExp(r'[\r\n]'), replacementString: ' ')],
            textInputAction: TextInputAction.done,
            decoration: InputDecoration(
              labelText: 'Note (optional)',
              helperText: widget.subscribe ? 'Where or when, for example "Expo stall form, 12 Oct".' : null,
              helperMaxLines: 3,
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: Gap.s),
              child: Semantics(
                liveRegion: true,
                child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
              ),
            ),
          const SizedBox(height: Gap.m),
          OverflowBar(
            alignment: MainAxisAlignment.end,
            overflowAlignment: OverflowBarAlignment.end,
            spacing: Gap.s,
            overflowSpacing: Gap.xs,
            children: [
              TextButton(onPressed: _busy ? null : () => Navigator.of(context).maybePop(), child: const Text('Cancel')),
              FilledButton(onPressed: _busy ? null : () => unawaited(_save()), child: Text(_busy ? 'Saving…' : action)),
            ],
          ),
        ],
      ),
    );
  }
}
