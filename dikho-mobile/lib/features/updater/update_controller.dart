import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../../shared/platform_api.dart';
import 'apk_downloader.dart';
import 'update_info.dart';

enum UpdatePhase {
  prompt,
  downloading,
  verifying,
  needsPermission,
  installing,
  failed,
}

/// Why the flow stopped, so the dialog can say something useful.
enum UpdateProblem {
  network,
  badFile,
  wrongSigner,
  storage,
  installCancelled,
  installFailed,
}

/// One update attempt, from "Update Now" to handing over to Android's
/// installer. Knows nothing about the CRM or about widgets.
class UpdateController extends ChangeNotifier {
  UpdateController({
    required this.info,
    required this.platform,
    required this.downloader,
    required this.cacheDir,
  });

  final UpdateInfo info;
  final UpdaterPlatform platform;
  final ApkDownloader downloader;
  final String cacheDir;

  UpdatePhase phase = UpdatePhase.prompt;
  UpdateProblem? problem;
  int received = 0;

  DownloadCancelToken? _cancel;
  StreamSubscription<Map<Object?, Object?>>? _installEvents;
  File? _apk;
  bool _disposed = false;

  double get fraction =>
      info.sizeBytes == 0 ? 0 : (received / info.sizeBytes).clamp(0.0, 1.0);

  int get percent => (fraction * 100).floor();

  void _set(UpdatePhase next, {UpdateProblem? why}) {
    if (_disposed) return;
    phase = next;
    problem = why;
    notifyListeners();
  }

  Future<void> start() async {
    if (phase == UpdatePhase.downloading || phase == UpdatePhase.verifying) {
      return;
    }
    received = 0;
    _set(UpdatePhase.downloading);
    final cancel = DownloadCancelToken();
    _cancel = cancel;
    try {
      _apk = await downloader.download(
        url: info.apkUrl,
        expectedSha256: info.sha256,
        expectedSize: info.sizeBytes,
        target: File('$cacheDir/updates/dikho-crm-${info.versionCode}.apk'),
        cancel: cancel,
        onProgress: (bytes, _) {
          received = bytes;
          if (!_disposed) notifyListeners();
        },
      );
    } on DownloadCancelled {
      _set(UpdatePhase.prompt);
      return;
    } on DownloadException catch (error) {
      _set(
        UpdatePhase.failed,
        why: switch (error.failure) {
          DownloadFailure.network ||
          DownloadFailure.badResponse ||
          DownloadFailure.badRedirect => UpdateProblem.network,
          DownloadFailure.sizeMismatch ||
          DownloadFailure.checksumMismatch => UpdateProblem.badFile,
          DownloadFailure.storage => UpdateProblem.storage,
        },
      );
      return;
    }

    _set(UpdatePhase.verifying);
    String? rejected;
    try {
      rejected = await platform.verifyApk(_apk!.path, info.versionCode);
    } on PlatformException {
      rejected = 'unreadable';
    }
    if (rejected != null) {
      await _discardApk();
      _set(UpdatePhase.failed, why: UpdateProblem.wrongSigner);
      return;
    }
    await continueInstall();
  }

  /// Runs after verification, and again when the user returns from the
  /// "install unknown apps" settings screen.
  Future<void> continueInstall() async {
    final apk = _apk;
    if (apk == null) return;
    try {
      if (!await platform.canInstallPackages()) {
        _set(UpdatePhase.needsPermission);
        return;
      }
      _set(UpdatePhase.installing);
      _installEvents ??= platform.installEvents.listen(_onInstallEvent);
      await platform.installApk(apk.path);
    } on PlatformException {
      _set(UpdatePhase.failed, why: UpdateProblem.installFailed);
    }
  }

  Future<void> openPermissionSettings() =>
      platform.openInstallPermissionSettings();

  /// Called when the app returns to the foreground.
  Future<void> onResumed() async {
    if (phase == UpdatePhase.needsPermission &&
        await platform.canInstallPackages()) {
      await continueInstall();
    }
  }

  void _onInstallEvent(Map<Object?, Object?> event) {
    if (phase != UpdatePhase.installing) return;
    switch (event['status']) {
      case 'cancelled':
        _set(UpdatePhase.failed, why: UpdateProblem.installCancelled);
      case 'failed':
        _set(UpdatePhase.failed, why: UpdateProblem.installFailed);
    }
    // 'pendingUser' and 'success' need nothing: Android's own screen is up, or
    // the system is replacing this app and will end this process itself.
  }

  void cancelDownload() => _cancel?.cancel();

  Future<void> _discardApk() async {
    final apk = _apk;
    _apk = null;
    if (apk != null && await apk.exists()) {
      await apk.delete().catchError((_) => apk);
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _cancel?.cancel();
    _installEvents?.cancel();
    super.dispose();
  }
}
