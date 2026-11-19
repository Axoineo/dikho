import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/platform_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import 'order_parts.dart';
import 'sales_order_form_screen.dart';
import 'sales_orders_controller.dart';
import 'sales_orders_models.dart';

const _loadMoreWithin = 200.0;

/// What this person may do here; RLS checks each write again.
class SalesOrderAbilities {
  const SalesOrderAbilities({this.create = false, this.editScope, this.userId = '', this.createdBy});

  final bool create;

  /// sales_orders.edit: 'all', 'own' (orders this person created), or null for none.
  final String? editScope;
  final String userId;

  /// What a new order records as its creator: the person's name, or their email.
  final String? createdBy;

  bool canEdit(SalesOrder order) => editScope == 'all' || (editScope == 'own' && userId.isNotEmpty && order.createdById == userId);
}

/// What clients have ordered, newest first, a page at a time, as the web Sales orders
/// page: a server search over order number, client and CRM reference, and a status
/// filter. Purchase orders share the table and never appear here.
class SalesOrdersScreen extends StatefulWidget {
  const SalesOrdersScreen({
    super.key,
    required this.controller,
    required this.platform,
    required this.abilities,
    required this.onOpenDrawer,
    this.onTaxInvoice,
    this.newOrderFor,
  });

  final SalesOrdersController controller;
  final PlatformApi platform;
  final SalesOrderAbilities abilities;
  final VoidCallback onOpenDrawer;

  /// Makes the order's tax invoice PDF, which the CRM page draws from its template.
  final void Function(SalesOrder order)? onTaxInvoice;

  /// "New order" on a client: the form opens at once with that client chosen.
  final ClientChoice? newOrderFor;

  @override
  State<SalesOrdersScreen> createState() => _SalesOrdersScreenState();
}

class _SalesOrdersScreenState extends State<SalesOrdersScreen> {
  final _scroll = ScrollController();
  final _search = TextEditingController();

  SalesOrdersController get _orders => widget.controller;

  @override
  void initState() {
    super.initState();
    _search.text = _orders.query;
    _scroll.addListener(() {
      final position = _scroll.position;
      if (position.maxScrollExtent - position.pixels < _loadMoreWithin) unawaited(_orders.loadMore());
    });
    if (_orders.rows.isEmpty && !_orders.loading) {
      unawaited(_orders.start());
    } else {
      unawaited(_orders.reload());
    }
    final client = widget.newOrderFor;
    if (client != null && widget.abilities.create) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_add(client));
      });
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    _search.dispose();
    super.dispose();
  }

  void _notice(String text) => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

  Future<void> _open(SalesOrder order) async {
    FocusManager.instance.primaryFocus?.unfocus();
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SalesOrderDetailsScreen(
          order: order,
          controller: _orders,
          platform: widget.platform,
          abilities: widget.abilities,
          onTaxInvoice: widget.onTaxInvoice,
        ),
      ),
    );
  }

  Future<void> _add([ClientChoice? client]) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final saved = await Navigator.of(context).push<SalesOrder>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => SalesOrderFormScreen(controller: _orders, createdBy: widget.abilities.createdBy, client: client),
      ),
    );
    if (saved == null || !mounted) return;
    _notice('Sales order created');
    await _open(saved);
  }

  Future<void> _filter() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final current = _orders.statusFilter;
    final choices = {..._orders.statusChoices, ?current}.toList();
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        maxChildSize: 0.9,
        builder: (_, scroll) => ListView(
          controller: scroll,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Gap.l, Gap.l, Gap.l, Gap.s),
              child: Text('Show orders with this status', style: Theme.of(sheetContext).textTheme.titleMedium),
            ),
            for (final (value, label) in [('', 'All statuses'), for (final c in choices) (c, c)])
              ListTile(
                title: Text(label),
                selected: (current ?? '') == value,
                trailing: (current ?? '') == value ? const Icon(Icons.check) : null,
                onTap: () => Navigator.of(sheetContext).pop(value),
              ),
          ],
        ),
      ),
    );
    if (picked != null) _orders.setStatusFilter(picked);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: _orders,
      builder: (context, _) => Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
          title: const Text('Sales orders'),
          actions: [
            IconButton(
              tooltip: _orders.filtered ? 'Status, ${_orders.statusFilter}' : 'Status',
              onPressed: () => unawaited(_filter()),
              icon: Badge(isLabelVisible: _orders.filtered, smallSize: 8, child: const Icon(Icons.filter_list)),
            ),
          ],
        ),
        floatingActionButton: widget.abilities.create
            ? FloatingActionButton.extended(onPressed: () => unawaited(_add()), icon: const Icon(Icons.add), label: const Text('New order'))
            : null,
        body: Column(
          children: [
            Container(
              color: theme.colorScheme.surface,
              padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, Gap.m, Gap.s),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: _search,
                    onChanged: (value) {
                      setState(() {});
                      _orders.setQuery(value);
                    },
                    textInputAction: TextInputAction.search,
                    decoration: InputDecoration(
                      prefixIcon: const Icon(Icons.search),
                      hintText: 'Search order number, client or CRM reference',
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Clear search',
                              onPressed: () {
                                _search.clear();
                                setState(() {});
                                _orders.setQuery('');
                              },
                              icon: const Icon(Icons.close),
                            ),
                    ),
                  ),
                  if (_orders.total != null || _orders.filtered) ...[
                    const SizedBox(height: Gap.s),
                    Row(
                      children: [
                        if (_orders.total != null)
                          Expanded(
                            child: Text(
                              '${_orders.total} ${_orders.total == 1 ? 'order' : 'orders'}${_orders.query.isNotEmpty || _orders.filtered ? ' match' : ''}',
                              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                            ),
                          )
                        else
                          const Spacer(),
                        if (_orders.filtered)
                          InputChip(
                            label: Text(_orders.statusFilter!),
                            onDeleted: () => _orders.setStatusFilter(null),
                            deleteButtonTooltipMessage: 'Show every status',
                            onPressed: () => unawaited(_filter()),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const Divider(),
            Expanded(child: _body(context)),
          ],
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    final orders = _orders.rows;
    if (orders.isEmpty) {
      if (_orders.loading) return const Center(child: CircularProgressIndicator());
      if (_orders.error != null) {
        return EmptyMessage(
          title: "Couldn't load sales orders",
          body: _orders.error!,
          action: 'Try again',
          onAction: () => unawaited(_orders.reload()),
        );
      }
      if (_orders.query.isNotEmpty || _orders.filtered) {
        return EmptyMessage(
          title: 'No sales orders match',
          body: _orders.filtered && _orders.query.isEmpty
              ? 'No order is ${_orders.statusFilter} right now. Choose another status, or All statuses.'
              : 'Try an order number, a client or a CRM reference, or another status.',
        );
      }
      return EmptyMessage(
        title: 'No sales orders yet',
        body: 'A sales order records what a client bought, for which campaign, and what they have paid.',
        action: widget.abilities.create ? 'New order' : null,
        onAction: widget.abilities.create ? () => unawaited(_add()) : null,
      );
    }
    final footer = _orders.hasMore ? 1 : 0;
    return RefreshIndicator(
      onRefresh: _orders.reload,
      child: ListView.builder(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.only(bottom: widget.abilities.create ? 88 : 0),
        itemExtent: recordRowExtent(context),
        itemCount: orders.length + footer,
        itemBuilder: (context, index) {
          if (index == orders.length) {
            return const Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)));
          }
          final order = orders[index];
          return _OrderRow(key: ValueKey(order.id), order: order, numberStyle: _orders.numberStyle, onTap: () => unawaited(_open(order)));
        },
      ),
    );
  }
}

