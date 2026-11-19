/// Sales orders, as src/features/sales-orders/ and src/lib/gst.js read and write
/// Supabase `salesorder` and `salesorderdocument`. The same fields and the same money
/// rules: change one side and change the other.
///
/// A row of `salesorder` with vendor_address_id set is a purchase order; every query
/// here leaves those out, as the web page does.
library;

import '../../shared/record_ui.dart' show PillTone, formatDisplayDate;
import '../../shared/values.dart';

/* ── Values the module writes (src/lib/gst.js) ───────────────────────────── */

const orderTypeOptions = ['ATL', 'TTL', 'BTL'];
const orderStatusOptions = ['Draft', 'Pending Approval', 'Approved', 'In Progress', 'Completed', 'Cancelled'];
const purchaseStatusOptions = ['Not Started', 'Partial', 'Completed'];
const gstTypeOptions = [
  ('Intra-State', 'Intra-State (CGST + SGST)'),
  ('Inter-State', 'Inter-State (IGST)'),
  ('Union Territory', 'Union Territory (CGST + UTGST)'),
];
const gstRates = [0, 5, 12, 18, 28];
const itemTypeOptions = ['Media', 'Production', 'Printing', 'Installation', 'Service', 'Other'];
const courierStatusOptions = ['Not Sent', 'Dispatched', 'In Transit', 'Delivered', 'Returned'];

/// SO_COLOR_OPTIONS, without its "None", which every colour list adds itself.
const rowColorOptions = [
  ('#185494', 'Blue'),
  ('#f9af1b', 'Amber'),
  ('#2f9e6f', 'Green'),
  ('#b23b43', 'Red'),
  ('#6c4bb6', 'Purple'),
  ('#6b7684', 'Slate'),
];

/// Amounts arrive from text fields, so equality is checked to within half a paisa.
const moneyEpsilon = 0.005;

/* ── Money (src/lib/money.js) ────────────────────────────────────────────── */

/// toAmount: blank or unreadable is 0.
double toAmount(Object? value) {
  if (value == null) return 0;
  if (value is num) return value.isFinite ? value.toDouble() : 0;
  final text = value.toString().trim();
  if (text.isEmpty) return 0;
  final number = double.tryParse(text);
  return number != null && number.isFinite ? number : 0;
}

/// round2: Math.round(n * 100) / 100. Math.round takes a half up, toward +∞, and
/// works on the exact value: 2.675 * 100 is 267.4999… and gives 267, where adding 0.5
/// in floating point first would give 268.
double round2(Object? value) {
  final scaled = toAmount(value) * 100;
  final whole = scaled.floorToDouble();
  return (scaled - whole >= 0.5 ? whole + 1 : whole) / 100;
}

/// A number as JavaScript's String() writes it: 1800, not 1800.0.
String numberText(double value) => value == value.truncateToDouble() && value.abs() < 1e15 ? value.toInt().toString() : value.toString();

/// "1,47,500.00" or "147,500.00", as formatMoney in src/lib/format.js.
String plainMoney(Object? value, {String style = 'en-IN'}) {
  final amount = toAmount(value);
  final cents = (amount.abs() * 100).round();
  final whole = formatCount(cents ~/ 100, style: style);
  return '${amount < 0 && cents > 0 ? '-' : ''}$whole.${(cents % 100).toString().padLeft(2, '0')}';
}

/// "₹1,47,500.00", as formatRupees; "—" when there is no amount.
String rupees(Object? value, {String style = 'en-IN'}) {
  if (value == null || (value is String && value.trim().isEmpty)) return '—';
  final amount = toAmount(value);
  return '${amount < 0 && (amount.abs() * 100).round() > 0 ? '-' : ''}₹${plainMoney(amount.abs(), style: style)}';
}

/* ── GST (src/lib/gst.js) ────────────────────────────────────────────────── */

class ItemAmounts {
  const ItemAmounts({
    required this.taxable,
    required this.tax,
    required this.afterTax,
    required this.cgst,
    required this.sgst,
    required this.igst,
    required this.utgst,
  });

