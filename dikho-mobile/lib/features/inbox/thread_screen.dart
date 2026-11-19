import 'dart:async';

import 'package:flutter/material.dart';

import 'chat_actions.dart';
import 'chat_theme.dart';
import 'composer.dart';
import 'contact_info_screen.dart';
import 'forward_screen.dart';
import 'inbox_format.dart';
import 'inbox_models.dart';
import 'inbox_scope.dart';
import 'inbox_widgets.dart';
import 'media_viewer.dart';
import 'message_bubble.dart';
import 'thread_controller.dart';

const _estimatedRowHeight = 64.0;

/// One chat, full screen. Rows are built only as they scroll into view. New messages
/// grow below a fixed anchor and older pages grow above it, so neither ever moves what
/// is being read.
class ThreadScreen extends StatefulWidget {
  const ThreadScreen({super.key, required this.conversation});

  final Conversation conversation;

  @override
  State<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends State<ThreadScreen> {
  static const _loadOlderAt = 300.0;
  static const _bottomSlack = 80.0;

  final _scroll = ScrollController();
  final _centerKey = GlobalKey();
  final _rowKeys = <int, GlobalKey>{};
  final _searchField = TextEditingController();

  late ThreadController _thread;
  late InboxScope _scope;
  bool _started = false;

  int? _anchorId;
  bool _atBottom = true;
  int _unseen = 0;
  int _lastCount = 0;
  bool _search = false;
  bool _starredOnly = false;
  Message? _replyTo;
  int _pinIndex = 0;
  int? _highlightId;
  Timer? _highlightTimer;
  int _builtLow = 1 << 30;
  int _builtHigh = -1;

  // Rebuilt only when the rows really changed: a list of hundreds is folded and
  // grouped once, not on every keystroke.
  List<Message>? _foldedFrom;
  late FoldedThread _folded;
  late Map<String, Message> _byWamid;
  List<Message>? _rowsFrom;
  String? _rowsQuery;
  bool? _rowsStarred;
  List<ThreadRow> _rows = const [];
  List<Message>? _matches;
  Map<int, int> _rowIndex = const {};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _scope = InboxScope.of(context);
    if (_started) return;
    _started = true;
    final inbox = _scope.inbox;
    _thread = ThreadController(
      api: _scope.api,
      conversation: widget.conversation,
      onSent: (message) => inbox.noteSent(widget.conversation.id, message),
    );
    inbox.activeThread = _thread;
    inbox.noteOpened(widget.conversation);
    _thread.addListener(_onThreadChanged);
    _scroll.addListener(_onScroll);
    unawaited(_thread.open());
  }

  @override
  void dispose() {
    if (identical(_scope.inbox.activeThread, _thread)) _scope.inbox.activeThread = null;
    _thread.removeListener(_onThreadChanged);
    _thread.dispose();
    _scope.audio.stop();
    _scroll.dispose();
    _searchField.dispose();
    _highlightTimer?.cancel();
    super.dispose();
  }

  void _onThreadChanged() {
    if (_thread.gone) {
      Navigator.of(context).maybePop();
      return;
    }
    final messages = _thread.messages;
    if (messages.isNotEmpty) _anchorId ??= messages.last.id;
    final count = messages.length;
    if (count > _lastCount) {
      final arrived = messages.skip(_lastCount.clamp(0, count)).where((m) => !m.isOutbound && m.type != 'reaction').length;
      final wasEmpty = _lastCount == 0;
      if (wasEmpty || _atBottom) {
        afterFrame(_toBottom);
      } else if (messages.last.id != _lastSeenLast) {
        setState(() => _unseen += arrived);
      }
      _lastSeenLast = messages.last.id;
    }
    _lastCount = count;
    setState(() {});
  }

  int? _lastSeenLast;

  void _toBottom({bool animate = false}) {
    if (!_scroll.hasClients) return;
    final target = _scroll.position.maxScrollExtent;
    if (animate) {
      unawaited(_scroll.animateTo(target, duration: const Duration(milliseconds: 250), curve: Curves.easeOut));
    } else {
      _scroll.jumpTo(target);
    }
    afterFrame(() {
      if (_scroll.hasClients && _scroll.position.pixels < _scroll.position.maxScrollExtent) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    });
  }

