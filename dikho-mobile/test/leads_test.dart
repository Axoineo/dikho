import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/leads/leads_controller.dart';
import 'package:dikho_crm/features/leads/leads_models.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:dikho_crm/shared/record_ui.dart' show formatDisplayDate;
import 'package:dikho_crm/shared/supabase_rest.dart';
import 'package:flutter_test/flutter_test.dart';

/// A stand-in for PostgREST and the API on localhost, recording what was asked.
class FakeBackend {
  late HttpServer server;
  final requests = <HttpRequest>[];
  final headers = <Map<String, String>>[];
  int leadCount = 60;
  int failNextWith = 0;
  String? expiredToken;

  Uri get url => Uri.parse('http://localhost:${server.port}');

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      requests.add(request);
      headers.add({
        for (final name in ['apikey', 'authorization', 'range', 'prefer']) name: request.headers.value(name) ?? '',
      });
      final response = request.response;
      if (failNextWith != 0) {
        response.statusCode = failNextWith;
        failNextWith = 0;
        response.write('{"message":"internal detail"}');
        return response.close();
      }
      if (expiredToken != null && request.headers.value('authorization') == 'Bearer $expiredToken') {
        response.statusCode = 401;
        response.write('{"message":"JWT expired"}');
        return response.close();
      }
      if (request.uri.path == '/api/cg-leads/whatsapp-status') {
        response.write(jsonEncode({
          'success': true,
          'data': {
            'statuses': [
              {'phone': '919800000001', 'status': 'read'},
              {'phone': '919800000001', 'status': 'sent'},
              {'phone': '919800000002', 'status': 'failed', 'error_message': 'Not on WhatsApp'},
            ],
          },
        }));
        return response.close();
      }
      final range = RegExp(r'(\d+)-(\d+)').firstMatch(request.headers.value('range') ?? '0-24')!;
      final from = int.parse(range[1]!);
      final to = int.parse(range[2]!);
      final rows = [
        for (var i = from; i <= to && i < leadCount; i++)
          {'id': 'id-$i', 'company_name': 'Company $i', 'name': 'Person $i', 'country_code': '+91', 'mobile': 9800000000 + i},
      ];
      response.headers.set('content-range', rows.isEmpty ? '*/$leadCount' : '$from-${from + rows.length - 1}/$leadCount');
      response.write(jsonEncode(rows));
      return response.close();
    });
  }
}

