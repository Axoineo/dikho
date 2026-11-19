/// The WhatsApp dashboard's figures, as GET /api/whatsapp/analytics and
/// GET /api/whatsapp/analytics/campaigns/:id return them, and the arithmetic and
/// wording the screens share. Kept in step with
/// src/features/whatsapp/analytics/figures.js.
library;

import 'dart:math' as math;

import '../../shared/values.dart';

int _int(Object? value) => value is num ? value.round() : int.tryParse('$value') ?? 0;
double _double(Object? value) => value is num ? value.toDouble() : double.tryParse('$value') ?? 0;
String? _text(Object? value) => value is String && value.isNotEmpty ? value : null;
List<Map<String, dynamic>> _rows(Object? value) => [
  for (final row in value is List ? value : const [])
    if (row is Map<String, dynamic>) row,
];

/// Sent, delivered and read for one stretch of messages.
class Totals {
  const Totals({
    this.sent = 0,
    this.delivered = 0,
    this.read = 0,
    this.failed = 0,
    this.awaiting = 0,
    this.inbound = 0,
    this.campaign = 0,
    this.replies = 0,
    this.automatic = 0,
  });

  factory Totals.from(Object? raw) {
    final map = raw is Map ? raw : const {};
    return Totals(
      sent: _int(map['sent']),
      delivered: _int(map['delivered']),
      read: _int(map['read']),
      failed: _int(map['failed']),
      awaiting: _int(map['awaiting']),
      inbound: _int(map['inbound']),
      campaign: _int(map['campaign']),
      replies: _int(map['replies']),
      automatic: _int(map['automatic']),
    );
  }

  final int sent, delivered, read, failed, awaiting, inbound, campaign, replies, automatic;
}

class DayFigures {
  const DayFigures({required this.day, required this.totals});

  factory DayFigures.from(Map<String, dynamic> row) => DayFigures(day: '${row['day'] ?? ''}', totals: Totals.from(row));

  final String day;
  final Totals totals;
}

class FailureReason {
  const FailureReason({required this.code, required this.count, required this.reason});

  factory FailureReason.from(Map<String, dynamic> row) =>
      FailureReason(code: _text(row['code']), count: _int(row['count']), reason: _text(row['reason']) ?? 'Unknown reason');

  final String? code;
  final int count;
  final String reason;
}

/// One button and how often it was tapped (and by how many people, where known).
class ButtonTaps {
  const ButtonTaps(this.label, this.count, {this.people, this.template});

  final String label;
  final int count;
  final int? people;
  final String? template;
}

List<ButtonTaps> _buttons(Object? raw, {String? template}) => [
  for (final row in _rows(raw))
    ButtonTaps(_text(row['label']) ?? 'Button', _int(row['count']), people: row['people'] == null ? null : _int(row['people']), template: template),
];

/// Whether Meta's template insights answered, and why not when they did not.
class InsightsState {
  const InsightsState({required this.available, this.reason});

  factory InsightsState.from(Object? raw) {
    final map = raw is Map ? raw : const {};
    return InsightsState(available: map['available'] == true, reason: _text(map['reason']));
  }

  final bool available;
  final String? reason;
}

class TemplateFigures {
  const TemplateFigures({
    required this.name,
    required this.totals,
    this.quality,
    this.status,
    this.replyTaps = const [],
    this.replyTapTotal = 0,
    this.links = const [],
    this.linkTaps,
    this.cost,
  });

  factory TemplateFigures.from(Map<String, dynamic> row) {
    final name = _text(row['name']) ?? 'Unnamed';
    return TemplateFigures(
      name: name,
      totals: Totals.from(row),
      quality: _text(row['quality']),
      status: _text(row['status']),
      replyTaps: _buttons(row['replyTaps'], template: name),
      replyTapTotal: _int(row['replyTapTotal']),
      links: _buttons(row['links'], template: name),
      linkTaps: row['linkTaps'] is num ? _int(row['linkTaps']) : null,
      cost: row['cost'] is num ? _double(row['cost']) : null,
    );
  }

  final String name;
  final Totals totals;
  final String? quality;
  final String? status;

  /// Quick-reply taps, counted from our own records.
  final List<ButtonTaps> replyTaps;
  final int replyTapTotal;

  /// Link taps from Meta's template insights; null when insights did not answer.
  final List<ButtonTaps> links;
  final int? linkTaps;
  final double? cost;

  int get taps => replyTapTotal + (linkTaps ?? 0);
}

class CampaignSummary {
  const CampaignSummary({
    required this.id,
    required this.name,
    required this.template,
    required this.status,
    required this.audience,
    required this.createdAt,
    required this.totals,
  });

