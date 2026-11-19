import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import '../whatsapp/analytics_parts.dart' show SectionCard;
import 'email_api.dart';
import 'email_models.dart';
import 'email_settings_models.dart';

PillTone mailboxTone(String status) => switch (status) {
  'connected' => PillTone.active,
  'pending' => PillTone.pending,
  'reauth_required' => PillTone.danger,
  _ => PillTone.neutral,
};

/// Email settings, as EmailSettings.jsx: connecting mailboxes (Google Workspace or
/// Hostinger) and choosing who may use them. The buttons follow what the server says
/// this person may do; the database enforces the same rules (nobody grants themselves
/// access, a personal mailbox is shared only by its owner, setting up a shared mailbox
/// does not let you read it).
///
/// Google's sign-in cannot run inside an app, so connecting opens the phone's browser.
/// Google's return comes back to the app (an App Link on /email/connect), which finishes
/// it with this session and opens this screen with [outcome].
class EmailSettingsScreen extends StatefulWidget {
  const EmailSettingsScreen({
    super.key,
    required this.api,
    required this.me,
    required this.openExternal,
    required this.onOpenDrawer,
    this.myEmail = '',
    this.outcome,
    this.now,
  });

  final EmailApi api;

  /// This person's user id.
  final String me;

  /// This person's sign-in address, for the Hostinger explanation.
  final String myEmail;

  /// Opens a page in the phone's browser. False when nothing could open it.
  final Future<bool> Function(String url) openExternal;
  final VoidCallback onOpenDrawer;

  /// How the last Google connection ended, when the app was opened by its return.
  final String? outcome;
  final DateTime Function()? now;

  @override
  State<EmailSettingsScreen> createState() => _EmailSettingsScreenState();
}

class _EmailSettingsScreenState extends State<EmailSettingsScreen> {
  MailboxSettings? _data;
  ServerSetup? _setup;
  String? _error;
  String? _outcome;

  /// The mailbox being connected ('personal' for your own), while it is.
  String? _connecting;

  @override
  void initState() {
    super.initState();
    _outcome = widget.outcome;
    unawaited(_load());
  }

