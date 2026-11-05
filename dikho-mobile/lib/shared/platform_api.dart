import 'dart:async';

import 'package:flutter/services.dart';

class AppInfo {
  const AppInfo({
    required this.versionName,
    required this.versionCode,
    required this.sdkInt,
    required this.webViewMajor,
    required this.filesDir,
    required this.cacheDir,
  });

  factory AppInfo.fromMap(Map<Object?, Object?> map) => AppInfo(
    versionName: map['versionName']! as String,
    versionCode: map['versionCode']! as int,
    sdkInt: map['sdkInt']! as int,
    webViewMajor: map['webViewMajor']! as int,
    filesDir: map['filesDir']! as String,
    cacheDir: map['cacheDir']! as String,
  );

  final String versionName;
  final int versionCode;
  final int sdkInt;

  /// 0 when the WebView package could not be identified.
  final int webViewMajor;
  final String filesDir;
  final String cacheDir;
}

/// What the updater needs from Android. An interface so the update flow can be
/// tested without a device.
abstract class UpdaterPlatform {
  /// Null when the APK is this app, the expected version and the same signer.
  /// Otherwise a short reason.
  Future<String?> verifyApk(String path, int versionCode);
  Future<bool> canInstallPackages();
  Future<void> openInstallPermissionSettings();
  Future<void> installApk(String path);
  Stream<Map<Object?, Object?>> get installEvents;
}

/// The one channel to native code. Every method is narrow on purpose: the page
/// cannot reach any of this directly, only through the checks in CrmScreen and
/// the origin-pinned message listener in WebViewBridge.kt.
class PlatformApi implements UpdaterPlatform {
  PlatformApi();

  static const _methods = MethodChannel('in.dikho.crm/platform');
  static const _eventChannel = EventChannel('in.dikho.crm/events');

  late final Stream<Map<Object?, Object?>> events = _eventChannel
      .receiveBroadcastStream()
      .map((event) => event as Map<Object?, Object?>)
      .asBroadcastStream();

  @override
  Stream<Map<Object?, Object?>> get installEvents =>
      events.where((event) => event['type'] == 'installStatus');

  Future<AppInfo> appInfo() async => AppInfo.fromMap(
    (await _methods.invokeMethod<Map<Object?, Object?>>('getAppInfo'))!,
  );

  Future<String?> initialLink() =>
      _methods.invokeMethod<String>('getInitialLink');

  /// False when the WebView lacks the features the bridge is built on.
  Future<bool> attachWebView(
    int id,
    String origin, {
    bool forceSaveDialog = false,
  }) async =>
      await _methods.invokeMethod<bool>('attachWebView', {
        'id': id,
        'origin': origin,
        'forceSaveDialog': forceSaveDialog,
      }) ??
      false;

  Future<bool> openExternal(String url) async =>
      await _methods.invokeMethod<bool>('openExternal', {'url': url}) ?? false;

  Future<List<String>> pickFiles(
    List<String> acceptTypes,
    bool multiple,
  ) async {
    final picked = await _methods.invokeListMethod<String>('pickFiles', {
      'acceptTypes': acceptTypes,
      'multiple': multiple,
    });
    return picked ?? const [];
  }

  /// Fetches a signed or ticketed link natively. The result arrives as an event.
  Future<void> fetchFile({
    required String url,
    required bool view,
    String? name,
    String? mime,
    String? contentDisposition,
  }) => _methods.invokeMethod('fetchFile', {
    'url': url,
    'view': view,
    'name': name,
    'mime': mime,
    'contentDisposition': contentDisposition,
  });

  Future<bool> openFile(String uri, String mime) async =>
      await _methods.invokeMethod<bool>('openFile', {
        'uri': uri,
        'mime': mime,
      }) ??
      false;

  Future<bool> shareFile(String uri, String mime) async =>
      await _methods.invokeMethod<bool>('shareFile', {
        'uri': uri,
        'mime': mime,
      }) ??
      false;

  @override
  Future<String?> verifyApk(String path, int versionCode) =>
      _methods.invokeMethod<String>('verifyApk', {
        'path': path,
        'versionCode': versionCode,
      });

  @override
  Future<bool> canInstallPackages() async =>
      await _methods.invokeMethod<bool>('canInstallPackages') ?? false;

  @override
  Future<void> openInstallPermissionSettings() =>
      _methods.invokeMethod('openInstallPermissionSettings');

  @override
  Future<void> installApk(String path) =>
      _methods.invokeMethod('installApk', {'path': path});
}
