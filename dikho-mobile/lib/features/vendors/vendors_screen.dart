import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../shared/crm_api.dart';
import '../../shared/platform_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import '../whatsapp/analytics_models.dart' show formatMoney;
import 'vendor_form_screen.dart';
import 'vendors_controller.dart';
import 'vendors_models.dart';

/// What this person may do here; RLS checks each write again.
class VendorAbilities {
  const VendorAbilities({this.create = false, this.edit = false, this.newPurchaseOrder = false});

  final bool create;
  final bool edit;
  final bool newPurchaseOrder;
}

/// Media owners and suppliers, newest first, a page at a time, as the web Vendors page:
/// a server search over name, alias, contact, email, GSTIN and PAN, and filters for
/// status, media and sub media.
class VendorsScreen extends StatefulWidget {
  const VendorsScreen({
    super.key,
    required this.controller,
    required this.platform,
    required this.abilities,
    required this.onOpenDrawer,
    required this.onNewPurchaseOrder,
  });

  final VendorsController controller;
  final PlatformApi platform;
  final VendorAbilities abilities;
  final VoidCallback onOpenDrawer;

  /// Opens the CRM's purchase order form with this vendor chosen.
  final void Function(Vendor vendor) onNewPurchaseOrder;

  @override
  State<VendorsScreen> createState() => _VendorsScreenState();
}

class _VendorsScreenState extends State<VendorsScreen> {
  final _scroll = ScrollController();
  final _search = TextEditingController();

  VendorsController get _vendors => widget.controller;

  @override
  void initState() {
    super.initState();
    _search.text = _vendors.query;
    _scroll.addListener(() {
      final position = _scroll.position;
      if (nearListEnd(position)) unawaited(_vendors.loadMore());
    });
    if (_vendors.rows.isEmpty && !_vendors.loading) {
      unawaited(_vendors.start());
    } else {
      unawaited(_vendors.reload());
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    _search.dispose();
    super.dispose();
  }

  void _notice(String text) => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

  Future<void> _open(Vendor vendor) async {
    FocusManager.instance.primaryFocus?.unfocus();
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => VendorDetailsScreen(
          vendor: vendor,
          controller: _vendors,
          platform: widget.platform,
          abilities: widget.abilities,
          onNewPurchaseOrder: widget.onNewPurchaseOrder,
        ),
      ),
    );
  }

  Future<void> _add() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final saved = await Navigator.of(context).push<Vendor>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => VendorFormScreen(controller: _vendors, platform: widget.platform),
      ),
    );
    if (saved == null || !mounted) return;
    _notice('Vendor added');
    await _open(saved);
  }

  Future<void> _filters() async {
    FocusManager.instance.primaryFocus?.unfocus();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _FilterSheet(controller: _vendors),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: _vendors,
      builder: (context, _) => Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
          title: const Text('Vendors'),
          actions: [
            IconButton(
              tooltip: _vendors.filtered ? 'Filters, some on' : 'Filters',
              onPressed: () => unawaited(_filters()),
              icon: Badge(isLabelVisible: _vendors.filtered, smallSize: 8, child: const Icon(Icons.filter_list)),
            ),
          ],
        ),
        floatingActionButton: widget.abilities.create
            ? FloatingActionButton.extended(onPressed: () => unawaited(_add()), icon: const Icon(Icons.add), label: const Text('New vendor'))
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
                      _vendors.setQuery(value);
                    },
                    textInputAction: TextInputAction.search,
                    decoration: InputDecoration(
                      prefixIcon: const Icon(Icons.search),
                      hintText: 'Search company, contact, GSTIN or PAN',
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Clear search',
                              onPressed: () {
                                _search.clear();
                                setState(() {});
                                _vendors.setQuery('');
                              },
                              icon: const Icon(Icons.close),
                            ),
                    ),
                  ),
                  if (_vendors.total != null) ...[
                    const SizedBox(height: Gap.s),
                    Text(
                      '${_vendors.total} ${_vendors.total == 1 ? 'vendor' : 'vendors'}${_vendors.query.isNotEmpty || _vendors.filtered ? ' match' : ''}',
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ],
              ),
            ),
            ListProgressLine(active: _vendors.refreshing),
            Expanded(child: _body(context)),
          ],
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    final vendors = _vendors.rows;
    if (vendors.isEmpty) {
      if (_vendors.loading) return const LoadingRows();
      if (_vendors.error != null) {
        return EmptyMessage(title: "Couldn't load vendors", body: _vendors.error!, action: 'Try again', onAction: () => unawaited(_vendors.reload()));
      }
      final narrowed = _vendors.query.isNotEmpty || _vendors.filtered;
      return EmptyMessage(
        title: narrowed ? 'No vendors match' : 'No vendors yet',
        body: narrowed ? 'Try a different search, or clear a filter.' : 'Add your first vendor to see it listed here.',
      );
    }
    final footer = _vendors.hasMore ? 1 : 0;
    return RefreshIndicator(
      onRefresh: _vendors.pullToRefresh,
      child: ListView.builder(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.only(bottom: widget.abilities.create ? 88 : 0),
        itemExtent: recordRowExtent(context),
        itemCount: vendors.length + footer,
        itemBuilder: (context, index) {
          if (index == vendors.length) {
            return const Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)));
          }
          final vendor = vendors[index];
          return _VendorRow(
            key: ValueKey(vendor.id),
            vendor: vendor,
            media: _vendors.mediaName(vendor.mediaId),
            onTap: () => unawaited(_open(vendor)),
          );
        },
      ),
    );
  }
}

