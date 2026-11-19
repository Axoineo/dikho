import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/crm_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import 'clients_controller.dart';
import 'clients_models.dart';

/// Add a client, or edit one when [client] is given: the fields and rules of
/// src/features/clients/ClientForm.jsx. Only the company name is required. Pops with
/// the client as saved.
class ClientFormScreen extends StatefulWidget {
  const ClientFormScreen({super.key, required this.controller, this.client});

  final ClientsController controller;
  final Client? client;

  @override
  State<ClientFormScreen> createState() => _ClientFormScreenState();
}

class _ClientFormScreenState extends State<ClientFormScreen> {
  late final ClientDraft _draft = ClientDraft.from(widget.client);
  // Taken when the form opens. A late initializer would only run at the first
  // comparison, so every form would look unchanged and Back would drop edits unasked.
  late final String _start;
  final _fields = <String, TextEditingController>{};
  final _companyFocus = FocusNode();
  List<String> _registrations = const [];
  Map<String, String> _problems = const {};
  bool _saving = false;
  String? _error;
  late bool _moreTax =
      _draft.registration.isNotEmpty || _draft.gstinDate.isNotEmpty || _draft.tdsPercentage.isNotEmpty || _draft.tdsSection.isNotEmpty;

  bool get _isEdit => widget.client != null;

  @override
  void initState() {
    super.initState();
    _start = _snapshot();
    unawaited(
      widget.controller.registrations(_draft.registration).then((values) {
        if (mounted) setState(() => _registrations = values);
      }),
    );
  }

  @override
  void dispose() {
    for (final field in _fields.values) {
      field.dispose();
    }
    _companyFocus.dispose();
    super.dispose();
  }

  String _snapshot() => _draft.toPayload().toString();

  bool get _changed => _snapshot() != _start;

  TextEditingController _field(String key, String initial) => _fields[key] ??= TextEditingController(text: initial);

  Future<void> _save() async {
    if (_saving) return;
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
      final saved = await widget.controller.save(widget.client, _draft);
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

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final current = DateTime.tryParse(_draft.gstinDate);
    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? now,
      firstDate: DateTime(2017),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (picked == null) return;
    final value = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    setState(() => _draft.gstinDate = value);
  }

  Widget _text(
    String key,
    String label,
    String initial,
    ValueChanged<String> onChanged, {
    TextInputType? keyboard,
    List<TextInputFormatter>? formatters,
    TextCapitalization caps = TextCapitalization.none,
    bool optional = false,
    FocusNode? focus,
    String? suffix,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: Gap.m),
    child: TextField(
      controller: _field(key, initial),
      focusNode: focus,
      onChanged: (value) {
        onChanged(value);
        if (_problems.containsKey(key)) setState(() => _problems = {..._problems}..remove(key));
      },
      keyboardType: keyboard,
      inputFormatters: formatters,
      textCapitalization: caps,
      decoration: InputDecoration(labelText: optional ? '$label (optional)' : label, errorText: _problems[key], suffixText: suffix),
    ),
  );

