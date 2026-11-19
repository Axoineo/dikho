import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';

/// Someone a campaign has not reached, from GET /api/campaigns/:id/unsent.
class UnsentContact {
  UnsentContact(Map<String, dynamic> raw)
    : id = raw['id'] is num ? (raw['id'] as num).toInt() : 0,
      name = raw['name'] is String ? raw['name'] as String : '',
      phone = raw['phone']?.toString() ?? '',
      reason = raw['reason'] is String ? raw['reason'] as String : '',
      error = raw['errorMessage'] is String ? raw['errorMessage'] as String : '';

  final int id;
  final String name;
  final String phone;

  /// failed or never_attempted.
  final String reason;
  final String error;
}

class UnsentList {
  UnsentList(Map<String, dynamic> raw)
    : contacts = [
        for (final c in raw['contacts'] is List ? raw['contacts'] as List : const [])
          if (c is Map) UnsentContact(c.cast<String, dynamic>()),
      ],
      total = _n(raw['counts'], 'total'),
      failed = _n(raw['counts'], 'failed'),
      neverAttempted = _n(raw['counts'], 'neverAttempted'),
      inferred = raw['audienceSource'] == 'inferred',
      unaccounted = raw['unaccounted'] is num ? (raw['unaccounted'] as num).toInt() : 0;

  final List<UnsentContact> contacts;
  final int total;
  final int failed;
  final int neverAttempted;

  /// The campaign ran before audiences were recorded (migration 0006).
  final bool inferred;
  final int unaccounted;

  static int _n(Object? counts, String key) => counts is Map && counts[key] is num ? (counts[key] as num).toInt() : 0;
}

/// Everyone a campaign has not reached, and a resend to only them, as CampaignUnsent.jsx.
/// The list always comes fresh from the server: someone drops off because their
/// message is now recorded as sent, the same record the resend claims against, so
/// nothing here guesses which sends worked.
class CampaignUnsentScreen extends StatefulWidget {
  const CampaignUnsentScreen({
    super.key,
    required this.api,
    required this.campaignId,
    required this.title,
    this.canSend = false,
    this.sending = false,
  });

  final CrmApi api;
  final int campaignId;
  final String title;

  /// campaigns.send
  final bool canSend;

  /// The campaign is still sending: a resend would race it.
  final bool sending;

  @override
  State<CampaignUnsentScreen> createState() => _CampaignUnsentScreenState();
}

class _CampaignUnsentScreenState extends State<CampaignUnsentScreen> {
  UnsentList? _list;
  String? _error;

  /// A campaign from before audiences were recorded, checked against every contact
  /// only when the person asks: right for a send-to-everyone campaign, wrong for a
  /// targeted one.
  bool _everyone = false;

  /// While resending: the batch, and how many are still to go.
  ({int batch, int? left})? _progress;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/campaigns/${widget.campaignId}/unsent', query: _everyone ? {'includeUnrecorded': '1'} : null);
      if (mounted) {
        setState(() {
          _list = UnsentList(data);
          _error = null;
        });
      }
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  /// One batch per request, as the web does, so a list larger than one batch still
  /// drains with one tap. Meta reporting a spam, template or account problem stops it.
  Future<void> _resend() async {
    if (_progress != null) return;
    final count = _list?.total ?? 0;
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: Text('Send again to $count?'),
        content: const Text('Only the people listed get the message, each at most once. Each message is a paid WhatsApp conversation.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialog).pop(true), child: const Text('Send again')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() {
      _progress = (batch: 1, left: null);
      _error = null;
    });
    try {
      var answer = await widget.api.post('/campaigns/${widget.campaignId}/retry', {'includeUnrecorded': _everyone});
      var batch = 1;
      while (answer['remaining'] is List && (answer['remaining'] as List).isNotEmpty) {
        final remaining = answer['remaining'] as List;
        batch += 1;
        if (mounted) setState(() => _progress = (batch: batch, left: remaining.length));
        answer = await widget.api.post('/campaigns/${widget.campaignId}/retry', {'contactIds': remaining});
      }
      final halted = answer['halted'];
      if (halted is Map && mounted) setState(() => _error = 'Sending stopped by itself. ${halted['reason'] ?? ''}'.trim());
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _progress = null);
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final list = _list;
    final progress = _progress;
    return Scaffold(
      appBar: AppBar(title: Text('Not received: ${widget.title}', maxLines: 1, overflow: TextOverflow.ellipsis)),
      bottomNavigationBar: list == null || list.contacts.isEmpty || !widget.canSend
          ? null
          : SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.m),
                child: FilledButton.icon(
                  onPressed: progress != null || widget.sending ? null : () => unawaited(_resend()),
                  icon: const Icon(Icons.replay),
                  label: Text(
                    progress != null
                        ? (progress.left == null ? 'Sending again…' : 'Sending again (${progress.left} left)…')
                        : 'Send again to ${list.total}',
                  ),
                ),
              ),
            ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(0, Gap.s, 0, Gap.xl),
          children: [
            if (_error != null)
              Container(
                margin: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.m),
                padding: const EdgeInsets.all(Gap.m),
                decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
                child: Semantics(
                  liveRegion: true,
                  child: Text(_error!, style: TextStyle(color: theme.colorScheme.onErrorContainer)),
                ),
              ),
            if (list == null && _error == null)
              const Padding(
                padding: EdgeInsets.all(Gap.xl),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (list != null) ...[
              if (list.inferred && list.unaccounted > 0 && !_everyone)
                Container(
                  margin: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.m),
                  padding: const EdgeInsets.all(Gap.m),
                  decoration: BoxDecoration(color: theme.colorScheme.tertiaryContainer, borderRadius: BorderRadius.circular(12)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${list.unaccounted} recipients are unaccounted for. This campaign ran before audiences were recorded, so they can only be found by checking every contact.',
                        style: TextStyle(color: theme.colorScheme.onTertiaryContainer),
                      ),
                      TextButton(
                        onPressed: () {
                          setState(() {
                            _everyone = true;
                            _list = null;
                          });
                          unawaited(_load());
                        },
                        child: const Text('Check all contacts'),
                      ),
                    ],
                  ),
                ),
              if (list.contacts.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(Gap.xl),
                  child: Column(
                    children: [
                      Text('Everyone has been sent to', style: theme.textTheme.titleMedium),
                      const SizedBox(height: Gap.s),
                      Text('Nothing left to send again on this campaign.', textAlign: TextAlign.center, style: muted),
                    ],
                  ),
                )
              else ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.s),
                  child: Text(
                    [
                      '${list.total} not received',
                      if (list.failed > 0) '${list.failed} failed',
                      if (list.neverAttempted > 0) '${list.neverAttempted} never attempted',
                    ].join(' · '),
                    style: muted,
                  ),
                ),
                if (widget.sending)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.s),
                    child: Text('The campaign is still sending. Send again once it has finished.', style: muted),
                  ),
                for (final c in list.contacts)
                  ListTile(
                    title: Text(c.name.isEmpty ? c.phone : c.name),
                    subtitle: Text([c.phone, if (c.error.isNotEmpty) c.error].join(' · ')),
                    trailing: Pill(
                      label: c.reason == 'failed'
                          ? 'Failed'
                          : c.reason == 'never_attempted'
                          ? 'Never attempted'
                          : c.reason,
                      tone: c.reason == 'failed' ? PillTone.danger : PillTone.pending,
                    ),
                  ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}