  factory CampaignSummary.from(Map<String, dynamic> row) => CampaignSummary(
    id: _int(row['id']),
    name: _text(row['name']) ?? 'Campaign',
    template: _text(row['template']) ?? '',
    status: _text(row['status']) ?? '',
    audience: _int(row['audience']),
    createdAt: parseStamp(row['createdAt']),
    totals: Totals.from(row),
  );

  final int id;
  final String name;
  final String template;
  final String status;
  final int audience;
  final DateTime? createdAt;
  final Totals totals;
}

class AccountHealth {
  const AccountHealth({this.phone, this.verifiedName, this.nameStatus, this.quality, this.throughput, this.messagingLimit});

  factory AccountHealth.from(Map raw) => AccountHealth(
    phone: _text(raw['phone']),
    verifiedName: _text(raw['verifiedName']),
    nameStatus: _text(raw['nameStatus']),
    quality: _text(raw['quality']),
    throughput: _text(raw['throughput']),
    messagingLimit: _text(raw['messagingLimit']),
  );

  final String? phone, verifiedName, nameStatus, quality, throughput, messagingLimit;
}

class SpendCategory {
  const SpendCategory(this.category, this.volume, this.cost);
  final String category;
  final int volume;
  final double cost;
}

class Spend {
  const Spend({required this.currency, required this.total, required this.volume, required this.byCategory, required this.daily});

  factory Spend.from(Map raw) => Spend(
    currency: _text(raw['currency']),
    total: _double(raw['total']),
    volume: _int(raw['volume']),
    byCategory: [
      for (final row in _rows(raw['byCategory'])) SpendCategory('${row['category'] ?? 'OTHER'}', _int(row['volume']), _double(row['cost'])),
    ],
    daily: {for (final row in _rows(raw['daily'])) '${row['day']}': _double(row['cost'])},
  );

  final String? currency;
  final double total;
  final int volume;
  final List<SpendCategory> byCategory;

  /// Charges by day; days without charges are missing.
  final Map<String, double> daily;
}

/// The whole dashboard for one period.
class Analytics {
  const Analytics({
    required this.days,
    required this.from,
    required this.to,
    required this.totals,
    required this.previous,
    required this.daily,
    required this.failures,
    required this.templates,
    required this.templateHealth,
    this.insights = const InsightsState(available: false),
    required this.campaigns,
    required this.contacts,
    required this.optedOut,
    required this.added,
    required this.openChats,
    required this.unreadChats,
    required this.account,
    required this.spend,
    required this.metaErrors,
    required this.computedAt,
  });

  factory Analytics.from(Map<String, dynamic> data) {
    final range = data['range'] is Map ? data['range'] as Map : const {};
    final audience = data['audience'] is Map ? data['audience'] as Map : const {};
    final inbox = data['inbox'] is Map ? data['inbox'] as Map : const {};
    final health = data['templateHealth'];
    return Analytics(
      days: _int(range['days']),
      from: '${range['from'] ?? ''}',
      to: '${range['to'] ?? ''}',
      totals: Totals.from(data['totals']),
      previous: Totals.from(data['previous']),
      daily: [for (final row in _rows(data['daily'])) DayFigures.from(row)],
      failures: [for (final row in _rows(data['failures'])) FailureReason.from(row)],
      templates: [for (final row in _rows(data['templates'])) TemplateFigures.from(row)],
      templateHealth: health is Map ? {for (final entry in health.entries) '${entry.key}': _int(entry.value)} : null,
      insights: InsightsState.from(data['templateInsights']),
      campaigns: [for (final row in _rows(data['campaigns'])) CampaignSummary.from(row)],
      contacts: _int(audience['contacts']),
      optedOut: _int(audience['optedOut']),
      added: _int(audience['added']),
      openChats: _int(inbox['open']),
      unreadChats: _int(inbox['unread']),
      account: data['account'] is Map ? AccountHealth.from(data['account'] as Map) : null,
      spend: data['spend'] is Map ? Spend.from(data['spend'] as Map) : null,
      metaErrors: [
        for (final e in data['metaErrors'] is List ? data['metaErrors'] as List : const [])
          if (e is String) e,
      ],
      computedAt: parseStamp(data['computedAt']),
    );
  }

  final int days;
  final String from, to;
  final Totals totals, previous;
  final List<DayFigures> daily;
  final List<FailureReason> failures;
  final List<TemplateFigures> templates;
  final Map<String, int>? templateHealth;
  final InsightsState insights;
  final List<CampaignSummary> campaigns;
  final int contacts, optedOut, added, openChats, unreadChats;
  final AccountHealth? account;
  final Spend? spend;
  final List<String> metaErrors;
  final DateTime? computedAt;
}

class HourFigures {
  const HourFigures(this.hour, this.delivered, this.read);
  final int hour, delivered, read;
}