  @override
  void didUpdateWidget(EmailSettingsScreen old) {
    super.didUpdateWidget(old);
    if (widget.outcome != null && widget.outcome != old.outcome) {
      setState(() => _outcome = widget.outcome);
      unawaited(_load());
    }
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([widget.api.accounts(), widget.api.status()]);
      if (!mounted) return;
      setState(() {
        _data = MailboxSettings(results[0], me: widget.me);
        _setup = ServerSetup(results[1]);
        _error = null;
      });
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  void _say(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _connectGoogle(String? mailbox) async {
    setState(() => _connecting = mailbox ?? 'personal');
    try {
      final url = await widget.api.startGoogleConnect(mailbox);
      final opened = await widget.openExternal(url);
      _say(opened ? 'Finish in the browser. Dikho opens again when Google sends you back.' : "No browser on this phone could open Google's page.");
    } on ApiException catch (failure) {
      _say(failure.message);
    } finally {
      if (mounted) setState(() => _connecting = null);
    }
  }

  Future<void> _connectHostinger(String? mailbox) async {
    setState(() => _connecting = mailbox ?? 'personal');
    try {
      await widget.api.connectHostinger(mailbox);
      _say('Hostinger mailbox connected. The first sync is running; recent conversations appear in a minute.');
      await _load();
    } on ApiException catch (failure) {
      _say(failure.message);
    } finally {
      if (mounted) setState(() => _connecting = null);
    }
  }

  Future<void> _reconnect(Mailbox m) {
    final id = m.kind == 'personal' ? null : m.id;
    return m.provider == 'hostinger' ? _connectHostinger(id) : _connectGoogle(id);
  }

  Future<void> _sync(Mailbox m) async {
    try {
      final busy = await widget.api.sync(m.id);
      _say(busy ? 'A sync is already running.' : 'Mailbox synced.');
      await _load();
    } on ApiException catch (failure) {
      _say(failure.message);
    }
  }

  Future<void> _disconnect(Mailbox m, {required bool remove}) async {
    final hostinger = m.provider == 'hostinger';
    final body = remove
        ? 'Dikho stops using this mailbox and deletes what it cached about it: conversation list, internal notes and CRM links. Mail in ${hostinger ? 'Hostinger' : 'Gmail'} is not touched.'
        : hostinger
        ? "Dikho stops reading and sending from this mailbox at once. Conversation list, notes and links are kept, so reconnecting picks up where it left off. Mail at Hostinger is not touched. To remove Dikho's access at Hostinger itself, an administrator removes the mailbox from the API token in hPanel."
        : 'Dikho stops reading and sending from this mailbox at once and revokes its access at Google. Conversation list, notes and links are kept, so reconnecting picks up where it left off. Mail in Gmail is not touched.';
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) {
        final theme = Theme.of(dialog);
        return AlertDialog(
          title: Text(remove ? 'Remove ${m.email}?' : 'Disconnect ${m.email}?'),
          content: Text(body),
          actions: [
            TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Cancel')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: theme.colorScheme.error, foregroundColor: theme.colorScheme.onError),
              onPressed: () => Navigator.of(dialog).pop(true),
              child: Text(remove ? 'Remove mailbox' : 'Disconnect'),
            ),
          ],
        );
      },
    );
    if (ok != true) return;
    try {
      await (remove ? widget.api.removeMailbox(m.id) : widget.api.disconnect(m.id));
      _say(remove ? 'Mailbox removed.' : 'Mailbox disconnected.');
      await _load();
    } on ApiException catch (failure) {
      _say(failure.message);
    }
  }

  Future<void> _people(Mailbox m) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => MailboxPeopleScreen(api: widget.api, mailbox: m, me: widget.me),
      ),
    );
    unawaited(_load());
  }

  Future<void> _campaigns(Mailbox m) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheet) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheet).bottom),
        child: CampaignSenderForm(
          mailbox: m,
          onSave: (enabled, cap) async {
            await widget.api.setCampaignSender(m.id, enabled: enabled, dailyCap: cap);
            if (sheet.mounted) Navigator.of(sheet).pop();
            _say(enabled ? 'Campaigns may now be sent from ${m.email}, up to $cap a day.' : 'Campaigns are no longer sent from ${m.email}.');
            await _load();
          },
        ),
      ),
    );
  }

  Future<void> _addShared() async {
    final setup = _setup;
    final data = _data;
    if (setup == null || data == null) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheet) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheet).bottom),
        child: AddSharedForm(
          gmailReady: setup.gmail,
          hostingerReady: setup.hostinger,
          existing: {for (final m in data.sharedAdmin) m.email},
          loadHostinger: widget.api.hostingerAddresses,
          onAdd: (email, name, provider) async {
            await widget.api.createShared(email, name, provider);
            if (sheet.mounted) Navigator.of(sheet).pop();
            _say(
              provider == 'hostinger'
                  ? 'Hostinger mailbox added and connected. Add the people who should use it.'
                  : 'Shared mailbox added. Connect it to Google next.',
            );
            await _load();
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final data = _data;
    final setup = _setup;
    final outcome = _outcome == null ? null : connectOutcome(_outcome!);
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', icon: const Icon(Icons.menu), onPressed: widget.onOpenDrawer),
        title: const Text('Email settings'),
        actions: [IconButton(tooltip: 'Refresh', onPressed: () => unawaited(_load()), icon: const Icon(Icons.refresh))],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl * 2),
          children: [
            Text('Connect mailboxes and decide who may read and answer them.', style: muted),
            const SizedBox(height: Gap.m),
            if (outcome != null) Notice(tone: outcome.$1, text: outcome.$2, onClose: () => setState(() => _outcome = null)),
            if (_error != null) Notice(tone: NoticeTone.danger, title: 'Could not load mailboxes', text: _error!),
            if (data == null && _error == null)
              const Padding(
                padding: EdgeInsets.all(Gap.xl),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (setup != null && !setup.any)
              const Notice(
                tone: NoticeTone.warn,
                title: 'No mail provider is set up yet',
                text: 'An administrator needs to add Google OAuth (with the token encryption key) or a Hostinger Mail API token to the API server before any mailbox can be connected. The setup guide explains both.',
              ),
            if (data != null && setup != null) ...[
              if (data.canConnectPersonal) _yours(context, data, setup, muted),
              if (data.canManageShared || data.sharedAdmin.isNotEmpty) _shared(context, data, setup, muted),
              if (data.sharedWithMe.isNotEmpty) _withMe(context, data, muted),
              _system(context, setup, muted),
              Text(
                'Step-by-step setup for Google Workspace, Hostinger and campaign sending: docs/runbooks/email-hub-setup-guide.md in the Dikho repository.',
                style: muted,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _card(Mailbox m, ServerSetup setup, {bool shared = false, required bool connecting}) => MailboxCard(
    key: ValueKey('mailbox-${m.id}'),
    mailbox: m,
    api: widget.api,
    shared: shared,
    providerReady: setup.readyFor(m),
    connecting: connecting,
    now: (widget.now ?? DateTime.now)(),
    onSync: () => unawaited(_sync(m)),
    onConnect: () => unawaited(_reconnect(m)),
    onPeople: () => unawaited(_people(m)),
    onDisconnect: (remove) => unawaited(_disconnect(m, remove: remove)),
    onCampaigns: () => unawaited(_campaigns(m)),
  );

  Widget _yours(BuildContext context, MailboxSettings data, ServerSetup setup, TextStyle muted) {
    final mine = data.mine;
    final busy = _connecting != null;
    return SectionCard(
      title: 'Your mailbox',
      subtitle: 'Only you can read it, unless you add someone. Owners and administrators do not get access by their role.',
      child: mine != null
          ? _card(mine, setup, connecting: _connecting == 'personal')
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (setup.gmail)
                  Text(
                    "Google Workspace: you sign in on Google's page and approve access to read, organise and send mail. Dikho never sees your password, and you can disconnect at any time.",
                    style: muted,
                  ),
                if (setup.hostinger) ...[
                  const SizedBox(height: Gap.s),
                  Text(
                    "Hostinger: connects your own sign-in address${widget.myEmail.isEmpty ? '' : ' (${widget.myEmail})'}, if it is a Hostinger mailbox included in Dikho's Hostinger API token. Nobody can connect a colleague's address this way.",
                    style: muted,
                  ),
                ],
                if (!setup.any) Text('Connecting becomes available once an administrator has set up a mail provider.', style: muted),
                const SizedBox(height: Gap.m),
                Wrap(
                  spacing: Gap.s,
                  runSpacing: Gap.s,
                  children: [
                    if (setup.gmail)
                      FilledButton.icon(
                        onPressed: busy ? null : () => unawaited(_connectGoogle(null)),
                        icon: const Icon(Icons.mail_outline),
                        label: Text(_connecting == 'personal' ? 'Opening Google…' : 'Connect with Google'),
                      ),
                    if (setup.hostinger)
                      (setup.gmail
                          ? OutlinedButton.icon(
                              onPressed: busy ? null : () => unawaited(_connectHostinger(null)),
                              icon: const Icon(Icons.mail_outline),
                              label: const Text('Connect Hostinger mailbox'),
                            )
                          : FilledButton.icon(
                              onPressed: busy ? null : () => unawaited(_connectHostinger(null)),
                              icon: const Icon(Icons.mail_outline),
                              label: Text(_connecting == 'personal' ? 'Connecting…' : 'Connect Hostinger mailbox'),
                            )),
                  ],
                ),
              ],
            ),
    );
  }

  Widget _shared(BuildContext context, MailboxSettings data, ServerSetup setup, TextStyle muted) {
    final list = data.sharedAdmin;
    return SectionCard(
      title: 'Shared mailboxes',
      subtitle: 'Team addresses (for example sales@ or contact@) at Google Workspace or Hostinger. Setting one up does not let you read it; someone else adds you.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (data.canManageShared)
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: setup.any ? () => unawaited(_addShared()) : null,
                icon: const Icon(Icons.add),
                label: const Text('Add a shared mailbox'),
              ),
            ),
          if (list.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: Gap.m),
              child: Text('No shared mailboxes yet.', style: muted),
            ),
          for (final m in list) ...[const Divider(height: Gap.xl), _card(m, setup, shared: true, connecting: _connecting == m.id)],
        ],
      ),
    );
  }

  Widget _withMe(BuildContext context, MailboxSettings data, TextStyle muted) => SectionCard(
    title: 'Shared with you',
    subtitle: 'Mailboxes someone else has added you to.',
    child: Column(
      children: [
        for (final m in data.sharedWithMe)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(m.name),
            subtitle: Text(
              [
                m.email,
                if (m.kind == 'personal' && m.ownerName.isNotEmpty) "${m.ownerName}'s mailbox",
                'you: ${roleLabels[m.role] ?? m.role}',
                mailboxStatus[m.status] ?? m.status,
              ].join(' · '),
            ),
            trailing: TextButton(onPressed: () => unawaited(_people(m)), child: const Text('People')),
          ),
      ],
    ),
  );

  Widget _system(BuildContext context, ServerSetup setup, TextStyle muted) {
    final who = setup.sender == 'brevo'
        ? 'Brevo'
        : setup.sender == 'ses'
        ? 'Amazon SES'
        : 'no provider yet';
    return SectionCard(
      title: 'System email',
      action: Pill(label: senderLabel(setup.sender), tone: setup.sender.isEmpty ? PillTone.pending : PillTone.active),
      subtitle:
          'Mail Dikho sends by itself, such as staff welcome emails, goes through $who. Approved campaigns are sent from a connected mailbox that has been allowed for campaigns above; Amazon SES is optional and not required.',
      child: Column(
        children: [
          _Check(done: setup.brevo, text: 'Brevo configured (system email)'),
          _Check(done: setup.sesOn, text: 'Amazon SES (optional): ${setup.sesOn ? 'switched on' : 'off'}'),
        ],
      ),
    );
  }
}

