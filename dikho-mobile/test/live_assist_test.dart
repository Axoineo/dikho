import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dikho_crm/features/live_assist/assist_api.dart';
import 'package:dikho_crm/features/live_assist/assist_link.dart';
import 'package:dikho_crm/features/live_assist/assist_protocol.dart';
import 'package:dikho_crm/features/live_assist/assist_widgets.dart';
import 'package:dikho_crm/features/live_assist/helper_viewer_screen.dart';
import 'package:dikho_crm/features/live_assist/live_assist_controller.dart';
import 'package:dikho_crm/features/live_assist/screen_frames.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart' show MediaStream;

// Native Live Assist against a stand-in for the API Worker's /api/assist routes and a
// stand-in for the device-to-device link. Synthetic people and text only.

const me = '00000000-0000-4000-8000-000000000001';
const asha = '00000000-0000-4000-8000-000000000002';
String future([int seconds = 60]) => DateTime.now().add(Duration(seconds: seconds)).toUtc().toIso8601String();

class FakeApi {
  late HttpServer server;
  final log = <String>[];
  final bodies = <String, Object?>{};
  Map<String, Object?> state = {};
  Map<String, Object?> respond = {};
  List<Map<String, Object?>> helpers = [];
  int helpersNotified = 3;

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final raw = await utf8.decoder.bind(request).join();
      final key = '${request.method} ${request.uri.path}';
      log.add(key);
      bodies[key] = raw.isEmpty ? null : jsonDecode(raw);
      final path = request.uri.path;
      Object? data;
      if (key == 'GET /api/assist/state') {
        data = state;
      } else if (key == 'POST /api/assist/sessions') {
        data = {
          'id': 's-help',
          'status': 'requested',
          'helper_id': me,
          'helper_name': 'Mira Admin',
          'employee_id': asha,
          'employee_name': 'Asha Rao',
          'expires_at': future(),
        };
      } else if (path.endsWith('/respond')) {
        data = respond;
      } else if (path.endsWith('/end')) {
        data = {'id': path.split('/')[4], 'status': 'ended'};
      } else if (key == 'GET /api/assist/helpers') {
        data = helpers;
      } else if (key == 'POST /api/assist/help') {
        data = {'request_id': 'r1', 'already_open': false, 'expires_at': future(900), 'helper_name': null, 'helpers_notified': helpersNotified};
      } else if (path.endsWith('/cancel')) {
        data = {'cancelled': true};
      }
      request.response
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({'success': true, 'data': data}));
      await request.response.close();
    });
  }

  AssistApi get api => AssistApi(CrmApi(origin: Uri.parse('http://localhost:${server.port}'), token: ({bool forceFresh = false}) async => 't'));
}

class FakeLink implements AssistLink {
  FakeLink({required this.sessionId, required this.sharer, required this.onData, required this.onState, this.onVideo, this.onFrame});

  final String sessionId;
  final bool sharer;
  final void Function(Object? message) onData;
  final void Function(LinkState state) onState;
  final void Function(MediaStream stream)? onVideo;
  final void Function(Uint8List picture)? onFrame;
  final sent = <Map<String, Object?>>[];
  final frames = <Uint8List>[];
  bool open = true;
  bool closed = false;

  @override
  void send(AssistMessage message) => sent.add(message.toJson());

  @override
  Future<bool> sendFrame(Uint8List picture) async {
    if (!open) return false;
    frames.add(picture);
    return true;
  }

  @override
  Future<void> close() async => closed = true;
}

/// A real, tiny PNG (1 by 1), as the app's pictures are.
final tinyPng = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');

