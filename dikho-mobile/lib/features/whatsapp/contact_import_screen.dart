import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show compute;
import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import '../../shared/platform_api.dart';
import '../inbox/chat_theme.dart';
import '../whatsapp/analytics_parts.dart' show SectionCard;
import 'contact_import.dart';
import 'sheet_reader.dart';

const _maxFileBytes = 5 * 1024 * 1024;
const _maxContacts = 5000;

/// The API refuses a body over 4 MB (MAX_IMPORT_JSON_BYTES); a little under it.
const _maxBodyBytes = 4 * 1024 * 1024 - 16 * 1024;

const _fileTypes = [
  'text/csv',
  'text/comma-separated-values',
  'text/plain',
  'application/json',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
];

/// "Imported 3 new contacts, updated 1. 2 rows were skipped.", as importSummary in
/// src/features/whatsapp/labels.js.
String importSummary(Map<String, dynamic> result, Map<String, int> skipped) {
  int n(String key) => result[key] is num ? (result[key] as num).toInt() : 0;
  final imported = n('imported');
  final parts = ['Imported $imported new contact${imported == 1 ? '' : 's'}'];
  if (n('updated') > 0) parts.add('updated ${n('updated')}');
  if (n('unchanged') > 0) parts.add('${n('unchanged')} already up to date');
  final dropped = skipped.values.fold(0, (a, b) => a + b) + n('invalid');
  return '${parts.join(', ')}.${dropped > 0 ? ' $dropped row${dropped == 1 ? ' was' : 's were'} skipped.' : ''}';
}

// Top level, so compute sends only the data to the background thread.
_Read _readSheet((Uint8List, String) file) {
  final table = readContactSheet(file.$1, file.$2, pickHeader: pickHeaderRow);
  if (table.rows.isEmpty) throw const SheetException('The file has no rows to import.');
  final detected = detectColumns(table.columns, table.rows, headerless: table.headerless);
  return _Read(table, detected, buildPreview(table, detected, ColumnChoice.from(detected)));
}

ImportPreview _count((SheetTable, DetectedColumns, ColumnChoice) input) => buildPreview(input.$1, input.$2, input.$3);

class _Read {
  const _Read(this.table, this.detected, this.preview);
  final SheetTable table;
  final DetectedColumns detected;
  final ImportPreview preview;
}

/// Contacts from a spreadsheet, redesigned for a phone from ContactImport.jsx: choose
/// a CSV, Excel or JSON file, check which column the app took for the WhatsApp number,
/// name, email and company (and change any), see how many are ready and why the rest
/// were skipped, then import. The file is read on the phone, off the screen's thread;
/// numbers are checked with Google's numbering rules, and the API checks again.
class ContactImportScreen extends StatefulWidget {
  const ContactImportScreen({super.key, required this.api, required this.platform, required this.onImported});

  final CrmApi api;
  final PlatformApi platform;

  /// After a successful import, with the result's words.
  final ValueChanged<String> onImported;

  @override
  State<ContactImportScreen> createState() => _ContactImportScreenState();
}

class _ContactImportScreenState extends State<ContactImportScreen> {
  String? _fileName;
  _Read? _read;
  ColumnChoice? _choice;
  String? _error;
  bool _reading = false;
  bool _counting = false;
  bool _saving = false;

  /// Only the newest count may land.
  int _asked = 0;

  Future<void> _choose() async {
    setState(() => _error = null);
    try {
      final uris = await widget.platform.pickFiles(_fileTypes, false);
      if (uris.isEmpty || !mounted) return;
      setState(() => _reading = true);
      final picked = await widget.platform.copyPicked(uris.first);
      final path = picked?.path;
      if (picked == null || path == null) throw const SheetException('That file could not be read.');
      if (picked.tooLarge || await File(path).length() > _maxFileBytes) {
        throw const SheetException('The file is larger than 5 MB. Split it into smaller files.');
      }
      final bytes = await File(path).readAsBytes();
      final name = picked.name;
      // Reading a big sheet and checking thousands of numbers takes a moment: off the
      // screen's thread, so the phone stays responsive.
      final read = await compute(_readSheet, (bytes, name));
      if (!mounted) return;
      setState(() {
        _fileName = name;
        _read = read;
        _choice = ColumnChoice.from(read.detected);
        _reading = false;
      });
    } on SheetException catch (failure) {
      if (mounted) {
        setState(() {
          _error = failure.message;
          _reading = false;
        });
      }
    } on Object {
      if (mounted) {
        setState(() {
          _error = 'Could not read the file. Save it as CSV or Excel (.xlsx) and try again.';
          _reading = false;
        });
      }
    }
  }

  Future<void> _change(ColumnChoice choice) async {
    final read = _read;
    if (read == null) return;
    final asked = ++_asked;
    setState(() {
      _choice = choice;
      _counting = true;
    });
    final table = read.table;
    final detected = read.detected;
    final preview = await compute(_count, (table, detected, choice));
    if (!mounted || asked != _asked) return;
    setState(() {
      _read = _Read(table, detected, preview);
      _counting = false;
    });
  }

