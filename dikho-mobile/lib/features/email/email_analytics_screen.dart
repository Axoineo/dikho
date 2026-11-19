import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import '../whatsapp/analytics_charts.dart' show BarList;
import '../whatsapp/analytics_parts.dart';
import 'email_api.dart';
import 'email_models.dart';

/// Amazon SES reviews an account whose bounce rate reaches 5% or whose complaint rate
/// reaches 0.1%; staying well under both keeps sending open.
const bounceLimit = 0.05;
const complaintLimit = 0.001;

const _eventLabels = {
  'send': 'Accepted by SES',
  'delivery': 'Delivered',
  'bounce': 'Bounced',
  'complaint': 'Marked as spam',
  'reject': 'Rejected by SES',
  'delivery_delay': 'Delayed',
  'rendering_failure': 'Rendering failed',
  'other': 'Other',
};

/// good, warning or critical against [limit]; null with nothing sent.
String? health(int part, int whole, double limit) {
  if (whole == 0) return null;
  final rate = part / whole;
  return rate >= limit ? 'critical' : (rate >= limit / 2 ? 'warning' : 'good');
}

/// Delivery health and campaign outcomes, as EmailAnalytics.jsx. Counts only: Dikho
/// adds no tracking pixels or redirected links, so there are no opens or clicks.
class EmailAnalyticsScreen extends StatefulWidget {
  const EmailAnalyticsScreen({super.key, required this.api, required this.onOpenDrawer});

  final EmailApi api;
  final VoidCallback onOpenDrawer;

  @override
  State<EmailAnalyticsScreen> createState() => _EmailAnalyticsScreenState();
}

