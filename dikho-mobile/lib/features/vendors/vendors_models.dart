/// Vendors, as src/features/vendors/ reads and writes Supabase `vendors` and
/// `vendor_addresses`. The same fields, the same rules: change one side and change the
/// other.
library;

import '../../shared/values.dart';
import '../clients/clients_models.dart' show isActiveStatus;

/// The embedded address columns, as VENDOR_ADDRESS_COLUMNS in vendorFilters.js.
const vendorAddressColumns = 'id,address,country,country_code,state,city,zipcode,is_default';

/// Every vendor query embeds its addresses.
const vendorSelect = '*,vendor_addresses($vendorAddressColumns)';

class VendorAddress {
  const VendorAddress(this.raw);

  final Map<String, dynamic> raw;

  String _text(String key) => (raw[key]?.toString() ?? '').trim();

  Object? get id => raw['id'];
  String get street => _text('address');
  String get city => _text('city');
  String get state => _text('state');
  String get zipcode => _text('zipcode');
  String get country => _text('country');
  String get countryCode => _text('country_code');
  bool get isDefault => raw['is_default'] == true;

  String get place => [city, state].where((p) => p.isNotEmpty).join(', ');
}

class Vendor {
  Vendor(this.raw);

  final Map<String, dynamic> raw;

  String get id => raw['id']?.toString() ?? '';
  String _text(String key) => (raw[key]?.toString() ?? '').trim();

  String get companyName => _text('company_name');
  String get alias => _text('alias');
  String get vendorType => _text('vendor_type');
  String get contactPerson => _text('contact_person');
  String get email => _text('email');
  String get gstin => _text('gstin');
  String get gstinDate => _text('gstin_date');
  String get pan => _text('pan_number');
  String get registration => _text('registration');
  String get tdsPercentage => _text('tds_percentage');
  String get tdsSection => _text('tds_section');
  String get openingBalance => _text('opening_balance');
  String get bankName => _text('vendor_bank_name');
  String get ifsc => _text('vendor_ifsc_code');
  String get accountNumber => wholeNumberText(raw['vendor_account_number']);
  String get paymentTermValue => _text('payment_term_value');
  String get paymentTermType => _text('payment_term_type');
  String get paymentTermDate => _text('payment_term_invoice_date');
  String get documentPath => _text('vendor_document_file_path');
  String get documentName => _text('vendor_document_file_name');
  int? get mediaId => raw['media_id'] is num ? (raw['media_id'] as num).toInt() : int.tryParse(_text('media_id'));
  int? get subMediaId => raw['sub_media_id'] is num ? (raw['sub_media_id'] as num).toInt() : int.tryParse(_text('sub_media_id'));
  bool get active => isActiveStatus(raw['status']);

  /// Numeric columns, so they can arrive as numbers.
  String get dialCode => wholeNumberText(raw['country_dialcode']).replaceAll(RegExp(r'[^0-9]'), '');
  String get contact => wholeNumberText(raw['contact']);

  String get title => companyName.isEmpty ? 'Unnamed vendor' : companyName;

  /// The default address, or the first, as primaryAddress in vendorFilters.js.
  VendorAddress? get address {
    final list = raw['vendor_addresses'];
    if (list is! List) return null;
    final rows = list.whereType<Map<String, dynamic>>().map(VendorAddress.new).toList();
    if (rows.isEmpty) return null;
    return rows.firstWhere((a) => a.isDefault, orElse: () => rows.first);
  }

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

  /// "30 days from invoice date", as VendorDetails.jsx words it.
  String? get paymentTerm {
    if (paymentTermValue.isEmpty) return null;
    return '$paymentTermValue days from ${(paymentTermType.isEmpty ? 'invoice date' : paymentTermType).toLowerCase()}';
  }

  /// The list row's second line: the contact, or where they are.
  String get subtitle {
    final where = address?.place ?? '';
    return [contactPerson, where].where((p) => p.isNotEmpty).join(' · ');
  }

  String get initials {
    final words = title.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2);
    final letters = words.map((w) => String.fromCharCode(w.runes.first)).join().toUpperCase();
    return letters.isEmpty ? '?' : letters;
  }
}

class MediaOption {
  const MediaOption(this.id, this.name, {this.mediaId});

  final int id;
  final String name;

