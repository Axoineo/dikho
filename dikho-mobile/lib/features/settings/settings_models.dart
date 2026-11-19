import '../shell/shell_messages.dart';

/// The data behind Settings, as src/features/settings shows it: the person's own
/// preferences, the business details printed on invoices, the display formats and the
/// dropdown lists. The database functions check settings.manage again on every change,
/// so nothing here decides what may be changed.

String _text(Object? value) => value is String ? value : (value == null ? '' : '$value');

int _int(Object? value) => value is num ? value.toInt() : int.tryParse('$value') ?? 0;

/* ── Preferences ──────────────────────────────────────────────────────────── */

const themeChoices = [('light', 'Light'), ('dark', 'Dark'), ('system', 'System')];

/// Pages someone may choose to open first, in the drawer's order. Only the ones this
/// person can open are offered.
List<(String, String)> startPagesFor(ShellAccess access, {required bool emailHub}) => [
  for (final (path, label) in [
    ('/clients', 'Clients'),
    ('/leads', 'Leads'),
    ('/vendors', 'Vendors'),
    ('/sales-orders', 'Sales orders'),
    ('/purchase-orders', 'Purchase orders'),
    ('/whatsapp/inbox', 'WhatsApp inbox'),
    ('/whatsapp', 'WhatsApp overview'),
    if (emailHub) ('/email/inbox', 'Email inbox'),
    ('/users', 'Users'),
    ('/settings', 'Settings'),
  ])
    if (access.mayOpen(path)) (path, label),
];

/// What set_my_preferences accepts, read from my_access's `preferences`.
class Preferences {
  const Preferences([this.raw = const {}]);

  final Map<String, Object?> raw;

  String get density => raw['density'] == 'compact' ? 'compact' : 'comfortable';
  int get pageSize => switch (_int(raw['page_size'])) {
    50 => 50,
    100 => 100,
    _ => 25,
  };
  String get startPage => _text(raw['start_page']);

  /// [changes] applied the way the database applies them: a null removes the key.
  Preferences merged(Map<String, Object?> changes) {
    final next = {...raw, ...changes}..removeWhere((_, value) => value == null);
    return Preferences(next);
  }
}

/* ── Company ──────────────────────────────────────────────────────────────── */