class _EmailAnalyticsScreenState extends State<EmailAnalyticsScreen> {
  int _days = 30;
  Map<String, dynamic>? _data;
  String? _error;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() => _error = null);
    try {
      final data = await widget.api.analytics(_days);
      if (mounted && generation == _generation) setState(() => _data = data);
    } on ApiException catch (failure) {
      if (mounted && generation == _generation) setState(() => _error = failure.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final data = _data;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', icon: const Icon(Icons.menu), onPressed: widget.onOpenDrawer),
        title: const Text('Email analytics'),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl * 2),
          children: [
            Text("Sending and consent from Dikho's own records. Delivery events exist only for mail sent through Amazon SES.", style: muted),
            const SizedBox(height: Gap.m),
            SegmentedButton<int>(
              segments: const [
                ButtonSegment(value: 7, label: Text('7 days')),
                ButtonSegment(value: 30, label: Text('30 days')),
                ButtonSegment(value: 90, label: Text('90 days')),
              ],
              selected: {_days},
              onSelectionChanged: (picked) {
                setState(() => _days = picked.first);
                unawaited(_load());
              },
            ),
            const SizedBox(height: Gap.m),
            if (_error != null) Text("Couldn't load analytics. $_error", style: TextStyle(color: theme.colorScheme.error)),
            if (data == null && _error == null)
              const Padding(
                padding: EdgeInsets.all(Gap.xl),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (data != null) ..._figures(context, data),
          ],
        ),
      ),
    );
  }

  List<Widget> _figures(BuildContext context, Map<String, dynamic> data) {
    int num_(Object? v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
    final c = CampaignCounts(data['campaign_recipients']);
    final events = data['events'] is Map ? Map<String, dynamic>.from(data['events'] as Map) : <String, dynamic>{};
    final sent = num_(events['send']);
    final bounced = num_(events['bounce']);
    final complained = num_(events['complaint']);
    final outcomes = [
      ('Delivered', c.delivered),
      ('Sent, not yet confirmed', c.sent - c.delivered - c.bounced - c.complained),
      ('Bounced', c.bounced),
      ('Marked as spam', c.complained),
      ('Failed', c.failed),
      ('Unconfirmed (not retried)', c.uncertain),
      ('Skipped (consent withdrawn or cancelled)', c.skipped),
      ('Waiting to send', c.queued),
    ].where((o) => o.$2 > 0).toList();
    final campaigns = data['campaigns'] is Map ? Map<String, dynamic>.from(data['campaigns'] as Map) : <String, dynamic>{};
    final sortedEvents = events.entries.toList()..sort((a, b) => num_(b.value).compareTo(num_(a.value)));
    return [
      KpiGrid(
        children: [
          KpiTile(label: 'Campaign emails sent', value: formatCount(c.sent), sub: '${formatCount(c.delivered)} confirmed delivered'),
          _HealthTile(
            label: 'Bounce rate',
            value: percentOf(bounced, sent),
            sub: '${formatCount(bounced)} of ${formatCount(sent)} accepted by SES',
            status: health(bounced, sent, bounceLimit),
          ),
          _HealthTile(
            label: 'Complaint rate',
            value: percentOf(complained, sent),
            sub: '${formatCount(complained)} marked as spam',
            status: health(complained, sent, complaintLimit),
          ),
          KpiTile(label: 'Unsubscribed', value: formatCount(num_(data['unsubscribes'])), sub: 'by link or spam report in this period'),
        ],
      ),
      const SizedBox(height: Gap.m),
      SectionCard(
        title: 'Campaign recipients',
        subtitle: 'Where each campaign email ended up.',
        child: outcomes.isEmpty
            ? const QuietText('No campaign email in this period. Numbers appear once an approved campaign starts sending.')
            : BarList(items: [for (final (label, n) in outcomes) (label: label, value: n, text: formatCount(n), note: percentOf(n, c.total))]),
      ),
      SectionCard(
        title: 'Audience today',
        subtitle: 'All addresses, not only this period.',
        child: Column(
          children: [
            FactRow(label: 'Agreed to marketing email', child: Text(formatCount(num_(data['subscribed'])))),
            FactRow(label: 'Suppressed (bounced or blocked)', child: Text(formatCount(num_(data['suppressed'])))),
          ],
        ),
      ),
      SectionCard(
        title: 'Campaigns in this period',
        child: campaigns.isEmpty
            ? const QuietText('None.')
            : Column(
                children: [
                  for (final e in campaigns.entries) FactRow(label: campaignStatusLabels[e.key] ?? e.key, child: Text(formatCount(num_(e.value)))),
                ],
              ),
      ),
      SectionCard(
        title: 'Email through Amazon SES (optional)',
        subtitle: 'Delivery, bounce and complaint events for mail sent through SES. Gmail and Hostinger mailboxes report only whether they accepted a message.',
        footnote: 'Opens and clicks are not tracked: Dikho adds no tracking pixels or redirected links.',
        child: events.isEmpty
            ? const QuietText('No delivery events in this period. They exist only for mail sent through Amazon SES, which is optional.')
            : Column(
                children: [
                  for (final e in sortedEvents)
                    FactRow(
                      label: _eventLabels[e.key] ?? e.key,
                      child: Text(e.key == 'send' ? formatCount(num_(e.value)) : '${formatCount(num_(e.value))} · ${percentOf(num_(e.value), sent)}'),
                    ),
                ],
              ),
      ),
    ];
  }
}

/// A rate with its standing in words and an icon, never colour alone.
class _HealthTile extends StatelessWidget {
  const _HealthTile({required this.label, required this.value, required this.sub, required this.status});

  final String label;
  final String value;
  final String sub;
  final String? status;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      KpiTile(label: label, value: value, sub: sub),
      if (status != null)
        Padding(
          padding: const EdgeInsets.only(top: Gap.xs),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Pill(
              label: switch (status) {
                'good' => 'Healthy',
                'warning' => 'Watch',
                _ => 'Too high',
              },
              tone: switch (status) {
                'good' => PillTone.active,
                'warning' => PillTone.pending,
                _ => PillTone.danger,
              },
            ),
          ),
        ),
    ],
  );
}