  /// For a sub media: the media it belongs to.
  final int? mediaId;

  static MediaOption? from(Map<String, dynamic> row) {
    final id = row['id'];
    if (id is! num) return null;
    final media = row['media_id'];
    return MediaOption(id.toInt(), (row['name']?.toString() ?? '').trim(), mediaId: media is num ? media.toInt() : null);
  }
}

/// The PostgREST `or` filter for a search, as applyVendorFilters builds it. Every
/// column here is text in the database.
String? vendorSearchFilter(String query) {
  final text = query.replaceAll(RegExp(r'[%_]'), '').replaceAll(RegExp(r'[(),"\\]'), ' ').trim();
  if (text.isEmpty) return null;
  return [
    for (final column in const ['company_name', 'alias', 'contact_person', 'email', 'gstin', 'pan_number']) '$column.ilike.%$text%',
  ].join(',');
}

const vendorDocumentTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const vendorDocumentMaxBytes = 10 * 1024 * 1024;
const paymentTermTypes = [('Invoice Date', 'Invoice date'), ('Campaign End Date', 'Campaign end')];

/// What the form edits, as text, the way formFrom in VendorForm.jsx holds it.
class VendorDraft {
  VendorDraft.from(Vendor? vendor)
    : companyName = vendor?.companyName ?? '',
      vendorType = (vendor?.vendorType.isNotEmpty ?? false) ? vendor!.vendorType : 'Organization',
      active = vendor?.active ?? true,
      alias = vendor?.alias ?? '',
      contactPerson = vendor?.contactPerson ?? '',
      email = vendor?.email ?? '',
      dialCode = (vendor?.dialCode.isNotEmpty ?? false) ? vendor!.dialCode : '91',
      contact = vendor?.contact ?? '',
      mediaId = vendor?.mediaId,
      subMediaId = vendor?.subMediaId,
      paymentTermValue = vendor?.paymentTermValue ?? '',
      paymentTermType = (vendor?.paymentTermType.isNotEmpty ?? false) ? vendor!.paymentTermType : 'Invoice Date',
      paymentTermDate = _day(vendor?.paymentTermDate),
      registration = vendor?.registration ?? '',
      gstin = vendor?.gstin ?? '',
      gstinDate = _day(vendor?.gstinDate),
      pan = vendor?.pan ?? '',
      tdsPercentage = vendor?.tdsPercentage ?? '',
      tdsSection = vendor?.tdsSection ?? '',
      openingBalance = vendor == null ? '0' : (vendor.openingBalance.isEmpty ? '0' : vendor.openingBalance),
      bankName = vendor?.bankName ?? '',
      ifsc = vendor?.ifsc ?? '',
      accountNumber = vendor?.accountNumber ?? '',
      confirmAccountNumber = vendor == null
          ? ''
          : (wholeNumberText(vendor.raw['vendor_confirm_account_number']).isNotEmpty
                ? wholeNumberText(vendor.raw['vendor_confirm_account_number'])
                : vendor.accountNumber),
      country = vendor == null ? 'India' : (vendor.address?.country ?? ''),
      countryCode = vendor == null ? 'IN' : (vendor.address?.countryCode ?? ''),
      state = vendor?.address?.state ?? '',
      city = vendor?.address?.city ?? '',
      zipcode = vendor?.address?.zipcode ?? '',
      street = vendor?.address?.street ?? '';

  static String _day(String? value) => (value ?? '').length >= 10 ? value!.substring(0, 10) : (value ?? '');

  String companyName;
  String vendorType;
  bool active;
  String alias;
  String contactPerson;
  String email;
  String dialCode;
  String contact;
  int? mediaId;
  int? subMediaId;
  String paymentTermValue;
  String paymentTermType;
  String paymentTermDate;
  String registration;
  String gstin;
  String gstinDate;
  String pan;
  String tdsPercentage;
  String tdsSection;
  String openingBalance;
  String bankName;
  String ifsc;
  String accountNumber;
  String confirmAccountNumber;
  String country;
  String countryCode;
  String state;
  String city;
  String zipcode;
  String street;

