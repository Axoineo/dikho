import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/inbox/inbox_api.dart';
import 'package:dikho_crm/features/whatsapp/contacts_controller.dart';
import 'package:dikho_crm/features/whatsapp/contacts_models.dart';
import 'package:dikho_crm/features/whatsapp/contacts_screen.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:dikho_crm/shared/platform_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Native WhatsApp Contacts against the shapes GET and DELETE /api/contacts use
// (src/api/routes/contacts/index.js). Synthetic contacts only.

class FakeContactsApi {
  late HttpServer server;
  final asked = <Uri>[];
  final deletes = <Map<String, dynamic>>[];
  int count = 70;
  int failWith = 0;

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      asked.add(request.uri);
      final response = request.response..headers.contentType = ContentType.json;
      if (failWith != 0) {
        response.statusCode = failWith;
        response.write(jsonEncode({'success': false, 'error': {'message': 'Not allowed'}}));
      } else if (request.uri.path == '/api/contacts' && request.method == 'DELETE') {
        final body = jsonDecode(await utf8.decoder.bind(request).join()) as Map<String, dynamic>;
        deletes.add(body);
        if (body['all'] == true) {
          count = 0;
        } else {
          count -= (body['contactIds'] as List).length;
        }
        response.write(jsonEncode({'success': true, 'data': {'deleted': body['all'] == true ? 'all' : (body['contactIds'] as List).length}}));
      } else if (request.uri.path == '/api/contacts') {
        final q = request.uri.queryParameters;
        final limit = int.parse(q['limit'] ?? '30');
        final search = (q['search'] ?? '').toLowerCase();
        final all = [
          for (var i = 0; i < count; i++)
            {
              'id': count - i,
              'name': i == 3 ? null : 'Person ${count - i}',
              'phone': '9198${(10000000 + i).toString()}',
              'company': i.isEven ? 'Example Company' : null,
              'email': null,
              'opted_out': i == 1 ? 1 : 0,
              'attributes': i == 0 ? {'city': 'Pune', 'first_name': 'Asha'} : null,
              'created_at': '2026-11-0${(i % 9) + 1} 10:00:00',
            },
        ].where((c) => search.isEmpty || '${c['name']} ${c['phone']}'.toLowerCase().contains(search)).toList();
        final start = q['cursor'] == null ? 0 : int.parse(q['cursor']!.split('|').last);
        final page = all.skip(start).take(limit).toList();
        final next = start + limit < all.length ? '2026-11-01 10:00:00|${start + limit}' : null;
        response.write(jsonEncode({
          'success': true,
          'data': {'contacts': page, 'nextCursor': next, if (q['cursor'] == null) 'total': all.length},
        }));
      } else {
        response.statusCode = 404;
        response.write('{}');
      }
      await response.close();
    });
  }

  CrmApi get api => CrmApi(origin: Uri.parse('http://localhost:${server.port}'), token: ({bool forceFresh = false}) async => 't');
}

