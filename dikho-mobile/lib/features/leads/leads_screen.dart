import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../shared/platform_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import 'leads_controller.dart';
import 'leads_models.dart';

const _loadMoreWithin = 200.0;

/// Everyone who sent an intake form, newest first, a page at a time.
class LeadsScreen extends StatefulWidget {
  const LeadsScreen({super.key, required this.controller, required this.platform, required this.onOpenDrawer});

  final LeadsController controller;
  final PlatformApi platform;
  final VoidCallback onOpenDrawer;

  @override
  State<LeadsScreen> createState() => _LeadsScreenState();
}

class _LeadsScreenState extends State<LeadsScreen> {
  final _scroll = ScrollController();
  final _search = TextEditingController();

  LeadsController get _leads => widget.controller;

  @override
  void initState() {
    super.initState();
    _search.text = _leads.query;
    _scroll.addListener(() {
      final position = _scroll.position;
      if (position.maxScrollExtent - position.pixels < _loadMoreWithin) {
        unawaited(_leads.loadMore());
      }
    });
    // Kept for the session, so coming back shows the last list at once, then refreshes it.
    if (_leads.leads.isEmpty && !_leads.loading) {
      unawaited(_leads.start());
    } else {
      unawaited(_leads.refresh());
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    _search.dispose();
    super.dispose();
  }

  void _open(Lead lead) {
    // Otherwise the search box takes the focus back, and the keyboard with it, on return.
    FocusManager.instance.primaryFocus?.unfocus();
    unawaited(
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => LeadDetailsScreen(lead: lead, status: _leads.statusFor(lead), platform: widget.platform),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
        title: const Text('Leads'),
      ),
      body: ListenableBuilder(
        listenable: _leads,
        builder: (context, _) => Column(
          children: [
            Container(
              color: theme.colorScheme.surface,
              padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, Gap.m, Gap.s),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: _search,
                    onChanged: (value) {
                      setState(() {});
                      _leads.setQuery(value);
                    },
                    textInputAction: TextInputAction.search,
                    decoration: InputDecoration(
                      prefixIcon: const Icon(Icons.search),
                      hintText: 'Search company, name, email, city or mobile',
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Clear search',
                              onPressed: () {
                                _search.clear();
                                setState(() {});
                                _leads.setQuery('');
                              },
                              icon: const Icon(Icons.close),
                            ),
                    ),
                  ),
                  const SizedBox(height: Gap.s),
                  _Confirmations(controller: _leads),
                ],
              ),
            ),
            const Divider(),
            Expanded(child: _body(context, theme)),
          ],
        ),
      ),
    );
  }

  Widget _body(BuildContext context, ThemeData theme) {
    final leads = _leads.leads;
    if (leads.isEmpty) {
      if (_leads.loading) {
        return const Center(child: CircularProgressIndicator());
      }
      if (_leads.error != null) {
        return EmptyMessage(title: "Couldn't load leads", body: _leads.error!, action: 'Try again', onAction: () => unawaited(_leads.reload()));
      }
      return EmptyMessage(
        title: _leads.query.isEmpty ? 'No leads yet' : 'No leads match your search',
        body: _leads.query.isEmpty
            ? 'Leads arrive here when someone fills in an intake form, such as the corporate gifting page.'
            : 'Try a different company, name, email, city or number.',
      );
    }
    final footer = _leads.hasMore ? 1 : 0;
    return RefreshIndicator(
      onRefresh: _leads.refresh,
      child: ListView.builder(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        itemExtent: recordRowExtent(context),
        itemCount: leads.length + footer,
        itemBuilder: (context, index) {
          if (index == leads.length) {
            return const Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)));
          }
          final lead = leads[index];
          return _LeadRow(key: ValueKey(lead.id), lead: lead, status: _leads.statusFor(lead), onTap: () => _open(lead));
        },
      ),
    );
  }
}

/// The web page's four tiles, as one line: WhatsApp confirmations, once per number a week.
class _Confirmations extends StatelessWidget {
  const _Confirmations({required this.controller});

