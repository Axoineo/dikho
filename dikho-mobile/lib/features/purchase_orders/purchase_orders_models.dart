/// Purchase orders, as src/features/purchase-orders/PurchaseOrdersPage.jsx reads and
/// writes them. A purchase order is a `salesorder` row with vendor_address_id set (the
/// rule RLS uses too); its lines are `salesorderdocument` rows with purchase_order_id
/// set, whose sales_order_id says which sales order they were bought for. The money
/// rules are the sales order ones, in sales_orders_models.dart.
library;

import '../../shared/record_ui.dart' show formatDisplayDate;
import '../sales_orders/sales_orders_models.dart';

/// The vendor and its address come with each order, through vendor_address_id. Someone
/// without vendors.view gets nothing embedded, and the vendor name stored on the order
/// (`company`) stands in.
const poSelect =
    '*,vendor_addresses(id,vendor_id,address,city,state,country,zipcode,vendors(id,company_name,contact_person,alias,email,gstin,pan_number,vendor_type))';

const poItemTypeOptions = ['Media', 'Production', 'Printing', 'Installation', 'Service', 'Other'];

/// The sales order a purchase order was raised for, read from its lines.
class LinkedSalesOrder {
  const LinkedSalesOrder({required this.id, this.number = '', this.company = ''});

  final String id;
  final String number;
  final String company;

  String get label => [number, company].where((p) => p.isNotEmpty).join(' · ');
}

String _day(Object? value) {
  final text = (value?.toString() ?? '').trim();
  return text.length >= 10 ? text.substring(0, 10) : text;
}

class PurchaseOrder {
  PurchaseOrder(this.raw, {this.salesOrder});

  final Map<String, dynamic> raw;
  final LinkedSalesOrder? salesOrder;

  PurchaseOrder withSalesOrder(LinkedSalesOrder? value) => PurchaseOrder(raw, salesOrder: value);

  String _text(String key) => (raw[key]?.toString() ?? '').trim();

  Map<String, dynamic> get _address => raw['vendor_addresses'] is Map<String, dynamic> ? raw['vendor_addresses'] as Map<String, dynamic> : const {};
  Map<String, dynamic> get _vendor => _address['vendors'] is Map<String, dynamic> ? _address['vendors'] as Map<String, dynamic> : const {};
  String _of(Map<String, dynamic> map, String key) => (map[key]?.toString() ?? '').trim();

  String get id => raw['id']?.toString() ?? '';
  String get orderNumber => _text('order_number');
  String get title => orderNumber.isEmpty ? 'PO #$id' : orderNumber;

  String get vendorName => _of(_vendor, 'company_name').isNotEmpty ? _of(_vendor, 'company_name') : _text('company');
  String get vendorId => _of(_address, 'vendor_id');
  String get vendorAddressId => _text('vendor_address_id');
  String get contactPerson => _of(_vendor, 'contact_person');
  String get alias => _of(_vendor, 'alias');
  String get email => _of(_vendor, 'email');
  String get gstin => _of(_vendor, 'gstin');
  String get pan => _of(_vendor, 'pan_number');
  String get place => [_of(_address, 'city'), _of(_address, 'state')].where((p) => p.isNotEmpty).join(', ');

  /// The full address, as the web panel joins it.
  String get addressLine {
    final local = [_of(_address, 'city'), _of(_address, 'state'), _of(_address, 'zipcode')].where((p) => p.isNotEmpty).join(', ');
    return [_of(_address, 'address'), local, _of(_address, 'country')].where((p) => p.isNotEmpty).join(', ');
  }

  String get orderStatus => _text('order_status');
  String get orderType => _text('order_type');
  String get crmReference => _text('crm_reference_id');
  String get brand => _text('brand_name');
  String get color => _text('order_color');
  String get approvedBy => _text('approved_by');
  String get createdBy => _text('created_by');
  String get orderDate => _day(raw['order_date']);
  String get campaignStart => _day(raw['campaign_start_date']);
  String get campaignEnd => _day(raw['campaign_end_date']);
  String get approvedDate => _day(raw['approved_date']);
  String get completeDate => _day(raw['complete_date']);
  String get createdAt => _text('created_at');
  String get updatedAt => _text('updated_at');

  Object? get subTotal => raw['sub_total'];
  Object? get taxTotal => raw['tax_total'];
  Object? get total => raw['total'];

  /// "Payment requested": the same column a sales order uses for payment received.
  Object? get requested {
    final value = raw['payment_receipt_amount'];
    return value == null || (value is String && value.trim().isEmpty) ? null : value;
  }

  double? get stillToRequest => requested == null ? null : round2(toAmount(total) - toAmount(requested));

  /// The list row's second line.
  String get subtitle => vendorName.isEmpty ? 'No vendor' : vendorName;

  /// For the date line in the list: the date, else when it was made.
  String get when => orderDate.isNotEmpty ? formatDisplayDate(orderDate) : '';
}

