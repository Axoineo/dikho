import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../inbox/chat_theme.dart';
import '../sales_orders/order_parts.dart';
import '../sales_orders/sales_orders_models.dart';
import 'purchase_orders_controller.dart';
import 'purchase_orders_models.dart';

/// Add a purchase order, or edit one when [order] is given: the fields and rules of the
/// form in src/features/purchase-orders/PurchaseOrdersPage.jsx. The sales order, PO
/// number, vendor, vendor address and a name for every line are required; the totals
/// are always worked out from the lines. Pops with the order as saved.
class PurchaseOrderFormScreen extends StatefulWidget {
  const PurchaseOrderFormScreen({super.key, required this.controller, this.order, this.vendor, this.createdBy});

  final PurchaseOrdersController controller;
  final PurchaseOrder? order;

  /// For a new order started from a vendor.
  final VendorChoice? vendor;
  final String? createdBy;

  @override
  State<PurchaseOrderFormScreen> createState() => _PurchaseOrderFormScreenState();
}

class _PurchaseOrderFormScreenState extends State<PurchaseOrderFormScreen> with OrderFormFields {
  late final PurchaseOrderDraft _draft;
  List<ItemDraft> _items = [];
  final List<Object> _removed = [];
  final _scroll = ScrollController();
  int _keys = 0;
  String _start = '';
  bool _itemsLoading = false;
  String? _itemsError;
  bool _saving = false;
  String? _error;

  List<SoLine> _soLines = const [];
  bool _soLinesLoading = false;
  List<AddressChoice> _addresses = const [];
  bool _addressesLoading = false;
  String? _addressesError;

  bool get _isEdit => widget.order != null;
  PurchaseOrdersController get _c => widget.controller;
  Object? get _settings => _c.settings;

  @override
  DateTime get today => _c.now();

  @override
  void initState() {
    super.initState();
    final order = widget.order;
    if (order != null) {
      _draft = PurchaseOrderDraft.from(order);
      unawaited(_loadItems());
    } else {
      _draft = PurchaseOrderDraft.blank(
        today: todayIso(_c.now()),
        orderType: listValues(_settings, 'order_type', orderTypeOptions).firstOrNull ?? '',
        orderStatus: listValues(_settings, 'order_status', orderStatusOptions).firstOrNull ?? '',
        vendorId: widget.vendor?.id ?? '',
        vendorName: widget.vendor?.name ?? '',
      );
      _items = [_newItem()];
      _start = _snapshot();
    }
    if (_draft.salesOrderId.isNotEmpty) unawaited(_loadSoLines());
    if (_draft.vendorId.isNotEmpty) unawaited(_loadAddresses());
    if (!_c.salesOrdersLoaded) unawaited(_c.loadSalesOrders());
    if (!_c.vendorsLoaded) unawaited(_c.loadVendors());
  }

  @override
  void dispose() {
    disposeFields();
    _scroll.dispose();
    super.dispose();
  }

  ItemDraft _newItem() => ItemDraft.blank('item-${++_keys}', type: listValues(_settings, 'item_type', poItemTypeOptions).firstOrNull ?? '');

  Future<void> _loadItems() async {
    setState(() {
      _itemsLoading = true;
      _itemsError = null;
    });
    try {
      final rows = await _c.loadItems(widget.order!.id);
      if (!mounted) return;
      setState(() {
        _items = rows.isEmpty ? [_newItem()] : [for (final row in rows) ItemDraft.from(row, 'saved-${row.id}')];
        // Which sales order, when the list could not say: the lines know.
        final so = rows.map((r) => r.raw['sales_order_id']).whereType<Object>().firstOrNull;
        if (_draft.salesOrderId.isEmpty && so != null) {
          final known = _c.salesOrders.where((s) => s.id == '$so').firstOrNull;
          _draft
            ..salesOrderId = '$so'
            ..soNumber = known?.number ?? ''
            ..soCompany = known?.company ?? '';
          unawaited(_loadSoLines());
        }
        _removed.clear();
        _start = _snapshot();
      });
    } on ApiException catch (failure) {
      // Saving without the lines would work the totals out from nothing.
      if (mounted) setState(() => _itemsError = failure.message);
    } finally {
      if (mounted) setState(() => _itemsLoading = false);
    }
  }

