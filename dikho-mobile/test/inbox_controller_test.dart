
import 'package:dikho_crm/features/inbox/inbox_api.dart';
import 'package:dikho_crm/features/inbox/inbox_controller.dart';
import 'package:dikho_crm/features/inbox/inbox_models.dart';
import 'package:dikho_crm/features/inbox/thread_controller.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:flutter_test/flutter_test.dart';

Conversation chat(int id, {int minute = 0, int unread = 0, String? name}) => Conversation({
  'id': id,
  'phone': '91980000$id',
  'wa_name': name ?? 'Chat $id',
  'unread_count': unread,
  'last_message_at': DateTime.utc(2026, 11, 6, 9, minute).toIso8601String(),
});

/// Pages from memory, recording what was asked for.
class FakeApi implements InboxApi {
  List<Conversation> rows = [];
  final calls = <String>[];
  int unread = 0;
  Object? failWith;
  int reads = 0;
  ThreadPage thread = const ThreadPage(messages: [], hasMore: false);

  @override
  Future<ConversationPage> conversations({String? cursor, String query = '', bool unreadOnly = false}) async {
    calls.add('list cursor=$cursor q=$query unread=$unreadOnly');
    final failure = failWith;
    if (failure != null) throw failure as Exception;
    final matching = rows.where((c) => query.isEmpty || c.displayName.toLowerCase().contains(query.toLowerCase())).where((c) => !unreadOnly || c.unreadCount > 0).toList();
    final start = cursor == null ? 0 : matching.indexWhere((c) => c.id == int.parse(cursor)) + 1;
    final page = matching.skip(start).take(InboxApi.listPageSize).toList();
    final more = start + page.length < matching.length;
    return ConversationPage(conversations: page, nextCursor: more ? '${page.last.id}' : null, unreadTotal: cursor == null ? unread : null);
  }

  @override
  Future<void> markRead(int id) async => reads++;

