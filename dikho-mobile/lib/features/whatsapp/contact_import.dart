import 'package:phone_numbers_parser/phone_numbers_parser.dart';

import 'sheet_reader.dart';
import 'template_vars.dart' show normalizeKey;

/// Reads contacts out of a sheet, as src/lib/contactImport.js does in the browser:
/// which row holds the headers, which column is the WhatsApp number (and which are
/// spare phone columns), and which are the name, email and company. Every cell is
/// untrusted text. Numbers are checked against Google's numbering rules
/// (phone_numbers_parser, the same metadata as libphonenumber-js), not by counting
/// digits, so an order ID or a landline is not taken for a WhatsApp number. They come
/// back as E.164 digits without "+", the format the CRM stores and Meta expects.

/* ── Phone numbers ─────────────────────────────────────────────────────── */

/// The number, or why there is none: empty, invalid, landline, or scientific (Excel
/// rounded the digits away).
typedef PhoneRead = ({String? phone, String reason});

final _trailingZeros = RegExp(r'^\d+\.0+$');
final _scientific = RegExp(r'^(\d)(?:\.(\d+))?e\+?(\d{1,2})$', caseSensitive: false);

/// Excel and pandas exports: 9876543210.0, 9.19876543210E+11, or 9.19877E+11 when the
/// digits were rounded away. Null text means they cannot be recovered.
String? _unmangle(String text) {
  if (_trailingZeros.hasMatch(text)) return text.replaceAll(RegExp(r'\.0+$'), '');
  final sci = _scientific.firstMatch(text);
  if (sci == null) return text;
  final mantissa = sci[1]! + (sci[2] ?? '');
  final width = int.parse(sci[3]!) + 1;
  if (mantissa.replaceAll(RegExp(r'0+$'), '').length > width) return text;
  // A sheet that showed 9.19877E+11 saved only those six digits.
  if (width >= 10 && mantissa.length <= 7) return null;
  return mantissa.padRight(width, '0');
}

/// Types that cannot hold WhatsApp: a campaign to them fails (Meta 131026) and costs.
const _notWhatsApp = [
  PhoneNumberType.fixedLine,
  PhoneNumberType.tollFree,
  PhoneNumberType.premiumRate,
  PhoneNumberType.sharedCost,
  PhoneNumberType.uan,
  PhoneNumberType.pager,
  PhoneNumberType.voiceMail,
];
const _whatsApp = [PhoneNumberType.mobile, PhoneNumberType.voip, PhoneNumberType.personalNumber];

PhoneNumber? _parse(String text) {
  try {
    // India as the caller's country only: a number without a country code is Indian,
    // and one with its own (+44, 0044) keeps it. Setting India as the destination too
    // turned +44 7911 123456 into the Indian 91 7911 123456: a stranger's number.
    final number = PhoneNumber.parse(text, callerCountry: IsoCode.IN);
    return number.isValid() ? number : null;
  } on Object {
    return null;
  }
}

PhoneRead? _parseOne(String text) {
  final cleaned = text.replaceFirst(RegExp(r"^'+"), '').trim();
  if (!RegExp(r'\d').hasMatch(cleaned)) return null;
  var number = _parse(cleaned);
  // A country code without its "+" gets one more try as international.
  if (number == null) {
    final digits = cleaned.replaceAll(RegExp(r'\D'), '');
    if (digits.length >= 11 && digits.length <= 15) number = _parse('+$digits');
  }
  if (number == null) return (phone: null, reason: 'invalid');
  // 9999999999 and friends: valid by the rules, never a real person.
  if (number.nsn.split('').toSet().length <= 2) return (phone: null, reason: 'invalid');
  // Like libphonenumber-js's getType: a number that is also a mobile (or VoIP, or a
  // personal number) can hold WhatsApp; one that is only a landline, toll-free and
  // so on cannot; a valid number of no known type is let through.
  if (!_whatsApp.any((type) => number!.isValid(type: type)) && _notWhatsApp.any((type) => number!.isValid(type: type))) {
    return (phone: null, reason: 'landline');
  }
  return (phone: '${number.countryCode}${number.nsn}', reason: '');
}