class _OrderRow extends StatelessWidget {
  const _OrderRow({super.key, required this.order, required this.numberStyle, required this.onTap});

  final SalesOrder order;
  final String numberStyle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final when = order.orderDate.isNotEmpty ? formatDisplayDate(order.orderDate) : order.crmReference;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Gap.m),
        child: Row(
          children: [
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      ColorDot(order.color),
                      Flexible(
                        child: Text(
                          order.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                        ),
                      ),
                      if (when.isNotEmpty) ...[const SizedBox(width: Gap.s), Text(when, maxLines: 1, style: muted)],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(order.company.isEmpty ? 'No client' : order.company, maxLines: 1, overflow: TextOverflow.ellipsis, style: muted),
                ],
              ),
            ),
            const SizedBox(width: Gap.s),
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  rupees(order.total, style: numberStyle),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                ),
                if (order.orderStatus.isNotEmpty) ...[const SizedBox(height: 2), Pill(label: order.orderStatus, tone: statusTone(order.orderStatus))],
              ],
            ),
            Icon(Icons.chevron_right, color: theme.colorScheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}

/// One order with its lines and figures, as SalesOrderDetails.jsx shows it.
class SalesOrderDetailsScreen extends StatefulWidget {
  const SalesOrderDetailsScreen({
    super.key,
    required this.order,
    required this.controller,
    required this.platform,
    required this.abilities,
    this.onTaxInvoice,
  });

  final SalesOrder order;
  final SalesOrdersController controller;
  final PlatformApi platform;
  final SalesOrderAbilities abilities;
  final void Function(SalesOrder order)? onTaxInvoice;

  @override
  State<SalesOrderDetailsScreen> createState() => _SalesOrderDetailsScreenState();
}

class _SalesOrderDetailsScreenState extends State<SalesOrderDetailsScreen> {
  late SalesOrder _order = widget.order;
  List<OrderItem> _items = const [];
  bool _itemsLoading = true;
  String? _itemsError;

  @override
  void initState() {
    super.initState();
    unawaited(_loadItems());
  }