void main() {
  late FakeApi backend;
  late List<FakeLink> links;

  setUp(() async {
    HttpOverrides.global = null;
    backend = FakeApi();
    await backend.start();
    links = [];
  });

  tearDown(() => backend.server.close(force: true));

  LiveAssistController controller({bool canHelp = true, Future<Uint8List?> Function()? capture}) =>
      LiveAssistController(
          api: backend.api,
          userId: me,
          canHelp: canHelp,
          capture: capture,
          frameEvery: const Duration(milliseconds: 20),
          makeLink: ({required sessionId, required sharer, required onData, required onState, onVideo, onFrame}) {
            final link = FakeLink(sessionId: sessionId, sharer: sharer, onData: onData, onState: onState, onVideo: onVideo, onFrame: onFrame);
            links.add(link);
            return link;
          },
        )
        ..sectionNow = (() => 'sales-orders')
        ..pageLabel = ((path) => path == '/sales-orders' ? 'Sales orders' : null);

  group('the web module\'s rules', () {
    test('text is plain, bounded and tidy', () {
      expect(cleanText('  Tap\u0000 the\t\tSave   button \u0007', 100), 'Tap the Save button');
      expect(cleanText('a\n\n\n\nb', 100), 'a\n\nb');
      expect(cleanText('x' * 900, maxChat).length, maxChat);
      expect(cleanText(42, 100), '');
    });

    test('each side accepts only well-formed messages from the other', () {
      final id = 'abcdef0001';
      expect(readHelperMessage({'t': 'chat', 'id': id, 'text': 'Hello'}), isA<ChatText>());
      expect(readHelperMessage({'t': 'chat', 'id': 'BAD ID', 'text': 'Hello'}), isNull);
      expect(readHelperMessage({'t': 'note', 'id': id, 'text': 'Here', 'x': 0.5, 'y': 0.2, 'n': 1}), isA<NotePin>());
      expect(readHelperMessage({'t': 'note', 'id': id, 'text': 'Here', 'x': 1.5, 'y': 0.2, 'n': 1}), isNull, reason: 'off the screen');
      expect(readHelperMessage({'t': 'pointer', 'x': 0.1, 'y': 0.9}), isA<PointerAt>());
      expect(readHelperMessage({'t': 'goto', 'path': 'https://evil.example'}), isNull, reason: 'an address, not a page');
      expect(readHelperMessage({'t': 'goto', 'path': '/sales-orders'}), isA<GoTo>());
      expect(readHelperMessage({'t': 'note_done', 'id': id}), isNull, reason: 'the employee sends that, not the helper');
      expect(readEmployeeMessage({'t': 'note_done', 'id': id, 'how': 'anything'}), isA<NoteDone>().having((m) => m.how, 'how', 'dismissed'));
      expect(readEmployeeMessage({'t': 'section', 'section': 'sales-orders'}), isA<SectionIs>());
      expect(readEmployeeMessage({'t': 'section', 'section': '<script>'}), isNull);
      expect(readEmployeeMessage({'t': 'pointer', 'x': 0.1, 'y': 0.1}), isNull);
    });

    test('a note is pinned when short enough, else it goes as chat', () {
      expect(helperMessage('Tap Save', const Spot(0.2, 0.3), 4), isA<NotePin>().having((m) => m.n, 'n', 4));
      expect(helperMessage('x' * 200, const Spot(0.2, 0.3), 1), isA<ChatText>());
      expect(helperMessage('   ', null, 1), isNull);
    });

    test('the chat keeps at most five notes, and changing screen clears them', () {
      final chat = AssistChat();
      final now = DateTime(2026, 11, 17);
      for (var n = 1; n <= 6; n++) {
        chat.receive(NotePin(id: 'abcdef000$n', n: n, text: 'Note $n', x: 0.1, y: 0.1), now);
      }
      expect(chat.notes.map((n) => n.n), [2, 3, 4, 5, 6]);
      expect(chat.messages.first.status, 'removed');
      chat.clearNotes();
      expect(chat.notes, isEmpty);
      expect(chat.messages.every((m) => m.status != 'pinned'), isTrue);
      chat.receive(const ChatText('abcdef9999', 'Hello'), now);
      expect((chat.unread, chat.peek?.text), (1, 'Hello'));
      chat.setOpen(true);
      expect((chat.unread, chat.peek), (0, null));
    });

    test('a picture travels in chunks and comes together in any order; a newer one drops an older', () {
      final picture = Uint8List.fromList(List.generate(40000, (i) => i % 251));
      final chunks = FrameChunks.split(7, picture);
      expect(chunks.length, 3);
      expect(chunks.every((c) => c.length <= FrameChunks.chunkBytes + 8), isTrue);
      final together = FrameChunks();
      expect(together.add(chunks[2]), isNull);
      expect(together.add(chunks[0]), isNull);
      expect(together.add(chunks[1]), picture);
      final older = FrameChunks.split(8, picture);
      expect(together.add(older[0]), isNull);
      expect(together.add(FrameChunks.split(9, tinyPng).single), tinyPng);
      expect(together.add(older[1]), isNull, reason: 'the unfinished one was dropped');
      expect(fingerprint(picture), fingerprint(Uint8List.fromList(picture)));
    });

    test('a touch becomes a spot on their screen, inside the letterboxed picture only', () {
      final picture = containRect(const Size(400, 400), const Size(100, 200));
      expect(picture, const Rect.fromLTWH(100, 0, 200, 400));
      expect(spotIn(picture, const Offset(200, 100)), const Spot(0.5, 0.25));
      expect(spotIn(picture, const Offset(50, 100)), isNull, reason: 'on the black bar');
      expect(pngSize(tinyPng), const Size(1, 1));
      expect(pngSize(Uint8List.fromList([1, 2, 3])), isNull);
      expect(suggestiblePages().map((p) => p.$1), isNot(contains('/settings')));
    });
  });

  group('being helped', () {
    test('a restart closes a session left open, and shows a request still waiting', () async {
      backend.state = {
        'incoming': {'id': 's1', 'status': 'requested', 'helper_name': 'Mira Admin', 'employee_id': me, 'expires_at': future()},
        'sessions': [
          {'id': 's0', 'status': 'active'},
        ],
      };
      final c = controller();
      await c.start();
      expect(c.incoming?.id, 's1');
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(backend.log, contains('POST /api/assist/sessions/s0/end'));
      expect(backend.bodies['POST /api/assist/sessions/s0/end'], {'reason': 'connection_lost'});
      c.dispose();
    });

    test('accepting shares the screen; the helper points, highlights, pins and suggests', () async {
      final c = controller();
      c.handleStaffEvent('assist_request', {
        'id': 's1',
        'status': 'requested',
        'helper_name': 'Mira Admin',
        'employee_id': me,
        'expires_at': future(),
      });
      expect(c.incoming?.helperName, 'Mira Admin');
      c.handleStaffEvent('assist_request', {'id': 's2', 'employee_id': 'someone-else'});
      expect(c.incoming?.id, 's1', reason: 'only a request for this person');
      backend.respond = {'id': 's1', 'status': 'active', 'helper_name': 'Mira Admin', 'employee_id': me};
      expect(await c.accept(), isNull);
      expect(backend.bodies['POST /api/assist/sessions/s1/respond'], {'accept': true});
      final link = links.single;
      expect(link.sharer, isTrue);
      expect(c.sharing?.id, 's1');
      expect(c.sharingLive, isFalse);
      link.onState(LinkState.connected);
      expect(c.sharingLive, isTrue);
      expect(link.sent, [
        {'t': 'section', 'section': 'sales-orders'},
      ]);

      link.onData({'t': 'pointer', 'x': 0.5, 'y': 0.5});
      expect(c.pointer, const Spot(0.5, 0.5));
      link.onData({'t': 'highlight', 'x': 0.2, 'y': 0.3});
      expect(c.highlight, const Spot(0.2, 0.3));
      link.onData({'t': 'goto', 'path': '/sales-orders'});
      expect(c.suggestion?.label, 'Sales orders');
      c.dismissSuggestion();
      link.onData({'t': 'goto', 'path': '/not-a-page'});
      expect(c.suggestion, isNull, reason: 'only a page Dikho has');
      link.onData({'t': 'note', 'id': 'abcdef0001', 'text': 'Tap here', 'x': 0.4, 'y': 0.6, 'n': 1});
      expect(c.employeeChat.notes.single.text, 'Tap here');
      c.noteDone('abcdef0001', 'clicked');
      expect(link.sent.last, {'t': 'note_done', 'id': 'abcdef0001', 'how': 'clicked'});

      link.onData({'t': 'note', 'id': 'abcdef0002', 'text': 'And here', 'x': 0.4, 'y': 0.6, 'n': 2});
      c.screenChanged('native:clients');
      expect(c.employeeChat.notes, isEmpty, reason: 'the spots meant the old screen');
      expect(link.sent.last, {'t': 'notes_cleared'});
      expect(link.sent.where((m) => m['t'] == 'section').length, 1, reason: 'an unchanged section is not sent twice');

      c.employeeSend('OK');
      expect(link.sent.last['t'], 'chat');
      await c.stopSharing();
      expect(link.closed, isTrue);
      expect(c.sharing, isNull);
      expect(backend.log, contains('POST /api/assist/sessions/s1/end'));
      c.dispose();
    });

    test('pictures of the screen: sent once open, an unchanged screen not again at once, none in the background', () async {
      var picture = Uint8List.fromList([1, 2, 3]);
      final c = controller(capture: () async => picture);
      c.handleStaffEvent('assist_request', {'id': 's1', 'employee_id': me, 'expires_at': future()});
      backend.respond = {'id': 's1', 'status': 'active', 'employee_id': me};
      await c.accept();
      final link = links.single;
      await Future<void>.delayed(const Duration(milliseconds: 80));
      expect(link.frames, isEmpty, reason: 'not before the connection is up');
      link.onState(LinkState.connected);
      await Future<void>.delayed(const Duration(milliseconds: 120));
      expect(link.frames.length, 1, reason: 'the same screen is not sent again at once');
      picture = Uint8List.fromList([4, 5, 6]);
      await Future<void>.delayed(const Duration(milliseconds: 80));
      expect(link.frames.length, 2);
      c.setForeground(false);
      picture = Uint8List.fromList([7, 8, 9]);
      await Future<void>.delayed(const Duration(milliseconds: 80));
      expect(link.frames.length, 2, reason: 'nothing is taken in the background');
      await c.stopSharing();
      c.dispose();
    });

    test('a lost connection ends it on both sides, and the helper ending it says so', () async {
      final c = controller();
      final notices = <String>[];
      c.notices.listen(notices.add);
      c.handleStaffEvent('assist_request', {'id': 's1', 'employee_id': me, 'expires_at': future()});
      backend.respond = {'id': 's1', 'status': 'active', 'employee_id': me};
      await c.accept();
      links.single.onState(LinkState.failed);
      expect(c.sharing, isNull);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(backend.bodies['POST /api/assist/sessions/s1/end'], {'reason': 'connection_lost'});

      c.handleStaffEvent('assist_request', {'id': 's2', 'employee_id': me, 'expires_at': future()});
      backend.respond = {'id': 's2', 'status': 'active', 'employee_id': me};
      await c.accept();
      c.handleStaffEvent('assist_ended', {'id': 's2', 'end_reason': 'helper_ended', 'helper_name': 'Mira Admin'});
      expect(c.sharing, isNull);
      await Future<void>.delayed(Duration.zero);
      expect(notices, ['Live Assist ended: the connection was lost.', 'Mira Admin ended Live Assist.']);
      c.dispose();
    });

    test('Not now declines; a request that was already answered says why', () async {
      final c = controller();
      final notices = <String>[];
      c.notices.listen(notices.add);
      c.handleStaffEvent('assist_request', {'id': 's1', 'employee_id': me, 'expires_at': future()});
      await c.decline();
      expect(c.incoming, isNull);
      expect(backend.bodies['POST /api/assist/sessions/s1/respond'], {'accept': false});
      c.handleStaffEvent('assist_request', {'id': 's3', 'employee_id': me, 'expires_at': future()});
      backend.respond = {'id': 's3', 'status': 'ended', 'end_reason': 'expired'};
      await c.accept();
      expect(c.sharing, isNull);
      expect(links, isEmpty);
      await Future<void>.delayed(Duration.zero);
      expect(notices, ['They did not answer in time.']);
      c.dispose();
    });
  });

  group('helping', () {
    test('a session from start to end: waiting, accepted, live with their pictures, ended', () async {
      final c = controller();
      expect(await c.startAssist(asha, 'Asha Rao'), isTrue);
      expect(backend.bodies['POST /api/assist/sessions'], {'employee_id': asha, 'help_request_id': null});
      expect(c.helper?.phase, 'waiting');
      final link = links.single;
      expect(link.sharer, isFalse);
      c.handleStaffEvent('assist_response', {'id': 's-help', 'status': 'active'});
      expect(c.helper?.phase, 'connecting');
      link.onState(LinkState.connected);
      expect(c.helper?.live, isTrue);
      link.onFrame!(tinyPng);
      expect(c.helper?.fromPhone, isTrue);
      link.onData({'t': 'section', 'section': 'clients'});
      expect(c.helper?.section, 'clients');
      c.helperSend('Tap Save', pin: const Spot(0.3, 0.4));
      expect(link.sent.last, containsPair('t', 'note'));
      c.pointTo(const Spot(0.1, 0.2));
      c.pointTo(null);
      expect(link.sent.sublist(link.sent.length - 2), [
        {'t': 'pointer', 'x': 0.1, 'y': 0.2},
        {'t': 'pointer_hide'},
      ]);
      expect(await c.startAssist(asha, 'Asha Rao'), isFalse, reason: 'one session at a time');
      await c.endHelper();
      expect((c.helper?.phase, c.helper?.reason), ('ended', 'helper_ended'));
      expect(backend.log, contains('POST /api/assist/sessions/s-help/end'));
      c.closeViewer();
      expect(c.helper, isNull);
      c.dispose();
    });

    test('a declined request ends with the reason; help requests come and go', () async {
      final c = controller();
      c.handleStaffEvent('help_request', {'id': 'r1', 'requester_id': asha, 'requester_name': 'Asha Rao', 'section': 'clients'});
      expect(c.openRequests.single.requesterName, 'Asha Rao');
      expect(c.helpRequestFor(asha)?.id, 'r1');
      await c.startAssist(asha, 'Asha Rao', helpRequestId: 'r1');
      expect(c.helpRequests, isEmpty, reason: 'claimed');
      c.handleStaffEvent('assist_response', {'id': 's-help', 'status': 'ended', 'end_reason': 'declined'});
      expect((c.helper?.phase, c.helper?.reason), ('ended', 'declined'));
      c.closeViewer();
      c.handleStaffEvent('help_request', {'id': 'r2', 'requester_id': asha, 'requester_name': 'Asha Rao'});
      c.dismissRequest('r2');
      expect(c.openRequests, isEmpty);
      c.handleStaffEvent('help_closed', {'request_id': 'r2'});
      expect(c.helpRequests, isEmpty);
      c.dispose();
    });

    test('without live_assist.use there are no help requests', () {
      final c = controller(canHelp: false);
      c.handleStaffEvent('help_request', {'id': 'r1', 'requester_id': asha, 'requester_name': 'Asha Rao'});
      expect(c.helpRequests, isEmpty);
      c.dispose();
    });
  });

  group('asking for help', () {
    test('asks with the section; nobody to ask cancels it and says so', () async {
      final c = controller();
      final notices = <String>[];
      c.notices.listen(notices.add);
      await c.askForHelp('Cannot find Save');
      expect(backend.bodies['POST /api/assist/help'], {'message': 'Cannot find Save', 'section': 'sales-orders', 'helper_id': null});
      expect(c.myHelp?.id, 'r1');
      await c.cancelHelp();
      expect(c.myHelp, isNull);
      backend.helpersNotified = 0;
      await c.askForHelp('');
      expect(c.myHelp, isNull);
      expect(backend.log.where((l) => l == 'POST /api/assist/help/r1/cancel').length, 2);
      await Future<void>.delayed(Duration.zero);
      expect(notices.first, 'Help is on the way. You will get a request to share your screen.');
      expect(notices.last, startsWith('Nobody can take Live Assist requests'));
      c.dispose();
    });
  });

  group('screens', () {
    Future<void> settle(WidgetTester tester) async {
      for (var i = 0; i < 8; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
        await tester.pump(const Duration(milliseconds: 50));
      }
    }

    void phone(WidgetTester tester) {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.6;
      addTearDown(tester.view.reset);
    }

    testWidgets('while sharing: the banner with Stop, the pointer and a note with Done', (tester) async {
      phone(tester);
      final c = controller();
      final host = ValueNotifier<LiveAssistController?>(c);
      final navigator = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: navigator,
          builder: (context, child) => AssistLayer(host: host, captureKey: GlobalKey(), navigatorKey: navigator, child: child!),
          home: const Scaffold(body: Center(child: Text('Sales orders'))),
        ),
      );
      c.handleStaffEvent('assist_request', {'id': 's1', 'employee_id': me, 'helper_name': 'Mira Admin', 'expires_at': future()});
      backend.respond = {'id': 's1', 'status': 'active', 'employee_id': me, 'helper_name': 'Mira Admin'};
      await tester.runAsync(c.accept);
      await tester.pump();
      expect(find.text('Connecting to Mira…'), findsOneWidget);
      links.single.onState(LinkState.connected);
      links.single.onData({'t': 'pointer', 'x': 0.5, 'y': 0.5});
      links.single.onData({'t': 'note', 'id': 'abcdef0001', 'text': 'Tap here', 'x': 0.4, 'y': 0.3, 'n': 1});
      links.single.onData({'t': 'chat', 'id': 'abcdef0002', 'text': 'Hello Asha'});
      await tester.pump();
      expect(find.text('Mira Admin is viewing your screen'), findsOneWidget);
      // Reachable by a screen reader too, above the route's barrier.
      expect(find.bySemanticsLabel(RegExp('is viewing your screen')), findsOneWidget);
      expect(find.bySemanticsLabel('Stop'), findsOneWidget);
      expect(find.text('Mira'), findsOneWidget, reason: 'the pointer carries their name');
      expect(find.text('Tap here'), findsOneWidget);
      expect(find.text('Mira: Hello Asha'), findsOneWidget, reason: 'the newest message, until answered');
      expect(find.text('Sales orders'), findsOneWidget, reason: 'the app is still there underneath');
      await tester.tap(find.widgetWithText(TextButton, 'Done'));
      await tester.pump();
      expect(links.single.sent.last, {'t': 'note_done', 'id': 'abcdef0001', 'how': 'clicked'});
      await tester.tap(find.widgetWithText(OutlinedButton, 'OK'));
      await tester.pump();
      expect(links.single.sent.last['text'], 'OK');
      await tester.tap(find.text('Stop'));
      await settle(tester);
      expect(find.text('Mira Admin is viewing your screen'), findsNothing);
      expect(backend.log, contains('POST /api/assist/sessions/s1/end'));
      await tester.pumpWidget(const SizedBox());
      c.dispose();
      // The HTTP client's idle connections close on a timer.
      await tester.pump(const Duration(minutes: 1));
    });

    testWidgets('the request: who wants to help, what they will see, and Share my screen', (tester) async {
      phone(tester);
      final c = controller();
      c.handleStaffEvent('assist_request', {'id': 's1', 'employee_id': me, 'helper_name': 'Mira Admin', 'expires_at': future()});
      backend.respond = {'id': 's1', 'status': 'active', 'employee_id': me, 'helper_name': 'Mira Admin'};
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: IncomingDialog(c: c, session: c.incoming!),
          ),
        ),
      );
      expect(find.text('Mira Admin wants to help you'), findsOneWidget);
      expect(find.textContaining('nothing else: not your notifications or other apps'), findsOneWidget);
      expect(find.textContaining('This request closes in'), findsOneWidget);
      await tester.tap(find.text('Share my screen'));
      await settle(tester);
      expect(backend.bodies['POST /api/assist/sessions/s1/respond'], {'accept': true});
      expect(c.sharing?.id, 's1');
      await tester.runAsync(c.stopSharing);
      await tester.pumpWidget(const SizedBox());
      c.dispose();
      // The HTTP client's idle connections close on a timer.
      await tester.pump(const Duration(minutes: 1));
    });

    testWidgets('the viewer: their picture, a tap highlights and pins the next message there', (tester) async {
      phone(tester);
      final c = controller();
      await tester.runAsync(() => c.startAssist(asha, 'Asha Rao'));
      final link = links.single;
      c.handleStaffEvent('assist_response', {'id': 's-help', 'status': 'active'});
      link.onState(LinkState.connected);
      link.onFrame!(tinyPng);
      await tester.pumpWidget(MaterialApp(home: HelperViewerScreen(c: c)));
      await settle(tester);
      expect(find.text('Live Assist with Asha Rao'), findsOneWidget);
      expect(find.bySemanticsLabel("Asha's screen"), findsOneWidget);
      final stage = tester.getRect(find.byType(Image));
      await tester.tapAt(stage.center);
      await tester.pump();
      final highlight = link.sent.lastWhere((m) => m['t'] == 'highlight');
      expect(highlight['x'], closeTo(0.5, 0.01));
      expect(highlight['y'], closeTo(0.5, 0.01));
      expect(find.text('Your next message is pinned beside the spot you tapped.'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'Tap Save');
      await tester.tap(find.byTooltip('Send'));
      await tester.pump();
      expect(link.sent.last, containsPair('t', 'note'));
      expect(link.sent.last['text'], 'Tap Save');
      await tester.pumpWidget(const SizedBox());
      c.dispose();
      // The HTTP client's idle connections close on a timer.
      await tester.pump(const Duration(minutes: 1));
    });
  });
}
