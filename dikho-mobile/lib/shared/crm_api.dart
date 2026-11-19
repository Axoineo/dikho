import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// A refusal or failure from the API, with the sentence to show the person.
class ApiException implements Exception {
  const ApiException(this.message, {this.status, this.code});

  final String message;
  final int? status;
  final String? code;

  @override
  String toString() => message;
}

/// The sentence to show for a failure. Only the API's own errors are worded for
/// people. Anything else, a platform error or a bug, gets a plain sentence and never
/// a class name.
String friendlyError(Object error, {String fallback = 'That did not work. Please try again.'}) => error is ApiException ? error.message : fallback;

/// The session belongs to the CRM page, which stays loaded behind the native
/// screens. When it has none (signed out, or the page is not up) no request can be
/// made, and a screen shows this like any other failure rather than an empty list.
class SessionUnavailable extends ApiException {
  const SessionUnavailable() : super('Your session is not available. Please try again in a moment.');
}

/// A file in a multipart form: the field it goes under, its name and type.
class FormFile {
  const FormFile({required this.field, required this.file, required this.filename, required this.mime});

  final String field;
  final File file;
  final String filename;
  final String mime;
}

/// The API Worker over HTTPS. Every request carries the session's current access
/// token, and the Worker checks it and the person's permissions each time; this
/// class decides nothing. Bodies are never logged.
class CrmApi {
  CrmApi({
    required this.origin,
    required this.token,
    HttpClient? httpClient,
    this.timeout = const Duration(seconds: 25),
    this.uploadTimeout = const Duration(minutes: 3),
  }) : _http = httpClient ?? HttpClient();

  final Uri origin;
  final Future<String> Function({bool forceFresh}) token;
  final Duration timeout;
  final Duration uploadTimeout;
  final HttpClient _http;

  static const _maxResponseBytes = 16 * 1024 * 1024;

