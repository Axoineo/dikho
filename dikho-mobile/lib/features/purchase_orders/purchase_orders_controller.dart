import '../../shared/crm_api.dart';
import '../../shared/paged_rows.dart';
import '../../shared/values.dart';
import '../sales_orders/sales_orders_models.dart';
import 'purchase_orders_models.dart';

/// Purchase orders, newest first, with the web page's search, and saving one with its
/// lines. RLS decides who may see, add or change one (purchase_orders.view, .create,
/// .edit); the screens only choose what to offer.
class PurchaseOrdersController extends PagedRows<PurchaseOrder> {
  PurchaseOrdersController({required super.rest, super.pageSize, super.searchDelay, DateTime Function()? now})
    : _now = now ?? DateTime.now,
      super(table: 'salesorder', order: 'id.desc', select: poSelect);

  final DateTime Function() _now;

  static const itemsTable = 'salesorderdocument';

  /// get_settings, for the lists and the number style.
  Object? settings;

  List<SalesOrderChoice> salesOrders = const [];
  bool salesOrdersLoaded = false;
  String? salesOrdersError;

  List<VendorChoice> vendors = const [];
  bool vendorsLoaded = false;
  String? vendorsError;

  DateTime now() => _now();

  String get numberStyle => numberStyleFrom(settings);

  @override
  PurchaseOrder parse(Map<String, dynamic> row) => PurchaseOrder(row);

  @override
  String idOf(PurchaseOrder row) => row.id;

  @override
  String? searchFilter(String query) => purchaseOrderSearchFilter(query);

  /// Only rows with a vendor address: the rest are sales orders.
  @override
  Map<String, String> get filters => const {'vendor_address_id': 'not.is.null'};

  /// Which sales order each one was raised for, read from its lines, as
  /// attachSalesOrders does. Without it (no sales_orders.view) the number is left out.
  @override
  Future<List<PurchaseOrder>> withExtras(List<PurchaseOrder> page) async {
    final ids = [
      for (final order in page)
        if (RegExp(r'^\d{1,18}$').hasMatch(order.id)) order.id,
    ];
    if (ids.isEmpty) return page;
    try {
      final links = await rest.select(
        itemsTable,
        query: {'select': 'purchase_order_id,sales_order_id', 'purchase_order_id': 'in.(${ids.join(',')})'},
        from: 0,
        to: 999,
      );
      final soFor = <String, String>{};
      for (final link in links.rows) {
        final po = '${link['purchase_order_id']}';
        final so = link['sales_order_id'];
        if (so != null && !soFor.containsKey(po)) soFor[po] = '$so';
      }
      final soIds = soFor.values.toSet().where((id) => RegExp(r'^\d{1,18}$').hasMatch(id)).toList();
      final named = <String, LinkedSalesOrder>{};
      if (soIds.isNotEmpty) {
        final found = await rest.select(
          'salesorder',
          query: {'select': 'id,order_number,company', 'id': 'in.(${soIds.join(',')})'},
          from: 0,
          to: 999,
        );
        for (final row in found.rows) {
          final id = '${row['id']}';
          named[id] = LinkedSalesOrder(
            id: id,
            number: (row['order_number']?.toString() ?? '').trim(),
            company: (row['company']?.toString() ?? '').trim(),
          );
        }
      }
      return [
        for (final order in page)
          soFor[order.id] == null ? order : order.withSalesOrder(named[soFor[order.id]] ?? LinkedSalesOrder(id: soFor[order.id]!)),
      ];
    } on ApiException {
      return page;
    }
  }

  Future<void> start() async {
    await Future.wait([reload(), loadSettings()]);
  }

  Future<void> loadSettings() async {
    try {
      settings = await rest.rpc('get_settings');
    } on ApiException {
      // The built-in lists stand in.
    }
    notify();
  }

  /// The sales orders a purchase can be for, newest first, up to 1,000, as the web form.
  Future<void> loadSalesOrders() async {
    try {
      final page = await rest.select(
        'salesorder',
        query: {
          'select': 'id,order_number,company,crm_reference_id,campaign_start_date,campaign_end_date,brand_name',
          'vendor_address_id': 'is.null',
          'order': 'id.desc',
        },
        from: 0,
        to: 999,
      );
      salesOrders = page.rows.map(SalesOrderChoice.from).toList();
      salesOrdersLoaded = true;
      salesOrdersError = null;
    } on ApiException catch (failure) {
      salesOrdersError = failure.message;
    }
    notify();
  }

  /// The vendors, by name, up to 1,000.
  Future<void> loadVendors() async {
    try {
      final page = await rest.select('vendors', query: {'select': 'id,company_name,alias', 'order': 'company_name.asc'}, from: 0, to: 999);
      vendors = [
        for (final row in page.rows)
          if (row['id'] != null)
            VendorChoice('${row['id']}', (row['company_name']?.toString() ?? '').trim(), alias: (row['alias']?.toString() ?? '').trim()),
      ];
      vendorsLoaded = true;
      vendorsError = null;
    } on ApiException catch (failure) {
      vendorsError = failure.message;
    }
    notify();
  }