/// The WhatsApp-capable number in [value]. A cell with two numbers ("98765 43210 /
/// 91234 56789") gives the first usable one.
PhoneRead readPhone(Object? value) {
  final raw = (value?.toString() ?? '').trim();
  if (raw.isEmpty) return (phone: null, reason: 'empty');
  if (raw.length > 80) return (phone: null, reason: 'invalid');
  final fixed = _unmangle(raw.replaceAll(RegExp(r'\s+'), ' '));
  if (fixed == null) return (phone: null, reason: 'scientific');
  final parts = fixed.split(RegExp(r'\s*(?:[/,;|&]|\bor\b)\s*', caseSensitive: false)).where((p) => p.isNotEmpty);
  PhoneRead? firstFailure;
  for (final part in parts.take(4)) {
    final result = _parseOne(part);
    if (result?.phone != null) return result!;
    firstFailure ??= result;
  }
  return firstFailure ?? (phone: null, reason: 'invalid');
}

/* ── Header row ────────────────────────────────────────────────────────── */

const _headerWords = {
  'name', 'names', 'phone', 'mobile', 'mob', 'whatsapp', 'number', 'no', 'num', 'contact', 'email', 'mail', //
  'city', 'company', 'address', 'state', 'cell', 'tel', 'telephone', 'customer', 'client', 'first', 'last',
  'sr', 'sno', 'serial', 'id', 'date', 'amount', 'area', 'pincode', 'pin', 'gender', 'age', 'remarks',
  'notes', 'status', 'source', 'business', 'firm', 'party', 'person', 'designation', 'location', 'district',
};

List<String> _cells(List<String>? row) => [
  for (final c in row ?? const <String>[])
    if (c.trim().isNotEmpty) c.trim(),
];

bool _looksLikeHeaderRow(List<String>? row) {
  final filled = _cells(row);
  return filled.isNotEmpty && filled.every((c) => c.length <= 60 && !c.contains('@') && RegExp(r'\d').allMatches(c).length < 5);
}

double _headerScore(List<String>? row) {
  final filled = _cells(row);
  final matching = filled.where((c) => c.toLowerCase().split(RegExp('[^a-z]+')).any(_headerWords.contains)).length;
  return filled.isEmpty ? 0 : matching + matching / filled.length;
}

/// Index of the header row, or -1 when the first row is already a contact. Title lines
/// above the headers are skipped, and a contact with a blank phone just under the
/// headers is not taken for them.
int pickHeaderRow(List<List<String>> matrix) {
  final scan = matrix.length < 20 ? matrix.length : 20;
  var firstData = -1;
  for (var i = 0; i < scan; i++) {
    if (matrix[i].any((cell) => readPhone(cell).phone != null)) {
      firstData = i;
      break;
    }
  }
  if (firstData == -1) return 0;
  if (firstData == 0) return -1;
  var best = -1;
  var bestScore = 0.0;
  for (var r = 0; r < firstData; r++) {
    final score = _looksLikeHeaderRow(matrix[r]) ? _headerScore(matrix[r]) : 0.0;
    if (score >= bestScore && score > 0) {
      best = r;
      bestScore = score;
    }
  }
  if (best >= 0) return best;
  return _looksLikeHeaderRow(matrix[firstData - 1]) ? firstData - 1 : 0;
}

/* ── Columns ───────────────────────────────────────────────────────────── */

final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');

List<String> _sample(List<Map<String, String>> rows, String column, [int limit = 500]) {
  final values = <String>[];
  for (final row in rows) {
    final value = (row[column] ?? '').trim();
    if (value.isNotEmpty) values.add(value);
    if (values.length >= limit) break;
  }
  return values;
}

double _share(List<String> values, bool Function(String) test) => values.isEmpty ? 0 : values.where(test).length / values.length;

double _phoneHint(String norm) {
  var bonus = 0.0;
  if (RegExp(r'whatsapp|^wa(no|number)?$').hasMatch(norm)) {
    bonus = 0.3;
  } else if (RegExp(r'mobile|phone|cell|^mob|contactno|contactnumber').hasMatch(norm)) {
    bonus = 0.2;
  } else if (RegExp(r'number|contact|tel|msisdn').hasMatch(norm)) {
    bonus = 0.1;
  }
  if (RegExp(r'alt|alternate|secondary|other|landline|office|fax|emergency|father|mother|guardian|parent|home').hasMatch(norm)) bonus -= 0.15;
  return bonus;
}

final _notTheContact = RegExp(
  r'company|business|firm|shop|store|brand|org|agency|employer|user|file|product|item|father|mother|husband|wife|spouse|guardian|parent|city|town|state|country|area|district|village|branch|bank|account|plan|package|course|event|category|group|campaign|template|agent|executive|staff|employee|sales|manager|refer|source|school|college|hospital|street|road|building|society|project',
);