  Future<void> _loadItems() async {
    setState(() {
      _itemsLoading = true;
      _itemsError = null;
    });
    try {
      final items = await widget.controller.loadItems(_order.id);
      if (mounted) setState(() => _items = items);
    } on ApiException catch (failure) {
      if (mounted) setState(() => _itemsError = failure.message);
    } finally {
      if (mounted) setState(() => _itemsLoading = false);
    }
  }

  void _notice(String text) => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<SalesOrder>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => SalesOrderFormScreen(controller: widget.controller, order: _order),
      ),
    );
    if (saved == null || !mounted) return;
    setState(() => _order = saved);
    _notice('Sales order saved');
    await _loadItems();
  }

  Future<void> _openAttachment(Uri link) async {
    if (!await widget.platform.openExternal(link.toString()) && mounted) _notice('No app on this phone can open that.');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final o = _order;
    final style = widget.controller.numberStyle;
    String money(Object? value) => rupees(value, style: style);
    final stored = storedItemTotals(_items);
    final drifted = !_itemsLoading && _itemsError == null && _items.isNotEmpty && (stored.total - toAmount(o.total)).abs() > moneyEpsilon;
    final days = campaignDays(o.campaignStart, o.campaignEnd);
    final balance = o.balance;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sales order'),
        actions: [
          if (widget.abilities.canEdit(o))
            IconButton(tooltip: 'Edit order', onPressed: () => unawaited(_edit()), icon: const Icon(Icons.edit_outlined)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadItems,
        child: ListView(
          padding: const EdgeInsets.all(Gap.l),
          children: [
            Row(
              children: [
                ColorDot(o.color),
                Expanded(child: SelectableText(o.title, style: theme.textTheme.titleLarge)),
              ],
            ),
            const SizedBox(height: Gap.xs),
            Wrap(
              spacing: Gap.s,
              runSpacing: Gap.xs,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (o.orderStatus.isNotEmpty) Pill(label: o.orderStatus, tone: statusTone(o.orderStatus)),
                Text(
                  o.company.isEmpty ? 'No client' : o.company,
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
            if (widget.onTaxInvoice != null) ...[
              const SizedBox(height: Gap.l),
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.tonalIcon(
                  onPressed: () => widget.onTaxInvoice!(o),
                  icon: const Icon(Icons.receipt_long_outlined),
                  label: const Text('Tax invoice'),
                ),
              ),
            ],
            const SizedBox(height: Gap.l),
            OrderFigures(
              rows: [
                ('Before tax', money(o.subTotal)),
                ('Tax', money(o.taxTotal)),
                if (o.received != null) ('Received', money(o.received)),
                if (balance != null) ('Balance due', money(balance)),
              ],
              total: money(o.total),
              emphasize: 'Balance due',
            ),
            if (drifted) DriftNote(linesTotal: money(stored.total)),
            const SizedBox(height: Gap.l),
            Semantics(
              header: true,
              child: Text(
                'Items${!_itemsLoading && _itemsError == null ? ' (${_items.length})' : ''}',
                style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
            const SizedBox(height: Gap.s),
            if (_itemsLoading)
              const Padding(
                padding: EdgeInsets.all(Gap.l),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_itemsError != null)
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Couldn't load the items. $_itemsError", style: TextStyle(color: theme.colorScheme.error)),
                  TextButton(onPressed: () => unawaited(_loadItems()), child: const Text('Try again')),
                ],
              )
            else if (_items.isEmpty)
              Text('This order has no items.', style: TextStyle(color: theme.colorScheme.onSurfaceVariant))
            else
              for (final item in _items) OrderItemCard(item: item, money: money, onOpenAttachment: _openAttachment),
            const SizedBox(height: Gap.l),
            DetailsCard(
              title: 'Order',
              rows: [
                ('Client', o.company),
                ('Client contact', o.contact),
                ('Order type', o.orderType),
                ('Order date', formatDisplayDate(o.orderDate)),
                ('Invoice date', formatDisplayDate(o.invoiceDate)),
                ('Purchase status', o.purchaseStatus),
                ('CRM reference', o.crmReference),
                ('Unique ID', o.uniqueId),
                ('Multi-purpose SO', o.multiPurpose ? 'Yes' : ''),
              ],
            ),
            DetailsCard(
              title: 'Campaign',
              rows: [
                ('Dates', formatDateRange(o.campaignStart, o.campaignEnd)),
                ('Duration', days == null ? '' : '$days ${days == 1 ? 'day' : 'days'}'),
                ('Brand', o.brand),
                ('Invoice courier', o.invoiceCourier),
              ],
            ),
            DetailsCard(
              title: 'History',
              rows: [
                ('Approved by', o.approvedBy),
                ('Approved on', formatDisplayDate(o.approvedDate)),
                ('Completed on', formatDisplayDate(o.completeDate)),
                ('Created by', o.createdBy),
                ('Created on', formatDisplayDate(o.createdAt)),
                ('Last changed', formatDisplayDate(o.updatedAt)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
