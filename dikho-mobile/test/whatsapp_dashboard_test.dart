import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/whatsapp/analytics_models.dart';
import 'package:dikho_crm/features/whatsapp/campaign_screen.dart';
import 'package:dikho_crm/features/whatsapp/dashboard_screen.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// The native WhatsApp dashboard and campaign screen against the API's answer
// shapes (src/api/services/whatsapp/analytics.js). Synthetic figures only.

Map<String, dynamic> analyticsBody({int days = 30, bool metaDown = false}) => {
  'range': {'days': days, 'from': '2026-10-11', 'to': '2026-11-09', 'previousFrom': '2026-09-11', 'utcOffsetMinutes': 330},
  'totals': {'sent': 1000, 'delivered': 900, 'read': 450, 'failed': 40, 'awaiting': 10, 'inbound': 300, 'campaign': 800, 'replies': 150, 'automatic': 50},
  'previous': {'sent': 800, 'delivered': 760, 'read': 400, 'failed': 20, 'inbound': 300},
  'daily': [
    for (var i = 0; i < days; i++)
      {'day': '2026-11-${(i % 9 + 1).toString().padLeft(2, '0')}', 'sent': i * 3, 'delivered': i * 2, 'read': i, 'failed': 0, 'inbound': i, 'campaign': 0, 'replies': 0, 'automatic': 0},
  ],
  'failures': [
    {'code': '131049', 'count': 30, 'reason': 'Held back by Meta to protect engagement (marketing limit per person)'},
    {'code': null, 'count': 10, 'reason': 'Error without a code'},
  ],
  'templates': [
    {
      'name': 'diwali_offer', 'sent': 800, 'delivered': 720, 'read': 360, 'failed': 30, 'quality': 'YELLOW', 'status': 'APPROVED',
      'replyTaps': [
        {'label': 'Interested', 'count': 40},
      ],
      'replyTapTotal': 40,
      'links': metaDown
          ? []
          : [
              {'label': 'View catalogue', 'count': 25},
            ],
      'linkTaps': metaDown ? null : 25,
      'cost': metaDown ? null : 600.0,
    },
  ],
  'templateInsights': metaDown ? {'available': false, 'reason': 'Meta answered 400.'} : {'available': true},
  'templateHealth': metaDown ? null : {'GREEN': 2, 'YELLOW': 1, 'RED': 0, 'UNKNOWN': 0, 'paused': 1},
  'campaigns': [
    {'id': 12, 'name': 'Diwali offers', 'template': 'diwali_offer', 'status': 'completed', 'audience': 900, 'createdAt': '2026-11-03 04:30:00', 'sent': 880, 'delivered': 800, 'read': 400, 'failed': 30},
  ],
  'audience': {'contacts': 5000, 'optedOut': 50, 'added': 120},
  'inbox': {'open': 40, 'unread': 6},
  'account': metaDown ? null : {'phone': '+91 00000 00000', 'verifiedName': 'Example', 'nameStatus': 'APPROVED', 'quality': 'GREEN', 'throughput': 'STANDARD', 'messagingLimit': 'TIER_2K'},
  'spend': metaDown
      ? null
      : {
          'currency': 'INR',
          'total': 785.5,
          'volume': 1000,
          'byCategory': [
            {'category': 'MARKETING', 'volume': 1000, 'cost': 785.5},
          ],
          'daily': [
            {'day': '2026-11-03', 'cost': 785.5},
          ],
        },
  'metaErrors': metaDown ? ['Spend: The WhatsApp access token has expired or was revoked.'] : <String>[],
  'computedAt': '2026-11-09T06:00:00.000Z',
};

