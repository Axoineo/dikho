import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/platform_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import '../sales_orders/order_parts.dart';
import '../sales_orders/sales_orders_models.dart';
import 'purchase_order_form_screen.dart';
import 'purchase_orders_controller.dart';
import 'purchase_orders_models.dart';

/// What this person may do here; RLS checks each write again. Purchase order rights
/// are all or nothing: no 'own' scope.
class PurchaseOrderAbilities {
  const PurchaseOrderAbilities({this.create = false, this.edit = false, this.createdBy});

  final bool create;
  final bool edit;

  /// What a new order records as its creator: the person's name, or their email.
  final String? createdBy;
}

/// What is bought from vendors, newest first, a page at a time, as the web Purchase
/// orders page: a server search over PO number, vendor, brand and CRM reference.
class PurchaseOrdersScreen extends StatefulWidget {
  const PurchaseOrdersScreen({
    super.key,
    required this.controller,
    required this.platform,
    required this.abilities,
    required this.onOpenDrawer,
    this.newOrderFor,
  });

  final PurchaseOrdersController controller;
  final PlatformApi platform;
  final PurchaseOrderAbilities abilities;
  final VoidCallback onOpenDrawer;

  /// "New PO" on a vendor: the form opens at once with that vendor chosen.
  final VendorChoice? newOrderFor;

  @override
  State<PurchaseOrdersScreen> createState() => _PurchaseOrdersScreenState();
}

class _PurchaseOrdersScreenState extends State<PurchaseOrdersScreen> {
  final _scroll = ScrollController();
  final _search = TextEditingController();

  PurchaseOrdersController get _orders => widget.controller;

  @override
  void initState() {
    super.initState();
    _search.text = _orders.query;
    _scroll.addListener(() {
      final position = _scroll.position;
      if (nearListEnd(position)) unawaited(_orders.loadMore());
    });
    if (_orders.rows.isEmpty && !_orders.loading) {
      unawaited(_orders.start());
    } else {
      unawaited(_orders.reload());
    }
    final vendor = widget.newOrderFor;
    if (vendor != null && widget.abilities.create) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_add(vendor));
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

