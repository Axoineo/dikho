import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/record_ui.dart' show formatDisplayDate;
import '../inbox/chat_theme.dart';
import 'sales_orders_models.dart';

/// The pieces sales orders and purchase orders share: both live in `salesorder` and
/// `salesorderdocument`, with the same money rules, so their screens are built from the
/// same parts.

/// The colour an order or line is marked with, as a small dot.
class ColorDot extends StatelessWidget {
  const ColorDot(this.hex, {super.key});

  final String hex;

  @override
  Widget build(BuildContext context) {
    final value = colorValue(hex);
    if (value == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(right: Gap.s),
      child: ExcludeSemantics(
        child: Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: Color(value), shape: BoxShape.circle),
        ),
      ),
    );
  }
}

/// An order's money: the total first and largest, then what makes it up.
class OrderFigures extends StatelessWidget {
  const OrderFigures({super.key, required this.rows, required this.total, this.emphasize});

  final List<(String, String)> rows;
  final String total;

  /// The row to set in bold: what is still owed.
  final String? emphasize;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(Gap.m),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            MergeSemantics(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text('Total', style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                  const SizedBox(width: Gap.m),
                  Expanded(
                    child: Text(total, textAlign: TextAlign.end, style: theme.textTheme.headlineSmall),
                  ),
                ],
              ),
            ),
            for (final (label, value) in rows) ...[
              const SizedBox(height: Gap.s),
              MergeSemantics(
                child: Row(
                  children: [
                    Text(label, style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                    const SizedBox(width: Gap.m),
                    Expanded(
                      child: Text(
                        value,
                        textAlign: TextAlign.end,
                        style: label == emphasize ? const TextStyle(fontWeight: FontWeight.w600) : null,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A note that the stored total no longer matches the lines.
class DriftNote extends StatelessWidget {
  const DriftNote({super.key, required this.linesTotal});

  final String linesTotal;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(top: Gap.m),
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline, size: 20),
          const SizedBox(width: Gap.s),
          Expanded(child: Text('The items add up to $linesTotal, not the stored total. Opening and saving the order recalculates it.')),
        ],
      ),
    );
  }
}

/// One line of an order, as SalesOrderItemCard.jsx shows it. A purchase order's line
/// leaves out the "PO #" it would only point back at itself with.
class OrderItemCard extends StatelessWidget {
  const OrderItemCard({super.key, required this.item, required this.money, required this.onOpenAttachment, this.forPurchaseOrder = false});

  final OrderItem item;
  final String Function(Object? value) money;
  final void Function(Uri link) onOpenAttachment;
  final bool forPurchaseOrder;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final link = item.attachment;
    final meta = item.meta(forPurchaseOrder: forPurchaseOrder);
    return Card.outlined(
      margin: const EdgeInsets.only(bottom: Gap.s),
      child: Padding(
        padding: const EdgeInsets.all(Gap.m),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            MergeSemantics(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ColorDot(item.color),
                  Expanded(
                    child: Text(item.name.isEmpty ? 'Untitled item' : item.name, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500)),
                  ),
                  const SizedBox(width: Gap.s),
                  Text(money(item.raw['after_tax_amount']), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500)),
                ],
              ),
            ),
            const SizedBox(height: Gap.xs),
            Text('${money(item.raw['taxable_amount'])} + ${money(item.raw['tax_amount'])} tax', style: muted),
            if (item.taxLine.isNotEmpty) Text(item.taxLine, style: muted),
            if (meta.isNotEmpty) Text(meta.join(' · '), style: muted),
            if (item.note.isNotEmpty) ...[const SizedBox(height: Gap.xs), Text(item.note)],
            if (link != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => onOpenAttachment(link),
                  icon: const Icon(Icons.link, size: 18),
                  label: const Text('Open attachment'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Up to twelve digits and two decimals: the browser's number field, without the
/// minus sign an order has no use for.
class AmountFormatter extends TextInputFormatter {
  static final _shape = RegExp(r'^\d{0,12}(\.\d{0,2})?$');

  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) => _shape.hasMatch(newValue.text) ? newValue : oldValue;
}

/// A field that opens a chooser, read out as one line with its problem included: the
/// parts it is drawn from would say "star" and leave the problem out.
class ChoiceField extends StatelessWidget {
  const ChoiceField({super.key, required this.label, required this.value, required this.onTap, this.error, this.required = false, this.emptyText});

  final String label;
  final String value;
  final VoidCallback? onTap;
  final String? error;
  final bool required;

  /// Shown in place of a value when there is none, such as "Choose the vendor first".
  final String? emptyText;

  @override
  Widget build(BuildContext context) {
    final spoken = value.isEmpty ? '$label${required ? ', required' : ''}, ${emptyText ?? 'not chosen'}' : '$label, $value';
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.m),
      child: Semantics(
        button: true,
        enabled: onTap != null,
        label: [spoken, ?error].join('. '),
        excludeSemantics: true,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(4),
          child: InputDecorator(
            decoration: InputDecoration(
              labelText: required ? '$label *' : label,
              errorText: error,
              errorMaxLines: 3,
              enabled: onTap != null,
              helperText: value.isEmpty ? emptyText : null,
              suffixIcon: const Icon(Icons.arrow_drop_down),
            ),
            isEmpty: value.isEmpty,
            child: Text(value, maxLines: 2, overflow: TextOverflow.ellipsis),
          ),
        ),
      ),
    );
  }
}

