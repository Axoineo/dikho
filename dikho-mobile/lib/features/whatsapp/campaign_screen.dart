import 'dart:async';

import 'package:flutter/material.dart';

import 'campaign_unsent_screen.dart';
import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../../shared/values.dart';
import '../inbox/chat_theme.dart';
import 'analytics_charts.dart';
import 'analytics_models.dart';
import 'analytics_parts.dart';

/// One campaign on its own, as the web's /whatsapp/campaigns/:id: the funnel, why
/// messages failed, how fast deliveries and reads arrived, replies and opt-outs.
/// Reads GET /api/whatsapp/analytics/campaigns/:id.
class CampaignScreen extends StatefulWidget {
  const CampaignScreen({super.key, required this.api, required this.id, required this.title, this.canSend = false, this.numberStyle = 'en-IN'});

  final CrmApi api;
  final int id;
  final String title;

  /// campaigns.send: may send again to whoever the campaign did not reach.
  final bool canSend;
  final String numberStyle;

  @override
  State<CampaignScreen> createState() => _CampaignScreenState();
}

class _CampaignScreenState extends State<CampaignScreen> {
  CampaignPerformance? _data;
  String? _error;
  bool _table = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/whatsapp/analytics/campaigns/${widget.id}');
      if (mounted) {
        setState(() {
          _data = CampaignPerformance.from(data);
          _error = null;
        });
      }
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  String _count(num n) => formatCount(n, style: widget.numberStyle);