class _Check extends StatelessWidget {
  const _Check({required this.done, required this.text});

  final bool done;
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Gap.xs),
        child: Row(
          children: [
            Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, size: 20, color: done ? scheme.primary : scheme.outline),
            const SizedBox(width: Gap.m),
            Expanded(child: Text(text)),
            Semantics(label: done ? 'done' : 'not done', child: const SizedBox.shrink()),
          ],
        ),
      ),
    );
  }
}

/// A coloured message at the top of the screen.
class Notice extends StatelessWidget {
  const Notice({super.key, required this.tone, required this.text, this.title, this.onClose});

  final NoticeTone tone;
  final String text;
  final String? title;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final (Color ground, Color ink) = switch (tone) {
      NoticeTone.ok => dark ? (const Color(0xFF1F3B2A), const Color(0xFF8FD6A7)) : (const Color(0xFFE6F4EA), const Color(0xFF1E6B3A)),
      NoticeTone.warn => dark ? (const Color(0xFF3D3016), const Color(0xFFF2C46B)) : (const Color(0xFFFFF4DE), const Color(0xFF8A5A00)),
      NoticeTone.danger => (scheme.errorContainer, scheme.onErrorContainer),
    };
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: Gap.m),
        padding: const EdgeInsets.fromLTRB(Gap.m, Gap.m, Gap.xs, Gap.m),
        decoration: BoxDecoration(color: ground, borderRadius: BorderRadius.circular(12)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (title != null)
                    Text(
                      title!,
                      style: TextStyle(fontWeight: FontWeight.w600, color: ink),
                    ),
                  Text(text, style: TextStyle(color: ink)),
                ],
              ),
            ),
            if (onClose != null)
              IconButton(
                tooltip: 'Dismiss',
                visualDensity: VisualDensity.compact,
                onPressed: onClose,
                icon: Icon(Icons.close, color: ink),
              )
            else
              const SizedBox(width: Gap.s),
          ],
        ),
      ),
    );
  }
}