  final double taxable;
  final double tax;
  final double afterTax;
  final double cgst;
  final double sgst;
  final double igst;
  final double utgst;

  /// The money columns of `salesorderdocument`.
  Map<String, Object?> toColumns() => {
    'taxable_amount': taxable,
    'tax_amount': tax,
    'after_tax_amount': afterTax,
    'cgst_amount': cgst,
    'sgst_amount': sgst,
    'igst_amount': igst,
    'utgst_amount': utgst,
  };
}

/// splitGst: the two halves come from each other, so they add back up to the tax
/// exactly even when the tax has an odd last paisa.
({double cgst, double sgst, double igst, double utgst}) splitGst(String? gstType, Object? taxAmount, bool isTaxable) {
  final tax = round2(taxAmount);
  if (!isTaxable || tax == 0) return (cgst: 0, sgst: 0, igst: 0, utgst: 0);
  if (gstType == 'Inter-State') return (cgst: 0, sgst: 0, igst: tax, utgst: 0);
  final half = round2(tax / 2);
  if (gstType == 'Union Territory') return (cgst: half, sgst: 0, igst: 0, utgst: round2(tax - half));
  return (cgst: half, sgst: round2(tax - half), igst: 0, utgst: 0);
}

double taxFromRate(Object? taxableAmount, Object? rate) => round2(toAmount(taxableAmount) * (toAmount(rate) / 100));

/// The table stores amounts, not the rate behind them, so an item opened for editing
/// has its rate read back out. Anything off the standard slabs is a custom amount.
String rateFromAmounts(Object? taxableAmount, Object? taxAmount) {
  final taxable = toAmount(taxableAmount);
  if (taxable <= 0) return '18';
  final rate = round2(toAmount(taxAmount) / taxable * 100);
  return rate == rate.truncateToDouble() && gstRates.contains(rate.toInt()) ? '${rate.toInt()}' : 'custom';
}

/// "CGST 900.00 · SGST 900.00", leaving out the parts that are zero.
String gstBreakdown({required Object? cgst, required Object? sgst, required Object? igst, required Object? utgst}) => [
  ('CGST', cgst),
  ('SGST', sgst),
  ('IGST', igst),
  ('UTGST', utgst),
].where((part) => toAmount(part.$2) != 0).map((part) => '${part.$1} ${plainMoney(part.$2)}').join(' · ');

class OrderTotals {
  const OrderTotals(this.subTotal, this.taxTotal, this.total);

  final double subTotal;
  final double taxTotal;
  final double total;
}

