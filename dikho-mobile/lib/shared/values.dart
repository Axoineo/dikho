/// Small conversions for values that come back from the database.
library;

/// A whole number stored in a numeric column, as digits: PostgREST sends it as a JSON
/// number, so 9800000021 can arrive as an int or a double. Never "9.8e9".
String wholeNumberText(Object? value) {
  if (value == null) return '';
  if (value is int) return '$value';
  if (value is double) return value == value.roundToDouble() ? value.toStringAsFixed(0) : '';
  return value.toString().trim();
}

/// A whole number grouped as the organization chose in Settings > Regional, as
/// formatCount in src/lib/format.js does: 'en-IN' gives 12,34,567 and 'en-US' 1,234,567.
String formatCount(num value, {String style = 'en-IN'}) {
  final negative = value < 0;
  final digits = value.abs().round().toString();
  String grouped;
  if (digits.length <= 3) {
    grouped = digits;
  } else if (style == 'en-US') {
    final parts = <String>[];
    for (var end = digits.length; end > 0; end -= 3) {
      parts.insert(0, digits.substring(end - 3 < 0 ? 0 : end - 3, end));
    }
    grouped = parts.join(',');
  } else {
    final head = digits.substring(0, digits.length - 3);
    final parts = <String>[];
    for (var end = head.length; end > 0; end -= 2) {
      parts.insert(0, head.substring(end - 2 < 0 ? 0 : end - 2, end));
    }
    grouped = '${parts.join(',')},${digits.substring(digits.length - 3)}';
  }
  return negative ? '-$grouped' : grouped;
}

/// The organization's number style from get_settings, or the CRM's default.
String numberStyleFrom(Object? settings) {
  final organization = settings is Map ? settings['organization'] : null;
  final style = organization is Map ? organization['number_format'] : null;
  return style == 'en-US' ? 'en-US' : 'en-IN';
}

/// "APPROVED" or "completed" as "Approved", "Completed", as sentenceCase in
/// src/features/whatsapp/labels.js.
String sentenceCase(String text) {
  if (text.isEmpty) return text;
  final lower = text.toLowerCase();
  return lower[0].toUpperCase() + lower.substring(1);
}
