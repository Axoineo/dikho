import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/clients/clients_controller.dart';
import 'package:dikho_crm/features/clients/clients_models.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:dikho_crm/shared/supabase_rest.dart';
import 'package:flutter_test/flutter_test.dart';

/// PostgREST on localhost, enough for a list, an insert and an update, recording what
/// was sent. [allowEdit] false stands in for RLS letting nothing change.
class FakeTable {
  late HttpServer server;
  final sent = <(String, String, Map<String, String>, Object?)>[];
  final rows = <Map<String, dynamic>>[
    {'id': 2, 'company_name': 'Example Traders', 'contact_person': 'Test Person', 'status': 1, 'country_dialcode': 91, 'contact': 9800000021},
    {'id': 1, 'company_name': 'Sample Media Works', 'status': 0},
  ];
  bool allowEdit = true;
  bool dropNextWrite = false;

  Uri get url => Uri.parse('http://localhost:${server.port}');

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final body = await utf8.decodeStream(request);
      final headers = {
        for (final name in ['prefer', 'accept', 'authorization']) name: request.headers.value(name) ?? '',
      };
      sent.add((request.method, request.uri.toString(), headers, body.isEmpty ? null : jsonDecode(body)));
      final response = request.response;
      if (request.method != 'GET' && dropNextWrite) {
        dropNextWrite = false;
        final socket = await response.detachSocket(writeHeaders: false);
        socket.destroy();
        return;
      }
      if (request.uri.path == '/rest/v1/rpc/get_settings') {
        response.write(
          jsonEncode({
            'lists': [
              {'list_key': 'registration', 'value': 'Registered', 'hidden': false},
              {'list_key': 'registration', 'value': 'Hidden one', 'hidden': true},
              {'list_key': 'other', 'value': 'Nope'},
            ],
          }),
        );
        return response.close();
      }
      if (request.method == 'POST') {
        final row = {...(jsonDecode(body) as Map<String, dynamic>), 'id': 3};
        rows.insert(0, row);
        response.statusCode = 201;
        response.write(jsonEncode(row));
        return response.close();
      }
      if (request.method == 'PATCH') {
        if (!allowEdit) {
          response.statusCode = 406;
          response.write('{"code":"PGRST116","message":"JSON object requested, multiple (or no) rows returned"}');
          return response.close();
        }
        final id = int.parse(request.uri.queryParameters['id']!.substring(3));
        final index = rows.indexWhere((r) => r['id'] == id);
        rows[index] = {...rows[index], ...(jsonDecode(body) as Map<String, dynamic>)};
        response.write(jsonEncode(rows[index]));
        return response.close();
      }
      response.headers.set('content-range', '0-${rows.length - 1}/${rows.length}');
      response.write(jsonEncode(rows));
      return response.close();
    });
  }
}

