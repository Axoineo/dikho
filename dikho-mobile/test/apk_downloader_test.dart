import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dikho_crm/features/updater/apk_downloader.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final payload = List<int>.generate(256 * 1024, (i) => i % 251);
  final goodHash = sha256.convert(payload).toString();

  late HttpServer server;
  late Directory dir;
  late File target;
  late void Function(HttpRequest) respond;
  int hits = 0;

  setUp(() async {
    hits = 0;
    dir = Directory.systemTemp.createTempSync('apk');
    target = File('${dir.path}/updates/app.apk');
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) {
      hits++;
      respond(request);
    });
  });

  tearDown(() async {
    await server.close(force: true);
    dir.deleteSync(recursive: true);
  });

  Uri url([String path = '/app.apk']) =>
      Uri.parse('http://127.0.0.1:${server.port}$path');

  ApkDownloader downloader({Duration idle = const Duration(seconds: 2)}) =>
      ApkDownloader(
        idleTimeout: idle,
        isAllowedRedirect: (uri) => uri.host == '127.0.0.1',
      );

  Future<File> run({
    ApkDownloader? with_,
    String? hash,
    int? size,
    DownloadCancelToken? cancel,
    void Function(int, int)? onProgress,
  }) => (with_ ?? downloader()).download(
    url: url(),
    expectedSha256: hash ?? goodHash,
    expectedSize: size ?? payload.length,
    target: target,
    cancel: cancel ?? DownloadCancelToken(),
    onProgress: onProgress ?? (_, _) {},
  );

  void servePayload(HttpRequest request) {
    request.response
      ..contentLength = payload.length
      ..add(payload)
      ..close();
  }

  Matcher failsWith(DownloadFailure failure) => throwsA(
    isA<DownloadException>().having((e) => e.failure, 'failure', failure),
  );

  /// No partial or final file may survive a failed download.
  void expectNothingLeft() {
    expect(target.existsSync(), isFalse, reason: 'final file left behind');
    expect(
      File('${target.path}.part').existsSync(),
      isFalse,
      reason: 'part file left behind',
    );
  }

  test('a good download reports progress and verifies', () async {
    respond = servePayload;
    final seen = <int>[];
    final file = await run(onProgress: (received, _) => seen.add(received));
    expect(await file.readAsBytes(), payload);
    expect(seen.last, payload.length);
    expect(seen, orderedEquals([...seen]..sort()));
    expect(File('${target.path}.part').existsSync(), isFalse);
  });

  test('a checksum mismatch is rejected and deleted', () async {
    respond = servePayload;
    await expectLater(
      run(hash: 'b' * 64),
      failsWith(DownloadFailure.checksumMismatch),
    );
    expectNothingLeft();
  });

  test(
    'a file of the wrong declared size is rejected before reading it',
    () async {
      respond = servePayload;
      await expectLater(
        run(size: payload.length - 1),
        failsWith(DownloadFailure.sizeMismatch),
      );
      expectNothingLeft();
    },
  );

  test(
    'a body longer than advertised is cut off, with no declared length',
    () async {
      respond = (request) {
        request.response
          ..add(payload)
          ..close();
      };
      await expectLater(
        run(size: 1024),
        failsWith(DownloadFailure.sizeMismatch),
      );
      expectNothingLeft();
    },
  );

  test('a body shorter than advertised is rejected', () async {
    respond = (request) {
      request.response
        ..add(payload.sublist(0, 1024))
        ..close();
    };
    await expectLater(run(), failsWith(DownloadFailure.sizeMismatch));
    expectNothingLeft();
  });

  test('an interrupted download fails cleanly', () async {
    respond = (request) async {
      // Claims the whole file, sends a fragment, then drops the connection.
      final socket = await request.response.detachSocket(writeHeaders: false);
      socket.write(
        'HTTP/1.1 200 OK\r\nContent-Length: ${payload.length}\r\n\r\n',
      );
      socket.add(payload.sublist(0, 1024));
      await socket.flush();
      socket.destroy();
    };
    await expectLater(run(), failsWith(DownloadFailure.network));
    expectNothingLeft();
  });

  test('a stalled download times out', () async {
    respond = (request) async {
      request.response.bufferOutput = false;
      request.response.contentLength = payload.length;
      request.response.add(payload.sublist(0, 1024));
      await request.response.flush();
    };
    await expectLater(
      run(with_: downloader(idle: const Duration(milliseconds: 200))),
      failsWith(DownloadFailure.network),
    );
    expectNothingLeft();
  });

  test('cancelling stops the download and leaves nothing', () async {
    respond = (request) async {
      request.response.bufferOutput = false;
      request.response.contentLength = payload.length;
      request.response.add(payload.sublist(0, 1024));
      await request.response.flush();
    };
    final cancel = DownloadCancelToken();
    final future = run(cancel: cancel, onProgress: (_, _) => cancel.cancel());
    await expectLater(future, throwsA(isA<DownloadCancelled>()));
    expectNothingLeft();
  });

  test('a failed TLS handshake is a clean network failure', () async {
    respond = servePayload;
    // An https request to a plain http server, which can only fail the handshake.
    final future = downloader().download(
      url: Uri.parse('https://127.0.0.1:${server.port}/app.apk'),
      expectedSha256: goodHash,
      expectedSize: payload.length,
      target: target,
      cancel: DownloadCancelToken(),
      onProgress: (_, _) {},
    );
    await expectLater(future, failsWith(DownloadFailure.network));
    expectNothingLeft();
  });

  test('an error status is rejected', () async {
    respond = (request) {
      request.response
        ..statusCode = 404
        ..close();
    };
    await expectLater(run(), failsWith(DownloadFailure.badResponse));
    expectNothingLeft();
  });

  test('a redirect to a disallowed address is refused', () async {
    respond = (request) {
      request.response.redirect(Uri.parse('http://evil.example/app.apk'));
    };
    await expectLater(run(), failsWith(DownloadFailure.badRedirect));
    expectNothingLeft();
  });

  test('a redirect loop is refused', () async {
    respond = (request) {
      request.response.redirect(url());
    };
    await expectLater(run(), failsWith(DownloadFailure.badRedirect));
    expect(hits, lessThanOrEqualTo(6));
    expectNothingLeft();
  });

  test('an allowed redirect is followed', () async {
    respond = (request) {
      if (request.uri.path == '/app.apk') {
        request.response.redirect(url('/moved.apk'));
      } else {
        servePayload(request);
      }
    };
    expect(await (await run()).readAsBytes(), payload);
  });

  test('a verified copy is reused rather than downloaded again', () async {
    respond = servePayload;
    await run();
    final before = hits;
    await run();
    expect(hits, before);
  });

  test('a damaged leftover is replaced', () async {
    respond = servePayload;
    target.parent.createSync(recursive: true);
    target.writeAsBytesSync([1, 2, 3]);
    expect(await (await run()).readAsBytes(), payload);
  });
}
