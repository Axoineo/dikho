import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dikho_crm/features/whatsapp/contact_import.dart';
import 'package:dikho_crm/features/whatsapp/sheet_reader.dart';
import 'package:flutter_test/flutter_test.dart';

// The phone reads contact sheets itself, so it must reach the same answers as the
// web's importer. test/fixtures/contact_import_web.json was made by the web's own
// functions (src/lib/parseSheet.js and src/lib/contactImport.js) in Node, from the
// same inputs, including test/fixtures/contacts.xlsx.

void main() {
  final web = jsonDecode(File('test/fixtures/contact_import_web.json').readAsStringSync()) as Map<String, dynamic>;

  test('every phone number shape reads as the web reads it', () {
    for (final pair in web['phones'] as List) {
      final input = pair[0] as String;
      final expected = pair[1] as Map;
      final got = readPhone(input);
      expect(got.phone, expected['phone'], reason: 'phone of ${jsonEncode(input)}');
      if (expected['phone'] == null) expect(got.reason, expected['reason'], reason: 'reason for ${jsonEncode(input)}');
    }
  });

  test('a number with its own country code never becomes an Indian number', () {
    expect(readPhone('+44 7911 123456').phone, '447911123456');
    expect(readPhone('0044 7911 123456').phone, '447911123456');
    expect(readPhone('+971 50 123 4567').phone, '971501234567');
  });

  test('names are tidied as the web tidies them', () {
    for (final pair in web['names'] as List) {
      expect(tidyName(pair[0]), pair[1], reason: jsonEncode(pair[0]));
    }
  });

  for (final MapEntry(key: name, value: raw) in (web['sheets'] as Map<String, dynamic>).entries) {
    final sheet = raw as Map<String, dynamic>;
    test('$name: the same table, columns found and contacts ready', () {
      final bytes = sheet['binary'] == true
          ? File('test/fixtures/$name').readAsBytesSync()
          : Uint8List.fromList(utf8.encode(sheet['text'] as String));
      final table = readContactSheet(bytes, name, pickHeader: pickHeaderRow);
      expect(table.columns, sheet['columns'], reason: 'columns');
      expect(table.headerless, sheet['headerless'] ?? false, reason: 'headerless (unset for JSON on the web)');
      expect(table.rows, sheet['rows'], reason: 'rows');

      final detected = detectColumns(table.columns, table.rows, headerless: table.headerless);
      final d = sheet['detected'] as Map;
      expect(detected.phoneColumns, d['phoneColumns'], reason: 'phone columns');
      expect(detected.nameColumn, d['nameColumn'], reason: 'name column');
      expect(detected.firstNameColumn, d['firstNameColumn'], reason: 'first name column');
      expect(detected.lastNameColumn, d['lastNameColumn'], reason: 'last name column');
      expect(detected.emailColumn, d['emailColumn'], reason: 'email column');
      expect(detected.companyColumn, d['companyColumn'], reason: 'company column');

      final choice = ColumnChoice.from(detected);
      final m = sheet['mapping'] as Map;
      expect([choice.phone, choice.name, choice.email, choice.company], [m['phone'], m['name'], m['email'], m['company']], reason: 'first choice');

      final preview = buildPreview(table, detected, choice);
      final p = sheet['preview'] as Map;
      expect(
        [for (final c in preview.contacts) c.toJson()],
        [
          for (final c in p['contacts'] as List)
            {'phone': c['phone'], 'name': c['name'], 'email': c['email'], 'company': c['company'], 'attributes': c['attributes']},
        ],
        reason: 'contacts',
      );
      expect(preview.skipped, p['skipped'], reason: 'skipped');
      expect(
        [
          for (final e in preview.examples) {'reason': e.reason, 'value': e.value, 'label': e.label},
        ],
        p['examples'],
        reason: 'examples',
      );
    });
  }

  group('limits on untrusted files', () {
    test('too many columns, a cell too long, broken JSON', () {
      expect(
        () => readContactSheet(Uint8List.fromList(utf8.encode('${List.filled(201, 'a').join(',')}\n')), 'a.csv'),
        throwsA(isA<SheetException>()),
      );
      expect(
        () => readContactSheet(Uint8List.fromList(utf8.encode('Name,Phone\n${'x' * 2001},9876543210\n')), 'a.csv'),
        throwsA(isA<SheetException>()),
      );
      expect(() => readContactSheet(Uint8List.fromList(utf8.encode('{"contacts": [')), 'a.json'), throwsA(isA<SheetException>()));
    });

    test('a workbook that expands past the limit is refused part-way, not unpacked', () {
      final zeros = Uint8List(SheetLimits.maxInflatedEntryBytes + 1);
      final deflated = Uint8List.fromList(ZLibEncoder(raw: true, level: 9).convert(zeros));
      final zip = _zipOne('xl/worksheets/sheet1.xml', deflated, zeros.length);
      expect(deflated.length, lessThan(100 * 1024), reason: 'a small file');
      expect(() => readContactSheet(zip, 'bomb.xlsx'), throwsA(isA<SheetException>().having((e) => e.message, 'message', contains('expands'))));
    });

    test('a broken workbook says so', () {
      expect(() => readContactSheet(Uint8List.fromList([0x50, 0x4b, 1, 2, 3]), 'x.xlsx'), throwsA(isA<SheetException>()));
    });
  });
}

/// A one-entry ZIP with a deflated entry, enough for the reader's central-directory walk.
Uint8List _zipOne(String name, Uint8List data, int size) {
  final nameBytes = utf8.encode(name);
  final out = BytesBuilder();
  void u16(int v) => out.add([v & 0xff, (v >> 8) & 0xff]);
  void u32(int v) => out.add([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
  u32(0x04034b50);
  u16(20);
  u16(0);
  u16(8);
  u32(0);
  u32(0);
  u32(data.length);
  u32(size);
  u16(nameBytes.length);
  u16(0);
  out.add(nameBytes);
  out.add(data);
  final central = out.length;
  u32(0x02014b50);
  u16(20);
  u16(20);
  u16(0);
  u16(8);
  u32(0);
  u32(0);
  u32(data.length);
  u32(size);
  u16(nameBytes.length);
  u16(0);
  u16(0);
  u16(0);
  u16(0);
  u32(0);
  u32(0);
  out.add(nameBytes);
  final centralSize = out.length - central;
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(1);
  u16(1);
  u32(centralSize);
  u32(central);
  u16(0);
  return out.toBytes();
}