final gstinPattern = RegExp(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
final panPattern = RegExp(r'^[A-Z]{5}[0-9]{4}[A-Z]$');
final ifscPattern = RegExp(r'^[A-Z]{4}0[A-Z0-9]{6}$');

const companyFields = [
  'legal_name',
  'gstin',
  'pan',
  'state_code',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'pincode', //
  'country',
  'bank_name',
  'bank_account_name',
  'bank_account_number',
  'bank_ifsc',
  'bank_branch',
];

/// The editable copy of get_organization_profile: every field as text, India when no
/// country is set, as companyForm in OrganizationSettings.jsx.
Map<String, String> companyForm(Object? row) {
  final source = row is Map ? row : const {};
  final form = {for (final key in companyFields) key: source[key] == null ? '' : '${source[key]}'};
  if (form['country']!.isEmpty) form['country'] = 'India';
  return form;
}

/// The GST state code once the GSTIN is complete: its first two digits.
String? derivedStateCode(Map<String, String> form) {
  final gstin = form['gstin'] ?? '';
  return gstinPattern.hasMatch(gstin) ? gstin.substring(0, 2) : null;
}

/// What is wrong, field by field, in the order the form shows them. The database
/// checks the same again.
Map<String, String> companyProblems(Map<String, String> form) {
  String f(String key) => form[key] ?? '';
  final found = <String, String>{};
  final gstin = f('gstin');
  final pan = f('pan');
  if (f('legal_name').trim().isEmpty) found['legal_name'] = 'Enter the legal name.';
  if (gstin.isNotEmpty && !gstinPattern.hasMatch(gstin)) found['gstin'] = 'A GSTIN is 15 characters, like the one on your GST certificate.';
  if (pan.isNotEmpty && !panPattern.hasMatch(pan)) found['pan'] = 'A PAN is 10 characters: 5 letters, 4 digits, 1 letter.';
  if (gstin.isNotEmpty && pan.isNotEmpty && gstinPattern.hasMatch(gstin) && gstin.substring(2, 12) != pan) {
    found['pan'] = 'This PAN is not the one inside the GSTIN.';
  }
  if (gstin.isEmpty && !RegExp(r'^[0-9]{2}$').hasMatch(f('state_code'))) found['state_code'] = 'Enter the two-digit GST state code.';
  if (f('address_line1').trim().isEmpty) found['address_line1'] = 'Enter the address.';
  if (f('city').trim().isEmpty) found['city'] = 'Enter the city.';
  if (f('state').trim().isEmpty) found['state'] = 'Enter the state.';
  final india = (f('country').isEmpty ? 'India' : f('country')) == 'India';
  if (india ? !RegExp(r'^[1-9][0-9]{5}$').hasMatch(f('pincode')) : f('pincode').trim().isEmpty) {
    found['pincode'] = 'Enter the 6-digit PIN code.';
  }
  if (f('bank_ifsc').isNotEmpty && !ifscPattern.hasMatch(f('bank_ifsc'))) found['bank_ifsc'] = 'An IFSC is 11 characters, the fifth one a zero.';
  final account = f('bank_account_number');
  if (account.isNotEmpty && !RegExp(r'^[0-9]{6,18}$').hasMatch(account)) found['bank_account_number'] = 'Use 6 to 18 digits.';
  return found;
}

/// Only the fields that differ from what is saved: all update_organization_profile
/// needs, and all its audit entry records.
Map<String, String> companyChanges(Map<String, String> saved, Map<String, String> form) => {
  for (final key in companyFields)
    if (form[key] != saved[key]) key: form[key] ?? '',
};

/* ── Regional ─────────────────────────────────────────────────────────────── */

const dateFormats = ['d MMM yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd'];
const numberChoices = [('en-IN', '₹1,00,000', 'Indian (lakh and crore)'), ('en-US', '₹100,000', 'International (thousands)')];

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// [day] as [format] shows it, so a choice reads as what it looks like.
String formatDayAs(String format, DateTime day) {
  String two(int n) => n.toString().padLeft(2, '0');
  return switch (format) {
    'dd/MM/yyyy' => '${two(day.day)}/${two(day.month)}/${day.year}',
    'yyyy-MM-dd' => '${day.year}-${two(day.month)}-${two(day.day)}',
    _ => '${day.day} ${_months[day.month - 1]} ${day.year}',
  };
}

/// get_settings' organization part, with the CRM's defaults where nothing is saved.
class Regional {
  const Regional({this.dateFormat = 'd MMM yyyy', this.numberFormat = 'en-IN'});

  factory Regional.from(Object? settings) {
    final organization = settings is Map ? settings['organization'] : null;
    final date = organization is Map ? organization['date_format'] : null;
    final number = organization is Map ? organization['number_format'] : null;
    return Regional(dateFormat: dateFormats.contains(date) ? date as String : 'd MMM yyyy', numberFormat: number == 'en-US' ? 'en-US' : 'en-IN');
  }

  final String dateFormat;
  final String numberFormat;

  Regional copyWith({String? dateFormat, String? numberFormat}) =>
      Regional(dateFormat: dateFormat ?? this.dateFormat, numberFormat: numberFormat ?? this.numberFormat);

  Map<String, String> toJson() => {'date_format': dateFormat, 'number_format': numberFormat};

  @override
  bool operator ==(Object other) => other is Regional && other.dateFormat == dateFormat && other.numberFormat == numberFormat;

  @override
  int get hashCode => Object.hash(dateFormat, numberFormat);
}

/* ── Lists and media ──────────────────────────────────────────────────────── */

class SettingsList {
  const SettingsList(this.key, this.title, this.noun, this.description);

  final String key;
  final String title;
  final String noun;
  final String description;

  bool get isColor => key == 'row_color';
}

const settingsLists = [
  SettingsList('order_status', 'Order statuses', 'order status', 'Sales and purchase orders.'),
  SettingsList('order_type', 'Order types', 'order type', 'Sales and purchase orders.'),
  SettingsList('purchase_status', 'Purchase statuses', 'purchase status', 'How far a sales order has been bought.'),
  SettingsList('item_type', 'Item types', 'item type', 'Lines on sales and purchase orders.'),
  SettingsList('courier_status', 'Courier statuses', 'courier status', 'Documents sent by courier.'),
  SettingsList('registration', 'Registration types', 'registration type', 'Clients and vendors.'),
  SettingsList('row_color', 'Row colours', 'colour', 'To mark orders in the list.'),
];

/// One value of a dropdown list (option_lists).
class OptionRow {
  OptionRow(this.raw);

  final Map raw;

  int get id => _int(raw['id']);
  String get listKey => _text(raw['list_key']);
  String get value => _text(raw['value']);
  String get label => _text(raw['label']);
  String get name => label.isEmpty ? value : label;
  int get sortOrder => _int(raw['sort_order']);
  bool get hidden => raw['hidden'] == true;
}

/// [key]'s values from get_settings, in the order dropdowns show them.
List<OptionRow> optionsOf(Object? settings, String key) {
  final lists = settings is Map ? settings['lists'] : null;
  final rows = [
    if (lists is List)
      for (final row in lists)
        if (row is Map && row['list_key'] == key) OptionRow(row),
  ];
  rows.sort((a, b) => a.sortOrder != b.sortOrder ? a.sortOrder.compareTo(b.sortOrder) : a.id.compareTo(b.id));
  return rows;
}

/// Colours offered for a new row colour: the CRM's own blue first, then hues that
/// stay readable as a small dot on light and dark lists.
const rowColourChoices = [
  ('#185494', 'Blue'),
  ('#1e6b3a', 'Green'),
  ('#b3261e', 'Red'),
  ('#b06000', 'Orange'),
  ('#8a6d00', 'Mustard'),
  ('#6a3fa0', 'Purple'),
  ('#00796b', 'Teal'),
  ('#c2185b', 'Pink'),
  ('#5d4037', 'Brown'),
  ('#546e7a', 'Grey'),
];

final hexColour = RegExp(r'^#[0-9a-fA-F]{6}$');

/// '#185494' as a Flutter colour value, or null when it is not one.
int? colourValue(String hex) => hexColour.hasMatch(hex) ? 0xFF000000 | int.parse(hex.substring(1), radix: 16) : null;

class MediaType {
  MediaType(this.raw);

  final Map raw;

  int get id => _int(raw['id']);
  String get name => _text(raw['name']);
  bool get hidden => raw['hidden'] == true;
}

class SubMediaType {
  SubMediaType(this.raw);

  final Map raw;

  int get id => _int(raw['id']);
  int get mediaId => _int(raw['media_id']);
  String get name => _text(raw['name']);
  bool get hidden => raw['hidden'] == true;
}