class OrderDateField extends StatelessWidget {
  const OrderDateField({super.key, required this.label, required this.value, required this.onPick, required this.onClear, this.error});

  final String label;
  final String value;
  final String? error;
  final VoidCallback onPick;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: Gap.m),
    child: InkWell(
      onTap: onPick,
      borderRadius: BorderRadius.circular(4),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          errorText: error,
          errorMaxLines: 3,
          suffixIcon: value.isEmpty
              ? const Icon(Icons.event)
              : IconButton(tooltip: 'Clear $label', onPressed: onClear, icon: const Icon(Icons.close)),
        ),
        isEmpty: value.isEmpty,
        child: Text(formatDisplayDate(value)),
      ),
    ),
  );
}

/// Label and figure rows in a box; the last row is the one that matters.
class SumsCard extends StatelessWidget {
  const SumsCard({super.key, required this.rows});

  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(Gap.m),
        child: Column(
          children: [
            for (final (index, (label, value)) in rows.indexed)
              Padding(
                padding: EdgeInsets.only(top: index == 0 ? 0 : Gap.s),
                child: MergeSemantics(
                  // A long label wraps; the figure never does.
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(label, style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                      ),
                      const SizedBox(width: Gap.m),
                      Text(value, style: index == rows.length - 1 ? theme.textTheme.titleMedium : null),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A full-screen, searchable list to choose one thing from: a client, a sales order,
/// a vendor. Pops with the chosen one.
class SearchPicker<T> extends StatefulWidget {
  const SearchPicker({
    super.key,
    required this.title,
    required this.searchHint,
    required this.listenable,
    required this.items,
    required this.titleOf,
    required this.isCurrent,
    required this.loading,
    required this.error,
    required this.onRetry,
    required this.emptyText,
    this.subtitleOf,
    this.searchTextOf,
  });

  final String title;
  final String searchHint;
  final Listenable listenable;
  final List<T> Function() items;
  final String Function(T item) titleOf;
  final String Function(T item)? subtitleOf;

  /// What a search looks in; by default the title and subtitle.
  final String Function(T item)? searchTextOf;
  final bool Function(T item) isCurrent;
  final bool Function() loading;
  final String? Function() error;
  final VoidCallback onRetry;
  final String emptyText;

  @override
  State<SearchPicker<T>> createState() => _SearchPickerState<T>();
}

class _SearchPickerState<T> extends State<SearchPicker<T>> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  String _searchText(T item) => widget.searchTextOf?.call(item) ?? '${widget.titleOf(item)} ${widget.subtitleOf?.call(item) ?? ''}';

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.listenable,
    builder: (context, _) {
      final theme = Theme.of(context);
      final all = widget.items();
      final typed = _search.text.trim().toLowerCase();
      final shown = typed.isEmpty ? all : all.where((item) => _searchText(item).toLowerCase().contains(typed)).toList();
      final error = widget.error();
      return Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Close', onPressed: () => Navigator.of(context).pop(), icon: const Icon(Icons.close)),
          title: Text(widget.title),
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, Gap.m, Gap.s),
              child: TextField(
                controller: _search,
                autofocus: true,
                onChanged: (_) => setState(() {}),
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: widget.searchHint),
              ),
            ),
            const Divider(),
            Expanded(
              child: widget.loading() && all.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : error != null && all.isEmpty
                  ? ListView(
                      padding: const EdgeInsets.all(Gap.xl),
                      children: [
                        Text("Couldn't load the list. $error", textAlign: TextAlign.center),
                        const SizedBox(height: Gap.m),
                        Center(
                          child: FilledButton(onPressed: widget.onRetry, child: const Text('Try again')),
                        ),
                      ],
                    )
                  : shown.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(Gap.xl),
                      child: Text(
                        all.isEmpty ? widget.emptyText : 'Nothing matches.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    )
                  : ListView.builder(
                      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                      itemCount: shown.length,
                      itemBuilder: (context, index) {
                        final item = shown[index];
                        final chosen = widget.isCurrent(item);
                        final subtitle = widget.subtitleOf?.call(item) ?? '';
                        return ListTile(
                          title: Text(widget.titleOf(item)),
                          subtitle: subtitle.isEmpty ? null : Text(subtitle),
                          selected: chosen,
                          trailing: chosen ? const Icon(Icons.check) : null,
                          onTap: () => Navigator.of(context).pop(item),
                        );
                      },
                    ),
            ),
          ],
        ),
      );
    },
  );
}

