import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../shared/crm_api.dart' show SessionUnavailable;
import 'auth_api.dart';

/// Where the session is kept: the Android Keystore, through flutter_secure_storage.
abstract class SecretStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class KeystoreSecrets implements SecretStore {
  const KeystoreSecrets([this._storage = const FlutterSecureStorage()]);

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

enum AuthState { loading, signedOut, signedIn }

/// Why a session ended when it was not this person's choice, shown on the sign-in
/// screen afterwards. The wording is the web's own (SIGNOUT_NOTICES).
String? signOutNotice(String? reason) => switch (reason) {
  'forced' => 'An administrator signed you out of Dikho.',
  'suspended' => 'Your access to Dikho has been suspended. Contact your administrator.',
  'archived' => 'Your Dikho account has been closed. Contact your administrator.',
  'not_staff' => "This account doesn't have access to Dikho CRM. Contact your administrator.",
  'idle' => 'You were signed out after a while without activity. Please sign in again.',
  'ended' => 'Your session was ended. Please sign in again.',
  _ => null,
};

/// The one owner of the signed-in session. It signs in, refreshes before the token
/// runs out and signs out; native screens take their tokens from here, and the CRM
/// page reads the same session through the vault and asks here when it wants a fresh
/// one. Two refreshers would race on one refresh token, and Supabase treats a reused
/// refresh token as stolen and ends the session.
class AuthController extends ChangeNotifier {
  AuthController({
    required this.api,
    required this.storageKey,
    SecretStore? store,
    DateTime Function()? now,
    this.refreshAhead = const Duration(minutes: 5),
    this.scheduleRefresh = true,
  }) : _store = store ?? const KeystoreSecrets(),
       _now = now ?? DateTime.now;

  final AuthApi api;

  /// supabase-js's own key for the session (AppConfig.sessionKey).
  final String storageKey;
  final SecretStore _store;
  final DateTime Function() _now;

  /// Refreshed this long before it expires. supabase-js refreshes at 90 seconds, so the
  /// page always reads a session with more time than that and never refreshes itself.
  final Duration refreshAhead;
  final bool scheduleRefresh;

  static const deviceIdKey = 'dikho_device_id';
  static const signedInAtKey = 'dikho_signed_in_at';

  AuthState state = AuthState.loading;
  AuthSession? session;

  /// Why the last session ended, for the sign-in screen. Cleared on sign-in.
  String? notice;

  /// When this person last signed in on this phone: the 8-hour limit counts from here,
  /// not from the last time the app was opened.
  DateTime? signedInAt;

  Future<AuthSession>? _refreshing;
  Timer? _timer;
  bool _disposed = false;

  bool get signedIn => state == AuthState.signedIn && session != null;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /// The stored session, if there is one: written by this app, or by the CRM page in
  /// an earlier version of it.
  Future<void> load() async {
    String? stored;
    try {
      stored = await _store.read(storageKey);
    } on PlatformException {
      // A Keystore that cannot be read (it happens after some restores): signed out.
    }
    final found = stored == null ? null : AuthSession.fromJson(_decode(stored));
    if (found == null) {
      state = AuthState.signedOut;
      _notify();
      return;
    }
    session = found;
    state = AuthState.signedIn;
    signedInAt = await _readSignedInAt();
    _schedule();
    _notify();
    if (_expiresWithin(refreshAhead)) {
      try {
        await fresh();
      } on AuthFailure {
        // Gone: fresh() signed out. Offline: kept, and tried again when used.
      }
    }
  }

  /// A current access token for the API and the database. The signature PagedRows,
  /// CrmApi and the realtime connection already take.
  Future<String> accessToken({bool forceFresh = false}) async {
    if (!signedIn) throw const SessionUnavailable();
    try {
      return (await fresh(force: forceFresh)).accessToken;
    } on AuthFailure {
      if (!signedIn) throw const SessionUnavailable();
      // Offline: the held token may still be good; the server says if not.
      if (!forceFresh && !_expiresWithin(Duration.zero)) return session!.accessToken;
      throw const SessionUnavailable();
    }
  }

  bool _expiresWithin(Duration margin) {
    final held = session;
    return held == null || _now().add(margin).isAfter(held.expiry);
  }

  /// The session, refreshed first when it expires within [refreshAhead] (or when
  /// [force]d). One refresh at a time, whoever asks.
  Future<AuthSession> fresh({bool force = false}) {
    final held = session;
    if (held == null) return Future.error(const AuthFailure(AuthProblem.sessionGone, 'Your session has ended. Please sign in again.'));
    if (!force && !_expiresWithin(refreshAhead)) return Future.value(held);
    return _refreshing ??= _refresh(held).whenComplete(() => _refreshing = null);
  }

