import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/purchase_orders/purchase_order_form_screen.dart';
import 'package:dikho_crm/features/purchase_orders/purchase_orders_controller.dart';
import 'package:dikho_crm/features/purchase_orders/purchase_orders_models.dart';
import 'package:dikho_crm/features/purchase_orders/purchase_orders_screen.dart';
import 'package:dikho_crm/features/sales_orders/sales_orders_models.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:dikho_crm/shared/platform_api.dart';
import 'package:dikho_crm/shared/supabase_rest.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Native Purchase orders against a stand-in for PostgREST: `salesorder` holds both
// kinds of order (a vendor address makes a purchase order), `salesorderdocument` both
// kinds of line, plus vendors and their addresses. Every request is recorded and any
// step can be refused. Synthetic rows only.

class FakeSupabase {
  late HttpServer server;
  final log = <String>[];
  final orders = <Map<String, dynamic>>[];
  final items = <Map<String, dynamic>>[];
  final vendors = <Map<String, dynamic>>[
    {'id': 7, 'company_name': 'Northern Hoardings', 'alias': 'NH', 'contact_person': 'Ravi', 'email': 'nh@example.test', 'gstin': '27AAAAA0000A1Z5'},
    {'id': 8, 'company_name': 'Two Address Media', 'alias': null},
  ];
  final addresses = <Map<String, dynamic>>[
    {
      'id': 70,
      'vendor_id': 7,
      'address': '1 Ring Road',
      'city': 'Pune',
      'state': 'Maharashtra',
      'country': 'India',
      'zipcode': '411001',
      'is_default': true,
    },
    {'id': 80, 'vendor_id': 8, 'address': 'North office', 'city': 'Delhi', 'state': 'Delhi', 'is_default': false},
    {'id': 81, 'vendor_id': 8, 'address': 'South office', 'city': 'Chennai', 'state': 'Tamil Nadu', 'is_default': false},
  ];
  final refuse = <String>{};
  int nextId = 500;

  Future<void> start() async {
    orders.addAll([
      {
        'id': 1,
        'order_number': 'SO-1',
        'company': 'Acme Outdoor',
        'brand_name': 'Acme Cola',
        'crm_reference_id': 'CRM-1',
        'campaign_start_date': '2026-12-01',
        'campaign_end_date': '2026-12-31',
        'vendor_address_id': null,
        'total': 59000,
      },
      {'id': 2, 'order_number': 'SO-2', 'company': 'Bright Brands', 'vendor_address_id': null, 'total': 1000},
      {
        'id': 10,
        'order_number': 'PO-10',
        'company': 'Northern Hoardings',
        'vendor_address_id': 70,
        'order_status': 'Approved',
        'sub_total': 30000,
        'tax_total': 5400,
        'total': 35400,
        'payment_receipt_amount': 10000,
        'order_date': '2026-11-20',
        'campaign_start_date': '2026-12-01',
        'campaign_end_date': '2026-12-31',
      },
      {'id': 11, 'order_number': 'PO-11', 'company': 'Gone Vendor', 'vendor_address_id': 999, 'total': 100},
    ]);
    items.addAll([
      {'id': 100, 'sales_order_id': 1, 'name': 'Hoarding, Ring Road', 'taxable_amount': 50000, 'tax_amount': 9000, 'after_tax_amount': 59000},
      {'id': 101, 'sales_order_id': 1, 'name': 'Printing', 'taxable_amount': 0, 'tax_amount': 0, 'after_tax_amount': 0},
      {
        'id': 200,
        'sales_order_id': 1,
        'purchase_order_id': 10,
        'so_item_id': 100,
        'name': 'Hoarding rent',
        'type': 'Media',
        'is_taxable': true,
        'gst_type': 'Intra-State',
        'taxable_amount': 30000,
        'tax_amount': 5400,
        'after_tax_amount': 35400,
        'cgst_amount': 2700,
        'sgst_amount': 2700,
        'igst_amount': 0,
        'utgst_amount': 0,
        'inv_id': 5,
      },
    ]);
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen(_handle);
  }

  Uri get base => Uri.parse('http://localhost:${server.port}');

  SupabaseRest get rest => SupabaseRest(base: base, apiKey: 'publishable', token: ({bool forceFresh = false}) async => 't');

  List<String> calls(String prefix) => log.where((l) => l.startsWith(prefix)).toList();

  static bool _matches(Object? value, String? filter) {
    if (filter == null) return true;
    if (filter == 'is.null') return value == null;
    if (filter == 'not.is.null') return value != null;
    if (filter.startsWith('eq.')) return '$value' == filter.substring(3);
    if (filter.startsWith('in.')) return RegExp(r'\d+').allMatches(filter).map((m) => m[0]).contains('$value');
    return true;
  }

