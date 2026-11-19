import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../../shared/crm_api.dart';

/// How fast a campaign goes out, as the web wizard's PACES: the pause comes between
/// batches, so Meta's warnings have time to arrive and stop the campaign.
enum SendPace {
  steady('Steady', Duration(seconds: 30), 'A batch every 30 seconds, about 80 messages a minute. Recommended.'),
  gentle('Gentle', Duration(seconds: 60), 'A batch every minute, about 40 messages a minute.'),
  fast('No pauses', Duration.zero, 'Batches back to back. Only for small lists.');

  const SendPace(this.label, this.pause, this.hint);
  final String label;
  final Duration pause;
  final String hint;

  static const typicalBatch = 40;

  /// "about a minute", "about 12 minutes".
  String estimate(int count) {
    final batches = max(1, (count / typicalBatch).ceil());
    final seconds = batches * 4 + (batches - 1) * pause.inSeconds;
    return seconds < 90 ? 'about a minute' : 'about ${(seconds / 60).round()} minutes';
  }
}

/// Meta said to stop the whole campaign (src/api/services/whatsapp/sendHalts.js).
class SendHalt {
  const SendHalt({required this.code, required this.resumable, required this.reason});

  factory SendHalt.from(Map raw) => SendHalt(
    code: '${raw['code'] ?? ''}',
    resumable: raw['resumable'] == true,
    reason: raw['reason'] is String ? raw['reason'] as String : 'Meta asked to stop this campaign.',
  );

  final String code;

  /// Waiting is the fix (rate limits, outages); otherwise someone has to act first.
  final bool resumable;
  final String reason;
}

enum SendState { ready, sending, stopped, halted, failed, done }

/// A random id for one press of Send, in the form the API accepts.
String newRequestId([Random? random]) {
  final r = random ?? Random.secure();
  final bytes = List<int>.generate(16, (_) => r.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// Sends one campaign: POST /api/campaigns/send creates it and sends the first batch,
/// then POST /api/campaigns/send-batch until nobody is left, pausing at the chosen pace.
///
/// Nothing here repeats a request on its own. A start whose reply was lost can be tried
/// again by the person, with the same request id, which the API answers with the same
/// campaign instead of a second one. A batch can always be resumed: the API sends to each
/// person once per campaign.
class CampaignSender extends ChangeNotifier {
  CampaignSender({
    required this.api,
    required this.name,
    required this.contactIds,
    required this.shared,
    this.pace = SendPace.steady,
    Future<void> Function(Duration)? sleep,
    DateTime Function()? now,
    String? requestId,
  }) : _sleep = sleep ?? Future<void>.delayed,
       _now = now ?? DateTime.now,
       requestId = requestId ?? newRequestId();

  final CrmApi api;
  final String name;
  final List<int> contactIds;

  /// Template name, language, texts and the variable map, sent with every request.
  final Map<String, Object?> shared;
  SendPace pace;
  final Future<void> Function(Duration) _sleep;
  final DateTime Function() _now;

  /// One per press of Send, kept for a retry of the start.
  final String requestId;

  SendState state = SendState.ready;
  int? campaignId;
  List<int> remaining = const [];
  int sent = 0;
  int failed = 0;
  int total = 0;
  int batch = 0;
  int waitSeconds = 0;
  String? firstError;
  SendHalt? halt;
  String? error;

  /// The start's reply never came: nobody knows yet whether the campaign exists.
  bool startUnconfirmed = false;
  bool _stopRequested = false;
  bool _disposed = false;

  bool get stopRequested => _stopRequested;
  bool get canResume =>
      (state == SendState.failed && (campaignId != null ? remaining.isNotEmpty : startUnconfirmed)) ||
      (state == SendState.stopped && remaining.isNotEmpty) ||
      (state == SendState.halted && (halt?.resumable ?? false) && remaining.isNotEmpty);

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void stop() {
    if (state != SendState.sending) return;
    _stopRequested = true;
    _notify();
  }

  Future<void> start() async {
    if (state != SendState.ready) return;
    total = contactIds.length;
    await _run(() async {
      final first = await api.post('/campaigns/send', {'name': name, 'contactIds': contactIds, 'requestId': requestId, ...shared});
      startUnconfirmed = false;
      _take(first, countTotal: true);
      await _drive(first);
    }, starting: true);
  }

  /// After a lost start, a stop, a resumable halt or a dropped batch.
  Future<void> resume() async {
    if (!canResume) return;
    if (campaignId == null) {
      // Same request id: the API answers with the campaign it already started, if any.
      state = SendState.ready;
      await start();
      return;
    }
    await _run(() async {
      final next = await api.post('/campaigns/send-batch', {'campaignId': campaignId, 'contactIds': remaining, ...shared});
      _take(next);
      await _drive(next);
    });
  }

  Future<void> _run(Future<void> Function() body, {bool starting = false}) async {
    state = SendState.sending;
    _stopRequested = false;
    error = null;
    halt = null;
    _notify();
    try {
      await body();
    } on ApiException catch (failure) {
      if (_disposed) return;
      error = friendlyError(failure);
      // Only a reply that never came leaves the start in doubt; a refusal is final.
      startUnconfirmed = starting && campaignId == null && (failure.status == null || failure.status! >= 500);
      state = SendState.failed;
    } finally {
      waitSeconds = 0;
      _notify();
    }
  }

  void _take(Map<String, dynamic> data, {bool countTotal = false}) {
    final id = data['campaignId'];
    if (id is num) campaignId = id.toInt();
    // A retried start reports the campaign's real totals, not just this request's.
    sent = (countTotal ? 0 : sent) + _int(data['sent']);
    failed = (countTotal ? 0 : failed) + _int(data['failed']);
    firstError ??= data['firstError'] is String ? data['firstError'] as String : null;
    final halted = data['halted'];
    remaining = _ids(halted is Map ? data['notSent'] : data['remaining']);
    if (countTotal) total = max(total, sent + failed + remaining.length);
    if (halted is Map) halt = SendHalt.from(halted);
    batch += 1;
    _notify();
  }

  Future<void> _drive(Map<String, dynamic> response) async {
    var data = response;
    while (halt == null && remaining.isNotEmpty) {
      if (pace.pause > Duration.zero) {
        final end = _now().add(pace.pause);
        while (!_stopRequested) {
          final left = end.difference(_now());
          if (left <= Duration.zero) break;
          waitSeconds = (left.inMilliseconds / 1000).ceil();
          _notify();
          await _sleep(left < const Duration(seconds: 1) ? left : const Duration(seconds: 1));
        }
        waitSeconds = 0;
      }
      if (_stopRequested || _disposed) {
        state = SendState.stopped;
        return;
      }
      data = await api.post('/campaigns/send-batch', {'campaignId': campaignId, 'contactIds': remaining, ...shared});
      _take(data);
    }
    state = halt != null ? SendState.halted : SendState.done;
  }

  static int _int(Object? value) => value is num ? value.toInt() : 0;
  static List<int> _ids(Object? value) => [
    for (final id in value is List ? value : const [])
      if (id is num) id.toInt(),
  ];

  @override
  void dispose() {
    _disposed = true;
    _stopRequested = true;
    super.dispose();
  }
}