int nameScore(String norm) {
  if (_notTheContact.hasMatch(norm)) return 0;
  if (norm == 'name' || norm == 'names') return 100;
  final named = RegExp(r'^(full|contact|customer|client|person|party|lead|guest|member|student|recipient|buyer|owner|display)?names?$');
  if (named.hasMatch(norm)) return 90;
  if (const ['customer', 'client', 'contact', 'person', 'party', 'contactperson', 'nameofcustomer', 'nameofclient'].contains(norm)) return 85;
  if (RegExp(r'name$|^name').hasMatch(norm) && !RegExp(r'first|last|sur|middle').hasMatch(norm)) return 70;
  return 0;
}

bool _looksLikeName(String value) =>
    value.length <= 80 &&
    RegExp(r'\p{L}', unicode: true).hasMatch(value) &&
    !value.contains('@') &&
    RegExp(r'\d').allMatches(value).length <= value.length * 0.2;

int _companyScore(String norm) {
  if (RegExp(r'phone|mobile|email|mail|address|gst|^pan|pan(no|number)?$|type|category|size|id$|number|no$').hasMatch(norm)) return 0;
  if (const [
    'company', 'companyname', 'business', 'businessname', 'firm', 'firmname', 'organisation', 'organization', //
    'organisationname', 'organizationname',
  ].contains(norm)) {
    return 100;
  }
  if (RegExp(r'company|organisation|organization|firm|business|brand|shop|store|employer|agency|enterprise|institution').hasMatch(norm)) return 70;
  return 0;
}

String? _bestBy(List<String> columns, double Function(String) score) {
  String? best;
  var bestScore = 0.0;
  for (final column in columns) {
    final value = score(column);
    if (value > bestScore) {
      best = column;
      bestScore = value;
    }
  }
  return best;
}

/// Which column is which, as detectColumns in contactImport.js decides it.
class DetectedColumns {
  const DetectedColumns({
    required this.phoneColumns,
    this.nameColumn,
    this.firstNameColumn,
    this.lastNameColumn,
    this.emailColumn,
    this.companyColumn,
  });

  /// Best first; the rest are tried when the first gives no number.
  final List<String> phoneColumns;
  final String? nameColumn;
  final String? firstNameColumn;
  final String? lastNameColumn;
  final String? emailColumn;
  final String? companyColumn;
}

DetectedColumns detectColumns(List<String> columns, List<Map<String, String>> rows, {bool headerless = false}) {
  // A column qualifies when most of its filled cells are numbers, and ranks by how many
  // of ALL rows it covers, so a mostly empty "Alternate No" stays a spare.
  final sampled = rows.isEmpty ? 1 : (rows.length < 500 ? rows.length : 500);
  final candidates = <({String column, double ratio, double rank})>[];
  for (final column in columns) {
    final values = _sample(rows, column);
    final valid = values.where((v) => readPhone(v).phone != null).length;
    final ratio = values.isEmpty ? 0.0 : valid / values.length;
    candidates.add((column: column, ratio: ratio, rank: valid / sampled + _phoneHint(normalizeKey(column))));
  }
  final ranked = candidates.where((c) => c.ratio >= 0.3).toList();
  // Stable, as Array.prototype.sort is: equal ranks keep the file's order.
  final order = {for (final (i, c) in ranked.indexed) c.column: i};
  ranked.sort((a, b) => a.rank != b.rank ? b.rank.compareTo(a.rank) : order[a.column]!.compareTo(order[b.column]!));
  final phoneColumns = [for (final c in ranked) c.column];

  final others = columns.where((c) => !phoneColumns.contains(c)).toList();
  final emailColumn = _bestBy(others, (column) {
    final ratio = _share(_sample(rows, column), _email.hasMatch);
    return ratio >= 0.6 ? ratio + (normalizeKey(column).contains('mail') ? 0.5 : 0) : 0;
  });

  final text = others.where((c) => c != emailColumn).toList();
  var nameColumn = _bestBy(text, (column) {
    final score = nameScore(normalizeKey(column));
    return score > 0 && _share(_sample(rows, column), _looksLikeName) >= 0.6 ? score.toDouble() : 0;
  });

  // A "First Name" column beats a loose match such as "Original Contact Name"; a plain
  // "Name" or "Customer Name" column still wins.
  final firstName = text.where((c) => RegExp(r'^(first|given)(name)?$|^fname$').hasMatch(normalizeKey(c))).firstOrNull;
  final lastName = text.where((c) => RegExp(r'^(last|sur|family)(name)?$|^lname$').hasMatch(normalizeKey(c))).firstOrNull;
  String? firstNameColumn;
  String? lastNameColumn;
  if (firstName != null && (nameColumn == null || nameScore(normalizeKey(nameColumn)) < 85)) {
    nameColumn = null;
    firstNameColumn = firstName;
    lastNameColumn = lastName;
  }

  if (nameColumn == null && firstNameColumn == null && headerless) {
    // No headers: the column of short, mostly distinct, name-like text.
    nameColumn = _bestBy(text, (column) {
      final values = _sample(rows, column);
      final nameLike = _share(values, (v) => _looksLikeName(v) && v.split(RegExp(r'\s+')).length <= 4);
      final distinct = values.toSet().length / (values.isEmpty ? 1 : values.length);
      return nameLike >= 0.8 && distinct >= 0.5 ? nameLike + distinct : 0;
    });
  }

  final companyColumn = _bestBy(text.where((c) => c != nameColumn && c != firstNameColumn && c != lastNameColumn).toList(), (column) {
    final score = _companyScore(normalizeKey(column));
    return score > 0 && _share(_sample(rows, column), (v) => RegExp(r'\p{L}', unicode: true).hasMatch(v)) >= 0.6 ? score.toDouble() : 0;
  });

  return DetectedColumns(
    phoneColumns: phoneColumns,
    nameColumn: nameColumn,
    firstNameColumn: firstNameColumn,
    lastNameColumn: lastNameColumn,
    emailColumn: emailColumn,
    companyColumn: companyColumn,
  );
}