  Future<void> _handle(HttpRequest request) async {
    final path = request.uri.path;
    final key = '${request.method} $path';
    log.add('$key?${Uri.decodeQueryComponent(request.uri.query)}');
    final raw = await utf8.decoder.bind(request).join();
    final body = raw.isEmpty ? null : jsonDecode(raw);
    final response = request.response..headers.contentType = ContentType.json;
    if (refuse.any(key.startsWith)) {
      response.statusCode = 403;
      response.write('{"message":"denied"}');
      return response.close();
    }
    final q = request.uri.queryParameters;
    final table = switch (path) {
      '/rest/v1/salesorder' => orders,
      '/rest/v1/salesorderdocument' => items,
      '/rest/v1/vendors' => vendors,
      '/rest/v1/vendor_addresses' => addresses,
      _ => null,
    };
    Object out = {};
    if (path == '/rest/v1/rpc/get_settings') {
      out = {'organization': {}, 'lists': []};
    } else if (table == null) {
      response.statusCode = 404;
    } else if (request.method == 'GET') {
      var rows = table
          .where((r) => q.entries.where((e) => !const {'select', 'order', 'or'}.contains(e.key)).every((e) => _matches(r[e.key], e.value)))
          .toList();
      if (q['order'] == 'id.desc') rows.sort((a, b) => (b['id'] as int).compareTo(a['id'] as int));
      if ((q['select'] ?? '').startsWith('*,vendor_addresses(')) {
        rows = [
          for (final r in rows)
            {
              ...r,
              'vendor_addresses': () {
                final a = addresses.where((a) => a['id'] == r['vendor_address_id']).firstOrNull;
                return a == null ? null : {...a, 'vendors': vendors.where((v) => v['id'] == a['vendor_id']).firstOrNull};
              }(),
            },
        ];
      }
      final range = RegExp(r'(\d+)-(\d+)').firstMatch(request.headers.value('range') ?? '0-999')!;
      final from = int.parse(range[1]!);
      final page = rows.skip(from).take(int.parse(range[2]!) - from + 1).toList();
      response.headers.set('content-range', '$from-${from + page.length - 1}/${rows.length}');
      out = page;
    } else if (request.method == 'POST') {
      final added = [
        for (final r in (body is List ? body : [body]).cast<Map<String, dynamic>>()) {...r, 'id': nextId++},
      ];
      table.addAll(added);
      out = body is List ? added : added.single;
    } else if (request.method == 'PATCH') {
      final row = table.firstWhere((r) => _matches(r['id'], q['id']));
      row.addAll(body as Map<String, dynamic>);
      out = row;
    } else if (request.method == 'DELETE') {
      final gone = table.where((r) => _matches(r['id'], q['id'])).toList();
      table.removeWhere(gone.contains);
      if (table == orders) items.removeWhere((i) => gone.any((o) => o['id'] == i['purchase_order_id']));
      out = [
        for (final r in gone) {'id': r['id']},
      ];
    }
    response.write(jsonEncode(out));
    await response.close();
  }
}

ItemDraft line(String key, {String name = 'Hoarding rent', String amount = '20000', String soItemId = ''}) => ItemDraft.blank(key, type: 'Media')
  ..name = name
  ..soItemId = soItemId
  ..setTaxableAmount(amount);

PurchaseOrderDraft draft() => PurchaseOrderDraft.blank(today: '2026-11-13', orderStatus: 'Draft', vendorId: '7', vendorName: 'Northern Hoardings')
  ..chooseSalesOrder(const SalesOrderChoice(id: '1', number: 'SO-1', company: 'Acme Outdoor'))
  ..orderNumber = 'PO-NEW'
  ..vendorAddressId = '70';