  @override
  Future<ThreadPage> messages(int id, {int? before}) async {
    calls.add('thread $id before=$before');
    return thread;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Message msg(int id, {bool out = false, int minute = 0}) => Message({
  'id': id,
  'direction': out ? 'outbound' : 'inbound',
  'type': 'text',
  'body': 'm$id',
  'meta_message_id': 'w$id',
  'created_at': DateTime.utc(2026, 11, 6, 9, minute).toIso8601String(),
});

void main() {
  late FakeApi api;
  late InboxController inbox;

  setUp(() {
    api = FakeApi()..rows = [for (var i = 100; i > 0; i--) chat(i, minute: 0)];
    inbox = InboxController(api: api, searchDelay: const Duration(milliseconds: 20));
  });

  tearDown(() => inbox.dispose());

  test('loads one page, then the next as asked', () async {
    await inbox.reload();
    expect(inbox.conversations.length, 30);
    expect(inbox.nextCursor, isNotNull);
    await inbox.loadMore();
    expect(inbox.conversations.length, 60);
    expect(inbox.conversations.map((c) => c.id).toSet().length, 60, reason: 'no duplicates');
    await inbox.loadMore();
    await inbox.loadMore();
    expect(inbox.conversations.length, 100);
    expect(inbox.nextCursor, isNull);
    final before = api.calls.length;
    await inbox.loadMore();
    expect(api.calls.length, before, reason: 'nothing more to ask for');
  });

  test('a failed load shows the error, and is not an empty inbox', () async {
    api.failWith = const ApiException('The server said no');
    await inbox.reload();
    expect(inbox.error, 'The server said no');
    expect(inbox.conversations, isEmpty);
    api.failWith = null;
    await inbox.reload();
    expect(inbox.error, isNull);
    expect(inbox.conversations, isNotEmpty);
  });

  test('search waits for typing to stop, and only the last term goes out', () async {
    await inbox.reload();
    api.calls.clear();
    inbox.setQuery('c');
    inbox.setQuery('ch');
    inbox.setQuery('chat 7');
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(api.calls, ['list cursor=null q=chat 7 unread=false']);
    expect(inbox.conversations.every((c) => c.displayName.contains('Chat 7')), isTrue);
  });

  test('an older reply never overwrites a newer search', () async {
    final slow = _SlowApi(api);
    final controller = InboxController(api: slow);
    final first = controller.reload();
    controller.query = 'chat 5';
    final second = controller.reload();
    slow.release();
    await Future.wait([first, second]);
    expect(controller.conversations.first.displayName, contains('Chat 5'));
    controller.dispose();
  });

  test('a failed search does not leave the old rows looking like its result', () async {
    api.rows = [chat(1), chat(2)];
    await inbox.reload();
    expect(inbox.conversations, hasLength(2));
    api.failWith = const ApiException('No connection');
    inbox.setQuery('someone');
    await Future<void>.delayed(const Duration(milliseconds: 80));
    expect(inbox.conversations, isEmpty);
    expect(inbox.error, 'No connection');
  });

  test('a refresh keeps the rows already paged in', () async {
    await inbox.reload();
    await inbox.loadMore();
    api.rows = [chat(999, minute: 59, name: 'Newest'), ...api.rows];
    await inbox.refresh();
    expect(inbox.conversations.first.id, 999);
    expect(inbox.conversations.length, 61, reason: 'one new, none lost');
  });

  test('a failed refresh changes nothing', () async {
    await inbox.reload();
    final held = inbox.conversations;
    api.failWith = const ApiException('offline');
    await inbox.refresh();
    expect(identical(inbox.conversations, held), isTrue);
    expect(inbox.error, isNull);
  });

  group('realtime', () {
    setUp(() async {
      await inbox.reload();
    });

    Map<String, dynamic> newMessage(int chatId, {int unread = 1, bool out = false}) => {
      'conversation': chat(chatId, minute: 59, unread: unread).raw,
      'message': msg(500, out: out).raw,
    };

    test('a new message moves the chat to the top and counts as unread', () {
      inbox.unreadTotal = 0;
      inbox.onRealtimeEvent('message:new', newMessage(50));
      expect(inbox.conversations.first.id, 50);
      expect(inbox.unreadTotal, 1);
    });

    test('a chat not yet paged in appears', () {
      inbox.onRealtimeEvent('message:new', newMessage(777));
      expect(inbox.conversations.first.id, 777);
    });

    test('under a search, an arrival updates a row but does not add one', () {
      inbox.query = 'something';
      inbox.onRealtimeEvent('message:new', newMessage(777));
      expect(inbox.conversations.any((c) => c.id == 777), isFalse);
    });

    test('the open chat stays read and gets the message', () async {
      final thread = ThreadController(api: api, conversation: chat(50));
      inbox.activeThread = thread;
      inbox.unreadTotal = 0;
      inbox.onRealtimeEvent('message:new', newMessage(50));
      expect(inbox.conversations.first.unreadCount, 0);
      expect(inbox.unreadTotal, 0);
      expect(thread.messages.single.id, 500);
      expect(api.reads, 1, reason: 'marks it read as it arrives');
      thread.dispose();
    });

    test('delete, block, clear and hide all land', () async {
      final thread = ThreadController(api: api, conversation: chat(50));
      inbox.activeThread = thread;
      thread.append(msg(1));
      thread.append(msg(2));
      inbox.onRealtimeEvent('message:hidden', {'id': 1});
      expect(thread.messages.map((m) => m.id), [2]);
      inbox.onRealtimeEvent('conversation:blocked', {'id': 50, 'blocked_at': '2026-11-06T10:00:00Z'});
      expect(thread.conversation.isBlocked, isTrue);
      inbox.onRealtimeEvent('conversation:cleared', {'conversation': {...chat(50).raw, 'cleared_through_id': 5}});
      expect(thread.messages, isEmpty);
      inbox.onRealtimeEvent('conversation:deleted', {'id': 50});
      expect(inbox.conversations.any((c) => c.id == 50), isFalse);
      expect(thread.gone, isTrue);
      thread.dispose();
    });

    test('a status update reaches the right message', () {
      final thread = ThreadController(api: api, conversation: chat(50));
      inbox.activeThread = thread;
      thread.append(msg(1));
      inbox.onRealtimeEvent('status:update', {'messageId': 'w1', 'status': 'read'});
      expect(thread.messages.single.status, 'read');
      thread.dispose();
    });

    test('malformed events do nothing', () {
      final before = inbox.conversations;
      inbox.onRealtimeEvent('message:new', {'conversation': 5});
      inbox.onRealtimeEvent('conversation:deleted', {'id': 'x'});
      inbox.onRealtimeEvent('unknown', {});
      expect(inbox.conversations.length, before.length);
    });
  });

  group('one thread', () {
    test('a reply for a closed chat is dropped', () async {
      final slow = _SlowApi(api);
      final thread = ThreadController(api: slow, conversation: chat(1));
      final opening = thread.open();
      thread.dispose();
      slow.release();
      await opening;
    });

    test('the same message twice appears once', () {
      final thread = ThreadController(api: api, conversation: chat(1));
      thread.append(msg(1));
      thread.append(msg(1));
      thread.append(Message({...msg(9).raw, 'meta_message_id': 'w1'}));
      expect(thread.messages.length, 1);
      thread.dispose();
    });

    test('only one older page is asked for at a time', () async {
      api.thread = ThreadPage(messages: [msg(5)], hasMore: true);
      final thread = ThreadController(api: api, conversation: chat(1));
      await thread.open();
      api.calls.clear();
      await Future.wait([thread.loadOlder(), thread.loadOlder(), thread.loadOlder()]);
      expect(api.calls.length, 1);
      thread.dispose();
    });
  });

}

class _SlowApi implements InboxApi {
  _SlowApi(this.inner);

  final FakeApi inner;
  final _gate = <Future<void>>[];
  final _release = <void Function()>[];

  void release() {
    for (final open in _release) {
      open();
    }
    _release.clear();
  }

  Future<void> _wait() {
    final future = Future<void>(() {});
    _gate.add(future);
    return future;
  }

  @override
  Future<ConversationPage> conversations({String? cursor, String query = '', bool unreadOnly = false}) async {
    await _wait();
    return inner.conversations(cursor: cursor, query: query, unreadOnly: unreadOnly);
  }

  @override
  Future<void> markRead(int id) async {}

  @override
  Future<ThreadPage> messages(int id, {int? before}) async {
    await _wait();
    return inner.messages(id, before: before);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
