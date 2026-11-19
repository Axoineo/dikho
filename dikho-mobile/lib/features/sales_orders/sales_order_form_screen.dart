import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../inbox/chat_theme.dart';
import 'order_parts.dart';
import 'sales_orders_controller.dart';
import 'sales_orders_models.dart';

/// Add an order, or edit one when [order] is given: the fields and rules of the form in
/// src/features/sales-orders/SalesOrdersPage.jsx. Client, order number and a name for
/// every line are required; the totals are always worked out from the lines. Pops with
/// the order as saved.
class SalesOrderFormScreen extends StatefulWidget {
  const SalesOrderFormScreen({super.key, required this.controller, this.order, this.client, this.createdBy});

  final SalesOrdersController controller;
  final SalesOrder? order;

  /// For a new order started from a client.
  final ClientChoice? client;
  final String? createdBy;

  @override
  State<SalesOrderFormScreen> createState() => _SalesOrderFormScreenState();
}

class _SalesOrderFormScreenState extends State<SalesOrderFormScreen> with OrderFormFields {
  late final OrderDraft _draft;
  List<ItemDraft> _items = [];
  final List<Object> _removed = [];
  final _scroll = ScrollController();
  int _keys = 0;
  String _start = '';
  bool _itemsLoading = false;
  String? _itemsError;
  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.order != null;
  SalesOrdersController get _c => widget.controller;
  Object? get _settings => _c.settings;

  @override
  DateTime get today => _c.now();

  @override
  void initState() {
    super.initState();
    final order = widget.order;
    if (order != null) {
      _draft = OrderDraft.from(order);
      unawaited(_loadItems());
    } else {
      // A new order and a new line start on the first value each list offers.
      _draft = OrderDraft.blank(
        today: todayIso(_c.now()),
        orderType: listValues(_settings, 'order_type', orderTypeOptions).firstOrNull ?? '',
        orderStatus: listValues(_settings, 'order_status', orderStatusOptions).firstOrNull ?? '',
        purchaseStatus: listValues(_settings, 'purchase_status', purchaseStatusOptions).firstOrNull ?? '',
        company: widget.client?.company ?? '',
        contact: widget.client?.contact ?? '',
      );
      _items = [_newItem()];
      _start = _snapshot();
    }
    if (!_c.clientsLoaded) {
      unawaited(
        _c.loadClients().then((_) {
          if (mounted) setState(() {});
        }),
      );
    }
  }

  @override
  void dispose() {
    disposeFields();
    _scroll.dispose();
    super.dispose();
  }

