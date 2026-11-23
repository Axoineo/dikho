import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/vendors/vendor_form_screen.dart';
import 'package:dikho_crm/features/vendors/vendors_controller.dart';
import 'package:dikho_crm/features/vendors/vendors_models.dart';
import 'package:dikho_crm/features/vendors/vendors_screen.dart';
import 'package:dikho_crm/shared/platform_api.dart';
import 'package:dikho_crm/shared/record_ui.dart';
import 'package:dikho_crm/shared/supabase_rest.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Native Vendors against a stand-in for PostgREST and Supabase Storage. It keeps
// tables in memory, records every request, and can refuse a chosen step, so the undo
// after a failed save is checked step by step. Synthetic vendors only.

class FakeSupabase {
  late HttpServer server;
  final log = <String>[];
  final bodies = <String, List<Object?>>{};
  final vendors = <Map<String, dynamic>>[];
  final addresses = <Map<String, dynamic>>[];
  final objects = <String>{};
  final refuse = <String>{}; // e.g. 'POST /rest/v1/vendor_addresses'
  int nextId = 500;

  Future<void> start() async {
    for (var i = 1; i <= 30; i++) {
      vendors.add({
        'id': i,
        'company_name': 'Vendor $i',
        'contact_person': 'Person $i',
        'status': i == 2 ? 0 : 1,
        'media_id': 1,
        'sub_media_id': 11,
        'country_dialcode': '+91',
        'contact': 9800000000 + i,
        'vendor_account_number': '123456789012',
        'payment_term_value': 30,
        'payment_term_type': 'Invoice Date',
        'opening_balance': i == 30 ? 12345.5 : 0,
        'vendor_document_file_path': i == 30 ? 'vendors_documents/30/1-a.pdf' : null,
        'vendor_document_file_name': i == 30 ? 'a.pdf' : null,
      });
      addresses.add({
        'id': 1000 + i,
        'vendor_id': i,
        'address': 'Street $i',
        'city': 'Pune',
        'state': 'Maharashtra',
        'country': 'India',
        'is_default': true,
      });
    }
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen(_handle);
  }

  Uri get base => Uri.parse('http://localhost:${server.port}');

  SupabaseRest get rest => SupabaseRest(base: base, apiKey: 'publishable', token: ({bool forceFresh = false}) async => 't');

  Future<void> _handle(HttpRequest request) async {
    final path = request.uri.path;
    final key = '${request.method} $path';
    log.add('$key?${request.uri.query}');
    final raw = await utf8.decoder.bind(request).join();
    final body = raw.isEmpty || !(request.headers.contentType?.mimeType.contains('json') ?? false) ? null : jsonDecode(raw);
    bodies.putIfAbsent(key, () => []).add(body ?? raw.length);
    final response = request.response..headers.contentType = ContentType.json;
    final match = refuse.where((r) => key.startsWith(r)).toList();
    if (match.isNotEmpty) {
      response.statusCode = 403;
      response.write('{"message":"denied"}');
      return response.close();
    }
    Object? out;
    final q = request.uri.queryParameters;
    int? idEq(String column) => q[column] == null ? null : int.tryParse(q[column]!.replaceFirst('eq.', ''));
    switch (key) {
      case 'GET /rest/v1/vendors':
        var rows = vendors.reversed.toList();
        if (q['status'] != null) rows = rows.where((v) => 'eq.${v['status']}' == q['status']).toList();
        final range = RegExp(r'(\d+)-(\d+)').firstMatch(request.headers.value('range') ?? '0-24')!;
        final from = int.parse(range[1]!);
        final to = int.parse(range[2]!);
        final page = rows
            .skip(from)
            .take(to - from + 1)
            .map((v) => {...v, 'vendor_addresses': addresses.where((a) => a['vendor_id'] == v['id']).toList()})
            .toList();
        response.headers.set('content-range', '$from-${from + page.length - 1}/${rows.length}');
        out = page;
      case 'GET /rest/v1/media':
        out = [
          {'id': 1, 'name': 'Hoarding'},
          {'id': 2, 'name': 'Digital'},
        ];
      case 'GET /rest/v1/sub_media':
        out = [
          {'id': 11, 'name': 'Billboard', 'media_id': 1},
          {'id': 21, 'name': 'Screens', 'media_id': 2},
        ];
      case 'GET /rest/v1/vendor_addresses':
        out = [
          for (final a in addresses) {'state': a['state'], 'city': a['city'], 'country': a['country']},
        ];
      case 'POST /rest/v1/rpc/get_settings':
        out = {'lists': []};
      case 'POST /rest/v1/vendors':
        final row = {...(body as Map<String, dynamic>), 'id': nextId++};
        vendors.add(row);
        out = row;
      case 'POST /rest/v1/vendor_addresses':
        final row = {...(body as Map<String, dynamic>), 'id': nextId++};
        addresses.add(row);
        out = row;
      case 'PATCH /rest/v1/vendors':
        final row = vendors.firstWhere((v) => v['id'] == idEq('id'));
        row.addAll(body as Map<String, dynamic>);
        out = row;
      case 'PATCH /rest/v1/vendor_addresses':
        final row = addresses.firstWhere((a) => a['id'] == idEq('id'));
        row.addAll(body as Map<String, dynamic>);
        out = row;
      case 'DELETE /rest/v1/vendors':
        vendors.removeWhere((v) => v['id'] == idEq('id'));
        response.statusCode = 204;
      case 'DELETE /rest/v1/vendor_addresses':
        addresses.removeWhere((a) => a['vendor_id'] == idEq('vendor_id'));
        response.statusCode = 204;
      case 'DELETE /storage/v1/object/Dikho':
        objects.removeAll(((body as Map)['prefixes'] as List).cast<String>());
        out = [];
      default:
        if (request.method == 'POST' && path.startsWith('/storage/v1/object/sign/Dikho/')) {
          out = {'signedURL': '/object/sign/Dikho/${path.substring('/storage/v1/object/sign/Dikho/'.length)}?token=synthetic'};
        } else if (request.method == 'POST' && path.startsWith('/storage/v1/object/Dikho/')) {
          objects.add(Uri.decodeComponent(path.substring('/storage/v1/object/Dikho/'.length)));
          out = {'Key': path};
        } else {
          response.statusCode = 404;
          out = {};
        }
    }
    if (out != null) response.write(jsonEncode(out));
    await response.close();
  }
}

