import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/updater/update_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late HttpServer server;
  late void Function(HttpRequest) respond;
  Uri? lastUri;
  Map<String, String> lastHeaders = {};

  setUp(() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) {
      lastUri = request.uri;
      lastHeaders = {};
      request.headers.forEach(
        (name, values) => lastHeaders[name] = values.join(','),
      );
      respond(request);
    });
  });
  tearDown(() => server.close(force: true));

  UpdateClient client({Duration timeout = const Duration(seconds: 2)}) =>
      UpdateClient(
        baseUrl: Uri.parse('http://127.0.0.1:${server.port}'),
        appId: 'in.dikho.crm',
        timeout: timeout,
        isAllowedApkUrl: (uri) => uri.scheme == 'https',
      );

  void json(HttpRequest request, Object body, {int status = 200}) {
    request.response
      ..statusCode = status
      ..write(jsonEncode(body))
      ..close();
  }

  test('no update', () async {
    respond = (r) => json(r, {'updateAvailable': false});
    expect(await client().check(1), isA<NoUpdate>());
  });

  test('sends only the app, version, channel and platform', () async {
    respond = (r) => json(r, {'updateAvailable': false});
    await client().check(7);
    expect(lastUri!.path, '/api/update');
    expect(lastUri!.queryParameters, {
      'appId': 'in.dikho.crm',
      'versionCode': '7',
      'channel': 'stable',
      'platform': 'android',
    });
    expect(lastHeaders.containsKey('authorization'), isFalse);
    expect(lastHeaders.containsKey('cookie'), isFalse);
  });

  test('update available', () async {
    respond = (r) => json(r, {
      'updateAvailable': true,
      'version': '1.1.0',
      'versionCode': 2,
      'mandatory': false,
      'releaseNotes': '',
      'apkUrl': 'https://updates.example.test/a.apk',
      'sha256': 'a' * 64,
      'sizeBytes': 10,
      'publishedAt': '2026-11-04T00:00:00Z',
    });
    final result = await client().check(1);
    expect(result, isA<UpdateAvailable>());
    expect((result as UpdateAvailable).info.versionCode, 2);
  });

  test('every failure becomes CheckFailed, never an exception', () async {
    final cases = <void Function(HttpRequest)>[
      (r) => json(r, {'error': 'release_metadata_invalid'}, status: 500),
      (r) => json(r, {'error': 'invalid_version_code'}, status: 400),
      (r) => r.response
        ..write('not json')
        ..close(),
      (r) => json(r, {'updateAvailable': 'maybe'}),
      (r) => json(r, {'updateAvailable': true, 'version': 'bad'}),
      (r) => r.response
        ..write('x' * (64 * 1024))
        ..close(),
      (r) => r.response.redirect(Uri.parse('https://evil.example/')),
    ];
    for (final (index, handler) in cases.indexed) {
      respond = handler;
      expect(
        await client().check(1),
        isA<CheckFailed>(),
        reason: 'case $index',
      );
    }
  });

  test('a server that never answers times out', () async {
    respond = (_) {};
    final result = await client(timeout: const Duration(milliseconds: 200))
        .check(1);
    expect(result, isA<CheckFailed>());
    expect((result as CheckFailed).reason, 'timeout');
  });

  test('a refused connection is a failed check', () async {
    final closed = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final port = closed.port;
    await closed.close(force: true);
    final result = await UpdateClient(
      baseUrl: Uri.parse('http://127.0.0.1:$port'),
      appId: 'in.dikho.crm',
      isAllowedApkUrl: (_) => true,
    ).check(1);
    expect(result, isA<CheckFailed>());
  });
}
