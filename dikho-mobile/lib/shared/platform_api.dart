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

class PickedFile {
  const PickedFile({this.path, this.name = '', this.mime = '', this.size = 0, this.tooLarge = false});

  factory PickedFile.fromMap(Map<String, Object?> map) => PickedFile(
    path: map['path'] as String?,
    name: map['name'] as String? ?? 'file',
    mime: map['mime'] as String? ?? 'application/octet-stream',
    size: map['size'] as int? ?? 0,
    tooLarge: map['tooLarge'] == true,
  );

  final String? path;
  final String name;
  final String mime;
  final int size;
  final bool tooLarge;
}

class VoiceRecording {
  const VoiceRecording({required this.path, required this.mime, required this.filename, required this.voice, required this.durationMs});

  factory VoiceRecording.fromMap(Map<String, Object?> map) => VoiceRecording(
    path: map['path']! as String,
    mime: map['mime']! as String,
    filename: map['filename']! as String,
    voice: map['voice'] == true,
    durationMs: map['durationMs'] as int? ?? 0,
  );

  final String path;
  final String mime;
  final String filename;

  /// False on phones older than Android 10, whose recordings go as plain audio.
  final bool voice;
  final int durationMs;
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
  Stream<Map<Object?, Object?>> get installEvents => events.where((event) => event['type'] == 'installStatus');

  Future<AppInfo> appInfo() async => AppInfo.fromMap((await _methods.invokeMethod<Map<Object?, Object?>>('getAppInfo'))!);

  Future<String?> initialLink() => _methods.invokeMethod<String>('getInitialLink');

  /// False when the WebView lacks the features the bridge is built on.
  Future<bool> attachWebView(int id, String origin, {bool forceSaveDialog = false}) async =>
      await _methods.invokeMethod<bool>('attachWebView', {'id': id, 'origin': origin, 'forceSaveDialog': forceSaveDialog}) ?? false;

  Future<bool> openExternal(String url) async => await _methods.invokeMethod<bool>('openExternal', {'url': url}) ?? false;

  Future<List<String>> pickFiles(List<String> acceptTypes, bool multiple) async {
    final picked = await _methods.invokeListMethod<String>('pickFiles', {'acceptTypes': acceptTypes, 'multiple': multiple});
    return picked ?? const [];
  }

  /// Fetches a signed or ticketed link natively. The result arrives as an event.
  Future<void> fetchFile({required String url, required bool view, String? name, String? mime, String? contentDisposition}) =>
      _methods.invokeMethod('fetchFile', {'url': url, 'view': view, 'name': name, 'mime': mime, 'contentDisposition': contentDisposition});

  /// Draws a tax invoice onto the CRM's template (TaxInvoice.kt) from texts laid out
  /// by taxInvoiceLayout, into the transfer folder. Its path, or null when it failed.
  Future<String?> makeTaxInvoice(List<Map<String, Object>> texts) => _methods.invokeMethod<String>('makeTaxInvoice', {'texts': texts});

  /// Saves (or, with [view], opens) a file this app downloaded into its own transfer
  /// folder (`<cacheDir>/transfers`). Progress and the outcome arrive as file events.
  Future<void> keepFile({required String path, required bool view, required String name, String? mime}) =>
      _methods.invokeMethod('keepFile', {'path': path, 'view': view, 'name': name, 'mime': mime});

  Future<bool> openFile(String uri, String mime) async => await _methods.invokeMethod<bool>('openFile', {'uri': uri, 'mime': mime}) ?? false;

  Future<bool> shareFile(String uri, String mime) async => await _methods.invokeMethod<bool>('shareFile', {'uri': uri, 'mime': mime}) ?? false;

  /// Names and numbers from the phone's contacts, as [name, number, name, ...].
  /// Empty without the permission.
  Future<List<String>> readContacts() async => await _methods.invokeListMethod<String>('readContacts') ?? const [];

  /// "call" when it dialled, "dial" when the dialer opened instead, null on failure.
  Future<String?> placeCall(String number) => _methods.invokeMethod<String>('placeCall', {'number': number});

  /// Copies a picked document to private storage.
  Future<PickedFile?> copyPicked(String uri) async {
    final map = await _methods.invokeMapMethod<String, Object?>('copyPicked', {'uri': uri});
    return map == null ? null : PickedFile.fromMap(map);
  }

  Future<bool> voiceStart() async => await _methods.invokeMethod<bool>('voiceStart') ?? false;

  Future<VoiceRecording?> voiceStop() async {
    final map = await _methods.invokeMapMethod<String, Object?>('voiceStop');
    return map == null ? null : VoiceRecording.fromMap(map);
  }

  Future<void> voiceCancel() => _methods.invokeMethod('voiceCancel');

  Future<void> audioPlay(String id, String path) => _methods.invokeMethod('audioPlay', {'id': id, 'path': path});
  Future<void> audioPause() => _methods.invokeMethod('audioPause');
  Future<void> audioSeek(int ms) => _methods.invokeMethod('audioSeek', {'ms': ms});
  Future<void> audioStop() => _methods.invokeMethod('audioStop');

  /// Answers one of the page's session storage requests.
  Future<void> answerVault(int id, String? value) => _methods.invokeMethod('answerVault', {'id': id, 'value': value});

  /// Keeps part of the left screen edge for the drawer's swipe. See the Kotlin.
  Future<void> setEdgeSwipe({required bool enabled}) => _methods.invokeMethod('setEdgeSwipe', {'enabled': enabled});

  @override
  Future<String?> verifyApk(String path, int versionCode) => _methods.invokeMethod<String>('verifyApk', {'path': path, 'versionCode': versionCode});

  @override
  Future<bool> canInstallPackages() async => await _methods.invokeMethod<bool>('canInstallPackages') ?? false;

  @override
  Future<void> openInstallPermissionSettings() => _methods.invokeMethod('openInstallPermissionSettings');

  @override
  Future<void> installApk(String path) => _methods.invokeMethod('installApk', {'path': path});
}
