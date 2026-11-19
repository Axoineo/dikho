import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import '../app/app_config.dart';
import 'crm_api.dart';

/// One page of rows, and how many match in all when that was asked for.
class RestPage {
  const RestPage({required this.rows, this.total});

  final List<Map<String, dynamic>> rows;
  final int? total;
}

/// Reads and writes tables through Supabase's REST API with the signed-in person's own
/// access token, exactly as the CRM page's supabase-js does. RLS decides what comes back
/// and what may change, so this can never do more than the page could.
class SupabaseRest {
  SupabaseRest({required this.base, required this.apiKey, required this.token, HttpClient? httpClient, this.timeout = const Duration(seconds: 25)})
    : _http = httpClient ?? HttpClient();

  final Uri base;

  /// The publishable key, public by design: it only identifies the project.
  final String apiKey;
  final Future<String> Function({bool forceFresh}) token;
  final Duration timeout;
  final HttpClient _http;

  static const _maxResponseBytes = 8 * 1024 * 1024;

  /// The project address as the page reported it, or null when it is not one this
  /// app may send a token to: https only, or the local test server in a test build.
  static Uri? parseBase(String value, {bool localTest = AppConfig.localTestBuild}) {
    final uri = Uri.tryParse(value);
    if (uri == null || !uri.hasAuthority || uri.userInfo.isNotEmpty) return null;
    if (uri.scheme == 'https') return uri;
    if (localTest && uri.scheme == 'http' && uri.host == 'localhost') return uri;
    return null;
  }