/// One mailbox: who it is, whether it is connected and receives mail, how full it is,
/// whether it may send campaigns, and what this person may do with it.
class MailboxCard extends StatefulWidget {
  const MailboxCard({
    super.key,
    required this.mailbox,
    required this.api,
    required this.providerReady,
    required this.connecting,
    required this.now,
    required this.onSync,
    required this.onConnect,
    required this.onPeople,
    required this.onDisconnect,
    required this.onCampaigns,
    this.shared = false,
  });

  final Mailbox mailbox;
  final EmailApi api;
  final bool shared;
  final bool providerReady;
  final bool connecting;
  final DateTime now;
  final VoidCallback onSync;
  final VoidCallback onConnect;
  final VoidCallback onPeople;

  /// true: remove the mailbox; false: disconnect it.
  final ValueChanged<bool> onDisconnect;
  final VoidCallback onCampaigns;

  @override
  State<MailboxCard> createState() => _MailboxCardState();
}

class _MailboxCardState extends State<MailboxCard> {
  Routing? _routing;
  (int, int)? _quota;
  bool _showNote = false;

  @override
  void initState() {
    super.initState();
    _health();
  }

  @override
  void didUpdateWidget(MailboxCard old) {
    super.didUpdateWidget(old);
    if (old.mailbox.status != widget.mailbox.status) _health();
  }