void main() {
  group('the lead model', () {
    test('a numeric mobile reads as digits, never in exponent form', () {
      final lead = Lead({'mobile': 9800000011, 'country_code': '+91', 'company_name': 'Example Gifts', 'name': 'Test Lead'});
      expect(lead.mobile, '9800000011');
      expect(lead.phoneDisplay, '+91 9800000011');
      expect(lead.dialable, '+919800000011');
      expect(lead.statusKey, '919800000011');
      expect(Lead({'mobile': 9800000011.0}).mobile, '9800000011');
      expect(lead.title, 'Example Gifts');
      expect(lead.subtitle, 'Test Lead · Corporate gifting');
    });

    test('a lead with no company shows the person, and one with no number cannot be called', () {
      final lead = Lead({'name': 'No Company Lead', 'country_code': '+91'});
      expect(lead.title, 'No Company Lead');
      expect(lead.subtitle, 'Corporate gifting');
      expect(lead.phoneDisplay, isNull);
      expect(lead.dialable, isNull);
    });

    test('only the newest status for each number counts', () {
      final statuses = latestStatuses([
        {'phone': '91980', 'status': 'read'},
        {'phone': '91980', 'status': 'failed'},
        'garbage',
        {'phone': 12, 'status': 'sent'},
      ]);
      expect(statuses.keys, ['91980']);
      expect(statuses['91980']!.label, 'Read');
    });

    test('search never asks ilike of the numeric mobile column, and drops filter syntax', () {
      expect(leadSearchFilter('Pune'), 'company_name.ilike.%Pune%,name.ilike.%Pune%,email.ilike.%Pune%,city.ilike.%Pune%');
      expect(leadSearchFilter('+91 98000 00011'), endsWith('mobile.in.(919800000011,9800000011)'));
      expect(leadSearchFilter('a,b(c)'), isNot(contains('(c)')));
      expect(leadSearchFilter('%_'), isNull);
    });

    test('dates read as the web shows them', () {
      expect(formatDisplayDate('2026-11-01T10:00:00Z'), matches(RegExp(r'^\d{1,2} Nov 2026$')));
      expect(formatDisplayDate(null), '');
      expect(formatDisplayDate('nonsense'), '');
      // A calendar date never moves a day with the time zone.
      expect(formatDisplayDate('2026-03-01'), '1 Mar 2026');
    });
  });

  group('reading through Supabase', () {
    late FakeBackend backend;
    late SupabaseRest rest;
    late CrmApi api;
    late String token;

    setUp(() async {
      backend = FakeBackend();
      await backend.start();
      token = 'token-1';
      rest = SupabaseRest(base: backend.url, apiKey: 'public-key', token: ({bool forceFresh = false}) async {
        if (forceFresh) token = 'token-2';
        return token;
      });
      api = CrmApi(origin: backend.url, token: ({bool forceFresh = false}) async => token);
    });

    tearDown(() async {
      rest.close();
      api.close();
      await backend.server.close(force: true);
    });

    test('only an https address, or localhost in a test build, may receive the token', () {
      expect(SupabaseRest.parseBase('https://project.example'), isNotNull);
      expect(SupabaseRest.parseBase('http://project.example'), isNull);
      expect(SupabaseRest.parseBase('http://localhost:54321', localTest: false), isNull);
      expect(SupabaseRest.parseBase('http://localhost:54321', localTest: true), isNotNull);
      expect(SupabaseRest.parseBase('https://user:pass@project.example'), isNull);
      expect(SupabaseRest.parseBase('not a url'), isNull);
    });

    test('a page carries the session token, the public key, its range and the count', () async {
      final page = await rest.select('cg_leads', query: {'select': '*'}, from: 0, to: 24, countAll: true);
      expect(page.rows, hasLength(25));
      expect(page.total, 60);
      final sent = backend.headers.single;
      expect(sent['authorization'], 'Bearer token-1');
      expect(sent['apikey'], 'public-key');
      expect(sent['range'], '0-24');
      expect(sent['prefer'], 'count=exact');
    });

    test('an expired token is replaced once, and the read goes through', () async {
      backend.expiredToken = 'token-1';
      final page = await rest.select('cg_leads', query: {}, from: 0, to: 4);
      expect(page.rows, hasLength(5));
      expect(backend.headers.map((h) => h['authorization']), ['Bearer token-1', 'Bearer token-2']);
    });

    test('a server error says so in plain words, never PostgREST detail', () async {
      backend.failNextWith = 500;
      await expectLater(
        rest.select('cg_leads', query: {}, from: 0, to: 4),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', isNot(contains('internal detail')))),
      );
    });

    test('the list pages on scroll, stops at the end, and knows each WhatsApp state', () async {
      final leads = LeadsController(rest: rest, api: api, searchDelay: const Duration(milliseconds: 10));
      addTearDown(leads.dispose);
      await leads.start();
      expect(leads.leads, hasLength(25));
      expect(leads.total, 60);
      expect(leads.hasMore, isTrue);
      expect(leads.countOf('read'), 1);
      expect(leads.countOf('failed'), 1);
      expect(leads.statusFor(leads.leads[1])!.status, 'read');
      await leads.loadMore();
      await leads.loadMore();
      expect(leads.leads, hasLength(60));
      expect(leads.hasMore, isFalse);
      expect(leads.leads.map((l) => l.id).toSet(), hasLength(60));
    });

    test('a search goes to the server as one filter, after typing stops', () async {
      final leads = LeadsController(rest: rest, api: api, searchDelay: const Duration(milliseconds: 20));
      addTearDown(leads.dispose);
      await leads.start();
      backend.requests.clear();
      leads.setQuery('Pu');
      leads.setQuery('Pune');
      await Future<void>.delayed(const Duration(milliseconds: 80));
      final asked = backend.requests.where((r) => r.uri.path == '/rest/v1/cg_leads').toList();
      expect(asked, hasLength(1));
      expect(asked.single.uri.queryParameters['or'], '(${leadSearchFilter('Pune')})');
      expect(asked.single.uri.queryParameters['order'], 'created_at.desc,id.desc');
    });

    test('a failed search does not leave the old rows looking like its result', () async {
      final leads = LeadsController(rest: rest, api: api, searchDelay: const Duration(milliseconds: 10));
      addTearDown(leads.dispose);
      await leads.start();
      backend.failNextWith = 500;
      await leads.reload();
      expect(leads.leads, isEmpty);
      expect(leads.error, isNotNull);
    });
  });
}
