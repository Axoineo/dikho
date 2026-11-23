import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import 'email_controller.dart';
import 'email_models.dart';

/// The email inbox, redesigned for a phone from EmailInbox.jsx: the web's side rail of
/// folders and mailboxes becomes two pickers above the list, a conversation opens on
/// its own screen, and the list loads more as it scrolls.
class EmailInboxScreen extends StatefulWidget {
  const EmailInboxScreen({
    super.key,
    required this.controller,
    required this.onOpenDrawer,
    required this.onOpenThread,
    required this.onCompose,
    required this.me,
  });

  final EmailInboxController controller;
  final VoidCallback onOpenDrawer;

  /// Opens a conversation over this screen ([context] is this screen's).
  final Future<void> Function(BuildContext context, ThreadSummary thread) onOpenThread;

  /// A new message; null hides Compose.
  final void Function(BuildContext context)? onCompose;
  final String me;

  @override
  State<EmailInboxScreen> createState() => _EmailInboxScreenState();
}

class _EmailInboxScreenState extends State<EmailInboxScreen> {
  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _typing;
  late final AppLifecycleListener _lifecycle;

  EmailInboxController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    _search.text = _c.search;
    _c.watch();
    // Nothing refreshes behind another app; coming back catches up at once.
    _lifecycle = AppLifecycleListener(onHide: _c.unwatch, onShow: _catchUp);
    if (_c.mailboxes == null) unawaited(_c.start());
    _scroll.addListener(() {
      if (nearListEnd(_scroll.position) && _c.hasMore && !_c.loading) unawaited(_c.load(more: true));
    });
  }

  void _catchUp() {
    _c.watch();
    if (_c.providerResults) return;
    unawaited(_c.load(quiet: true));
    unawaited(_c.loadMailboxes());
  }

  @override
  void dispose() {
    _typing?.cancel();
    _lifecycle.dispose();
    _c.unwatch();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onSearch(String value) {
    _typing?.cancel();
    // Applies after typing pauses.
    _typing = Timer(const Duration(milliseconds: 300), () => _c.setSearch(value));
  }

  Future<void> _pick<T>({required String title, required List<(T, String)> options, required T current, required ValueChanged<T> onPicked}) async {
    final picked = await showModalBottomSheet<(T,)>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.s),
              child: Text(title, style: Theme.of(sheet).textTheme.titleMedium),
            ),
            for (final (value, label) in options)
              ListTile(
                title: Text(label),
                trailing: value == current ? const Icon(Icons.check) : null,
                onTap: () => Navigator.of(sheet).pop((value,)),
              ),
          ],
        ),
      ),
    );
    if (picked != null) onPicked(picked.$1);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _c,
    builder: (context, _) {
      final theme = Theme.of(context);
      final boxes = _c.mailboxes;
      final folderLabel = emailFolders.firstWhere((f) => f.$1 == _c.folder).$2;
      final mailbox = _c.mailbox;
      Widget body;
      if (boxes != null && boxes.isEmpty) {
        body = const EmptyMessage(
          title: 'No mailbox yet',
          body: 'Connect your Google Workspace mailbox, or ask a colleague to add you to a shared one. Mailboxes are set up in Email settings.',
        );
      } else {
        body = RefreshIndicator(
          onRefresh: () async {
            await Future.wait([_c.load(), _c.loadMailboxes()]);
          },
          child: ListView(
            controller: _scroll,
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, 0),
                child: TextField(
                  controller: _search,
                  onChanged: _onSearch,
                  textInputAction: TextInputAction.search,
                  decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search subject, people or address'),
                ),
              ),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, 0),
                child: Row(
                  children: [
                    ActionChip(
                      avatar: const Icon(Icons.folder_outlined, size: 18),
                      label: Text(_c.folder == 'inbox' && _c.unreadTotal > 0 ? 'Inbox, ${_c.unreadTotal} unread' : folderLabel),
                      onPressed: () => _pick<String>(title: 'Folder', options: emailFolders, current: _c.folder, onPicked: _c.setFolder),
                    ),
                    const SizedBox(width: Gap.s),
                    if ((boxes ?? const []).length > 1) ...[
                      ActionChip(
                        avatar: const Icon(Icons.alternate_email, size: 18),
                        label: Text(mailbox?.name ?? 'All mailboxes'),
                        onPressed: () => _pick<String?>(
                          title: 'Mailbox',
                          options: [(null, 'All mailboxes'), for (final m in boxes!) (m.id, m.unread > 0 ? '${m.name} (${m.unread})' : m.name)],
                          current: _c.mailboxId,
                          onPicked: _c.setMailbox,
                        ),
                      ),
                      const SizedBox(width: Gap.s),
                    ],
                    FilterChip(label: const Text('Unread'), selected: _c.unreadOnly, onSelected: _c.setUnreadOnly),
                  ],
                ),
              ),
              if (mailbox != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, 0),
                  child: Text(
                    mailbox.connected
                        ? 'Synced ${syncedAgo(mailbox.lastSyncedAt, _c.now())}${mailbox.syncTrouble ? '. The last sync had a problem.' : ''}'
                        : 'This mailbox needs reconnecting in Email settings.',
                    style: TextStyle(fontSize: 13, color: mailbox.connected ? theme.colorScheme.onSurfaceVariant : theme.colorScheme.error),
                  ),
                ),
              if (_c.providerResults)
                Padding(
                  padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, 0),
                  child: Text(
                    'Results from ${providerLabels[mailbox?.provider] ?? 'the mailbox'}',
                    style: TextStyle(color: theme.colorScheme.primary),
                  ),
                ),
              if (_c.mailboxError != null) _problem(context, _c.mailboxError!, null),
              if (_c.error != null) _problem(context, "Couldn't load conversations. ${_c.error}", () => unawaited(_c.load())),
              if (_c.loading && _c.threads.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(Gap.xl),
                  child: Center(child: CircularProgressIndicator()),
                ),
              if (!_c.loading && _c.error == null && _c.threads.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(Gap.xl),
                  child: Column(
                    children: [
                      Text(
                        _c.search.isNotEmpty ? 'No matches' : (_c.folder == 'inbox' ? 'Inbox zero' : 'Nothing in $folderLabel'),
                        style: theme.textTheme.titleMedium,
                      ),
                      const SizedBox(height: Gap.s),
                      Text(
                        _c.search.isNotEmpty
                            ? (_c.mailboxId == null
                                  ? 'Pick one mailbox to search all of its mail, including older mail.'
                                  : 'Dikho keeps recent conversations. Older mail can still be found in the mailbox itself.')
                            : (_c.folder == 'inbox' ? 'New conversations will appear here as they arrive.' : ''),
                        textAlign: TextAlign.center,
                        style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              for (final t in _c.threads)
                _ThreadRow(
                  thread: t,
                  me: widget.me,
                  showMailbox: _c.mailboxId == null && (boxes ?? const []).length > 1,
                  now: _c.now(),
                  onTap: () => widget.onOpenThread(context, t),
                ),
              if (_c.loading && _c.threads.isNotEmpty)
                const Padding(
                  padding: EdgeInsets.all(Gap.l),
                  child: Center(child: CircularProgressIndicator()),
                ),
              if (_c.canSearchProvider && !_c.loading)
                Padding(
                  padding: const EdgeInsets.all(Gap.l),
                  child: OutlinedButton.icon(
                    onPressed: () => unawaited(_c.searchProvider()),
                    icon: const Icon(Icons.search),
                    label: Text('Search all of ${providerLabels[mailbox?.provider] ?? 'the mailbox'}'),
                  ),
                ),
              const SizedBox(height: 88),
            ],
          ),
        );
      }
      return Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Open menu', icon: const Icon(Icons.menu), onPressed: widget.onOpenDrawer),
          title: const Text('Email'),
          actions: [
            IconButton(
              tooltip: 'Refresh',
              onPressed: () {
                unawaited(_c.load());
                unawaited(_c.loadMailboxes());
              },
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: body,
        floatingActionButton: widget.onCompose != null && _c.writable
            ? FloatingActionButton.extended(
                onPressed: () => widget.onCompose!(context),
                icon: const Icon(Icons.edit_outlined),
                label: const Text('Compose'),
              )
            : null,
      );
    },
  );

  Widget _problem(BuildContext context, String text, VoidCallback? retry) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.l, 0),
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          Expanded(
            child: Text(text, style: TextStyle(color: theme.colorScheme.onErrorContainer)),
          ),
          if (retry != null) TextButton(onPressed: retry, child: const Text('Try again')),
        ],
      ),
    );
  }
}