VendorDraft validDraft() => VendorDraft.from(null)
  ..companyName = ' New Media Co '
  ..mediaId = 1
  ..subMediaId = 11
  ..state = 'Gujarat'
  ..city = 'Surat'
  ..street = '1 Ring Road'
  ..gstin = '24abcde1234f1z5'
  ..pan = 'abcde1234f'
  ..ifsc = 'hdfc0001234'
  ..accountNumber = '1234'
  ..confirmAccountNumber = '1234'
  ..paymentTermValue = '45';

void main() {
  group('rules', () {
    test('a vendor reads as the web panel shows it', () {
      final v = Vendor({
        'id': 7,
        'company_name': 'Acme',
        'country_dialcode': '+91',
        'contact': 9800000001,
        'payment_term_value': 30,
        'payment_term_type': 'Campaign End Date',
        'vendor_account_number': 123456789012,
        'vendor_addresses': [
          {'id': 1, 'city': 'Pune', 'is_default': false},
          {'id': 2, 'city': 'Surat', 'state': 'Gujarat', 'is_default': true},
        ],
      });
      expect(v.address?.city, 'Surat', reason: 'the default address wins');
      expect(v.phoneDisplay, '+91 9800000001');
      expect(v.dialable, '+919800000001');
      expect(v.paymentTerm, '30 days from campaign end date');
      expect(v.accountNumber, '123456789012', reason: 'a numeric column never becomes 1.2e11');
      expect(Vendor({'id': 1}).title, 'Unnamed vendor');
    });

    test('search escapes what PostgREST would misread', () {
      expect(vendorSearchFilter('  '), isNull);
      expect(vendorSearchFilter('a%b_(c),d'), contains('company_name.ilike.%ab c  d%'));
      expect(vendorSearchFilter('x')!.split(',').length, 6);
    });

    test('the form asks for what the web form asks for', () {
      final empty = VendorDraft.from(null);
      expect(empty.problems().keys.toSet(), {'company_name', 'media_id', 'sub_media_id', 'state', 'city', 'address'});
      final mismatch = validDraft()..confirmAccountNumber = '9999';
      expect(mismatch.problems().keys, ['vendor_confirm_account_number']);
      expect((validDraft()..tdsPercentage = '150').problems().keys, ['tds_percentage']);
      expect((validDraft()..paymentTermValue = 'ten').problems().keys, ['payment_term_value']);
      expect(validDraft().problems(), isEmpty);
    });

    test('payloads match VendorForm.jsx', () {
      final p = validDraft().vendorPayload();
      expect(p['company_name'], 'New Media Co');
      expect(p['gstin'], '24ABCDE1234F1Z5');
      expect(p['pan_number'], 'ABCDE1234F');
      expect(p['vendor_ifsc_code'], 'HDFC0001234');
      expect(p['country_dialcode'], '+91');
      expect(p['country_code'], 'IN');
      expect(p['payment_term_value'], 45);
      expect(p['opening_balance'], 0);
      expect(p['status'], 1);
      expect(p['vendor_type'], 'Organization');
      final a = validDraft().addressPayload('42');
      expect(a, {
        'vendor_id': 42,
        'address': '1 Ring Road',
        'country': 'India',
        'country_code': 'IN',
        'state': 'Gujarat',
        'city': 'Surat',
        'zipcode': null,
        'is_default': true,
      });
    });

    test('a document path stays in the vendor folder', () {
      expect(
        vendorDocumentPath(5, '../../etc/pass wd.pdf', DateTime.utc(2026, 11, 9)),
        'vendors_documents/5/${DateTime.utc(2026, 11, 9).millisecondsSinceEpoch}-.._.._etc_pass_wd.pdf',
      );
    });
  });

  group('controller', () {
    late FakeSupabase backend;
    late VendorsController vendors;
    late Directory temp;

    setUp(() async {
      HttpOverrides.global = null;
      backend = FakeSupabase();
      await backend.start();
      vendors = VendorsController(rest: backend.rest, searchDelay: const Duration(milliseconds: 5), now: () => DateTime.utc(2026, 11, 9));
      temp = await Directory.systemTemp.createTemp('vendors-test-');
    });

    tearDown(() async {
      vendors.dispose();
      await backend.server.close(force: true);
      await temp.delete(recursive: true);
    });

    Future<PickedDocument> document() async {
      final file = File('${temp.path}/quote.pdf');
      await file.writeAsBytes(utf8.encode('%PDF-1.4 synthetic'));
      return PickedDocument(file: file, name: 'quote.pdf', mime: 'application/pdf');
    }

    test('a page of 25 with addresses embedded, newest first, and the catalog', () async {
      await vendors.start();
      expect(vendors.rows.length, 25);
      expect(vendors.rows.first.title, 'Vendor 30');
      expect(vendors.rows.first.address?.city, 'Pune');
      expect(vendors.total, 30);
      expect(backend.log.firstWhere((l) => l.startsWith('GET /rest/v1/vendors')), contains('vendor_addresses'));
      expect(vendors.media.map((m) => m.name), ['Hoarding', 'Digital']);
      expect(vendors.places.single, (country: 'India', state: 'Maharashtra', city: 'Pune'));
    });

    test('filters reach the server, and a sub media from another media is dropped', () async {
      await vendors.start();
      vendors.setFilters(status: false, mediaId: 2, subMediaId: 11);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      final last = backend.log.lastWhere((l) => l.startsWith('GET /rest/v1/vendors'));
      expect(last, contains('status=eq.0'));
      expect(last, contains('media_id=eq.2'));
      expect(last, isNot(contains('sub_media_id')));
      expect(vendors.rows.single.title, 'Vendor 2');
    });

    test('adding: vendor, then address, then the document, then its path', () async {
      await vendors.start();
      final saved = await vendors.save(null, validDraft(), document: await document());
      expect(saved.documentPath, 'vendors_documents/${saved.id}/${DateTime.utc(2026, 11, 9).millisecondsSinceEpoch}-quote.pdf');
      expect(backend.objects, {saved.documentPath});
      expect(saved.address?.city, 'Surat');
      expect(vendors.rows.first.id, saved.id, reason: 'shown at once');
      expect(backend.log.where((l) => !l.startsWith('GET')).map((l) => l.split('?').first).toList(), [
        'POST /rest/v1/vendors',
        'POST /rest/v1/vendor_addresses',
        'POST /storage/v1/object/Dikho/vendors_documents/${saved.id}/${DateTime.utc(2026, 11, 9).millisecondsSinceEpoch}-quote.pdf',
        'PATCH /rest/v1/vendors',
      ]);
    });

    test('a refused address removes the vendor just added', () async {
      backend.refuse.add('POST /rest/v1/vendor_addresses');
      await expectLater(vendors.save(null, validDraft()), throwsA(anything));
      expect(backend.vendors.where((v) => v['company_name'] == 'New Media Co'), isEmpty);
    });

    test('a refused upload removes the address and the vendor', () async {
      backend.refuse.add('POST /storage/v1/object/Dikho');
      await expectLater(vendors.save(null, validDraft(), document: await document()), throwsA(predicate((e) => '$e'.contains('was not added'))));
      expect(backend.vendors.where((v) => v['company_name'] == 'New Media Co'), isEmpty);
      expect(backend.addresses.where((a) => a['city'] == 'Surat'), isEmpty);
    });

    test('editing changes the vendor and its address in place; a failed attach removes the new file', () async {
      await vendors.start();
      final existing = vendors.rows.firstWhere((v) => v.id == '29');
      final draft = VendorDraft.from(existing)..city = 'Nashik';
      final saved = await vendors.save(existing, draft);
      expect(saved.address?.city, 'Nashik');
      expect(backend.addresses.firstWhere((a) => a['vendor_id'] == 29)['city'], 'Nashik');
      expect(backend.log.where((l) => l.startsWith('PATCH /rest/v1/vendor_addresses')).single, contains('id=eq.1029'));

      backend.refuse.add('PATCH /rest/v1/vendors');
      await expectLater(vendors.save(saved, VendorDraft.from(saved), document: await document()), throwsA(anything));
      expect(backend.objects, isEmpty, reason: 'nothing left behind');
    });

    test('a document link is signed on request and stays inside the bucket', () async {
      final link = await vendors.documentLink(Vendor({'id': 1, 'vendor_document_file_path': 'vendors_documents/1/../../x.pdf'}));
      expect(link.path, '/storage/v1/object/sign/Dikho/vendors_documents/1/x.pdf');
      expect(backend.log.last, startsWith('POST /storage/v1/object/sign/Dikho/vendors_documents/1/x.pdf'));
    });
  });

  group('screens', () {
    late FakeSupabase backend;

    setUp(() async {
      HttpOverrides.global = null;
      backend = FakeSupabase();
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
        tester.view.physicalSize = const Size(1080, 2400);
        tester.view.devicePixelRatio = 2.6;
        addTearDown(tester.view.reset);
        await body(tester);
        await tester.pumpWidget(const SizedBox());
        await tester.pump(const Duration(minutes: 5));
      });
    }

    Future<(VendorsController, List<String>)> pump(
      WidgetTester tester, {
      VendorAbilities abilities = const VendorAbilities(create: true, edit: true, newPurchaseOrder: true),
    }) async {
      final controller = VendorsController(rest: backend.rest, searchDelay: const Duration(milliseconds: 5));
      addTearDown(controller.dispose);
      final orders = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: VendorsScreen(
            controller: controller,
            platform: PlatformApi(),
            abilities: abilities,
            onOpenDrawer: () {},
            onNewPurchaseOrder: (v) => orders.add(v.id),
          ),
        ),
      );
      await settle(tester);
      return (controller, orders);
    }

    screenTest('the list shows each vendor with its status, and the count', (tester) async {
      await pump(tester);
      expect(find.text('30 vendors'), findsOneWidget);
      expect(find.text('Vendor 30'), findsOneWidget);
      expect(find.text('Inactive'), findsNothing, reason: 'vendor 2 is beyond the first screen');
    });

    screenTest('details: masked account until asked, and New PO hands over the vendor', (tester) async {
      final (_, orders) = await pump(tester);
      await tester.tap(find.text('Vendor 30'));
      await settle(tester);
      expect(find.text('Hoarding'), findsOneWidget);
      expect(find.text('30 days from invoice date'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Show account number'), 300, scrollable: find.byType(Scrollable).first);
      expect(find.text('₹12,345.50'), findsOneWidget, reason: 'money, grouped as the web shows it');
      expect(find.text('•••• 9012'), findsOneWidget);
      expect(find.text('123456789012'), findsNothing);
      await tester.tap(find.text('Show account number'));
      await tester.pump();
      expect(find.text('123456789012'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('New PO'), -300, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('New PO'));
      expect(orders, ['30']);
    });

    screenTest('placeholder rows until the first page arrives, then the next page is asked for well before the end', (tester) async {
      final controller = VendorsController(rest: backend.rest, searchDelay: const Duration(milliseconds: 5));
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: VendorsScreen(
            controller: controller,
            platform: PlatformApi(),
            abilities: const VendorAbilities(),
            onOpenDrawer: () {},
            onNewPurchaseOrder: (_) {},
          ),
        ),
      );
      expect(find.byType(LoadingRows), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      await settle(tester);
      expect(find.byType(LoadingRows), findsNothing);
      expect(controller.rows, hasLength(25));
      int pagesAsked() => backend.log.where((l) => l.startsWith('GET /rest/v1/vendors')).length;
      final asked = pagesAsked();

      final list = tester.widget<ListView>(find.byWidgetPredicate((w) => w is ListView && w.controller != null)).controller!;
      final position = list.position;
      // Further from the end than the old 200 px trigger, inside a screen and a half.
      list.jumpTo(position.maxScrollExtent - position.viewportDimension * 1.4);
      expect(position.extentAfter, greaterThan(200));
      await settle(tester);
      expect(pagesAsked(), asked + 1);
      expect(controller.rows, hasLength(30));
    });

    screenTest('without permission: no New vendor, no Edit, no New PO', (tester) async {
      await pump(tester, abilities: const VendorAbilities());
      expect(find.text('New vendor'), findsNothing);
      await tester.tap(find.text('Vendor 30'));
      await settle(tester);
      expect(find.byTooltip('Edit vendor'), findsNothing);
      expect(find.text('New PO'), findsNothing);
    });

    screenTest('the form names every missing field, and a new vendor is added and opened', (tester) async {
      await pump(tester);
      await tester.tap(find.text('New vendor'));
      await settle(tester);
      expect(find.byType(VendorFormScreen), findsOneWidget);
      await tester.tap(find.text('Add'));
      await tester.pump();
      expect(find.text('Some fields need attention. They are marked below.'), findsOneWidget);
      expect(find.text('Enter the company name.'), findsOneWidget);
      expect(backend.log.where((l) => l.startsWith('POST /rest/v1/vendors')), isEmpty);

      await tester.enterText(find.widgetWithText(TextField, 'Company name *'), 'Fresh Vendor');
      await tester.tap(find.text('Choose media'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hoarding').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Choose sub media'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Billboard').last);
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.widgetWithText(TextField, 'State *'), 300, scrollable: find.byType(Scrollable).first);
      await tester.enterText(find.widgetWithText(TextField, 'State *'), 'Gujarat');
      await tester.enterText(find.widgetWithText(TextField, 'City *'), 'Surat');
      await tester.scrollUntilVisible(find.widgetWithText(TextField, 'Street address *'), 300, scrollable: find.byType(Scrollable).first);
      await tester.enterText(find.widgetWithText(TextField, 'Street address *'), '1 Ring Road');
      await tester.tap(find.text('Add'));
      await settle(tester);
      expect(backend.vendors.last['company_name'], 'Fresh Vendor');
      expect(backend.addresses.last['city'], 'Surat');
      expect(find.byType(VendorDetailsScreen), findsOneWidget);
      expect(find.text('Fresh Vendor'), findsOneWidget);
    });

    screenTest('fixing the last marked field keeps that field and its focus as the note goes', (tester) async {
      await pump(tester);
      await tester.tap(find.text('New vendor'));
      await settle(tester);
      await tester.tap(find.text('Add'));
      await tester.pump();
      await tester.tap(find.text('Choose media'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hoarding').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Choose sub media'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Billboard').last);
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.widgetWithText(TextField, 'State *'), 300, scrollable: find.byType(Scrollable).first);
      await tester.enterText(find.widgetWithText(TextField, 'State *'), 'Gujarat');
      await tester.enterText(find.widgetWithText(TextField, 'City *'), 'Surat');
      await tester.scrollUntilVisible(find.widgetWithText(TextField, 'Street address *'), 300, scrollable: find.byType(Scrollable).first);
      await tester.enterText(find.widgetWithText(TextField, 'Street address *'), '1 Ring Road');
      await tester.scrollUntilVisible(
        find.text('Some fields need attention. They are marked below.'),
        -300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Some fields need attention. They are marked below.'), findsOneWidget);
      // The company name is the last one marked: typing it clears the note above.
      await tester.enterText(find.widgetWithText(TextField, 'Company name *'), 'F');
      await tester.pump();
      expect(find.text('Some fields need attention. They are marked below.'), findsNothing);
      final field = find.widgetWithText(TextField, 'Company name *');
      final editable = tester.state<EditableTextState>(find.descendant(of: field, matching: find.byType(EditableText)));
      expect(editable.widget.focusNode.hasFocus, isTrue, reason: 'still the field being typed in');
      await tester.enterText(field, 'Fresh Vendor');
      await tester.pump();
      expect(tester.widget<TextField>(field).controller!.text, 'Fresh Vendor');
    });

    screenTest('closing a changed form asks first', (tester) async {
      await pump(tester);
      await tester.tap(find.text('New vendor'));
      await settle(tester);
      await tester.enterText(find.widgetWithText(TextField, 'Company name *'), 'Draft');
      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();
      expect(find.text('Discard your changes?'), findsOneWidget);
      await tester.tap(find.text('Keep editing'));
      await tester.pumpAndSettle();
      expect(find.byType(VendorFormScreen), findsOneWidget);
    });
  });
}