  /// Field name to the sentence to show under it, as validate() in VendorForm.jsx,
  /// with the number checks the database would otherwise refuse less clearly.
  Map<String, String> problems() {
    final found = <String, String>{};
    if (companyName.trim().isEmpty) found['company_name'] = 'Enter the company name.';
    if (mediaId == null) found['media_id'] = 'Choose a media type.';
    if (subMediaId == null) found['sub_media_id'] = 'Choose a sub media type.';
    if (accountNumber.trim() != confirmAccountNumber.trim()) found['vendor_confirm_account_number'] = 'Account numbers do not match.';
    if (state.trim().isEmpty) found['state'] = 'Enter the state.';
    if (city.trim().isEmpty) found['city'] = 'Enter the city.';
    if (street.trim().isEmpty) found['address'] = 'Enter the street address.';
    final mail = email.trim();
    if (mail.isNotEmpty && !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(mail)) found['email'] = 'Enter a full email address.';
    if (paymentTermValue.trim().isNotEmpty && int.tryParse(paymentTermValue.trim()) == null) found['payment_term_value'] = 'Enter a number of days.';
    final tds = tdsPercentage.trim();
    if (tds.isNotEmpty) {
      final value = double.tryParse(tds);
      if (value == null || value < 0 || value > 100) found['tds_percentage'] = 'Enter a percentage from 0 to 100.';
    }
    if (openingBalance.trim().isNotEmpty && double.tryParse(openingBalance.trim()) == null) found['opening_balance'] = 'Enter an amount.';
    if (gstin.trim().length > 15) found['gstin'] = 'A GSTIN has 15 characters.';
    if (pan.trim().length > 10) found['pan_number'] = 'A PAN has 10 characters.';
    return found;
  }

  String? _orNull(String value) => value.trim().isEmpty ? null : value.trim();

  /// The vendor row: the same payload vendorPayload() in VendorForm.jsx sends.
  Map<String, Object?> vendorPayload() {
    final digits = contact.replaceAll(RegExp(r'\D'), '');
    return {
      'alias': _orNull(alias),
      'contact_person': _orNull(contactPerson),
      'company_name': companyName.trim(),
      'gstin': _orNull(gstin.toUpperCase()),
      'gstin_date': gstinDate.isEmpty ? null : gstinDate,
      'payment_term_invoice_date': paymentTermDate.isEmpty ? null : paymentTermDate,
      'payment_term_type': paymentTermType,
      'payment_term_value': paymentTermValue.trim().isEmpty ? null : int.tryParse(paymentTermValue.trim()),
      'vendor_type': vendorType,
      'country_dialcode': '+$dialCode',
      'country_code': countryCode.isEmpty ? null : countryCode,
      'contact': digits.isEmpty ? null : int.tryParse(digits),
      'email': _orNull(email),
      'media_id': mediaId,
      'sub_media_id': subMediaId,
      'registration': registration.isEmpty ? null : registration,
      'pan_number': _orNull(pan.toUpperCase()),
      'opening_balance': openingBalance.trim().isEmpty ? 0 : num.tryParse(openingBalance.trim()) ?? 0,
      'tds_percentage': tdsPercentage.trim().isEmpty ? null : num.tryParse(tdsPercentage.trim()),
      'tds_section': _orNull(tdsSection),
      'vendor_bank_name': _orNull(bankName),
      'vendor_ifsc_code': _orNull(ifsc.toUpperCase()),
      'vendor_account_number': _orNull(accountNumber),
      'vendor_confirm_account_number': _orNull(confirmAccountNumber),
      'status': active ? 1 : 0,
    };
  }

  /// The address row: addressPayload() in VendorForm.jsx.
  Map<String, Object?> addressPayload(Object vendorId) => {
    'vendor_id': vendorId is String ? int.tryParse(vendorId) ?? vendorId : vendorId,
    'address': street.trim(),
    'country': country.trim(),
    'country_code': countryCode.isEmpty ? null : countryCode,
    'state': state.trim(),
    'city': city.trim(),
    'zipcode': _orNull(zipcode),
    'is_default': true,
  };
}

/// The storage path for a vendor's document, as uploadDocument in VendorForm.jsx
/// makes it: the vendor's folder, a timestamp and a cleaned file name.
String vendorDocumentPath(Object vendorId, String fileName, DateTime now) {
  final safe = fileName.replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '_');
  return 'vendors_documents/$vendorId/${now.millisecondsSinceEpoch}-${safe.isEmpty ? 'document' : safe}';
}