  /// Two separate questions, neither implied by "Connected": does outside mail reach
  /// this mailbox (its domain's MX records), and how full is it (Hostinger only).
  void _health() {
    final m = widget.mailbox;
    if (!m.connected || m.role.isEmpty) return;
    unawaited(
      widget.api
          .routing(m.id)
          .then<void>(
            (r) {
              if (mounted) setState(() => _routing = r);
            },
            onError: (Object _) {
              if (mounted) setState(() => _routing = Routing.unknown());
            },
          ),
    );
    if (m.raw['capabilities'] is Map && (m.raw['capabilities'] as Map)['quota'] == true) {
      unawaited(
        widget.api.quota(m.id).then<void>((q) {
          if (mounted) setState(() => _quota = q);
        }, onError: (Object _) {}),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final m = widget.mailbox;
    final configurable = m.configurable;
    final hostinger = m.provider == 'hostinger';
    final routing = _routing;
    final quota = _quota;
    final sub = [
      m.email,
      if (m.connected) 'synced ${syncedAgo(m.lastSyncedAt, widget.now)}',
      if (widget.shared && m.memberCount != null) '${m.memberCount} ${m.memberCount == 1 ? 'person' : 'people'}',
    ].join(' · ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(m.name, style: const TextStyle(fontWeight: FontWeight.w600)),
        Text(sub, style: muted),
        const SizedBox(height: Gap.xs),
        Wrap(
          spacing: Gap.xs,
          runSpacing: Gap.xs,
          children: [
            if (providerLabels[m.provider] != null) Pill(label: providerLabels[m.provider]!),
            Pill(label: mailboxStatus[m.status] ?? m.status, tone: mailboxTone(m.status)),
            if (widget.shared && m.role.isNotEmpty) Pill(label: 'You: ${roleLabels[m.role] ?? m.role}'),
          ],
        ),
        if (m.syncError.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: Gap.xs),
            child: Text(m.syncError, style: TextStyle(color: theme.colorScheme.error)),
          ),
        if (m.connected && m.role.isNotEmpty) ...[
          const SizedBox(height: Gap.s),
          if (routing == null)
            Text('Checking how mail reaches it…', style: muted)
          else
            InkWell(
              onTap: () => setState(() => _showNote = !_showNote),
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: Gap.xs),
                child: Row(
                  children: [
                    Icon(
                      switch (routing.inbound) {
                        'direct' => Icons.check_circle_outline,
                        'none' => Icons.error_outline,
                        'elsewhere' => Icons.call_split,
                        _ => Icons.help_outline,
                      },
                      size: 18,
                      color: switch (routing.inbound) {
                        'direct' => const Color(0xFF1E6B3A),
                        'none' => theme.colorScheme.error,
                        _ => theme.colorScheme.onSurfaceVariant,
                      },
                    ),
                    const SizedBox(width: Gap.s),
                    Expanded(child: Text(routing.label)),
                    Icon(_showNote ? Icons.expand_less : Icons.expand_more, size: 20),
                  ],
                ),
              ),
            ),
          if (routing != null && _showNote)
            Text('${routing.note}${routing.mx.isEmpty ? '' : ' Current MX: ${routing.mx.join(', ')}.'}', style: muted),
          if (quota != null && quota.$2 > 0)
            Text('Storage ${formatSize(quota.$1)} of ${formatSize(quota.$2)} (${(quota.$1 * 100 / quota.$2).round()}%)', style: muted),
        ],
        if (configurable && m.connected)
          Padding(
            padding: const EdgeInsets.only(top: Gap.xs),
            child: Row(
              children: [
                Expanded(child: Text(m.campaignSender ? 'Campaigns: up to ${m.campaignDailyCap} a day' : 'Campaigns: not allowed')),
                TextButton(onPressed: widget.onCampaigns, child: const Text('Change')),
              ],
            ),
          ),
        const SizedBox(height: Gap.s),
        Wrap(
          spacing: Gap.s,
          runSpacing: Gap.s,
          children: [
            if (configurable && !m.connected)
              FilledButton(
                onPressed: !widget.providerReady || widget.connecting ? null : widget.onConnect,
                child: Text(
                  widget.connecting
                      ? (hostinger ? 'Connecting…' : 'Opening Google…')
                      : m.status == 'pending'
                      ? 'Connect'
                      : 'Reconnect',
                ),
              ),
            if (m.connected && m.role.isNotEmpty)
              OutlinedButton.icon(onPressed: widget.onSync, icon: const Icon(Icons.sync, size: 18), label: const Text('Sync now')),
            OutlinedButton.icon(onPressed: widget.onPeople, icon: const Icon(Icons.group_outlined, size: 18), label: const Text('People')),
            if (configurable)
              OutlinedButton(
                style: OutlinedButton.styleFrom(foregroundColor: theme.colorScheme.error),
                onPressed: () => widget.onDisconnect(!m.connected),
                child: Text(m.connected ? 'Disconnect' : 'Remove'),
              ),
          ],
        ),
        if (configurable && !m.connected && !widget.providerReady)
          Padding(
            padding: const EdgeInsets.only(top: Gap.xs),
            child: Text('${providerLabels[m.provider] ?? 'This provider'} is not set up on the server.', style: muted),
          ),
      ],
    );
  }
}