/* ── One row ───────────────────────────────────────────────────────────── */

/// RAHUL SHARMA and priya nair become Rahul Sharma and Priya Nair; a word already in
/// mixed case ("McDonald", "iPhone") is left as typed.
String? tidyName(Object? value) {
  var text = (value?.toString() ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();
  if (text.length > 120) text = text.substring(0, 120);
  if (text.isEmpty) return null;
  return text
      .split(' ')
      .map((word) {
        final letters = word.replaceAll(RegExp(r'[^\p{L}]', unicode: true), '');
        if (letters.isNotEmpty && letters != letters.toUpperCase() && letters != letters.toLowerCase()) return word;
        return word.toLowerCase().replaceAllMapped(RegExp(r"(^|[-'.])(\p{L})", unicode: true), (m) => '${m[1]}${m[2]!.toUpperCase()}');
      })
      .join(' ');
}

String? _tidyEmail(Object? value) {
  final text = (value?.toString() ?? '').trim().toLowerCase();
  return text.isNotEmpty && text.length <= 254 && _email.hasMatch(text) ? text : null;
}

/// One contact ready to save.
class ImportContact {
  ImportContact({required this.phone, this.name, this.email, this.company, this.attributes = const {}});
  final String phone;
  final String? name;
  final String? email;
  final String? company;
  final Map<String, String> attributes;

  Map<String, Object?> toJson() => {'phone': phone, 'name': name, 'email': email, 'company': company, 'attributes': attributes};
}

/// The contact in [row], or the reason it has none. The main phone column first, then
/// any spares; a sheet with no phone column at all is searched cell by cell.
({ImportContact? contact, String reason}) readContactRow(Map<String, String> row, List<String> columns, DetectedColumns detected) {
  final tryColumns = detected.phoneColumns.isNotEmpty ? detected.phoneColumns : columns;
  String? phone;
  var reason = 'empty';
  for (final column in tryColumns) {
    final result = readPhone(row[column]);
    if (result.phone != null) {
      phone = result.phone;
      break;
    }
    if (reason == 'empty' && result.reason != 'empty') reason = result.reason;
  }
  if (phone == null) return (contact: null, reason: reason);
  final name = detected.nameColumn != null
      ? tidyName(row[detected.nameColumn])
      : detected.firstNameColumn != null
      ? tidyName([row[detected.firstNameColumn] ?? '', detected.lastNameColumn != null ? row[detected.lastNameColumn] ?? '' : ''].join(' '))
      : null;
  final company = detected.companyColumn == null ? '' : (row[detected.companyColumn] ?? '').trim();
  return (
    contact: ImportContact(
      phone: phone,
      name: name,
      email: detected.emailColumn != null ? _tidyEmail(row[detected.emailColumn]) : null,
      company: company.isEmpty ? null : (company.length > 160 ? company.substring(0, 160) : company),
    ),
    reason: '',
  );
}

/* ── The whole file ────────────────────────────────────────────────────── */

/// Why rows were skipped, in words.
const skipReasons = {
  'invalid': 'not a valid phone number',
  'landline': 'a landline, which cannot get WhatsApp',
  'scientific': 'shortened by Excel (like 9.19877E+11)',
  'empty': 'no phone number',
  'duplicate': 'the same number appears again',
};

/// The name choice for "first name plus last name".
const firstPlusLast = '\u0000first+last';

/// Which column the person chose for each field; empty means none (for the number:
/// search every column).
class ColumnChoice {
  const ColumnChoice({this.phone = '', this.name = '', this.email = '', this.company = ''});
  final String phone;
  final String name;
  final String email;
  final String company;

  factory ColumnChoice.from(DetectedColumns d) => ColumnChoice(
    phone: d.phoneColumns.firstOrNull ?? '',
    name: d.nameColumn ?? (d.firstNameColumn != null && d.lastNameColumn != null ? firstPlusLast : d.firstNameColumn ?? ''),
    email: d.emailColumn ?? '',
    company: d.companyColumn ?? '',
  );

  ColumnChoice copyWith({String? phone, String? name, String? email, String? company}) =>
      ColumnChoice(phone: phone ?? this.phone, name: name ?? this.name, email: email ?? this.email, company: company ?? this.company);
}

class ImportPreview {
  const ImportPreview(this.contacts, this.skipped, this.examples);
  final List<ImportContact> contacts;
  final Map<String, int> skipped;

  /// Up to five skipped rows, for showing why: (reason, the number as written, a name).
  final List<({String reason, String value, String label})> examples;

  int get skippedTotal => skipped.values.fold(0, (a, b) => a + b);
}

/// Contacts ready to save from [table] with [choice], plus why each other row was
/// skipped. Every column is kept as an attribute, the phone column too, so each can
/// fill a template variable for exactly that person. A repeated number keeps its
/// first position with its last row's details, as the web's Map does.
ImportPreview buildPreview(SheetTable table, DetectedColumns detected, ColumnChoice choice) {
  final spares = detected.phoneColumns.where((c) => c != choice.phone);
  final plan = DetectedColumns(
    phoneColumns: choice.phone.isEmpty ? const [] : [choice.phone, ...spares],
    nameColumn: choice.name.isNotEmpty && choice.name != firstPlusLast ? choice.name : null,
    firstNameColumn: choice.name == firstPlusLast ? detected.firstNameColumn : null,
    lastNameColumn: choice.name == firstPlusLast ? detected.lastNameColumn : null,
    emailColumn: choice.email.isEmpty ? null : choice.email,
    companyColumn: choice.company.isEmpty ? null : choice.company,
  );
  final byPhone = <String, ImportContact>{};
  final skipped = {for (final k in skipReasons.keys) k: 0};
  final examples = <({String reason, String value, String label})>[];
  String clip(String s) => s.length > 40 ? s.substring(0, 40) : s;
  void note(String reason, Map<String, String> row) {
    skipped[reason] = skipped[reason]! + 1;
    if (examples.length < 5 && reason != 'empty') {
      final label = plan.nameColumn != null ? row[plan.nameColumn] ?? '' : '';
      examples.add((reason: reason, value: clip(row[choice.phone] ?? ''), label: clip(label)));
    }
  }

  for (final row in table.rows) {
    final read = readContactRow(row, table.columns, plan);
    final contact = read.contact;
    if (contact == null) {
      note(read.reason, row);
      continue;
    }
    if (byPhone.containsKey(contact.phone)) note('duplicate', row);
    final attributes = <String, String>{};
    for (final column in table.columns) {
      final value = (row[column] ?? '').trim();
      if (value.isNotEmpty) attributes[column] = value.length > 2000 ? value.substring(0, 2000) : value;
    }
    byPhone[contact.phone] = ImportContact(
      phone: contact.phone,
      name: contact.name,
      email: contact.email,
      company: contact.company,
      attributes: attributes,
    );
  }
  return ImportPreview(byPhone.values.toList(), skipped, examples);
}