  Future<void> _open(PurchaseOrder order) async {
    FocusManager.instance.primaryFocus?.unfocus();
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PurchaseOrderDetailsScreen(order: order, controller: _orders, platform: widget.platform, abilities: widget.abilities),
      ),
    );
  }

  Future<void> _add([VendorChoice? vendor]) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final saved = await Navigator.of(context).push<PurchaseOrder>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => PurchaseOrderFormScreen(controller: _orders, createdBy: widget.abilities.createdBy, vendor: vendor),
      ),
    );
    if (saved == null || !mounted) return;
    _notice('Purchase order created');
    await _open(saved);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: _orders,
      builder: (context, _) => Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
          title: const Text('Purchase orders'),
        ),
        floatingActionButton: widget.abilities.create
            ? FloatingActionButton.extended(onPressed: () => unawaited(_add()), icon: const Icon(Icons.add), label: const Text('New PO'))
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
                      hintText: 'Search PO number, vendor, brand or CRM reference',
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
                  if (_orders.total != null) ...[
                    const SizedBox(height: Gap.s),
                    Text(
                      '${_orders.total} purchase ${_orders.total == 1 ? 'order' : 'orders'}${_orders.query.isNotEmpty ? ' match' : ''}',
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ],
              ),
            ),
            ListProgressLine(active: _orders.refreshing),
            Expanded(child: _body(context)),
          ],
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    final orders = _orders.rows;
    if (orders.isEmpty) {
      if (_orders.loading) return const LoadingRows();
      if (_orders.error != null) {
        return EmptyMessage(
          title: "Couldn't load purchase orders",
          body: _orders.error!,
          action: 'Try again',
          onAction: () => unawaited(_orders.reload()),
        );
      }
      if (_orders.query.isNotEmpty) {
        return const EmptyMessage(title: 'No purchase orders match your search', body: 'Try a PO number, a vendor, a brand or a CRM reference.');
      }
      return EmptyMessage(
        title: 'No purchase orders yet',
        body: 'A purchase order records what you buy from a vendor for a sales order, so you can see the margin on it.',
        action: widget.abilities.create ? 'New PO' : null,
        onAction: widget.abilities.create ? () => unawaited(_add()) : null,
      );
    }
    final footer = _orders.hasMore ? 1 : 0;
    return RefreshIndicator(
      onRefresh: _orders.pullToRefresh,
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

  final PurchaseOrder order;
  final String numberStyle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final so = order.salesOrder?.number ?? '';
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
                      if (order.when.isNotEmpty) ...[const SizedBox(width: Gap.s), Text(order.when, maxLines: 1, style: muted)],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text([order.subtitle, if (so.isNotEmpty) 'for $so'].join(' · '), maxLines: 1, overflow: TextOverflow.ellipsis, style: muted),
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

/// One purchase order with its lines and figures, as PurchaseOrderDetails shows it.
class PurchaseOrderDetailsScreen extends StatefulWidget {
  const PurchaseOrderDetailsScreen({super.key, required this.order, required this.controller, required this.platform, required this.abilities});

  final PurchaseOrder order;
  final PurchaseOrdersController controller;
  final PlatformApi platform;
  final PurchaseOrderAbilities abilities;

  @override
  State<PurchaseOrderDetailsScreen> createState() => _PurchaseOrderDetailsScreenState();
}

class _PurchaseOrderDetailsScreenState extends State<PurchaseOrderDetailsScreen> {
  late PurchaseOrder _order = widget.order;
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
    final saved = await Navigator.of(context).push<PurchaseOrder>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => PurchaseOrderFormScreen(controller: widget.controller, order: _order),
      ),
    );
    if (saved == null || !mounted) return;
    setState(() => _order = saved);
    _notice('Purchase order saved');
    await _loadItems();
  }

  Future<void> _openAttachment(Uri link) async {
    if (!await widget.platform.openExternal(link.toString()) && mounted) _notice('No app on this phone can open that.');
  }

  Future<void> _email(String address) async {
    if (!await widget.platform.openExternal(Uri(scheme: 'mailto', path: address).toString()) && mounted) {
      _notice('No app on this phone can open that.');
    }
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
    final still = o.stillToRequest;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Purchase order'),
        actions: [
          if (widget.abilities.edit)
            IconButton(tooltip: 'Edit purchase order', onPressed: () => unawaited(_edit()), icon: const Icon(Icons.edit_outlined)),
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
                Text(o.subtitle, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
            if (o.email.isNotEmpty) ...[
              const SizedBox(height: Gap.l),
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.tonalIcon(
                  onPressed: () => unawaited(_email(o.email)),
                  icon: const Icon(Icons.mail_outline),
                  label: const Text('Email vendor'),
                ),
              ),
            ],
            const SizedBox(height: Gap.l),
            OrderFigures(
              rows: [
                ('Before tax', money(o.subTotal)),
                ('Tax', money(o.taxTotal)),
                if (o.requested != null) ('Payment requested', money(o.requested)),
                if (still != null) ('Still to request', money(still)),
              ],
              total: money(o.total),
              emphasize: 'Still to request',
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
              Text('This purchase order has no items.', style: TextStyle(color: theme.colorScheme.onSurfaceVariant))
            else
              for (final item in _items) OrderItemCard(item: item, money: money, onOpenAttachment: _openAttachment, forPurchaseOrder: true),
            const SizedBox(height: Gap.l),
            DetailsCard(
              title: 'Vendor',
              rows: [
                ('Vendor', o.vendorName),
                ('Contact person', o.contactPerson),
                ('Alias', o.alias),
                ('Email', o.email),
                ('GSTIN', o.gstin),
                ('PAN', o.pan),
                ('Address', o.addressLine),
              ],
            ),
            DetailsCard(
              title: 'Order',
              rows: [
                ('For sales order', o.salesOrder?.label ?? ''),
                ('Order date', formatDisplayDate(o.orderDate)),
                ('Order type', o.orderType),
                ('CRM reference', o.crmReference),
                ('Brand', o.brand),
                ('Campaign', formatDateRange(o.campaignStart, o.campaignEnd)),
                ('Duration', days == null ? '' : '$days ${days == 1 ? 'day' : 'days'}'),
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
