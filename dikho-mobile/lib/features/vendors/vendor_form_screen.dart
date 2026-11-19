import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/crm_api.dart';
import '../../shared/platform_api.dart';
import '../clients/clients_models.dart' show clientDialCodes;
import '../inbox/chat_theme.dart';
import 'vendors_controller.dart';
import 'vendors_models.dart';

/// Add a vendor, or edit one when [vendor] is given: the fields and rules of
/// src/features/vendors/VendorForm.jsx. Company, media, sub media, state, city and
/// street are required. Pops with the vendor as saved.
///
/// Country, state and city are typed, with suggestions from the places vendors already
/// use, where the web form picks from a list of every place in the world; that list
/// alone is several megabytes.
class VendorFormScreen extends StatefulWidget {
  const VendorFormScreen({super.key, required this.controller, required this.platform, this.vendor});

  final VendorsController controller;
  final PlatformApi platform;
  final Vendor? vendor;

  @override
  State<VendorFormScreen> createState() => _VendorFormScreenState();
}

class _VendorFormScreenState extends State<VendorFormScreen> {
  late final VendorDraft _draft = VendorDraft.from(widget.vendor);
  late final String _start;
  late final String _startCountry = _draft.country.trim();
  final _fields = <String, TextEditingController>{};
  final _companyFocus = FocusNode();
  List<String> _registrations = const [];
  Map<String, String> _problems = const {};
  bool _saving = false;
  String? _error;
  PickedDocument? _document;
  String? _documentError;
  bool _picking = false;