/// Allow or stop campaigns from a mailbox, with its own daily limit.
class CampaignSenderForm extends StatefulWidget {
  const CampaignSenderForm({super.key, required this.mailbox, required this.onSave});

  final Mailbox mailbox;

  /// Saves; throws the server's refusal, which the form shows.
  final Future<void> Function(bool enabled, int? cap) onSave;

  @override
  State<CampaignSenderForm> createState() => _CampaignSenderFormState();
}

class _CampaignSenderFormState extends State<CampaignSenderForm> {
  late bool _enabled = widget.mailbox.campaignSender;
  late final _cap = TextEditingController(text: '${widget.mailbox.campaignDailyCap ?? 50}');
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _cap.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final cap = int.tryParse(_cap.text.trim());
    if (_enabled && (cap == null || cap < 1 || cap > 2000)) {
      setState(() => _error = 'Set a daily limit between 1 and 2000.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onSave(_enabled, _enabled ? cap : null);
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
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.l),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, child: Text('Campaigns from this mailbox', style: theme.textTheme.titleLarge)),
          Text(widget.mailbox.email, style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: Gap.m),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Allow approved campaigns from this mailbox'),
            value: _enabled,
            onChanged: _busy ? null : (on) => setState(() => _enabled = on),
          ),
          if (_enabled)
            TextField(
              controller: _cap,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
              decoration: const InputDecoration(labelText: 'Most per day (1 to 2000)'),
            ),
          const SizedBox(height: Gap.s),
          Text(
            "Ordinary mailboxes are not bulk senders. Start low (for example 50 a day) and stay well under the provider's own limits: a mailbox that is limited or flagged for spam also stops working for everyday mail.",
            style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
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
            spacing: Gap.s,
            children: [
              TextButton(onPressed: _busy ? null : () => Navigator.of(context).maybePop(), child: const Text('Cancel')),
              FilledButton(onPressed: _busy ? null : () => unawaited(_save()), child: Text(_busy ? 'Saving…' : 'Save')),
            ],
          ),
        ],
      ),
    );
  }
}

/// A shared mailbox: at Google (connected afterwards, in the browser) or at Hostinger
/// (chosen from the addresses Dikho's token covers, and connected at once).
class AddSharedForm extends StatefulWidget {
  const AddSharedForm({
    super.key,
    required this.gmailReady,
    required this.hostingerReady,
    required this.existing,
    required this.loadHostinger,
    required this.onAdd,
  });

  final bool gmailReady;
  final bool hostingerReady;
  final Set<String> existing;
  final Future<List<String>> Function() loadHostinger;

  /// Adds; throws the server's refusal, which the form shows.
  final Future<void> Function(String email, String name, String provider) onAdd;

  @override
  State<AddSharedForm> createState() => _AddSharedFormState();
}