  Future<AuthSession> _refresh(AuthSession held) async {
    try {
      final next = await api.refresh(held.refreshToken);
      // Signed out meanwhile: the new session is not kept.
      if (session?.refreshToken != held.refreshToken) {
        throw const AuthFailure(AuthProblem.sessionGone, 'Your session has ended. Please sign in again.');
      }
      await _keep(next);
      return next;
    } on AuthFailure catch (failure) {
      if (failure.kind == AuthProblem.sessionGone && session?.refreshToken == held.refreshToken) {
        await signOut(reason: 'ended', revoke: false);
      }
      rethrow;
    }
  }

  Future<void> _keep(AuthSession next) async {
    session = next;
    state = AuthState.signedIn;
    try {
      await _store.write(storageKey, jsonEncode(next.toJson()));
    } on PlatformException {
      // Held in memory for now; the next sign-in stores it.
    }
    _schedule();
    _notify();
  }

  void _schedule() {
    _timer?.cancel();
    final held = session;
    if (!scheduleRefresh || held == null) return;
    final wait = held.expiry.subtract(refreshAhead).difference(_now());
    _timer = Timer(wait.isNegative ? Duration.zero : wait, () => unawaited(fresh().then((_) {}, onError: (Object _) {})));
  }

  /// After the app comes back to the screen: timers do not run in the background, so
  /// a token may have run down meanwhile.
  void resumed() {
    if (signedIn && _expiresWithin(refreshAhead)) unawaited(fresh().then((_) {}, onError: (Object _) {}));
  }

  Future<DateTime> _readSignedInAt() async {
    try {
      final stored = DateTime.tryParse(await _store.read(signedInAtKey) ?? '');
      if (stored != null) return stored;
    } on PlatformException {
      // Counted from now instead.
    }
    return _markSignedIn();
  }

  Future<DateTime> _markSignedIn() async {
    final at = _now();
    signedInAt = at;
    try {
      await _store.write(signedInAtKey, at.toIso8601String());
    } on PlatformException {
      // Held in memory.
    }
    return at;
  }

  /// A code was accepted: this is the session from now on.
  Future<void> signedInWith(AuthSession next) async {
    notice = null;
    await _markSignedIn();
    await _keep(next);
    unawaited(_checkDevice(next));
  }

  Future<void> _checkDevice(AuthSession signedIn) async {
    try {
      var id = await _store.read(deviceIdKey);
      if (id == null || id.isEmpty) {
        id = _deviceId();
        await _store.write(deviceIdKey, id);
      }
      await api.deviceCheck(signedIn.accessToken, id);
    } on Object {
      // Never stands in the way of signing in, as on the web.
    }
  }

  String _deviceId() {
    final bytes = List<int>.generate(16, (_) => _randomByte());
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  final _random = Random.secure();
  int _randomByte() => _random.nextInt(256);

  /// Ends the session on this phone. [revoke] also ends it on the server; it is false
  /// when the server has ended it already. [reason] says why, for the sign-in screen.
  Future<void> signOut({String? reason, bool revoke = true}) async {
    final held = session;
    _timer?.cancel();
    session = null;
    state = AuthState.signedOut;
    notice = signOutNotice(reason);
    signedInAt = null;
    try {
      await _store.delete(storageKey);
      await _store.delete(signedInAtKey);
    } on PlatformException {
      // Nothing more can be done; the session is gone from memory.
    }
    _notify();
    if (revoke && held != null) {
      try {
        await api.signOut(held.accessToken);
      } on AuthFailure {
        // Offline: the token runs out by itself within the hour.
      }
    }
  }

  /// The page said why it signed out after the session had already gone.
  void explain(String? reason) {
    final text = signOutNotice(reason);
    if (state != AuthState.signedOut || text == null) return;
    notice = text;
    _notify();
  }

  /* ── The CRM page's side ─────────────────────────────────────────────── */

  /// What the page reads from the vault: the session with time left on it.
  Future<String?> readForPage() async {
    if (!signedIn) return null;
    try {
      final current = await fresh();
      return jsonEncode(current.toJson());
    } on AuthFailure {
      final held = session;
      return held == null ? null : jsonEncode(held.toJson());
    }
  }

  /// The page wrote a session. Either it is the one held (nothing to do), or the page
  /// signed in by itself (an older page, before the app owned sign-in): kept.
  Future<void> writtenByPage(String value) async {
    final written = AuthSession.fromJson(_decode(value));
    if (written == null || written.refreshToken == session?.refreshToken) return;
    notice = null;
    if (!signedIn) await _markSignedIn();
    await _keep(written);
  }

  /// The page signed out: an administrator ended the session, the page timed out, or
  /// the person used the page's own sign out.
  Future<void> removedByPage({String? reason}) async {
    if (!signedIn) return;
    // The page has already told the server.
    await signOut(reason: reason, revoke: false);
  }

  /// The page wants a fresh session (its supabase-js asked to refresh). It gets the one
  /// held, refreshed here first if needed: the page never spends a refresh token itself.
  Future<String?> refreshForPage() async {
    if (!signedIn) return null;
    try {
      return jsonEncode((await fresh()).toJson());
    } on AuthFailure {
      return null;
    }
  }

  static Object? _decode(String text) {
    try {
      return jsonDecode(text);
    } on FormatException {
      return null;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }
}
