/// Clients, as src/features/clients/ reads and writes Supabase `clients`. The same
/// fields, the same rules: change one side and change the other.
library;

import '../../shared/values.dart';

/// Matches isActiveStatus in src/lib/status.js: the column has held all of these.
bool isActiveStatus(Object? value) => value == 1 || value == '1' || value == true || value == 'true' || value == 'active' || value == 'Active';

class Client {
  Client(this.raw);

  final Map<String, dynamic> raw;

  String get id => raw['id']?.toString() ?? '';
  String _text(String key) => (raw[key]?.toString() ?? '').trim();

  String get companyName => _text('company_name');
  String get contactPerson => _text('contact_person');
  String get designation => _text('designation');
  String get email => _text('email');
  String get gstin => _text('gstin');
  String get pan => _text('pan_number');
  String get registration => _text('registration');
  String get gstinDate => _text('gstin_date');
  String get tdsPercentage => _text('tds_percentage');
  String get tdsSection => _text('tds_section');
  String get addressLine1 => _text('address_line1');
  String get addressLine2 => _text('address_line2');
  String get city => _text('city');
  String get state => _text('state');
  String get pincode => _text('pincode');
  String get country => _text('country');
  bool get active => isActiveStatus(raw['status']);

  /// Both are numeric columns, so they can arrive as numbers.
  String get dialCode => wholeNumberText(raw['country_dialcode']).replaceFirst(RegExp(r'^\+'), '');
  String get contact => wholeNumberText(raw['contact']);

  String get title => companyName.isEmpty ? 'Unnamed client' : companyName;

  /// "+91 9800000021", as formatPhone in src/lib/format.js shows it.
  String? get phoneDisplay {
    if (contact.isEmpty) return null;
    return dialCode.isEmpty ? contact : '+$dialCode $contact';
  }

  /// The number to call, or null when there is none.
  String? get dialable {
    if (contact.isEmpty) return null;
    final digits = '${dialCode.isEmpty ? '91' : dialCode}$contact'.replaceAll(RegExp(r'\D'), '');
    return digits.length >= 8 && digits.length <= 15 ? '+$digits' : null;
  }

  String get address => [addressLine1, addressLine2].where((p) => p.isNotEmpty).join(', ');
  String get place => [city, state, pincode].where((p) => p.isNotEmpty).join(', ');

  /// The list row's second line: the contact, or where they are.
  String get subtitle => contactPerson.isNotEmpty ? contactPerson : [city, state].where((p) => p.isNotEmpty).join(', ');

  String get initials {
    final words = title.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2);
    final letters = words.map((w) => String.fromCharCode(w.runes.first)).join().toUpperCase();
    return letters.isEmpty ? '?' : letters;
  }
}

/// The dial codes the web form offers.
const clientDialCodes = <(String, String)>[('91', '+91 IN'), ('1', '+1 US'), ('44', '+44 UK'), ('971', '+971 AE'), ('65', '+65 SG')];

const defaultRegistrations = ['Registered', 'Unregistered', 'Composition', 'Other'];

/// The PostgREST `or` filter for a search, as the web Clients page builds it. Every
/// column here is text in the database.
String? clientSearchFilter(String query) {
  final text = query.replaceAll(RegExp(r'[%_]'), '').replaceAll(RegExp(r'[(),"\\]'), ' ').trim();
  if (text.isEmpty) return null;
  return [
    for (final column in const ['company_name', 'contact_person', 'email', 'gstin', 'pan_number']) '$column.ilike.%$text%',
  ].join(',');
}

