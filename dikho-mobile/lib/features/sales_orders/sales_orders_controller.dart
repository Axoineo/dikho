import '../../shared/crm_api.dart';
import '../../shared/paged_rows.dart';
import '../../shared/values.dart';
import 'sales_orders_models.dart';

/// A client the order can be for, as the form's client list reads `clients`.
class ClientChoice {
  const ClientChoice(this.company, this.contact);

  final String company;
  final String contact;
}

/// The values the orders already use, for the dropdowns until Settings has its lists.
class OrderFacets {
  const OrderFacets({this.orderTypes = const [], this.orderStatuses = const [], this.purchaseStatuses = const [], this.itemTypes = const []});

  final List<String> orderTypes;
  final List<String> orderStatuses;
  final List<String> purchaseStatuses;
  final List<String> itemTypes;
}

/// Sales orders, newest first, with the web page's search and status filter, and
/// saving one with its items. RLS decides who may see, add or change an order
/// (sales_orders.view, .create and .edit, each 'own' or 'all'); the screens only
/// choose what to offer.
class SalesOrdersController extends PagedRows<SalesOrder> {
  SalesOrdersController({required super.rest, super.pageSize, super.searchDelay, DateTime Function()? now})
    : _now = now ?? DateTime.now,
      super(table: 'salesorder', order: 'id.desc');

  final DateTime Function() _now;

  static const itemsTable = 'salesorderdocument';

  String? statusFilter;

  /// get_settings, for the lists and the number style. Null until it loads, or when it
  /// cannot, and the built-in lists stand in.
  Object? settings;
  OrderFacets facets = const OrderFacets();

  List<ClientChoice> clients = const [];
  bool clientsLoaded = false;
  String? clientsError;

  DateTime now() => _now();

  String get numberStyle => numberStyleFrom(settings);

  @override
  SalesOrder parse(Map<String, dynamic> row) => SalesOrder(row);

  @override
  String idOf(SalesOrder row) => row.id;

  @override
  String? searchFilter(String query) => orderSearchFilter(query);

  /// Purchase orders share the table and carry a vendor address: never these.
  @override
  Map<String, String> get filters => {'vendor_address_id': 'is.null', if (statusFilter != null) 'order_status': 'eq.$statusFilter'};

  bool get filtered => statusFilter != null;

  Future<void> start() async {
    await Future.wait([reload(), loadChoices()]);
  }

  void setStatusFilter(String? status) {
    statusFilter = status == null || status.isEmpty ? null : status;
    filtersChanged();
  }

  /// Every status the list can hold: the ones Settings offers and any already used.
  List<String> get statusChoices => {...listValues(settings, 'order_status', orderStatusOptions), ...facets.orderStatuses}.toList();

  /// Settings and the values already in use, as loadFacets on the web page.
  Future<void> loadChoices() async {
    try {
      settings = await rest.rpc('get_settings');
    } on ApiException {
      // The built-in lists stand in.
    }
    try {
      final results = await Future.wait([
        rest.select('salesorder', query: {'select': 'order_type,order_status,purchase_status', 'vendor_address_id': 'is.null'}, from: 0, to: 999),
        rest.select(itemsTable, query: {'select': 'type', 'purchase_order_id': 'is.null'}, from: 0, to: 999),
      ]);
      List<String> distinct(List<Map<String, dynamic>> rows, String key) => {
        for (final row in rows)
          if ((row[key]?.toString() ?? '').trim().isNotEmpty) row[key].toString(),
      }.toList();
      facets = OrderFacets(
        orderTypes: distinct(results[0].rows, 'order_type'),
        orderStatuses: distinct(results[0].rows, 'order_status'),
        purchaseStatuses: distinct(results[0].rows, 'purchase_status'),
        itemTypes: distinct(results[1].rows, 'type'),
      );
    } on ApiException {
      // The dropdowns offer the built-in values.
    }
    notify();
  }

  /// The clients an order can be for, as the web form loads them: up to 1,000, by name.
  Future<void> loadClients() async {
    try {
      final page = await rest.select('clients', query: {'select': 'company_name,contact_person', 'order': 'company_name.asc'}, from: 0, to: 999);
      clients = [
        for (final row in page.rows)
          if ((row['company_name']?.toString() ?? '').trim().isNotEmpty)
            ClientChoice(row['company_name'].toString(), (row['contact_person']?.toString() ?? '').trim()),
      ];
      clientsLoaded = true;
      clientsError = null;
    } on ApiException catch (failure) {
      clientsError = failure.message;
    }
    notify();
  }

