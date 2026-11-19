import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/whatsapp/campaign_wizard_screen.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:dikho_crm/shared/platform_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// The native new-campaign wizard, end to end against a stand-in API. It records what
// would be sent; nothing reaches Meta. Synthetic contacts and templates only.

class FakeWizardApi {
  late HttpServer server;
  final sends = <Map<String, dynamic>>[];
  final paths = <String>[];

  /// When set, the start sends one person and hands the rest back for later batches.
  bool batches = false;

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final path = request.uri.path;
      paths.add('${request.method} $path');
      final response = request.response..headers.contentType = ContentType.json;
      Object? data;
      if (path == '/api/contacts') {
        data = {
          'contacts': [
            {
              'id': 1,
              'name': 'Asha Rao',
              'phone': '919800000001',
              'opted_out': 0,
              'attributes': {'city': 'Pune'},
            },
            {'id': 2, 'name': 'Bilal Khan', 'phone': '919800000002', 'opted_out': 0},
            {'id': 3, 'name': 'Opted Person', 'phone': '919800000003', 'opted_out': 1},
          ],
        };
      } else if (path == '/api/templates') {
        data = {
          'templates': [
            {
              'name': 'offer',
              'language': 'en',
              'category': 'MARKETING',
              'status': 'APPROVED',
              'headerText': '',
              'bodyText': 'Hi {{name}}, see you in {{1}}',
              'footerText': '',
            },
            {
              'name': 'video_offer',
              'language': 'en',
              'category': 'MARKETING',
              'status': 'APPROVED',
              'headerFormat': 'VIDEO',
              'headerText': '',
              'bodyText': 'Watch this',
              'footerText': '',
            },
          ],
        };
      } else if (path == '/api/campaigns/send') {
        final body = jsonDecode(await utf8.decoder.bind(request).join()) as Map<String, dynamic>;
        sends.add(body);
        final ids = body['contactIds'] as List;
        data = batches
            ? {'campaignId': 41, 'sent': 1, 'failed': 0, 'remaining': ids.skip(1).toList()}
            : {'campaignId': 41, 'sent': ids.length, 'failed': 0, 'remaining': []};
      }
      if (data == null) {
        response.statusCode = 404;
        response.write('{}');
      } else {
        response.write(jsonEncode({'success': true, 'data': data}));
      }
      await response.close();
    });
  }

  CrmApi get api => CrmApi(origin: Uri.parse('http://localhost:${server.port}'), token: ({bool forceFresh = false}) async => 't');
}

