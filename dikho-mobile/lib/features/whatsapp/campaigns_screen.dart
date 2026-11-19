import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/platform_api.dart';
import '../../shared/record_ui.dart';
import '../../shared/values.dart';
import '../inbox/chat_theme.dart';
import 'analytics_models.dart' show formatStamp, parseStamp;
import 'campaign_screen.dart';
import 'campaign_wizard_screen.dart';

/// One campaign as GET /api/campaigns lists it (src/api/routes/campaigns/index.js).
class CampaignRow {
  const CampaignRow({
    required this.id,
    required this.name,
    required this.template,
    required this.status,
    required this.total,
    required this.sent,
    required this.failed,
    this.createdAt,
  });

  factory CampaignRow.from(Map<String, dynamic> row) {
    int number(String key) => row[key] is num ? (row[key] as num).toInt() : int.tryParse('${row[key]}') ?? 0;
    String text(String key) => row[key] is String ? (row[key] as String).trim() : '';
    return CampaignRow(
      id: number('id'),
      name: text('name').isEmpty ? 'Campaign' : text('name'),
      template: text('template_name'),
      status: text('status'),
      total: number('total_count'),
      sent: number('sent_count'),
      failed: number('failed_count'),
      createdAt: parseStamp(row['created_at']),
    );
  }

  final int id;
  final String name;
  final String template;
  final String status;
  final int total;

  /// Handed to Meta, as the web list counts it.
  final int sent;
  final int failed;
  final DateTime? createdAt;

  /// Everyone it was meant to reach but has not: failures and anyone never tried.
  int get outstanding => total > sent ? total - sent : 0;

  bool get sending => status == 'sending';
}

PillTone campaignTone(String status) => switch (status) {
  'completed' => PillTone.active,
  'sending' || 'stopped' => PillTone.pending,
  'failed' => PillTone.danger,
  _ => PillTone.neutral,
};

/// Every bulk send, newest first, with how far each got. A campaign opens its own
/// performance screen; New campaign opens the native wizard.
class CampaignsScreen extends StatefulWidget {
  const CampaignsScreen({
    super.key,
    required this.api,
    required this.platform,
    required this.onOpenDrawer,
    this.onNewCampaign,
    this.canSend = false,
    this.numberStyle = 'en-IN',
    this.refreshWhileSending = const Duration(seconds: 15),
  });

  final CrmApi api;
  final PlatformApi platform;
  final VoidCallback onOpenDrawer;

  /// Instead of the native wizard, for tests.
  final VoidCallback? onNewCampaign;
  final bool canSend;
  final String numberStyle;

  /// While a campaign is sending, the list asks again this often to show its progress.
  final Duration refreshWhileSending;

  @override
  State<CampaignsScreen> createState() => _CampaignsScreenState();
}

class _CampaignsScreenState extends State<CampaignsScreen> {
  List<CampaignRow>? _rows;
  String? _error;
  bool _loading = false;
  int _request = 0;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final request = ++_request;
    setState(() => _loading = true);
    try {
      final data = await widget.api.get('/campaigns');
      if (!mounted || request != _request) return;
      final rows = [
        for (final row in data['campaigns'] as List? ?? const [])
          if (row is Map<String, dynamic>) CampaignRow.from(row),
      ];
      setState(() {
        _rows = rows;
        _error = null;
      });
      _schedule(rows);
    } on ApiException catch (failure) {
      if (!mounted || request != _request) return;
      setState(() => _error = failure.message);
    } finally {
      if (mounted && request == _request) setState(() => _loading = false);
    }
  }

  /// Only while something is sending, and only while this screen is on top.
  void _schedule(List<CampaignRow> rows) {
    _poll?.cancel();
    if (!rows.any((row) => row.sending)) return;
    _poll = Timer(widget.refreshWhileSending, () {
      if (mounted && (ModalRoute.of(context)?.isCurrent ?? true)) {
        unawaited(_load());
      } else if (mounted) {
        _schedule(rows);
      }
    });
  }

  String _count(int n) => formatCount(n, style: widget.numberStyle);

  Future<void> _newCampaign() async {
    final custom = widget.onNewCampaign;
    if (custom != null) return custom();
    await openCampaignWizard(context, api: widget.api, platform: widget.platform, numberStyle: widget.numberStyle);
    if (mounted) unawaited(_load());
  }

  Future<void> _open(CampaignRow row) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => CampaignScreen(api: widget.api, id: row.id, title: row.name, numberStyle: widget.numberStyle, canSend: widget.canSend),
      ),
    );
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
        title: const Text('Campaigns'),
        bottom: _loading && rows != null
            ? const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator(minHeight: 2))
            : null,
      ),
      floatingActionButton: widget.canSend
          ? FloatingActionButton.extended(onPressed: () => unawaited(_newCampaign()), icon: const Icon(Icons.add), label: const Text('New campaign'))
          : null,
      body: rows == null
          ? (_error == null
                ? const Center(child: CircularProgressIndicator())
                : EmptyMessage(title: "Couldn't load campaigns", body: _error!, action: 'Try again', onAction: () => unawaited(_load())))
          : rows.isEmpty
          ? EmptyMessage(
              title: 'No campaigns yet',
              body: widget.canSend
                  ? 'Create one to send an approved template to a list of contacts.'
                  : 'Campaigns appear here once someone with permission to send creates one.',
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                // Room under the last row for the New campaign button.
                padding: EdgeInsets.only(bottom: widget.canSend ? 88 : Gap.l),
                itemCount: rows.length + (_error == null ? 0 : 1),
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  if (_error != null && index == 0) return _ErrorLine(text: "Couldn't refresh: $_error");
                  final row = rows[index - (_error == null ? 0 : 1)];
                  return _CampaignTile(key: ValueKey(row.id), row: row, count: _count, onTap: () => unawaited(_open(row)));
                },
              ),
            ),
    );
  }
}

class _ErrorLine extends StatelessWidget {
  const _ErrorLine({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      color: scheme.errorContainer,
      padding: const EdgeInsets.symmetric(horizontal: Gap.l, vertical: Gap.s),
      child: Text(text, style: TextStyle(color: scheme.onErrorContainer)),
    );
  }
}

class _CampaignTile extends StatelessWidget {
  const _CampaignTile({super.key, required this.row, required this.count, required this.onTap});

  final CampaignRow row;
  final String Function(int) count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final share = row.total > 0 ? (row.sent / row.total).clamp(0.0, 1.0) : 0.0;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.m, Gap.m),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: Text(row.name, style: theme.textTheme.titleSmall)),
                      const SizedBox(width: Gap.s),
                      Pill(label: sentenceCase(row.status.isEmpty ? 'draft' : row.status), tone: campaignTone(row.status)),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text('${row.template}, ${formatStamp(row.createdAt)}', style: muted, maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: Gap.s),
                  Text(
                    '${count(row.sent)} of ${count(row.total)} sent'
                    // While sending, the rest are still to come, not missed.
                    '${row.outstanding > 0 && !row.sending ? ', ${count(row.outstanding)} not received' : ''}',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: row.outstanding > 0 && !row.sending ? theme.colorScheme.error : null,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                  if (row.sending) ...[
                    const SizedBox(height: Gap.xs),
                    Semantics(
                      label: 'Sending, ${(share * 100).round()} percent',
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(value: share, minHeight: 6),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: Gap.xs),
            Icon(Icons.chevron_right, color: theme.colorScheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}