/// The PostgREST `or` filter for a search, as poSearchFilter builds it. Every column
/// here is text in the database.
String? purchaseOrderSearchFilter(String query) {
  final text = query.replaceAll(RegExp(r'[%_]'), '').replaceAll(RegExp(r'[(),"\\]'), ' ').trim();
  if (text.isEmpty) return null;
  return [
    for (final column in const ['order_number', 'company', 'crm_reference_id', 'brand_name']) '$column.ilike.%$text%',
  ].join(',');
}

/// A sales order a purchase can be for, with what the form fills in from it.
class SalesOrderChoice {
  const SalesOrderChoice({
    required this.id,
    this.number = '',
    this.company = '',
    this.crmReference = '',
    this.campaignStart = '',
    this.campaignEnd = '',
    this.brand = '',
  });

  factory SalesOrderChoice.from(Map<String, dynamic> row) {
    String text(String key) => (row[key]?.toString() ?? '').trim();
    return SalesOrderChoice(
      id: text('id'),
      number: text('order_number'),
      company: text('company'),
      crmReference: text('crm_reference_id'),
      campaignStart: _day(row['campaign_start_date']),
      campaignEnd: _day(row['campaign_end_date']),
      brand: text('brand_name'),
    );
  }

  final String id;
  final String number;
  final String company;
  final String crmReference;
  final String campaignStart;
  final String campaignEnd;
  final String brand;

  /// "SO-12 — Acme", as the web list words it.
  String get label => '${number.isEmpty ? 'Order #$id' : number} — ${company.isEmpty ? 'No client' : company}';
}

class VendorChoice {
  const VendorChoice(this.id, this.name, {this.alias = ''});

  final String id;
  final String name;
  final String alias;

  String get label => alias.isEmpty ? name : '$name ($alias)';
}

class AddressChoice {
  const AddressChoice(this.id, this.label, {this.isDefault = false});

  factory AddressChoice.from(Map<String, dynamic> row) {
    final parts = [
      for (final key in const ['address', 'city', 'state']) (row[key]?.toString() ?? '').trim(),
    ].where((p) => p.isNotEmpty);
    return AddressChoice('${row['id']}', parts.isEmpty ? 'Address #${row['id']}' : parts.join(', '), isDefault: row['is_default'] == true);
  }

  final String id;
  final String label;
  final bool isDefault;
}

/// A sales order line a purchase line can supply, for the margin on it.
class SoLine {
  const SoLine(this.id, this.name, this.taxable);

  final String id;
  final String name;
  final double taxable;
}

/// The order's own fields while it is edited, as blankPOForm and poToForm hold them.
class PurchaseOrderDraft {
  PurchaseOrderDraft.blank({required String today, this.orderType = '', this.orderStatus = '', this.vendorId = '', this.vendorName = ''})
    : orderNumber = '',
      crmReference = '',
      orderDate = today,
      campaignStart = '',
      campaignEnd = '',
      brand = '',
      color = '',
      requested = '',
      approvedBy = '',
      approvedDate = '',
      completeDate = '',
      salesOrderId = '',
      soNumber = '',
      soCompany = '',
      vendorAddressId = '';

  /// Everything carried over from the saved row, the vendor address above all: saved
  /// without it, a purchase order turns into a sales order (or RLS refuses it).
  PurchaseOrderDraft.from(PurchaseOrder order)
    : orderNumber = order.raw['order_number']?.toString() ?? '',
      crmReference = order.raw['crm_reference_id']?.toString() ?? '',
      orderType = order.orderType,
      orderDate = order.orderDate,
      orderStatus = order.orderStatus,
      campaignStart = order.campaignStart,
      campaignEnd = order.campaignEnd,
      brand = order.raw['brand_name']?.toString() ?? '',
      color = order.color,
      requested = order.requested == null ? '' : '${order.requested}',
      approvedBy = order.raw['approved_by']?.toString() ?? '',
      approvedDate = order.approvedDate,
      completeDate = order.completeDate,
      salesOrderId = order.salesOrder?.id ?? '',
      soNumber = order.salesOrder?.number ?? '',
      soCompany = order.salesOrder?.company ?? '',
      vendorId = order.vendorId,
      vendorName = order.vendorName,
      vendorAddressId = order.vendorAddressId;

  String orderNumber;
  String crmReference;
  String orderType;
  String orderDate;
  String orderStatus;
  String campaignStart;
  String campaignEnd;
  String brand;

  /// Kept as it was: the web form has no field for it either.
  String color;
  String requested;
  String approvedBy;
  String approvedDate;
  String completeDate;
  String salesOrderId;
  String soNumber;
  String soCompany;
  String vendorId;
  String vendorName;
  String vendorAddressId;

  bool get campaignInvalid => campaignStart.isNotEmpty && campaignEnd.isNotEmpty && campaignEnd.compareTo(campaignStart) < 0;

