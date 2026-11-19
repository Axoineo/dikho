import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/sales_orders/sales_order_form_screen.dart';
import 'package:dikho_crm/features/sales_orders/sales_orders_controller.dart';
import 'package:dikho_crm/features/sales_orders/sales_orders_models.dart';
import 'package:dikho_crm/features/sales_orders/sales_orders_screen.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:dikho_crm/shared/platform_api.dart';
import 'package:dikho_crm/shared/record_ui.dart' show PillTone;
import 'package:dikho_crm/shared/supabase_rest.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Native Sales orders against a stand-in for PostgREST. It keeps `salesorder`,
// `salesorderdocument` and `clients` in memory, records every request, and can refuse
// a chosen step or a chosen delete, so each step of a save and its undo is checked.
// Synthetic orders only.

class FakeSupabase {
  late HttpServer server;
  final log = <String>[];
  final bodies = <String, List<Object?>>{};
  final orders = <Map<String, dynamic>>[];
  final items = <Map<String, dynamic>>[];
  final refuse = <String>{}; // e.g. 'POST /rest/v1/salesorderdocument'
  final undeletable = <int>{}; // ids a DELETE leaves alone, as RLS does: no error
  int nextId = 500;

  Future<void> start() async {
    for (var i = 1; i <= 30; i++) {
      orders.add({
        'id': i,
        'order_number': 'SO-$i',
        'company': 'Client $i',
        'order_client_fullname': 'Person $i',
        'order_date': '2026-11-0${i % 9 + 1}',
        'order_status': i == 30 ? 'Approved' : 'Draft',
        'sub_total': 1000 * i,
        'tax_total': 180 * i,
        'total': 1180 * i,
        'payment_receipt_amount': i == 30 ? 10000 : null,
        'created_by_id': i == 29 ? 'someone-else' : 'me',
        'vendor_address_id': null,
        'campaign_start_date': '2026-11-01',
        'campaign_end_date': '2026-11-30',
        'order_color': i == 30 ? '#185494' : null,
      });
    }
    // A purchase order shares the table; the list must never show it.
    orders.add({'id': 99, 'order_number': 'PO-1', 'company': 'Vendor', 'total': 5, 'vendor_address_id': 7});
    items.addAll([
      {
        'id': 301,
        'sales_order_id': 30,
        'name': 'Hoarding, Ring Road',
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
        'inv_id': 55,
        'inv_number': 'INV-55',
        'file_url': 'https://example.test/a.pdf',
      },
      // A purchase order's cost line, bought for SO-30: never one of SO-30's own lines.
      {
        'id': 303,
        'sales_order_id': 30,
        'purchase_order_id': 99,
        'so_item_id': 301,
        'name': 'Vendor rent',
        'taxable_amount': 20000,
        'tax_amount': 3600,
        'after_tax_amount': 23600,
      },
      {
        'id': 302,
        'sales_order_id': 30,
        'name': 'Printing',
        'type': 'Printing',
        'is_taxable': false,
        'taxable_amount': 5400,
        'tax_amount': 0,
        'after_tax_amount': 5400,
        'cgst_amount': 0,
        'sgst_amount': 0,
        'igst_amount': 0,
        'utgst_amount': 0,
        'document_note': 'Flex, 20x10',
      },
    ]);
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen(_handle);
  }

  Uri get base => Uri.parse('http://localhost:${server.port}');

  SupabaseRest get rest => SupabaseRest(base: base, apiKey: 'publishable', token: ({bool forceFresh = false}) async => 't');

  List<String> calls(String prefix) => log.where((l) => l.startsWith(prefix)).toList();