  Future<List<AddressChoice>> addressesFor(String vendorId) async {
    final page = await rest.select(
      'vendor_addresses',
      query: {'select': 'id,address,city,state,is_default', 'vendor_id': 'eq.$vendorId', 'order': 'id.asc'},
      from: 0,
      to: 99,
    );
    return page.rows.map(AddressChoice.from).toList();
  }

  /// A sales order's own lines, the ones a purchase line can supply.
  Future<List<SoLine>> soLinesFor(String salesOrderId) async {
    final page = await rest.select(
      itemsTable,
      query: {'select': 'id,name,taxable_amount', 'sales_order_id': 'eq.$salesOrderId', 'purchase_order_id': 'is.null', 'order': 'id.asc'},
      from: 0,
      to: 999,
    );
    return [for (final row in page.rows) SoLine('${row['id']}', (row['name']?.toString() ?? '').trim(), toAmount(row['taxable_amount']))];
  }

  /// A purchase order's lines, oldest first.
  Future<List<OrderItem>> loadItems(String orderId) async {
    final page = await rest.select(itemsTable, query: {'select': '*', 'purchase_order_id': 'eq.$orderId', 'order': 'id.asc'}, from: 0, to: 999);
    return page.rows.map(OrderItem.new).toList();
  }

  /// Adds a purchase order with its lines, or changes [existing], as handleSubmit in
  /// PurchaseOrdersPage.jsx does. [removed] holds the ids of saved lines taken off; each
  /// is dropped from it once it is really deleted, so saving again never asks twice.
  Future<PurchaseOrder> save(
    PurchaseOrder? existing,
    PurchaseOrderDraft draft,
    List<ItemDraft> items, {
    required List<Object> removed,
    String? createdBy,
  }) async {
    final OrderTotals totals;
    try {
      totals = reconcileTotals(items);
    } on OrderMathException catch (problem) {
      throw ApiException(problem.message);
    }
    final saved = existing == null ? await _create(draft, items, totals, createdBy) : await _update(existing, draft, items, removed, totals);
    // The saved row has no vendor embedded: read it back with one, so the list and the
    // details show the vendor at once. Without it, the saved row still does.
    var order = PurchaseOrder(saved);
    try {
      final again = await rest.select(table, query: {'select': poSelect, 'id': 'eq.${saved['id']}'}, from: 0, to: 0);
      if (again.rows.isNotEmpty) order = PurchaseOrder(again.rows.first);
    } on ApiException {
      // The details fall back to the name stored on the order.
    }
    order = order.withSalesOrder(LinkedSalesOrder(id: draft.salesOrderId, number: draft.soNumber, company: draft.soCompany));
    upsert(order);
    return order;
  }

  Future<Map<String, dynamic>> _create(PurchaseOrderDraft draft, List<ItemDraft> items, OrderTotals totals, String? createdBy) async {
    final saved = await rest.insert(table, draft.payload(totals, createdBy: createdBy));
    final id = saved['id'];
    if (id == null) throw const ApiException('The purchase order was created but no ID came back, so its items could not be linked to it.');
    try {
      await rest.insertMany(itemsTable, [for (final item in items) poItemPayload(item, salesOrderId: draft.salesOrderId, purchaseOrderId: id)]);
    } on ApiException catch (failure) {
      // Nothing points at the new order yet, so removing it is safer than leaving an
      // order behind without its lines. When that is not allowed either, say so.
      Set<String> gone = const {};
      try {
        gone = await rest.deleteIds(table, [id]);
      } on ApiException {
        // Reported below.
      }
      if (!gone.contains('$id')) {
        throw ApiException(
          'The purchase order was added without its items, and could not be removed. Open it, edit it and add the items. ${failure.message}',
        );
      }
      rethrow;
    }
    return saved;
  }

  Future<Map<String, dynamic>> _update(
    PurchaseOrder existing,
    PurchaseOrderDraft draft,
    List<ItemDraft> items,
    List<Object> removed,
    OrderTotals totals,
  ) async {
    final stamp = _now().toUtc().toIso8601String();
    final saved = await rest.update(table, id: existing.id, patch: {...draft.payload(totals), 'updated_at': stamp});
    // Saved from here on. Lines change in place, never cleared and added again.
    try {
      if (removed.isNotEmpty) {
        final gone = await rest.deleteIds(itemsTable, [...removed]);
        removed.removeWhere((id) => gone.contains('$id'));
        if (removed.isNotEmpty) throw const ApiException('Some of the items you removed could not be deleted. You may not have permission.');
      }
      for (final item in items.where((i) => i.id != null)) {
        await rest.update(
          itemsTable,
          id: item.id!,
          patch: {
            ...poItemPayload(item, salesOrderId: draft.salesOrderId, purchaseOrderId: existing.id),
            'updated_at': stamp,
          },
        );
      }
      final fresh = [
        for (final item in items.where((i) => i.id == null)) poItemPayload(item, salesOrderId: draft.salesOrderId, purchaseOrderId: existing.id),
      ];
      // Added last and all at once, so saving again never adds a line twice.
      if (fresh.isNotEmpty) await rest.insertMany(itemsTable, fresh);
    } on ApiException catch (failure) {
      throw ApiException('The purchase order details were saved, but not all of its items were. Save again to finish. ${failure.message}');
    }
    return {...existing.raw, ...saved};
  }
}