  /// The chosen sales order's own lines, to link to. A link to another order's line
  /// is dropped, so a line never claims to supply something it cannot.
  Future<void> _loadSoLines() async {
    final soId = _draft.salesOrderId;
    setState(() => _soLinesLoading = true);
    try {
      final lines = await _c.soLinesFor(soId);
      if (!mounted || soId != _draft.salesOrderId) return;
      setState(() {
        _soLines = lines;
        for (final item in _items) {
          if (item.soItemId.isNotEmpty && !lines.any((l) => l.id == item.soItemId)) item.soItemId = '';
        }
      });
    } on ApiException {
      if (mounted && soId == _draft.salesOrderId) setState(() => _soLines = const []);
    } finally {
      if (mounted) setState(() => _soLinesLoading = false);
    }
  }

  /// The vendor's addresses. Most vendors have one: it is picked, or the default, so
  /// the order does not wait on a choice there is nothing to choose between.
  Future<void> _loadAddresses() async {
    final vendorId = _draft.vendorId;
    setState(() {
      _addressesLoading = true;
      _addressesError = null;
    });
    try {
      final rows = await _c.addressesFor(vendorId);
      if (!mounted || vendorId != _draft.vendorId) return;
      setState(() {
        _addresses = rows;
        if (_draft.vendorAddressId.isEmpty) {
          final pick = rows.length == 1 ? rows.first : rows.where((a) => a.isDefault).firstOrNull;
          if (pick != null) {
            // Not a change the person made: closing the form need not ask about it.
            final untouched = _snapshot() == _start;
            _draft.vendorAddressId = pick.id;
            if (untouched) _start = _snapshot();
          }
        }
      });
    } on ApiException catch (failure) {
      if (mounted && vendorId == _draft.vendorId) setState(() => _addressesError = failure.message);
    } finally {
      if (mounted) setState(() => _addressesLoading = false);
    }
  }

  String _snapshot() => '${_draft.snapshot}${_items.map((i) => i.snapshot).join('|')}$_removed';

  bool get _changed => !_itemsLoading && _itemsError == null && _snapshot() != _start;

  ({OrderTotals totals, String? error}) get _totals {
    try {
      return (totals: reconcileTotals(_items), error: null);
    } on OrderMathException catch (problem) {
      return (totals: const OrderTotals(0, 0, 0), error: problem.message);
    }
  }

  String _money(Object? value) => rupees(value, style: _c.numberStyle);

  void _toTop() => unawaited(_scroll.animateTo(0, duration: const Duration(milliseconds: 250), curve: Curves.easeOut));

