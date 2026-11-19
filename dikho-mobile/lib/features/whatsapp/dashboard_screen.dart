import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/platform_api.dart';
import '../../shared/record_ui.dart';
import '../../shared/values.dart';
import '../inbox/chat_theme.dart';
import 'analytics_charts.dart';
import 'analytics_models.dart';
import 'analytics_parts.dart';
import 'campaign_screen.dart';
import 'campaign_wizard_screen.dart';

/// The WhatsApp dashboard, as the web's (src/features/whatsapp/WhatsAppDashboard.jsx):
/// how messages did over 7, 30 or 90 days against the same length of time before,
/// from the CRM's records and from Meta. One request, cached on the server.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({
    super.key,
    required this.api,
    required this.onOpenDrawer,
    required this.onOpenInbox,
    this.platform,
    this.onNewCampaign,
    this.canSend = false,
    this.numberStyle = 'en-IN',
  });

  final CrmApi api;
  final VoidCallback onOpenDrawer;

  /// For the native new-campaign wizard's header file picker.
  final PlatformApi? platform;

  /// Instead of the native wizard, for tests.
  final VoidCallback? onNewCampaign;

  /// Null when this person may not open the inbox.
  final VoidCallback? onOpenInbox;
  final bool canSend;
  final String numberStyle;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  static const _ranges = [7, 30, 90];

  int _days = 30;
  Analytics? _data;
  String? _error;
  bool _loading = true;
  bool _table = false;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final request = ++_request;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await widget.api.get('/whatsapp/analytics', query: {'days': '$_days'});
      if (!mounted || request != _request) return;
      setState(() {
        _data = Analytics.from(data);
        _loading = false;
      });
    } on ApiException catch (failure) {
      if (!mounted || request != _request) return;
      setState(() {
        _error = failure.message;
        _loading = false;
      });
    }
  }

  void _pickRange(int days) {
    if (days == _days) return;
    setState(() => _days = days);
    unawaited(_load());
  }

  String _count(num n) => formatCount(n, style: widget.numberStyle);

  void _openCampaign(CampaignSummary campaign) {
    unawaited(
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) =>
              CampaignScreen(api: widget.api, id: campaign.id, title: campaign.name, numberStyle: widget.numberStyle, canSend: widget.canSend),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
        title: const Text('WhatsApp'),
        actions: [
          if (widget.canSend)
            Padding(
              padding: const EdgeInsets.only(right: Gap.s),
              child: TextButton.icon(
                onPressed: () {
                  final custom = widget.onNewCampaign;
                  final platform = widget.platform;
                  if (custom != null) {
                    custom();
                  } else if (platform != null) {
                    unawaited(
                      openCampaignWizard(context, api: widget.api, platform: platform, numberStyle: widget.numberStyle).then((_) {
                        if (mounted) unawaited(_load());
                      }),
                    );
                  }
                },
                icon: const Icon(Icons.add),
                label: const Text('New campaign'),
              ),
            ),
        ],
        bottom: _loading && data != null
            ? const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator(minHeight: 2))
            : null,
      ),
      body: data == null
          ? (_error == null
                ? const Center(child: CircularProgressIndicator())
                : EmptyMessage(title: "Couldn't load the dashboard", body: _error!, action: 'Try again', onAction: () => unawaited(_load())))
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

  List<Widget> _sections(BuildContext context, Analytics d) {
    final theme = Theme.of(context);
    final t = d.totals;
    final p = d.previous;
    final period = 'previous $_days days';
    final spend = d.spend;
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return [
      Wrap(
        spacing: Gap.m,
        runSpacing: Gap.s,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SegmentedButton<int>(
            showSelectedIcon: false,
            segments: [for (final days in _ranges) ButtonSegment(value: days, label: Text('$days days'))],
            selected: {_days},
            onSelectionChanged: (value) => _pickRange(value.first),
          ),
          Text(
            _loading
                ? 'Updating…'
                : '${shortDay(d.from)} to ${shortDay(d.to)}${d.computedAt == null ? '' : ', updated ${formatStamp(d.computedAt).split(', ').last}'}',
            style: muted,
          ),
        ],
      ),
      const SizedBox(height: Gap.m),
      if (_error != null) _Banner(text: "Couldn't refresh: $_error", error: true),
      if (d.metaErrors.isNotEmpty) _Banner(text: 'Some figures from Meta are missing. ${d.metaErrors.join(' ')}'),
      KpiGrid(
        children: [
          KpiTile(label: 'Messages sent', value: _count(t.sent), sub: 'Handed to Meta', change: change(t.sent, p.sent), period: period),
          KpiTile(
            label: 'Delivered',
            value: formatPercent(rate(t.delivered, t.sent)),
            sub: '${_count(t.delivered)} reached a phone',
            change: change(rate(t.delivered, t.sent), rate(p.delivered, p.sent), isRate: true),
            period: period,
          ),
          KpiTile(
            label: 'Read',
            value: formatPercent(rate(t.read, t.delivered)),
            sub: '${_count(t.read)} of those delivered',
            change: change(rate(t.read, t.delivered), rate(p.read, p.delivered), isRate: true),
            period: period,
          ),
          KpiTile(
            label: 'Failed',
            value: _count(t.failed),
            sub: t.sent > 0 ? '${formatPercent(rate(t.failed, t.sent))} of sent' : 'None sent',
            change: change(t.failed, p.failed, higherIsBetter: false),
            period: period,
          ),
          KpiTile(
            label: 'Messages received',
            value: _count(t.inbound),
            sub: 'Written to you by customers',
            change: change(t.inbound, p.inbound),
            period: period,
          ),
          KpiTile(
            label: 'Spend',
            value: spend == null ? '—' : formatMoney(spend.total, spend.currency, style: widget.numberStyle),
            sub: spend == null ? 'Not available from Meta' : '${_count(spend.volume)} messages Meta priced',
          ),
        ],
      ),
      const SizedBox(height: Gap.m),
      SectionCard(
        title: 'Messages by day',
        subtitle: 'Each message counts on the day it was sent.',
        action: t.sent + t.inbound > 0 ? ViewToggle(table: _table, onChanged: (value) => setState(() => _table = value)) : null,
        footnote: 'Read counts only include people with read receipts on, so the true read rate is higher.',
        child: t.sent + t.inbound == 0
            ? QuietText('No messages in these $_days days.')
            : _table
            ? ChartTable(
                columns: const ['Day', 'Sent', 'Delivered', 'Read', 'Failed', 'Received'],
                rows: [
                  for (final day in d.daily)
                    [
                      longDay(day.day),
                      _count(day.totals.sent),
                      _count(day.totals.delivered),
                      _count(day.totals.read),
                      _count(day.totals.failed),
                      _count(day.totals.inbound),
                    ],
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const ChartLegend(series: [sentSeries, deliveredSeries, readSeries]),
                  const SizedBox(height: Gap.s),
                  LineChart(
                    series: const [sentSeries, deliveredSeries, readSeries],
                    values: [
                      [for (final day in d.daily) day.totals.sent],
                      [for (final day in d.daily) day.totals.delivered],
                      [for (final day in d.daily) day.totals.read],
                    ],
                    xLabel: (i) => shortDay(d.daily[i].day),
                    tipTitle: (i) => longDay(d.daily[i].day),
                    formatValue: _count,
                    semanticLabel: 'Messages sent, delivered and read by day',
                  ),
                ],
              ),
      ),
      SectionCard(
        title: 'Delivery funnel',
        subtitle: 'Of the messages sent in the last $_days days',
        footnote: t.awaiting > 0 ? '${_count(t.awaiting)} still waiting for a receipt from the phone.' : null,
        child: t.sent == 0
            ? const QuietText('Nothing sent in this period.')
            : Funnel(
                style: widget.numberStyle,
                steps: [
                  (label: 'Sent', value: t.sent, of: null),
                  (label: 'Delivered', value: t.delivered, of: null),
                  (label: 'Read', value: t.read, of: null),
                ],
              ),
      ),
      SectionCard(
        title: 'Why messages failed',
        subtitle: "Meta's reason, most common first",
        child: d.failures.isEmpty
            ? const QuietText('No failures in this period.')
            : BarList(
                items: [
                  for (final f in d.failures) (label: f.reason, value: f.count, text: _count(f.count), note: f.code == null ? null : '(${f.code})'),
                ],
              ),
      ),
      SectionCard(
        title: 'Messages received by day',
        subtitle: 'Customers writing to you, reactions left out',
        child: t.inbound == 0
            ? const QuietText('No messages received in this period.')
            : ColumnChart(
                series: const ChartSeries('Received', Color(0xFF2A78D6), Color(0xFF3987E5)),
                values: [for (final day in d.daily) day.totals.inbound],
                xLabel: (i) => shortDay(d.daily[i].day),
                tipTitle: (i) => longDay(d.daily[i].day),
                formatValue: _count,
                semanticLabel: 'Messages received by day',
              ),
      ),
      SectionCard(
        title: 'What you sent',
        subtitle: 'Messages handed to Meta, by where they came from',
        child: t.sent == 0
            ? const QuietText('Nothing sent in this period.')
            : BarList(
                items: [
                  (label: 'Campaigns', value: t.campaign, text: _count(t.campaign), note: null),
                  (label: 'Inbox replies and chat templates', value: t.replies, text: _count(t.replies), note: null),
                  (label: 'Automatic (lead confirmations)', value: t.automatic, text: _count(t.automatic), note: null),
                ],
              ),
      ),
      SectionCard(
        title: 'Spend',
        subtitle: spend == null ? 'From Meta' : 'What Meta charged, in ${spend.currency ?? 'the account currency'}',
        footnote: spend == null ? null : 'Service replies inside 24 hours are free and count at zero.',
        child: spend == null
            ? const QuietText('Meta did not return spend for this period.')
            : spend.byCategory.isEmpty
            ? const QuietText('No charges in this period.')
            : Column(
                children: [
                  ColumnChart(
                    series: const ChartSeries('Spend', Color(0xFF2A78D6), Color(0xFF3987E5)),
                    values: [for (final day in d.daily) spend.daily[day.day] ?? 0],
                    integer: false,
                    xLabel: (i) => shortDay(d.daily[i].day),
                    tipTitle: (i) => longDay(d.daily[i].day),
                    formatValue: (v) => formatMoney(v.toDouble(), spend.currency, style: widget.numberStyle),
                    formatAxis: (v) => formatMoney(v.toDouble(), spend.currency, style: widget.numberStyle, paise: false),
                    semanticLabel: 'Spend by day',
                  ),
                  const SizedBox(height: Gap.l),
                  BarList(
                    items: [
                      for (final c in spend.byCategory)
                        (
                          label: categoryLabels[c.category] ?? sentenceCase(c.category),
                          value: c.cost,
                          text: formatMoney(c.cost, spend.currency, style: widget.numberStyle),
                          note: '${_count(c.volume)} messages',
                        ),
                    ],
                  ),
                ],
              ),
      ),
      SectionCard(
        title: 'Templates',
        subtitle: "How each template did, with Meta's quality rating",
        child: d.templates.isEmpty
            ? const QuietText('No templates sent in this period.')
            : Column(
                children: [
                  for (final row in d.templates)
                    _ListRow(
                      title: row.name,
                      trailing: row.quality != null || row.status != null ? QualityText(row.quality) : null,
                      detail:
                          '${_count(row.totals.sent)} sent, ${formatPercent(rate(row.totals.delivered, row.totals.sent))} delivered, '
                          '${formatPercent(rate(row.totals.read, row.totals.delivered))} read, ${_count(row.totals.failed)} failed, ${_count(row.taps)} taps'
                          '${row.cost != null && spend != null ? ', ${formatMoney(row.cost!, spend.currency, style: widget.numberStyle)}' : ''}'
                          '${row.status != null && row.status != 'APPROVED' ? ', ${sentenceCase(row.status!)}' : ''}',
                    ),
                ],
              ),
      ),
      SectionCard(
        title: 'Button taps',
        subtitle: 'What people tapped on your templates in this period',
        footnote: d.insights.available
            ? "Quick replies are counted from the answers in your own records. Link taps come from Meta's template insights."
            : 'Counted from the answers in your own records.',
        child: TapLists(
          style: widget.numberStyle,
          replies: ([for (final t in d.templates) ...t.replyTaps]..sort((a, b) => b.count.compareTo(a.count))).take(8).toList(),
          links: d.insights.available
              ? ([for (final t in d.templates) ...t.links]..sort((a, b) => b.count.compareTo(a.count))).take(8).toList()
              : null,
        ),
      ),
      SectionCard(
        title: 'Campaigns',
        subtitle: 'Started in this period. Tap one to see how it did.',
        child: d.campaigns.isEmpty
            ? const QuietText('No campaigns started in this period.')
            : Column(
                children: [
                  for (final c in d.campaigns)
                    _ListRow(
                      title: c.name,
                      trailing: Pill(label: sentenceCase(c.status), tone: _statusTone(c.status)),
                      detail:
                          '${formatStamp(c.createdAt)}: ${_count(c.totals.sent)} of ${_count(c.audience)} sent, '
                          '${formatPercent(rate(c.totals.delivered, c.totals.sent))} delivered, ${formatPercent(rate(c.totals.read, c.totals.delivered))} read',
                      onTap: () => _openCampaign(c),
                    ),
                ],
              ),
      ),
      SectionCard(
        title: 'Account health',
        subtitle: 'Your WhatsApp Business number, as Meta rates it',
        footnote: 'Quality drops when people block or report your messages. Low quality can pause templates and lower the limit.',
        child: d.account == null
            ? const QuietText("Meta did not return the number's details.")
            : Column(
                children: [
                  FactRow(label: 'Business name', child: Text(d.account!.verifiedName ?? '—')),
                  FactRow(label: 'Number', child: Text(d.account!.phone ?? '—')),
                  FactRow(label: 'Quality rating', child: QualityText(d.account!.quality)),
                  FactRow(
                    label: 'Messaging limit',
                    child: Text(messagingLimitLabel(d.account!.messagingLimit, style: widget.numberStyle) ?? '—'),
                  ),
                  FactRow(label: 'Throughput', child: Text(throughputLabels[d.account!.throughput] ?? d.account!.throughput ?? '—')),
                  if (d.templateHealth != null) FactRow(label: 'Approved templates', child: Text(_templateHealth(d.templateHealth!))),
                ],
              ),
      ),
      SectionCard(
        title: 'Audience and inbox',
        subtitle: 'Right now',
        child: Column(
          children: [
            FactRow(label: 'Contacts', child: Text(_count(d.contacts))),
            FactRow(
              label: 'Opted out',
              child: Text('${_count(d.optedOut)}${d.contacts > 0 ? ' (${formatPercent(rate(d.optedOut, d.contacts))})' : ''}'),
            ),
            FactRow(label: 'Added in the last $_days days', child: Text(_count(d.added))),
            FactRow(label: 'Open chats', child: Text(_count(d.openChats))),
            FactRow(
              label: 'Chats with unread messages',
              child: d.unreadChats > 0 && widget.onOpenInbox != null
                  ? TextButton(onPressed: widget.onOpenInbox, child: Text('${_count(d.unreadChats)}, open inbox'))
                  : Text(_count(d.unreadChats)),
            ),
          ],
        ),
      ),
    ];
  }

  static PillTone _statusTone(String status) => switch (status) {
    'completed' => PillTone.active,
    'sending' => PillTone.pending,
    'stopped' => PillTone.pending,
    'failed' => PillTone.danger,
    _ => PillTone.neutral,
  };

  static String _templateHealth(Map<String, int> health) {
    final parts = [
      if ((health['GREEN'] ?? 0) > 0) '${health['GREEN']} high',
      if ((health['YELLOW'] ?? 0) > 0) '${health['YELLOW']} medium',
      if ((health['RED'] ?? 0) > 0) '${health['RED']} low',
      if ((health['UNKNOWN'] ?? 0) > 0) '${health['UNKNOWN']} not rated',
      if ((health['paused'] ?? 0) > 0) '${health['paused']} paused or disabled',
    ];
    return parts.isEmpty ? 'None' : parts.join(', ');
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, this.error = false});

  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: Gap.m),
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(color: error ? scheme.errorContainer : scheme.secondaryContainer, borderRadius: BorderRadius.circular(12)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.warning_amber_rounded, size: 18, color: error ? scheme.onErrorContainer : scheme.onSecondaryContainer),
          const SizedBox(width: Gap.s),
          Expanded(
            child: Text(text, style: TextStyle(color: error ? scheme.onErrorContainer : scheme.onSecondaryContainer)),
          ),
        ],
      ),
    );
  }
}

/// A name with a status or rating on the right and its figures underneath.
class _ListRow extends StatelessWidget {
  const _ListRow({required this.title, required this.detail, this.trailing, this.onTap});

  final String title;
  final String detail;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final body = Padding(
      padding: const EdgeInsets.symmetric(vertical: Gap.s + 2),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w500,
                          color: onTap == null ? null : theme.colorScheme.primary,
                        ),
                      ),
                    ),
                    if (trailing != null) ...[const SizedBox(width: Gap.s), trailing!],
                  ],
                ),
                const SizedBox(height: 3),
                Text(detail, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
          ),
          if (onTap != null) ...[const SizedBox(width: Gap.xs), Icon(Icons.chevron_right, color: theme.colorScheme.onSurfaceVariant)],
        ],
      ),
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: theme.colorScheme.outlineVariant.withValues(alpha: 0.5))),
      ),
      child: onTap == null
          ? MergeSemantics(child: body)
          : InkWell(
              onTap: onTap,
              child: Semantics(button: true, child: body),
            ),
    );
  }
}