  Future<void> _handle(HttpRequest request) async {
    final path = request.uri.path;
    final key = '${request.method} $path';
    log.add('$key?${Uri.decodeQueryComponent(request.uri.query)}');
    final raw = await utf8.decoder.bind(request).join();
    final body = raw.isEmpty ? null : jsonDecode(raw);
    bodies.putIfAbsent(key, () => []).add(body);
    final response = request.response..headers.contentType = ContentType.json;
    if (refuse.any(key.startsWith)) {
      response.statusCode = 403;
      response.write('{"message":"denied"}');
      return response.close();
    }
    Object out;
    final q = request.uri.queryParameters;
    int? idEq() => q['id'] == null ? null : int.tryParse(q['id']!.replaceFirst('eq.', ''));
    List<int> idsIn() => RegExp(r'\d+').allMatches(q['id'] ?? '').map((m) => int.parse(m[0]!)).toList();
    switch (key) {
      case 'GET /rest/v1/salesorder':
        var rows = orders.reversed.toList();
        if (q['vendor_address_id'] == 'is.null') rows = rows.where((o) => o['vendor_address_id'] == null).toList();
        if (q['order_status'] != null) rows = rows.where((o) => 'eq.${o['order_status']}' == q['order_status']).toList();
        final range = RegExp(r'(\d+)-(\d+)').firstMatch(request.headers.value('range') ?? '0-24')!;
        final from = int.parse(range[1]!);
        final to = int.parse(range[2]!);
        final page = rows.skip(from).take(to - from + 1).toList();
        response.headers.set('content-range', '$from-${from + page.length - 1}/${rows.length}');
        out = page;
      case 'GET /rest/v1/salesorderdocument':
        final order = q['sales_order_id'] == null ? null : int.parse(q['sales_order_id']!.replaceFirst('eq.', ''));
        out = items
            .where((i) => order == null || i['sales_order_id'] == order)
            .where((i) => q['purchase_order_id'] != 'is.null' || i['purchase_order_id'] == null)
            .toList();
      case 'GET /rest/v1/clients':
        out = [
          {'company_name': 'Acme Outdoor', 'contact_person': 'Asha Rao'},
          {'company_name': 'Bright Brands', 'contact_person': null},
        ];
      case 'POST /rest/v1/rpc/get_settings':
        out = {'organization': {}, 'lists': []};
      case 'POST /rest/v1/salesorder':
        final row = {...(body as Map<String, dynamic>), 'id': nextId++, 'created_by_id': 'me', 'vendor_address_id': null};
        orders.add(row);
        out = row;
      case 'POST /rest/v1/salesorderdocument':
        final rows = [
          for (final r in (body as List).cast<Map<String, dynamic>>()) {...r, 'id': nextId++},
        ];
        items.addAll(rows);
        out = rows;
      case 'PATCH /rest/v1/salesorder':
        final row = orders.firstWhere((o) => o['id'] == idEq());
        row.addAll(body as Map<String, dynamic>);
        out = row;
      case 'PATCH /rest/v1/salesorderdocument':
        final row = items.firstWhere((i) => i['id'] == idEq());
        row.addAll(body as Map<String, dynamic>);
        out = row;
      case 'DELETE /rest/v1/salesorder':
        final gone = idsIn().where((id) => !undeletable.contains(id)).toList();
        orders.removeWhere((o) => gone.contains(o['id']));
        items.removeWhere((i) => gone.contains(i['sales_order_id']));
        out = [
          for (final id in gone) {'id': id},
        ];
      case 'DELETE /rest/v1/salesorderdocument':
        final gone = idsIn().where((id) => !undeletable.contains(id) && items.any((i) => i['id'] == id)).toList();
        items.removeWhere((i) => gone.contains(i['id']));
        out = [
          for (final id in gone) {'id': id},
        ];
      default:
        response.statusCode = 404;
        out = {};
    }
    response.write(jsonEncode(out));
    await response.close();
  }
}

ItemDraft line(String key, {String name = 'Hoarding', String amount = '10000', String rate = '18'}) => ItemDraft.blank(key, type: 'Media')
  ..name = name
  ..setRate(rate)
  ..setTaxableAmount(amount);

OrderDraft order({String company = 'Acme Outdoor', String number = 'SO-NEW'}) =>
    OrderDraft.blank(today: '2026-11-12', orderType: 'ATL', orderStatus: 'Draft', purchaseStatus: 'Not Started')
      ..company = company
      ..orderNumber = number;