  ItemDraft _newItem() => ItemDraft.blank('item-${++_keys}', type: listValues(_settings, 'item_type', itemTypeOptions).firstOrNull ?? '');

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
        _removed.clear();
        _start = _snapshot();
      });
    } on ApiException catch (failure) {
      // Saving without the lines would work the totals out from nothing, so the form
      // waits for them.
      if (mounted) setState(() => _itemsError = failure.message);
    } finally {
      if (mounted) setState(() => _itemsLoading = false);
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

  Future<void> _chooseClient() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final picked = await Navigator.of(context).push<ClientChoice>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => SearchPicker<ClientChoice>(
          title: 'Choose a client',
          searchHint: 'Search clients',
          listenable: _c,
          // An order can name a company no longer in the client list; it stays
          // choosable, so editing anything else never quietly changes the client.
          items: () => [
            if (_draft.company.isNotEmpty && !_c.clients.any((x) => x.company == _draft.company)) ClientChoice(_draft.company, ''),
            ..._c.clients,
          ],
          titleOf: (x) => x.company,
          subtitleOf: (x) => x.contact,
          isCurrent: (x) => x.company == _draft.company,
          loading: () => !_c.clientsLoaded && _c.clientsError == null,
          error: () => _c.clientsError,
          onRetry: () => unawaited(_c.loadClients()),
          emptyText: 'No clients yet. Add the client in Clients first.',
        ),
      ),
    );
    if (picked == null || !mounted) return;
    // Picking a client fills its contact person too; it stays editable, since one
    // client can have a different signatory per order.
    setState(() {
      _draft.company = picked.company;
      if (picked.contact.isNotEmpty) {
        _draft.contact = picked.contact;
        controllerFor('order_client_fullname', '').text = picked.contact;
      }
    });
    clearProblem('company');
  }

  void _addItem() => setState(() => _items = [..._items, _newItem()]);

  void _removeItem(ItemDraft item) {
    setState(() {
      final id = item.id;
      if (id != null && !_removed.contains(id)) _removed.add(id);
      _items = _items.where((i) => i.key != item.key).toList();
    });
  }

  /// The rate works the tax out; the tax field shows the new figure.
  void _changeItem(ItemDraft item, void Function() change) {
    setState(change);
    final tax = controllerFor('${item.key}.tax', item.taxAmount);
    if (tax.text != item.taxAmount) tax.text = item.taxAmount;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final d = _draft;
    final f = _c.facets;
    final (:totals, :error) = _totals;
    final days = d.campaignInvalid ? null : campaignDays(d.campaignStart, d.campaignEnd);
    final balance = d.received.trim().isEmpty ? null : round2(totals.total - toAmount(d.received));
    final itemTypes = choiceValues(_settings, 'item_type', itemTypeOptions, f.itemTypes);
    final moreFilled = [
      d.crmReference.trim(), d.uniqueId.trim(), d.contact.trim(), d.invoiceDate, d.purchaseStatus, d.approvedBy.trim(), //
      d.approvedDate, d.completeDate, d.color, d.invoiceCourier.trim(), if (d.multiPurpose) 'yes',
    ].where((v) => v.isNotEmpty).length;
    final canSave = !_saving && !_itemsLoading && _itemsError == null;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Close', onPressed: () => unawaited(_leave()), icon: const Icon(Icons.close)),
          title: Text(_isEdit ? 'Edit ${widget.order!.title}' : 'New sales order', overflow: TextOverflow.ellipsis),
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
            if (_error != null) errorBox('Could not save the sales order. $_error'),
            if (problems.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: Text('Some fields need attention. They are marked below.', style: TextStyle(color: theme.colorScheme.error)),
              ),
            sectionTitle('Order'),
            ChoiceField(label: 'Client', required: true, value: d.company, error: problems['company'], onTap: () => unawaited(_chooseClient())),
            textField('order_number', 'Order number', d.orderNumber, (v) => d.orderNumber = v, required: true),
            dateField('order_date', 'Order date', d.orderDate, (v) => d.orderDate = v),
            dropdownField(
              'order_type',
              'Order type',
              d.orderType,
              notSetAnd(choiceValues(_settings, 'order_type', orderTypeOptions, f.orderTypes, d.orderType)),
              (v) => d.orderType = v,
            ),
            dropdownField(
              'order_status',
              'Status',
              d.orderStatus,
              notSetAnd(choiceValues(_settings, 'order_status', orderStatusOptions, f.orderStatuses, d.orderStatus)),
              (v) => d.orderStatus = v,
            ),
            sectionTitle('Campaign'),
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
            sectionTitle(
              'Items (${_items.length})',
              note: 'Each line\'s GST is worked out from its rate. Open "More details" on a line for courier, audit and attachments.',
            ),
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
                "The order's items did not load, so it cannot be saved yet. $_itemsError",
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
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: Gap.s),
                child: Text(error, style: TextStyle(color: theme.colorScheme.error)),
              ),
            const SizedBox(height: Gap.m),
            amountField('payment_receipt_amount', 'Payment received', d.received, (v) => d.received = v),
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.m),
              child: MergeSemantics(
                child: Row(
                  children: [
                    Text('Balance due', style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                    const Spacer(),
                    Text(balance == null ? 'No payment yet' : _money(balance)),
                  ],
                ),
              ),
            ),
            Theme(
              data: theme.copyWith(dividerColor: Colors.transparent),
              child: ExpansionTile(
                tilePadding: EdgeInsets.zero,
                childrenPadding: EdgeInsets.zero,
                title: const Text('More details'),
                subtitle: Text(moreFilled > 0 ? '$moreFilled filled' : 'References, approvals and other fields most orders leave empty'),
                children: [
                  textField('crm_reference_id', 'CRM reference', d.crmReference, (v) => d.crmReference = v),
                  textField('unique_id', 'Unique ID', d.uniqueId, (v) => d.uniqueId = v),
                  textField(
                    'order_client_fullname',
                    'Client contact',
                    d.contact,
                    (v) => d.contact = v,
                    caps: TextCapitalization.words,
                    helper: 'Filled in from the client; change it for this order if needed.',
                  ),
                  dateField('invoice_date', 'Invoice date', d.invoiceDate, (v) => d.invoiceDate = v),
                  dropdownField(
                    'purchase_status',
                    'Purchase status',
                    d.purchaseStatus,
                    notSetAnd(choiceValues(_settings, 'purchase_status', purchaseStatusOptions, f.purchaseStatuses, d.purchaseStatus)),
                    (v) => d.purchaseStatus = v,
                  ),
                  textField('invoice_courier', 'Invoice courier', d.invoiceCourier, (v) => d.invoiceCourier = v),
                  textField('approved_by', 'Approved by', d.approvedBy, (v) => d.approvedBy = v, caps: TextCapitalization.words),
                  dateField('approved_date', 'Approved on', d.approvedDate, (v) => d.approvedDate = v),
                  dateField('complete_date', 'Completed on', d.completeDate, (v) => d.completeDate = v),
                  dropdownField(
                    'order_color',
                    'Row colour',
                    d.color,
                    colorChoices(_settings, d.color),
                    (v) => d.color = v,
                    helper: 'Marks the order in the list.',
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Multi-purpose sales order'),
                    value: d.multiPurpose,
                    onChanged: (v) => setState(() => d.multiPurpose = v),
                  ),
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
                  tooltip: canRemove ? 'Remove item ${index + 1}' : 'An order needs at least one item',
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
                  textField('item.$k.name', 'Item', item.name, (v) => item.name = v, required: true, caps: TextCapitalization.sentences),
                  dropdownField(
                    'item.$k.type',
                    'Type',
                    item.type,
                    notSetAnd([...itemTypes, if (item.type.isNotEmpty && !itemTypes.contains(item.type)) item.type]),
                    (v) => item.type = v,
                  ),
                  amountField('$k.taxable', 'Amount before tax', item.taxableAmount, (v) => _changeItem(item, () => item.setTaxableAmount(v))),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Charge GST'),
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
                      subtitle: const Text('Date, invoice, courier, colour, attachment and note'),
                      children: [
                        dateField('$k.date', 'Date', item.date, (v) => item.date = v),
                        textField('$k.invoice', 'Invoice number', item.invoiceNumber, (v) => item.invoiceNumber = v),
                        textField('$k.short', 'Short name', item.shortName, (v) => item.shortName = v),
                        textField('$k.label', 'Label', item.label, (v) => item.label = v),
                        textField('$k.ref', 'Reference type', item.referenceType, (v) => item.referenceType = v),
                        textField('$k.courier', 'Document courier', item.courier, (v) => item.courier = v),
                        dropdownField(
                          '$k.courier-status',
                          'Courier status',
                          item.courierStatus,
                          notSetAnd(listValues(_settings, 'courier_status', courierStatusOptions, item.courierStatus)),
                          (v) => item.courierStatus = v,
                        ),
                        dropdownField('$k.color', 'Colour', item.color, colorChoices(_settings, item.color), (v) => item.color = v),
                        textField('$k.file', 'Attachment link', item.fileUrl, (v) => item.fileUrl = v, keyboard: TextInputType.url),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Self audit done'),
                          value: item.selfAudited,
                          onChanged: (v) => setState(() => item.selfAudited = v),
                        ),
                        textField('$k.note', 'Note', item.note, (v) => item.note = v, caps: TextCapitalization.sentences, maxLines: 3),
                      ],
                    ),
                  ),
                  Text(
                    [
                      'Before tax ${_money(amounts.taxable)}',
                      'Tax ${_money(amounts.tax)}',
                      breakdown.isNotEmpty ? breakdown : (item.isTaxable ? 'No GST yet' : 'No GST'),
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