void main() {
  group('the client model', () {
    test('numeric phone columns read as digits, and the number can be called', () {
      final client = Client({'country_dialcode': 91, 'contact': 9800000021.0, 'company_name': 'Example Traders'});
      expect(client.phoneDisplay, '+91 9800000021');
      expect(client.dialable, '+919800000021');
      expect(Client({'contact': null}).phoneDisplay, isNull);
      expect(Client({}).title, 'Unnamed client');
    });

    test('status reads every form the column has held', () {
      for (final value in [1, '1', true, 'true', 'active', 'Active']) {
        expect(Client({'status': value}).active, isTrue, reason: '$value');
      }
      for (final value in [0, '0', null, 'Inactive']) {
        expect(Client({'status': value}).active, isFalse, reason: '$value');
      }
    });

    test('search covers the five text columns the web searches, without filter syntax', () {
      expect(
        clientSearchFilter('Acme'),
        'company_name.ilike.%Acme%,contact_person.ilike.%Acme%,email.ilike.%Acme%,gstin.ilike.%Acme%,pan_number.ilike.%Acme%',
      );
      expect(clientSearchFilter('a,b(c)'), isNot(contains('(c)')));
      expect(clientSearchFilter('%_'), isNull);
    });

    test('a new client saves the same payload the web form sends', () {
      final draft = ClientDraft.from(null)
        ..companyName = '  New Co  '
        ..contact = '98000 00099'
        ..gstin = '27aaaaa0000a1z5'
        ..pan = 'aaaaa0000a'
        ..tdsPercentage = '2'
        ..gstinDate = '2026-03-01';
      expect(draft.problems(), isEmpty);
      expect(draft.toPayload(), {
        'company_name': 'New Co',
        'contact_person': null,
        'designation': null,
        'country_dialcode': 91,
        'contact': 9800000099,
        'email': null,
        'gstin': '27AAAAA0000A1Z5',
        'gstin_date': '2026-03-01',
        'tds_percentage': 2,
        'tds_section': null,
        'registration': null,
        'pan_number': 'AAAAA0000A',
        'status': 1,
        'address_line1': null,
        'address_line2': null,
        'city': null,
        'state': null,
        'pincode': null,
        'country': 'India',
      });
    });

    test('no phone means no dial code saved either, and an existing client keeps its fields', () {
      final draft = ClientDraft.from(Client({'company_name': 'Old', 'status': 0, 'country_dialcode': 44, 'country': 'UK'}));
      expect(draft.dialCode, '44');
      expect(draft.active, isFalse);
      final payload = draft.toPayload();
      expect(payload['country_dialcode'], isNull);
      expect(payload['status'], 0);
      expect(payload['country'], 'UK');
    });

    test('the form refuses what the database or a person would regret', () {
      final draft = ClientDraft.from(null)
        ..email = 'not-an-email'
        ..tdsPercentage = '120';
      expect(draft.problems().keys, containsAll(['company_name', 'email', 'tds_percentage']));
    });

    test('registration lists follow the organization\'s settings, keeping a hidden current value', () {
      expect(registrationOptions(null, ''), defaultRegistrations);
      final settings = {
        'lists': [
          {'list_key': 'registration', 'value': 'Registered', 'hidden': false},
          {'list_key': 'registration', 'value': 'Gone', 'hidden': true},
        ],
      };
      expect(registrationOptions(settings, ''), ['Registered']);
      expect(registrationOptions(settings, 'Gone'), ['Registered', 'Gone']);
    });
  });

  group('saving through Supabase', () {
    late FakeTable table;
    late SupabaseRest rest;
    late ClientsController clients;

    setUp(() async {
      table = FakeTable();
      await table.start();
      rest = SupabaseRest(base: table.url, apiKey: 'key', token: ({bool forceFresh = false}) async => 'token');
      clients = ClientsController(rest: rest, searchDelay: const Duration(milliseconds: 10));
    });

    tearDown(() async {
      clients.dispose();
      rest.close();
      await table.server.close(force: true);
    });

    test('the list is newest first, by id', () async {
      await clients.reload();
      expect(clients.rows.map((c) => c.id), ['2', '1']);
      expect(table.sent.single.$2, contains('order=id.desc'));
    });

    test('a new client is inserted once, returned as stored, and shown at the top', () async {
      await clients.reload();
      final saved = await clients.save(null, ClientDraft.from(null)..companyName = 'New Co');
      expect(saved.id, '3');
      final (method, url, headers, body) = table.sent.last;
      expect(method, 'POST');
      expect(url, contains('/rest/v1/clients'));
      expect(headers['prefer'], 'return=representation');
      expect(headers['accept'], 'application/vnd.pgrst.object+json');
      expect((body! as Map)['company_name'], 'New Co');
      expect(clients.rows.first.id, '3');
      expect(clients.total, 3);
    });

    test('an edit changes only that row, and the list shows it at once', () async {
      await clients.reload();
      final draft = ClientDraft.from(clients.rows.first)..city = 'Pune';
      await clients.save(clients.rows.first, draft);
      final (method, url, _, _) = table.sent.last;
      expect(method, 'PATCH');
      expect(Uri.parse(url).queryParameters['id'], 'eq.2');
      expect(clients.rows.first.city, 'Pune');
      expect(clients.rows, hasLength(2));
    });

    test('an edit RLS refuses says so, and changes nothing on screen', () async {
      await clients.reload();
      table.allowEdit = false;
      await expectLater(
        clients.save(clients.rows.first, ClientDraft.from(clients.rows.first)..city = 'Pune'),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('may not have permission'))),
      );
      expect(clients.rows.first.city, isEmpty);
    });

    test('a save whose connection drops is never sent again, so no duplicate client', () async {
      table.dropNextWrite = true;
      await expectLater(clients.save(null, ClientDraft.from(null)..companyName = 'Once'), throwsA(isA<ApiException>()));
      expect(table.sent.where((s) => s.$1 == 'POST'), hasLength(1));
    });

    test('the registration list comes from the organization, read once', () async {
      expect(await clients.registrations(''), ['Registered']);
      expect(await clients.registrations('Composition'), ['Registered', 'Composition']);
      expect(table.sent.where((s) => s.$2.contains('get_settings')), hasLength(1));
    });
  });
}
