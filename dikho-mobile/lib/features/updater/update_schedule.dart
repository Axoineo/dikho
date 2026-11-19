import 'dart:convert';
import 'dart:io';

import 'update_info.dart';

/// When to ask the server, and what the person has already answered.
///
/// The server only ever offers the newest release, so an update someone kept
/// putting off is simply replaced by the next one. Android updates are whole
/// APKs, so installing the newest includes everything before it.
///
/// "Later" lives in memory on purpose: it lasts until the app is closed, and the
/// next start asks again. Only a required update is written down, so that closing
/// the app or losing the network cannot be a way around it.
class UpdateSchedule {
  UpdateSchedule(this._file);

  final File _file;

  /// While the app stays open. Every fresh start checks regardless.
  static const checkInterval = Duration(minutes: 30);

  DateTime? _lastCheck;
  int _dismissedVersionCode = 0;
  Map<String, Object?>? _required;

  Future<void> load() async {
    try {
      final data = jsonDecode(await _file.readAsString());
      _required = data is Map<String, Object?> && data['required'] is Map<String, Object?> ? data['required'] as Map<String, Object?> : null;
    } on IOException {
      // First run, or unreadable: nothing is required as far as we know.
    } on FormatException {
      // Corrupt file: the server is asked at this start anyway.
    }
  }

  /// The update this phone was told it must install, unless it already has.
  UpdateInfo? requiredUpdate({required int installedVersionCode, required bool Function(Uri) isAllowedApkUrl}) {
    final saved = _required;
    if (saved == null) return null;
    try {
      return UpdateInfo.parse(saved, installedVersionCode: installedVersionCode, isAllowedApkUrl: isAllowedApkUrl);
    } on FormatException {
      // Not newer any more: it was installed. Or not readable: ask the server.
      return null;
    }
  }

  /// True at the first check of each run, then every [checkInterval]. A clock set
  /// backwards counts as due rather than blocking checks.
  bool isCheckDue(DateTime now) {
    final last = _lastCheck;
    if (last == null) return true;
    final elapsed = now.difference(last);
    return elapsed.isNegative || elapsed >= checkInterval;
  }

  /// Recorded only after the server answered, so a failed check is retried.
  void recordCheck(DateTime now) => _lastCheck = now;

  /// A required update always shows. An optional one shows unless the person
  /// said "Later" to it or to something newer during this run.
  bool shouldPrompt(UpdateInfo info) => info.mandatory || info.versionCode > _dismissedVersionCode;

  void dismiss(UpdateInfo info) {
    if (info.versionCode > _dismissedVersionCode) {
      _dismissedVersionCode = info.versionCode;
    }
  }

  Future<void> rememberRequired(UpdateInfo info) {
    _required = info.toJson();
    return _save();
  }

  Future<void> forgetRequired() {
    if (_required == null) return Future.value();
    _required = null;
    return _save();
  }

  Future<void> _save() async {
    try {
      await _file.writeAsString(jsonEncode({'required': _required}), flush: true);
    } on IOException {
      // Worst case the next start finds out from the server instead.
    }
  }
}