  void _onScroll() {
    final position = _scroll.position;
    final atBottom = position.maxScrollExtent - position.pixels < _bottomSlack;
    if (atBottom != _atBottom) {
      setState(() {
        _atBottom = atBottom;
        if (atBottom) _unseen = 0;
      });
    }
    if (position.pixels - position.minScrollExtent < _loadOlderAt && !_searching) unawaited(_loadOlder());
  }

  bool get _searching => _starredOnly || (_search && _searchField.text.trim().isNotEmpty);

  Future<void> _loadOlder() async {
    final problem = await _thread.loadOlder();
    if (problem != null && mounted) showNotice(context, problem);
  }

  void _prepareRows() {
    final messages = _thread.messages;
    if (!identical(_foldedFrom, messages)) {
      _foldedFrom = messages;
      _folded = foldReactions(messages);
      _byWamid = indexByWamid(messages);
    }
    final query = _search ? _searchField.text.trim().toLowerCase() : '';
    if (identical(_rowsFrom, messages) && _rowsQuery == query && _rowsStarred == _starredOnly) return;
    _rowsFrom = messages;
    _rowsQuery = query;
    _rowsStarred = _starredOnly;
    if (_starredOnly) {
      _matches = _folded.shown.where((m) => m.starred).toList();
    } else if (query.isNotEmpty) {
      _matches = _folded.shown.where((m) => (m.body ?? '').toLowerCase().contains(query)).toList();
    } else {
      _matches = null;
    }
    _rows = buildThreadRows(_matches ?? _folded.shown);
    _rowIndex = {
      for (var i = 0; i < _rows.length; i++)
        if (_rows[i] case MessageRow(:final message)) message.id: i,
    };
  }

  /// Rows up to and including the anchor grow upward from it, the rest downward.
  int get _splitAt {
    final anchor = _anchorId;
    if (anchor == null) return _rows.length;
    final at = _rowIndex[anchor];
    if (at != null) return at + 1;
    // The anchor was deleted: re-anchor on the row nearest its place.
    for (var i = _rows.length - 1; i >= 0; i--) {
      if (_rows[i] case MessageRow(:final message) when message.id <= anchor) return i + 1;
    }
    return 0;
  }

  /* ── One message ───────────────────────────────────────────────────── */

  bool get _windowOpen => _thread.conversation.windowLeft() > Duration.zero && !_thread.conversation.isBlocked;

  MessageMenuSpec? _menuFor(Message m) {
    if (m.type == 'system' || m.type == 'call') return null;
    final access = _scope.access;
    final canReply = access.can('inbox.reply');
    final conversation = _thread.conversation;
    final reactable = m.canReact();
    final String? reason = !canReply
        ? null
        : conversation.isBlocked
        ? 'You blocked this contact.'
        : conversation.windowLeft() <= Duration.zero
        ? 'Reactions need the 24-hour reply window to be open.'
        : !reactable
        ? 'WhatsApp only takes reactions to messages from the last 30 days.'
        : null;
    return MessageMenuSpec(
      reactionsEnabled: canReply && _windowOpen && reactable,
      reactionsReason: reason,
      canReply: canReply && _windowOpen && m.metaMessageId != null,
      canCopy: m.body != null,
      canForward: canReply && m.canForward,
      canPin: canReply,
      canDelete: access.can('inbox.delete'),
    );
  }

