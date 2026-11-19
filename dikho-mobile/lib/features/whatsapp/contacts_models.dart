/// WhatsApp contacts, as GET /api/contacts lists them (src/api/routes/contacts/index.js)
/// and the web Contacts page shows them.
library;

/// One contact in the campaign audience.
class WaContact {
  const WaContact({
    required this.id,
    required this.phone,
    this.name = '',
    this.email = '',
    this.company = '',
    this.optedOut = false,
    this.createdAt,
    this.attributes = const {},
  });

  factory WaContact.from(Map<String, dynamic> row) {
    String text(String key) => row[key] is String ? (row[key] as String).trim() : '';
    final raw = row['attributes'];
    return WaContact(
      id: row['id'] is num ? (row['id'] as num).toInt() : int.tryParse('${row['id']}') ?? 0,
      phone: text('phone').replaceAll(RegExp(r'[^0-9]'), ''),
      name: text('name'),
      email: text('email'),
      company: text('company'),
      optedOut: row['opted_out'] == 1 || row['opted_out'] == true,
      createdAt: text('created_at').isEmpty ? null : text('created_at'),
      attributes: {
        if (raw is Map)
          for (final entry in raw.entries.take(20))
            if (entry.value != null && '${entry.value}'.trim().isNotEmpty) '${entry.key}': '${entry.value}'.trim(),
      },
    );
  }

  final int id;

  /// Digits with the country code, as stored: 919876543210.
  final String phone;
  final String name;
  final String email;
  final String company;
  final bool optedOut;
  final String? createdAt;

  /// Extra columns from an imported sheet, such as city or a template variable.
  final Map<String, String> attributes;

  String get title => name.isEmpty ? 'Unnamed' : name;

  /// "+919876543210", what the web shows and what a call dials.
  String get dialable => '+$phone';

  String get subtitle => company.isEmpty ? dialable : '$dialable · $company';

  String get initials {
    final words = name.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    if (words.isEmpty) return phone.length >= 2 ? phone.substring(phone.length - 2) : '#';
    if (words.length == 1) return words.first.substring(0, words.first.length < 2 ? words.first.length : 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }
}

/// One page of the list. [total] comes only with the first page of a search.
class ContactPage {
  const ContactPage({required this.contacts, required this.nextCursor, this.total});

  factory ContactPage.from(Map<String, dynamic> data) => ContactPage(
    contacts: [
      for (final row in data['contacts'] as List? ?? const [])
        if (row is Map<String, dynamic>) WaContact.from(row),
    ],
    nextCursor: data['nextCursor'] is String ? data['nextCursor'] as String : null,
    total: data['total'] is num ? (data['total'] as num).toInt() : null,
  );

  final List<WaContact> contacts;
  final String? nextCursor;
  final int? total;
}
