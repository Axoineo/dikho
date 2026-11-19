import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import 'email_api.dart';
import 'email_models.dart';
import 'message_body.dart';

/// What a reply, reply-all or forward starts from.
class ComposeRequest {
  const ComposeRequest({required this.mode, required this.accountId, this.thread, this.source});

  /// new, reply, reply_all or forward.
  final String mode;
  final String accountId;
  final ThreadDetail? thread;
  final EmailMessage? source;
}

/// One conversation, as Conversation.jsx shows it: message content fetched live each
/// time it is opened (the API keeps none of it). Mailbox state (read, archive, star,
/// labels) changes the mailbox; Dikho's own state (status, assignee, notes, CRM links)
/// never touches it.
class EmailConversationScreen extends StatefulWidget {
  const EmailConversationScreen({
    super.key,
    required this.api,
    required this.threadId,
    required this.me,
    required this.onPatch,
    required this.onRemoved,
    required this.onCompose,
    required this.onDownload,
    required this.onOpenLink,
    this.now,
  });

  final EmailApi api;
  final String threadId;
  final String me;

  /// Keeps the list in step with what happened here.
  final void Function(String id, Map<String, dynamic> changes) onPatch;
  final void Function(String id) onRemoved;
  final Future<void> Function(ComposeRequest request) onCompose;
  final Future<void> Function(String threadId, EmailMessage message, EmailAttachment attachment) onDownload;
  final Future<void> Function(Uri link) onOpenLink;
  final DateTime Function()? now;

  @override
  State<EmailConversationScreen> createState() => _EmailConversationScreenState();
}

class _EmailConversationScreenState extends State<EmailConversationScreen> {
  ThreadDetail? _d;
  String? _error;
  bool _busy = false;
  final _expanded = <String>{};
  final _note = TextEditingController();
  List<(String, String)> _labels = const [];