  Future<void> _openMenu(Message m) async {
    final spec = _menuFor(m);
    if (spec == null) return;
    final choice = await showMessageSheet(context, message: m, spec: spec, myReaction: _folded.reactionsFor(m)?.business);
    if (choice == null || !mounted) return;
    switch (choice) {
      case ReactChoice(:final emoji):
        await runWithNotice(context, () => _thread.react(m, emoji));
      case ActionChoice(:final key):
        switch (key) {
          case 'reply':
            setState(() => _replyTo = m);
          case 'copy':
            await copyMessageText(context, m.body ?? '');
          case 'forward':
            await Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => ForwardScreen(message: m, currentId: _thread.conversationId),
              ),
            );
          case 'pin':
            if (await runWithNotice(context, () => _thread.setPinned(m, pinned: true)) && mounted) {
              showNotice(context, 'Pinned for your team');
            }
          case 'unpin':
            await runWithNotice(context, () => _thread.setPinned(m, pinned: false));
          case 'star':
            await runWithNotice(context, () => _thread.setStarred(m, starred: true));
          case 'unstar':
            await runWithNotice(context, () => _thread.setStarred(m, starred: false));
          case 'delete':
            await confirmChatAction(context, action: 'deleteMessage', name: _thread.conversation.displayName, run: () => _thread.deleteMessage(m));
        }
    }
  }

  void _openMedia(Message m) {
    final items = _thread.messages.where((x) => x.isViewable).toList();
    unawaited(
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => MediaViewer(items: items, initialId: m.id),
        ),
      ),
    );
  }

  /// Back to the whole thread from a search or starred view, which has its own list.
  void _leaveFilter({bool toLatest = true}) {
    final filtered = _matches != null;
    setState(() {
      _search = false;
      _starredOnly = false;
      _searchField.clear();
      if (filtered) {
        _atBottom = true;
        _unseen = 0;
      }
    });
    if (filtered && toLatest) afterFrame(_toBottom);
  }

  /// Rows have no fixed height, so this jumps by estimate and walks the rest of the
  /// way until the row has been built, then centres it and rings it for a moment.
  Future<void> _jumpTo(int id) async {
    // Seen in the whole thread, around what came before and after it.
    if (_matches != null) {
      _leaveFilter(toLatest: false);
      await WidgetsBinding.instance.endOfFrame;
    }
    if (!mounted || !_scroll.hasClients) return;
    final target = _rowIndex[id];
    if (target == null) return;
    final estimate = (target - _splitAt) * _estimatedRowHeight;
    final position = _scroll.position;
    _scroll.jumpTo(estimate.clamp(position.minScrollExtent, position.maxScrollExtent));
    for (var attempt = 0; attempt < 12; attempt++) {
      await WidgetsBinding.instance.endOfFrame;
      if (!mounted || !_scroll.hasClients) return;
      final context = _rowKeys[id]?.currentContext;
      if (context != null && context.mounted) {
        await Scrollable.ensureVisible(context, alignment: 0.5, duration: const Duration(milliseconds: 200));
        if (!mounted) return;
        setState(() => _highlightId = id);
        _highlightTimer?.cancel();
        _highlightTimer = Timer(const Duration(milliseconds: 1600), () {
          if (mounted) setState(() => _highlightId = null);
        });
        return;
      }
      final view = _scroll.position.viewportDimension;
      final step = target < _builtLow ? -view : view;
      _builtLow = 1 << 30;
      _builtHigh = -1;
      _scroll.jumpTo((_scroll.position.pixels + step).clamp(_scroll.position.minScrollExtent, _scroll.position.maxScrollExtent));
    }
  }

  Widget _buildRow(int index) {
    if (index < _builtLow) _builtLow = index;
    if (index > _builtHigh) _builtHigh = index;
    final row = _rows[index];
    switch (row) {
      case DayRow(:final at, :final key):
        return CanvasChip(key: ValueKey(key), child: Text(formatDaySeparator(at).toUpperCase()));
      case MessageRow(:final message, :final startsRun):
        if (message.type == 'system') {
          return CanvasChip(key: _rowKey(message.id), child: Text(message.body ?? ''));
        }
        final wamid = message.contextWamid;
        final quoted = wamid == null ? null : _byWamid[wamid];
        return KeyedSubtree(
          key: _rowKey(message.id),
          child: MessageBubble(
            message: message,
            startsRun: startsRun,
            reactions: _folded.reactionsFor(message),
            quoted: quoted,
            quotedAuthor: quoted == null ? '' : _author(quoted),
            searchTerm: _search ? _searchField.text.trim() : '',
            highlighted: _highlightId == message.id,
            onLongPress: () => unawaited(_openMenu(message)),
            onOpenMedia: _openMedia,
            onJumpToQuote: quoted == null ? null : () => unawaited(_jumpTo(quoted.id)),
          ),
        );
    }
  }

  GlobalKey _rowKey(int id) => _rowKeys[id] ??= GlobalObjectKey('${_thread.conversationId}:$id');

  String _author(Message m) => m.isOutbound ? 'You' : _thread.conversation.displayName;

  int? _findRow(Key key) {
    if (key is GlobalObjectKey) {
      final value = key.value;
      if (value is String) {
        final id = int.tryParse(value.split(':').last);
        return id == null ? null : _rowIndex[id];
      }
    }
    return null;
  }

  /* ── Screen ────────────────────────────────────────────────────────── */

  Future<void> _chatAction(String key) async {
    if (key == 'starred') {
      setState(() {
        _search = false;
        _searchField.clear();
        _starredOnly = true;
      });
      return;
    }
    final inbox = _scope.inbox;
    final id = _thread.conversationId;
    final api = _scope.api;
    await confirmChatAction(
      context,
      action: key,
      name: _thread.conversation.displayName,
      run: () async {
        switch (key) {
          case 'clear':
            inbox.applyCleared(await api.clearChat(id));
          case 'delete':
            await api.deleteChat(id);
            inbox.remove(id);
            _thread.markGone();
          case 'block':
            inbox.patch(id, {'blocked_at': await api.block(id) ?? DateTime.now().toUtc().toIso8601String()});
          case 'unblock':
            await api.unblock(id);
            inbox.patch(id, {'blocked_at': null});
        }
      },
    );
  }

  PreferredSizeWidget _appBar(BuildContext context) {
    final conversation = _thread.conversation;
    final access = _scope.access;
    final canDelete = access.can('inbox.delete');
    final canBlock = access.can('inbox.block');
    return AppBar(
      titleSpacing: 0,
      title: InkWell(
        onTap: () => unawaited(
          Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => ContactInfoScreen(thread: _thread, onChatAction: _chatAction),
            ),
          ),
        ),
        child: SizedBox(
          height: 56,
          child: Row(
            children: [
              ChatAvatar(name: conversation.avatarName, phone: conversation.phone, avatarUrl: conversation.avatarUrl, size: 40),
              const SizedBox(width: Gap.m),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      conversation.displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
                    ),
                    Text(
                      '+${conversation.phone}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        IconButton(
          tooltip: 'Search this conversation',
          onPressed: () => _search
              ? _leaveFilter()
              : setState(() {
                  _search = true;
                  _starredOnly = false;
                }),
          icon: const Icon(Icons.search),
        ),
        PopupMenuButton<String>(
          tooltip: 'More options',
          onSelected: (key) => unawaited(_chatAction(key)),
          itemBuilder: (_) => [
            const PopupMenuItem(value: 'starred', height: 48, child: Text('Starred messages')),
            if (canDelete) const PopupMenuItem(value: 'clear', height: 48, child: Text('Clear chat')),
            if (canDelete) const PopupMenuItem(value: 'delete', height: 48, child: Text('Delete chat')),
            if (canBlock)
              conversation.isBlocked
                  ? const PopupMenuItem(value: 'unblock', height: 48, child: Text('Unblock'))
                  : PopupMenuItem(
                      value: 'block',
                      height: 48,
                      enabled: conversation.canBlockNow,
                      child: Text(conversation.canBlockNow ? 'Block' : 'Block (only within 24 hours of their last message)'),
                    ),
          ],
        ),
      ],
    );
  }

  Widget _pinnedBar(ThemeData theme) {
    final pinned = _folded.shown.where((m) => m.pinnedAt != null).toList()..sort((a, b) => (b.pinnedAt ?? '').compareTo(a.pinnedAt ?? ''));
    if (pinned.isEmpty || _starredOnly) return const SizedBox.shrink();
    final current = pinned[_pinIndex % pinned.length];
    return Material(
      color: theme.colorScheme.surface,
      child: InkWell(
        onTap: () {
          unawaited(_jumpTo(current.id));
          setState(() => _pinIndex = (_pinIndex + 1) % pinned.length);
        },
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: Gap.l, vertical: Gap.xs),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: theme.colorScheme.outlineVariant)),
          ),
          child: Row(
            children: [
              Icon(Icons.push_pin_outlined, size: 16, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: Gap.m),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      pinned.length > 1 ? 'Pinned · ${(_pinIndex % pinned.length) + 1} of ${pinned.length}' : 'Pinned',
                      style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurfaceVariant),
                    ),
                    Text(current.snippet, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _searchBar(ThemeData theme) => Container(
    color: theme.colorScheme.surface,
    padding: const EdgeInsets.fromLTRB(Gap.m, Gap.xs, Gap.xs, Gap.s),
    child: Row(
      children: [
        Expanded(
          child: TextField(
            controller: _searchField,
            autofocus: true,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Find in this conversation'),
          ),
        ),
        if (_matches != null)
          Padding(
            padding: const EdgeInsets.only(left: Gap.s),
            child: Text('${_matches!.length} found', style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurfaceVariant)),
          ),
        IconButton(tooltip: 'Close search', onPressed: _leaveFilter, icon: const Icon(Icons.close)),
      ],
    ),
  );

  Widget _list() {
    if (_thread.loading && _thread.messages.isEmpty) {
      return const Center(child: CanvasChip(child: Text('Loading messages…')));
    }
    if (_thread.error != null && _thread.messages.isEmpty) {
      return Center(
        child: CanvasChip(onTap: _thread.retry, child: Text('${_thread.error} Tap to try again.')),
      );
    }
    if (_matches != null) {
      if (_matches!.isEmpty) {
        return Align(
          alignment: Alignment.topCenter,
          child: CanvasChip(child: Text(_starredOnly ? 'You have not starred anything in this chat.' : 'No messages match that search.')),
        );
      }
      return ListView.builder(
        padding: const EdgeInsets.only(bottom: Gap.s),
        itemCount: _rows.length,
        findChildIndexCallback: _findRow,
        itemBuilder: (_, index) => _buildRow(index),
      );
    }
    final split = _splitAt;
    final hasMore = _thread.thread.hasMore;
    final left = _thread.conversation.windowLeft();
    final showWindow = left > Duration.zero && !_thread.conversation.isBlocked;
    final after = _rows.length - split;
    return CustomScrollView(
      controller: _scroll,
      center: _centerKey,
      anchor: 1,
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: [
        SliverList.builder(
          itemCount: split + (hasMore ? 1 : 0),
          itemBuilder: (_, index) {
            if (index == split) {
              return CanvasChip(
                onTap: _thread.loadingOlder ? null : () => unawaited(_loadOlder()),
                child: Text(_thread.loadingOlder ? 'Loading older messages…' : 'Load older messages'),
              );
            }
            return _buildRow(split - 1 - index);
          },
          findChildIndexCallback: (key) {
            final row = _findRow(key);
            return row == null || row >= split ? null : split - 1 - row;
          },
        ),
        SliverList.builder(
          key: _centerKey,
          itemCount: after + 1,
          itemBuilder: (_, index) {
            if (index == after) {
              // The 24-hour window goes where WhatsApp puts its own notices, last
              // in the thread, so it stays in view at the end.
              return Padding(
                padding: const EdgeInsets.only(bottom: Gap.s),
                child: showWindow
                    ? CanvasChip(child: Text('Replies are open for ${formatCountdown(left)}. After that, only approved templates can be sent.'))
                    : const SizedBox.shrink(),
              );
            }
            return _buildRow(split + index);
          },
          findChildIndexCallback: (key) {
            final row = _findRow(key);
            return row == null || row < split ? null : row - split;
          },
        ),
      ],
    );
  }

  Widget _composerArea() {
    final conversation = _thread.conversation;
    final access = _scope.access;
    if (conversation.isBlocked) {
      final canBlock = access.can('inbox.block');
      return ComposerNotice(
        text: canBlock
            ? 'You blocked this contact. They cannot message this number, and you cannot message them.'
            : 'This contact is blocked. Someone with permission to block contacts can unblock them.',
        action: canBlock ? 'Unblock' : null,
        onAction: () => unawaited(_chatAction('unblock')),
      );
    }
    if (!access.can('inbox.reply')) {
      return const ComposerNotice(icon: Icons.visibility_outlined, text: 'You can read conversations, but your access does not include replying.');
    }
    return Composer(
      thread: _thread,
      canTemplate: access.can('campaigns.send'),
      replyTo: _replyTo,
      replyAuthor: _replyTo == null ? '' : _author(_replyTo!),
      onCancelReply: () {
        if (_replyTo != null && mounted) setState(() => _replyTo = null);
      },
      onSent: () => afterFrame(() => _toBottom(animate: true)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final chat = ChatColors.of(context);
    _prepareRows();
    // A phone on its side with the keyboard up has barely any height left. What is being
    // typed comes first, so the header and the pinned bar step aside until it closes.
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    final cramped = keyboard > 0 && MediaQuery.sizeOf(context).height - keyboard < 260;
    return PopScope(
      canPop: !_search && !_starredOnly,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _leaveFilter();
      },
      child: Scaffold(
        backgroundColor: chat.canvas,
        appBar: cramped ? null : _appBar(context),
        body: Stack(
          children: [
            Positioned.fill(
              child: RepaintBoundary(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    image: DecorationImage(
                      image: const AssetImage('assets/chat/doodles.png'),
                      repeat: ImageRepeat.repeat,
                      scale: 2,
                      alignment: Alignment.topLeft,
                      colorFilter: ColorFilter.mode(chat.doodle, BlendMode.srcIn),
                    ),
                  ),
                ),
              ),
            ),
            Column(
              children: [
                if (_starredOnly)
                  Container(
                    color: theme.colorScheme.surface,
                    padding: const EdgeInsets.only(left: Gap.l),
                    child: Row(
                      children: [
                        Icon(Icons.star, size: 15, color: theme.colorScheme.onSurfaceVariant),
                        const SizedBox(width: Gap.s),
                        Expanded(
                          child: Text(
                            'Your starred messages · ${_matches?.length ?? 0}',
                            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
                          ),
                        ),
                        IconButton(tooltip: 'Show all messages', onPressed: _leaveFilter, icon: const Icon(Icons.close)),
                      ],
                    ),
                  ),
                if (!cramped) _pinnedBar(theme),
                if (_search) _searchBar(theme),
                Expanded(
                  child: Stack(
                    children: [
                      Positioned.fill(child: _list()),
                      if (!_atBottom && _matches == null)
                        Positioned(
                          right: Gap.m,
                          bottom: Gap.m,
                          child: Stack(
                            clipBehavior: Clip.none,
                            children: [
                              FloatingActionButton.small(
                                heroTag: null,
                                tooltip: _unseen > 0 ? 'Go to the latest message, $_unseen new' : 'Go to the latest message',
                                backgroundColor: chat.raised,
                                foregroundColor: chat.sub,
                                onPressed: () {
                                  setState(() {
                                    _atBottom = true;
                                    _unseen = 0;
                                  });
                                  _toBottom(animate: true);
                                },
                                child: const Icon(Icons.keyboard_arrow_down),
                              ),
                              if (_unseen > 0)
                                Positioned(
                                  top: -6,
                                  right: -4,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(color: chat.accent, borderRadius: BorderRadius.circular(10)),
                                    child: Text(_unseen > 99 ? '99+' : '$_unseen', style: TextStyle(fontSize: 11, color: chat.onAccent)),
                                  ),
                                ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
                _composerArea(),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
