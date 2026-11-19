import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import 'campaign_models.dart';
import 'email_api.dart';
import 'email_campaign_screen.dart';
import 'email_models.dart';

PillTone campaignTone(String status) => switch (status) {
  'sent' => PillTone.active,
  'pending_approval' || 'paused' => PillTone.pending,
  'rejected' => PillTone.danger,
  'approved' || 'sending' => PillTone.active,
  _ => PillTone.neutral,
};

/// Email campaigns, as EmailCampaigns.jsx: marketing email to people who agreed to it,
/// approved by a second person before it goes out. Each campaign opens on its own.
class EmailCampaignsScreen extends StatefulWidget {
  const EmailCampaignsScreen({
    super.key,
    required this.api,
    required this.userId,
    required this.canCreate,
    required this.onOpenDrawer,
    required this.onOpenPage,
    this.now,
  });

  final EmailApi api;
  final String userId;

  /// email_campaigns.create
  final bool canCreate;
  final VoidCallback onOpenDrawer;

  /// A page that is still the web's (consent).
  final ValueChanged<String> onOpenPage;
  final DateTime Function()? now;

  @override
  State<EmailCampaignsScreen> createState() => _EmailCampaignsScreenState();
}

class _EmailCampaignsScreenState extends State<EmailCampaignsScreen> {
  CampaignsData? _data;
  String? _error;
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.campaignsData();
      if (mounted) {
        setState(() {
          _data = data;
          _error = null;
        });
      }
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  Future<void> _open(String? id) async {
    final data = _data;
    if (data == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => EmailCampaignScreen(
          api: widget.api,
          meta: data,
          id: id,
          userId: widget.userId,
          canCreate: widget.canCreate,
          onChanged: () => unawaited(_load()),
          onOpenPage: widget.onOpenPage,
          now: widget.now,
        ),
      ),
    );
    unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final data = _data;
    final now = (widget.now ?? DateTime.now)();
    final all = data?.campaigns ?? const <Campaign>[];
    final awaiting = all.where((c) => c.status == 'pending_approval').length;
    final match = campaignFilters.firstWhere((f) => f.$1 == _filter).$3;
    final shown = match.isEmpty ? all : all.where((c) => match.contains(c.status)).toList();
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', icon: const Icon(Icons.menu), onPressed: widget.onOpenDrawer),
        title: const Text('Email campaigns'),
        actions: [IconButton(tooltip: 'Refresh', onPressed: () => unawaited(_load()), icon: const Icon(Icons.refresh))],
      ),
      floatingActionButton: widget.canCreate && data != null
          ? FloatingActionButton.extended(onPressed: () => unawaited(_open(null)), icon: const Icon(Icons.add), label: const Text('New campaign'))
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(0, Gap.s, 0, 96),
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Gap.l),
              child: Text(
                'Marketing email to clients, vendors and leads who agreed to receive it, approved by a second person before it goes out.',
                style: muted,
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(Gap.l),
                child: Text("Couldn't load campaigns. $_error", style: TextStyle(color: theme.colorScheme.error)),
              ),
            if (data == null && _error == null)
              const Padding(
                padding: EdgeInsets.all(Gap.xl),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (data != null && !data.ready)
              Container(
                margin: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.l, 0),
                padding: const EdgeInsets.all(Gap.m),
                decoration: BoxDecoration(color: theme.colorScheme.tertiaryContainer, borderRadius: BorderRadius.circular(12)),
                child: Text(
                  'Sending is not switched on yet. Campaigns can be written, reviewed and approved, but nothing is sent until an administrator sets up ${data.missing.isEmpty ? 'sending' : data.missing}.',
                  style: TextStyle(color: theme.colorScheme.onTertiaryContainer),
                ),
              ),
            if (data != null) ...[
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.l, Gap.s),
                child: Row(
                  children: [
                    for (final (key, label, _) in campaignFilters)
                      Padding(
                        padding: const EdgeInsets.only(right: Gap.s),
                        child: ChoiceChip(
                          label: Text(key == 'review' && awaiting > 0 ? '$label ($awaiting)' : label),
                          selected: _filter == key,
                          onSelected: (_) => setState(() => _filter = key),
                        ),
                      ),
                  ],
                ),
              ),
              if (shown.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(Gap.xl),
                  child: Column(
                    children: [
                      Text(all.isEmpty ? 'No campaigns yet' : 'Nothing here', style: theme.textTheme.titleMedium),
                      const SizedBox(height: Gap.s),
                      Text(
                        all.isEmpty
                            ? 'A campaign is written, checked against consent, approved by someone else, then sent from a connected mailbox within its daily limit.'
                            : 'No campaign matches this filter.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              for (final c in shown) _row(context, c, now, muted),
            ],
          ],
        ),
      ),
    );
  }

  Widget _row(BuildContext context, Campaign c, DateTime now, TextStyle muted) {
    final counts = c.counts;
    final total = counts.total > 0 ? counts.total : c.recipientCount;
    final share = total > 0 ? (counts.sent / total) : 0.0;
    final progress = c.started || counts.sent > 0
        ? '${(share * 100).round()}% sent${counts.bounced > 0 ? ' · ${formatCount(counts.bounced)} bounced' : ''}'
        : (c.sendAt.isNotEmpty ? 'Scheduled ${listTime(c.sendAt, now)}' : null);
    return InkWell(
      onTap: () => unawaited(_open(c.id)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Gap.l, vertical: Gap.m),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                Pill(label: c.statusLabel, tone: campaignTone(c.status)),
              ],
            ),
            Text(c.subject.isEmpty ? 'No subject yet' : c.subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: muted),
            Text(
              [
                if (c.recipientCount > 0) '${formatCount(c.recipientCount)} recipients',
                ?progress,
                'updated ${listTime(c.updatedAt, now)}',
                if (c.createdByName.isNotEmpty) c.createdByName,
              ].join(' · '),
              style: muted,
            ),
            if (c.started || counts.sent > 0)
              Padding(
                padding: const EdgeInsets.only(top: Gap.xs),
                child: ExcludeSemantics(
                  child: LinearProgressIndicator(value: share, minHeight: 4, borderRadius: BorderRadius.circular(2)),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