void main() {
  late FakeWizardApi backend;

  setUp(() async {
    HttpOverrides.global = null;
    backend = FakeWizardApi();
    await backend.start();
  });

  tearDown(() => backend.server.close(force: true));

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 12; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  void wizardTest(String description, Future<void> Function(WidgetTester tester) body) {
    testWidgets(description, (tester) async {
      HttpOverrides.global = null;
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.6;
      addTearDown(tester.view.reset);
      await body(tester);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(minutes: 5));
    });
  }

  Future<void> pumpWizard(WidgetTester tester, {Future<void> Function(Duration)? sleep}) async {
    await tester.pumpWidget(
      MaterialApp(
        home: CampaignWizardScreen(api: backend.api, platform: PlatformApi(), sleep: sleep ?? (_) async {}),
      ),
    );
    await settle(tester);
  }

  FilledButton continueButton(WidgetTester tester) =>
      tester.widget<FilledButton>(find.ancestor(of: find.text('Continue'), matching: find.byType(FilledButton)));

  Future<void> tapContinue(WidgetTester tester) async {
    await tester.tap(find.text('Continue'));
    await tester.pump();
  }

  Future<void> chooseEveryoneAndTemplate(WidgetTester tester, String template) async {
    await tester.tap(find.text('Select all'));
    await tester.pump();
    await tapContinue(tester);
    await tester.tap(find.text(template));
    await tester.pump();
    await tapContinue(tester);
  }

  wizardTest('opted-out people are not offered, and nothing goes on without someone chosen', (tester) async {
    await pumpWizard(tester);
    expect(find.text('Asha Rao'), findsOneWidget);
    expect(find.text('Opted Person'), findsNothing);
    expect(find.text('0 selected of 2'), findsOneWidget);
    expect(continueButton(tester).onPressed, isNull);
  });

  wizardTest('a full run: variables matched, the gap shown, asked before sending, the right request sent', (tester) async {
    await pumpWizard(tester);
    await chooseEveryoneAndTemplate(tester, 'offer');
    expect(find.text('Step 3 of 4: Details'), findsOneWidget);
    expect(continueButton(tester).onPressed, isNull, reason: 'no campaign name yet');
    await tester.enterText(find.widgetWithText(TextField, 'Campaign name'), 'Diwali');
    await tester.pump();
    // {{name}} took the Name field; {{1}} took the sheet's city column, which one person lacks.
    expect(find.text('Name'), findsWidgets);
    expect(find.text('From the sheet: city'), findsOneWidget);
    expect(find.textContaining('1 of 2 have no value here'), findsOneWidget);
    expect(find.text('Hi Asha Rao, see you in Pune'), findsOneWidget);
    await tapContinue(tester);

    expect(find.text('Send to 2 people'), findsOneWidget);
    await tester.tap(find.text('Send to 2 people'));
    await tester.pumpAndSettle();
    expect(find.text('Send to 2 people?'), findsOneWidget);
    expect(find.textContaining('Meta charges for them'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(backend.sends, isEmpty, reason: 'Cancel sends nothing');

    await tester.tap(find.text('Send to 2 people'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Send'));
    await settle(tester);
    expect(find.text('Sent'), findsOneWidget);

    final sent = backend.sends.single;
    expect(sent['name'], 'Diwali');
    expect((sent['contactIds'] as List).toSet(), {1, 2});
    expect(sent['templateName'], 'offer');
    expect(sent['requestId'], isA<String>());
    expect(sent['variableMap'], {
      'name': {'source': 'field', 'key': 'name'},
      '1': {'source': 'attribute', 'key': 'city'},
    });
  });

  wizardTest('a video header needs its file before the wizard goes on, and travels in the map', (tester) async {
    await pumpWizard(tester);
    await chooseEveryoneAndTemplate(tester, 'video_offer');
    await tester.enterText(find.widgetWithText(TextField, 'Campaign name'), 'Video');
    await tester.pump();
    expect(continueButton(tester).onPressed, isNull, reason: 'no header file yet');
    await tester.enterText(find.widgetWithText(TextField, 'Or a link or media ID'), 'http://example.com/v.mp4');
    await tester.pump();
    expect(find.text('Use an https link or a media ID.'), findsOneWidget);
    expect(continueButton(tester).onPressed, isNull);
    await tester.enterText(find.widgetWithText(TextField, 'Or a link or media ID'), 'https://example.com/v.mp4');
    await tester.pump();
    await tapContinue(tester);
    await tester.tap(find.text('Send to 2 people'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Send'));
    await settle(tester);
    expect(backend.sends.single['variableMap'], {
      '@header': {'source': 'media', 'value': 'https://example.com/v.mp4'},
    });
    expect(backend.sends.single['templateHeaderFormat'], 'VIDEO');
  });

  wizardTest('Back on a step goes back a step, not out of the wizard', (tester) async {
    await pumpWizard(tester);
    await chooseEveryoneAndTemplate(tester, 'offer');
    await tester.enterText(find.widgetWithText(TextField, 'Campaign name'), 'Slow');
    await tester.pump();
    await tapContinue(tester);
    final popped = await tester.binding.handlePopRoute();
    await tester.pump();
    expect(popped, isTrue);
    expect(find.text('Step 3 of 4: Details'), findsOneWidget);
  });

  wizardTest('Back while sending asks first; Stop leaves the rest unsent and resumable', (tester) async {
    backend.batches = true;
    final gate = Completer<void>();
    await pumpWizard(tester, sleep: (_) => gate.future);
    await chooseEveryoneAndTemplate(tester, 'offer');
    await tester.enterText(find.widgetWithText(TextField, 'Campaign name'), 'Paced');
    await tester.pump();
    await tapContinue(tester);
    await tester.tap(find.text('Send to 2 people'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Send'));
    await settle(tester);
    expect(find.text('Sending…'), findsOneWidget, reason: 'waiting between batches');

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Stop sending?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Stop'));
    await tester.pumpAndSettle();
    gate.complete();
    await settle(tester);
    expect(find.text('Stopped'), findsOneWidget);
    expect(find.text('Resume, 1 left'), findsOneWidget);
    expect(backend.paths.where((p) => p.contains('send-batch')), isEmpty, reason: 'nothing more was sent');
  });
}
