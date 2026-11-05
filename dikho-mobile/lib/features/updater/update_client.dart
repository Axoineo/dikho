import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'update_info.dart';

sealed class UpdateCheckResult {
  const UpdateCheckResult();
}

class NoUpdate extends UpdateCheckResult {
  const NoUpdate();
}

class UpdateAvailable extends UpdateCheckResult {
  const UpdateAvailable(this.info);
  final UpdateInfo info;
}

/// The check could not be completed. Never surfaced to the user: the app simply
/// carries on and tries again later.
class CheckFailed extends UpdateCheckResult {
  const CheckFailed(this.reason);
  final String reason;
}

class UpdateClient {
  UpdateClient({
    required this.baseUrl,
    required this.appId,
    required this.isAllowedApkUrl,
    this.channel = 'stable',
    this.timeout = const Duration(seconds: 8),
    HttpClient? httpClient,
  }) : _http = httpClient ?? HttpClient();

  final Uri baseUrl;
  final String appId;
  final String channel;
  final Duration timeout;
  final bool Function(Uri) isAllowedApkUrl;
  final HttpClient _http;

  static const _maxResponseBytes = 16 * 1024;

  /// Sends only the app ID, installed version code, channel and platform. No
  /// account, token or device identifier leaves the device for this.
  Future<UpdateCheckResult> check(int installedVersionCode) async {
    final uri = baseUrl
        .resolve('/api/update')
        .replace(
          queryParameters: {
            'appId': appId,
            'versionCode': '$installedVersionCode',
            'channel': channel,
            'platform': 'android',
          },
        );
    try {
      final body = await _fetch(uri).timeout(timeout);
      final info = UpdateInfo.parse(
        jsonDecode(body),
        installedVersionCode: installedVersionCode,
        isAllowedApkUrl: isAllowedApkUrl,
      );
      return info == null ? const NoUpdate() : UpdateAvailable(info);
    } on TimeoutException {
      return const CheckFailed('timeout');
    } on FormatException catch (error) {
      return CheckFailed('malformed response: ${error.message}');
    } on IOException catch (error) {
      return CheckFailed('network: ${error.runtimeType}');
    } on _BadStatus catch (error) {
      return CheckFailed('status ${error.status}');
    }
  }

  Future<String> _fetch(Uri uri) async {
    _http.connectionTimeout = timeout;
    final request = await _http.getUrl(uri);
    // The endpoint never redirects, so one that does is not the endpoint.
    request.followRedirects = false;
    final response = await request.close();
    if (response.statusCode != HttpStatus.ok) {
      await response.drain<void>();
      throw _BadStatus(response.statusCode);
    }
    final bytes = <int>[];
    await for (final chunk in response) {
      bytes.addAll(chunk);
      if (bytes.length > _maxResponseBytes) {
        throw const FormatException('response is too large');
      }
    }
    return utf8.decode(bytes);
  }

  void close() => _http.close(force: true);
}

class _BadStatus implements Exception {
  const _BadStatus(this.status);
  final int status;
}