  /// The sales order chosen: its own fields fill the campaign and the reference, where
  /// it has them.
  void chooseSalesOrder(SalesOrderChoice so) {
    salesOrderId = so.id;
    soNumber = so.number;
    soCompany = so.company;
    if (so.crmReference.isNotEmpty) crmReference = so.crmReference;
    if (so.campaignStart.isNotEmpty) campaignStart = so.campaignStart;
    if (so.campaignEnd.isNotEmpty) campaignEnd = so.campaignEnd;
    if (so.brand.isNotEmpty) brand = so.brand;
  }

  /// A new vendor means choosing its address again.
  void chooseVendor(VendorChoice vendor) {
    vendorId = vendor.id;
    vendorName = vendor.name;
    vendorAddressId = '';
  }

  /// validate() in PurchaseOrdersPage.jsx, each problem under its own field.
  Map<String, String> problems(List<ItemDraft> items) {
    final found = <String, String>{};
    if (salesOrderId.isEmpty) found['sales_order_id'] = 'Choose the sales order this purchase is for.';
    if (orderNumber.trim().isEmpty) found['order_number'] = 'Enter a PO number.';
    if (vendorName.trim().isEmpty && vendorId.isEmpty) found['vendor'] = 'Choose the vendor.';
    if (vendorAddressId.isEmpty) found['vendor_address_id'] = 'Choose the vendor address this purchase order goes to.';
    if (campaignInvalid) found['campaign_end_date'] = 'The campaign end date must be on or after the start date.';
    if (items.isEmpty) found['items'] = 'Add at least one item.';
    for (final (index, item) in items.indexed) {
      if (item.name.trim().isEmpty) found['item.${item.key}.name'] = 'Item ${index + 1} needs a name.';
    }
    return found;
  }

  String? _orNull(String value) => value.trim().isEmpty ? null : value.trim();

  /// buildPOHeaderPayload. [createdBy] is left out when editing, as the web does.
  Map<String, Object?> payload(OrderTotals totals, {String? createdBy}) => {
    'order_number': orderNumber.trim(),
    'crm_reference_id': _orNull(crmReference),
    'company': vendorName.trim(),
    'order_client_fullname': _orNull(vendorName),
    'order_type': orderType.isEmpty ? null : orderType,
    'order_date': orderDate.isEmpty ? null : orderDate,
    'campaign_start_date': campaignStart.isEmpty ? null : campaignStart,
    'campaign_end_date': campaignEnd.isEmpty ? null : campaignEnd,
    'brand_name': _orNull(brand),
    'order_color': color.isEmpty ? null : color,
    'order_status': orderStatus.isEmpty ? null : orderStatus,
    'approved_by': _orNull(approvedBy),
    'approved_date': approvedDate.isEmpty ? null : approvedDate,
    'complete_date': completeDate.isEmpty ? null : completeDate,
    'payment_receipt_amount': requested.trim().isEmpty ? null : round2(requested),
    'sub_total': totals.subTotal,
    'tax_total': totals.taxTotal,
    'total': totals.total,
    'created_by': ?createdBy,
    'multi_purpose_so': false,
    // What makes this row a purchase order.
    'vendor_address_id': int.tryParse(vendorAddressId),
  };

  String get snapshot => '${payload(const OrderTotals(0, 0, 0))}$salesOrderId$vendorId';
}

/// buildPOItemPayload: a purchase order line, linked to the sales order it was bought
/// for and, when chosen, to the sales order line it supplies.
Map<String, Object?> poItemPayload(ItemDraft item, {required Object salesOrderId, required Object purchaseOrderId}) {
  int? whole(Object value) => value is int ? value : int.tryParse('$value');
  String? orNull(String value) => value.trim().isEmpty ? null : value.trim();
  return {
    'sales_order_id': whole(salesOrderId),
    'purchase_order_id': whole(purchaseOrderId),
    'so_item_id': int.tryParse(item.soItemId),
    'type': orNull(item.type),
    'name': item.name.trim(),
    'short_name': orNull(item.shortName),
    'label': orNull(item.label),
    'reference_type': 'Purchase Order',
    'date': item.date.isEmpty ? null : item.date,
    'invoice_number': orNull(item.invoiceNumber),
    'is_taxable': item.isTaxable,
    'gst_type': item.isTaxable ? (item.gstType.isEmpty ? null : item.gstType) : null,
    'document_note': orNull(item.note),
    'self_audit_completed': item.selfAudited,
    'file_url': orNull(item.fileUrl),
    ...item.amounts.toColumns(),
  };
}

/// What was sold and what was bought, before tax, for the lines linked to the sales
/// order, as profitSummary in the web form works it out.
({double sold, double bought, double margin}) marginOf(List<ItemDraft> items, List<SoLine> soLines) {
  var sold = 0.0;
  var bought = 0.0;
  for (final item in items) {
    final line = soLines.where((l) => l.id == item.soItemId).firstOrNull;
    if (line != null) sold += line.taxable;
    bought += item.amounts.taxable;
  }
  return (sold: round2(sold), bought: round2(bought), margin: round2(sold - bought));
}