class _Platform implements PlatformApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('a contact reads as the web shows it', () {
    final c = WaContact.from({
      'id': 4, 'name': '  Asha Rao ', 'phone': '+91 98765-43210', 'company': 'Example', 'opted_out': 1,
      'attributes': {'city': 'Pune', 'empty': ' ', 'n': null}, 'created_at': '2026-11-01 10:00:00',
    });
    expect(c.title, 'Asha Rao');
    expect(c.phone, '919876543210');
    expect(c.dialable, '+919876543210');
    expect(c.subtitle, '+919876543210 · Example');
    expect(c.initials, 'AR');
    expect(c.optedOut, isTrue);
    expect(c.attributes, {'city': 'Pune'});
    final unnamed = WaContact.from({'id': 5, 'phone': '919800000012'});
    expect(unnamed.title, 'Unnamed');
    expect(unnamed.initials, '12');
    expect(ContactPage.from({'contacts': [1, 'x', null]}).contacts, isEmpty);
  });

  group('controller', () {
    late FakeContactsApi backend;
    late ContactsController contacts;

    setUp(() async {
      // This file also has widget tests, whose binding answers real requests with 400.
      HttpOverrides.global = null;
      backend = FakeContactsApi();
      await backend.start();
      contacts = ContactsController(backend.api, searchDelay: const Duration(milliseconds: 10));
    });

    tearDown(() async {
      contacts.dispose();
      await backend.server.close(force: true);
    });

    test('a page of 30 with the total, then the next page by cursor, and nothing twice', () async {
      await contacts.start();
      expect(contacts.error, isNull);
      expect(contacts.contacts.length, 30);
      expect(contacts.total, 70);
      expect(contacts.hasMore, isTrue);
      await contacts.loadMore();
      expect(contacts.contacts.length, 60);
      expect(backend.asked.last.queryParameters['cursor'], isNotNull);
      await contacts.loadMore();
      expect(contacts.contacts.length, 70);
      expect(contacts.hasMore, isFalse);
      expect(contacts.contacts.map((c) => c.id).toSet().length, 70);
    });

    test('search waits for typing to stop and asks the server once', () async {
      await contacts.start();
      final before = backend.asked.length;
      contacts.setQuery('Per');
      contacts.setQuery('Person 7');
      await Future<void>.delayed(const Duration(milliseconds: 80));
      expect(backend.asked.length, before + 1);
      expect(backend.asked.last.queryParameters['search'], 'Person 7');
    });

    test('a refused search shows no rows from the last one', () async {
      await contacts.start();
      backend.failWith = 403;
      await contacts.reload();
      expect(contacts.contacts, isEmpty);
      expect(contacts.error, isNotNull);
    });

    test('deleting sends exactly the ids chosen, or all, then reloads', () async {
      await contacts.start();
      await contacts.delete([70, 69, 70, 0]);
      expect(backend.deletes.single, {'contactIds': [70, 69]});
      expect(contacts.total, 68);
      await contacts.deleteAll();
      expect(backend.deletes.last, {'all': true});
      expect(contacts.contacts, isEmpty);
    });
  });

  group('screens', () {
    late FakeContactsApi backend;

    setUp(() async {
      backend = FakeContactsApi();
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

    Future<ContactsController> pump(WidgetTester tester, {ContactAbilities abilities = const ContactAbilities(delete: true, import: true, sendTemplates: true), List<String>? imports}) async {
      final api = backend.api;
      final controller = ContactsController(api, searchDelay: const Duration(milliseconds: 10));
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: ContactsScreen(
            controller: controller,
            platform: _Platform(),
            inboxApi: InboxApi(api),
            abilities: abilities,
            onOpenDrawer: () {},
            onImport: () => imports?.add('import'),
          ),
        ),
      );
      await settle(tester);
      return controller;
    }

    screenTest('the list shows names, numbers and who opted out, with the count', (tester) async {
      await pump(tester);
      expect(find.text('70 contacts'), findsOneWidget);
      expect(find.text('Person 70'), findsOneWidget);
      expect(find.text('Opted out'), findsOneWidget);
      expect(find.text('Unnamed'), findsOneWidget);
    });

    screenTest('a long press selects; delete asks first and sends only the selected ids', (tester) async {
      await pump(tester);
      await tester.longPress(find.text('Person 70'));
      await tester.pump();
      await tester.tap(find.text('Person 69'));
      await tester.pump();
      expect(find.text('2 selected'), findsOneWidget);
      await tester.tap(find.byTooltip('Delete selected'));
      await tester.pump();
      expect(find.text('Delete 2 contacts?'), findsOneWidget);
      expect(find.textContaining('cannot be undone'), findsOneWidget);
      await tester.tap(find.text('Delete'));
      await settle(tester);
      expect(backend.deletes.single, {'contactIds': [70, 69]});
      expect(find.text('2 selected'), findsNothing);
    });

    screenTest('Cancel deletes nothing, and Back clears a selection before leaving', (tester) async {
      await pump(tester);
      await tester.longPress(find.text('Person 70'));
      await tester.pump();
      await tester.tap(find.byTooltip('Delete selected'));
      await tester.pump();
      await tester.tap(find.text('Cancel'));
      await tester.pump();
      expect(backend.deletes, isEmpty);
      final popped = await tester.binding.handlePopRoute();
      await tester.pump();
      expect(popped, isTrue);
      expect(find.text('1 selected'), findsNothing);
      expect(find.text('Contacts'), findsOneWidget);
    });

    screenTest('without permission there is no selecting, deleting or importing', (tester) async {
      await pump(tester, abilities: const ContactAbilities());
      await tester.longPress(find.text('Person 70'));
      await tester.pump();
      expect(find.text('1 selected'), findsNothing);
      expect(find.byTooltip('More'), findsNothing);
    });

    screenTest('Import opens the web importer', (tester) async {
      final imports = <String>[];
      await pump(tester, imports: imports);
      await tester.tap(find.byTooltip('More'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Import a spreadsheet'));
      await tester.pumpAndSettle();
      expect(imports, ['import']);
    });

    screenTest('details: the import columns show, and an opted-out contact cannot be sent a template', (tester) async {
      await pump(tester);
      await tester.tap(find.text('Person 70'));
      await settle(tester);
      expect(find.text('From the import'), findsOneWidget);
      expect(find.text('Pune'), findsOneWidget);
      await tester.pageBack();
      await settle(tester);
      await tester.tap(find.text('Person 69'));
      await settle(tester);
      expect(find.textContaining('Opted out of WhatsApp messages'), findsOneWidget);
      final send = tester.widget<FilledButton>(find.ancestor(of: find.text('Send template'), matching: find.byType(FilledButton)).first);
      expect(send.onPressed, isNull);
    });
  });
}
