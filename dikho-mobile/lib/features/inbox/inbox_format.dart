/// Formatting shared by the chat list and the thread. Mirrors the browser inbox
/// (src/features/whatsapp/inbox/inboxUtils.js) so both read the same.
library;

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

String _two(int n) => n.toString().padLeft(2, '0');

/// D1 stores timestamps as ISO (our inserts) or as `datetime('now')`'s
/// space-separated UTC string.
DateTime? parseWaDate(String? value) {
  if (value == null || value.isEmpty) return null;
  final iso = value.contains('T') ? value : '${value.replaceFirst(' ', 'T')}Z';
  return DateTime.tryParse(iso)?.toLocal();
}

bool _sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

String formatClock(DateTime d) {
  final hour = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '${_two(hour)}:${_two(d.minute)} ${d.hour < 12 ? 'AM' : 'PM'}';
}

String formatTime(String? value) {
  final d = parseWaDate(value);
  return d == null ? '' : formatClock(d);
}

/// Chat list: time today, "Yesterday", weekday this week, else a date.
String formatListTime(String? value, {DateTime? now}) {
  final d = parseWaDate(value);
  if (d == null) return '';
  final today = now ?? DateTime.now();
  if (_sameDay(d, today)) return formatClock(d);
  if (_sameDay(d, today.subtract(const Duration(days: 1)))) return 'Yesterday';
  if (today.difference(d).inDays < 7) return _weekdays[d.weekday - 1];
  return '${_two(d.day)} ${_months[d.month - 1]} ${_two(d.year % 100)}';
}

/// Centred day chip in the thread.
String formatDaySeparator(String? value, {DateTime? now}) {
  final d = parseWaDate(value);
  if (d == null) return '';
  final today = now ?? DateTime.now();
  if (_sameDay(d, today)) return 'Today';
  if (_sameDay(d, today.subtract(const Duration(days: 1)))) return 'Yesterday';
  return '${_two(d.day)} ${_months[d.month - 1]} ${d.year}';
}

String dayKey(String? value) {
  final d = parseWaDate(value);
  return d == null ? '' : '${d.year}-${d.month}-${d.day}';
}

String formatFileSize(int? bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} kB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

String formatDuration(int ms) {
  final total = (ms / 1000).floor();
  return '${total ~/ 60}:${_two(total % 60)}';
}

/// Honest proxy for "last seen": the Cloud API does not expose real presence.
String formatLastActive(String? value, {DateTime? now}) {
  final d = parseWaDate(value);
  if (d == null) return '';
  final mins = (now ?? DateTime.now()).difference(d).inMinutes;
  if (mins < 1) return 'just now';
  if (mins < 60) return '$mins min ago';
  final hours = (mins / 60).round();
  if (hours < 24) return '$hours h ago';
  return formatListTime(value, now: now).toLowerCase();
}

/// What remains of the 24-hour customer-service window, or zero.
Duration sessionLeft(String? lastInboundAt, {DateTime? now}) {
  final d = parseWaDate(lastInboundAt);
  if (d == null) return Duration.zero;
  final left = const Duration(hours: 24) - (now ?? DateTime.now()).difference(d);
  return left.isNegative ? Duration.zero : left;
}

String formatCountdown(Duration left) => '${left.inHours}h ${left.inMinutes % 60}m';

String initialsOf(String? name, String? phone) {
  final source = (name ?? '').trim();
  if (source.isNotEmpty) {
    final words = source.split(RegExp(r'\s+')).take(2);
    return words.map((w) => String.fromCharCode(w.runes.first)).join().toUpperCase();
  }
  final digits = phone ?? '?';
  return digits.length <= 2 ? digits : digits.substring(digits.length - 2);
}