  /// Rows [from] to [to] inclusive, in PostgREST's own query language.
  Future<RestPage> select(String table, {required Map<String, String> query, required int from, required int to, bool countAll = false}) {
    final uri = base.replace(path: '/rest/v1/$table', queryParameters: query);
    return _authorized(retryDropped: true, (bearer) async {
      final (response, body) = await _send(
        'GET',
        uri,
        bearer,
        headers: {'Range-Unit': 'items', 'Range': '$from-$to', if (countAll) 'Prefer': 'count=exact'},
      );
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final decoded = jsonDecode(body);
        final rows = decoded is List ? decoded.whereType<Map<String, dynamic>>().toList() : <Map<String, dynamic>>[];
        return RestPage(rows: rows, total: totalFrom(response.headers.value('content-range')));
      }
      throw _failure(response.statusCode, reading: true);
    });
  }

  /// A new row, as the database stored it. RLS decides whether it may be added. Never
  /// sent twice: after a dropped connection the row may already exist.
  Future<Map<String, dynamic>> insert(String table, Map<String, Object?> row) {
    final uri = base.replace(path: '/rest/v1/$table', queryParameters: {'select': '*'});
    return _authorized(retryDropped: false, (bearer) => _writeOne('POST', uri, bearer, row));
  }

  /// Changes the one row with this id, and returns it as stored. When RLS lets nothing
  /// change, PostgREST finds no row, and this says so rather than pretending it saved.
  Future<Map<String, dynamic>> update(String table, {required Object id, required Map<String, Object?> patch}) {
    final uri = base.replace(path: '/rest/v1/$table', queryParameters: {'id': 'eq.$id', 'select': '*'});
    return _authorized(retryDropped: false, (bearer) => _writeOne('PATCH', uri, bearer, patch));
  }

  /// Several new rows in one request, so they are all added or none are.
  Future<List<Map<String, dynamic>>> insertMany(String table, List<Map<String, Object?>> rows) {
    final uri = base.replace(path: '/rest/v1/$table', queryParameters: {'select': '*'});
    return _authorized(retryDropped: false, (bearer) async {
      final (response, body) = await _send('POST', uri, bearer, list: rows, headers: {'Prefer': 'return=representation'});
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final decoded = jsonDecode(body);
        if (decoded is List && decoded.length == rows.length) return decoded.whereType<Map<String, dynamic>>().toList();
        throw const ApiException('The server sent something unexpected. Please try again.');
      }
      throw _failure(response.statusCode, reading: false);
    });
  }

  /// Deletes the rows with these ids and returns the ids that went. RLS may let fewer
  /// go than were asked for, without any error, so the caller compares.
  Future<Set<String>> deleteIds(String table, List<Object> ids) {
    if (ids.isEmpty) return Future.value(const {});
    final list = ids.map((id) => '$id').toList();
    if (list.any((id) => !RegExp(r'^\d{1,18}$').hasMatch(id))) throw ArgumentError('Ids must be whole numbers.');
    final uri = base.replace(path: '/rest/v1/$table', queryParameters: {'id': 'in.(${list.join(',')})', 'select': 'id'});
    return _authorized(retryDropped: false, (bearer) async {
      final (response, body) = await _send('DELETE', uri, bearer, headers: {'Prefer': 'return=representation'});
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final decoded = body.isEmpty ? const [] : jsonDecode(body);
        return {
          if (decoded is List)
            for (final row in decoded.whereType<Map>()) '${row['id']}',
        };
      }
      throw _failure(response.statusCode, reading: false);
    });
  }

  /// Deletes the rows where [column] equals [value]; used to undo a save that failed
  /// half-way, so it never claims more than RLS lets this person delete.
  Future<void> deleteWhere(String table, {required String column, required Object value}) {
    final uri = base.replace(path: '/rest/v1/$table', queryParameters: {column: 'eq.$value'});
    return _authorized(retryDropped: false, (bearer) async {
      final (response, _) = await _send('DELETE', uri, bearer);
      if (response.statusCode >= 200 && response.statusCode < 300) return;
      throw _failure(response.statusCode, reading: false);
    });
  }

  /// Stores a file in a Storage bucket at [path]. Never overwrites: a name already
  /// taken is refused, as the web form's upload does.
  Future<void> uploadObject(String bucket, String path, File file, {required String contentType}) {
    final uri = base.replace(path: '/storage/v1/object/$bucket/${_objectPath(path)}');
    return _authorized(retryDropped: false, (bearer) async {
      final request = await _http.openUrl('POST', uri);
      request.followRedirects = false;
      request.headers
        ..set('apikey', apiKey)
        ..set(HttpHeaders.authorizationHeader, 'Bearer $bearer')
        ..set(HttpHeaders.contentTypeHeader, contentType)
        ..set(HttpHeaders.cacheControlHeader, 'max-age=3600')
        ..set('x-upsert', 'false')
        ..contentLength = await file.length();
      await request.addStream(file.openRead());
      final response = await request.close();
      await _read(response);
      if (response.statusCode >= 200 && response.statusCode < 300) return;
      throw _failure(response.statusCode, reading: false);
    });
  }

  /// A short-lived link to a stored file, made only when someone asks to see it.
  /// Never logged or kept: it grants access until it expires.
  Future<Uri> signedUrl(String bucket, String path, {Duration expiresIn = const Duration(minutes: 10)}) {
    final uri = base.replace(path: '/storage/v1/object/sign/$bucket/${_objectPath(path)}');
    return _authorized(retryDropped: true, (bearer) async {
      final (response, body) = await _send('POST', uri, bearer, body: {'expiresIn': expiresIn.inSeconds});
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final decoded = jsonDecode(body);
        final signed = decoded is Map ? (decoded['signedURL'] ?? decoded['signedUrl']) : null;
        if (signed is String && signed.startsWith('/')) return base.resolve('/storage/v1$signed');
      }
      throw _failure(response.statusCode >= 200 && response.statusCode < 300 ? 502 : response.statusCode, reading: true);
    });
  }

  /// Removes stored files, to undo an upload whose save then failed.
  Future<void> removeObjects(String bucket, List<String> paths) {
    final uri = base.replace(path: '/storage/v1/object/$bucket');
    return _authorized(retryDropped: false, (bearer) async {
      final (response, _) = await _send('DELETE', uri, bearer, body: {'prefixes': paths});
      if (response.statusCode >= 200 && response.statusCode < 300) return;
      throw _failure(response.statusCode, reading: false);
    });
  }

  /// Each segment escaped, so a file name cannot reach another folder or bucket.
  static String _objectPath(String path) =>
      path.split('/').where((part) => part.isNotEmpty && part != '.' && part != '..').map(Uri.encodeComponent).join('/');

  /// A database function, such as get_settings, my_access or touch_session.
  Future<Object?> rpc(String function, [Map<String, Object?> args = const {}]) => _rpc(function, args, write: false);

  /// A database function that changes something, such as add_list_option. Never sent
  /// twice: after a dropped connection it may already have happened.
  Future<Object?> rpcWrite(String function, [Map<String, Object?> args = const {}]) => _rpc(function, args, write: true);

  Future<Object?> _rpc(String function, Map<String, Object?> args, {required bool write}) {
    final uri = base.replace(path: '/rest/v1/rpc/$function');
    return _authorized(retryDropped: !write, (bearer) async {
      final (response, body) = await _send('POST', uri, bearer, body: args);
      if (response.statusCode >= 200 && response.statusCode < 300) return body.isEmpty ? null : jsonDecode(body);
      throw rpcFailure(response.statusCode, body, reading: !write);
    });
  }

  /// Dikho's own functions raise errors written for people, with a PT code ("That
  /// value is already in the list"): those are shown. Anything else is PostgREST's or
  /// Postgres's wording, for developers, and is not.
  @visibleForTesting
  static ApiException rpcFailure(int status, String body, {required bool reading}) {
    Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on FormatException {
      decoded = null;
    }
    final code = decoded is Map && decoded['code'] is String ? decoded['code'] as String : null;
    final message = decoded is Map && decoded['message'] is String ? (decoded['message'] as String).trim() : '';
    if (code == 'PGRST202') {
      return ApiException('This needs a database update that has not been applied yet.', status: status, code: code);
    }
    if (status != HttpStatus.unauthorized && code != null && RegExp(r'^PT[0-9]{3}$').hasMatch(code) && message.isNotEmpty && message.length <= 200) {
      return ApiException(message, status: status, code: code);
    }
    return _failure(status, reading: reading);
  }

  Future<Map<String, dynamic>> _writeOne(String method, Uri uri, String bearer, Map<String, Object?> row) async {
    final (response, body) = await _send(
      method,
      uri,
      bearer,
      body: row,
      headers: {
        'Prefer': 'return=representation',
        // One object back, and a 406 when no row matched.
        HttpHeaders.acceptHeader: 'application/vnd.pgrst.object+json',
      },
    );
    if (response.statusCode >= 200 && response.statusCode < 300) {
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) return decoded;
      throw const ApiException('The server sent something unexpected. Please try again.');
    }
    throw _failure(response.statusCode, reading: false);
  }

  Future<(HttpClientResponse, String)> _send(
    String method,
    Uri uri,
    String bearer, {
    Map<String, String> headers = const {},
    Map<String, Object?>? body,
    List<Map<String, Object?>>? list,
  }) async {
    final request = await _http.openUrl(method, uri);
    request.followRedirects = false;
    request.headers
      ..set('apikey', apiKey)
      ..set(HttpHeaders.authorizationHeader, 'Bearer $bearer')
      ..set(HttpHeaders.acceptHeader, 'application/json');
    headers.forEach(request.headers.set);
    final payload = body ?? list;
    if (payload != null) {
      final bytes = utf8.encode(jsonEncode(payload));
      request.headers
        ..contentType = ContentType.json
        ..contentLength = bytes.length;
      request.add(bytes);
    }
    final response = await request.close();
    return (response, await _read(response));
  }

  /// "0-24/180" gives 180. "*/0" gives 0. Anything else gives null.
  static int? totalFrom(String? contentRange) {
    if (contentRange == null) return null;
    final slash = contentRange.lastIndexOf('/');
    if (slash < 0) return null;
    return int.tryParse(contentRange.substring(slash + 1));
  }

  // PostgREST's own wording is for developers, so it is never shown to people.
  static ApiException _failure(int status, {required bool reading}) {
    if (status == HttpStatus.unauthorized) return ApiException('Your session has ended. Please sign in again.', status: status);
    if (status == HttpStatus.forbidden) return ApiException('Your access does not include this.', status: status);
    if (status == HttpStatus.notAcceptable && !reading) {
      return ApiException('This could not be changed. You may not have permission, or it was removed.', status: status, code: 'PGRST116');
    }
    if (reading) return ApiException('That did not load ($status). Please try again.', status: status);
    return ApiException('That could not be saved ($status). Check the details and try again.', status: status);
  }

  /// A fresh token after a 401, and for reads one more go after a dropped connection.
  Future<T> _authorized<T>(Future<T> Function(String bearer) send, {required bool retryDropped}) async {
    Future<T> attempt(String bearer) async {
      try {
        return await send(bearer);
      } on IOException {
        if (!retryDropped) rethrow;
        return send(bearer);
      }
    }

    try {
      try {
        return await attempt(await token()).timeout(timeout);
      } on ApiException catch (error) {
        if (error.status != HttpStatus.unauthorized) rethrow;
        return await attempt(await token(forceFresh: true)).timeout(timeout);
      }
    } on TimeoutException {
      throw const ApiException('The server took too long to answer. Please try again.');
    } on IOException {
      throw const ApiException('Could not reach the server. Check your connection and try again.');
    } on FormatException {
      throw const ApiException('The server sent something unexpected. Please try again.');
    }
  }

  Future<String> _read(HttpClientResponse response) async {
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in response) {
      bytes.add(chunk);
      if (bytes.length > _maxResponseBytes) throw const ApiException('The server sent more than expected.');
    }
    return utf8.decode(bytes.takeBytes());
  }

  void close() => _http.close(force: true);
}