  EmailApi get _api => widget.api;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  void _say(String text) {
    if (mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final d = await _api.thread(widget.threadId);
      if (!mounted) return;
      setState(() {
        _d = d;
        if (_expanded.isEmpty) {
          final last = d.messages.isEmpty ? null : d.messages.last;
          _expanded.addAll([
            for (final m in d.messages)
              if (m.unread || m.draft || identical(m, last)) m.id,
          ]);
        }
      });
      // Opening marks it read, as the mailbox itself does, for people who may change it.
      if (d.thread.unread && d.canAct && d.account.can('mark_read')) {
        unawaited(_changeLabels(remove: const ['UNREAD'], quiet: true));
      }
      if (d.account.can('labels') && _labels.isEmpty) {
        try {
          final labels = await _api.labels(d.account.id);
          if (mounted) setState(() => _labels = labels);
        } on ApiException {
          // Filing by label is just not offered.
        }
      }
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  Future<bool> _changeLabels({List<String> add = const [], List<String> remove = const [], bool quiet = false}) async {
    final d = _d;
    if (d == null) return false;
    if (!quiet) setState(() => _busy = true);
    try {
      final r = await _api.labelThread(widget.threadId, add: add, remove: remove);
      final changes = {'label_ids': r['label_ids'], 'unread': r['unread'], 'starred': r['starred']};
      if (mounted) setState(() => d.thread = d.thread.patched(changes));
      widget.onPatch(widget.threadId, changes);
      return true;
    } on ApiException catch (failure) {
      if (!quiet) _say(failure.message);
      return false;
    } finally {
      if (mounted && !quiet) setState(() => _busy = false);
    }
  }

  Future<void> _workflow(Map<String, Object?> patch) async {
    final d = _d;
    if (d == null) return;
    try {
      final t = await _api.updateThread(widget.threadId, patch);
      if (mounted) setState(() => d.thread = d.thread.patched(t));
      widget.onPatch(widget.threadId, t);
    } on ApiException catch (failure) {
      _say(failure.message);
    }
  }

  Future<void> _archive() async {
    if (await _changeLabels(remove: const ['INBOX'])) {
      _say('Archived.');
      widget.onRemoved(widget.threadId);
      if (mounted) Navigator.of(context).pop();
    }
  }

  Future<void> _markUnread() async {
    if (await _changeLabels(add: const ['UNREAD']) && mounted) Navigator.of(context).pop();
  }

  Future<void> _addNote() async {
    final text = _note.text.trim();
    final d = _d;
    if (text.isEmpty || d == null) return;
    setState(() => _busy = true);
    try {
      final note = await _api.addNote(widget.threadId, text);
      _note.clear();
      if (mounted) setState(() => d.notes = [...d.notes, note]);
      widget.onPatch(widget.threadId, {'note_count': d.notes.length});
    } on ApiException catch (failure) {
      _say(failure.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _reply(String mode, [EmailMessage? source]) {
    final d = _d;
    final from = source ?? d?.lastMessage;
    if (d == null || from == null) return;
    unawaited(widget.onCompose(ComposeRequest(mode: mode, accountId: d.account.id, thread: d, source: from)));
  }

  Future<void> _fileByLabel() async {
    final d = _d;
    if (d == null) return;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => StatefulBuilder(
        builder: (sheet, setSheet) {
          final on = d.labelIds;
          return SafeArea(
            child: ListView(
              shrinkWrap: true,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.s),
                  child: Text('Labels', style: Theme.of(sheet).textTheme.titleMedium),
                ),
                for (final (id, name) in _labels)
                  CheckboxListTile(
                    value: on.contains(id),
                    title: Text(name),
                    onChanged: _busy
                        ? null
                        : (value) async {
                            await _changeLabels(add: value == true ? [id] : const [], remove: value == true ? const [] : [id]);
                            setSheet(() {});
                          },
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _openCrm() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => FractionallySizedBox(
        heightFactor: 0.8,
        child: _CrmPanel(
          api: _api,
          threadId: widget.threadId,
          canLink: _d?.canAct ?? false,
          onLinked: (n) => widget.onPatch(widget.threadId, {'link_count': n}),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final d = _d;
    if (_error != null || d == null) {
      return Scaffold(
        appBar: AppBar(),
        body: _error == null
            ? const Center(child: CircularProgressIndicator())
            : EmptyMessage(title: "Couldn't open this conversation", body: _error!, action: 'Try again', onAction: () => unawaited(_load())),
      );
    }
    final t = d.thread;
    final labels = d.labelIds;
    final can = d.account.can;
    final now = (widget.now ?? DateTime.now)();
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final userLabels = [
      for (final (id, name) in _labels)
        if (labels.contains(id)) name,
    ];
    final assignable = d.canAssign ? d.assignable : d.assignable.where((p) => p.$1 == widget.me || p.$1 == t.assignedTo).toList();
    return Scaffold(
      appBar: AppBar(
        actions: [
          if (d.canAct && can('archive'))
            labels.contains('INBOX')
                ? IconButton(tooltip: 'Archive', onPressed: _busy ? null : () => unawaited(_archive()), icon: const Icon(Icons.archive_outlined))
                : IconButton(
                    tooltip: 'Move to inbox',
                    onPressed: _busy ? null : () => unawaited(_changeLabels(add: const ['INBOX'])),
                    icon: const Icon(Icons.move_to_inbox_outlined),
                  ),
          if (d.canAct && can('star'))
            IconButton(
              tooltip: t.starred ? 'Unstar' : 'Star',
              isSelected: t.starred,
              onPressed: _busy ? null : () => unawaited(t.starred ? _changeLabels(remove: const ['STARRED']) : _changeLabels(add: const ['STARRED'])),
              icon: Icon(t.starred ? Icons.star : Icons.star_border, color: t.starred ? Colors.amber.shade700 : null),
            ),
          PopupMenuButton<String>(
            tooltip: 'More',
            onSelected: (which) {
              switch (which) {
                case 'unread':
                  unawaited(_markUnread());
                case 'labels':
                  unawaited(_fileByLabel());
                case 'crm':
                  unawaited(_openCrm());
                case 'refresh':
                  unawaited(_load());
              }
            },
            itemBuilder: (_) => [
              if (d.canAct && can('mark_read')) const PopupMenuItem(value: 'unread', child: Text('Mark as unread')),
              if (d.canAct && _labels.isNotEmpty) const PopupMenuItem(value: 'labels', child: Text('Labels')),
              const PopupMenuItem(value: 'crm', child: Text('CRM records')),
              const PopupMenuItem(value: 'refresh', child: Text('Refresh')),
            ],
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.xl),
          children: [
            Semantics(header: true, child: Text(t.subject, style: theme.textTheme.titleLarge)),
            const SizedBox(height: Gap.s),
            Wrap(
              spacing: Gap.s,
              runSpacing: Gap.xs,
              children: [
                Pill(label: d.account.name),
                if (providerLabels[d.account.provider] != null) Pill(label: providerLabels[d.account.provider]!),
                for (final name in userLabels) Pill(label: name, tone: PillTone.pending),
              ],
            ),
            const SizedBox(height: Gap.m),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    key: ValueKey('status-${t.workflow}'),
                    initialValue: t.workflow,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Status'),
                    items: [for (final (key, label) in workflowStates) DropdownMenuItem(value: key, child: Text(label))],
                    onChanged: d.canAct ? (value) => value == null ? null : unawaited(_workflow({'workflow_status': value})) : null,
                  ),
                ),
                const SizedBox(width: Gap.m),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    key: ValueKey('assignee-${t.assignedTo}'),
                    initialValue: t.assignedTo,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Assigned to'),
                    items: [
                      const DropdownMenuItem(value: '', child: Text('Unassigned')),
                      for (final (id, name) in assignable)
                        DropdownMenuItem(
                          value: id,
                          child: Text(id == widget.me ? '$name (you)' : name, overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    onChanged: d.canAct && (d.canAssign || t.assignedTo.isEmpty || t.assignedTo == widget.me)
                        ? (value) => unawaited(_workflow({'assigned_to': (value ?? '').isEmpty ? null : value}))
                        : null,
                  ),
                ),
              ],
            ),
            const SizedBox(height: Gap.m),
            if (!d.canAct)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: Text('You can read this mailbox. Replying and filing need responder access.', style: muted),
              ),
            if (d.omitted > 0)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: Text(
                  '${d.omitted} earlier message${d.omitted == 1 ? ' is' : 's are'} not shown here. Open the mailbox in Hostinger Webmail for the full history.',
                  style: muted,
                ),
              ),
            if (d.messages.isEmpty) Text('This conversation is empty in the mailbox.', style: muted),
            for (final m in d.messages)
              _MessageCard(
                message: m,
                open: _expanded.contains(m.id),
                now: now,
                // The newest message's actions are the row under the conversation.
                canReply: d.canAct && can('reply') && !identical(m, d.lastMessage),
                canForward: d.canAct && can('forward') && !identical(m, d.lastMessage),
                onToggle: () => setState(() => _expanded.contains(m.id) ? _expanded.remove(m.id) : _expanded.add(m.id)),
                onReply: (mode) => _reply(mode, m),
                onDownload: (a) => widget.onDownload(widget.threadId, m, a),
                onOpenLink: widget.onOpenLink,
              ),
            if (d.canAct && d.lastMessage != null)
              Wrap(
                spacing: Gap.s,
                runSpacing: Gap.s,
                children: [
                  if (can('reply'))
                    FilledButton.tonalIcon(onPressed: () => _reply('reply'), icon: const Icon(Icons.reply), label: const Text('Reply')),
                  if (can('reply'))
                    OutlinedButton.icon(onPressed: () => _reply('reply_all'), icon: const Icon(Icons.reply_all), label: const Text('Reply all')),
                  if (can('forward'))
                    OutlinedButton.icon(onPressed: () => _reply('forward'), icon: const Icon(Icons.forward), label: const Text('Forward')),
                ],
              ),
            const SizedBox(height: Gap.xl),
            if (d.notes.isNotEmpty || d.canAct) ...[
              Semantics(header: true, child: Text('Internal notes · only your team sees these', style: theme.textTheme.titleSmall)),
              const SizedBox(height: Gap.s),
              for (final n in d.notes)
                Card.outlined(
                  margin: const EdgeInsets.only(bottom: Gap.s),
                  child: Padding(
                    padding: const EdgeInsets.all(Gap.m),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${n.author} · ${fullTime(n.createdAt)}', style: muted),
                        const SizedBox(height: Gap.xs),
                        SelectableText(n.body),
                      ],
                    ),
                  ),
                ),
              if (d.canAct)
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _note,
                        minLines: 1,
                        maxLines: 4,
                        textCapitalization: TextCapitalization.sentences,
                        inputFormatters: [LengthLimitingTextInputFormatter(4000)],
                        decoration: const InputDecoration(labelText: 'Add a note for your team'),
                      ),
                    ),
                    IconButton(tooltip: 'Add note', onPressed: _busy ? null : () => unawaited(_addNote()), icon: const Icon(Icons.send)),
                  ],
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MessageCard extends StatefulWidget {
  const _MessageCard({
    required this.message,
    required this.open,
    required this.now,
    required this.canReply,
    required this.canForward,
    required this.onToggle,
    required this.onReply,
    required this.onDownload,
    required this.onOpenLink,
  });

  final EmailMessage message;
  final bool open;
  final DateTime now;
  final bool canReply;
  final bool canForward;
  final VoidCallback onToggle;
  final ValueChanged<String> onReply;
  final Future<void> Function(EmailAttachment attachment) onDownload;
  final Future<void> Function(Uri link) onOpenLink;

  @override
  State<_MessageCard> createState() => _MessageCardState();
}

class _MessageCardState extends State<_MessageCard> {
  String? _downloading;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final m = widget.message;
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final attachments = m.attachments;
    final head = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Initials(text: m.from.initials, size: 36),
        const SizedBox(width: Gap.m),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: Text(
                      m.from.display,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (m.draft) ...[const SizedBox(width: Gap.s), const Pill(label: 'Draft', tone: PillTone.pending)],
                ],
              ),
              if (!widget.open)
                Text(
                  m.snippet.isNotEmpty
                      ? m.snippet
                      : (attachments.isEmpty ? '' : '${attachments.length} attachment${attachments.length == 1 ? '' : 's'}'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: muted,
                )
              else ...[
                if (m.from.name.isNotEmpty) Text(m.from.email, style: muted),
                Text(fullTime(m.date), style: muted),
                Text(
                  'to ${m.to.isEmpty ? '(no recipients)' : addressList(m.to)}${m.cc.isEmpty ? '' : ', cc ${addressList(m.cc)}'}${m.bcc.isEmpty ? '' : ', bcc ${addressList(m.bcc)}'}',
                  style: muted,
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: Gap.s),
        Text(listTime(m.date, widget.now), style: muted),
      ],
    );
    return Card.outlined(
      margin: const EdgeInsets.only(bottom: Gap.m),
      child: Padding(
        padding: const EdgeInsets.all(Gap.m),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              button: true,
              expanded: widget.open,
              label: 'Message from ${m.from.display}',
              child: InkWell(onTap: widget.onToggle, child: head),
            ),
            if (widget.open) ...[
              const SizedBox(height: Gap.m),
              if (m.blockedImages > 0)
                Padding(
                  padding: const EdgeInsets.only(bottom: Gap.s),
                  child: Text(
                    '${m.blockedImages} remote image${m.blockedImages == 1 ? ' is' : 's are'} hidden so the sender cannot see when you read this.',
                    style: muted,
                  ),
                ),
              MessageBody(html: m.html, text: m.text, onOpenLink: widget.onOpenLink),
              if (attachments.isNotEmpty) ...[
                const SizedBox(height: Gap.m),
                Wrap(
                  spacing: Gap.s,
                  runSpacing: Gap.s,
                  children: [
                    for (final a in attachments)
                      ActionChip(
                        avatar: _downloading == a.id
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.attach_file, size: 18),
                        label: Text('${a.filename}${a.size > 0 ? ' · ${formatSize(a.size)}' : ''}', overflow: TextOverflow.ellipsis),
                        tooltip: 'Download ${a.filename}',
                        onPressed: _downloading != null
                            ? null
                            : () async {
                                setState(() => _downloading = a.id);
                                try {
                                  await widget.onDownload(a);
                                } finally {
                                  if (mounted) setState(() => _downloading = null);
                                }
                              },
                      ),
                  ],
                ),
              ],
              if ((widget.canReply || widget.canForward) && !m.draft)
                Padding(
                  padding: const EdgeInsets.only(top: Gap.s),
                  child: Wrap(
                    children: [
                      if (widget.canReply)
                        TextButton.icon(onPressed: () => widget.onReply('reply'), icon: const Icon(Icons.reply), label: const Text('Reply')),
                      if (widget.canReply)
                        TextButton.icon(
                          onPressed: () => widget.onReply('reply_all'),
                          icon: const Icon(Icons.reply_all),
                          label: const Text('Reply all'),
                        ),
                      if (widget.canForward)
                        TextButton.icon(onPressed: () => widget.onReply('forward'), icon: const Icon(Icons.forward), label: const Text('Forward')),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Records whose address appears in the conversation, and records linked to it.
class _CrmPanel extends StatefulWidget {
  const _CrmPanel({required this.api, required this.threadId, required this.canLink, required this.onLinked});

  final EmailApi api;
  final String threadId;
  final bool canLink;
  final ValueChanged<int> onLinked;

  @override
  State<_CrmPanel> createState() => _CrmPanelState();
}

class _CrmPanelState extends State<_CrmPanel> {
  List<CrmRecord>? _records;
  Map<String, bool> _canView = const {};
  String? _error;
  String? _busy;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final (records, view) = await widget.api.crm(widget.threadId);
      if (mounted) {
        setState(() {
          _records = records;
          _canView = view;
        });
      }
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    }
  }

  Future<void> _toggle(CrmRecord r) async {
    setState(() => _busy = '${r.type}:${r.id}');
    try {
      final (records, view) = await widget.api.link(widget.threadId, r, linked: !r.linked);
      if (!mounted) return;
      setState(() {
        _records = records;
        _canView = view;
      });
      widget.onLinked(records.where((x) => x.linked).length);
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final records = _records;
    final visible = [
      for (final e in _canView.entries)
        if (e.value) const {'client': 'clients', 'vendor': 'vendors', 'lead': 'leads'}[e.key] ?? e.key,
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.xl),
      children: [
        Text('CRM records', style: theme.textTheme.titleMedium),
        const SizedBox(height: Gap.xs),
        Text(
          'Records whose email address appears in this conversation, and records linked to it.',
          style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: Gap.m),
        if (_error != null) Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
        if (records == null && _error == null) const Center(child: CircularProgressIndicator()),
        if (records != null && visible.isEmpty) const Text('You do not have permission to view clients, vendors or leads.'),
        if (records != null && visible.isNotEmpty && records.isEmpty) Text('No ${visible.join(', ')} use these email addresses.'),
        for (final r in records ?? const <CrmRecord>[])
          Card.outlined(
            margin: const EdgeInsets.only(bottom: Gap.s),
            child: Padding(
              padding: const EdgeInsets.all(Gap.m),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${r.typeLabel}${r.linked ? ' · linked' : ''}', style: TextStyle(fontSize: 12, color: theme.colorScheme.primary)),
                  Text(r.name.isEmpty ? '(unnamed)' : r.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                  if (r.contact.isNotEmpty && r.contact != r.name) Text(r.contact),
                  if (r.email.isNotEmpty) Text(r.email),
                  if (r.place.isNotEmpty) Text(r.place),
                  if (widget.canLink)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: r.linked
                          ? OutlinedButton.icon(
                              onPressed: _busy == '${r.type}:${r.id}' ? null : () => unawaited(_toggle(r)),
                              icon: const Icon(Icons.link_off),
                              label: const Text('Unlink'),
                            )
                          : FilledButton.tonalIcon(
                              onPressed: _busy == '${r.type}:${r.id}' ? null : () => unawaited(_toggle(r)),
                              icon: const Icon(Icons.link),
                              label: const Text('Link to conversation'),
                            ),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
