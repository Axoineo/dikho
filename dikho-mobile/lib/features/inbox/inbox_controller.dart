import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../shared/crm_api.dart';
import 'inbox_api.dart';
import 'inbox_models.dart';
import 'thread_controller.dart';

int _byRecent(Conversation a, Conversation b) {
  final at = (b.lastMessageAt ?? '').compareTo(a.lastMessageAt ?? '');
  return at != 0 ? at : b.id.compareTo(a.id);
}

/// The chat list: a page at a time from the server, kept current by realtime and
/// by a slow re-read of the first page, because broadcasts are never replayed.
class InboxController extends ChangeNotifier {
  InboxController({required this.api, this.searchDelay = const Duration(milliseconds: 300)});

  final InboxApi api;
  final Duration searchDelay;

  /// While the socket is up, only a backstop. While it is down, the only source.
  static const pollWhenLive = Duration(seconds: 120);
  static const pollWhenDown = Duration(seconds: 30);

  List<Conversation> conversations = const [];
  bool loading = false;
  bool loadingMore = false;
  String? error;
  String? nextCursor;
  int unreadTotal = 0;
  String query = '';
  bool unreadOnly = false;
  ThreadController? activeThread;

  bool _visible = false;
  bool _realtimeJoined = false;
  bool _loadedOnce = false;
  bool _disposed = false;
  int _request = 0;
  Timer? _searchTimer;
  Timer? _pollTimer;

  bool get hasLoaded => _loadedOnce;

  /// A new search or filter is loading while the last result is still on screen. A
  /// refresh keeps its rows and never sets [loading], so it is not counted.
  bool get refreshing => loading && conversations.isNotEmpty;

  /// Only while a list is on screen: nothing polls behind another page.
  void setVisible(bool visible) {
    if (_visible == visible) return;
    _visible = visible;
    _schedulePoll();
    if (visible) {
      if (_loadedOnce) {
        unawaited(refresh());
      } else {
        unawaited(reload());
      }
    }
  }

  void setRealtimeJoined(bool joined) {
    _realtimeJoined = joined;
    _schedulePoll();
  }

  void _schedulePoll() {
    _pollTimer?.cancel();
    _pollTimer = null;
    if (!_visible) return;
    _pollTimer = Timer.periodic(_realtimeJoined ? pollWhenLive : pollWhenDown, (_) => unawaited(refresh()));
  }

  void setQuery(String value) {
    final next = value.trim();
    if (next == query) return;
    query = next;
    _searchTimer?.cancel();
    _searchTimer = Timer(searchDelay, () => unawaited(reload()));
    notifyListeners();
  }

  void setUnreadOnly(bool value) {
    if (value == unreadOnly) return;
    unreadOnly = value;
    unawaited(reload());
  }

  Future<void> reload() async {
    final request = ++_request;
    loading = true;
    error = null;
    notifyListeners();
    try {
      final page = await api.conversations(query: query, unreadOnly: unreadOnly);
      if (request != _request || _disposed) return;
      conversations = page.conversations;
      nextCursor = page.nextCursor;
      if (page.unreadTotal != null) unreadTotal = page.unreadTotal!;
      _loadedOnce = true;
    } on ApiException catch (failure) {
      // The rows held are for the previous search or filter, so they must not stay up
      // looking like this one's result.
      if (request == _request) {
        error = failure.message;
        conversations = const [];
        nextCursor = null;
      }
    } finally {
      if (request == _request && !_disposed) {
        loading = false;
        notifyListeners();
      }
    }
  }

  Future<void> loadMore() async {
    final cursor = nextCursor;
    if (cursor == null || loadingMore || loading) return;
    final request = _request;
    loadingMore = true;
    notifyListeners();
    try {
      final page = await api.conversations(cursor: cursor, query: query, unreadOnly: unreadOnly);
      if (request != _request || _disposed) return;
      final have = {for (final c in conversations) c.id};
      conversations = [...conversations, ...page.conversations.where((c) => !have.contains(c.id))];
      nextCursor = page.nextCursor;
    } on ApiException {
      // The next scroll tries again; the rows already here stay.
    } finally {
      loadingMore = false;
      if (!_disposed) notifyListeners();
    }
  }