final campaignBody = {
  'campaign': {'id': 12, 'name': 'Diwali offers', 'template': 'diwali_offer', 'language': 'en', 'status': 'completed', 'audience': 900, 'createdAt': '2026-11-03 04:30:00'},
  'totals': {'sent': 880, 'delivered': 800, 'read': 400, 'failed': 30, 'awaiting': 50, 'notSent': 20, 'replied': 96, 'optedOut': 4},
  'failures': [
    {'code': '131026', 'count': 30, 'reason': 'Not on WhatsApp, or cannot receive this message'},
  ],
  'timeline': [
    {'hour': 0, 'delivered': 500, 'read': 100},
    {'hour': 1, 'delivered': 200, 'read': 150},
    {'hour': 2, 'delivered': 100, 'read': 150},
  ],
  'replyWindowDays': 7,
  'taps': {
    'replies': [
      {'label': 'Interested', 'count': 12, 'people': 11},
    ],
    'replyTotal': 12,
    'links': null,
    'linkTotal': null,
    'insights': {'available': false, 'reason': null},
  },
};

class FakeApi {
  late HttpServer server;
  final asked = <Uri>[];
  bool metaDown = false;
  int failWith = 0;

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      asked.add(request.uri);
      final response = request.response..headers.contentType = ContentType.json;
      if (failWith != 0) {
        response.statusCode = failWith;
        response.write(jsonEncode({'success': false, 'error': {'message': 'Not allowed'}}));
      } else if (request.uri.path == '/api/whatsapp/analytics') {
        response.write(jsonEncode({'success': true, 'data': analyticsBody(days: int.parse(request.uri.queryParameters['days'] ?? '30'), metaDown: metaDown)}));
      } else if (request.uri.path == '/api/whatsapp/analytics/campaigns/12') {
        response.write(jsonEncode({'success': true, 'data': campaignBody}));
      } else {
        response.statusCode = 404;
        response.write('{}');
      }
      await response.close();
    });
  }

  CrmApi get api => CrmApi(origin: Uri.parse('http://localhost:${server.port}'), token: ({bool forceFresh = false}) async => 't');
}