class _AddSharedFormState extends State<AddSharedForm> {
  late String _provider = widget.gmailReady || !widget.hostingerReady ? 'google' : 'hostinger';
  final _email = TextEditingController();
  final _name = TextEditingController();
  String? _hostingerChoice;
  List<String>? _hostinger;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    if (_provider == 'hostinger') _loadHostinger();
  }

  @override
  void dispose() {
    _email.dispose();
    _name.dispose();
    super.dispose();
  }

  void _loadHostinger() {
    if (_hostinger != null || !widget.hostingerReady) return;
    unawaited(
      widget.loadHostinger().then<void>(
        (list) {
          if (mounted) setState(() => _hostinger = list);
        },
        onError: (Object failure) {
          if (mounted) {
            setState(() {
              _hostinger = const [];
              _error = failure is ApiException ? failure.message : 'Could not load the Hostinger mailboxes.';
            });
          }
        },
      ),
    );
  }

  String get _address => _provider == 'hostinger' ? (_hostingerChoice ?? '') : _email.text.trim();

  Future<void> _add() async {
    if (_address.isEmpty) {
      setState(() => _error = _provider == 'hostinger' ? 'Choose a Hostinger mailbox.' : "Enter the shared mailbox's address.");
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onAdd(_address, _name.text.trim(), _provider);
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
    final available = (_hostinger ?? const <String>[]).where((a) => !widget.existing.contains(a)).toList();
    final ready = _provider == 'hostinger' ? widget.hostingerReady : widget.gmailReady;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.l),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, child: Text('Add a shared mailbox', style: theme.textTheme.titleLarge)),
          const SizedBox(height: Gap.s),
          Text('Where is this mailbox hosted?', style: theme.textTheme.labelLarge),
          RadioGroup<String>(
            groupValue: _provider,
            onChanged: (value) {
              if (_busy || value == null) return;
              setState(() {
                _provider = value;
                _error = null;
              });
              if (value == 'hostinger') _loadHostinger();
            },
            child: Column(
              children: [
                RadioListTile<String>(
                  contentPadding: EdgeInsets.zero,
                  value: 'google',
                  title: const Text('Google Workspace'),
                  subtitle: Text(widget.gmailReady ? 'Connect securely with Google after adding it.' : 'Not set up on the server yet.'),
                ),
                RadioListTile<String>(
                  contentPadding: EdgeInsets.zero,
                  value: 'hostinger',
                  title: const Text('Hostinger Email'),
                  subtitle: Text(widget.hostingerReady ? 'Connected through the Hostinger Mail API token.' : 'Not set up on the server yet.'),
                ),
              ],
            ),
          ),
          const SizedBox(height: Gap.s),
          if (_provider == 'hostinger')
            DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: _hostingerChoice,
              decoration: const InputDecoration(labelText: 'Address'),
              hint: Text(
                _hostinger == null
                    ? 'Loading…'
                    : available.isEmpty
                    ? 'No other mailboxes in the token'
                    : 'Choose a Hostinger mailbox',
              ),
              items: [for (final a in available) DropdownMenuItem(value: a, child: Text(a))],
              onChanged: _busy || !widget.hostingerReady ? null : (value) => setState(() => _hostingerChoice = value),
            )
          else
            TextField(
              controller: _email,
              enabled: !_busy,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              enableSuggestions: false,
              maxLength: 254,
              decoration: const InputDecoration(labelText: 'Address', counterText: ''),
            ),
          const SizedBox(height: Gap.m),
          TextField(
            controller: _name,
            enabled: !_busy,
            maxLength: 120,
            decoration: const InputDecoration(labelText: 'Name shown in Dikho (optional)', counterText: ''),
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
            spacing: Gap.s,
            children: [
              TextButton(onPressed: _busy ? null : () => Navigator.of(context).maybePop(), child: const Text('Cancel')),
              FilledButton(
                onPressed: _busy || !ready ? null : () => unawaited(_add()),
                child: Text(
                  _busy
                      ? 'Adding…'
                      : _provider == 'hostinger'
                      ? 'Add and connect'
                      : 'Add mailbox',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Who may use a mailbox, and in which role. Only its owner or administrators change
/// it; nobody can give themselves access.
class MailboxPeopleScreen extends StatefulWidget {
  const MailboxPeopleScreen({super.key, required this.api, required this.mailbox, required this.me});

  final EmailApi api;
  final Mailbox mailbox;
  final String me;

  @override
  State<MailboxPeopleScreen> createState() => _MailboxPeopleScreenState();
}

class _MailboxPeopleScreenState extends State<MailboxPeopleScreen> {
  Members? _members;
  List<DirectoryPerson> _directory = const [];
  String? _error;
  bool _busy = false;
  String? _adding;
  String _role = 'responder';

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    unawaited(
      widget.api.directory().then<void>((list) {
        if (mounted) setState(() => _directory = list);
      }, onError: (Object _) {}),
    );
  }

  Future<void> _load() async {
    try {
      final members = await widget.api.members(widget.mailbox.id);
      if (mounted) setState(() => _members = members);
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  Future<void> _change(Future<Members> Function() run, {bool leaving = false}) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final next = await run();
      if (!mounted) return;
      if (leaving) {
        Navigator.of(context).pop();
        return;
      }
      setState(() => _members = next);
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _leave() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('Leave this mailbox?'),
        content: Text('You stop seeing ${widget.mailbox.email} in Dikho. Someone who sets it up can add you again.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialog).pop(true), child: const Text('Leave')),
        ],
      ),
    );
    if (ok == true) await _change(() => widget.api.removeMember(widget.mailbox.id, widget.me), leaving: true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final members = _members;
    final roles = rolesFor(widget.mailbox);
    final ids = {for (final p in members?.people ?? const <Member>[]) p.userId};
    final candidates = _directory.where((p) => !ids.contains(p.userId) && p.userId != widget.me).toList();
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('People with access'),
            Text(widget.mailbox.email, style: muted),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl * 2),
        children: [
          if (_busy) const LinearProgressIndicator(),
          if (_error != null) Notice(tone: NoticeTone.danger, text: _error!),
          if (members == null && _error == null)
            const Padding(
              padding: EdgeInsets.all(Gap.xl),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (members != null) ...[
            if (members.people.isEmpty) Text('Nobody can read this mailbox yet.', style: muted),
            for (final p in members.people) _person(context, p, members, roles, muted),
            const SizedBox(height: Gap.l),
            if (members.canConfigure) ...[
              Semantics(header: true, child: Text('Add a person', style: theme.textTheme.titleSmall)),
              const SizedBox(height: Gap.s),
              DropdownButtonFormField<String>(
                key: ValueKey('add-${members.people.length}'),
                isExpanded: true,
                initialValue: _adding,
                decoration: const InputDecoration(labelText: 'Person'),
                hint: Text(candidates.isEmpty ? 'Everyone already has access' : 'Choose'),
                items: [
                  for (final p in candidates)
                    DropdownMenuItem(value: p.userId, child: Text(p.hasInbox ? p.name : '${p.name} (needs Email permission)')),
                ],
                onChanged: _busy ? null : (value) => setState(() => _adding = value),
              ),
              const SizedBox(height: Gap.m),
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: _role,
                decoration: const InputDecoration(labelText: 'Role'),
                items: [for (final r in roles) DropdownMenuItem(value: r, child: Text(roleLabels[r] ?? r))],
                onChanged: _busy ? null : (value) => setState(() => _role = value ?? _role),
              ),
              const SizedBox(height: Gap.s),
              Text(roleHelp[_role] ?? '', style: muted),
              const SizedBox(height: Gap.m),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                  onPressed: _busy || _adding == null
                      ? null
                      : () {
                          final user = _adding!;
                          unawaited(
                            _change(() async {
                              final next = await widget.api.setMember(widget.mailbox.id, user, _role);
                              if (mounted) setState(() => _adding = null);
                              return next;
                            }),
                          );
                        },
                  child: const Text('Add'),
                ),
              ),
            ] else
              Text("Only the mailbox's owner or its administrators can change who has access.", style: muted),
            const SizedBox(height: Gap.m),
            Text('Every change is recorded in the audit log. Nobody can give themselves access.', style: muted),
          ],
        ],
      ),
    );
  }

  Widget _person(BuildContext context, Member p, Members members, List<String> roles, TextStyle muted) {
    final me = p.userId == widget.me;
    final editable = members.canConfigure && !p.owner && !me;
    final about = p.owner ? 'Owner of this mailbox' : '${roleHelp[p.role] ?? ''}${p.grantedBy.isEmpty ? '' : ' Added by ${p.grantedBy}.'}';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Gap.s),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('${p.name}${me ? ' (you)' : ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
              if (!p.active) const Pill(label: 'Inactive', tone: PillTone.pending),
            ],
          ),
          Text(about, style: muted),
          const SizedBox(height: Gap.xs),
          if (editable)
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    key: ValueKey('role-${p.userId}-${p.role}'),
                    isExpanded: true,
                    initialValue: roles.contains(p.role) ? p.role : null,
                    decoration: InputDecoration(labelText: 'Role for ${p.name}', isDense: true),
                    items: [for (final r in roles) DropdownMenuItem(value: r, child: Text(roleLabels[r] ?? r))],
                    onChanged: _busy
                        ? null
                        : (value) {
                            if (value != null && value != p.role) {
                              unawaited(_change(() => widget.api.setMember(widget.mailbox.id, p.userId, value)));
                            }
                          },
                  ),
                ),
                IconButton(
                  tooltip: 'Remove ${p.name}',
                  onPressed: _busy ? null : () => unawaited(_change(() => widget.api.removeMember(widget.mailbox.id, p.userId))),
                  icon: const Icon(Icons.person_remove_outlined),
                ),
              ],
            )
          else
            Wrap(
              spacing: Gap.s,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Pill(label: p.owner ? 'Owner' : roleLabels[p.role] ?? p.role),
                if (me && !p.owner)
                  TextButton(
                    style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
                    onPressed: _busy ? null : () => unawaited(_leave()),
                    child: const Text('Leave'),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}