  Uri _uri(String path, Map<String, String>? query) {
    final base = origin.resolve('/api$path');
    return query == null || query.isEmpty ? base : base.replace(queryParameters: query);
  }

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) => _json('GET', _uri(path, query));

  /// A GET whose data is a list (the people in User Management, the audit log).
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, String>? query}) async {
    final data = await _send('GET', _uri(path, query));
    return data is List ? data.whereType<Map<String, dynamic>>().toList() : const [];
  }

  Future<Map<String, dynamic>> post(String path, [Map<String, Object?>? body]) => _json('POST', _uri(path, null), body: body);

  /// Changes part of a record (a person's profile in User Management).
  Future<Map<String, dynamic>> patch(String path, Map<String, Object?> body) => _json('PATCH', _uri(path, null), body: body);

  /// Replaces a whole value (a person's permission changes).
  Future<Map<String, dynamic>> put(String path, Map<String, Object?> body) => _json('PUT', _uri(path, null), body: body);

  /// A DELETE, with a JSON body where the route takes one (deleting several contacts).
  /// Never repeated after a dropped connection, as for every write.
  Future<Map<String, dynamic>> delete(String path, [Map<String, Object?>? body]) => _json('DELETE', _uri(path, null), body: body);

  /// Sends a file from disk as multipart/form-data under "file".
  Future<Map<String, dynamic>> upload(
    String path, {
    required File file,
    required String filename,
    required String mime,
    Map<String, String> fields = const {},
  }) async {
    final boundary = 'dikho-${DateTime.now().microsecondsSinceEpoch}';
    final head = StringBuffer();
    fields.forEach((name, value) {
      head
        ..write('--$boundary\r\n')
        ..write('Content-Disposition: form-data; name="${_attribute(name)}"\r\n\r\n')
        ..write(value)
        ..write('\r\n');
    });
    head
      ..write('--$boundary\r\n')
      ..write('Content-Disposition: form-data; name="file"; filename="${_attribute(filename)}"\r\n')
      ..write('Content-Type: ${_attribute(mime)}\r\n\r\n');
    final headBytes = utf8.encode(head.toString());
    final tailBytes = utf8.encode('\r\n--$boundary--\r\n');
    final length = headBytes.length + await file.length() + tailBytes.length;

    return _authorized((bearer) async {
      final request = await _http.postUrl(_uri(path, null));
      request.headers
        ..set(HttpHeaders.authorizationHeader, 'Bearer $bearer')
        ..set(HttpHeaders.contentTypeHeader, 'multipart/form-data; boundary=$boundary')
        ..contentLength = length;
      request.add(headBytes);
      await request.addStream(file.openRead());
      request.add(tailBytes);
      return _read(await request.close());
    }, uploadTimeout);
  }

  /// multipart/form-data with several fields and any number of files, as the email
  /// composer's FormData. Never repeated after a dropped connection.
  Future<Map<String, dynamic>> sendForm(String method, String path, {required List<(String, String)> fields, List<FormFile> files = const []}) async {
    final boundary = 'dikho-${DateTime.now().microsecondsSinceEpoch}';
    final parts = <List<int>>[];
    final streams = <File>[];
    for (final (name, value) in fields) {
      parts.add(utf8.encode('--$boundary\r\nContent-Disposition: form-data; name="${_attribute(name)}"\r\n\r\n$value\r\n'));
    }
    var length = parts.fold<int>(0, (n, p) => n + p.length);
    final heads = <List<int>>[];
    for (final f in files) {
      final head = utf8.encode(
        '--$boundary\r\nContent-Disposition: form-data; name="${_attribute(f.field)}"; filename="${_attribute(f.filename)}"\r\n'
        'Content-Type: ${_attribute(f.mime)}\r\n\r\n',
      );
      heads.add(head);
      streams.add(f.file);
      length += head.length + await f.file.length() + 2;
    }
    final tail = utf8.encode('--$boundary--\r\n');
    length += tail.length;
    return _authorized((bearer) async {
      final request = await _http.openUrl(method, _uri(path, null));
      request.headers
        ..set(HttpHeaders.authorizationHeader, 'Bearer $bearer')
        ..set(HttpHeaders.contentTypeHeader, 'multipart/form-data; boundary=$boundary')
        ..contentLength = length;
      for (final p in parts) {
        request.add(p);
      }
      for (var i = 0; i < streams.length; i++) {
        request.add(heads[i]);
        await request.addStream(streams[i].openRead());
        request.add(const [13, 10]);
      }
      request.add(tail);
      return _read(await request.close());
    }, uploadTimeout);
  }

  /// A file the route sends as a download (an email attachment), written to [into]. At
  /// most [maxBytes]; anything bigger is refused and the partial file removed.
  Future<File> download(String path, {required File into, Map<String, String>? query, int maxBytes = 26 * 1024 * 1024}) {
    return _authorized((bearer) async {
      final request = await _http.getUrl(_uri(path, query));
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $bearer');
      final response = await request.close();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        // The route's error, worded for people, in the usual envelope.
        await _readData(response);
        throw ApiException('That did not work (${response.statusCode}). Please try again.', status: response.statusCode);
      }
      if (response.contentLength > maxBytes) throw const ApiException('This file is too large to download here.');
      final sink = into.openWrite();
      var total = 0;
      try {
        await for (final chunk in response) {
          total += chunk.length;
          if (total > maxBytes) throw const ApiException('This file is too large to download here.');
          sink.add(chunk);
        }
        await sink.close();
        return into;
      } on Object {
        await sink.close();
        if (await into.exists()) await into.delete();
        rethrow;
      }
    }, uploadTimeout);
  }

  // Quotes and line breaks in a name would otherwise end the header early.
  static String _attribute(String value) => value.replaceAll(RegExp(r'[\r\n"]'), '_');

  Future<Map<String, dynamic>> _json(String method, Uri uri, {Map<String, Object?>? body}) async {
    final data = await _send(method, uri, body: body);
    return data is Map<String, dynamic> ? data : const {};
  }

  /// The response's `data`, whatever its shape.
  Future<Object?> _send(String method, Uri uri, {Map<String, Object?>? body}) {
    Future<Object?> send(String bearer) async {
      final request = await _http.openUrl(method, uri);
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $bearer');
      if (body != null) {
        final bytes = utf8.encode(jsonEncode(body));
        request.headers
          ..contentType = ContentType.json
          ..contentLength = bytes.length;
        request.add(bytes);
      }
      return _readData(await request.close());
    }

    return _authorized((bearer) async {
      try {
        return await send(bearer);
      } on IOException {
        // A connection left idle can be gone by the time it is reused, which a phone
        // moving between networks meets often. Asking again is safe for a read. A
        // POST is never repeated here: it could send a message twice.
        if (method != 'GET') rethrow;
        return send(bearer);
      }
    }, timeout);
  }

  /// One retry with a fresh token when the Worker says the one sent has expired.
  Future<T> _authorized<T>(Future<T> Function(String bearer) send, Duration limit) async {
    try {
      try {
        return await send(await token()).timeout(limit);
      } on ApiException catch (error) {
        if (error.status != HttpStatus.unauthorized) rethrow;
        return await send(await token(forceFresh: true)).timeout(limit);
      }
    } on TimeoutException {
      throw const ApiException('The server took too long to answer. Please try again.');
    } on IOException {
      throw const ApiException('Could not reach the server. Check your connection and try again.');
    }
  }

  Future<Map<String, dynamic>> _read(HttpClientResponse response) async {
    final data = await _readData(response);
    return data is Map<String, dynamic> ? data : const {};
  }

  Future<Object?> _readData(HttpClientResponse response) async {
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in response) {
      bytes.add(chunk);
      if (bytes.length > _maxResponseBytes) {
        throw const ApiException('The server sent more than expected.');
      }
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(utf8.decode(bytes.takeBytes()));
    } on FormatException {
      throw ApiException('Something went wrong on the server (${response.statusCode}).', status: response.statusCode);
    }
    final map = decoded is Map<String, dynamic> ? decoded : const <String, dynamic>{};
    if (response.statusCode >= 200 && response.statusCode < 300 && map['success'] != false) {
      return map['data'];
    }
    final error = map['error'];
    final message = error is Map && error['message'] is String ? error['message'] as String : null;
    throw ApiException(
      message ?? 'That did not work (${response.statusCode}). Please try again.',
      status: response.statusCode,
      code: error is Map && error['code'] is String ? error['code'] as String : null,
    );
  }

  void close() => _http.close(force: true);
}
