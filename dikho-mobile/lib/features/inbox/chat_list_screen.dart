import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../shared/record_ui.dart' show ListProgressLine, LoadingRows, nearListEnd;
import 'chat_theme.dart';
import 'inbox_format.dart';
import 'inbox_models.dart';
import 'inbox_scope.dart';
import 'inbox_widgets.dart';
import 'thread_screen.dart';

const _rowHeight = 72.0;

/// Grows with the phone's font size, so large text is never cut off, while staying a
/// fixed height that the list can use without measuring each row.
double chatRowExtent(BuildContext context) => math.max(_rowHeight, MediaQuery.textScalerOf(context).scale(44) + 20);

/// Every chat: a page at a time from the server, and only the rows on screen are
/// ever built, so thousands of chats cost the same as a dozen.
class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key, required this.onOpenDrawer});

  final VoidCallback onOpenDrawer;

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  final _scroll = ScrollController();
  final _search = TextEditingController();
  InboxScope? _scope;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_scope == null) {
      _scope = InboxScope.of(context);
      _scope!.inbox.setVisible(true);
      _search.text = _scope!.inbox.query;
    }
  }

  @override
  void dispose() {
    _scope?.inbox.setVisible(false);
    _scroll.dispose();
    _search.dispose();
    super.dispose();
  }

  void _onScroll() {
    final position = _scroll.position;
    if (nearListEnd(position)) {
      unawaited(_scope!.inbox.loadMore());
    }
  }

  void _open(Conversation conversation) {
    // Otherwise the search box takes the focus back, and the keyboard with it, on return.
    FocusManager.instance.primaryFocus?.unfocus();
    unawaited(Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ThreadScreen(conversation: conversation))));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final inbox = InboxScope.of(context).inbox;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
        title: const Text('Inbox'),
      ),
      body: ListenableBuilder(
        listenable: inbox,
        builder: (context, _) {
          return Column(
            children: [
              Container(
                color: theme.colorScheme.surface,
                padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, Gap.m, Gap.xs),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextField(
                      controller: _search,
                      onChanged: inbox.setQuery,
                      textInputAction: TextInputAction.search,
                      decoration: InputDecoration(
                        prefixIcon: const Icon(Icons.search),
                        hintText: 'Search name, number or message',
                        suffixIcon: _search.text.isEmpty
                            ? null
                            : IconButton(
                                tooltip: 'Clear search',
                                onPressed: () {
                                  _search.clear();
                                  inbox.setQuery('');
                                },
                                icon: const Icon(Icons.close),
                              ),
                      ),
                    ),
                    const SizedBox(height: Gap.xs),
                    Row(
                      children: [
                        _FilterChip(label: 'All', selected: !inbox.unreadOnly, onTap: () => inbox.setUnreadOnly(false)),
                        const SizedBox(width: Gap.s),
                        _FilterChip(
                          label: inbox.unreadTotal > 0 ? 'Unread ${inbox.unreadTotal}' : 'Unread',
                          selected: inbox.unreadOnly,
                          onTap: () => inbox.setUnreadOnly(true),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              ListProgressLine(active: inbox.refreshing),
              Expanded(child: _body(context, theme)),
            ],
          );
        },
      ),
    );
  }

  Widget _body(BuildContext context, ThemeData theme) {
    final inbox = InboxScope.of(context).inbox;
    final conversations = inbox.conversations;
    if (conversations.isEmpty) {
      if (inbox.loading) return LoadingRows(extent: chatRowExtent(context));
      // A failed load is not an empty inbox, and must not read like one.
      if (inbox.error != null) {
        return _Message(title: "Couldn't load conversations", body: inbox.error!, action: 'Try again', onAction: () => unawaited(inbox.reload()));
      }
      return _Message(
        title: inbox.query.isNotEmpty || inbox.unreadOnly ? 'No conversations match' : 'No conversations yet',
        body: inbox.query.isNotEmpty || inbox.unreadOnly
            ? 'Try a different name or number.'
            : "They'll appear here as soon as a customer messages your number.",
      );
    }
    final footer = inbox.nextCursor != null ? 1 : 0;
    return RefreshIndicator(
      onRefresh: inbox.refresh,
      child: ListView.builder(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        itemExtent: chatRowExtent(context),
        itemCount: conversations.length + footer,
        itemBuilder: (context, index) {
          if (index == conversations.length) {
            return const Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)));
          }
          final conversation = conversations[index];
          return _ChatRow(key: ValueKey(conversation.id), conversation: conversation, onTap: () => _open(conversation));
        },
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ChoiceChip(
    label: Text(label),
    selected: selected,
    showCheckmark: false,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    onSelected: (_) => onTap(),
  );
}

class _Message extends StatelessWidget {
  const _Message({required this.title, required this.body, this.action, this.onAction});

  final String title;
  final String body;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(Gap.xl),
      children: [
        const SizedBox(height: Gap.xl),
        Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
        const SizedBox(height: Gap.s),
        Text(
          body,
          textAlign: TextAlign.center,
          style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
        ),
        if (action != null) ...[
          const SizedBox(height: Gap.l),
          Center(
            child: FilledButton(onPressed: onAction, child: Text(action!)),
          ),
        ],
      ],
    );
  }
}

class _ChatRow extends StatelessWidget {
  const _ChatRow({super.key, required this.conversation, required this.onTap});

  final Conversation conversation;
  final VoidCallback onTap;

  static const _kindIcons = {
    'image': Icons.photo_outlined,
    'video': Icons.videocam_outlined,
    'audio': Icons.mic_none,
    'document': Icons.description_outlined,
    'sticker': Icons.emoji_emotions_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final unread = conversation.unreadCount > 0;
    final preview = decodePreview(conversation.lastMessagePreview);
    final kindIcon = _kindIcons[preview.kind];
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Gap.m),
        child: Row(
          children: [
            ChatAvatar(name: conversation.avatarName, phone: conversation.phone, avatarUrl: conversation.avatarUrl),
            const SizedBox(width: Gap.m),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          conversation.displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 15, fontWeight: unread ? FontWeight.w600 : FontWeight.w400),
                        ),
                      ),
                      const SizedBox(width: Gap.s),
                      Text(
                        formatListTime(conversation.lastMessageAt),
                        style: TextStyle(
                          fontSize: 12,
                          color: unread ? theme.colorScheme.primary : muted,
                          fontWeight: unread ? FontWeight.w500 : FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: Gap.xs - 1),
                  Row(
                    children: [
                      if (conversation.lastMessageDirection == 'outbound') ...[
                        DeliveryTicks(status: conversation.lastMessageStatus, color: muted),
                        const SizedBox(width: Gap.xs),
                      ],
                      if (kindIcon != null) ...[Icon(kindIcon, size: 14, color: muted), const SizedBox(width: Gap.xs)],
                      Expanded(
                        child: Text(
                          preview.text,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13, color: muted),
                        ),
                      ),
                      if (unread) ...[
                        const SizedBox(width: Gap.s),
                        Badge.count(
                          count: conversation.unreadCount,
                          backgroundColor: theme.colorScheme.primary,
                          textColor: theme.colorScheme.onPrimary,
                        ),
                      ],
                    ],
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
