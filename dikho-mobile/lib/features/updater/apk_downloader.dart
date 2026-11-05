import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart';

enum DownloadFailure {
  /// The connection dropped or timed out.
  network,

  /// The server answered something other than the file.
  badResponse,

  /// A redirect tried to leave HTTPS or looped.
  badRedirect,

  /// The file was not the advertised size.
  sizeMismatch,

  /// The file's SHA-256 did not match.
  checksumMismatch,

  /// The device could not store it.
  storage,
}

class DownloadException implements Exception {
  const DownloadException(this.failure);
  final DownloadFailure failure;

  @override
  String toString() => 'DownloadException($failure)';
}

class DownloadCancelled implements Exception {
  const DownloadCancelled();
}

class DownloadCancelToken {
  final _completer = Completer<void>();

  bool get isCancelled => _completer.isCompleted;
  Future<void> get whenCancelled => _completer.future;

  void cancel() {
    if (!_completer.isCompleted) _completer.complete();
  }
}

/// Streams an APK to app-private storage, hashing as it goes. The final file
/// only exists once its size and SHA-256 have both been verified.
class ApkDownloader {
  ApkDownloader({
    required this.isAllowedRedirect,
    this.idleTimeout = const Duration(seconds: 30),
    HttpClient? httpClient,
  }) : _http = httpClient ?? HttpClient();

  /// Applied to every hop, so a redirect cannot leave HTTPS.
  final bool Function(Uri) isAllowedRedirect;
  final Duration idleTimeout;
  final HttpClient _http;

  static const _maxRedirects = 5;

  Future<File> download({
    required Uri url,
    required String expectedSha256,
    required int expectedSize,
    required File target,
    required void Function(int received, int total) onProgress,
    required DownloadCancelToken cancel,
  }) async {
    final part = File('${target.path}.part');
    IOSink? sink;
    HttpClientRequest? activeRequest;
    unawaited(cancel.whenCancelled.then((_) => activeRequest?.abort()));

    try {
      await target.parent.create(recursive: true);
      if (await target.exists()) {
        // A verified copy survives a cancelled installer, so retrying does not
        // spend the data again.
        if (await _matches(target, expectedSha256, expectedSize)) {
          onProgress(expectedSize, expectedSize);
          return target;
        }
        await target.delete();
      }

      final response = await _open(
        url,
        cancel,
        (request) => activeRequest = request,
      );
      final declared = response.contentLength;
      if (declared >= 0 && declared != expectedSize) {
        activeRequest?.abort();
        throw const DownloadException(DownloadFailure.sizeMismatch);
      }

      sink = part.openWrite();
      final digestSink = _DigestSink();
      final hasher = sha256.startChunkedConversion(digestSink);
      var received = 0;

      // A subscription rather than await-for, so Cancel takes effect at once
      // even when the connection has stalled and no chunk is coming.
      final finished = Completer<void>();
      final open = sink;
      late final StreamSubscription<List<int>> subscription;
      void stop(Object why) {
        if (finished.isCompleted) return;
        unawaited(subscription.cancel());
        activeRequest?.abort();
        finished.completeError(why);
      }

      subscription = response
          .timeout(idleTimeout)
          .listen(
            (chunk) {
              if (finished.isCompleted) return;
              received += chunk.length;
              if (received > expectedSize) {
                stop(const DownloadException(DownloadFailure.sizeMismatch));
                return;
              }
              open.add(chunk);
              hasher.add(chunk);
              onProgress(received, expectedSize);
            },
            onError: (Object error) {
              if (!finished.isCompleted) finished.completeError(error);
            },
            onDone: () {
              if (!finished.isCompleted) finished.complete();
            },
            cancelOnError: true,
          );
      unawaited(
        cancel.whenCancelled.then((_) => stop(const DownloadCancelled())),
      );
      await finished.future;
      if (cancel.isCancelled) throw const DownloadCancelled();

      await sink.flush();
      await sink.close();
      sink = null;
      hasher.close();

      if (received != expectedSize) {
        throw const DownloadException(DownloadFailure.sizeMismatch);
      }
      if (digestSink.value.toString() != expectedSha256) {
        throw const DownloadException(DownloadFailure.checksumMismatch);
      }
      return await part.rename(target.path);
    } on DownloadException {
      rethrow;
    } on DownloadCancelled {
      rethrow;
    } on TimeoutException {
      if (cancel.isCancelled) throw const DownloadCancelled();
      throw const DownloadException(DownloadFailure.network);
    } on FileSystemException {
      throw const DownloadException(DownloadFailure.storage);
    } on IOException {
      // Sockets, HTTP and TLS alike. Anything uncaught here would leave the
      // dialog waiting forever on a download that has already ended.
      if (cancel.isCancelled) throw const DownloadCancelled();
      throw const DownloadException(DownloadFailure.network);
    } finally {
      await sink?.close().catchError((_) {});
      if (await part.exists()) await part.delete().catchError((_) => part);
    }
  }

  static Future<bool> _matches(File file, String hash, int size) async {
    if (await file.length() != size) return false;
    return (await sha256.bind(file.openRead()).first).toString() == hash;
  }

  Future<HttpClientResponse> _open(
    Uri start,
    DownloadCancelToken cancel,
    void Function(HttpClientRequest) onRequest,
  ) async {
    var url = start;
    for (var hop = 0; hop <= _maxRedirects; hop++) {
      if (!isAllowedRedirect(url)) {
        throw const DownloadException(DownloadFailure.badRedirect);
      }
      if (cancel.isCancelled) throw const DownloadCancelled();
      final request = await _http.getUrl(url).timeout(idleTimeout);
      request.followRedirects = false;
      onRequest(request);
      final response = await request.close().timeout(idleTimeout);
      if (response.isRedirect) {
        final location = response.headers.value(HttpHeaders.locationHeader);
        await response.drain<void>();
        final next = location == null ? null : url.resolve(location);
        if (next == null) {
          throw const DownloadException(DownloadFailure.badRedirect);
        }
        url = next;
        continue;
      }
      if (response.statusCode != HttpStatus.ok) {
        await response.drain<void>();
        throw const DownloadException(DownloadFailure.badResponse);
      }
      return response;
    }
    throw const DownloadException(DownloadFailure.badRedirect);
  }

  void close() => _http.close(force: true);
}

class _DigestSink implements Sink<Digest> {
  Digest? value;

  @override
  void add(Digest data) => value = data;

  @override
  void close() {}
}