class OrderMathException implements Exception {
  const OrderMathException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// reconcileSalesOrderTotals: the order's three totals are never taken from the form.
/// They are worked out from the items here, with every relationship checked again, in
/// the same call that produces the numbers that are saved.
OrderTotals reconcileTotals(List<ItemDraft> items) {
  var subTotal = 0.0;
  var taxTotal = 0.0;
  var grandTotal = 0.0;
  for (final (index, item) in items.indexed) {
    final amounts = item.amounts;
    final position = index + 1;
    final splitSum = round2(amounts.cgst + amounts.sgst + amounts.igst + amounts.utgst);
    if ((splitSum - amounts.tax).abs() > moneyEpsilon) {
      throw OrderMathException('Item $position: the CGST/SGST/IGST/UTGST split ($splitSum) does not add up to the tax amount (${amounts.tax}).');
    }
    if ((amounts.afterTax - (amounts.taxable + amounts.tax)).abs() > moneyEpsilon) {
      throw OrderMathException('Item $position: the after-tax amount does not equal taxable + tax.');
    }
    subTotal += amounts.taxable;
    taxTotal += amounts.tax;
    grandTotal += amounts.afterTax;
  }
  final totals = OrderTotals(round2(subTotal), round2(taxTotal), round2(grandTotal));
  if ((totals.total - (totals.subTotal + totals.taxTotal)).abs() > moneyEpsilon) {
    throw OrderMathException('Order total (${totals.total}) does not equal sub total + tax total (${round2(totals.subTotal + totals.taxTotal)}).');
  }
  return totals;
}

/// storedItemTotals: the same three figures for items already saved, so the details
/// screen can say when an order's stored totals no longer match its items.
OrderTotals storedItemTotals(List<OrderItem> items) {
  var totals = const OrderTotals(0, 0, 0);
  for (final item in items) {
    totals = OrderTotals(
      round2(totals.subTotal + toAmount(item.raw['taxable_amount'])),
      round2(totals.taxTotal + toAmount(item.raw['tax_amount'])),
      round2(totals.total + toAmount(item.raw['after_tax_amount'])),
    );
  }
  return totals;
}

/// campaignDays: both days counted, or null when either is missing or the end comes first.
int? campaignDays(String start, String end) {
  if (start.isEmpty || end.isEmpty) return null;
  final from = DateTime.tryParse(start);
  final to = DateTime.tryParse(end);
  if (from == null || to == null) return null;
  final days = (to.difference(from).inHours / 24).round() + 1;
  return days > 0 ? days : null;
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// formatDateRange: "1–27 Apr 2026", "28 Mar – 4 Apr 2026", or '' when neither is set.
String formatDateRange(String start, String end) {
  final from = start.isEmpty ? null : DateTime.tryParse(start.length >= 10 ? start.substring(0, 10) : start);
  final to = end.isEmpty ? null : DateTime.tryParse(end.length >= 10 ? end.substring(0, 10) : end);
  if (from == null && to == null) return '';
  if (to == null) return 'From ${formatDisplayDate(start)}';
  if (from == null) return 'Until ${formatDisplayDate(end)}';
  if (from == to) return formatDisplayDate(start);
  if (from.year != to.year) return '${formatDisplayDate(start)} – ${formatDisplayDate(end)}';
  if (from.month != to.month) return '${from.day} ${_months[from.month - 1]} – ${to.day} ${_months[to.month - 1]} ${to.year}';
  return '${from.day}–${to.day} ${_months[to.month - 1]} ${to.year}';
}

/// statusTone in src/lib/status.js: statuses are open text, so the colour comes from
/// what the value reads like.
PillTone statusTone(String status) {
  final text = status.toLowerCase();
  if (text.isEmpty) return PillTone.neutral;
  if (RegExp('cancel|reject|hold|fail|void').hasMatch(text)) return PillTone.danger;
  if (RegExp('complete|approved|closed|paid|done').hasMatch(text)) return PillTone.active;
  if (RegExp('pending|progress|partial|draft|await|open').hasMatch(text)) return PillTone.pending;
  return PillTone.neutral;
}

/* ── Settings > Lists (src/lib/settings.js) ──────────────────────────────── */

List<Map> _listRows(Object? settings, String key) {
  final lists = settings is Map ? settings['lists'] : null;
  return lists is List ? lists.whereType<Map>().where((row) => row['list_key'] == key).toList() : const <Map>[];
}

/// listValues: the visible values from Settings in order, or [fallback] when Settings
/// has none for this list. [current] is kept, so editing never drops a value.
List<String> listValues(Object? settings, String key, List<String> fallback, [String current = '']) {
  final rows = _listRows(settings, key);
  final values = rows.isEmpty
      ? [...fallback]
      : [
          for (final row in rows)
            if (row['hidden'] != true && row['value'] is String) row['value'] as String,
        ];
  if (current.isNotEmpty && !values.contains(current)) values.add(current);
  return values;
}

/// choiceValues in SalesOrdersPage.jsx: once Settings has the list it decides; until
/// then the built-in values, plus whatever the orders already use.
List<String> choiceValues(Object? settings, String key, List<String> fallback, List<String> facets, [String current = '']) {
  if (_listRows(settings, key).isNotEmpty) return listValues(settings, key, fallback, current);
  final values = <String>{...fallback, ...facets, if (current.isNotEmpty) current};
  return values.toList();
}

/// The row colours ('row_color'), with "None" first: value and name.
List<(String, String)> colorChoices(Object? settings, String current) {
  final rows = _listRows(settings, 'row_color');
  final options = rows.isEmpty
      ? [...rowColorOptions]
      : [
          for (final row in rows)
            if (row['hidden'] != true && row['value'] is String)
              (
                row['value'] as String,
                (row['label'] is String && (row['label'] as String).isNotEmpty) ? row['label'] as String : row['value'] as String,
              ),
        ];
  if (current.isNotEmpty && !options.any((o) => o.$1 == current)) {
    final known = rows.where((row) => row['value'] == current).firstOrNull;
    final label = known != null && known['label'] is String
        ? known['label'] as String
        : rowColorOptions.where((o) => o.$1 == current).firstOrNull?.$2 ?? current;
    options.add((current, label));
  }
  return [('', 'None'), ...options];
}

/// A stored colour such as "#185494" as a Color value, or null when it is not one.
int? colorValue(String hex) {
  final match = RegExp(r'^#([0-9a-fA-F]{6})$').firstMatch(hex.trim());
  return match == null ? null : 0xFF000000 | int.parse(match.group(1)!, radix: 16);
}

/* ── Rows ────────────────────────────────────────────────────────────────── */

String _day(Object? value) {
  final text = (value?.toString() ?? '').trim();
  return text.length >= 10 ? text.substring(0, 10) : text;
}

class SalesOrder {
  SalesOrder(this.raw);

  final Map<String, dynamic> raw;

  String _text(String key) => (raw[key]?.toString() ?? '').trim();

  String get id => raw['id']?.toString() ?? '';
  String get orderNumber => _text('order_number');
  String get company => _text('company');
  String get contact => _text('order_client_fullname');
  String get orderType => _text('order_type');
  String get brand => _text('brand_name');
  String get orderStatus => _text('order_status');
  String get purchaseStatus => _text('purchase_status');
  String get color => _text('order_color');
  String get crmReference => _text('crm_reference_id');
  String get uniqueId => _text('unique_id');
  String get invoiceCourier => _text('invoice_courier');
  String get approvedBy => _text('approved_by');
  String get createdBy => _text('created_by');
  String get createdById => _text('created_by_id');
  bool get multiPurpose => raw['multi_purpose_so'] == true;

  String get orderDate => _day(raw['order_date']);
  String get invoiceDate => _day(raw['invoice_date']);
  String get campaignStart => _day(raw['campaign_start_date']);
  String get campaignEnd => _day(raw['campaign_end_date']);
  String get approvedDate => _day(raw['approved_date']);
  String get completeDate => _day(raw['complete_date']);
  String get createdAt => _text('created_at');
  String get updatedAt => _text('updated_at');

  Object? get subTotal => raw['sub_total'];
  Object? get taxTotal => raw['tax_total'];
  Object? get total => raw['total'];

  /// Null when no payment has been recorded, which is not the same as 0.
  Object? get received {
    final value = raw['payment_receipt_amount'];
    return value == null || (value is String && value.trim().isEmpty) ? null : value;
  }

  double? get balance => received == null ? null : round2(toAmount(total) - toAmount(received));

  String get title => orderNumber.isEmpty ? 'Order #$id' : orderNumber;
}

class OrderItem {
  OrderItem(this.raw);

  final Map<String, dynamic> raw;

  String _text(String key) => (raw[key]?.toString() ?? '').trim();

  String get id => raw['id']?.toString() ?? '';
  String get name => _text('name');
  String get type => _text('type');
  String get label => _text('label');
  String get date => _day(raw['date']);
  String get invoiceNumber => _text('invoice_number');
  String get purchaseOrderId => _text('purchase_order_id');
  String get invNumber => _text('inv_number');
  String get documentCourier => _text('document_courier');
  String get courierStatus => _text('courier_status');
  String get gstType => _text('gst_type');
  String get note => _text('document_note');
  String get fileUrl => _text('file_url');
  String get color => _text('document_color');
  bool get selfAudited => raw['self_audit_completed'] == true;
  bool get isTaxable => raw['is_taxable'] != false;

  String get breakdown => gstBreakdown(cgst: raw['cgst_amount'], sgst: raw['sgst_amount'], igst: raw['igst_amount'], utgst: raw['utgst_amount']);

  /// "Intra-State · CGST 900.00 · SGST 900.00", or "Not taxable".
  String get taxLine => !isTaxable ? 'Not taxable' : [gstType, breakdown].where((p) => p.isNotEmpty).join(' · ');

  /// The rest of the line, as SalesOrderItemCard.jsx lists it. A purchase order's own
  /// line leaves out the "PO #" that would only point back at itself.
  List<String> meta({bool forPurchaseOrder = false}) => [
    if (type.isNotEmpty) type else if (label.isNotEmpty) label,
    if (date.isNotEmpty) formatDisplayDate(date),
    if (invoiceNumber.isNotEmpty) 'Invoice $invoiceNumber',
    if (!forPurchaseOrder && purchaseOrderId.isNotEmpty) 'PO #$purchaseOrderId',
    if (invNumber.isNotEmpty) invNumber,
    if ([documentCourier, courierStatus].any((p) => p.isNotEmpty)) [documentCourier, courierStatus].where((p) => p.isNotEmpty).join(', '),
    if (selfAudited) 'Self-audited',
  ];

  /// An attachment the phone may open: web links only.
  Uri? get attachment {
    final uri = Uri.tryParse(fileUrl);
    return uri != null && (uri.scheme == 'https' || uri.scheme == 'http') && uri.host.isNotEmpty ? uri : null;
  }
}

/// The PostgREST `or` filter for a search, as soSearchFilter builds it. Every column
/// here is text in the database.
String? orderSearchFilter(String query) {
  final text = query.replaceAll(RegExp(r'[%_]'), '').replaceAll(RegExp(r'[(),"\\]'), ' ').trim();
  if (text.isEmpty) return null;
  return [
    for (final column in const ['order_number', 'company', 'crm_reference_id']) '$column.ilike.%$text%',
  ].join(',');
}

/* ── The form ────────────────────────────────────────────────────────────── */

/// One line of the order while it is edited, as blankSalesOrderItem and
/// salesOrderItemToForm hold it: text, the way the fields show it.
class ItemDraft {
  ItemDraft.blank(this.key, {this.type = ''})
    : id = null,
      soItemId = '',
      name = '',
      shortName = '',
      label = '',
      referenceType = 'Sales Order',
      date = '',
      invoiceNumber = '',
      isTaxable = true,
      gstType = gstTypeOptions.first.$1,
      gstRate = '18',
      taxableAmount = '',
      taxAmount = '',
      color = '',
      note = '',
      selfAudited = false,
      fileUrl = '',
      courier = '',
      courierStatus = '';

  ItemDraft.from(OrderItem item, this.key)
    : id = item.raw['id'],
      soItemId = item.raw['so_item_id'] == null ? '' : '${item.raw['so_item_id']}',
      type = item.type,
      name = item.raw['name']?.toString() ?? '',
      shortName = item.raw['short_name']?.toString() ?? '',
      label = item.raw['label']?.toString() ?? '',
      referenceType = item.raw['reference_type']?.toString() ?? '',
      date = item.date,
      invoiceNumber = item.raw['invoice_number']?.toString() ?? '',
      isTaxable = item.raw['is_taxable'] == null ? true : item.raw['is_taxable'] == true,
      gstType = item.gstType.isEmpty ? gstTypeOptions.first.$1 : item.gstType,
      gstRate = rateFromAmounts(item.raw['taxable_amount'], item.raw['tax_amount']),
      taxableAmount = item.raw['taxable_amount'] == null ? '' : '${item.raw['taxable_amount']}',
      taxAmount = item.raw['tax_amount'] == null ? '' : '${item.raw['tax_amount']}',
      color = item.color,
      note = item.raw['document_note']?.toString() ?? '',
      selfAudited = item.selfAudited,
      fileUrl = item.raw['file_url']?.toString() ?? '',
      courier = item.raw['document_courier']?.toString() ?? '',
      courierStatus = item.courierStatus;

  /// Saved lines go by their database id, new ones by a counter, so the two never meet.
  final String key;
  final Object? id;

  /// For a purchase order's line: the sales order line it supplies, or ''.
  String soItemId;
  String type;
  String name;
  String shortName;
  String label;
  String referenceType;
  String date;
  String invoiceNumber;
  bool isTaxable;
  String gstType;
  String gstRate;
  String taxableAmount;
  String taxAmount;
  String color;
  String note;
  bool selfAudited;
  String fileUrl;
  String courier;
  String courierStatus;

  /// itemAmounts: every money column, the split applied and after-tax always taxable + tax.
  ItemAmounts get amounts {
    final taxable = round2(taxableAmount);
    final tax = isTaxable ? round2(taxAmount) : 0.0;
    final split = splitGst(gstType, tax, isTaxable);
    return ItemAmounts(
      taxable: taxable,
      tax: tax,
      afterTax: round2(taxable + tax),
      cgst: split.cgst,
      sgst: split.sgst,
      igst: split.igst,
      utgst: split.utgst,
    );
  }

  bool get customTax => gstRate == 'custom';

  /// applyItemChange: the rate works out the tax; "Custom amount" hands the tax to the
  /// person, and turning GST off makes it 0 whatever the rate says.
  void setTaxable(bool value) {
    isTaxable = value;
    if (!value) {
      taxAmount = '0';
    } else if (!customTax) {
      taxAmount = numberText(taxFromRate(taxableAmount, gstRate));
    }
  }

  void setTaxableAmount(String value) {
    taxableAmount = value;
    if (isTaxable && !customTax) taxAmount = numberText(taxFromRate(taxableAmount, gstRate));
  }

  void setRate(String value) {
    gstRate = value;
    if (isTaxable && !customTax) taxAmount = numberText(taxFromRate(taxableAmount, gstRate));
  }

  String? _orNull(String value) => value.trim().isEmpty ? null : value.trim();

  /// buildSalesOrderItemPayload.
  Map<String, Object?> payload(Object salesOrderId) => {
    'sales_order_id': salesOrderId is String ? int.tryParse(salesOrderId) ?? salesOrderId : salesOrderId,
    'type': _orNull(type),
    'name': name.trim(),
    'short_name': _orNull(shortName),
    'label': _orNull(label),
    'reference_type': _orNull(referenceType),
    'date': date.isEmpty ? null : date,
    'invoice_number': _orNull(invoiceNumber),
    'is_taxable': isTaxable,
    'gst_type': isTaxable ? (gstType.isEmpty ? null : gstType) : null,
    'document_color': color.isEmpty ? null : color,
    'document_note': _orNull(note),
    'self_audit_completed': selfAudited,
    'file_url': _orNull(fileUrl),
    'document_courier': _orNull(courier),
    'courier_status': courierStatus.isEmpty ? null : courierStatus,
    ...amounts.toColumns(),
  };

  /// What this line would save, for "has anything changed?".
  String get snapshot => '$id${payload(0)}$gstRate$soItemId';
}

/// The order's own fields while it is edited, as blankSalesOrderForm and
/// salesOrderToForm hold them.
class OrderDraft {
  OrderDraft.blank({
    required String today,
    this.orderType = '',
    this.orderStatus = '',
    this.purchaseStatus = '',
    this.company = '',
    this.contact = '',
  }) : crmReference = '',
       uniqueId = '',
       orderNumber = '',
       orderDate = today,
       invoiceDate = '',
       campaignStart = '',
       campaignEnd = '',
       brand = '',
       multiPurpose = false,
       invoiceCourier = '',
       received = '',
       color = '',
       approvedBy = '',
       approvedDate = '',
       completeDate = '';

  OrderDraft.from(SalesOrder order)
    : crmReference = order.raw['crm_reference_id']?.toString() ?? '',
      company = order.raw['company']?.toString() ?? '',
      contact = order.raw['order_client_fullname']?.toString() ?? '',
      orderType = order.orderType,
      uniqueId = order.raw['unique_id']?.toString() ?? '',
      orderNumber = order.raw['order_number']?.toString() ?? '',
      orderDate = order.orderDate,
      invoiceDate = order.invoiceDate,
      campaignStart = order.campaignStart,
      campaignEnd = order.campaignEnd,
      brand = order.raw['brand_name']?.toString() ?? '',
      multiPurpose = order.multiPurpose,
      invoiceCourier = order.raw['invoice_courier']?.toString() ?? '',
      received = order.received == null ? '' : '${order.received}',
      orderStatus = order.orderStatus,
      purchaseStatus = order.purchaseStatus,
      color = order.color,
      approvedBy = order.raw['approved_by']?.toString() ?? '',
      approvedDate = order.approvedDate,
      completeDate = order.completeDate;

  String crmReference;
  String company;
  String contact;
  String orderType;
  String uniqueId;
  String orderNumber;
  String orderDate;
  String invoiceDate;
  String campaignStart;
  String campaignEnd;
  String brand;
  bool multiPurpose;
  String invoiceCourier;
  String received;
  String orderStatus;
  String purchaseStatus;
  String color;
  String approvedBy;
  String approvedDate;
  String completeDate;

  /// Dates are YYYY-MM-DD, so text order is date order.
  bool get campaignInvalid => campaignStart.isNotEmpty && campaignEnd.isNotEmpty && campaignEnd.compareTo(campaignStart) < 0;

  /// validate() in SalesOrdersPage.jsx, each problem under its own field.
  Map<String, String> problems(List<ItemDraft> items) {
    final found = <String, String>{};
    if (company.trim().isEmpty) found['company'] = 'Choose the client this order belongs to.';
    if (orderNumber.trim().isEmpty) found['order_number'] = 'Enter an order number.';
    if (campaignInvalid) found['campaign_end_date'] = 'The campaign end date must be on or after the campaign start date.';
    if (items.isEmpty) found['items'] = 'Add at least one order item.';
    for (final (index, item) in items.indexed) {
      if (item.name.trim().isEmpty) found['item.${item.key}.name'] = 'Item ${index + 1} needs a name.';
    }
    return found;
  }

  String? _orNull(String value) => value.trim().isEmpty ? null : value.trim();

  /// buildSalesOrderPayload. [createdBy] is left out when editing, as the web does.
  Map<String, Object?> payload(OrderTotals totals, {String? createdBy}) => {
    'crm_reference_id': _orNull(crmReference),
    'company': company.trim(),
    'order_client_fullname': _orNull(contact),
    'order_type': orderType.isEmpty ? null : orderType,
    'unique_id': _orNull(uniqueId),
    'order_number': orderNumber.trim(),
    'order_date': orderDate.isEmpty ? null : orderDate,
    'invoice_date': invoiceDate.isEmpty ? null : invoiceDate,
    'campaign_start_date': campaignStart.isEmpty ? null : campaignStart,
    'campaign_end_date': campaignEnd.isEmpty ? null : campaignEnd,
    'brand_name': _orNull(brand),
    'multi_purpose_so': multiPurpose,
    'invoice_courier': _orNull(invoiceCourier),
    'payment_receipt_amount': received.trim().isEmpty ? null : round2(received),
    'order_status': orderStatus.isEmpty ? null : orderStatus,
    'purchase_status': purchaseStatus.isEmpty ? null : purchaseStatus,
    'order_color': color.isEmpty ? null : color,
    'approved_by': _orNull(approvedBy),
    'approved_date': approvedDate.isEmpty ? null : approvedDate,
    'complete_date': completeDate.isEmpty ? null : completeDate,
    'sub_total': totals.subTotal,
    'tax_total': totals.taxTotal,
    'total': totals.total,
    'created_by': ?createdBy,
  };

  /// What the order would save, for "has anything changed?".
  String get snapshot => '${payload(const OrderTotals(0, 0, 0))}';
}

/// Today as YYYY-MM-DD on the phone's own calendar. todayIso() on the web takes the
/// UTC day, which before 5:30 in the morning in India is still yesterday.
String todayIso(DateTime now) =>
    '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
