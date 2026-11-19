import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/whatsapp/campaign_sender.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:flutter_test/flutter_test.dart';

// The campaign send loop against a stand-in for POST /api/campaigns/send and
// /send-batch (src/api/routes/campaigns/index.js). It sends to nobody: the fake keeps
// a ledger, claiming each person once per campaign as the real API does, so a repeat
// that would message someone twice shows up as a duplicate here.

class FakeSendApi {
  late HttpServer server;
  final requests = <Map<String, dynamic>>[];
  final paths = <String>[];
  final campaigns = <String, int>{}; // requestId -> campaign id
  final claimed = <int, Set<int>>{}; // campaign -> people claimed, as claimRecipients does
  final messaged = <int, int>{}; // person -> messages they got

  /// People who got the same campaign press twice.
  int get duplicates => messaged.values.fold(0, (sum, n) => sum + (n > 1 ? n - 1 : 0));
  int batchSize = 3;
  bool supportsRequestId = true;

  /// The next request with this path fails: 'drop' after doing the work (reply lost),
  /// 'refuse' with a 400 before doing anything, 'halt' with Meta's stop.
  final failNext = <String, String>{};

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final body = jsonDecode(await utf8.decoder.bind(request).join()) as Map<String, dynamic>;
      final path = request.uri.path;
      paths.add(path);
      requests.add(body);
      final failure = failNext.remove(path);
      final response = request.response..headers.contentType = ContentType.json;
      if (failure == 'refuse') {
        response.statusCode = 400;
        response.write(jsonEncode({'success': false, 'error': {'message': 'Invalid template'}}));
        return response.close();
      }
      int campaignId;
      if (path == '/api/campaigns/send') {
        final key = body['requestId'] as String?;
        if (supportsRequestId && key != null && campaigns.containsKey(key)) {
          campaignId = campaigns[key]!;
        } else {
          campaignId = 100 + campaigns.length + claimed.length;
          if (key != null) campaigns[key] = campaignId;
        }
      } else {
        campaignId = body['campaignId'] as int;
      }
      final ids = [for (final id in body['contactIds'] as List) id as int];
      final batch = ids.take(batchSize).toList();
      final rest = ids.skip(batchSize).toList();
      final seen = claimed.putIfAbsent(campaignId, () => <int>{});
      var sent = 0;
      if (failure == 'halt') {
        response.write(jsonEncode({'success': true, 'data': {'campaignId': campaignId, 'sent': 0, 'failed': 0, 'notSent': ids, 'halted': {'code': '131048', 'resumable': false, 'reason': 'Spam limit'}}}));
        return response.close();
      }
      for (final id in batch) {
        // Claimed already in this campaign: the API skips them.
        if (seen.add(id)) {
          sent += 1;
          messaged[id] = (messaged[id] ?? 0) + 1;
        }
      }
      if (failure == 'drop') {
        // The work is done, but the reply never arrives.
        await request.response.detachSocket().then((socket) => socket.destroy());
        return;
      }
      response.write(jsonEncode({'success': true, 'data': {'campaignId': campaignId, 'sent': sent, 'failed': 0, 'remaining': rest}}));
      await response.close();
    });
  }

  CrmApi get api => CrmApi(origin: Uri.parse('http://localhost:${server.port}'), token: ({bool forceFresh = false}) async => 't');
}

