import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import '../../app/app_config.dart';
import '../../shared/platform_api.dart';
import 'apk_downloader.dart';
import 'update_client.dart';
import 'update_controller.dart';
import 'update_dialog.dart';
import 'update_schedule.dart';

/// Decides when to check and when to show the dialog. Independent of the CRM:
/// nothing here reads or touches the WebView, and any failure simply means no
/// dialog this time.
class UpdateManager {
  UpdateManager({
    required this.platform,
    required this.info,
    required this.navigatorKey,
  }) : _schedule = UpdateSchedule(File('${info.filesDir}/update_state.json')),
       _client = UpdateClient(
         baseUrl: AppConfig.updateUri,
         appId: AppConfig.appId,
         channel: AppConfig.updateChannel,
         isAllowedApkUrl: AppConfig.isAllowedApkUrl,
       );

  final PlatformApi platform;
  final AppInfo info;
  final GlobalKey<NavigatorState> navigatorKey;
  final UpdateSchedule _schedule;
  final UpdateClient _client;

  bool _loaded = false;
  bool _busy = false;
  bool _deferredThisRun = false;
  UpdateController? _active;

  /// Called after startup and on each return to the foreground. Cheap when no
  /// check is due: no network request is made.
  Future<void> checkIfDue() async {
    if (_busy || _deferredThisRun) return;
    _busy = true;
    try {
      if (!_loaded) {
        _loaded = true;
        await _schedule.load();
        await _removeOldDownloads();
      }
      final now = DateTime.now();
      if (!_schedule.isCheckDue(now)) return;

      final result = await _client.check(info.versionCode);
      if (result is CheckFailed) {
        // Local test builds only: the reason says nothing private, and device
        // tests read it to tell a TLS failure from an unexpected response.
        if (AppConfig.localTestBuild) {
          debugPrint('update check failed: ${result.reason}');
        }
        return;
      }
      await _schedule.recordCheck(now);
      if (result is! UpdateAvailable) return;
      if (!_schedule.shouldPrompt(result.info, now)) return;

      final context = navigatorKey.currentContext;
      if (context == null || !context.mounted) return;
      final controller = UpdateController(
        info: result.info,
        platform: platform,
        downloader: ApkDownloader(
          isAllowedRedirect: AppConfig.isAllowedDownloadHop,
        ),
        cacheDir: info.cacheDir,
      );
      _active = controller;
      final later = await showUpdateDialog(context, controller);
      _active = null;
      if (later) {
        if (result.info.mandatory) {
          // "Continue for now" after a failure: leave them to work until the
          // next launch, which asks again.
          _deferredThisRun = true;
          await _schedule.forgetLastCheck();
        } else {
          await _schedule.snooze(result.info, DateTime.now());
        }
      }
      controller.dispose();
    } finally {
      _busy = false;
    }
  }

  /// Lets an open dialog continue after the "install unknown apps" screen.
  Future<void> onResumed() async {
    await _active?.onResumed();
  }

  /// An APK has no use once it is installed or superseded.
  Future<void> _removeOldDownloads() async {
    final dir = Directory('${info.cacheDir}/updates');
    try {
      if (await dir.exists()) await dir.delete(recursive: true);
    } on IOException {
      // Android clears the cache directory itself when it needs the space.
    }
  }
}