  /// Re-reads the first page. Its rows replace the ones they overlap, and rows
  /// further down that were already paged in stay, so nobody loses their place.
  Future<void> refresh() async {
    if (loading) return;
    final request = _request;
    final openId = activeThread?.conversationId;
    try {
      final page = await api.conversations(query: query, unreadOnly: unreadOnly);
      if (request != _request || _disposed) return;
      final fresh = {for (final c in page.conversations) c.id};
      final oldest = page.conversations.isEmpty ? null : page.conversations.last;
      final older = oldest == null ? const <Conversation>[] : conversations.where((c) => !fresh.contains(c.id) && _byRecent(c, oldest) > 0);
      conversations = [
        for (final c in page.conversations)
          // Don't let the server resurrect a badge on the chat being read:
          // markRead may not have landed yet.
          c.id == openId ? c.merged({'unread_count': 0}) : c,
        ...older,
      ];
      if (older.isEmpty) nextCursor = page.nextCursor;
      if (page.unreadTotal != null) unreadTotal = page.unreadTotal!;
      _loadedOnce = true;
      error = null;
      notifyListeners();
    } on ApiException {
      // A failed refresh keeps what is on screen; the next one tries again.
    }
    await activeThread?.refresh();
  }

  Conversation? byId(int id) {
    for (final c in conversations) {
      if (c.id == id) return c;
    }
    return activeThread?.conversationId == id ? activeThread!.conversation : null;
  }

  void _upsert(Conversation conversation) {
    final index = conversations.indexWhere((c) => c.id == conversation.id);
    final next = [...conversations];
    if (index == -1) {
      // A search or filter shows what the server matched: a new arrival there
      // appears at the next refresh rather than out of nowhere.
      if (query.isNotEmpty) return;
      if (unreadOnly && conversation.unreadCount == 0) return;
      next.add(conversation);
    } else {
      next[index] = next[index].merged(conversation.raw);
    }
    next.sort(_byRecent);
    conversations = next;
  }

  void patch(int id, Map<String, dynamic> fields) {
    final index = conversations.indexWhere((c) => c.id == id);
    if (index != -1) {
      conversations = [...conversations]..[index] = conversations[index].merged(fields);
    }
    if (activeThread?.conversationId == id) activeThread!.patchConversation(fields);
    notifyListeners();
  }

  void remove(int id) {
    conversations = conversations.where((c) => c.id != id).toList();
    notifyListeners();
  }

  /// Marks a chat as read locally as soon as it opens.
  void noteOpened(Conversation conversation) {
    if (conversation.unreadCount > 0 && unreadTotal > 0) unreadTotal--;
    patch(conversation.id, {'unread_count': 0});
  }

  /// A send from this phone moves the chat to the top straight away.
  void noteSent(int id, Message message) {
    final existing = byId(id);
    if (existing == null) return;
    _upsert(
      existing.merged({
        'last_message_at': message.createdAt,
        'last_message_preview': message.body ?? '📎 ${message.type}',
        'last_message_direction': 'outbound',
        'last_message_status': message.status,
      }),
    );
    notifyListeners();
  }

  /// Everything the Worker broadcasts, whichever phone or browser caused it.
  void onRealtimeEvent(String event, Map<String, dynamic> payload) {
    final thread = activeThread;
    switch (event) {
      case 'message:new':
        final conversation = payload['conversation'];
        final message = payload['message'];
        if (conversation is! Map<String, dynamic> || message is! Map<String, dynamic>) return;
        final incoming = Conversation(conversation);
        final row = Message(message);
        final active = thread?.conversationId == incoming.id;
        final was = byId(incoming.id);
        if (!active && !row.isOutbound && (was?.unreadCount ?? 0) == 0) unreadTotal++;
        _upsert(active ? incoming.merged({'unread_count': 0}) : incoming);
        if (active) {
          thread!.onNewMessage(row);
          thread.patchConversation(conversation);
        }
      case 'message:updated':
        final message = payload['message'];
        if (message is Map<String, dynamic>) thread?.mergeMessage(message);
      case 'status:update':
        final id = payload['messageId'];
        final status = payload['status'];
        if (id is String && status is String) thread?.setStatus(id, status);
      case 'conversation:updated':
        final id = payload['id'];
        if (id is int) patch(id, {'avatar_url': payload['avatar_url']});
      case 'conversation:cleared':
        final conversation = payload['conversation'];
        if (conversation is Map<String, dynamic>) applyCleared(Conversation(conversation));
      case 'conversation:deleted':
        final id = payload['id'];
        if (id is int) {
          remove(id);
          if (thread?.conversationId == id) thread!.markGone();
        }
      case 'conversation:blocked':
        final id = payload['id'];
        if (id is int) patch(id, {'blocked_at': payload['blocked_at']});
      case 'message:hidden':
        final id = payload['id'];
        if (id is int) thread?.removeMessage(id);
    }
    notifyListeners();
  }

  void applyCleared(Conversation conversation) {
    patch(conversation.id, {...conversation.raw, 'last_message_status': null, 'unread_count': 0});
    if (activeThread?.conversationId == conversation.id) {
      activeThread!.applyCleared(conversation.clearedThroughId);
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _searchTimer?.cancel();
    _pollTimer?.cancel();
    super.dispose();
  }
}
