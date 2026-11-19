import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/whatsapp/campaign_screen.dart';
import 'package:dikho_crm/features/whatsapp/campaigns_screen.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:dikho_crm/shared/platform_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Native WhatsApp Campaigns against GET /api/campaigns (src/api/routes/campaigns/index.js).
// Synthetic campaigns only; nothing here can send.

class FakeCampaignsApi {
  late HttpServer server;
  final asked = <Uri>[];
  bool sending = false;
  bool empty = false;
  int failWith = 0;

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      asked.add(request.uri);
      final response = request.response..headers.contentType = ContentType.json;
      if (failWith != 0) {
        response.statusCode = failWith;
        response.write(jsonEncode({'success': false, 'error': {'message': 'Not allowed'}}));
      } else if (request.uri.path == '/api/campaigns' && request.method == 'GET') {
        response.write(jsonEncode({
          'success': true,
          'data': {
            'campaigns': empty
                ? []
                : [
                    {'id': 12, 'name': 'Diwali offers', 'template_name': 'diwali_offer', 'status': sending ? 'sending' : 'completed', 'total_count': 1200, 'sent_count': 1180, 'failed_count': 30, 'created_at': '2026-11-03 04:30:00'},
                    {'id': 11, 'name': 'Welcome', 'template_name': 'welcome', 'status': 'completed', 'total_count': 90, 'sent_count': 90, 'failed_count': 0, 'created_at': '2026-11-01 04:30:00'},
                  ],
          },
        }));
      } else if (request.uri.path == '/api/whatsapp/analytics/campaigns/12') {
        response.write(jsonEncode({
          'success': true,
          'data': {
            'campaign': {'id': 12, 'name': 'Diwali offers', 'template': 'diwali_offer', 'status': 'completed', 'audience': 1200, 'createdAt': '2026-11-03 04:30:00'},
            'totals': {'sent': 1180, 'delivered': 1000, 'read': 600, 'failed': 30, 'awaiting': 20, 'notSent': 20, 'replied': 90, 'optedOut': 3},
            'failures': [],
            'timeline': [],
            'replyWindowDays': 7,
          },
        }));
      } else {
        response.statusCode = request.method == 'GET' ? 404 : 405;
        response.write('{}');
      }
      await response.close();
    });
  }

  CrmApi get api => CrmApi(origin: Uri.parse('http://localhost:${server.port}'), token: ({bool forceFresh = false}) async => 't');
}

void main() {
  test('a campaign row reads as the web list shows it', () {
    final row = CampaignRow.from({'id': 3, 'name': ' ', 'template_name': 'x', 'status': 'stopped', 'total_count': 50, 'sent_count': 20, 'created_at': '2026-11-01 04:30:00'});
    expect(row.name, 'Campaign');
    expect(row.outstanding, 30);
    expect(row.createdAt, DateTime.utc(2026, 11, 1, 4, 30));
    expect(CampaignRow.from({'total_count': 5, 'sent_count': 9}).outstanding, 0, reason: 'never negative');
  });

  group('screen', () {
    late FakeCampaignsApi backend;

    setUp(() async {
      HttpOverrides.global = null;
      backend = FakeCampaignsApi();
      await backend.start();
    });

    tearDown(() => backend.server.close(force: true));

    Future<void> settle(WidgetTester tester) async {
      for (var i = 0; i < 15; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
        await tester.pump(const Duration(milliseconds: 50));
      }
    }

    void screenTest(String description, Future<void> Function(WidgetTester tester) body) {
      testWidgets(description, (tester) async {
        HttpOverrides.global = null;
        await body(tester);
        await tester.pumpWidget(const SizedBox());
        await tester.pump(const Duration(minutes: 5));
      });
    }

    Future<List<String>> pump(WidgetTester tester, {bool canSend = true}) async {
      final opened = <String>[];
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.6;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: CampaignsScreen(
            api: backend.api,
            platform: PlatformApi(),
            canSend: canSend,
            onOpenDrawer: () {},
            onNewCampaign: () => opened.add('new'),
            onOpenWebPage: opened.add,
            refreshWhileSending: const Duration(seconds: 2),
          ),
        ),
      );
      await settle(tester);
      return opened;
    }

    screenTest('the list shows each campaign, its status and who has not received it', (tester) async {
      await pump(tester);
      expect(find.text('Diwali offers'), findsOneWidget);
      expect(find.text('Completed'), findsNWidgets(2));
      expect(find.text('1,180 of 1,200 sent, 20 not received'), findsOneWidget);
      expect(find.text('90 of 90 sent'), findsOneWidget);
    });

    screenTest('New campaign opens the wizard, and only for someone who may send', (tester) async {
      final opened = await pump(tester);
      await tester.tap(find.text('New campaign'));
      expect(opened, ['new']);
    });

    screenTest('no New campaign without permission to send', (tester) async {
      await pump(tester, canSend: false);
      expect(find.text('New campaign'), findsNothing);
    });

    screenTest('a campaign that is sending shows progress and refreshes; a finished list does not', (tester) async {
      backend.sending = true;
      await pump(tester);
      expect(find.text('Sending'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      expect(find.text('1,180 of 1,200 sent'), findsOneWidget, reason: 'nobody counts as not received while it is still sending');
      final first = backend.asked.length;
      await tester.pump(const Duration(seconds: 3));
      await settle(tester);
      expect(backend.asked.length, greaterThan(first), reason: 'asked again while sending');

      backend.sending = false;
      await tester.pump(const Duration(seconds: 3));
      await settle(tester);
      final settled = backend.asked.length;
      await tester.pump(const Duration(seconds: 10));
      await settle(tester);
      expect(backend.asked.length, settled, reason: 'no more asking once nothing is sending');
    });

    screenTest('tapping a campaign opens its own performance', (tester) async {
      await pump(tester);
      await tester.tap(find.text('Diwali offers'));
      await settle(tester);
      expect(find.byType(CampaignScreen), findsOneWidget);
      expect(backend.asked.any((uri) => uri.path == '/api/whatsapp/analytics/campaigns/12'), isTrue);
    });

    screenTest('nothing yet, and a refusal, are said plainly', (tester) async {
      backend.empty = true;
      await pump(tester);
      expect(find.text('No campaigns yet'), findsOneWidget);
      backend.failWith = 403;
      await tester.pumpWidget(const SizedBox());
      await pump(tester);
      expect(find.text("Couldn't load campaigns"), findsOneWidget);
    });
  });
}