class _ThreadRow extends StatelessWidget {
  const _ThreadRow({required this.thread, required this.me, required this.showMailbox, required this.now, required this.onTap});

  final ThreadSummary thread;
  final String me;
  final bool showMailbox;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = thread;
    final strong = t.unread ? FontWeight.w700 : FontWeight.w400;
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final tags = <String>[
      if (showMailbox) t.accountName,
      if (t.workflow == 'closed') 'Done',
      if (t.workflow == 'pending') 'Waiting',
      if (t.assignedName.isNotEmpty) t.assignedTo == me ? 'Assigned to you' : 'Assigned to ${t.assignedName}',
    ];
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.l, Gap.m),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 6, right: Gap.s),
              child: Icon(
                Icons.circle,
                size: 10,
                color: t.unread ? theme.colorScheme.primary : Colors.transparent,
                semanticLabel: t.unread ? 'Unread' : null,
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          t.participantLine,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontWeight: strong),
                        ),
                      ),
                      Text(listTime(t.lastMessageAt, now), style: muted.copyWith(fontWeight: strong)),
                    ],
                  ),
                  Text(
                    t.subject,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontWeight: strong),
                  ),
                  if (t.snippet.isNotEmpty) Text(t.snippet, maxLines: 1, overflow: TextOverflow.ellipsis, style: muted),
                  if (tags.isNotEmpty || t.starred || t.hasAttachments || t.linkCount > 0 || t.noteCount > 0)
                    Padding(
                      padding: const EdgeInsets.only(top: Gap.xs),
                      child: Wrap(
                        spacing: Gap.s,
                        runSpacing: Gap.xs,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          if (t.starred) Icon(Icons.star, size: 16, color: Colors.amber.shade700, semanticLabel: 'Starred'),
                          if (t.hasAttachments)
                            Icon(Icons.attach_file, size: 16, color: theme.colorScheme.onSurfaceVariant, semanticLabel: 'Has attachments'),
                          if (t.linkCount > 0)
                            Icon(Icons.link, size: 16, color: theme.colorScheme.onSurfaceVariant, semanticLabel: 'Linked to CRM records'),
                          if (t.noteCount > 0)
                            Icon(
                              Icons.sticky_note_2_outlined,
                              size: 16,
                              color: theme.colorScheme.onSurfaceVariant,
                              semanticLabel: 'Has internal notes',
                            ),
                          for (final tag in tags) Pill(label: tag),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
