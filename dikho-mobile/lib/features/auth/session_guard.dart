import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../app/app_config.dart';
import '../../shared/crm_api.dart';
import '../../shared/supabase_rest.dart';
import '../inbox/inbox_realtime.dart';
import '../shell/shell_messages.dart';
import 'auth_controller.dart';
import 'page_access.dart';

/// Why access could not be settled, when it was not a sign-out.
enum AccessProblem { unreachable, notReady }

/// The rules the CRM page used to keep for a signed-in person, kept by the app now
/// (ADR 0013), as src/layouts/AuthenticatedLayout.jsx keeps them on the web: who this
/// is and what they may open (my_access), the activity heartbeat (touch_session), the
/// sign-in record (/me/session), sign-out after 45 minutes without activity or 8 hours
/// in all, and an administrator ending the session (the person's staff channel).
///
/// None of this is a security boundary: the database and the API check the session
/// and the permissions on every request. It decides what to show, and ends a session
/// the person has walked away from.
class SessionGuard extends ChangeNotifier {
  SessionGuard({
    required this.auth,
    required this.rest,
    required this.api,
    SecretStore? store,
    DateTime Function()? now,
    this.inactivity = const Duration(minutes: 45),
    this.warnBefore = const Duration(minutes: 5),
    this.maxSession = const Duration(hours: 8),
    this.heartbeatEvery = const Duration(seconds: 60),
    this.activeWindow = const Duration(minutes: 2),
    this.runTimers = true,
    this.staffChannel,
  }) : _store = store ?? const KeystoreSecrets(),
       _now = now ?? DateTime.now,
       // Set now, not on first read: a `late` initializer would start the idle clock at
       // whatever moment first looked at it.
       _lastActive = (now ?? DateTime.now)();

  final AuthController auth;
  final SupabaseRest rest;
  final CrmApi api;
  final SecretStore _store;
  final DateTime Function() _now;
  final Duration inactivity;
  final Duration warnBefore;
  final Duration maxSession;
  final Duration heartbeatEvery;
  final Duration activeWindow;
  final bool runTimers;

  /// Opens the person's own Realtime channel; none in tests that do not need it.
  final InboxRealtime Function({required String name, required void Function(String, Map<String, dynamic>) onEvent})? staffChannel;

  /// Everything else announced on that channel (Live Assist's requests and answers).
  void Function(String event, Map<String, dynamic> payload)? onStaffEvent;

  static const recordedKey = 'dikho_session_recorded';

  ShellAccess? access;
  AccessProblem? problem;
  bool loading = false;

  /// The inactivity warning is showing, with [left] until sign-out.
  bool warning = false;
  Duration left = Duration.zero;

  DateTime _lastActive;
  String? _section;
  bool _foreground = true;
  bool _stopped = false;
  Timer? _heartbeat;
  Timer? _clock;
  InboxRealtime? _channel;

  void _notify() {
    if (!_stopped) notifyListeners();
  }

  /// Settles access and starts the clocks, right after signing in or opening the app.
  Future<void> start() async {
    await loadAccess();
    if (_stopped || access == null) return;
    unawaited(_recordSession());
    if (runTimers) {
      _heartbeat = Timer.periodic(heartbeatEvery, (_) => unawaited(beat()));
      _schedule();
    }
    _joinStaffChannel();
  }

  /// my_access: who this is and what they may do.
  Future<void> loadAccess() async {
    loading = true;
    _notify();
    try {
      final data = await rest.rpc('my_access');
      final row = data is Map ? data : const {};
      final status = row['status'];
      switch (status) {
        case 'active':
          access = _accessFrom(row);
          problem = null;
        case 'session_ended' || 'signed_out':
          await _end('ended', revoke: false);
        case 'suspended' || 'archived':
          await _end(status as String);
        default:
          await _end('not_staff');
      }
    } on SessionUnavailable {
      // Signed out meanwhile: nothing to settle.
    } on ApiException catch (failure) {
      if (failure.status == 401) {
        await _end('ended', revoke: false);
      } else if (access == null) {
        // A background re-check keeps what was already granted. A function PostgREST
        // cannot find (404) means the database has not had its update yet.
        problem = failure.status == 404 ? AccessProblem.notReady : AccessProblem.unreachable;
      }
    } finally {
      loading = false;
      _notify();
    }
  }

