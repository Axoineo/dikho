import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import '../whatsapp/analytics_parts.dart';
import 'email_api.dart';
import 'email_models.dart';

/// What Email shows this person, from their permissions. The API checks again.
class EmailAbilities {
  const EmailAbilities({required this.userId, this.inbox = false, this.mailboxes = false, this.campaigns = false, this.approve = false});

  final String userId;

  /// email_inbox.view
  final bool inbox;

  /// email_mailboxes.manage
  final bool mailboxes;

  /// Any of email_campaigns.view, .create or .approve.
  final bool campaigns;

  /// email_campaigns.approve
  final bool approve;

  bool get usesMail => inbox || mailboxes;
}

/// The Email Hub's landing page, redesigned for a phone from EmailOverview.jsx: what
/// needs attention now, and what is not set up yet. Every number is real.
class EmailOverviewScreen extends StatefulWidget {
  const EmailOverviewScreen({
    super.key,
    required this.api,
    required this.abilities,
    required this.onOpenDrawer,
    required this.onOpenInbox,
    required this.onOpenThread,
    required this.onOpenPage,
    this.now,
  });

  final EmailApi api;
  final EmailAbilities abilities;
  final VoidCallback onOpenDrawer;
  final VoidCallback onOpenInbox;
  final Future<void> Function(BuildContext context, ThreadSummary thread) onOpenThread;

  /// A page that is still the web's (settings, campaigns).
  final ValueChanged<String> onOpenPage;
  final DateTime Function()? now;

  @override
  State<EmailOverviewScreen> createState() => _EmailOverviewScreenState();
}

class _EmailOverviewScreenState extends State<EmailOverviewScreen> {
  Map<String, dynamic>? _accounts;
  List<Mailbox> _boxes = const [];
  String? _error;
  Map<String, dynamic>? _status;
  List<ThreadSummary>? _unread;
  List<ThreadSummary>? _assigned;
  Map<String, dynamic>? _marketing;
  String? _syncing;