/// The field builders an order form uses, keyed so a problem shows under its field and
/// each text field keeps its own controller.
mixin OrderFormFields<W extends StatefulWidget> on State<W> {
  final fieldControllers = <String, TextEditingController>{};
  Map<String, String> problems = const {};

  /// Today, from the screen's own clock, for the date picker.
  DateTime get today;

  TextEditingController controllerFor(String key, String initial) => fieldControllers[key] ??= TextEditingController(text: initial);

  void disposeFields() {
    for (final field in fieldControllers.values) {
      field.dispose();
    }
  }

  void clearProblem(String key) {
    if (problems.containsKey(key)) setState(() => problems = {...problems}..remove(key));
  }

  /// "Not set" and then the choices.
  List<(String, String)> notSetAnd(List<String> values) => [('', 'Not set'), for (final v in values) (v, v)];

  Future<void> pickDate(String current, ValueChanged<String> onPicked, {String? earliest}) async {
    final now = today;
    final first = DateTime.tryParse(earliest ?? '') ?? DateTime(2000);
    var initial = DateTime.tryParse(current) ?? now;
    if (initial.isBefore(first)) initial = first;
    final last = DateTime(now.year + 5, 12, 31);
    if (initial.isAfter(last)) initial = last;
    final picked = await showDatePicker(context: context, initialDate: initial, firstDate: first, lastDate: last);
    if (picked == null || !mounted) return;
    setState(() => onPicked(todayIso(picked)));
  }

  /// Asks before throwing away what was typed; true to leave.
  Future<bool> confirmDiscard() async {
    final discard = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Discard your changes?'),
        content: const Text('What you typed here has not been saved.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Keep editing')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Discard')),
        ],
      ),
    );
    return discard == true;
  }

  Widget textField(
    String key,
    String label,
    String initial,
    ValueChanged<String> onChanged, {
    TextInputType? keyboard,
    List<TextInputFormatter>? formatters,
    TextCapitalization caps = TextCapitalization.none,
    bool required = false,
    bool enabled = true,
    String? helper,
    String? prefix,
    int maxLines = 1,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: Gap.m),
    child: TextField(
      controller: controllerFor(key, initial),
      enabled: enabled,
      onChanged: (value) {
        onChanged(value);
        clearProblem(key);
        setState(() {});
      },
      keyboardType: keyboard,
      inputFormatters: formatters,
      textCapitalization: caps,
      maxLines: maxLines,
      decoration: InputDecoration(
        labelText: required ? '$label *' : label,
        errorText: problems[key],
        errorMaxLines: 3,
        helperText: helper,
        prefixText: prefix,
      ),
    ),
  );

  Widget amountField(String key, String label, String initial, ValueChanged<String> onChanged, {bool enabled = true, String? helper}) => textField(
    key,
    label,
    initial,
    onChanged,
    keyboard: const TextInputType.numberWithOptions(decimal: true),
    formatters: [AmountFormatter()],
    enabled: enabled,
    helper: helper,
    prefix: '₹ ',
  );

  Widget dropdownField(
    String key,
    String label,
    String value,
    List<(String, String)> items,
    ValueChanged<String> onChanged, {
    bool enabled = true,
    String? helper,
  }) {
    final options = [...items];
    if (!options.any((o) => o.$1 == value)) options.add((value, value));
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.m),
      child: DropdownButtonFormField<String>(
        key: ValueKey('$key-$value-${options.length}'),
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(labelText: label, helperText: helper, errorText: problems[key], errorMaxLines: 3),
        items: [
          for (final (v, text) in options)
            DropdownMenuItem(
              value: v,
              child: Text(text, overflow: TextOverflow.ellipsis),
            ),
        ],
        onChanged: enabled
            ? (v) {
                setState(() => onChanged(v ?? ''));
                clearProblem(key);
              }
            : null,
      ),
    );
  }

  Widget dateField(String key, String label, String value, ValueChanged<String> onPicked, {String? earliest}) => OrderDateField(
    label: label,
    value: value,
    error: problems[key],
    onPick: () {
      clearProblem(key);
      unawaited(pickDate(value, onPicked, earliest: earliest));
    },
    onClear: () {
      clearProblem(key);
      setState(() => onPicked(''));
    },
  );

  Widget sectionTitle(String title, {String? note}) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: Gap.s, bottom: Gap.m),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            header: true,
            child: Text(title, style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.primary)),
          ),
          if (note != null) ...[
            const SizedBox(height: Gap.xs),
            Text(note, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ],
      ),
    );
  }

  Widget errorBox(String text, {Widget? action}) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: Gap.m),
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(text, style: TextStyle(color: theme.colorScheme.onErrorContainer)),
          ?action,
        ],
      ),
    );
  }

  /// Total at the foot of the form, always in view.
  Widget totalBar(String total) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Container(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: theme.colorScheme.outlineVariant)),
        ),
        padding: const EdgeInsets.symmetric(horizontal: Gap.l, vertical: Gap.m),
        child: MergeSemantics(
          child: Row(
            children: [
              Text('Total', style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
              const Spacer(),
              Text(total, style: theme.textTheme.titleMedium),
            ],
          ),
        ),
      ),
    );
  }
}