  @override
  Widget build(BuildContext context) {
    final data = _data;
    return Scaffold(
      appBar: AppBar(title: Text(data?.summary.name ?? widget.title, maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: data == null
          ? (_error == null
                ? const Center(child: CircularProgressIndicator())
                : EmptyMessage(title: "Couldn't load this campaign", body: _error!, action: 'Try again', onAction: () => unawaited(_load())))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.l, Gap.xl),
                children: _sections(context, data),
              ),
            ),
    );
  }

  List<Widget> _sections(BuildContext context, CampaignPerformance d) {
    final theme = Theme.of(context);
    final c = d.summary;
    final t = c.totals;
    final timeline = cumulative(d.timeline);
    final points = timeline.points;
    final last = points.isEmpty ? 0 : points.last.hour;
    String hourLabel(int i) {
      final hour = points[i].hour;
      if (hour >= 72 && last >= 72) return '72 h+';
      return hour == 0 ? 'Start' : '$hour h';
    }

    final outstanding = t.failed + d.notSent;
    return [
      Wrap(
        spacing: Gap.s,
        runSpacing: Gap.xs,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Pill(
            label: sentenceCase(c.status),
            tone: c.status == 'completed'
                ? PillTone.active
                : c.status == 'failed'
                ? PillTone.danger
                : PillTone.pending,
          ),
          Text(
            'Template ${c.template}, started ${formatStamp(c.createdAt)}',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
      const SizedBox(height: Gap.m),
      KpiGrid(
        children: [
          KpiTile(label: 'Audience', value: _count(c.audience), sub: 'People chosen for it'),
          KpiTile(label: 'Sent', value: _count(t.sent), sub: d.notSent > 0 ? '${_count(d.notSent)} not sent yet' : 'Everyone was sent to'),
          KpiTile(label: 'Delivered', value: formatPercent(rate(t.delivered, t.sent)), sub: '${_count(t.delivered)} reached a phone'),
          KpiTile(label: 'Read', value: formatPercent(rate(t.read, t.delivered)), sub: '${_count(t.read)} of those delivered'),
          KpiTile(
            label: 'Replied',
            value: _count(d.replied),
            sub: '${formatPercent(rate(d.replied, t.delivered))} of delivered, within ${d.replyWindowDays} days',
          ),
          KpiTile(label: 'Failed', value: _count(t.failed), sub: t.sent > 0 ? '${formatPercent(rate(t.failed, t.sent))} of sent' : 'None sent'),
          KpiTile(label: 'Opted out', value: _count(d.optedOut), sub: 'Recipients who have since said stop'),
        ],
      ),
      const SizedBox(height: Gap.m),
      SectionCard(
        title: 'Funnel',
        subtitle: 'Each step against the one before it; replies against delivered',
        footnote: t.awaiting > 0 ? '${_count(t.awaiting)} still waiting for a receipt from the phone.' : null,
        child: Funnel(
          style: widget.numberStyle,
          steps: [
            (label: 'Audience', value: c.audience, of: null),
            (label: 'Sent', value: t.sent, of: null),
            (label: 'Delivered', value: t.delivered, of: null),
            (label: 'Read', value: t.read, of: null),
            (label: 'Replied', value: d.replied, of: 2),
          ],
        ),
      ),
      SectionCard(
        title: 'Why messages failed',
        subtitle: "Meta's reason, most common first",
        child: d.failures.isEmpty
            ? const QuietText('No failures.')
            : BarList(
                items: [
                  for (final f in d.failures) (label: f.reason, value: f.count, text: _count(f.count), note: f.code == null ? null : '(${f.code})'),
                ],
              ),
      ),
      SectionCard(
        title: 'How fast it landed',
        subtitle: 'Running total of deliveries and reads, by hours since it started',
        action: points.length > 1 ? ViewToggle(table: _table, onChanged: (value) => setState(() => _table = value)) : null,
        footnote: [
          if (timeline.halfDelivered != null) 'Half the deliveries arrived ${hoursPhrase(timeline.halfDelivered)}.',
          if (timeline.halfRead != null) 'Half the reads came ${hoursPhrase(timeline.halfRead)}.',
          'Anything after three days counts in the last point.',
        ].join(' '),
        child: points.isEmpty
            ? const QuietText('No delivery receipts yet.')
            : _table && points.length > 1
            ? ChartTable(
                columns: const ['Hours since start', 'Delivered so far', 'Read so far'],
                rows: [
                  for (final p in points) [p.hour >= 72 ? '72 or more' : '${p.hour} to ${p.hour + 1}', _count(p.delivered), _count(p.read)],
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const ChartLegend(series: [deliveredSeries, readSeries]),
                  const SizedBox(height: Gap.s),
                  LineChart(
                    series: const [deliveredSeries, readSeries],
                    values: [
                      [for (final p in points) p.delivered],
                      [for (final p in points) p.read],
                    ],
                    labelSteps: const [1, 2, 3, 6, 12, 24],
                    xLabel: hourLabel,
                    tipTitle: (i) => points[i].hour >= 72 ? 'After 72 hours' : 'By hour ${points[i].hour + 1}',
                    formatValue: _count,
                    semanticLabel: 'Deliveries and reads by hours since the start',
                  ),
                ],
              ),
      ),
      SectionCard(
        title: 'Button taps',
        subtitle: "What recipients tapped on this campaign's message",
        footnote: d.linkTaps == null
            ? "Counted from the answers to this campaign's own messages."
            : "Quick replies are counted from the answers to this campaign's own messages. Link taps come from Meta for the template as a whole: "
                  'every send of ${c.template} in the ${d.replyWindowDays} days after the start counts.',
        child: TapLists(style: widget.numberStyle, replies: d.replyTaps, links: d.linkTaps, linkTitle: 'Links (this template)'),
      ),
      if (outstanding > 0)
        SectionCard(
          title: 'Not received',
          subtitle: '${_count(t.failed)} failed and ${_count(d.notSent)} never sent',
          child: Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              onPressed: () => unawaited(
                Navigator.of(context)
                    .push(
                      MaterialPageRoute<void>(
                        builder: (_) => CampaignUnsentScreen(
                          api: widget.api,
                          campaignId: c.id,
                          title: c.name,
                          canSend: widget.canSend,
                          sending: c.status == 'sending',
                        ),
                      ),
                    )
                    .then((_) => _load()),
              ),
              icon: const Icon(Icons.people_outline, size: 18),
              label: const Text('See who, and send again'),
            ),
          ),
        ),
      Text(
        'Replies count people from this campaign who wrote to you within ${d.replyWindowDays} days of its start, whatever they wrote. '
        'Opted out counts recipients who have stopped messages since.',
        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      ),
    ];
  }
}