  EmailApi get _api => widget.api;
  EmailAbilities get _a => widget.abilities;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final accounts = await _api.accounts();
      final list = accounts['mailboxes'];
      if (!mounted) return;
      setState(() {
        _accounts = accounts;
        _boxes = [
          if (list is List)
            for (final m in list)
              if (m is Map) Mailbox(Map<String, dynamic>.from(m)),
        ];
        _error = null;
      });
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
    unawaited(_api.status().then((s) => mounted ? setState(() => _status = s) : null).catchError((Object _) {}));
    if (_a.campaigns) {
      unawaited(_api.campaigns().then((c) => mounted ? setState(() => _marketing = c) : null).catchError((Object _) {}));
    }
    if (_boxes.isNotEmpty && _a.inbox) {
      try {
        final (unread, _) = await _api.threads(folder: 'inbox', unread: true, limit: 6);
        final (assigned, _) = await _api.threads(folder: 'assigned', limit: 50);
        if (mounted) {
          setState(() {
            _unread = unread;
            _assigned = assigned;
          });
        }
      } on ApiException {
        // The cards say what they could not load.
        if (mounted) setState(() => _unread ??= const []);
      }
    }
  }

  Future<void> _sync(Mailbox m) async {
    setState(() => _syncing = m.id);
    try {
      final busy = await _api.sync(m.id);
      _say(busy ? 'A sync is already running for this mailbox.' : 'Mailbox synced.');
      await _load();
    } on ApiException catch (failure) {
      _say(failure.message);
    } finally {
      if (mounted) setState(() => _syncing = null);
    }
  }

  void _say(String text) {
    if (mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final now = (widget.now ?? DateTime.now)();
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final boxes = _boxes;
    final hasMailbox = boxes.isNotEmpty;
    final unreadTotal = boxes.fold<int>(0, (n, m) => n + m.unread);
    final connected = boxes.where((m) => m.connected).length;
    final attention = boxes.where((m) => m.status == 'reauth_required' || m.syncTrouble).toList();
    final openAssigned = (_assigned ?? const <ThreadSummary>[]).where((t) => t.workflow != 'closed').length;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', icon: const Icon(Icons.menu), onPressed: widget.onOpenDrawer),
        title: const Text('Email'),
        actions: [IconButton(tooltip: 'Refresh', onPressed: () => unawaited(_load()), icon: const Icon(Icons.refresh))],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl * 2),
          children: [
            Text("Your mailboxes and your team's, beside the clients and vendors they concern.", style: muted),
            const SizedBox(height: Gap.m),
            if (_error != null) _Banner(text: "Couldn't load your mailboxes. $_error", danger: true),
            if (_accounts == null && _error == null)
              const Padding(
                padding: EdgeInsets.all(Gap.xl),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (_accounts != null && !hasMailbox && _a.usesMail) _setup(context),
            if (hasMailbox) ...[
              if (_a.inbox)
                Padding(
                  padding: const EdgeInsets.only(bottom: Gap.m),
                  child: FilledButton.icon(onPressed: widget.onOpenInbox, icon: const Icon(Icons.inbox_outlined), label: const Text('Open inbox')),
                ),
              KpiGrid(
                children: [
                  KpiTile(
                    label: 'Unread in inbox',
                    value: formatCount(unreadTotal),
                    sub: 'across ${boxes.length} mailbox${boxes.length == 1 ? '' : 'es'}',
                  ),
                  KpiTile(
                    label: 'Assigned to you',
                    value: _assigned == null ? '–' : (openAssigned >= 50 ? '50+' : '$openAssigned'),
                    sub: 'open or waiting',
                  ),
                  KpiTile(label: 'Connected', value: '$connected/${boxes.length}', sub: 'mailboxes syncing'),
                  KpiTile(label: 'Needs attention', value: '${attention.length}', sub: attention.isEmpty ? 'all healthy' : 'reconnect or check sync'),
                ],
              ),
              const SizedBox(height: Gap.m),
              for (final m in attention)
                _Banner(
                  text:
                      '${m.email}: ${m.status == 'reauth_required' ? "Google no longer accepts Dikho's access. It must be reconnected." : m.syncError}',
                  danger: m.status == 'reauth_required',
                  action: m.canConfigure ? TextButton(onPressed: () => widget.onOpenPage('/email/settings'), child: const Text('Fix')) : null,
                ),
              if (_a.inbox)
                SectionCard(
                  title: 'Unread',
                  subtitle: 'Newest first, from every mailbox you can read.',
                  action: TextButton(onPressed: widget.onOpenInbox, child: const Text('View all')),
                  child: _unread == null
                      ? const Center(child: CircularProgressIndicator())
                      : _unread!.isEmpty
                      ? const QuietText("You're all caught up. No unread conversations.")
                      : Column(
                          children: [
                            for (final t in _unread!)
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: Icon(Icons.circle, size: 10, color: theme.colorScheme.primary, semanticLabel: 'Unread'),
                                title: Text(t.participantLine, maxLines: 1, overflow: TextOverflow.ellipsis),
                                subtitle: Text(t.subject, maxLines: 1, overflow: TextOverflow.ellipsis),
                                trailing: Text(listTime(t.lastMessageAt, now), style: muted),
                                onTap: () => unawaited(widget.onOpenThread(context, t)),
                              ),
                          ],
                        ),
                ),
              SectionCard(
                title: 'Mailboxes',
                subtitle: 'Only mailboxes you have been added to.',
                action: TextButton(onPressed: () => widget.onOpenPage('/email/settings'), child: const Text('Manage')),
                child: Column(
                  children: [
                    for (final m in boxes)
                      Padding(
                        padding: const EdgeInsets.only(bottom: Gap.m),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(m.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                                  Text(
                                    [
                                      m.email,
                                      roleLabels[m.role] ?? m.role,
                                      m.kind == 'shared'
                                          ? 'Shared'
                                          : (m.ownerId == _a.userId ? 'Yours' : "${m.ownerName.isEmpty ? 'Someone' : m.ownerName}'s"),
                                      'synced ${syncedAgo(m.lastSyncedAt, now)}',
                                    ].join(' · '),
                                    style: muted,
                                  ),
                                  const SizedBox(height: Gap.xs),
                                  Wrap(
                                    spacing: Gap.s,
                                    runSpacing: Gap.xs,
                                    children: [
                                      Pill(label: mailboxStatus[m.status] ?? m.status, tone: m.connected ? PillTone.active : PillTone.danger),
                                      if (m.unread > 0) Pill(label: '${m.unread} unread', tone: PillTone.pending),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                            if (m.connected)
                              IconButton(
                                tooltip: 'Sync ${m.email} now',
                                onPressed: _syncing == m.id ? null : () => unawaited(_sync(m)),
                                icon: _syncing == m.id
                                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                    : const Icon(Icons.sync),
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
            if (_a.campaigns) _marketingCard(),
            if (hasMailbox) _connections(),
          ],
        ),
      ),
    );
  }

  Widget _setup(BuildContext context) {
    final status = _status;
    final gmail = status?['gmail'] is Map ? status!['gmail'] as Map : const {};
    final accounts = _accounts ?? const {};
    final shared = accounts['shared_setup'];
    final steps = [
      (
        gmail['configured'] == true,
        'Google sign-in configured on the server',
        gmail['configured'] == true ? 'Ready.' : 'An administrator adds the Google sign-in client and the token key in Email settings.',
      ),
      (
        false,
        accounts['can_connect_personal'] == true ? 'Connect your own Google Workspace mailbox' : 'Ask for Email access',
        accounts['can_connect_personal'] == true
            ? 'You sign in with Google; Dikho never sees your password.'
            : 'You need the "Use the Email inbox" permission.',
      ),
      if (accounts['can_manage_shared'] == true)
        (
          shared is List && shared.any((m) => m is Map && m['status'] == 'connected'),
          'Set up a shared team mailbox',
          'For example sales@ or accounts@. Choose who may read and answer it.',
        ),
      (
        gmail['push'] == true,
        'Instant updates from Gmail (optional)',
        gmail['push'] == true ? 'Gmail push is configured.' : 'Without it, mailboxes refresh when someone opens Email.',
      ),
    ];
    return SectionCard(
      title: 'Get started',
      subtitle: 'Mail stays in the mailbox. Dikho keeps only what it needs to list conversations.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final (done, title, note) in steps)
            MergeSemantics(
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  done ? Icons.check_circle : Icons.radio_button_unchecked,
                  color: done ? Colors.green.shade700 : null,
                  semanticLabel: done ? 'Done' : 'Not done',
                ),
                title: Text(title),
                subtitle: Text(note),
              ),
            ),
          const SizedBox(height: Gap.s),
          FilledButton(onPressed: () => widget.onOpenPage('/email/settings'), child: const Text('Go to Email settings')),
        ],
      ),
    );
  }

  Widget _marketingCard() {
    final data = _marketing;
    final list = data?['campaigns'] is List ? (data!['campaigns'] as List).whereType<Map>().toList() : const <Map>[];
    int count(Set<String> statuses) => list.where((c) => statuses.contains(c['status'])).length;
    final awaiting = count({'pending_approval'});
    final readiness = data?['readiness'] is Map ? data!['readiness'] as Map : const {};
    final missing = readiness['missing'] is List ? (readiness['missing'] as List).join(', ') : '';
    final notes = data == null
        ? ''
        : [
            if (awaiting > 0 && _a.approve)
              '$awaiting campaign${awaiting == 1 ? ' needs' : 's need'} an approver who did not write ${awaiting == 1 ? 'it' : 'them'}.',
            if (readiness['ready'] != true) 'Campaign sending is not switched on yet (needs ${missing.isEmpty ? 'server settings' : missing}).',
          ].join(' ');
    return SectionCard(
      title: 'Campaigns',
      subtitle: 'Marketing email, approved by a second person before it is sent.',
      action: TextButton(onPressed: () => widget.onOpenPage('/email/campaigns'), child: const Text('Open')),
      footnote: notes.isEmpty ? null : notes,
      child: data == null
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                FactRow(label: 'Awaiting approval', child: Text('$awaiting')),
                FactRow(label: 'Drafts', child: Text('${count({'draft', 'rejected'})}')),
                FactRow(label: 'Scheduled or sending', child: Text('${count({'approved', 'sending', 'paused'})}')),
              ],
            ),
    );
  }

  Widget _connections() {
    final status = _status;
    if (status == null) return const SizedBox.shrink();
    Map m(String key) => status[key] is Map ? status[key] as Map : const {};
    final gmail = m('gmail');
    final hostinger = m('hostinger');
    final delivery = m('delivery');
    final rows = [
      (
        'Google Workspace',
        gmail['configured'] == true,
        gmail['configured'] == true ? 'Gmail mailboxes can be connected.' : 'Not configured on the server.',
      ),
      (
        'Hostinger Email',
        hostinger['configured'] == true,
        hostinger['configured'] == true ? 'Hostinger mailboxes can be connected.' : 'Not configured on the server.',
      ),
      (
        'Gmail push',
        gmail['push'] == true,
        gmail['push'] == true ? 'Changes arrive within seconds.' : 'Off: mailboxes refresh when Email is opened.',
      ),
      (
        'System email',
        '${delivery['provider'] ?? ''}'.isNotEmpty,
        delivery['provider'] == 'ses'
            ? 'Sent through Amazon SES.'
            : delivery['provider'] == 'brevo'
            ? 'Welcome emails and alerts go through Brevo.'
            : 'No system email sender is configured.',
      ),
    ];
    return SectionCard(
      title: 'Connections',
      subtitle: 'Set on the server by an administrator.',
      child: Column(
        children: [
          for (final (name, ok, note) in rows)
            MergeSemantics(
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(ok ? Icons.check_circle_outline : Icons.error_outline, semanticLabel: ok ? 'On' : 'Off'),
                title: Text(name),
                subtitle: Text(note),
              ),
            ),
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, this.danger = false, this.action});

  final String text;
  final bool danger;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ground = danger ? theme.colorScheme.errorContainer : theme.colorScheme.tertiaryContainer;
    final ink = danger ? theme.colorScheme.onErrorContainer : theme.colorScheme.onTertiaryContainer;
    return Container(
      margin: const EdgeInsets.only(bottom: Gap.m),
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(color: ground, borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          Icon(danger ? Icons.error_outline : Icons.warning_amber_outlined, color: ink),
          const SizedBox(width: Gap.m),
          Expanded(
            child: Text(text, style: TextStyle(color: ink)),
          ),
          ?action,
        ],
      ),
    );
  }
}