/// One campaign on its own.
class CampaignPerformance {
  const CampaignPerformance({
    required this.summary,
    required this.notSent,
    required this.replied,
    required this.optedOut,
    required this.failures,
    required this.timeline,
    required this.replyWindowDays,
    this.replyTaps = const [],
    this.linkTaps,
    this.insights = const InsightsState(available: false),
  });

  factory CampaignPerformance.from(Map<String, dynamic> data) {
    final campaign = data['campaign'] is Map<String, dynamic> ? data['campaign'] as Map<String, dynamic> : <String, dynamic>{};
    final totals = data['totals'] is Map<String, dynamic> ? data['totals'] as Map<String, dynamic> : <String, dynamic>{};
    final taps = data['taps'] is Map ? data['taps'] as Map : const {};
    return CampaignPerformance(
      summary: CampaignSummary.from({...campaign, ...totals}),
      notSent: _int(totals['notSent']),
      replied: _int(totals['replied']),
      optedOut: _int(totals['optedOut']),
      failures: [for (final row in _rows(data['failures'])) FailureReason.from(row)],
      timeline: [for (final row in _rows(data['timeline'])) HourFigures(_int(row['hour']), _int(row['delivered']), _int(row['read']))],
      replyWindowDays: _int(data['replyWindowDays']) == 0 ? 7 : _int(data['replyWindowDays']),
      replyTaps: _buttons(taps['replies']),
      linkTaps: taps['links'] is List ? _buttons(taps['links']) : null,
      insights: InsightsState.from(taps['insights']),
    );
  }

  final CampaignSummary summary;
  final int notSent, replied, optedOut;
  final List<FailureReason> failures;
  final List<HourFigures> timeline;
  final int replyWindowDays;

  /// Quick-reply taps on this campaign's own messages.
  final List<ButtonTaps> replyTaps;

  /// Link taps on its template from Meta, or null when insights did not answer.
  final List<ButtonTaps>? linkTaps;
  final InsightsState insights;
}

/* ── Arithmetic and wording ─────────────────────────────────────────────── */

/// part / whole as a percentage, or null when there is nothing to divide by.
double? rate(num part, num whole) => whole > 0 ? part / whole * 100 : null;

/// "92%" or "99.6%": a decimal only below 10% or when rounding would mislead.
String formatPercent(double? value) {
  if (value == null || !value.isFinite) return '—';
  final rounded = value.round();
  if ((value > 0 && value < 10) || (rounded == 100 && value < 100) || (rounded == 0 && value > 0)) {
    final floored = (value * 10).floor() / 10;
    return '${floored == floored.roundToDouble() ? floored.toStringAsFixed(0) : floored.toStringAsFixed(1)}%';
  }
  return '$rounded%';
}

enum ChangeTone { good, bad, neutral }

class Change {
  const Change(this.text, this.tone, {this.up});
  final String text;
  final ChangeTone tone;

  /// true up, false down, null flat or new.
  final bool? up;
}

