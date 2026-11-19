/// Leads, as the CRM page reads them from Supabase `cg_leads`, and their WhatsApp
/// confirmation state from the API. Kept in step with src/features/leads/.
library;

import '../../shared/values.dart';
import '../device_contacts/phone_number.dart';

/// The follow-up text the web page's WhatsApp button opens a chat with. Free text, so
/// it only goes inside WhatsApp's 24-hour window, like any other non-template message.
const leadFollowUpMessage =
    "Hi! I'm reaching out from Dikho. We noticed you were exploring our catalogue, did you find what "
    "you were looking for? Let us know if you'd like a quick call from one of our representatives to "
    'assist you further.';

/// Every lead comes from the corporate gifting form today.
const leadSource = 'Corporate gifting';

class Lead {
  Lead(this.raw);

  final Map<String, dynamic> raw;

  String get id => raw['id']?.toString() ?? '';
  String get companyName => _text('company_name');
  String get name => _text('name');
  String get email => _text('email');
  String get city => _text('city');
  String get countryCode => _text('country_code');
  String? get createdAt => raw['created_at'] as String?;

  /// `mobile` is a numeric column, so it can arrive as a number.
  String get mobile => wholeNumberText(raw['mobile']);

  String _text(String key) => (raw[key] as String? ?? '').trim();

  /// The company first, as the web list does, then the person.
  String get title => companyName.isNotEmpty ? companyName : (name.isNotEmpty ? name : 'Lead');
  String get subtitle => [if (companyName.isNotEmpty && name.isNotEmpty) name, leadSource].join(' · ');

  /// "+91 9800000011", as the web shows it.
  String? get phoneDisplay => mobile.isEmpty ? null : '$countryCode $mobile'.trim();

  /// The number to call or message, or null when it cannot be one.
  String? get dialable => mobile.isEmpty ? null : normalizePhoneNumber('${countryCode.isEmpty ? '+91' : countryCode}$mobile');

  /// The same digits-only key the Worker used when it sent the confirmation.
  String get statusKey => '$countryCode$mobile'.replaceAll(RegExp(r'\D'), '');

  String get initials {
    final words = title.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2);
    final letters = words.map((w) => String.fromCharCode(w.runes.first)).join().toUpperCase();
    return letters.isEmpty ? '?' : letters;
  }
}

/// The latest WhatsApp confirmation for one number.
class LeadStatus {
  const LeadStatus({required this.status, this.error});

  final String status;
  final String? error;

  String get label => switch (status) {
    'sent' => 'Sent',
    'delivered' => 'Delivered',
    'read' => 'Read',
    'failed' => 'Failed',
    _ => status,
  };
}

/// Most recent first from the API, so the first row for a number is its current state.
Map<String, LeadStatus> latestStatuses(List<Object?> rows) {
  final byPhone = <String, LeadStatus>{};
  for (final row in rows) {
    if (row is! Map) continue;
    final phone = row['phone'];
    final status = row['status'];
    if (phone is! String || status is! String || byPhone.containsKey(phone)) {
      continue;
    }
    final error = row['error_message'];
    byPhone[phone] = LeadStatus(status: status, error: error is String ? error : null);
  }
  return byPhone;
}

/// The PostgREST `or` filter for a search, the same as src/features/leads/leadSearch.js.
/// `mobile` is numeric, which ilike cannot compare, so a whole number is matched exactly,
/// with or without its country code.
String? leadSearchFilter(String query) {
  final text = query.replaceAll(RegExp(r'[%_]'), '').replaceAll(RegExp(r'[(),"\\]'), ' ').trim();
  final parts = [
    if (text.isNotEmpty)
      for (final column in const ['company_name', 'name', 'email', 'city']) '$column.ilike.%$text%',
  ];
  final digits = query.replaceAll(RegExp(r'[\s()+-]'), '');
  if (RegExp(r'^\d{4,15}$').hasMatch(digits)) {
    final numbers = {digits, if (digits.length > 10) digits.substring(digits.length - 10)};
    parts.add('mobile.in.(${numbers.join(',')})');
  }
  return parts.isEmpty ? null : parts.join(',');
}
