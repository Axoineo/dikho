import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// A signed-in session, as Supabase Auth issues it and as supabase-js stores it, so the
/// CRM page reads the very same session the app holds.
class AuthSession {
  AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
    required this.user,
    this.tokenType = 'bearer',
    this.expiresIn = 3600,
  });

  /// From Supabase Auth's answer or from the stored copy; null when it is not a whole
  /// session. A missing expires_at is worked out from expires_in, as supabase-js does.
  static AuthSession? fromJson(Object? json, {DateTime? now}) {
    if (json is! Map) return null;
    final access = json['access_token'];
    final refresh = json['refresh_token'];
    final user = json['user'];
    if (access is! String || access.isEmpty || refresh is! String || refresh.isEmpty || user is! Map) return null;
    final expiresIn = json['expires_in'] is num ? (json['expires_in'] as num).toInt() : 3600;
    final at = json['expires_at'] is num ? (json['expires_at'] as num).toInt() : ((now ?? DateTime.now()).millisecondsSinceEpoch ~/ 1000) + expiresIn;
    return AuthSession(
      accessToken: access,
      refreshToken: refresh,
      expiresAt: at,
      expiresIn: expiresIn,
      tokenType: json['token_type'] is String ? json['token_type'] as String : 'bearer',
      user: Map<String, Object?>.from(user),
    );
  }

  final String accessToken;
  final String refreshToken;

  /// Seconds since the epoch.
  final int expiresAt;
  final int expiresIn;
  final String tokenType;
  final Map<String, Object?> user;

  DateTime get expiry => DateTime.fromMillisecondsSinceEpoch(expiresAt * 1000);

  String get userId => user['id'] is String ? user['id'] as String : '';
  String get email => user['email'] is String ? user['email'] as String : '';
  String get phone => user['phone'] is String ? user['phone'] as String : '';

  /// The supabase-js storage format.
  Map<String, Object?> toJson() => {
    'access_token': accessToken,
    'token_type': tokenType,
    'expires_in': expiresIn,
    'expires_at': expiresAt,
    'refresh_token': refreshToken,
    'user': user,
  };
}

enum AuthProblem { notAllowed, invalidCode, rateLimited, sessionGone, network, server }

/// Why something to do with signing in did not work, in words for the person.
class AuthFailure implements Exception {
  const AuthFailure(this.kind, this.message);

  final AuthProblem kind;
  final String message;

  @override
  String toString() => message;
}

/// Supabase Auth's REST API with the project's publishable key: asking for a code,
/// checking it, refreshing and ending a session. Never retried after a dropped
/// connection, since a code or a refresh token works only once.
class AuthApi {
  AuthApi({required this.base, required this.apiKey, HttpClient? httpClient, this.timeout = const Duration(seconds: 20)})
    : _http = httpClient ?? HttpClient();

  final Uri base;

  /// Public by design: it only identifies the project.
  final String apiKey;
  final Duration timeout;
  final HttpClient _http;

  static const _maxResponseBytes = 256 * 1024;

  /// Sends a six-digit code to a person the organization already added. Nobody new
  /// is ever created here (create_user is false), as on the web sign-in page.
  Future<void> sendCode({String? email, String? phone}) async {
    final (status, body) = await _post('/auth/v1/otp', {'email': ?email, 'phone': ?phone, 'create_user': false});
    if (status >= 200 && status < 300) return;
    throw _failure(status, body, sending: true, phone: phone != null);
  }

  Future<AuthSession> verify({String? email, String? phone, required String code}) async {
    final (status, body) = await _post('/auth/v1/verify', {'type': phone != null ? 'sms' : 'email', 'email': ?email, 'phone': ?phone, 'token': code});
    if (status >= 200 && status < 300) {
      final session = AuthSession.fromJson(_decode(body));
      if (session != null) return session;
      throw const AuthFailure(AuthProblem.server, 'The server sent something unexpected. Please try again.');
    }
    throw _failure(status, body);
  }

  /// A new session for [refreshToken]. The old one stops working once this succeeds.
  Future<AuthSession> refresh(String refreshToken) async {
    final (status, body) = await _post('/auth/v1/token', {'refresh_token': refreshToken}, query: {'grant_type': 'refresh_token'});
    if (status >= 200 && status < 300) {
      final session = AuthSession.fromJson(_decode(body));
      if (session != null) return session;
      throw const AuthFailure(AuthProblem.server, 'The server sent something unexpected. Please try again.');
    }
    throw _failure(status, body, refreshing: true);
  }

