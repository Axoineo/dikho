import 'package:dikho_crm/features/inbox/inbox_format.dart';
import 'package:dikho_crm/features/inbox/inbox_models.dart';
import 'package:flutter_test/flutter_test.dart';

// The same cases as tests/inbox-thread-paging.test.js, so the browser's inbox and
// this one cannot drift apart on how a thread is put together. Synthetic data only.

String at(int minute) => DateTime.utc(2026, 10, 1, 9, minute).toIso8601String();

Message row(int id, int minute, {Map<String, dynamic> extra = const {}}) =>
    Message({'id': id, 'created_at': at(minute), 'direction': 'inbound', 'type': 'text', 'body': 'm$id', ...extra});

List<int> ids(ThreadData thread) => [for (final m in thread.messages) m.id];

void main() {
  group('paging', () {
    test('an older page goes in front and moves the cursor', () {
      final t1 = threadFromPage(ThreadPage(messages: [row(5, 5), row(6, 6)], hasMore: true));
      final t2 = prependOlderPage(t1, ThreadPage(messages: [row(3, 3), row(4, 4)], hasMore: true), 5);
      expect(ids(t2), [3, 4, 5, 6]);
      expect(t2.before, 3);
      final t3 = prependOlderPage(t2, ThreadPage(messages: [row(1, 1)], hasMore: false), 3);
      expect(ids(t3), [1, 3, 4, 5, 6]);
      expect(t3.hasMore, isFalse);
    });

    test('a late webhook row is placed by time once its page arrives, the server copy winning', () {
      final t0 = threadFromPage(ThreadPage(messages: [row(5, 5), row(6, 6)], hasMore: true));
      final t1 = t0.withMessages([
        ...t0.messages,
        row(9, 4, extra: {'status': 'stale'}),
      ]);
      final t2 = prependOlderPage(t1, ThreadPage(messages: [row(3, 3), row(9, 4)], hasMore: false), 5);
      expect(ids(t2), [3, 9, 5, 6]);
      expect(t2.messages[1].status, isNot('stale'));
    });

    test('an older page is dropped when the thread moved on while it was in flight', () {
      final t1 = threadFromPage(ThreadPage(messages: [row(7, 7)], hasMore: true));
      expect(identical(prependOlderPage(t1, ThreadPage(messages: [row(1, 1)], hasMore: false), 5), t1), isTrue);
    });

    test('rows with the same time are ordered by id across a page boundary', () {
      final t1 = threadFromPage(ThreadPage(messages: [row(4, 2), row(5, 2)], hasMore: true));
      final t2 = prependOlderPage(t1, ThreadPage(messages: [row(2, 2), row(3, 2)], hasMore: false), 4);
      expect(ids(t2), [2, 3, 4, 5]);
    });

    test('the refresh keeps older pages when the newest page joins onto them', () {
      var t = threadFromPage(ThreadPage(messages: [row(4, 4), row(5, 5), row(6, 6)], hasMore: true));
      t = prependOlderPage(t, ThreadPage(messages: [row(1, 1), row(2, 2), row(3, 3)], hasMore: false), 4);
      // Meanwhile 7 arrived, and 6 was deleted by another agent.
      final merged = mergeNewestPage(t, ThreadPage(messages: [row(5, 5), row(7, 7)], hasMore: true));
      expect(ids(merged), [1, 2, 3, 4, 5, 7]);
      expect(merged.before, 1);
    });

    test('the refresh replaces the thread when the page is all of it, or leaves a gap', () {
      var t = threadFromPage(ThreadPage(messages: [row(4, 4), row(5, 5)], hasMore: true));
      t = prependOlderPage(t, ThreadPage(messages: [row(1, 1)], hasMore: false), 4);
      expect(ids(mergeNewestPage(t, ThreadPage(messages: [row(8, 8)], hasMore: false))), [8]);
      final gap = mergeNewestPage(t, ThreadPage(messages: [row(20, 20), row(21, 21)], hasMore: true));
      expect(ids(gap), [20, 21]);
      expect(gap.before, 20);
    });

    test('an empty refresh of a cleared chat empties the thread', () {
      final t = threadFromPage(ThreadPage(messages: [row(4, 4)], hasMore: false));
      expect(mergeNewestPage(t, const ThreadPage(messages: [], hasMore: false)).messages, isEmpty);
    });
  });

  group('reactions', () {
    test('a reaction folds onto its message, the latest from each side winning', () {
      final target = row(2, 2, extra: {'meta_message_id': 'wamid.2'});
      final folded = foldReactions([
        target,
        row(3, 3, extra: {'type': 'reaction', 'body': '😮', 'context_wamid': 'wamid.2'}),
        row(4, 4, extra: {'type': 'reaction', 'body': '👍', 'context_wamid': 'wamid.2'}),
        row(5, 5, extra: {'type': 'reaction', 'body': '❤️', 'context_wamid': 'wamid.2', 'direction': 'outbound'}),
      ]);
      expect(folded.shown.map((m) => m.id), [2]);
      expect(folded.reactionsFor(target)?.customer, '👍');
      expect(folded.reactionsFor(target)?.business, '❤️');
    });

    test('a reaction whose message is not loaded shows nowhere', () {
      final folded = foldReactions([
        row(10, 10),
        row(11, 11, extra: {'type': 'reaction', 'body': '👍', 'context_wamid': 'wamid.2'}),
      ]);
      expect(folded.shown.map((m) => m.id), [10]);
    });

    test('an empty emoji takes the reaction off', () {
      final target = row(2, 2, extra: {'meta_message_id': 'wamid.2'});
      final folded = foldReactions([
        target,
        row(3, 3, extra: {'type': 'reaction', 'body': '👍', 'context_wamid': 'wamid.2'}),
        row(4, 4, extra: {'type': 'reaction', 'body': '', 'context_wamid': 'wamid.2'}),
      ]);
      expect(folded.reactionsFor(target)?.isEmpty, isTrue);
    });
  });

  group('rows', () {
    test('a day break gets a chip and starts a new run', () {
      final rows = buildThreadRows([
        Message({'id': 1, 'direction': 'inbound', 'type': 'text', 'wa_timestamp': DateTime(2026, 10, 1, 10).toUtc().toIso8601String()}),
        Message({'id': 2, 'direction': 'inbound', 'type': 'text', 'wa_timestamp': DateTime(2026, 10, 1, 11).toUtc().toIso8601String()}),
        Message({'id': 3, 'direction': 'outbound', 'type': 'text', 'wa_timestamp': DateTime(2026, 10, 1, 12).toUtc().toIso8601String()}),
        Message({'id': 4, 'direction': 'outbound', 'type': 'text', 'wa_timestamp': DateTime(2026, 10, 2, 12).toUtc().toIso8601String()}),
      ]);
      expect(rows.whereType<DayRow>().length, 2);
      final runs = [for (final r in rows.whereType<MessageRow>()) r.startsRun];
      expect(runs, [true, false, true, true]);
    });
  });

  group('messages', () {
    test('a payload that is not JSON is simply no payload', () {
      expect(Message({'id': 1, 'payload': '{not json'}).payload, isNull);
      expect(Message({'id': 1, 'payload': '[1,2]'}).payload, isNull);
      expect(Message({'id': 1, 'payload': '{"kind":"voice"}'}).isVoice, isTrue);
    });

    test('what can be reacted to and forwarded', () {
      final now = DateTime.utc(2026, 11, 6);
      Message m(Map<String, dynamic> f) => Message({'id': 1, 'type': 'text', 'meta_message_id': 'w', 'created_at': now.toIso8601String(), ...f});
      expect(m({}).canReact(now: now), isTrue);
      expect(m({'meta_message_id': null}).canReact(now: now), isFalse);
      expect(m({'created_at': now.subtract(const Duration(days: 31)).toIso8601String()}).canReact(now: now), isFalse);
      expect(m({'body': 'hi'}).canForward, isTrue);
      expect(m({'body': '  '}).canForward, isFalse);
      expect(m({'type': 'image', 'media_status': 'ready', 'media_url': '/x'}).canForward, isTrue);
      expect(m({'type': 'image', 'media_status': 'failed'}).canForward, isFalse);
      expect(m({'type': 'reaction'}).canForward, isFalse);
    });

    test('list previews read as people expect', () {
      expect(decodePreview('📎 image').text, 'Photo');
      expect(decodePreview('📎 image').kind, 'image');
      expect(decodePreview('[interactive]').text, 'Tapped a button');
      expect(decodePreview('[order]').text, 'Order message');
      expect(decodePreview('Hello').text, 'Hello');
      expect(decodePreview(null).text, '');
    });

    test('a stored placeholder is described, never printed', () {
      expect(placeholderLabel('[interactive]'), 'Tapped a button');
      expect(placeholderLabel('[something new]'), 'Sent a something new message');
      expect(placeholderLabel('Hello [there]'), isNull);
    });
  });

  group('formatting', () {
    final now = DateTime(2026, 11, 6, 15);
    test('list times', () {
      expect(formatListTime(DateTime(2026, 11, 6, 9, 5).toUtc().toIso8601String(), now: now), '09:05 AM');
      expect(formatListTime(DateTime(2026, 11, 5, 9).toUtc().toIso8601String(), now: now), 'Yesterday');
      expect(formatListTime(DateTime(2026, 11, 3, 9).toUtc().toIso8601String(), now: now), 'Tuesday');
      expect(formatListTime(DateTime(2026, 9, 3, 9).toUtc().toIso8601String(), now: now), '03 Sep 26');
    });

    test('both timestamp shapes D1 holds are understood, the bare one as UTC', () {
      expect(parseWaDate('2026-11-06 09:30:00'), DateTime.utc(2026, 11, 6, 9, 30).toLocal());
      expect(parseWaDate('2026-11-06T09:30:00.000Z'), DateTime.utc(2026, 11, 6, 9, 30).toLocal());
      expect(parseWaDate(''), isNull);
      expect(parseWaDate('nonsense'), isNull);
    });

    test('the 24-hour window', () {
      final inbound = DateTime.utc(2026, 11, 6, 9).toIso8601String();
      expect(sessionLeft(inbound, now: DateTime.utc(2026, 11, 6, 10)), const Duration(hours: 23));
      expect(sessionLeft(inbound, now: DateTime.utc(2026, 11, 7, 10)), Duration.zero);
      expect(sessionLeft(null), Duration.zero);
      expect(formatCountdown(const Duration(hours: 23, minutes: 54)), '23h 54m');
    });

    test('initials', () {
      expect(initialsOf('Asha Rao Mehta', null), 'AR');
      expect(initialsOf('', '919800000012'), '12');
      expect(initialsOf('😀 Happy', null), '😀H');
    });
  });
}