/// How a figure moved against the previous period: counts in percent, rates in points.
Change? change(num? current, num? previous, {bool isRate = false, bool higherIsBetter = true}) {
  if (current == null || previous == null) return null;
  double amount;
  String text;
  if (isRate) {
    amount = (current - previous).toDouble();
    if (amount.abs() < 0.05) return const Change('No change', ChangeTone.neutral);
    text = '${amount.abs().toStringAsFixed(amount.abs() < 10 ? 1 : 0)} pts';
  } else {
    if (previous == 0) return current == 0 ? const Change('No change', ChangeTone.neutral) : const Change('New this period', ChangeTone.neutral);
    amount = (current - previous) / previous * 100;
    if (amount.abs() < 0.5) return const Change('No change', ChangeTone.neutral);
    text = amount.abs() >= 1000 ? '999+%' : '${amount.abs().round()}%';
  }
  final up = amount > 0;
  return Change(text, up == higherIsBetter ? ChangeTone.good : ChangeTone.bad, up: up);
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// "1 Nov" from a YYYY-MM-DD day, read from the text so no timezone moves it.
String shortDay(String day) {
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(day);
  if (match == null) return day;
  return '${int.parse(match[3]!)} ${_months[int.parse(match[2]!) - 1]}';
}

/// "Sun, 1 Nov" for a tooltip.
String longDay(String day) {
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(day);
  if (match == null) return day;
  final date = DateTime.utc(int.parse(match[1]!), int.parse(match[2]!), int.parse(match[3]!));
  return '${_weekdays[date.weekday - 1]}, ${shortDay(day)}';
}

/// A D1 stamp ('YYYY-MM-DD HH:MM:SS' in UTC, or ISO) as a UTC DateTime, or null.
DateTime? parseStamp(Object? value) {
  if (value is! String || value.trim().isEmpty) return null;
  var text = value.trim().replaceFirst(' ', 'T');
  if (!RegExp(r'([zZ]|[+-]\d\d:?\d\d)$').hasMatch(text)) text = '${text}Z';
  return DateTime.tryParse(text)?.toUtc();
}

/// "3 Nov, 10:00" in the phone's own time.
String formatStamp(DateTime? stamp) {
  if (stamp == null) return '—';
  final local = stamp.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${local.day} ${_months[local.month - 1]}, ${two(local.hour)}:${two(local.minute)}';
}

const _limits = {'TIER_50': 50, 'TIER_250': 250, 'TIER_1K': 1000, 'TIER_2K': 2000, 'TIER_10K': 10000, 'TIER_100K': 100000};

/// Meta's messaging limit in words.
String? messagingLimitLabel(String? tier, {String style = 'en-IN'}) {
  if (tier == null) return null;
  if (tier == 'TIER_UNLIMITED') return 'Unlimited';
  final people = _limits[tier];
  return people == null ? tier : '${formatCount(people, style: style)} people a day';
}

enum QualityTone { good, warn, bad, neutral }

class Quality {
  const Quality(this.label, this.tone);
  final String label;
  final QualityTone tone;
}

Quality qualityOf(String? value) => switch (value?.toUpperCase()) {
  'GREEN' => const Quality('High', QualityTone.good),
  'YELLOW' => const Quality('Medium', QualityTone.warn),
  'RED' => const Quality('Low', QualityTone.bad),
  _ => const Quality('Not rated yet', QualityTone.neutral),
};

const throughputLabels = {'STANDARD': 'Standard (up to 80 a second)', 'HIGH': 'High (up to 1,000 a second)', 'NOT_APPLICABLE': 'Not applicable'};

const categoryLabels = {
  'MARKETING': 'Marketing',
  'UTILITY': 'Utility',
  'SERVICE': 'Service',
  'AUTHENTICATION': 'Authentication',
  'AUTHENTICATION_INTERNATIONAL': 'Authentication (international)',
  'REFERRAL_CONVERSION': 'Free entry point',
  'OTHER': 'Other',
};

const _symbols = {'INR': '₹', 'USD': r'$', 'EUR': '€', 'GBP': '£'};

/// "₹1,234.50" in the account's currency, grouped as the organization chose.
String formatMoney(double amount, String? currency, {String style = 'en-IN', bool paise = true}) {
  final code = currency ?? 'INR';
  final symbol = _symbols[code] ?? '$code ';
  final negative = amount < 0;
  final cents = (amount.abs() * 100).round();
  final whole = formatCount(cents ~/ 100, style: style);
  final fraction = (cents % 100).toString().padLeft(2, '0');
  return '${negative ? '-' : ''}$symbol$whole${paise ? '.$fraction' : ''}';
}

/// Hour-by-hour receipts as running totals, plus the hour by which half had arrived.
({List<HourFigures> points, int? halfDelivered, int? halfRead}) cumulative(List<HourFigures> timeline) {
  var delivered = 0;
  var read = 0;
  final points = [for (final row in timeline) HourFigures(row.hour, delivered += row.delivered, read += row.read)];
  int? half(int Function(HourFigures) pick, int total) {
    if (total == 0) return null;
    for (final point in points) {
      if (pick(point) * 2 >= total) return point.hour;
    }
    return null;
  }

  return (points: points, halfDelivered: half((p) => p.delivered, delivered), halfRead: half((p) => p.read, read));
}

/// "within the first hour", "within 3 hours", "after three days or more".
String? hoursPhrase(int? hour) {
  if (hour == null) return null;
  if (hour >= 72) return 'after three days or more';
  if (hour == 0) return 'within the first hour';
  return 'within ${hour + 1} hours';
}

/// A rounded top and evenly spaced ticks, as scale() in src/features/whatsapp/analytics/scale.js.
({double top, List<double> ticks}) chartScale(double max, {int count = 4, bool integer = true}) {
  if (!(max > 0)) {
    return (top: integer ? count.toDouble() : 1, ticks: [for (var i = 0; i <= count; i++) integer ? i.toDouble() : i / count]);
  }
  final raw = max / count;
  final magnitude = math.pow(10, (math.log(raw) / math.ln10).floor()).toDouble();
  var step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).firstWhere((s) => s >= raw - 1e-9);
  if (integer) step = math.max(1, step.ceilToDouble());
  final top = (max / step - 1e-9).ceil() * step;
  return (top: top, ticks: [for (var v = 0.0; v <= top + step / 1000; v += step) (v * 1000).round() / 1000]);
}