void main() {
  late FakeSendApi backend;
  var clock = DateTime.utc(2026, 11, 9, 6);
  final slept = <Duration>[];

  setUp(() async {
    backend = FakeSendApi();
    await backend.start();
    clock = DateTime.utc(2026, 11, 9, 6);
    slept.clear();
  });

  tearDown(() => backend.server.close(force: true));

  CampaignSender sender({List<int>? ids, SendPace pace = SendPace.fast, void Function(Duration)? onSleep}) => CampaignSender(
    api: backend.api,
    name: 'Diwali',
    contactIds: ids ?? [1, 2, 3, 4, 5, 6, 7],
    shared: {'templateName': 'offer', 'templateLanguage': 'en', 'variableMap': <String, Object?>{}},
    pace: pace,
    sleep: (d) async {
      slept.add(d);
      clock = clock.add(d);
      onSleep?.call(d);
    },
    now: () => clock,
  );

  test('a request id is made once per send, in the form the API accepts', () {
    final id = newRequestId();
    expect(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').hasMatch(id), isTrue);
    expect(newRequestId(), isNot(id));
  });

  test('sends everyone in batches, each person once, with the request id on the start only', () async {
    final s = sender();
    await s.start();
    expect(s.state, SendState.done);
    expect((s.sent, s.failed, s.total, s.campaignId), (7, 0, 7, 100));
    expect(backend.paths, ['/api/campaigns/send', '/api/campaigns/send-batch', '/api/campaigns/send-batch']);
    expect(backend.requests.first['requestId'], s.requestId);
    expect(backend.requests.first['name'], 'Diwali');
    expect(backend.requests.first['templateName'], 'offer');
    expect(backend.requests[1].containsKey('requestId'), isFalse);
    expect(backend.duplicates, 0);
  });

  test('pauses between batches at the chosen pace, a second at a time', () async {
    final s = sender(pace: SendPace.steady);
    await s.start();
    expect(s.state, SendState.done);
    final total = slept.fold<Duration>(Duration.zero, (sum, d) => sum + d);
    expect(total, const Duration(seconds: 60), reason: 'two pauses of 30 seconds');
    expect(slept.every((d) => d <= const Duration(seconds: 1)), isTrue);
  });

  test('Stop takes effect during a pause; Resume sends only to those left', () async {
    late CampaignSender s;
    s = sender(pace: SendPace.steady, onSleep: (_) {
      if (slept.length == 5) s.stop();
    });
    await s.start();
    expect(s.state, SendState.stopped);
    expect(s.remaining, [4, 5, 6, 7]);
    expect(s.canResume, isTrue);
    await s.resume();
    expect(s.state, SendState.done);
    expect(s.sent, 7);
    expect(backend.duplicates, 0);
    expect(backend.paths.where((p) => p == '/api/campaigns/send').length, 1, reason: 'resuming never starts a new campaign');
  });

  test('a lost start is never repeated by itself; Try again reuses the id and creates nothing twice', () async {
    backend.failNext['/api/campaigns/send'] = 'drop';
    final s = sender();
    await s.start();
    expect(s.state, SendState.failed);
    expect(s.startUnconfirmed, isTrue);
    expect(s.canResume, isTrue);
    expect(backend.paths, ['/api/campaigns/send'], reason: 'no automatic retry');

    await s.resume();
    expect(s.state, SendState.done);
    expect(backend.requests.where((r) => r.containsKey('requestId')).map((r) => r['requestId']).toSet(), {s.requestId});
    expect(backend.campaigns.length, 1, reason: 'one campaign, not two');
    expect(backend.duplicates, 0, reason: 'the first batch was claimed by the lost attempt');
    expect(s.campaignId, 100);
  });

  test('why the server fix must be live before the app: an old API would start it twice', () async {
    backend.supportsRequestId = false;
    backend.failNext['/api/campaigns/send'] = 'drop';
    final s = sender();
    await s.start();
    await s.resume();
    expect(backend.claimed.length, 2, reason: 'without the request-id guard, Try again makes a second campaign');
    expect(backend.duplicates, 3, reason: 'and messages the first batch again');
  });

  test('a refused start is final: nothing to try again', () async {
    backend.failNext['/api/campaigns/send'] = 'refuse';
    final s = sender();
    await s.start();
    expect(s.state, SendState.failed);
    expect(s.startUnconfirmed, isFalse);
    expect(s.canResume, isFalse);
    expect(s.error, 'Invalid template');
  });

  test('a batch lost mid-way resumes from the people left, never twice to anyone', () async {
    backend.failNext['/api/campaigns/send-batch'] = 'drop';
    final s = sender();
    await s.start();
    expect(s.state, SendState.failed);
    expect(s.startUnconfirmed, isFalse);
    expect(s.remaining, [4, 5, 6, 7]);
    await s.resume();
    expect(s.state, SendState.done);
    expect(backend.duplicates, 0, reason: 'the re-sent batch was claimed already, so the API skips it');
  });

  test("Meta's stop halts the campaign, and a block that needs a person cannot be resumed", () async {
    backend.failNext['/api/campaigns/send-batch'] = 'halt';
    final s = sender();
    await s.start();
    expect(s.state, SendState.halted);
    expect(s.halt?.reason, 'Spam limit');
    expect(s.remaining, [4, 5, 6, 7]);
    expect(s.canResume, isFalse);
  });

  test('estimates read like the web wizard', () {
    expect(SendPace.fast.estimate(40), 'about a minute');
    expect(SendPace.steady.estimate(400), 'about 5 minutes');
  });
}