  /// Ends this session on the server: only this phone's, never the person's other
  /// devices.
  Future<void> signOut(String accessToken) async {
    await _post('/auth/v1/logout', const {}, query: {'scope': 'local'}, bearer: accessToken);
  }

  /// The device check the web sign-in page makes, so this phone is known too.
  Future<void> deviceCheck(String accessToken, String deviceId) async {
    await _post('/functions/v1/device-check', {'device_id': deviceId}, bearer: accessToken);
  }

  Future<(int, String)> _post(String path, Map<String, Object?> payload, {Map<String, String>? query, String? bearer}) async {
    final uri = base.replace(path: path, queryParameters: query);
    try {
      return await _send(uri, payload, bearer).timeout(timeout);
    } on TimeoutException {
      throw const AuthFailure(AuthProblem.network, 'The server took too long to answer. Check your connection and try again.');
    } on IOException {
      throw const AuthFailure(AuthProblem.network, 'Could not reach Dikho. Check your internet connection and try again.');
    }
  }

  Future<(int, String)> _send(Uri uri, Map<String, Object?> payload, String? bearer) async {
    final request = await _http.openUrl('POST', uri);
    request.followRedirects = false;
    final bytes = utf8.encode(jsonEncode(payload));
    request.headers
      ..set('apikey', apiKey)
      ..set(HttpHeaders.acceptHeader, 'application/json')
      ..contentType = ContentType.json
      ..contentLength = bytes.length;
    if (bearer != null) request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $bearer');
    request.add(bytes);
    final response = await request.close();
    final body = BytesBuilder(copy: false);
    await for (final chunk in response) {
      body.add(chunk);
      if (body.length > _maxResponseBytes) throw const AuthFailure(AuthProblem.server, 'The server sent more than expected.');
    }
    return (response.statusCode, utf8.decode(body.takeBytes(), allowMalformed: true));
  }

  static Object? _decode(String body) {
    try {
      return jsonDecode(body);
    } on FormatException {
      return null;
    }
  }

  /// Supabase Auth's own wording is for developers; these are for the person.
  static AuthFailure _failure(int status, String body, {bool sending = false, bool phone = false, bool refreshing = false}) {
    final json = _decode(body);
    String field(String key) => json is Map && json[key] is String ? json[key] as String : '';
    final code = field('error_code').isNotEmpty ? field('error_code') : field('error');
    final text = [field('msg'), field('message'), field('error_description')].firstWhere((t) => t.isNotEmpty, orElse: () => '');
    if (refreshing && (status == 400 || status == 401 || status == 403)) {
      return const AuthFailure(AuthProblem.sessionGone, 'Your session has ended. Please sign in again.');
    }
    if (status == 429 || code.startsWith('over_')) {
      final seconds = RegExp(r'after (\d+) seconds?').firstMatch(text)?.group(1);
      return AuthFailure(
        AuthProblem.rateLimited,
        seconds == null
            ? 'Too many tries. Wait a minute, then try again.'
            : 'For your security, wait $seconds seconds before asking for another code.',
      );
    }
    if (sending &&
        (code == 'otp_disabled' || code == 'user_not_found' || RegExp(r'signups? not allowed|not found', caseSensitive: false).hasMatch(text))) {
      return AuthFailure(
        AuthProblem.notAllowed,
        phone
            ? "This number isn't authorized. Contact an admin to get access."
            : "This email isn't registered for Dikho CRM. Contact an admin to get access.",
      );
    }
    if (!sending && (status == 400 || status == 401 || status == 403 || code == 'otp_expired')) {
      return const AuthFailure(AuthProblem.invalidCode, 'That code is wrong or has expired. Check it, or send a new one.');
    }
    if (status >= 500) return const AuthFailure(AuthProblem.server, 'Dikho is having a problem on its side. Please try again in a minute.');
    return AuthFailure(AuthProblem.server, text.isEmpty ? 'That did not work ($status). Please try again.' : 'That did not work: $text');
  }

  void close() => _http.close(force: true);
}