class _VendorRow extends StatelessWidget {
  const _VendorRow({super.key, required this.vendor, required this.media, required this.onTap});

  final Vendor vendor;
  final String media;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final second = [vendor.subtitle, media].where((p) => p.isNotEmpty).join(' · ');
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Gap.m),
        child: Row(
          children: [
            Initials(text: vendor.initials, size: 44),
            const SizedBox(width: Gap.m),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(vendor.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15)),
                  if (second.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      second,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: Gap.s),
            Pill(label: vendor.active ? 'Active' : 'Inactive', tone: vendor.active ? PillTone.active : PillTone.neutral),
            Icon(Icons.chevron_right, color: theme.colorScheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}

class _FilterSheet extends StatefulWidget {
  const _FilterSheet({required this.controller});

  final VendorsController controller;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late bool? _status = widget.controller.statusFilter;
  late int? _media = widget.controller.mediaFilter;
  late int? _subMedia = widget.controller.subMediaFilter;

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final subs = c.subMedia.where((s) => _media == null || s.mediaId == _media).toList();
    return Padding(
      padding: EdgeInsets.fromLTRB(Gap.l, Gap.l, Gap.l, Gap.l + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Filters', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: Gap.m),
          SegmentedButton<int>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(value: 0, label: Text('Any status')),
              ButtonSegment(value: 1, label: Text('Active')),
              ButtonSegment(value: 2, label: Text('Inactive')),
            ],
            selected: {_status == null ? 0 : (_status! ? 1 : 2)},
            onSelectionChanged: (value) => setState(
              () => _status = switch (value.first) {
                1 => true,
                2 => false,
                _ => null,
              },
            ),
          ),
          const SizedBox(height: Gap.m),
          DropdownButtonFormField<int?>(
            initialValue: _media,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Media'),
            items: [
              const DropdownMenuItem<int?>(value: null, child: Text('All media')),
              for (final m in c.media)
                DropdownMenuItem<int?>(
                  value: m.id,
                  child: Text(m.name, overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: (value) => setState(() {
              _media = value;
              _subMedia = null;
            }),
          ),
          const SizedBox(height: Gap.m),
          DropdownButtonFormField<int?>(
            key: ValueKey(_media),
            initialValue: subs.any((s) => s.id == _subMedia) ? _subMedia : null,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Sub media'),
            items: [
              const DropdownMenuItem<int?>(value: null, child: Text('All sub media')),
              for (final s in subs)
                DropdownMenuItem<int?>(
                  value: s.id,
                  child: Text(s.name, overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: (value) => setState(() => _subMedia = value),
          ),
          const SizedBox(height: Gap.l),
          Row(
            children: [
              TextButton(
                onPressed: () {
                  c.setFilters();
                  Navigator.of(context).pop();
                },
                child: const Text('Clear all'),
              ),
              const Spacer(),
              FilledButton(
                onPressed: () {
                  c.setFilters(status: _status, mediaId: _media, subMediaId: _subMedia);
                  Navigator.of(context).pop();
                },
                child: const Text('Show vendors'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// One vendor, with the ways to reach them, as VendorDetails.jsx shows it.
class VendorDetailsScreen extends StatefulWidget {
  const VendorDetailsScreen({
    super.key,
    required this.vendor,
    required this.controller,
    required this.platform,
    required this.abilities,
    required this.onNewPurchaseOrder,
  });

  final Vendor vendor;
  final VendorsController controller;
  final PlatformApi platform;
  final VendorAbilities abilities;
  final void Function(Vendor vendor) onNewPurchaseOrder;

  @override
  State<VendorDetailsScreen> createState() => _VendorDetailsScreenState();
}

class _VendorDetailsScreenState extends State<VendorDetailsScreen> {
  late Vendor _vendor = widget.vendor;
  bool _showAccount = false;
  bool _documentBusy = false;

  void _notice(String text) => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

  Future<void> _call(String number) async {
    await Permission.phone.request();
    final result = await widget.platform.placeCall(number);
    if (result == null && mounted) _notice('This phone cannot place calls.');
  }

  Future<void> _email(String address) async {
    if (!await widget.platform.openExternal(Uri(scheme: 'mailto', path: address).toString()) && mounted) {
      _notice('No app on this phone can open that.');
    }
  }

  Future<void> _document({required bool view}) async {
    setState(() => _documentBusy = true);
    try {
      // A ten-minute link, made only now and handed straight to the download.
      final link = await widget.controller.documentLink(_vendor);
      await widget.platform.fetchFile(
        url: link.toString(),
        view: view,
        name: _vendor.documentName.isEmpty ? 'Vendor document' : _vendor.documentName,
      );
    } on ApiException catch (failure) {
      if (mounted) _notice('Could not open the document. ${failure.message}');
    } finally {
      if (mounted) setState(() => _documentBusy = false);
    }
  }

  Future<void> _edit() async {
    final saved = await Navigator.of(context).push<Vendor>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => VendorFormScreen(controller: widget.controller, platform: widget.platform, vendor: _vendor),
      ),
    );
    if (saved == null || !mounted) return;
    setState(() => _vendor = saved);
    _notice('Vendor saved');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final v = _vendor;
    final c = widget.controller;
    final number = v.dialable;
    final address = v.address;
    final account = v.accountNumber;
    final maskedAccount = account.isEmpty ? '' : (_showAccount || account.length <= 4 ? account : '•••• ${account.substring(account.length - 4)}');
    return Scaffold(
      appBar: AppBar(
        title: const Text('Vendor'),
        actions: [
          if (widget.abilities.edit) IconButton(tooltip: 'Edit vendor', onPressed: () => unawaited(_edit()), icon: const Icon(Icons.edit_outlined)),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(Gap.l),
        children: [
          Row(
            children: [
              Initials(text: v.initials, size: 52),
              const SizedBox(width: Gap.m),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(v.title, style: theme.textTheme.titleLarge),
                    const SizedBox(height: Gap.xs),
                    Wrap(
                      spacing: Gap.s,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Pill(label: v.active ? 'Active' : 'Inactive', tone: v.active ? PillTone.active : PillTone.neutral),
                        Text(
                          [v.vendorType, 'Vendor #${v.id}'].where((p) => p.isNotEmpty).join(' · '),
                          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: Gap.l),
          Row(
            children: [
              QuickAction(icon: Icons.call_outlined, label: 'Call', onPressed: number == null ? null : () => unawaited(_call(number))),
              const SizedBox(width: Gap.s),
              QuickAction(icon: Icons.mail_outline, label: 'Email', onPressed: v.email.isEmpty ? null : () => unawaited(_email(v.email))),
              if (widget.abilities.newPurchaseOrder) ...[
                const SizedBox(width: Gap.s),
                QuickAction(icon: Icons.post_add, label: 'New PO', onPressed: () => widget.onNewPurchaseOrder(v)),
              ],
            ],
          ),
          if (v.documentPath.isNotEmpty) ...[
            const SizedBox(height: Gap.l),
            Card.outlined(
              margin: EdgeInsets.zero,
              child: ListTile(
                leading: const Icon(Icons.description_outlined),
                title: const Text('Document'),
                subtitle: Text(v.documentName.isEmpty ? 'Vendor document' : v.documentName, maxLines: 1, overflow: TextOverflow.ellipsis),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      tooltip: 'View document',
                      onPressed: _documentBusy ? null : () => unawaited(_document(view: true)),
                      icon: const Icon(Icons.visibility_outlined),
                    ),
                    IconButton(
                      tooltip: 'Download document',
                      onPressed: _documentBusy ? null : () => unawaited(_document(view: false)),
                      icon: const Icon(Icons.download_outlined),
                    ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: Gap.l),
          DetailsCard(
            title: 'Contact',
            rows: [('Contact person', v.contactPerson), ('Alias', v.alias), ('Phone', v.phoneDisplay ?? ''), ('Email', v.email)],
          ),
          DetailsCard(
            title: 'Media and terms',
            rows: [
              ('Media', c.mediaName(v.mediaId)),
              ('Sub media', c.subMediaName(v.subMediaId)),
              ('Payment term', v.paymentTerm ?? ''),
              ('Payment term date', formatDisplayDate(v.paymentTermDate)),
            ],
          ),
          DetailsCard(
            title: 'Tax',
            rows: [
              ('GSTIN', v.gstin),
              ('PAN', v.pan),
              ('Registration', v.registration),
              ('GSTIN date', formatDisplayDate(v.gstinDate)),
              ('TDS', v.tdsPercentage.isEmpty ? '' : '${v.tdsPercentage}%'),
              ('TDS section', v.tdsSection),
              // As formatRupees on the web: ₹12,000.00.
              ('Opening balance', (num.tryParse(v.openingBalance) ?? 0) == 0 ? '' : formatMoney(num.parse(v.openingBalance).toDouble(), 'INR')),
            ],
          ),
          DetailsCard(title: 'Bank account', rows: [('Bank', v.bankName), ('IFSC', v.ifsc), ('Account number', maskedAccount)]),
          if (account.length > 4)
            Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.only(bottom: Gap.l),
                // Last four digits until asked: the screen is often seen by others.
                child: TextButton(
                  onPressed: () => setState(() => _showAccount = !_showAccount),
                  child: Text(_showAccount ? 'Hide account number' : 'Show account number'),
                ),
              ),
            ),
          DetailsCard(
            title: 'Address',
            rows: [
              ('Street', address?.street ?? ''),
              ('City', address?.city ?? ''),
              ('State', address?.state ?? ''),
              ('PIN code', address?.zipcode ?? ''),
              ('Country', address?.country ?? ''),
            ],
          ),
        ],
      ),
    );
  }
}