void main() {
  group('the web module\'s rules', () {
    test('a purchase order reads its vendor from the address, or the name it stored', () {
      final po = PurchaseOrder({
        'id': 10,
        'company': 'Old name',
        'total': 1000,
        'payment_receipt_amount': 400,
        'vendor_address_id': 70,
        'vendor_addresses': {
          'vendor_id': 7,
          'address': '1 Ring Road',
          'city': 'Pune',
          'state': 'Maharashtra',
          'zipcode': '411001',
          'country': 'India',
          'vendors': {'company_name': 'Northern Hoardings', 'email': 'nh@example.test'},
        },
      });
      expect((po.vendorName, po.vendorId, po.vendorAddressId, po.email), ('Northern Hoardings', '7', '70', 'nh@example.test'));
      expect(po.addressLine, '1 Ring Road, Pune, Maharashtra, 411001, India');
      expect(po.stillToRequest, 600);
      expect(po.title, 'PO #10');
      final bare = PurchaseOrder({'id': 11, 'company': 'Stored Vendor', 'vendor_addresses': null});
      expect((bare.vendorName, bare.requested, bare.stillToRequest), ('Stored Vendor', null, null));
    });

    test('choosing a sales order fills what it has; a new vendor means a new address', () {
      final d = PurchaseOrderDraft.blank(today: '2026-11-13')
        ..brand = 'Kept'
        ..vendorId = '7'
        ..vendorAddressId = '70';
      d.chooseSalesOrder(
        const SalesOrderChoice(
          id: '1',
          number: 'SO-1',
          company: 'Acme',
          crmReference: 'CRM-1',
          campaignStart: '2026-12-01',
          campaignEnd: '2026-12-31',
        ),
      );
      expect((d.salesOrderId, d.soCompany, d.crmReference, d.campaignStart, d.brand), ('1', 'Acme', 'CRM-1', '2026-12-01', 'Kept'));
      d.chooseVendor(const VendorChoice('8', 'Two Address Media'));
      expect((d.vendorId, d.vendorName, d.vendorAddressId), ('8', 'Two Address Media', ''));
    });

    test('the form names each problem where it belongs, the vendor address above all', () {
      final problems = PurchaseOrderDraft.blank(today: '2026-11-13').problems([ItemDraft.blank('a')]);
      expect(problems.keys, ['sales_order_id', 'order_number', 'vendor', 'vendor_address_id', 'item.a.name']);
      expect(problems['vendor_address_id'], 'Choose the vendor address this purchase order goes to.');
      expect(draft().problems([line('a')]), isEmpty);
    });

    test('payloads carry exactly the web\'s columns', () {
      final items = [line('a', soItemId: '100')];
      final totals = reconcileTotals(items);
      final order = draft().payload(totals, createdBy: 'Asha Rao');
      expect(
        (order['company'], order['order_client_fullname'], order['vendor_address_id'], order['multi_purpose_so'], order['created_by']),
        ('Northern Hoardings', 'Northern Hoardings', 70, false, 'Asha Rao'),
      );
      expect(order['total'], 23600.0);
      expect(draft().payload(totals).containsKey('created_by'), isFalse, reason: 'editing never rewrites the creator');
      final item = poItemPayload(items.single, salesOrderId: '1', purchaseOrderId: 500);
      expect((item['sales_order_id'], item['purchase_order_id'], item['so_item_id'], item['reference_type']), (1, 500, 100, 'Purchase Order'));
      expect(item.keys, isNot(contains('document_color')), reason: 'the web PO form has no colour or courier on a line');
      expect(poItemPayload(line('b'), salesOrderId: 1, purchaseOrderId: 500)['so_item_id'], isNull);
    });

    test('the margin counts what was sold only for linked lines, and everything bought', () {
      final m = marginOf([line('a', amount: '30000', soItemId: '100'), line('b', amount: '2000')], const [SoLine('100', 'Hoarding', 50000)]);
      expect((m.sold, m.bought, m.margin), (50000.0, 32000.0, 18000.0));
      expect(purchaseOrderSearchFilter('PO-1'), contains('brand_name.ilike.%PO-1%'));
    });
  });

  group('the list and saving', () {
    late FakeSupabase backend;
    late PurchaseOrdersController controller;

    setUp(() async {
      HttpOverrides.global = null;
      backend = FakeSupabase();
      await backend.start();
      controller = PurchaseOrdersController(
        rest: backend.rest,
        searchDelay: const Duration(milliseconds: 5),
        now: () => DateTime.utc(2026, 11, 13, 9),
      );
    });

    tearDown(() async {
      controller.dispose();
      await backend.server.close(force: true);
    });

    test('only purchase orders, each with the sales order it was raised for', () async {
      await controller.start();
      expect(controller.rows.map((o) => o.orderNumber), ['PO-11', 'PO-10']);
      expect(backend.calls('GET /rest/v1/salesorder?').first, contains('vendor_address_id=not.is.null'));
      final po = controller.rows.firstWhere((o) => o.id == '10');
      expect((po.salesOrder?.number, po.salesOrder?.company, po.vendorName), ('SO-1', 'Acme Outdoor', 'Northern Hoardings'));
      expect(controller.rows.firstWhere((o) => o.id == '11').vendorName, 'Gone Vendor');
    });

    test('when the sales order lookup is refused, the list still shows', () async {
      backend.refuse.add('GET /rest/v1/salesorderdocument');
      await controller.start();
      expect(controller.error, isNull);
      expect(controller.rows, hasLength(2));
      expect(controller.rows.first.salesOrder, isNull);
    });

    test('a sales order\'s lines to link leave out other purchase orders\' lines', () async {
      final lines = await controller.soLinesFor('1');
      expect(lines.map((l) => l.id), ['100', '101']);
      expect(backend.calls('GET /rest/v1/salesorderdocument?').single, contains('purchase_order_id=is.null'));
    });

    test('a new purchase order is added, then its lines in one request, then read back with its vendor', () async {
      final saved = await controller.save(
        null,
        draft(),
        [line('a', soItemId: '100'), line('b', name: 'Mounting', amount: '1000')],
        removed: [],
        createdBy: 'Asha Rao',
      );
      final row = backend.orders.firstWhere((o) => o['id'].toString() == saved.id);
      expect((row['vendor_address_id'], row['total']), (70, 24780.0));
      expect(backend.calls('POST /rest/v1/salesorderdocument?'), hasLength(1));
      final lines = backend.items.where((i) => '${i['purchase_order_id']}' == saved.id).toList();
      expect(lines.map((l) => (l['name'], l['sales_order_id'], l['so_item_id'])), [('Hoarding rent', 1, 100), ('Mounting', 1, null)]);
      expect((saved.vendorName, saved.email, saved.salesOrder?.number), ('Northern Hoardings', 'nh@example.test', 'SO-1'));
      expect(controller.rows.first.id, saved.id);
    });

    test('when the lines are refused, the new purchase order is removed again', () async {
      backend.refuse.add('POST /rest/v1/salesorderdocument');
      await expectLater(controller.save(null, draft(), [line('a')], removed: []), throwsA(isA<ApiException>()));
      expect(backend.orders.where((o) => o['order_number'] == 'PO-NEW'), isEmpty);
    });

    test('editing keeps the vendor address, changes lines in place and keeps their other links', () async {
      await controller.start();
      final existing = controller.rows.firstWhere((o) => o.id == '10');
      final loaded = await controller.loadItems('10');
      expect(loaded.map((l) => l.id), ['200']);
      final d = PurchaseOrderDraft.from(existing)..orderNumber = 'PO-10A';
      expect((d.vendorAddressId, d.salesOrderId), ('70', '1'));
      final kept = ItemDraft.from(loaded.single, 'saved-200')..setTaxableAmount('31000');
      await controller.save(existing, d, [kept, line('n', name: 'Mounting', amount: '500')], removed: []);
      final row = backend.orders.firstWhere((o) => o['id'] == 10);
      expect((row['order_number'], row['vendor_address_id'], row['updated_at']), ('PO-10A', 70, '2026-11-13T09:00:00.000Z'));
      final line200 = backend.items.firstWhere((i) => i['id'] == 200);
      expect((line200['taxable_amount'], line200['so_item_id'], line200['inv_id']), (31000.0, 100, 5));
      expect(backend.items.where((i) => i['purchase_order_id'] == 10).map((i) => i['name']), ['Hoarding rent', 'Mounting']);
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

    const everything = PurchaseOrderAbilities(create: true, edit: true, createdBy: 'Asha Rao');

    Future<PurchaseOrdersController> pump(WidgetTester tester, {PurchaseOrderAbilities abilities = everything, VendorChoice? newOrderFor}) async {
      final controller = PurchaseOrdersController(rest: backend.rest, searchDelay: const Duration(milliseconds: 5));
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: PurchaseOrdersScreen(
            controller: controller,
            platform: PlatformApi(),
            abilities: abilities,
            onOpenDrawer: () {},
            newOrderFor: newOrderFor,
          ),
        ),
      );
      await settle(tester);
      return controller;
    }

    Finder field(String label) => find.widgetWithText(TextField, label);
    Future<void> show(WidgetTester tester, Finder finder) => tester.scrollUntilVisible(finder, 300, scrollable: find.byType(Scrollable).first);

    screenTest('the list shows each purchase order with its vendor, sales order and total', (tester) async {
      await pump(tester);
      expect(find.text('2 purchase orders'), findsOneWidget);
      expect(find.text('PO-10'), findsOneWidget);
      expect(find.text('Northern Hoardings · for SO-1'), findsOneWidget);
      expect(find.text('₹35,400.00'), findsOneWidget);
      expect(find.text('SO-1'), findsNothing, reason: 'sales orders are not listed here');
    });

    screenTest('details: figures, lines without a PO number of their own, the vendor and Edit', (tester) async {
      await pump(tester);
      await tester.tap(find.text('PO-10'));
      await settle(tester);
      expect(find.byType(PurchaseOrderDetailsScreen), findsOneWidget);
      expect(find.text('₹10,000.00'), findsOneWidget, reason: 'payment requested');
      expect(find.text('₹25,400.00'), findsOneWidget, reason: 'still to request');
      expect(find.text('Hoarding rent'), findsOneWidget);
      expect(find.textContaining('PO #'), findsNothing);
      expect(find.text('Email vendor'), findsOneWidget);
      expect(find.byTooltip('Edit purchase order'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('SO-1 · Acme Outdoor'), 300, scrollable: find.byType(Scrollable).first);
      expect(find.text('1 Ring Road, Pune, Maharashtra, 411001, India'), findsOneWidget);
    });

    screenTest('without permission: no New PO and no Edit', (tester) async {
      await pump(tester, abilities: const PurchaseOrderAbilities());
      expect(find.text('New PO'), findsNothing);
      await tester.tap(find.text('PO-10'));
      await settle(tester);
      expect(find.byTooltip('Edit purchase order'), findsNothing);
    });

    screenTest('New PO from a vendor: its address is picked, a sales order fills the campaign, a linked line shows its margin', (tester) async {
      await pump(tester, newOrderFor: const VendorChoice('7', 'Northern Hoardings'));
      expect(find.byType(PurchaseOrderFormScreen), findsOneWidget);
      expect(find.text('Northern Hoardings'), findsOneWidget);
      expect(find.text('1 Ring Road, Pune, Maharashtra'), findsOneWidget, reason: 'its only address, picked for you');

      await tester.tap(find.text('Create'));
      await tester.pump();
      expect(find.text('Choose the sales order this purchase is for.'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('For sales order, required, not chosen. Choose the sales order')), findsOneWidget);
      expect(find.text('Enter a PO number.'), findsOneWidget);

      await tester.tap(find.ancestor(of: find.text('For sales order *'), matching: find.byType(InkWell)).first);
      await settle(tester);
      await tester.tap(find.text('SO-1 — Acme Outdoor'));
      await settle(tester);
      expect(find.text('Acme Outdoor'), findsOneWidget, reason: 'the client, from the sales order');
      await tester.enterText(field('PO number *'), 'PO-777');
      await show(tester, find.text('Acme Cola'));
      expect(find.text('Acme Cola'), findsOneWidget, reason: 'the brand, filled in from the sales order');

      await show(tester, find.text('For sales order line'));
      await tester.tap(find.text('Not linked'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hoarding, Ring Road (₹50,000.00)').last);
      await tester.pumpAndSettle();
      expect(find.text('Hoarding, Ring Road'), findsWidgets, reason: 'the line takes the sales order line\'s name');
      await show(tester, field('Cost before tax'));
      await tester.enterText(field('Cost before tax'), '30000');
      await tester.pump();
      expect(find.textContaining('Margin ₹20,000.00'), findsOneWidget);
      await tester.tap(find.text('Create'));
      await settle(tester);
      final saved = backend.orders.last;
      expect((saved['order_number'], saved['vendor_address_id'], saved['brand_name'], saved['created_by']), ('PO-777', 70, 'Acme Cola', 'Asha Rao'));
      final lineRow = backend.items.last;
      expect((lineRow['so_item_id'], lineRow['sales_order_id'], lineRow['tax_amount']), (100, 1, 5400));
      expect(find.byType(PurchaseOrderDetailsScreen), findsOneWidget);
    });

    screenTest('a vendor with several addresses waits for one to be chosen', (tester) async {
      await pump(tester, newOrderFor: const VendorChoice('8', 'Two Address Media'));
      expect(find.text('Choose an address'), findsOneWidget);
      await tester.tap(find.text('Create'));
      await tester.pump();
      expect(find.text('Choose the vendor address this purchase order goes to.'), findsOneWidget);
    });

    screenTest('editing loads the lines first, and saves in place', (tester) async {
      await pump(tester);
      await tester.tap(find.text('PO-10'));
      await settle(tester);
      await tester.tap(find.byTooltip('Edit purchase order'));
      await settle(tester);
      expect(find.text('1 Ring Road, Pune, Maharashtra'), findsOneWidget);
      await show(tester, find.text('Items (1)'));
      expect(find.text('Items (1)'), findsOneWidget);
      await tester.tap(find.text('Save'));
      await settle(tester);
      expect(backend.calls('PATCH /rest/v1/salesorder?'), hasLength(1));
      expect(backend.items.firstWhere((i) => i['id'] == 200)['so_item_id'], 100, reason: 'the link is kept once the sales order lines load');
      expect(find.text('Purchase order saved'), findsOneWidget);
    });
  });
}
