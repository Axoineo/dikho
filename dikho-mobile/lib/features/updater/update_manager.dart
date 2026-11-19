import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import '../../app/app_config.dart';
import '../../shared/platform_api.dart';
import 'apk_downloader.dart';
import 'update_client.dart';
import 'update_controller.dart';
import 'update_dialog.dart';
import 'update_info.dart';
import 'update_schedule.dart';

/// Decides when to check and what to show.
///
/// - **Required** (the server says this version is below its minimum): [required]
///   is set and the app shows nothing but [UpdateRequiredScreen] until the update
///   is installed. Remembered across restarts.
/// - **Optional:** a dialog once the CRM is up. "Later" lasts until the app closes.
/// - **Newest wins:** only the server's latest release is ever considered, so an
///   ignored optional update is forgotten the moment a newer release exists, and a
///   release that stops being required unblocks at the next answer.
///
/// If the server cannot be reached nothing changes: nobody is locked out by an
/// outage, and a phone already told to update stays blocked.
///
/// A Play build asks the same server, but only acts on a required update, and sends
/// the person to the Play listing instead of downloading anything.
class UpdateManager extends ChangeNotifier {
  UpdateManager({required this.platform, required this.info, required this.navigatorKey})
    : _schedule = UpdateSchedule(File('${info.filesDir}/update_state.json')),
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
  bool _promptsAllowed = false;
  UpdateAvailable? _pendingPrompt;
  UpdateController? _required;
  UpdateController? _dialog;

  /// Set while the app must not be used until this update is installed.
  UpdateController? get required => _required;

  /// Reads what was remembered, then asks the server, alongside the CRM loading
  /// and never in front of it.
  Future<void> start() async {
    if (!_loaded) {
      _loaded = true;
      await _schedule.load();
      await _removeOldDownloads();
      final saved = _schedule.requiredUpdate(installedVersionCode: info.versionCode, isAllowedApkUrl: AppConfig.isAllowedApkUrl);
      if (saved != null) {
        _setRequired(_controllerFor(saved));
      } else {
        await _schedule.forgetRequired();
      }
    }
    await checkIfDue();
  }

  /// The CRM has appeared, so an optional update may now ask.
  void allowPrompts() {
    _promptsAllowed = true;
    final pending = _pendingPrompt;
    _pendingPrompt = null;
    if (pending != null) unawaited(_prompt(pending));
  }

  /// Called on each return to the foreground. No request is made unless due.
  Future<void> checkIfDue({bool force = false}) async {
    if (_busy) return;
    final now = DateTime.now();
    if (!force && !_schedule.isCheckDue(now)) return;
    _busy = true;
    try {
      final result = await _client.check(info.versionCode);
      if (result is CheckFailed) {
        // Local test builds only: the reason says nothing private, and device
        // tests read it to tell a TLS failure from an unexpected response.
        if (AppConfig.localTestBuild) {
          debugPrint('update check failed: ${result.reason}');
        }
        return;
      }
      _schedule.recordCheck(now);
      if (result is UpdateAvailable && result.info.mandatory) {
        await _schedule.rememberRequired(result.info);
        if (_required?.info.versionCode != result.info.versionCode) {
          _closeDialog();
          _setRequired(_controllerFor(result.info));
        }
        return;
      }
      await _schedule.forgetRequired();
      _setRequired(null);
      // A store keeps its own copy up to date, so only a required update is ours to raise.
      if (result is UpdateAvailable && !AppConfig.updatesFromStore) {
        if (_promptsAllowed) {
          unawaited(_prompt(result));
        } else {
          _pendingPrompt = result;
        }
      }
    } finally {
      _busy = false;
    }
  }

  Future<void> _prompt(UpdateAvailable offer) async {
    if (_dialog != null || !_schedule.shouldPrompt(offer.info)) return;
    final context = navigatorKey.currentContext;
    if (context == null || !context.mounted) return;
    final controller = _controllerFor(offer.info);
    _dialog = controller;
    final later = await showUpdateDialog(context, controller);
    if (identical(_dialog, controller)) _dialog = null;
    if (later) _schedule.dismiss(offer.info);
    controller.dispose();
  }

  void _closeDialog() {
    if (_dialog == null) return;
    _dialog = null;
    navigatorKey.currentState?.pop(false);
  }

  UpdateController _controllerFor(UpdateInfo update) => UpdateController(
    info: update,
    platform: platform,
    downloader: ApkDownloader(isAllowedRedirect: AppConfig.isAllowedDownloadHop),
    cacheDir: info.cacheDir,
    openStore: AppConfig.updatesFromStore ? () => platform.openExternal(AppConfig.storeListing) : null,
  );

  void _setRequired(UpdateController? next) {
    final previous = _required;
    if (identical(previous, next)) return;
    _required = next;
    previous?.dispose();
    notifyListeners();
  }

  /// Lets an open flow continue after the "install unknown apps" screen.
  Future<void> onResumed() async {
    await _dialog?.onResumed();
    await _required?.onResumed();
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

  @override
  void dispose() {
    _required?.dispose();
    super.dispose();
  }
}