void main() {
  group('figures', () {
    test('rates and percentages never divide by zero or round to a false 100%', () {
      expect(rate(5, 0), isNull);
      expect(formatPercent(rate(5, 0)), '—');
      expect(formatPercent(rate(92, 100)), '92%');
      expect(formatPercent(rate(996, 1000)), '99.6%');
      expect(formatPercent(rate(3, 1000)), '0.3%');
      expect(formatPercent(100), '100%');
    });

    test('changes: counts in percent, rates in points, and which way is good', () {
      final up = change(120, 100)!;
      expect((up.text, up.tone, up.up), ('20%', ChangeTone.good, true));
      final worse = change(12, 10, higherIsBetter: false)!;
      expect(worse.tone, ChangeTone.bad);
      final points = change(90.5, 92, isRate: true)!;
      expect((points.text, points.tone), ('1.5 pts', ChangeTone.bad));
      expect(change(5, 0)!.text, 'New this period');
      expect(change(null, 3), isNull);
    });

    test('days, stamps, money and Meta codes in words', () {
      expect(shortDay('2026-11-01'), '1 Nov');
      expect(longDay('2026-11-01'), 'Sun, 1 Nov');
      expect(parseStamp('2026-11-01 04:30:00'), DateTime.utc(2026, 11, 1, 4, 30));
      expect(parseStamp('2026-11-01T04:30:00.000Z'), DateTime.utc(2026, 11, 1, 4, 30));
      expect(parseStamp('nonsense'), isNull);
      expect(formatMoney(123456.5, 'INR'), '₹1,23,456.50');
      expect(formatMoney(1000, 'INR', paise: false), '₹1,000');
      expect(formatMoney(12, 'USD', style: 'en-US'), r'$12.00');
      expect(messagingLimitLabel('TIER_1K'), '1,000 people a day');
      expect(messagingLimitLabel('TIER_UNLIMITED'), 'Unlimited');
      expect(qualityOf('green').label, 'High');
      expect(qualityOf(null).label, 'Not rated yet');
    });

    test('a campaign timeline as running totals, and when half had arrived', () {
      final result = cumulative(const [HourFigures(0, 60, 10), HourFigures(1, 30, 20), HourFigures(2, 10, 40)]);
      expect(result.points.last.delivered, 100);
      expect(result.halfDelivered, 0);
      expect(result.halfRead, 2);
      expect(hoursPhrase(2), 'within 3 hours');
      expect(hoursPhrase(72), 'after three days or more');
    });

    test('scales match the web: round tops, whole numbers for counts', () {
      expect(chartScale(0).ticks, [0, 1, 2, 3, 4]);
      expect(chartScale(7).top, 8);
      expect(chartScale(950).ticks, [0, 250, 500, 750, 1000]);
      expect(chartScale(0.9, integer: false).top, 1);
    });

    test('taps parse, and a template without insights has no link count', () {
      final t = TemplateFigures.from({'name': 'a', 'replyTaps': [{'label': 'Yes', 'count': 3}], 'replyTapTotal': 3, 'linkTaps': null});
      expect(t.taps, 3);
      expect(t.linkTaps, isNull);
      expect(t.replyTaps.single.template, 'a');
      final c = CampaignPerformance.from({'taps': {'replies': [{'label': 'Yes', 'count': 2, 'people': 2}], 'links': [], 'insights': {'available': true}}});
      expect(c.replyTaps.single.people, 2);
      expect(c.linkTaps, isEmpty);
      expect(c.insights.available, isTrue);
      expect(CampaignPerformance.from({}).linkTaps, isNull);
    });

    test('a malformed answer reads as zeros, not a crash', () {
      final a = Analytics.from({'totals': 'nope', 'daily': [1, 'x', null], 'spend': 3});
      expect(a.totals.sent, 0);
      expect(a.daily, isEmpty);
      expect(a.spend, isNull);
    });
  });

  group('screens', () {
    late FakeApi backend;

    setUp(() async {
      backend = FakeApi();
      await backend.start();
    });

    tearDown(() => backend.server.close(force: true));

    // The request runs on the real clock, animations on the test's own.
    Future<void> settle(WidgetTester tester) async {
      for (var i = 0; i < 20; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
        await tester.pump(const Duration(milliseconds: 50));
      }
    }

    // A request's own timeout timer outlives the test unless the clock runs past it.
    Future<void> finish(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(minutes: 5));
    }

    void screenTest(String description, Future<void> Function(WidgetTester tester) body) {
      testWidgets(description, (tester) async {
        await body(tester);
        await finish(tester);
      });
    }

    Future<List<String>> pumpDashboard(WidgetTester tester, {bool canSend = true}) async {
      final opened = <String>[];
      // Widget tests answer every real HTTP request with 400; this one talks to the
      // fake API on localhost.
      HttpOverrides.global = null;
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.6;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: DashboardScreen(
            api: backend.api,
            onOpenDrawer: () {},
            onOpenWebPage: opened.add,
            onNewCampaign: () => opened.add('new campaign'),
            onOpenInbox: () => opened.add('inbox'),
            canSend: canSend,
          ),
        ),
      );
      await settle(tester);
      return opened;
    }

    screenTest('the dashboard shows the figures, the change against before, and Meta health', (tester) async {
      await pumpDashboard(tester);
      expect(find.text('1,000'), findsWidgets);
      expect(find.text('90%'), findsOneWidget, reason: 'delivered of sent');
      expect(find.text('50%'), findsOneWidget, reason: 'read of delivered');
      expect(find.textContaining('25%'), findsWidgets, reason: 'sent up 25% on the previous period');
      expect(find.text('₹785.50'), findsOneWidget);
      expect(backend.asked.single.queryParameters['days'], '30');
      await tester.scrollUntilVisible(find.text('Account health'), 400, scrollable: find.byType(Scrollable).first);
      await tester.scrollUntilVisible(find.text('2,000 people a day'), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text('2,000 people a day'), findsOneWidget);
    });

    screenTest('button taps: quick replies from our records and link taps from Meta', (tester) async {
      await pumpDashboard(tester);
      await tester.scrollUntilVisible(find.text('Button taps'), 400, scrollable: find.byType(Scrollable).first);
      await tester.scrollUntilVisible(find.textContaining('View catalogue'), 200, scrollable: find.byType(Scrollable).first);
      expect(find.textContaining('Interested'), findsOneWidget);
      expect(find.textContaining('View catalogue'), findsOneWidget);
      expect(find.textContaining('65 taps'), findsOneWidget, reason: '40 quick replies and 25 link taps on the template');
    });

    screenTest('insights off: the Links part is hidden, quick replies still show', (tester) async {
      backend.metaDown = true;
      await pumpDashboard(tester);
      await tester.scrollUntilVisible(find.text('Counted from the answers in your own records.'), 400, scrollable: find.byType(Scrollable).first);
      expect(find.textContaining('Interested'), findsOneWidget);
      expect(find.text('Links'), findsNothing);
      expect(find.textContaining('template insights'), findsNothing);
    });

    screenTest('picking 7 days asks again for 7 days', (tester) async {
      await pumpDashboard(tester);
      await tester.tap(find.text('7 days'));
      await settle(tester);
      expect(backend.asked.last.queryParameters['days'], '7');
    });

    screenTest('New campaign opens the CRM page, and only for someone who may send', (tester) async {
      final opened = await pumpDashboard(tester);
      await tester.tap(find.text('New campaign'));
      expect(opened, ['new campaign']);
    });

    screenTest('no New campaign without permission to send', (tester) async {
      await pumpDashboard(tester, canSend: false);
      expect(find.text('New campaign'), findsNothing);
    });

    screenTest('Meta missing: says so, and the rest still shows', (tester) async {
      backend.metaDown = true;
      await pumpDashboard(tester);
      expect(find.textContaining('Some figures from Meta are missing'), findsOneWidget);
      expect(find.text('Not available from Meta'), findsOneWidget);
      expect(find.text('90%'), findsOneWidget);
    });

    screenTest('a refused request says why and offers to try again', (tester) async {
      backend.failWith = 403;
      await pumpDashboard(tester);
      expect(find.text("Couldn't load the dashboard"), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });

    screenTest('tapping a campaign opens its own performance', (tester) async {
      await pumpDashboard(tester);
      await tester.scrollUntilVisible(find.text('Diwali offers'), 300, scrollable: find.byType(Scrollable).first);
      await tester.ensureVisible(find.text('Diwali offers'));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.tap(find.text('Diwali offers'));
      await settle(tester);
      expect(find.byType(CampaignScreen), findsOneWidget);
      expect(backend.asked.last.path, '/api/whatsapp/analytics/campaigns/12');
      expect(find.text('96'), findsOneWidget, reason: 'replied');
      expect(find.textContaining('12% of delivered'), findsWidgets, reason: 'replies measured against delivered');
      expect(find.textContaining('20 not sent yet'), findsOneWidget);
      await tester.scrollUntilVisible(find.textContaining('by 11 people', findRichText: true), 400, scrollable: find.byType(Scrollable).first);
      expect(find.text('Links (this template)'), findsNothing, reason: 'insights did not answer for this campaign');
    });

    screenTest('a chart can be read as a table', (tester) async {
      await pumpDashboard(tester);
      await tester.tap(find.text('Table').first);
      await tester.pump();
      expect(find.byType(DataTable), findsOneWidget);
      expect(find.text('Received'), findsWidgets);
    });

    screenTest('touching the chart shows that day', (tester) async {
      await pumpDashboard(tester);
      final chart = find.byType(CustomPaint).at(1);
      await tester.tapAt(tester.getCenter(chart));
      await tester.pump();
      expect(find.textContaining('Nov'), findsWidgets);
      expect(find.text('Sent'), findsWidgets);
    });
  });
}