  /// An order's own lines, oldest first. A purchase order's lines carry the sales
  /// order's id too (to say what they were bought for), with purchase_order_id set:
  /// they are never this order's lines.
  /// One sales order as it is now, for its tax invoice; null when it is gone or this
  /// person's access does not include it (RLS decides, as on the web).
  Future<SalesOrder?> loadOrder(String orderId) async {
    final page = await rest.select('salesorder', query: {'select': '*', 'id': 'eq.$orderId', 'vendor_address_id': 'is.null'}, from: 0, to: 0);
    return page.rows.isEmpty ? null : SalesOrder(page.rows.first);
  }

  Future<List<OrderItem>> loadItems(String orderId) async {
    final page = await rest.select(
      itemsTable,
      query: {'select': '*', 'sales_order_id': 'eq.$orderId', 'purchase_order_id': 'is.null', 'order': 'id.asc'},
      from: 0,
      to: 999,
    );
    return page.rows.map(OrderItem.new).toList();
  }

  /// Adds an order with its items, or changes [existing], as handleSubmit in
  /// SalesOrdersPage.jsx does. [removed] holds the ids of saved lines taken off the
  /// order; each one is dropped from it once it is really deleted, so saving again
  /// after a failure never asks twice.
  Future<SalesOrder> save(SalesOrder? existing, OrderDraft draft, List<ItemDraft> items, {required List<Object> removed, String? createdBy}) async {
    final OrderTotals totals;
    try {
      totals = reconcileTotals(items);
    } on OrderMathException catch (problem) {
      throw ApiException(problem.message);
    }
    final order = existing == null ? await _create(draft, items, totals, createdBy) : await _update(existing, draft, items, removed, totals);
    upsert(order);
    // A new status or type can add a choice.
    loadChoices().ignore();
    return order;
  }

  Future<SalesOrder> _create(OrderDraft draft, List<ItemDraft> items, OrderTotals totals, String? createdBy) async {
    // created_by_id is filled by the database, and RLS requires it to be this person.
    final saved = await rest.insert('salesorder', draft.payload(totals, createdBy: createdBy));
    final id = saved['id'];
    if (id == null) throw const ApiException('The sales order was created but no ID came back, so its items could not be linked to it.');
    try {
      await rest.insertMany(itemsTable, [for (final item in items) item.payload(id)]);
    } on ApiException catch (failure) {
      // Nothing points at the new order yet, so removing it is safer than leaving an
      // order behind without its items. When that is not allowed either, say so.
      Set<String> gone = const {};
      try {
        gone = await rest.deleteIds('salesorder', [id]);
      } on ApiException {
        // Reported below.
      }
      if (!gone.contains('$id')) {
        throw ApiException('The order was added without its items, and could not be removed. Open it, edit it and add the items. ${failure.message}');
      }
      rethrow;
    }
    return SalesOrder(saved);
  }

  Future<SalesOrder> _update(SalesOrder existing, OrderDraft draft, List<ItemDraft> items, List<Object> removed, OrderTotals totals) async {
    final stamp = _now().toUtc().toIso8601String();
    final saved = await rest.update('salesorder', id: existing.id, patch: {...draft.payload(totals), 'updated_at': stamp});
    // The order is saved from here on. Lines are changed in place, never cleared and
    // added again: their ids are referenced by purchase orders and invoices.
    try {
      if (removed.isNotEmpty) {
        final gone = await rest.deleteIds(itemsTable, [...removed]);
        removed.removeWhere((id) => gone.contains('$id'));
        if (removed.isNotEmpty) throw const ApiException('Some of the items you removed could not be deleted. You may not have permission.');
      }
      for (final item in items.where((i) => i.id != null)) {
        await rest.update(itemsTable, id: item.id!, patch: {...item.payload(existing.id), 'updated_at': stamp});
      }
      final fresh = [for (final item in items.where((i) => i.id == null)) item.payload(existing.id)];
      // Added last and all at once: a failure before this adds nothing, so saving
      // again never adds a line twice.
      if (fresh.isNotEmpty) await rest.insertMany(itemsTable, fresh);
    } on ApiException catch (failure) {
      throw ApiException('The order details were saved, but not all of its items were. Save again to finish. ${failure.message}');
    }
    return SalesOrder({...existing.raw, ...saved});
  }
}