  Future<void> _save() async {
    if (_saving || _itemsLoading || _itemsError != null) return;
    FocusManager.instance.primaryFocus?.unfocus();
    final found = _draft.problems(_items);
    setState(() {
      problems = found;
      _error = null;
    });
    if (found.isNotEmpty) {
      _toTop();
      return;
    }
    setState(() => _saving = true);
    try {
      final saved = await _c.save(widget.order, _draft, _items, removed: _removed, createdBy: widget.createdBy);
      if (mounted) Navigator.of(context).pop(saved);
    } on ApiException catch (failure) {
      if (mounted) {
        setState(() => _error = failure.message);
        _toTop();
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _leave() async {
    if (!_changed || await confirmDiscard()) {
      if (mounted) Navigator.of(context).pop();
    }
  }

  Future<void> _chooseSalesOrder() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final picked = await Navigator.of(context).push<SalesOrderChoice>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => SearchPicker<SalesOrderChoice>(
          title: 'Choose a sales order',
          searchHint: 'Search sales orders',
          listenable: _c,
          items: () => _c.salesOrders,
          titleOf: (so) => so.label,
          subtitleOf: (so) => [so.brand, formatDateRange(so.campaignStart, so.campaignEnd)].where((p) => p.isNotEmpty).join(' · '),
          isCurrent: (so) => so.id == _draft.salesOrderId,
          loading: () => !_c.salesOrdersLoaded && _c.salesOrdersError == null,
          error: () => _c.salesOrdersError,
          onRetry: () => unawaited(_c.loadSalesOrders()),
          emptyText: 'No sales orders yet. A purchase order is raised for a sales order, so add that first.',
        ),
      ),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _draft.chooseSalesOrder(picked);
      // The fields it fills show the new values.
      controllerFor('crm_reference_id', '').text = _draft.crmReference;
      controllerFor('brand_name', '').text = _draft.brand;
    });
    clearProblem('sales_order_id');
    unawaited(_loadSoLines());
  }

  Future<void> _chooseVendor() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final picked = await Navigator.of(context).push<VendorChoice>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => SearchPicker<VendorChoice>(
          title: 'Choose a vendor',
          searchHint: 'Search vendors',
          listenable: _c,
          items: () => _c.vendors,
          titleOf: (v) => v.label,
          isCurrent: (v) => v.id == _draft.vendorId,
          loading: () => !_c.vendorsLoaded && _c.vendorsError == null,
          error: () => _c.vendorsError,
          onRetry: () => unawaited(_c.loadVendors()),
          emptyText: 'No vendors yet. Add the vendor in Vendors first.',
        ),
      ),
    );
    if (picked == null || !mounted) return;
    if (picked.id != _draft.vendorId) {
      setState(() {
        _draft.chooseVendor(picked);
        _addresses = const [];
      });
      unawaited(_loadAddresses());
    }
    clearProblem('vendor');
    clearProblem('vendor_address_id');
  }

  void _addItem() => setState(() => _items = [..._items, _newItem()]);

  void _removeItem(ItemDraft item) {
    setState(() {
      final id = item.id;
      if (id != null && !_removed.contains(id)) _removed.add(id);
      _items = _items.where((i) => i.key != item.key).toList();
    });
  }

  void _changeItem(ItemDraft item, void Function() change) {
    setState(change);
    final tax = controllerFor('${item.key}.tax', item.taxAmount);
    if (tax.text != item.taxAmount) tax.text = item.taxAmount;
  }

  /// Linking a line to a sales order line names it after that line, as the web does.
  void _linkLine(ItemDraft item, String soItemId) {
    setState(() {
      item.soItemId = soItemId;
      final line = _soLines.where((l) => l.id == soItemId).firstOrNull;
      if (line != null) {
        item.name = line.name;
        controllerFor('item.${item.key}.name', '').text = line.name;
      }
    });
    clearProblem('item.${item.key}.name');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final d = _draft;
    final (:totals, :error) = _totals;
    final days = d.campaignInvalid ? null : campaignDays(d.campaignStart, d.campaignEnd);
    final margin = marginOf(_items, _soLines);
    final itemTypes = listValues(_settings, 'item_type', poItemTypeOptions);
    final moreFilled = [d.crmReference.trim(), d.orderType, d.approvedBy.trim(), d.approvedDate, d.completeDate].where((v) => v.isNotEmpty).length;
    final canSave = !_saving && !_itemsLoading && _itemsError == null;
    final soValue = d.salesOrderId.isEmpty ? '' : (d.soNumber.isEmpty ? 'Order #${d.salesOrderId}' : d.soNumber);
    final addressOptions = [for (final a in _addresses) (a.id, a.label)];
    if (d.vendorAddressId.isNotEmpty && !addressOptions.any((o) => o.$1 == d.vendorAddressId)) {
      addressOptions.add((d.vendorAddressId, 'Address #${d.vendorAddressId}'));
    }
    final addressNote = d.vendorId.isEmpty && d.vendorName.isEmpty
        ? 'Choose the vendor first.'
        : _addressesLoading
        ? 'Loading the vendor\'s addresses…'
        : _addressesError != null
        ? 'The addresses did not load. ${_addressesError!}'
        : addressOptions.isEmpty
        ? 'This vendor has no address. Add one in Vendors first.'
        : null;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Close', onPressed: () => unawaited(_leave()), icon: const Icon(Icons.close)),
          title: Text(_isEdit ? 'Edit ${widget.order!.title}' : 'New purchase order', overflow: TextOverflow.ellipsis),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: Gap.s),
              child: _saving
                  ? const Padding(
                      padding: EdgeInsets.all(Gap.m),
                      child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                    )
                  : TextButton(onPressed: canSave ? _save : null, child: Text(_isEdit ? 'Save' : 'Create')),
            ),
          ],
        ),
        bottomNavigationBar: totalBar(_money(totals.total)),
        body: ListView(
          controller: _scroll,
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl),
          children: [
            if (_error != null) errorBox('Could not save the purchase order. $_error'),
            if (problems.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: Text('Some fields need attention. They are marked below.', style: TextStyle(color: theme.colorScheme.error)),
              ),
            sectionTitle('Order'),
            ChoiceField(
              label: 'For sales order',
              required: true,
              value: soValue,
              error: problems['sales_order_id'],
              onTap: () => unawaited(_chooseSalesOrder()),
            ),
            textField('order_number', 'PO number', d.orderNumber, (v) => d.orderNumber = v, required: true),
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.m),
              child: MergeSemantics(
                child: Row(
                  children: [
                    Text('Client', style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                    const SizedBox(width: Gap.l),
                    Expanded(child: Text(d.soCompany.isEmpty ? 'From the sales order' : d.soCompany, textAlign: TextAlign.end)),
                  ],
                ),
              ),
            ),
            dateField('order_date', 'Order date', d.orderDate, (v) => d.orderDate = v),
            dropdownField(
              'order_status',
              'Status',
              d.orderStatus,
              notSetAnd(listValues(_settings, 'order_status', orderStatusOptions, d.orderStatus)),
              (v) => d.orderStatus = v,
            ),
            sectionTitle('Vendor'),
            ChoiceField(label: 'Vendor', required: true, value: d.vendorName, error: problems['vendor'], onTap: () => unawaited(_chooseVendor())),
            if (addressNote != null && addressOptions.isEmpty)
              ChoiceField(
                label: 'Vendor address',
                required: true,
                value: '',
                error: problems['vendor_address_id'],
                emptyText: addressNote,
                onTap: null,
              )
            else
              dropdownField(
                'vendor_address_id',
                'Vendor address *',
                d.vendorAddressId,
                [if (d.vendorAddressId.isEmpty) ('', 'Choose an address'), ...addressOptions],
                (v) => d.vendorAddressId = v,
                helper: addressNote,
              ),
            sectionTitle('Campaign', note: 'Filled in from the sales order. Change it if this purchase covers different dates.'),
            textField('brand_name', 'Brand', d.brand, (v) => d.brand = v, caps: TextCapitalization.words),
            dateField('campaign_start_date', 'Starts', d.campaignStart, (v) => d.campaignStart = v),
            dateField(
              'campaign_end_date',
              'Ends',
              d.campaignEnd,
              (v) => d.campaignEnd = v,
              earliest: d.campaignStart.isEmpty ? null : d.campaignStart,
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.m),
              child: Text(
                d.campaignInvalid
                    ? 'Ends before it starts'
                    : days != null
                    ? 'Runs for $days ${days == 1 ? 'day' : 'days'}'
                    : 'Set both dates to see how long it runs.',
                style: TextStyle(color: d.campaignInvalid ? theme.colorScheme.error : theme.colorScheme.onSurfaceVariant),
              ),
            ),
            sectionTitle('Items (${_items.length})', note: 'Link each line to the sales order line it supplies to see the margin on it.'),
            if (problems['items'] != null)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: Text(problems['items']!, style: TextStyle(color: theme.colorScheme.error)),
              ),
            if (_itemsLoading)
              const Padding(
                padding: EdgeInsets.all(Gap.l),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_itemsError != null)
              errorBox(
                "The purchase order's items did not load, so it cannot be saved yet. $_itemsError",
                action: TextButton(onPressed: () => unawaited(_loadItems()), child: const Text('Try again')),
              )
            else ...[
              for (final (index, item) in _items.indexed) _itemEditor(item, index, itemTypes),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(onPressed: _addItem, icon: const Icon(Icons.add), label: const Text('Add item')),
              ),
            ],
            const SizedBox(height: Gap.m),
            sectionTitle('Totals and payment'),
            SumsCard(rows: [('Before tax', _money(totals.subTotal)), ('Tax', _money(totals.taxTotal)), ('Total', _money(totals.total))]),
            if (margin.sold > 0) ...[
              const SizedBox(height: Gap.s),
              SumsCard(
                rows: [
                  ('Sold for (before tax)', _money(margin.sold)),
                  ('Bought for (before tax)', _money(margin.bought)),
                  ('Margin', _money(margin.margin)),
                ],
              ),
            ],
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: Gap.s),
                child: Text(error, style: TextStyle(color: theme.colorScheme.error)),
              ),
            const SizedBox(height: Gap.m),
            amountField('payment_receipt_amount', 'Payment requested', d.requested, (v) => d.requested = v),
            Theme(
              data: theme.copyWith(dividerColor: Colors.transparent),
              child: ExpansionTile(
                tilePadding: EdgeInsets.zero,
                childrenPadding: EdgeInsets.zero,
                title: const Text('More details'),
                subtitle: Text(moreFilled > 0 ? '$moreFilled filled' : 'References and approvals most purchase orders leave empty'),
                children: [
                  textField('crm_reference_id', 'CRM reference', d.crmReference, (v) => d.crmReference = v),
                  dropdownField(
                    'order_type',
                    'Order type',
                    d.orderType,
                    notSetAnd(listValues(_settings, 'order_type', orderTypeOptions, d.orderType)),
                    (v) => d.orderType = v,
                  ),
                  textField('approved_by', 'Approved by', d.approvedBy, (v) => d.approvedBy = v, caps: TextCapitalization.words),
                  dateField('approved_date', 'Approved on', d.approvedDate, (v) => d.approvedDate = v),
                  dateField('complete_date', 'Completed on', d.completeDate, (v) => d.completeDate = v),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _itemEditor(ItemDraft item, int index, List<String> itemTypes) {
    final theme = Theme.of(context);
    final amounts = item.amounts;
    final breakdown = gstBreakdown(cgst: amounts.cgst, sgst: amounts.sgst, igst: amounts.igst, utgst: amounts.utgst);
    final k = item.key;
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final canRemove = _items.length > 1;
    final linked = _soLines.where((l) => l.id == item.soItemId).firstOrNull;
    final lineMargin = linked == null ? null : round2(linked.taxable - amounts.taxable);
    final lineOptions = [
      ('', 'Not linked'),
      for (final l in _soLines) (l.id, '${l.name} (${_money(l.taxable)})'),
      // Until the sales order's lines load.
      if (item.soItemId.isNotEmpty && linked == null) (item.soItemId, 'Sales order line #${item.soItemId}'),
    ];
    return Card.outlined(
      key: ValueKey(k),
      margin: const EdgeInsets.only(bottom: Gap.m),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Gap.m, Gap.xs, Gap.xs, Gap.m),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text('${index + 1}', style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.primary)),
                const SizedBox(width: Gap.s),
                Expanded(
                  child: Text(
                    item.name.trim().isEmpty ? 'New item' : item.name.trim(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: item.name.trim().isEmpty ? muted : const TextStyle(fontWeight: FontWeight.w500),
                  ),
                ),
                Text(_money(amounts.afterTax), style: const TextStyle(fontWeight: FontWeight.w500)),
                IconButton(
                  tooltip: canRemove ? 'Remove item ${index + 1}' : 'A purchase order needs at least one item',
                  onPressed: canRemove ? () => _removeItem(item) : null,
                  icon: const Icon(Icons.delete_outline),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(right: Gap.s),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  dropdownField(
                    '$k.so-line',
                    'For sales order line',
                    item.soItemId,
                    lineOptions,
                    (v) => _linkLine(item, v),
                    enabled: _soLines.isNotEmpty,
                    helper: _draft.salesOrderId.isEmpty
                        ? 'Pick the sales order first to link a line.'
                        : _soLinesLoading
                        ? 'Loading its lines…'
                        : _soLines.isEmpty
                        ? 'That sales order has no lines to link.'
                        : null,
                  ),
                  textField('item.$k.name', 'Item', item.name, (v) => item.name = v, required: true, caps: TextCapitalization.sentences),
                  dropdownField(
                    'item.$k.type',
                    'Type',
                    item.type,
                    notSetAnd([...itemTypes, if (item.type.isNotEmpty && !itemTypes.contains(item.type)) item.type]),
                    (v) => item.type = v,
                  ),
                  amountField('$k.taxable', 'Cost before tax', item.taxableAmount, (v) => _changeItem(item, () => item.setTaxableAmount(v))),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Charged GST'),
                    value: item.isTaxable,
                    onChanged: (v) => _changeItem(item, () => item.setTaxable(v)),
                  ),
                  dropdownField('$k.gst-type', 'GST type', item.gstType, gstTypeOptions, (v) => item.gstType = v, enabled: item.isTaxable),
                  dropdownField(
                    '$k.rate',
                    'GST rate',
                    item.gstRate,
                    [for (final r in gstRates) ('$r', '$r%'), ('custom', 'Custom amount')],
                    (v) => _changeItem(item, () => item.setRate(v)),
                    enabled: item.isTaxable,
                  ),
                  amountField(
                    '$k.tax',
                    'Tax',
                    item.taxAmount,
                    (v) => item.taxAmount = v,
                    enabled: item.isTaxable && item.customTax,
                    helper: item.isTaxable && !item.customTax ? 'Worked out from the rate' : null,
                  ),
                  Theme(
                    data: theme.copyWith(dividerColor: Colors.transparent),
                    child: ExpansionTile(
                      tilePadding: EdgeInsets.zero,
                      childrenPadding: EdgeInsets.zero,
                      title: const Text('More details'),
                      subtitle: const Text('Date, invoice, audit, attachment and note'),
                      children: [
                        dateField('$k.date', 'Date', item.date, (v) => item.date = v),
                        textField('$k.invoice', 'Invoice number', item.invoiceNumber, (v) => item.invoiceNumber = v),
                        textField('$k.short', 'Short name', item.shortName, (v) => item.shortName = v),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Self audit done'),
                          value: item.selfAudited,
                          onChanged: (v) => setState(() => item.selfAudited = v),
                        ),
                        textField('$k.file', 'Attachment link', item.fileUrl, (v) => item.fileUrl = v, keyboard: TextInputType.url),
                        textField('$k.note', 'Note', item.note, (v) => item.note = v, caps: TextCapitalization.sentences),
                      ],
                    ),
                  ),
                  Text(
                    [
                      'Before tax ${_money(amounts.taxable)}',
                      'Tax ${_money(amounts.tax)}',
                      breakdown.isNotEmpty ? breakdown : (item.isTaxable ? 'No GST yet' : 'No GST'),
                      if (lineMargin != null) 'Margin ${_money(lineMargin)}',
                    ].join(' · '),
                    style: muted,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