  Future<void> _import() async {
    final read = _read;
    if (read == null || _saving) return;
    final body = {
      'contacts': [for (final c in read.preview.contacts) c.toJson()],
    };
    if (utf8.encode(jsonEncode(body)).length > _maxBodyBytes) {
      setState(() => _error = 'These contacts carry too much data to send at once. Split the file into smaller ones.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await widget.api.post('/contacts/import-rows', body);
      if (!mounted) return;
      widget.onImported(importSummary(result, read.preview.skipped));
      Navigator.of(context).pop();
    } on ApiException catch (failure) {
      if (mounted) {
        setState(() {
          _error = failure.message;
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final read = _read;
    final choice = _choice;
    final ready = read?.preview.contacts.length ?? 0;
    final tooMany = ready > _maxContacts;
    return Scaffold(
      appBar: AppBar(title: const Text('Import contacts')),
      bottomNavigationBar: read == null
          ? null
          : SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.m),
                child: FilledButton(
                  onPressed: _saving || _counting || ready == 0 || tooMany ? null : () => unawaited(_import()),
                  child: Text(
                    _saving
                        ? 'Importing…'
                        : _counting
                        ? 'Counting…'
                        : 'Import $ready contact${ready == 1 ? '' : 's'}',
                  ),
                ),
              ),
            ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl * 2),
        children: [
          if (read == null) ...[
            Text(
              'Choose a CSV, Excel (.xlsx) or JSON file of up to 5 MB. The app finds the WhatsApp number, name, email and company columns, checks every number and adds +91 when the country code is missing. You can correct the columns before anything is saved.',
              style: muted,
            ),
            const SizedBox(height: Gap.l),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.icon(
                onPressed: _reading ? null : () => unawaited(_choose()),
                icon: const Icon(Icons.upload_file),
                label: Text(_reading ? 'Reading the file…' : 'Choose a file'),
              ),
            ),
          ],
          if (_error != null) _note(context, _error!, danger: true),
          if (read != null && choice != null) ...[
            SectionCard(
              title: 'Check the columns in ${_fileName ?? 'the file'}',
              subtitle:
                  '${read.table.rows.length} row${read.table.rows.length == 1 ? '' : 's'}${read.table.headerless ? ', no header row found' : ''}. Change any column that was picked wrongly.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _column('WhatsApp number', choice.phone, 'Search every column', read.table.columns, (v) => _change(choice.copyWith(phone: v))),
                  _column(
                    'Name',
                    choice.name,
                    'None',
                    read.table.columns,
                    (v) => _change(choice.copyWith(name: v)),
                    extra: read.detected.firstNameColumn != null && read.detected.lastNameColumn != null
                        ? (firstPlusLast, '${read.detected.firstNameColumn} + ${read.detected.lastNameColumn}')
                        : null,
                  ),
                  _column('Email', choice.email, 'None', read.table.columns, (v) => _change(choice.copyWith(email: v))),
                  _column('Company', choice.company, 'None', read.table.columns, (v) => _change(choice.copyWith(company: v))),
                  if (read.detected.phoneColumns.where((c) => c != choice.phone).isNotEmpty)
                    Text(
                      'When the WhatsApp number is blank or wrong, ${read.detected.phoneColumns.where((c) => c != choice.phone).map((c) => '"$c"').join(', ')} is tried next.',
                      style: muted,
                    ),
                  const SizedBox(height: Gap.s),
                  Text(
                    "Every column is kept for template variables, each filled from that person's own row. Names in all capitals or all small letters are tidied (RAHUL SHARMA becomes Rahul Sharma).",
                    style: muted,
                  ),
                ],
              ),
            ),
            SectionCard(
              title: '$ready contact${ready == 1 ? '' : 's'} ready to import',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final MapEntry(key: reason, value: count) in read.preview.skipped.entries)
                    if (count > 0) Text('$count skipped: ${skipReasons[reason]}'),
                  if (read.preview.skippedTotal == 0) Text('No rows were skipped.', style: muted),
                  if (read.preview.examples.isNotEmpty) ...[
                    const SizedBox(height: Gap.s),
                    Text('Examples', style: theme.textTheme.labelLarge),
                    for (final e in read.preview.examples)
                      Text(
                        '${e.label.isEmpty ? '' : '${e.label}: '}${e.value.isEmpty ? '(blank)' : e.value} (${skipReasons[e.reason]})',
                        style: muted,
                      ),
                  ],
                  if ((read.preview.skipped['scientific'] ?? 0) > 0)
                    _note(
                      context,
                      'Excel saved some numbers in a shortened form and the digits are lost. In Excel, format the phone column as Text (or Number with 0 decimal places), then save the file again.',
                    ),
                  if (tooMany) _note(context, 'An import can hold up to $_maxContacts contacts. Split the file.', danger: true),
                ],
              ),
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _saving
                    ? null
                    : () => setState(() {
                        _read = null;
                        _choice = null;
                        _fileName = null;
                        _error = null;
                      }),
                icon: const Icon(Icons.swap_horiz),
                label: const Text('Choose another file'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _column(String label, String value, String none, List<String> columns, ValueChanged<String> onChanged, {(String, String)? extra}) {
    final options = [?extra, for (final c in columns) (c, c)];
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.m),
      child: DropdownButtonFormField<String>(
        key: ValueKey('$label-$value-${columns.length}'),
        isExpanded: true,
        initialValue: value,
        decoration: InputDecoration(labelText: label),
        items: [
          DropdownMenuItem(value: '', child: Text(none)),
          for (final (key, text) in options)
            DropdownMenuItem(
              value: key,
              child: Text(text, overflow: TextOverflow.ellipsis),
            ),
        ],
        onChanged: _saving
            ? null
            : (v) {
                if (v != null && v != value) onChanged(v);
              },
      ),
    );
  }

  Widget _note(BuildContext context, String text, {bool danger = false}) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(top: Gap.s, bottom: Gap.m),
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(color: danger ? scheme.errorContainer : scheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)),
      child: Semantics(
        liveRegion: true,
        child: Text(text, style: TextStyle(color: danger ? scheme.onErrorContainer : null)),
      ),
    );
  }
}
