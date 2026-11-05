import 'dart:convert';
import 'dart:io';

import 'update_info.dart';

/// When to ask the server and when to bother the user. Persisted in a small
/// file in app-private storage so restarts do not reset it.
class UpdateSchedule {
  UpdateSchedule(this._file);

  final File _file;

  static const checkInterval = Duration(hours: 6);
  static const snoozeFor = Duration(hours: 24);

  int _lastCheckMs = 0;
  int _snoozedVersionCode = 0;
  int _snoozedUntilMs = 0;

  Future<void> load() async {
    try {
      final data = jsonDecode(await _file.readAsString());
      if (data is! Map) return;
      _lastCheckMs = _intOr0(data['lastCheckMs']);
      _snoozedVersionCode = _intOr0(data['snoozedVersionCode']);
      _snoozedUntilMs = _intOr0(data['snoozedUntilMs']);
    } on IOException {
      // First run, or unreadable: start from nothing.
    } on FormatException {
      // Corrupt file: start from nothing.
    }
  }

  static int _intOr0(Object? value) => value is int ? value : 0;

  /// A clock moved backwards counts as due rather than blocking checks.
  bool isCheckDue(DateTime now) {
    final elapsed = now.millisecondsSinceEpoch - _lastCheckMs;
    return elapsed < 0 || elapsed >= checkInterval.inMilliseconds;
  }

  /// A mandatory update always prompts. "Later" holds only for that version.
  bool shouldPrompt(UpdateInfo info, DateTime now) {
    if (info.mandatory) return true;
    if (info.versionCode != _snoozedVersionCode) return true;
    return now.millisecondsSinceEpoch >= _snoozedUntilMs;
  }

  /// Recorded only after the server answered, so a failed check is retried at
  /// the next launch instead of waiting out the interval.
  Future<void> recordCheck(DateTime now) {
    _lastCheckMs = now.millisecondsSinceEpoch;
    return _save();
  }

  /// Makes the next launch check again, whatever the interval says.
  Future<void> forgetLastCheck() {
    _lastCheckMs = 0;
    return _save();
  }

  Future<void> snooze(UpdateInfo info, DateTime now) {
    _snoozedVersionCode = info.versionCode;
    _snoozedUntilMs = now.add(snoozeFor).millisecondsSinceEpoch;
    return _save();
  }

  Future<void> _save() async {
    try {
      await _file.writeAsString(
        jsonEncode({
          'lastCheckMs': _lastCheckMs,
          'snoozedVersionCode': _snoozedVersionCode,
          'snoozedUntilMs': _snoozedUntilMs,
        }),
        flush: true,
      );
    } on IOException {
      // Worst case the user is asked again sooner.
    }
  }
}