  ShellAccess _accessFrom(Map row) {
    final session = auth.session;
    final scopes = <String, String>{};
    final permissions = row['permissions'];
    if (permissions is Map) {
      for (final entry in permissions.entries) {
        if (entry.key is String && entry.value is String && entry.value != 'none') scopes[entry.key as String] = entry.value as String;
      }
    }
    final userId = row['user_id'] is String ? row['user_id'] as String : (session?.userId ?? '');
    final email = row['email'] is String ? row['email'] as String : (session?.email ?? '');
    final metadata = session?.user['user_metadata'];
    final metadataName = metadata is Map && metadata['full_name'] is String ? metadata['full_name'] as String : '';
    final fullName = row['full_name'] is String ? (row['full_name'] as String).trim() : '';
    final name = fullName.isNotEmpty ? fullName : (metadataName.isNotEmpty ? metadataName : email.split('@').first);
    return ShellAccess(
      userId: userId,
      name: name,
      email: email,
      allowed: allowedPaths(scopes.keys.toSet(), userId),
      permissions: scopes.keys.toSet(),
      scopes: scopes,
      helpOffered: false,
      helpRequested: false,
      supabaseUrl: AppConfig.supabaseUrl,
      publishableKey: AppConfig.supabasePublishableKey,
      sessionId: row['session_id'] is String ? row['session_id'] as String : '',
      theme: const {'light', 'dark', 'system'}.contains(row['theme']) ? row['theme'] as String : null,
      preferences: row['preferences'] is Map ? Map<String, Object?>.from(row['preferences'] as Map) : const {},
    );
  }

  /// Where this session signed in from, once per session, for User Management.
  Future<void> _recordSession() async {
    final session = access?.sessionId ?? '';
    if (session.isEmpty) return;
    try {
      if (await _store.read(recordedKey) == session) return;
      await api.post('/me/session');
      await _store.write(recordedKey, session);
    } on Object {
      // The server is idempotent: the next start tries again.
    }
  }

  /// A tap on a native screen, or the page saying it was used. [section] is where.
  void noteActivity([String? section]) {
    _lastActive = _now();
    if (section != null) _section = section;
    if (warning) {
      warning = false;
      _notify();
    }
    if (runTimers) _schedule();
  }

  /// The app went to the background or came back. Clocks do not run in the
  /// background, so the limits are checked on return.
  void foreground(bool on) {
    _foreground = on;
    if (!on) {
      _channel?.stop();
      _channel = null;
      return;
    }
    if (_check()) return;
    unawaited(beat());
    _joinStaffChannel();
    if (runTimers) _schedule();
  }

  /// Signs out when a limit has passed; true when it did.
  bool _check() {
    final now = _now();
    final started = auth.signedInAt;
    if (started != null && now.difference(started) >= maxSession) {
      unawaited(_end('ended'));
      return true;
    }
    if (now.difference(_lastActive) >= inactivity) {
      unawaited(_end('idle'));
      return true;
    }
    return false;
  }

  /// Where the clock stands now, as its timer would find it.
  @visibleForTesting
  void checkClock() => _schedule();

  /// One clock: to the warning, then each second through it, then sign-out.
  void _schedule() {
    _clock?.cancel();
    if (_stopped || access == null) return;
    final now = _now();
    final idleLeft = inactivity - now.difference(_lastActive);
    final started = auth.signedInAt;
    final sessionLeft = started == null ? idleLeft : maxSession - now.difference(started);
    if (idleLeft <= Duration.zero || sessionLeft <= Duration.zero) {
      _check();
      return;
    }
    if (idleLeft <= warnBefore) {
      warning = true;
      left = idleLeft;
      _notify();
      _clock = Timer(const Duration(seconds: 1), _schedule);
      return;
    }
    final next = [idleLeft - warnBefore, sessionLeft].reduce((a, b) => a < b ? a : b);
    _clock = Timer(next, _schedule);
  }

  /// touch_session, while someone is actually at the screen.
  Future<void> beat() async {
    if (!_foreground || access == null || _stopped) return;
    if (_now().difference(_lastActive) > activeWindow) return;
    try {
      final result = await rest.rpc('touch_session', {'p_section': _section});
      if (result == 'session_ended' || result == 'signed_out') {
        await _end('ended', revoke: false);
      } else if (result == 'no_access') {
        await loadAccess();
      }
    } on ApiException {
      // The next beat tries again; the database refuses an ended session anyway.
    }
  }

  /// The person's private channel: the server announces here when an administrator
  /// ends this session, so the screen clears at once rather than on the next request.
  void _joinStaffChannel() {
    final make = staffChannel;
    final userId = access?.userId ?? '';
    if (make == null || userId.isEmpty || !_foreground || _channel != null || _stopped) return;
    _channel = make(
      name: 'staff:$userId',
      onEvent: (event, payload) {
        if (event != 'signed_out') {
          onStaffEvent?.call(event, payload);
          return;
        }
        final session = payload['session_id'];
        if (session is String && session.isNotEmpty && session != access?.sessionId) return;
        final reason = payload['reason'];
        unawaited(_end(reason is String && signOutReasons.contains(reason) ? reason : 'forced', revoke: false));
      },
    )..start();
  }

  Future<void> _end(String reason, {bool revoke = true}) async {
    if (_stopped) return;
    stop();
    // Only someone who may not be here keeps the server session; the rest is ended.
    await auth.signOut(reason: reason, revoke: revoke);
  }

  /// Everything stops: the person signed out, or the app is closing.
  void stop() {
    _stopped = true;
    _heartbeat?.cancel();
    _clock?.cancel();
    _channel?.stop();
    _channel = null;
    warning = false;
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}
