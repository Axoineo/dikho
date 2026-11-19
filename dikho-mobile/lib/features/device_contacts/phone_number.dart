/// Numbers as people save them, turned into something WhatsApp and the phone can
/// both use. The API normalises again on its side and is the one that decides.
library;

const defaultCountryCode = '91';

/// E.164 with a leading +, or null for anything that cannot be dialled as a real
/// number (short codes, service numbers, text). A local 10-digit number, with or
/// without a leading 0, is taken as Indian.
String? normalizePhoneNumber(String raw) {
  final trimmed = raw.trim();
  final digits = trimmed.replaceAll(RegExp(r'\D'), '');
  if (digits.isEmpty) return null;
  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? '+$digits' : null;
  }
  if (digits.startsWith('00') && digits.length >= 10 && digits.length <= 17) return '+${digits.substring(2)}';
  if (digits.length == 10) return '+$defaultCountryCode$digits';
  if (digits.length == 11 && digits.startsWith('0')) return '+$defaultCountryCode${digits.substring(1)}';
  if (digits.length >= 11 && digits.length <= 15) return '+$digits';
  return null;
}

/// "+91 98000 00001" for Indian numbers, otherwise as it is.
String formatPhoneNumber(String e164) {
  if (e164.startsWith('+91') && e164.length == 13) {
    return '+91 ${e164.substring(3, 8)} ${e164.substring(8)}';
  }
  return e164;
}

class DeviceContact {
  const DeviceContact({required this.name, required this.number});

  final String name;

  /// E.164, with its leading +.
  final String number;

  String get display => formatPhoneNumber(number);
  String get searchText => '${name.toLowerCase()} ${number.substring(1)}';
  String get label => name.isEmpty ? display : name;

  String get initials {
    final words = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2);
    final letters = words.map((w) => String.fromCharCode(w.runes.first)).join().toUpperCase();
    return letters.isEmpty ? '#' : letters;
  }
}

/// From the flat [name, number, name, number...] the phone answers with. Entries
/// with no usable number are dropped, and one person's same number saved twice
/// (mobile and WhatsApp, say) appears once. Runs off the UI thread.
List<DeviceContact> parseDeviceContacts(List<String> flat) {
  final seen = <String>{};
  final contacts = <DeviceContact>[];
  for (var i = 0; i + 1 < flat.length; i += 2) {
    final number = normalizePhoneNumber(flat[i + 1]);
    if (number == null) continue;
    final name = flat[i].trim();
    if (seen.add('${name.toLowerCase()}|$number')) contacts.add(DeviceContact(name: name, number: number));
  }
  return contacts;
}

List<DeviceContact> filterDeviceContacts(List<DeviceContact> contacts, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return contacts;
  final digits = q.replaceAll(RegExp(r'[\s()+-]'), '');
  final isNumber = digits.isNotEmpty && RegExp(r'^\d+$').hasMatch(digits);
  return contacts.where((c) => c.searchText.contains(isNumber ? digits : q)).toList();
}