  bool get _isEdit => widget.vendor != null;
  VendorsController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    _start = _snapshot();
    unawaited(
      _c.registrations(_draft.registration).then((values) {
        if (mounted) setState(() => _registrations = values);
      }),
    );
    if (_c.media.isEmpty) {
      unawaited(
        _c.loadCatalog().then((_) {
          if (mounted) setState(() {});
        }),
      );
    }
  }

  @override
  void dispose() {
    for (final field in _fields.values) {
      field.dispose();
    }
    _companyFocus.dispose();
    final copy = _document?.file;
    if (copy != null) unawaited(copy.exists().then((there) => there ? copy.delete() : copy));
    super.dispose();
  }

  String _snapshot() => '${_draft.vendorPayload()}${_draft.addressPayload('x')}${_document?.name}';

  bool get _changed => _snapshot() != _start;

  TextEditingController _field(String key, String initial) => _fields[key] ??= TextEditingController(text: initial);

  void _clearProblem(String key) {
    if (_problems.containsKey(key)) setState(() => _problems = {..._problems}..remove(key));
  }

  /// India is the one country the form fills a code for, as the web form's default;
  /// a country left as it was keeps the code it had.
  void _syncCountryCode() {
    final country = _draft.country.trim();
    if (country.toLowerCase() == 'india') {
      _draft.countryCode = 'IN';
    } else if (country != _startCountry) {
      _draft.countryCode = '';
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    _syncCountryCode();
    final problems = _draft.problems();
    setState(() {
      _problems = problems;
      _error = null;
    });
    if (problems.isNotEmpty) {
      if (problems.containsKey('company_name')) _companyFocus.requestFocus();
      return;
    }
    setState(() => _saving = true);
    try {
      final saved = await _c.save(widget.vendor, _draft, document: _document);
      if (mounted) Navigator.of(context).pop(saved);
    } on ApiException catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _leave() async {
    if (!_changed) {
      Navigator.of(context).pop();
      return;
    }
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
    if (discard == true && mounted) Navigator.of(context).pop();
  }

  Future<void> _pickDate(String current, ValueChanged<String> onPicked) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(current) ?? now,
      firstDate: DateTime(2000),
      lastDate: DateTime(now.year + 2, 12, 31),
    );
    if (picked == null) return;
    setState(
      () => onPicked('${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}'),
    );
  }

  Future<void> _pickDocument() async {
    setState(() {
      _picking = true;
      _documentError = null;
    });
    try {
      final picked = await widget.platform.pickFiles(vendorDocumentTypes, false);
      if (picked.isEmpty) return;
      final file = await widget.platform.copyPicked(picked.first);
      final path = file?.path;
      if (file == null || path == null) throw const ApiException('That file could not be read.');
      final copy = File(path);
      final size = await copy.length();
      final mime = file.mime.toLowerCase();
      String? problem;
      if (!vendorDocumentTypes.contains(mime)) problem = 'Use a PDF, JPG, PNG or WEBP file.';
      if (file.tooLarge || size > vendorDocumentMaxBytes) problem = 'The file must be smaller than 10 MB.';
      if (problem != null) {
        await copy.delete();
        throw ApiException(problem);
      }
      final old = _document?.file;
      if (old != null && await old.exists()) await old.delete();
      if (mounted) setState(() => _document = PickedDocument(file: copy, name: file.name, mime: mime));
    } on ApiException catch (failure) {
      if (mounted) setState(() => _documentError = failure.message);
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  Widget _text(
    String key,
    String label,
    String initial,
    ValueChanged<String> onChanged, {
    TextInputType? keyboard,
    List<TextInputFormatter>? formatters,
    TextCapitalization caps = TextCapitalization.none,
    bool required = false,
    FocusNode? focus,
    String? helper,
    int maxLines = 1,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: Gap.m),
    child: TextField(
      controller: _field(key, initial),
      focusNode: focus,
      onChanged: (value) {
        onChanged(value);
        _clearProblem(key);
      },
      keyboardType: keyboard,
      inputFormatters: formatters,
      textCapitalization: caps,
      maxLines: maxLines,
      decoration: InputDecoration(labelText: required ? '$label *' : label, errorText: _problems[key], helperText: helper),
    ),
  );

  /// A typed place with suggestions from the places vendors already use.
  Widget _place(String key, String label, String initial, Iterable<String> Function() options, ValueChanged<String> onChanged) => Padding(
    padding: const EdgeInsets.only(bottom: Gap.m),
    child: Autocomplete<String>(
      initialValue: TextEditingValue(text: initial),
      optionsBuilder: (value) {
        final typed = value.text.trim().toLowerCase();
        final all = options().where((o) => o.isNotEmpty).toSet().toList()..sort();
        return typed.isEmpty ? all.take(20) : all.where((o) => o.toLowerCase().contains(typed)).take(20);
      },
      onSelected: (value) => setState(() {
        onChanged(value);
        _clearProblem(key);
      }),
      fieldViewBuilder: (context, controller, focus, onSubmitted) => TextField(
        controller: controller,
        focusNode: focus,
        textCapitalization: TextCapitalization.words,
        onChanged: (value) {
          onChanged(value);
          _clearProblem(key);
        },
        decoration: InputDecoration(labelText: '$label *', errorText: _problems[key]),
      ),
    ),
  );

  Widget _section(String title) => Padding(
    padding: const EdgeInsets.only(top: Gap.s, bottom: Gap.m),
    child: Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Theme.of(context).colorScheme.primary)),
  );

  Widget _dropdown<T>(String key, String label, T? value, List<(T, String)> items, ValueChanged<T?> onChanged, {String? empty}) => Padding(
    padding: const EdgeInsets.only(bottom: Gap.m),
    child: DropdownButtonFormField<T?>(
      key: ValueKey('$key-${items.length}-${items.isEmpty ? '' : items.first.$1}'),
      initialValue: items.any((i) => i.$1 == value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(labelText: label, errorText: _problems[key]),
      hint: empty == null ? null : Text(empty),
      items: [
        for (final (v, text) in items)
          DropdownMenuItem<T?>(
            value: v,
            child: Text(text, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (v) {
        setState(() => onChanged(v));
        _clearProblem(key);
      },
    ),
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final d = _draft;
    final subs = _c.subMedia.where((s) => s.mediaId == d.mediaId).toList();
    final digits = [FilteringTextInputFormatter.digitsOnly];
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Close', onPressed: () => unawaited(_leave()), icon: const Icon(Icons.close)),
          title: Text(_isEdit ? 'Edit vendor' : 'New vendor'),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: Gap.s),
              child: _saving
                  ? const Padding(
                      padding: EdgeInsets.all(Gap.m),
                      child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                    )
                  : TextButton(onPressed: _save, child: Text(_isEdit ? 'Save' : 'Add')),
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl),
          children: [
            if (_error != null)
              Container(
                margin: const EdgeInsets.only(bottom: Gap.m),
                padding: const EdgeInsets.all(Gap.m),
                decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
                child: Text('Could not save the vendor. $_error', style: TextStyle(color: theme.colorScheme.onErrorContainer)),
              ),
            if (_problems.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: Text('Some fields need attention. They are marked below.', style: TextStyle(color: theme.colorScheme.error)),
              ),
            _section('Vendor'),
            _text(
              'company_name',
              'Company name',
              d.companyName,
              (v) => d.companyName = v,
              caps: TextCapitalization.words,
              focus: _companyFocus,
              required: true,
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.m),
              child: SegmentedButton<String>(
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(value: 'Organization', label: Text('Organization')),
                  ButtonSegment(value: 'Individual', label: Text('Individual')),
                ],
                selected: {d.vendorType},
                onSelectionChanged: (value) => setState(() => d.vendorType = value.first),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.m),
              child: SegmentedButton<bool>(
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(value: true, label: Text('Active')),
                  ButtonSegment(value: false, label: Text('Inactive')),
                ],
                selected: {d.active},
                onSelectionChanged: (value) => setState(() => d.active = value.first),
              ),
            ),
            _text('contact_person', 'Contact person', d.contactPerson, (v) => d.contactPerson = v, caps: TextCapitalization.words),
            _text('alias', 'Alias', d.alias, (v) => d.alias = v, helper: 'The short name your team uses for them.'),
            _text('email', 'Email', d.email, (v) => d.email = v, keyboard: TextInputType.emailAddress),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 120,
                  child: _dropdown<String>('country_dialcode', 'Code', clientDialCodes.any((c) => c.$1 == d.dialCode) ? d.dialCode : '91', [
                    for (final (value, label) in clientDialCodes) (value, label),
                  ], (v) => d.dialCode = v ?? '91'),
                ),
                const SizedBox(width: Gap.s),
                Expanded(
                  child: _text('contact', 'Phone', d.contact, (v) => d.contact = v, keyboard: TextInputType.phone, formatters: digits),
                ),
              ],
            ),
            _section('Media and terms'),
            if (_c.media.isEmpty && _c.catalogLoaded)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: Text('No media types are set up yet. Ask an administrator to add them.', style: TextStyle(color: theme.colorScheme.error)),
              ),
            _dropdown<int>('media_id', 'Media *', d.mediaId, [for (final m in _c.media) (m.id, m.name)], (v) {
              d.mediaId = v;
              d.subMediaId = null;
            }, empty: _c.catalogLoaded ? 'Choose media' : 'Loading…'),
            _dropdown<int>(
              'sub_media_id',
              'Sub media *',
              d.subMediaId,
              [for (final s in subs) (s.id, s.name)],
              (v) => d.subMediaId = v,
              empty: d.mediaId == null ? 'Choose media first' : 'Choose sub media',
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _text(
                    'payment_term_value',
                    'Payment term',
                    d.paymentTermValue,
                    (v) => d.paymentTermValue = v,
                    keyboard: TextInputType.number,
                    formatters: digits,
                    helper: 'Days',
                  ),
                ),
                const SizedBox(width: Gap.s),
                Expanded(
                  child: _dropdown<String>(
                    'payment_term_type',
                    'Counted from',
                    d.paymentTermType,
                    paymentTermTypes,
                    (v) => d.paymentTermType = v ?? 'Invoice Date',
                  ),
                ),
              ],
            ),
            _DateField(
              label: 'Payment term date',
              value: d.paymentTermDate,
              onPick: () => _pickDate(d.paymentTermDate, (v) => d.paymentTermDate = v),
              onClear: () => setState(() => d.paymentTermDate = ''),
            ),
            _section('Tax'),
            _text('gstin', 'GSTIN', d.gstin, (v) => d.gstin = v, caps: TextCapitalization.characters),
            _text('pan_number', 'PAN', d.pan, (v) => d.pan = v, caps: TextCapitalization.characters),
            _dropdown<String>('registration', 'Registration', d.registration.isEmpty ? '' : d.registration, [
              ('', 'Not set'),
              for (final r in _registrations) (r, r),
            ], (v) => d.registration = v ?? ''),
            _DateField(
              label: 'GSTIN date',
              value: d.gstinDate,
              onPick: () => _pickDate(d.gstinDate, (v) => d.gstinDate = v),
              onClear: () => setState(() => d.gstinDate = ''),
            ),
            _text(
              'tds_percentage',
              'TDS',
              d.tdsPercentage,
              (v) => d.tdsPercentage = v,
              keyboard: const TextInputType.numberWithOptions(decimal: true),
              helper: 'Percent',
            ),
            _text('tds_section', 'TDS section', d.tdsSection, (v) => d.tdsSection = v, caps: TextCapitalization.characters),
            _text(
              'opening_balance',
              'Opening balance',
              d.openingBalance,
              (v) => d.openingBalance = v,
              keyboard: const TextInputType.numberWithOptions(decimal: true, signed: true),
            ),
            _section('Bank account'),
            _text('vendor_bank_name', 'Bank name', d.bankName, (v) => d.bankName = v, caps: TextCapitalization.words),
            _text('vendor_ifsc_code', 'IFSC', d.ifsc, (v) => d.ifsc = v, caps: TextCapitalization.characters),
            _text(
              'vendor_account_number',
              'Account number',
              d.accountNumber,
              (v) => d.accountNumber = v,
              keyboard: TextInputType.number,
              formatters: digits,
            ),
            _text(
              'vendor_confirm_account_number',
              'Confirm account number',
              d.confirmAccountNumber,
              (v) => d.confirmAccountNumber = v,
              keyboard: TextInputType.number,
              formatters: digits,
            ),
            _section('Address'),
            _text('country', 'Country', d.country, (v) => d.country = v, caps: TextCapitalization.words),
            _place(
              'state',
              'State',
              d.state,
              () => _c.places.where((p) => d.country.isEmpty || p.country.toLowerCase() == d.country.trim().toLowerCase()).map((p) => p.state),
              (v) => d.state = v,
            ),
            _place(
              'city',
              'City',
              d.city,
              () => _c.places.where((p) => d.state.isEmpty || p.state.toLowerCase() == d.state.trim().toLowerCase()).map((p) => p.city),
              (v) => d.city = v,
            ),
            _text('zipcode', 'PIN code', d.zipcode, (v) => d.zipcode = v, keyboard: TextInputType.number),
            _text('address', 'Street address', d.street, (v) => d.street = v, caps: TextCapitalization.sentences, required: true, maxLines: 3),
            _section('Document'),
            Text(
              _isEdit && widget.vendor!.documentPath.isNotEmpty
                  ? 'A new file is kept beside the old one, and the vendor points to the new one. PDF, JPG, PNG or WEBP, under 10 MB.'
                  : 'PDF, JPG, PNG or WEBP, under 10 MB.',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: Gap.s),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: _picking || _saving ? null : () => unawaited(_pickDocument()),
                  icon: const Icon(Icons.attach_file),
                  label: Text(_document == null ? 'Choose a file' : 'Choose another'),
                ),
                const SizedBox(width: Gap.m),
                if (_document != null) Expanded(child: Text(_document!.name, maxLines: 2, overflow: TextOverflow.ellipsis)),
              ],
            ),
            if (_documentError != null)
              Padding(
                padding: const EdgeInsets.only(top: Gap.xs),
                child: Text(_documentError!, style: TextStyle(color: theme.colorScheme.error)),
              ),
          ],
        ),
      ),
    );
  }
}

class _DateField extends StatelessWidget {
  const _DateField({required this.label, required this.value, required this.onPick, required this.onClear});

  final String label;
  final String value;
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
          suffixIcon: value.isEmpty
              ? const Icon(Icons.event)
              : IconButton(tooltip: 'Clear $label', onPressed: onClear, icon: const Icon(Icons.close)),
        ),
        isEmpty: value.isEmpty,
        child: Text(value),
      ),
    ),
  );
}