void main() {
  group('the web module\'s rules', () {
    test('money rounds a half paisa up, as Math.round, and reads as formatRupees writes it', () {
      // Each value checked against the web's own round2 in Node.
      expect(round2(1.005), 1.0, reason: '1.005 * 100 is 100.4999… in binary, in JavaScript too');
      expect(round2(2.675), 2.68, reason: '2.675 * 100 comes out at exactly 267.5');
      expect(round2(0.285), 0.28);
      expect(round2(1.255), 1.25);
      expect(round2('0.125'), 0.13);
      expect(round2(''), 0);
      expect(round2('abc'), 0);
      expect(round2(-0.125), -0.12, reason: 'Math.round(-12.5) is -12');
      expect(numberText(1800), '1800');
      expect(numberText(1800.5), '1800.5');
      expect(rupees(147500), '₹1,47,500.00');
      expect(rupees(147500, style: 'en-US'), '₹147,500.00');
      expect(rupees(null), '—');
      expect(rupees(-500), '-₹500.00');
      expect(plainMoney(900), '900.00');
    });

    test('GST splits so the halves always add back up to the tax', () {
      expect(splitGst('Intra-State', 0.03, true), (cgst: 0.02, sgst: 0.01, igst: 0.0, utgst: 0.0));
      expect(splitGst('Inter-State', 1800, true), (cgst: 0.0, sgst: 0.0, igst: 1800.0, utgst: 0.0));
      expect(splitGst('Union Territory', 1801, true), (cgst: 900.5, sgst: 0.0, igst: 0.0, utgst: 900.5));
      expect(splitGst('Intra-State', 1800, false), (cgst: 0.0, sgst: 0.0, igst: 0.0, utgst: 0.0));
      expect(gstBreakdown(cgst: 900, sgst: 900, igst: 0, utgst: null), 'CGST 900.00 · SGST 900.00');
    });

    test('a line works its tax out from the rate; Custom and GST off behave as on the web', () {
      final item = line('a', amount: '10000');
      expect(item.taxAmount, '1800');
      expect(item.amounts.afterTax, 11800);
      item.setRate('5');
      expect(item.taxAmount, '500');
      item.setRate('custom');
      item.taxAmount = '777';
      item.setTaxableAmount('20000');
      expect(item.taxAmount, '777', reason: 'a custom tax is the person\'s to set');
      item.setTaxable(false);
      expect(item.taxAmount, '0');
      expect(item.amounts.tax, 0);
      item.setRate('12');
      expect(item.taxAmount, '0', reason: 'no GST, whatever the rate');
      item.setTaxable(true);
      expect(item.taxAmount, '2400');
    });

    test('a saved line reads its rate back out of its amounts', () {
      expect(rateFromAmounts(10000, 1800), '18');
      expect(rateFromAmounts(10000, 0), '0');
      expect(rateFromAmounts(10000, 1234), 'custom');
      expect(rateFromAmounts(0, 50), '18');
      final saved = ItemDraft.from(
        OrderItem({'id': 5, 'name': 'X', 'taxable_amount': 1000, 'tax_amount': 50, 'is_taxable': null, 'gst_type': null}),
        'saved-5',
      );
      expect(saved.gstRate, '5');
      expect(saved.isTaxable, isTrue, reason: 'unset means taxable, as on the web');
      expect(saved.gstType, 'Intra-State');
    });

    test('totals come from the lines, and payloads carry exactly the web\'s columns', () {
      final items = [line('a', amount: '10000'), line('b', name: 'Print', amount: '2500.50', rate: '12')..setTaxable(false)];
      final totals = reconcileTotals(items);
      expect((totals.subTotal, totals.taxTotal, totals.total), (12500.5, 1800.0, 14300.5));
      final draft = order()
        ..received = '5000'
        ..contact = ' '
        ..campaignStart = '2026-11-01';
      final payload = draft.payload(totals, createdBy: 'Asha Rao');
      expect(payload['company'], 'Acme Outdoor');
      expect(payload['order_client_fullname'], isNull);
      expect(payload['payment_receipt_amount'], 5000.0);
      expect(payload['total'], 14300.5);
      expect(payload['created_by'], 'Asha Rao');
      expect(payload.containsKey('created_by_id'), isFalse, reason: 'the database fills it, and RLS checks it');
      expect(order().payload(totals).containsKey('created_by'), isFalse, reason: 'editing never rewrites the creator');
      expect((order()..received = '').payload(totals)['payment_receipt_amount'], isNull, reason: 'no payment is not a payment of 0');
      final print = items[1].payload('42');
      expect(print['sales_order_id'], 42);
      expect(print['gst_type'], isNull);
      expect(print['tax_amount'], 0.0);
      expect(print['after_tax_amount'], 2500.5);
      expect(items[0].payload(42)['cgst_amount'], 900.0);
    });

    test('the form names each problem where it belongs', () {
      final items = [ItemDraft.blank('a')];
      final problems =
          (order(company: ' ', number: '')
                ..campaignStart = '2026-11-10'
                ..campaignEnd = '2026-11-09')
              .problems(items);
      expect(problems.keys, containsAll(['company', 'order_number', 'campaign_end_date', 'item.a.name']));
      expect(problems['item.a.name'], 'Item 1 needs a name.');
      expect(order().problems(const []), {'items': 'Add at least one order item.'});
      expect(order().problems([line('a')]), isEmpty);
    });

    test('lists: Settings decides once it has them, until then the values in use join in', () {
      final none = {'lists': []};
      expect(choiceValues(none, 'order_status', orderStatusOptions, ['On hold']), [...orderStatusOptions, 'On hold']);
      final settings = {
        'lists': [
          {'list_key': 'order_status', 'value': 'Open'},
          {'list_key': 'order_status', 'value': 'Gone', 'hidden': true},
          {'list_key': 'row_color', 'value': '#000000', 'label': 'Black'},
        ],
      };
      expect(choiceValues(settings, 'order_status', orderStatusOptions, ['On hold'], 'Gone'), ['Open', 'Gone']);
      expect(colorChoices(settings, ''), [('', 'None'), ('#000000', 'Black')]);
      expect(colorChoices(none, '#185494').where((c) => c.$1 == '#185494').single.$2, 'Blue');
      expect(colorChoices(none, '#123456').last, ('#123456', '#123456'));
      expect(colorValue('#185494'), 0xFF185494);
      expect(colorValue('red'), isNull);
    });

    test('dates, statuses and the search read as on the web', () {
      expect(formatDateRange('2026-04-01', '2026-04-27'), '1–27 Apr 2026');
      expect(formatDateRange('2026-03-28', '2026-04-04'), '28 Mar – 4 Apr 2026');
      expect(formatDateRange('', '2026-04-04'), 'Until 4 Apr 2026');
      expect(formatDateRange('', ''), '');
      expect(campaignDays('2026-11-01', '2026-11-30'), 30);
      expect(campaignDays('2026-11-02', '2026-11-01'), isNull);
      expect(statusTone('Cancelled'), PillTone.danger);
      expect(statusTone('Approved'), PillTone.active);
      expect(statusTone('Pending Approval'), PillTone.pending);
      expect(statusTone('Whatever'), PillTone.neutral);
      expect(orderSearchFilter(' SO-1, (x) '), 'order_number.ilike.%SO-1   x%,company.ilike.%SO-1   x%,crm_reference_id.ilike.%SO-1   x%');
      expect(orderSearchFilter('%_'), isNull);
    });

    test('Edit is offered on every order with all, and only on their own with own', () {
      final mine = SalesOrder({'id': 1, 'created_by_id': 'me'});
      final theirs = SalesOrder({'id': 2, 'created_by_id': 'them'});
      const all = SalesOrderAbilities(editScope: 'all', userId: 'me');
      const own = SalesOrderAbilities(editScope: 'own', userId: 'me');
      expect((all.canEdit(mine), all.canEdit(theirs)), (true, true));
      expect((own.canEdit(mine), own.canEdit(theirs)), (true, false));
      expect(
        const SalesOrderAbilities(editScope: 'team', userId: 'me').canEdit(mine),
        isFalse,
        reason: 'RLS knows only all and own here',
      );
      expect(const SalesOrderAbilities(editScope: 'own').canEdit(SalesOrder({'id': 3, 'created_by_id': ''})), isFalse);
    });
  });

  group('saving, step by step', () {
    late FakeSupabase backend;
    late SalesOrdersController controller;

    setUp(() async {
      HttpOverrides.global = null;
      backend = FakeSupabase();
      await backend.start();
      controller = SalesOrdersController(rest: backend.rest, searchDelay: const Duration(milliseconds: 5), now: () => DateTime.utc(2026, 11, 12, 9));
    });

    tearDown(() async {
      controller.dispose();
      await backend.server.close(force: true);
    });

    test('the list leaves purchase orders out, and the status filter narrows it', () async {
      await controller.start();
      expect(controller.total, 30);
      expect(controller.rows.any((o) => o.orderNumber == 'PO-1'), isFalse);
      expect(backend.calls('GET /rest/v1/salesorder?').first, contains('vendor_address_id=is.null'));
      controller.setStatusFilter('Approved');
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(controller.total, 1);
      expect(controller.rows.single.orderNumber, 'SO-30');
      expect(controller.statusChoices, containsAll(['Draft', 'Approved', 'Cancelled']));
    });

    test('a new order is added, then all its lines in one request', () async {
      final saved = await controller.save(
        null,
        order(),
        [line('a'), line('b', name: 'Print', amount: '500')],
        removed: [],
        createdBy: 'Asha Rao',
      );
      expect(saved.total, 12390.0);
      expect(backend.calls('POST /rest/v1/salesorder?').length, 1);
      expect(backend.calls('POST /rest/v1/salesorderdocument?').length, 1, reason: 'all or none');
      final lines = backend.items.where((i) => i['sales_order_id'] == int.parse(saved.id)).toList();
      expect(lines.map((l) => l['name']), ['Hoarding', 'Print']);
      expect(controller.rows.first.id, saved.id, reason: 'shown on top at once');
    });

    test('when the lines are refused, the new order is removed again', () async {
      backend.refuse.add('POST /rest/v1/salesorderdocument');
      await expectLater(controller.save(null, order(), [line('a')], removed: []), throwsA(isA<ApiException>()));
      expect(backend.orders.where((o) => o['order_number'] == 'SO-NEW'), isEmpty);
      expect(backend.calls('DELETE /rest/v1/salesorder?').single, contains('id=in.('));
    });

    test('when the order cannot be removed either, the message says it exists without its lines', () async {
      backend.refuse.add('POST /rest/v1/salesorderdocument');
      backend.undeletable.add(500);
      await expectLater(
        controller.save(null, order(), [line('a')], removed: []),
        throwsA(
          isA<ApiException>().having((e) => e.message, 'message', startsWith('The order was added without its items, and could not be removed.')),
        ),
      );
      expect(backend.orders.where((o) => o['order_number'] == 'SO-NEW'), hasLength(1));
    });

    test('editing changes lines in place, deletes the removed ones and adds new ones last', () async {
      await controller.start();
      final existing = controller.rows.firstWhere((o) => o.id == '30');
      final loaded = await controller.loadItems('30');
      final first = ItemDraft.from(loaded.first, 'saved-301')..name = 'Hoarding, renamed';
      final removed = <Object>[302];
      final saved = await controller.save(existing, OrderDraft.from(existing), [
        first,
        line('n', name: 'New line', amount: '1000'),
      ], removed: removed);
      expect(removed, isEmpty, reason: 'deleted for real, so saving again never asks twice');
      final order = backend.orders.firstWhere((o) => o['id'] == 30);
      expect(order['updated_at'], '2026-11-12T09:00:00.000Z');
      expect(order.containsKey('created_by'), isFalse);
      expect(saved.total, 35400.0 + 1180.0);
      final lines = backend.items.where((i) => i['sales_order_id'] == 30).toList();
      expect(lines.where((l) => l['purchase_order_id'] == null).map((l) => l['name']), ['Hoarding, renamed', 'New line']);
      expect(lines.firstWhere((l) => l['id'] == 303)['name'], 'Vendor rent', reason: 'the purchase order\'s line is left alone');
      expect(lines.first['id'], 301, reason: 'the same row: purchase orders point at it');
      expect(lines.first['inv_id'], 55, reason: 'links the form never sends are kept');
      final order_ = backend.log.where((l) => l.contains('salesorderdocument') && !l.startsWith('GET')).map((l) => l.split('?').first).toList();
      expect(order_, ['DELETE /rest/v1/salesorderdocument', 'PATCH /rest/v1/salesorderdocument', 'POST /rest/v1/salesorderdocument']);
    });

    test('a delete RLS ignores is reported, and nothing new is added until it is sorted', () async {
      await controller.start();
      final existing = controller.rows.firstWhere((o) => o.id == '30');
      final loaded = await controller.loadItems('30');
      backend.undeletable.add(302);
      final removed = <Object>[302];
      final items = [ItemDraft.from(loaded.first, 'saved-301'), line('n', name: 'New line')];
      await expectLater(
        controller.save(existing, OrderDraft.from(existing), items, removed: removed),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            allOf(startsWith('The order details were saved, but not all of its items were.'), contains('could not be deleted')),
          ),
        ),
      );
      expect(removed, [302]);
      expect(backend.items.where((i) => i['name'] == 'New line'), isEmpty);
      backend.undeletable.clear();
      await controller.save(existing, OrderDraft.from(existing), items, removed: removed);
      expect(backend.items.where((i) => i['name'] == 'New line'), hasLength(1), reason: 'saved again, added once');
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

    const everything = SalesOrderAbilities(create: true, editScope: 'all', userId: 'me', createdBy: 'Asha Rao');

    Future<(SalesOrdersController, List<String>)> pump(
      WidgetTester tester, {
      SalesOrderAbilities abilities = everything,
      ClientChoice? newOrderFor,
    }) async {
      final controller = SalesOrdersController(rest: backend.rest, searchDelay: const Duration(milliseconds: 5));
      addTearDown(controller.dispose);
      final invoices = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: SalesOrdersScreen(
            controller: controller,
            platform: PlatformApi(),
            abilities: abilities,
            onOpenDrawer: () {},
            onTaxInvoice: (o) => invoices.add(o.id),
            newOrderFor: newOrderFor,
          ),
        ),
      );
      await settle(tester);
      return (controller, invoices);
    }

    Finder field(String label) => find.widgetWithText(TextField, label);

    Future<void> showField(WidgetTester tester, Finder finder) => tester.scrollUntilVisible(finder, 300, scrollable: find.byType(Scrollable).first);

    screenTest('the list shows each order with its client, total and status', (tester) async {
      await pump(tester);
      expect(find.text('30 orders'), findsOneWidget);
      expect(find.text('SO-30'), findsOneWidget);
      expect(find.text('Client 30'), findsOneWidget);
      expect(find.text('₹35,400.00'), findsOneWidget);
      expect(find.text('Approved'), findsOneWidget);
      expect(find.text('PO-1'), findsNothing);
    });

    screenTest('details: figures, lines, the tax invoice and Edit', (tester) async {
      final (_, invoices) = await pump(tester);
      await tester.tap(find.text('SO-30'));
      await settle(tester);
      expect(find.byType(SalesOrderDetailsScreen), findsOneWidget);
      expect(find.text('₹35,400.00'), findsWidgets);
      expect(find.text('₹10,000.00'), findsOneWidget, reason: 'received');
      expect(find.text('₹25,400.00'), findsOneWidget, reason: 'balance due');
      expect(find.textContaining('The items add up to ₹40,800.00'), findsOneWidget, reason: 'stored total drifted from the lines');
      expect(find.text('Hoarding, Ring Road'), findsOneWidget);
      expect(find.text('Vendor rent'), findsNothing, reason: 'a purchase order\'s line is not this order\'s');
      expect(backend.calls('GET /rest/v1/salesorderdocument?').first, contains('purchase_order_id=is.null'));
      expect(find.textContaining('INV-55'), findsOneWidget);
      expect(find.text('Not taxable'), findsOneWidget);
      expect(find.text('Open attachment'), findsOneWidget);
      expect(find.byTooltip('Edit order'), findsOneWidget);
      await tester.tap(find.text('Tax invoice'));
      expect(invoices, ['30']);
    });

    screenTest('own edit scope: Edit only on orders this person created; no New order without create', (tester) async {
      await pump(
        tester,
        abilities: const SalesOrderAbilities(editScope: 'own', userId: 'me'),
      );
      expect(find.text('New order'), findsNothing);
      await tester.tap(find.text('SO-29'));
      await settle(tester);
      expect(find.byTooltip('Edit order'), findsNothing, reason: 'someone else made SO-29');
      await tester.pageBack();
      await settle(tester);
      await tester.tap(find.text('SO-28'));
      await settle(tester);
      expect(find.byTooltip('Edit order'), findsOneWidget);
    });

    screenTest('a new order: problems first, then a client, a number and a line, saved and opened', (tester) async {
      await pump(tester);
      await tester.tap(find.text('New order'));
      await settle(tester);
      expect(find.byType(SalesOrderFormScreen), findsOneWidget);
      await tester.tap(find.text('Create'));
      await tester.pump();
      expect(find.text('Some fields need attention. They are marked below.'), findsOneWidget);
      expect(find.text('Choose the client this order belongs to.'), findsOneWidget);
      expect(
        find.bySemanticsLabel(RegExp('Client, required, not chosen. Choose the client this order belongs to.')),
        findsOneWidget,
        reason: 'a screen reader hears why, too',
      );
      expect(find.text('Enter an order number.'), findsOneWidget);
      expect(backend.calls('POST /rest/v1/salesorder?'), isEmpty);

      await tester.tap(find.ancestor(of: find.text('Client *'), matching: find.byType(InkWell)).first);
      await settle(tester);
      await tester.tap(find.text('Acme Outdoor'));
      await settle(tester);
      expect(find.text('Acme Outdoor'), findsOneWidget);
      await tester.enterText(field('Order number *'), 'SO-777');
      await showField(tester, field('Item *'));
      await tester.enterText(field('Item *'), 'Hoarding');
      await showField(tester, field('Amount before tax'));
      await tester.enterText(field('Amount before tax'), '10000');
      await tester.pump();
      expect(find.text('₹11,800.00'), findsWidgets, reason: '18% worked out as it is typed');
      await tester.enterText(field('Amount before tax'), '1.234');
      await tester.pump();
      expect(find.text('₹11,800.00'), findsWidgets, reason: 'a third decimal is not taken');
      await tester.tap(find.text('Create'));
      await settle(tester);
      final saved = backend.orders.last;
      expect(
        (saved['order_number'], saved['company'], saved['order_client_fullname'], saved['total'], saved['created_by']),
        ('SO-777', 'Acme Outdoor', 'Asha Rao', 11800, 'Asha Rao'),
      );
      expect(backend.items.last['tax_amount'], 1800);
      expect(find.byType(SalesOrderDetailsScreen), findsOneWidget);
      expect(find.text('SO-777'), findsOneWidget);
    });

    screenTest('New order on a client opens the form with that client chosen', (tester) async {
      await pump(tester, newOrderFor: const ClientChoice('Acme Outdoor', 'Asha Rao'));
      expect(find.byType(SalesOrderFormScreen), findsOneWidget);
      expect(find.text('Acme Outdoor'), findsOneWidget);
    });

    screenTest('closing a changed form asks first; an unchanged one just closes', (tester) async {
      await pump(tester);
      await tester.tap(find.text('New order'));
      await settle(tester);
      await tester.tap(find.byTooltip('Close'));
      await settle(tester);
      expect(find.byType(SalesOrderFormScreen), findsNothing);
      await tester.tap(find.text('New order'));
      await settle(tester);
      await tester.enterText(field('Order number *'), 'Draft');
      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();
      expect(find.text('Discard your changes?'), findsOneWidget);
      await tester.tap(find.text('Keep editing'));
      await tester.pumpAndSettle();
      expect(find.byType(SalesOrderFormScreen), findsOneWidget);
    });

    screenTest('editing loads the lines first, keeps the last one, and saves in place', (tester) async {
      await pump(tester);
      await tester.tap(find.text('SO-30'));
      await settle(tester);
      await tester.tap(find.byTooltip('Edit order'));
      await settle(tester);
      expect(find.text('Items (2)'), findsOneWidget);
      await showField(tester, find.byTooltip('Remove item 2'));
      await tester.tap(find.byTooltip('Remove item 2'));
      await tester.pump();
      expect(find.byTooltip('Remove item 2'), findsNothing);
      // The list's header is scrolled away by now; the last line says why it stays.
      await tester.scrollUntilVisible(find.byTooltip('An order needs at least one item'), -300, scrollable: find.byType(Scrollable).first);
      final keep = tester.widget<IconButton>(
        find.ancestor(of: find.byTooltip('An order needs at least one item'), matching: find.byType(IconButton)),
      );
      expect(keep.onPressed, isNull, reason: 'an order needs at least one item');
      await tester.tap(find.text('Save'));
      await settle(tester);
      expect(backend.items.where((i) => i['sales_order_id'] == 30).map((i) => i['id']), [301, 303], reason: 'the purchase order line stays');
      expect(backend.orders.firstWhere((o) => o['id'] == 30)['total'], 35400);
      expect(find.byType(SalesOrderDetailsScreen), findsOneWidget);
      expect(find.text('Sales order saved'), findsOneWidget);
    });
  });
}
