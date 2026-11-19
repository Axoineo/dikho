import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../../shared/crm_api.dart';
import 'inbox_api.dart';
import 'inbox_models.dart';

/// One open chat: its rows, paging, and everything sent from it. Replies from the
/// server are dropped once the chat is closed, so a slow answer can never land in
/// another chat.
class ThreadController extends ChangeNotifier {
  ThreadController({required this.api, required Conversation conversation, this.onSent})
    : _conversation = conversation,
      conversationId = conversation.id;

  final InboxApi api;
  final int conversationId;
  final void Function(Message)? onSent;

  Conversation _conversation;
  ThreadData thread = const ThreadData();
  bool loading = true;
  bool loadingOlder = false;
  String? error;
  bool gone = false;

  bool _closed = false;

  Conversation get conversation => _conversation;
  List<Message> get messages => thread.messages;

  void patchConversation(Map<String, dynamic> fields) {
    _conversation = _conversation.merged(fields);
    _notify();
  }

  void _notify() {
    if (!_closed) notifyListeners();
  }

  Future<void> open() async {
    unawaited(api.markRead(conversationId).then<void>((_) {}, onError: (Object _) {}));
    await _loadNewest();
  }

  Future<void> _loadNewest() async {
    loading = true;
    error = null;
    _notify();
    try {
      final page = await api.messages(conversationId);
      if (_closed) return;
      thread = threadFromPage(page);
    } on ApiException catch (failure) {
      if (!_closed) error = failure.message;
    } finally {
      loading = false;
      _notify();
    }
  }

  Future<void> retry() => _loadNewest();

  Future<void> refresh() async {
    if (loading) return;
    try {
      final page = await api.messages(conversationId);
      if (_closed) return;
      thread = mergeNewestPage(thread, page);
      _notify();
    } on ApiException {
      // Keeps what is on screen; the next refresh tries again.
    }
  }

  /// One request at a time, as the person scrolls up.
  Future<String?> loadOlder() async {
    if (!thread.hasMore || loadingOlder) return null;
    final before = thread.before;
    loadingOlder = true;
    _notify();
    try {
      final page = await api.messages(conversationId, before: before);
      if (!_closed) thread = prependOlderPage(thread, page, before);
      return null;
    } on ApiException {
      return 'Could not load older messages. Please try again.';
    } finally {
      loadingOlder = false;
      _notify();
    }
  }

  void append(Message message) {
    if (messages.any((m) => m.id == message.id || (message.metaMessageId != null && m.metaMessageId == message.metaMessageId))) {
      return;
    }
    thread = thread.withMessages([...messages, message]);
    _notify();
  }

  void onNewMessage(Message message) {
    append(message);
    if (!message.isOutbound) {
      unawaited(api.markRead(conversationId).then<void>((_) {}, onError: (Object _) {}));
    }
  }

  void mergeMessage(Map<String, dynamic> fields) {
    final id = fields['id'];
    thread = thread.withMessages([for (final m in messages) m.id == id ? m.merged(fields) : m]);
    _notify();
  }

  void setStatus(String wamid, String status) {
    thread = thread.withMessages([
      for (final m in messages) m.metaMessageId == wamid ? m.merged({'status': status}) : m,
    ]);
    _notify();
  }

  void removeMessage(int id) {
    thread = thread.withMessages(messages.where((m) => m.id != id).toList());
    _notify();
  }

  void applyCleared(int? throughId) {
    // Anything newer than the clear stays, and nothing older is left to page in.
    thread = ThreadData(
      messages: throughId == null ? const [] : messages.where((m) => m.id > throughId).toList(),
      hasMore: false,
      before: thread.before,
    );
    _notify();
  }

  void markGone() {
    gone = true;
    _notify();
  }

  void _sent(Message message) {
    append(message);
    onSent?.call(message);
  }

  Future<void> sendText(String body, {int? replyTo}) async => _sent(await api.sendText(conversationId, body, replyTo: replyTo));

  Future<void> sendFile({
    required File file,
    required String filename,
    required String mime,
    String caption = '',
    int? replyTo,
    bool voice = false,
  }) async =>
      _sent(await api.sendMedia(conversationId, file: file, filename: filename, mime: mime, caption: caption, replyTo: replyTo, voice: voice));

  /// Locations, contact cards, buttons, lists, links, requests and templates.
  Future<void> compose(String kind, Map<String, Object?> input) async {
    final Message sent;
    switch (kind) {
      case 'location':
        sent = await api.sendLocation(conversationId, input);
      case 'contact':
        sent = await api.sendContact(conversationId, input);
      case 'template':
        sent = await api.sendTemplate(conversationId, input);
      default:
        sent = await api.sendInteractive(conversationId, {...input, 'kind': kind});
    }
    _sent(sent);
  }

  Future<void> react(Message message, String emoji) async => append(await api.react(conversationId, message.id, emoji));

  Future<void> setPinned(Message message, {required bool pinned}) async {
    final row = await (pinned ? api.pin(conversationId, message.id) : api.unpin(conversationId, message.id));
    mergeMessage(row.raw);
  }

  Future<void> setStarred(Message message, {required bool starred}) async {
    await (starred ? api.star(conversationId, message.id) : api.unstar(conversationId, message.id));
    mergeMessage({'id': message.id, 'starred': starred ? 1 : 0});
  }

  Future<void> deleteMessage(Message message) async {
    await api.deleteMessage(conversationId, message.id);
    removeMessage(message.id);
  }

  @override
  void dispose() {
    _closed = true;
    super.dispose();
  }
}