/// What the form edits, as text, the way formFrom in ClientForm.jsx holds it.
class ClientDraft {
  ClientDraft.from(Client? client)
    : companyName = client?.companyName ?? '',
      contactPerson = client?.contactPerson ?? '',
      designation = client?.designation ?? '',
      dialCode = (client?.dialCode.isNotEmpty ?? false) ? client!.dialCode : '91',
      contact = client?.contact ?? '',
      email = client?.email ?? '',
      active = client?.active ?? true,
      gstin = client?.gstin ?? '',
      gstinDate = (client?.gstinDate ?? '').length >= 10 ? client!.gstinDate.substring(0, 10) : '',
      registration = client?.registration ?? '',
      pan = client?.pan ?? '',
      tdsPercentage = client?.tdsPercentage ?? '',
      tdsSection = client?.tdsSection ?? '',
      addressLine1 = client?.addressLine1 ?? '',
      addressLine2 = client?.addressLine2 ?? '',
      city = client?.city ?? '',
      state = client?.state ?? '',
      pincode = client?.pincode ?? '',
      country = client == null ? 'India' : client.country;

  String companyName;
  String contactPerson;
  String designation;
  String dialCode;
  String contact;
  String email;
  bool active;
  String gstin;
  String gstinDate;
  String registration;
  String pan;
  String tdsPercentage;
  String tdsSection;
  String addressLine1;
  String addressLine2;
  String city;
  String state;
  String pincode;
  String country;

  /// Field name to the sentence to show under it. Empty when it can be saved.
  Map<String, String> problems() {
    final found = <String, String>{};
    if (companyName.trim().isEmpty) found['company_name'] = 'Enter the company name.';
    final mail = email.trim();
    if (mail.isNotEmpty && !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(mail)) found['email'] = 'Enter a full email address.';
    final tds = tdsPercentage.trim();
    if (tds.isNotEmpty) {
      final value = double.tryParse(tds);
      if (value == null || value < 0 || value > 100) found['tds_percentage'] = 'Enter a percentage from 0 to 100.';
    }
    if (gstin.trim().length > 15) found['gstin'] = 'A GSTIN has 15 characters.';
    if (pan.trim().length > 10) found['pan_number'] = 'A PAN has 10 characters.';
    return found;
  }

  String? _orNull(String value) => value.trim().isEmpty ? null : value.trim();

  /// The row to save: the same payload ClientForm.jsx sends.
  Map<String, Object?> toPayload() {
    final digits = contact.replaceAll(RegExp(r'\D'), '');
    final tds = tdsPercentage.trim();
    return {
      'company_name': companyName.trim(),
      'contact_person': _orNull(contactPerson),
      'designation': _orNull(designation),
      'country_dialcode': digits.isNotEmpty && dialCode.isNotEmpty ? int.tryParse(dialCode) : null,
      'contact': digits.isEmpty ? null : int.tryParse(digits),
      'email': _orNull(email),
      'gstin': _orNull(gstin.toUpperCase()),
      'gstin_date': gstinDate.isEmpty ? null : gstinDate,
      'tds_percentage': tds.isEmpty ? null : num.tryParse(tds),
      'tds_section': _orNull(tdsSection),
      'registration': registration.isEmpty ? null : registration,
      'pan_number': _orNull(pan.toUpperCase()),
      'status': active ? 1 : 0,
      'address_line1': _orNull(addressLine1),
      'address_line2': _orNull(addressLine2),
      'city': _orNull(city),
      'state': _orNull(state),
      'pincode': _orNull(pincode),
      'country': _orNull(country),
    };
  }
}

/// The organization's registration list from get_settings, as listValues in
/// src/lib/settings.js picks it, with the current value kept even if since hidden.
List<String> registrationOptions(Object? settings, String current) {
  final lists = settings is Map ? settings['lists'] : null;
  final rows = lists is List ? lists.whereType<Map>().where((row) => row['list_key'] == 'registration').toList() : const <Map>[];
  final values = rows.isEmpty
      ? [...defaultRegistrations]
      : [
          for (final row in rows)
            if (row['hidden'] != true && row['value'] is String) row['value'] as String,
        ];
  if (current.isNotEmpty && !values.contains(current)) values.add(current);
  return values;
}