  Widget _section(String title) => Padding(
    padding: const EdgeInsets.only(top: Gap.s, bottom: Gap.m),
    child: Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Theme.of(context).colorScheme.primary)),
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final d = _draft;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Close', onPressed: () => unawaited(_leave()), icon: const Icon(Icons.close)),
          title: Text(_isEdit ? 'Edit client' : 'New client'),
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
            if (!_isEdit)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: Text(
                  'Only the company name is required. Everything else can be added later.',
                  style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                ),
              ),
            if (_error != null)
              Container(
                margin: const EdgeInsets.only(bottom: Gap.m),
                padding: const EdgeInsets.all(Gap.m),
                decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
                child: Text('Could not save the client. $_error', style: TextStyle(color: theme.colorScheme.onErrorContainer)),
              ),
            _section('Company'),
            _text('company_name', 'Company name', d.companyName, (v) => d.companyName = v, caps: TextCapitalization.words, focus: _companyFocus),
            _text('contact_person', 'Contact person', d.contactPerson, (v) => d.contactPerson = v, caps: TextCapitalization.words),
            _text('designation', 'Designation', d.designation, (v) => d.designation = v, caps: TextCapitalization.words),
            _text('email', 'Email', d.email, (v) => d.email = v, keyboard: TextInputType.emailAddress),
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.m),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 120,
                    child: DropdownButtonFormField<String>(
                      // Fits its box at any font size: the label ends in dots rather than spilling.
                      isExpanded: true,
                      initialValue: clientDialCodes.any((c) => c.$1 == d.dialCode) ? d.dialCode : '91',
                      decoration: const InputDecoration(labelText: 'Code'),
                      items: [
                        for (final (value, label) in clientDialCodes)
                          DropdownMenuItem(
                            value: value,
                            child: Text(label, overflow: TextOverflow.ellipsis),
                          ),
                      ],
                      onChanged: (value) => setState(() => d.dialCode = value ?? '91'),
                    ),
                  ),
                  const SizedBox(width: Gap.s),
                  Expanded(
                    child: _text(
                      'contact',
                      'Phone',
                      d.contact,
                      (v) => d.contact = v,
                      keyboard: TextInputType.phone,
                      formatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(15)],
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.m),
              child: SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: true, label: Text('Active')),
                  ButtonSegment(value: false, label: Text('Inactive')),
                ],
                selected: {d.active},
                onSelectionChanged: (value) => setState(() => d.active = value.first),
              ),
            ),
            _section('Tax'),
            _text(
              'gstin',
              'GSTIN',
              d.gstin,
              (v) => d.gstin = v.toUpperCase(),
              caps: TextCapitalization.characters,
              formatters: [LengthLimitingTextInputFormatter(15)],
            ),
            _text(
              'pan_number',
              'PAN',
              d.pan,
              (v) => d.pan = v.toUpperCase(),
              caps: TextCapitalization.characters,
              formatters: [LengthLimitingTextInputFormatter(10)],
            ),
            if (!_moreTax)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => setState(() => _moreTax = true),
                  icon: const Icon(Icons.expand_more),
                  label: const Text('More details · 4 fields'),
                ),
              )
            else ...[
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: DropdownButtonFormField<String>(
                  isExpanded: true,
                  initialValue: d.registration,
                  decoration: const InputDecoration(labelText: 'Registration'),
                  items: [
                    const DropdownMenuItem(value: '', child: Text('Not set')),
                    for (final value in {..._registrations, if (d.registration.isNotEmpty) d.registration})
                      DropdownMenuItem(value: value, child: Text(value)),
                  ],
                  onChanged: (value) => setState(() => d.registration = value ?? ''),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: InkWell(
                  onTap: () => unawaited(_pickDate()),
                  child: InputDecorator(
                    decoration: InputDecoration(
                      labelText: 'GSTIN date',
                      suffixIcon: d.gstinDate.isEmpty
                          ? const Icon(Icons.calendar_today_outlined)
                          : IconButton(tooltip: 'Clear the date', onPressed: () => setState(() => d.gstinDate = ''), icon: const Icon(Icons.close)),
                    ),
                    child: Text(d.gstinDate.isEmpty ? '' : formatDisplayDate(d.gstinDate)),
                  ),
                ),
              ),
              _text(
                'tds_percentage',
                'TDS',
                d.tdsPercentage,
                (v) => d.tdsPercentage = v,
                keyboard: const TextInputType.numberWithOptions(decimal: true),
                formatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')), LengthLimitingTextInputFormatter(6)],
                suffix: '%',
              ),
              _text('tds_section', 'TDS section', d.tdsSection, (v) => d.tdsSection = v),
            ],
            _section('Address'),
            _text('address_line1', 'Address', d.addressLine1, (v) => d.addressLine1 = v),
            _text('address_line2', 'Address line 2', d.addressLine2, (v) => d.addressLine2 = v, optional: true),
            _text('city', 'City', d.city, (v) => d.city = v, caps: TextCapitalization.words),
            _text('state', 'State', d.state, (v) => d.state = v, caps: TextCapitalization.words),
            _text('pincode', 'PIN code', d.pincode, (v) => d.pincode = v, keyboard: TextInputType.number),
            _text('country', 'Country', d.country, (v) => d.country = v, caps: TextCapitalization.words),
          ],
        ),
      ),
    );
  }
}