  final LeadsController controller;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Widget figure(String label, String status, {bool danger = false}) {
      final count = controller.countOf(status);
      return Expanded(
        child: Semantics(
          label: '$label $count',
          excludeSemantics: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              Text('$count', style: theme.textTheme.titleMedium?.copyWith(color: danger && count > 0 ? theme.colorScheme.error : null)),
            ],
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('WhatsApp confirmations', style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        const SizedBox(height: Gap.xs),
        Row(children: [figure('Sent', 'sent'), figure('Delivered', 'delivered'), figure('Read', 'read'), figure('Failed', 'failed', danger: true)]),
      ],
    );
  }
}

class _LeadRow extends StatelessWidget {
  const _LeadRow({super.key, required this.lead, required this.status, required this.onTap});

  final Lead lead;
  final LeadStatus? status;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Gap.m),
        child: Row(
          children: [
            Initials(text: lead.initials, size: 44),
            const SizedBox(width: Gap.m),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(lead.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15)),
                  const SizedBox(height: 2),
                  Text(
                    lead.subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            const SizedBox(width: Gap.s),
            StatusPill(status: status),
            Icon(Icons.chevron_right, color: theme.colorScheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}

/// The WhatsApp confirmation state, coloured as the web page colours it.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.status});

  final LeadStatus? status;

  @override
  Widget build(BuildContext context) => Pill(
    label: status?.label ?? 'Not sent',
    tone: switch (status?.status) {
      'delivered' || 'read' => PillTone.active,
      'sent' => PillTone.pending,
      'failed' => PillTone.danger,
      _ => PillTone.neutral,
    },
  );
}

/// Everything known about one lead, with the ways to reach them.
class LeadDetailsScreen extends StatelessWidget {
  const LeadDetailsScreen({super.key, required this.lead, required this.status, required this.platform});

  final Lead lead;
  final LeadStatus? status;
  final PlatformApi platform;

  Future<void> _call(BuildContext context, String number) async {
    // Asked at the first call. If refused, the dialer opens with the number filled in.
    await Permission.phone.request();
    final result = await platform.placeCall(number);
    if (result == null && context.mounted) {
      _notice(context, 'This phone cannot place calls.');
    }
  }

  Future<void> _open(BuildContext context, String url) async {
    if (!await platform.openExternal(url) && context.mounted) {
      _notice(context, 'No app on this phone can open that.');
    }
  }

  void _notice(BuildContext context, String text) => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final number = lead.dialable;
    final email = lead.email;
    final rows = <(String, String)>[
      ('Name', lead.name),
      ('Company', lead.companyName),
      ('Mobile', lead.phoneDisplay ?? ''),
      ('Email', email),
      ('City', lead.city),
      ('Source', leadSource),
      ('Submitted', formatDisplayDate(lead.createdAt)),
    ];
    final failure = status?.status == 'failed' ? status?.error : null;
    return Scaffold(
      appBar: AppBar(title: const Text('Lead')),
      body: ListView(
        padding: const EdgeInsets.all(Gap.l),
        children: [
          Row(
            children: [
              Initials(text: lead.initials, size: 52),
              const SizedBox(width: Gap.m),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(lead.title, style: theme.textTheme.titleLarge),
                    const SizedBox(height: Gap.xs),
                    StatusPill(status: status),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: Gap.l),
          Row(
            children: [
              QuickAction(icon: Icons.call_outlined, label: 'Call', onPressed: number == null ? null : () => unawaited(_call(context, number))),
              const SizedBox(width: Gap.s),
              QuickAction(
                icon: Icons.chat_outlined,
                label: 'WhatsApp',
                onPressed: number == null
                    ? null
                    : () => unawaited(_open(context, 'https://wa.me/${number.substring(1)}?text=${Uri.encodeComponent(leadFollowUpMessage)}')),
              ),
              const SizedBox(width: Gap.s),
              QuickAction(
                icon: Icons.mail_outline,
                label: 'Email',
                onPressed: email.isEmpty ? null : () => unawaited(_open(context, Uri(scheme: 'mailto', path: email).toString())),
              ),
            ],
          ),
          const SizedBox(height: Gap.l),
          DetailsCard(title: 'Details', rows: rows),
          if (failure != null && failure.isNotEmpty) ...[
            const SizedBox(height: Gap.l),
            Text('WhatsApp confirmation', style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            const SizedBox(height: Gap.s),
            Text(failure),
          ],
        ],
      ),
    );
  }
}
