import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// Reads a contact sheet (CSV, Excel .xlsx or JSON) into a flat table, as
/// src/lib/parseSheet.js does in the browser. Every byte is untrusted: the limits
/// below cap what a file may expand into (rows, columns, cell length, and for .xlsx,
/// which is a ZIP, the number of entries and how far each may inflate), so a small
/// file that unpacks to gigabytes is refused part-way.
class SheetLimits {
  static const maxRows = 50000;
  static const maxColumns = 200;
  static const maxCellChars = 2000;
  static const maxZipEntries = 1000;
  static const maxInflatedEntryBytes = 16 * 1024 * 1024;
  static const maxInflatedTotalBytes = 24 * 1024 * 1024;
}

/// A file that could not be read, with a message for the person.
class SheetException implements Exception {
  const SheetException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Original headers (case kept, they become template variable keys), rows by header,
/// and whether the sheet had no header row (then headers are "Column A" and so on).
class SheetTable {
  const SheetTable(this.columns, this.rows, {this.headerless = false});
  final List<String> columns;
  final List<Map<String, String>> rows;
  final bool headerless;
}

/* ── CSV ──────────────────────────────────────────────────────────────── */

/// Quoted fields, escaped quotes (""), CRLF or LF line endings.
List<List<String>> parseCsv(String text) {
  final rows = <List<String>>[];
  var row = <String>[];
  final field = StringBuffer();
  var quoted = false;
  void pushField() {
    if (row.length >= SheetLimits.maxColumns) throw const SheetException('A row has more than ${SheetLimits.maxColumns} columns');
    row.add(field.toString());
    field.clear();
  }

  void pushRow() {
    if (rows.length >= SheetLimits.maxRows) throw const SheetException('The file has more than ${SheetLimits.maxRows} rows');
    rows.add(row);
    row = <String>[];
  }

  for (var i = 0; i < text.length; i++) {
    final char = text[i];
    if (quoted) {
      if (char == '"') {
        if (i + 1 < text.length && text[i + 1] == '"') {
          field.write('"');
          i++;
        } else {
          quoted = false;
        }
      } else {
        field.write(char);
      }
      continue;
    }
    if (char == '"') {
      quoted = true;
    } else if (char == ',') {
      pushField();
    } else if (char == '\n' || char == '\r') {
      if (char == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++;
      pushField();
      pushRow();
    } else {
      field.write(char);
    }
  }
  if (field.isNotEmpty || row.isNotEmpty) {
    pushField();
    pushRow();
  }
  return rows.where((r) => r.any((cell) => cell.trim().isNotEmpty)).toList();
}

/* ── XLSX (ZIP + OOXML) ───────────────────────────────────────────────── */

int _u16(Uint8List b, int o) => b[o] | (b[o + 1] << 8);
int _u32(Uint8List b, int o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) & 0xffffffff;

const _notXlsx = SheetException('Not a valid .xlsx file');
const _tooBig = SheetException('The workbook expands to more data than an import allows');

/// Inflates one deflate-raw entry, giving up as soon as the output passes [maxBytes]
/// rather than after a whole bomb has been expanded.
Uint8List _inflateRaw(Uint8List bytes, int maxBytes) {
  final out = BytesBuilder(copy: false);
  final sink = ByteConversionSink.withCallback((chunk) => out.add(chunk));
  final inflater = ZLibDecoder(raw: true).startChunkedConversion(_Capped(sink, maxBytes));
  try {
    for (var i = 0; i < bytes.length; i += 64 * 1024) {
      inflater.add(bytes.sublist(i, i + 64 * 1024 > bytes.length ? bytes.length : i + 64 * 1024));
    }
    inflater.close();
  } on SheetException {
    rethrow;
  } on Object {
    throw _notXlsx;
  }
  return out.takeBytes();
}

class _Capped implements Sink<List<int>> {
  _Capped(this._to, this._max);
  final Sink<List<int>> _to;
  final int _max;
  var _total = 0;

  @override
  void add(List<int> data) {
    _total += data.length;
    if (_total > _max) throw _tooBig;
    _to.add(data);
  }

  @override
  void close() => _to.close();
}

/// Walks the ZIP central directory and inflates only the entries [wanted] picks.
/// Offsets and sizes come from the file itself, so each is bounds-checked first.
Map<String, Uint8List> _unzip(Uint8List bytes, bool Function(String name, List<String> all) wanted) {
  bool inBounds(int start, int length) => start >= 0 && length >= 0 && start + length <= bytes.length;
  var eocd = -1;
  for (var i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (_u32(bytes, i) == 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw _notXlsx;
  final count = _u16(bytes, eocd + 10);
  if (count > SheetLimits.maxZipEntries) throw const SheetException('The workbook has too many internal files');
  var pointer = _u32(bytes, eocd + 16);
  final entries = <({String name, int flags, int method, int size, int offset})>[];
  for (var i = 0; i < count; i++) {
    if (!inBounds(pointer, 46) || _u32(bytes, pointer) != 0x02014b50) break;
    final nameLength = _u16(bytes, pointer + 28);
    if (!inBounds(pointer + 46, nameLength)) throw _notXlsx;
    entries.add((
      name: utf8.decode(bytes.sublist(pointer + 46, pointer + 46 + nameLength), allowMalformed: true),
      flags: _u16(bytes, pointer + 8),
      method: _u16(bytes, pointer + 10),
      size: _u32(bytes, pointer + 20),
      offset: _u32(bytes, pointer + 42),
    ));
    pointer += 46 + nameLength + _u16(bytes, pointer + 30) + _u16(bytes, pointer + 32);
  }
  final names = [for (final e in entries) e.name];
  final files = <String, Uint8List>{};
  var total = 0;
  for (final entry in entries.where((e) => wanted(e.name, names))) {
    // Encrypted entries and ZIP64 sizes never come from a normal spreadsheet export.
    if (entry.flags & 0x1 != 0) throw const SheetException('Encrypted workbooks cannot be imported');
    if (entry.size == 0xffffffff || entry.offset == 0xffffffff) throw _notXlsx;
    if (entry.method != 0 && entry.method != 8) throw _notXlsx;
    if (!inBounds(entry.offset, 30) || _u32(bytes, entry.offset) != 0x04034b50) throw _notXlsx;
    final start = entry.offset + 30 + _u16(bytes, entry.offset + 26) + _u16(bytes, entry.offset + 28);
    if (!inBounds(start, entry.size)) throw _notXlsx;
    final raw = Uint8List.sublistView(bytes, start, start + entry.size);
    final budget = SheetLimits.maxInflatedEntryBytes < SheetLimits.maxInflatedTotalBytes - total
        ? SheetLimits.maxInflatedEntryBytes
        : SheetLimits.maxInflatedTotalBytes - total;
    final Uint8List data;
    if (entry.method == 0) {
      if (raw.length > budget) throw _tooBig;
      data = raw;
    } else {
      data = _inflateRaw(raw, budget);
    }
    total += data.length;
    files[entry.name] = data;
  }
  return files;
}

final _sheetEntry = RegExp(r'^xl/worksheets/sheet\d+\.xml$');
const _sharedStrings = 'xl/sharedStrings.xml';
final _entity = RegExp(r'&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);');
const _entities = {'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'"};

String _decodeXml(String text) => text.replaceAllMapped(_entity, (m) {
  final entity = m[1]!;
  if (entity.startsWith('#')) {
    final code = entity[1] == 'x' ? int.tryParse(entity.substring(2), radix: 16) : int.tryParse(entity.substring(1));
    return code != null && code >= 0 && code <= 0x10ffff ? String.fromCharCode(code) : m[0]!;
  }
  return _entities[entity] ?? m[0]!;
});

final _textRun = RegExp(r'<t[^>]*>([\s\S]*?)</t>');

int _columnIndex(String ref) {
  final letters = RegExp('^[A-Z]+').firstMatch(ref)?[0] ?? 'A';
  var index = 0;
  for (final code in letters.codeUnits) {
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/// The first worksheet as rows of cells. Only it and the shared strings are inflated.
List<List<String>> parseXlsx(Uint8List bytes) {
  final files = _unzip(bytes, (name, all) => name == _sharedStrings || name == all.where(_sheetEntry.hasMatch).firstOrNull);
  final shared = <String>[];
  final sharedXml = files[_sharedStrings];
  if (sharedXml != null) {
    for (final block in RegExp(r'<si>([\s\S]*?)</si>').allMatches(utf8.decode(sharedXml, allowMalformed: true))) {
      // Rich-text runs split one string across several <t> nodes.
      shared.add(_decodeXml(_textRun.allMatches(block[1]!).map((m) => m[1]!).join()));
    }
  }
  final sheet = files.keys.where(_sheetEntry.hasMatch).firstOrNull;
  if (sheet == null) throw const SheetException('No worksheet found in workbook');
  final xml = utf8.decode(files[sheet]!, allowMalformed: true);
  final rows = <List<String>>[];
  for (final rowMatch in RegExp(r'<row[^>]*>([\s\S]*?)</row>').allMatches(xml)) {
    if (rows.length >= SheetLimits.maxRows) throw const SheetException('The file has more than ${SheetLimits.maxRows} rows');
    final row = <int, String>{};
    var next = 0;
    for (final cell in RegExp(r'<c([^>]*)>([\s\S]*?)</c>').allMatches(rowMatch[1]!)) {
      final attrs = cell[1]!;
      final body = cell[2]!;
      final type = RegExp(r't="([^"]+)"').firstMatch(attrs)?[1];
      final ref = RegExp(r'r="([A-Z]+\d+)"').firstMatch(attrs)?[1];
      var value = '';
      if (type == 'inlineStr') {
        value = _decodeXml(_textRun.allMatches(body).map((m) => m[1]!).join());
      } else {
        final raw = RegExp(r'<v>([\s\S]*?)</v>').firstMatch(body)?[1];
        if (raw != null) {
          final index = int.tryParse(raw);
          value = type == 's' ? (index != null && index >= 0 && index < shared.length ? shared[index] : '') : _decodeXml(raw);
        }
      }
      // A reference like XFD1 would otherwise make a 16k-wide row.
      final index = ref != null ? _columnIndex(ref) : next;
      if (index >= SheetLimits.maxColumns) throw const SheetException('A row has more than ${SheetLimits.maxColumns} columns');
      row[index] = value;
      next = index + 1;
    }
    final width = row.isEmpty ? 0 : row.keys.reduce((a, b) => a > b ? a : b) + 1;
    rows.add([for (var i = 0; i < width; i++) row[i] ?? '']);
  }
  return rows.where((r) => r.any((cell) => cell.trim().isNotEmpty)).toList();
}

/* ── JSON ─────────────────────────────────────────────────────────────── */

/// A top-level array (of row objects or arrays), or an object wrapping the list under
/// contacts, rows, data or records.
List<Object?> parseJsonRows(String text) {
  final Object? data;
  try {
    data = jsonDecode(text);
  } on FormatException {
    throw const SheetException('The JSON file could not be read.');
  }
  if (data is List) return data;
  if (data is Map) {
    final list = data['contacts'] ?? data['rows'] ?? data['data'] ?? data['records'];
    if (list is List) return list;
  }
  throw const SheetException('JSON must be an array of rows, or an object with a contacts/rows/data array');
}

/* ── Shared ───────────────────────────────────────────────────────────── */

String _cellText(Object? value) => switch (value) {
  null => '',
  String s => s,
  num n => n == n.truncateToDouble() && n.abs() < 1e21 ? n.toInt().toString() : n.toString(),
  _ => value.toString(),
};

void _checkCell(String value) {
  if (value.length > SheetLimits.maxCellChars) throw const SheetException('A cell is longer than ${SheetLimits.maxCellChars} characters');
}

List<Map<String, String>> _nonEmpty(List<Map<String, String>> rows) => rows.where((r) => r.values.any((v) => v.trim().isNotEmpty)).toList();

String _columnLetter(int index) {
  var name = '';
  for (var n = index + 1; n > 0; n = (n - 1) ~/ 26) {
    name = String.fromCharCode(65 + (n - 1) % 26) + name;
  }
  return name;
}

/// A blank header over a column with data becomes "Column C", and a repeated one
/// "Name 2", so no column is dropped or overwritten. -1: no header row.
List<String> _headerNames(List<List<String>> matrix, int headerIndex) {
  var width = 0;
  for (final row in matrix) {
    if (row.length > width) width = row.length;
  }
  if (width > SheetLimits.maxColumns) throw const SheetException('A row has more than ${SheetLimits.maxColumns} columns');
  final source = headerIndex >= 0 ? matrix[headerIndex] : const <String>[];
  final data = matrix.skip(headerIndex + 1);
  final used = <String>{};
  final names = <String>[];
  for (var index = 0; index < width; index++) {
    var name = (index < source.length ? source[index] : '').replaceAll(RegExp(r'\s+'), ' ').trim();
    if (name.isEmpty) {
      final hasData = data.any((row) => index < row.length && row[index].trim().isNotEmpty);
      name = hasData ? 'Column ${_columnLetter(index)}' : '';
    }
    if (name.isNotEmpty) {
      final base = name;
      for (var n = 2; used.contains(name.toLowerCase()); n++) {
        name = '$base $n';
      }
      used.add(name.toLowerCase());
    }
    names.add(name);
  }
  return names;
}

SheetTable _matrixToTable(List<List<String>> matrix, int headerIndex) {
  if (matrix.isEmpty) return const SheetTable([], []);
  if (matrix.length > SheetLimits.maxRows) throw const SheetException('The file has more than ${SheetLimits.maxRows} rows');
  final headers = _headerNames(matrix, headerIndex);
  final rows = [
    for (final row in matrix.skip(headerIndex + 1))
      {
        for (final (index, header) in headers.indexed)
          if (header.isNotEmpty)
            header: () {
              final value = index < row.length ? row[index] : '';
              _checkCell(value);
              return value.trim();
            }(),
      },
  ];
  return SheetTable(
    [
      for (final h in headers)
        if (h.isNotEmpty) h,
    ],
    _nonEmpty(rows),
    headerless: headerIndex < 0,
  );
}

SheetTable _listToTable(List<Object?> list) {
  if (list.isEmpty) return const SheetTable([], []);
  if (list.length > SheetLimits.maxRows) throw const SheetException('The file has more than ${SheetLimits.maxRows} rows');
  if (list.first is List) {
    return _matrixToTable([
      for (final r in list)
        if (r is List) [for (final c in r) _cellText(c)] else <String>[],
    ], 0);
  }
  final columns = <String>[];
  final seen = <String>{};
  final rows = <Map<String, String>>[];
  for (final item in list) {
    final record = <String, String>{};
    if (item is Map) {
      for (final MapEntry(:key, :value) in item.entries) {
        final header = key.toString().trim();
        if (header.isEmpty) continue;
        if (seen.add(header)) {
          if (columns.length >= SheetLimits.maxColumns) throw const SheetException('A row has more than ${SheetLimits.maxColumns} columns');
          columns.add(header);
        }
        final text = _cellText(value);
        if (value != null) _checkCell(text);
        record[header] = text.trim();
      }
    }
    rows.add(record);
  }
  return SheetTable(columns, _nonEmpty(rows));
}

/// The table in [bytes]: .xlsx by its ZIP signature, JSON by name or a leading { or [,
/// else CSV. [pickHeader] names the header row (-1 for none); by default the first.
/// The caller must already have bounded the file's size.
SheetTable readContactSheet(Uint8List bytes, String fileName, {int Function(List<List<String>> matrix)? pickHeader}) {
  final name = fileName.toLowerCase();
  SheetTable fromMatrix(List<List<String>> matrix) => _matrixToTable(matrix, pickHeader == null ? 0 : pickHeader(matrix));
  if (bytes.length > 1 && bytes[0] == 0x50 && bytes[1] == 0x4b) return fromMatrix(parseXlsx(bytes));
  var text = utf8.decode(bytes, allowMalformed: true);
  if (text.startsWith('﻿')) text = text.substring(1);
  final head = text.trimLeft();
  if (name.endsWith('.json') || head.startsWith('{') || head.startsWith('[')) {
    try {
      return _listToTable(parseJsonRows(text));
    } on SheetException {
      if (name.endsWith('.json')) rethrow;
      // A CSV that merely starts with a brace: read it as CSV.
    }
  }
  return fromMatrix(parseCsv(text));
}
