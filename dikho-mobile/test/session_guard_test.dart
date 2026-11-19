import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/auth/auth_api.dart';
import 'package:dikho_crm/features/auth/auth_controller.dart';
import 'package:dikho_crm/features/auth/page_access.dart';
import 'package:dikho_crm/features/auth/session_guard.dart';
import 'package:dikho_crm/features/inbox/inbox_realtime.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:dikho_crm/shared/supabase_rest.dart';
import 'package:flutter_test/flutter_test.dart';

// The rules the page used to keep, kept by the app: against a stand-in for PostgREST
// (my_access, touch_session), the API (/me/session) and Supabase Auth (logout).

class FakeBackend {
  late HttpServer server;
  final log = <String>[];
  Map<String, Object?> access = {
    'status': 'active',
    'user_id': 'user-1',
    'session_id': 'session-1',
    'email': 'asha@example.test',
    'full_name': 'Asha Rao',
    'permissions': {'clients.view': 'all', 'users.view': 'all', 'sales_orders.edit': 'own', 'leads.view': 'none'},
  };
  int accessStatus = 200;
  Object touch = 'ok';

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final raw = await utf8.decoder.bind(request).join();
      log.add('${request.method} ${request.uri.path} $raw');
      final response = request.response..headers.contentType = ContentType.json;
      switch (request.uri.path) {
        case '/rest/v1/rpc/my_access':
          response.statusCode = accessStatus;
          response.write(jsonEncode(access));
        case '/rest/v1/rpc/touch_session':
          response.write(jsonEncode(touch));
        case '/api/me/session':
          response.write(jsonEncode({'success': true, 'data': {'recorded': true}}));
        case '/auth/v1/logout':
          response.statusCode = 204;
        default:
          response.write('{}');
      }
      await response.close();
    });
  }

  Uri get base => Uri.parse('http://localhost:${server.port}');
  List<String> calls(String path) => log.where((l) => l.contains(path)).toList();
}

class MemoryStore implements SecretStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
}

class FakeChannel extends InboxRealtime {
  FakeChannel(this.events) : super(supabaseUrl: 'http://localhost:1', apiKey: 'k', token: () async => 't', onEvent: events, onJoined: () {});
  final void Function(String, Map<String, dynamic>) events;
  bool started = false;
  @override
  void start() => started = true;
  @override
  void stop() {}
}

void main() {
  late FakeBackend backend;
  late MemoryStore store;
  late AuthController auth;
  late DateTime clock;
  FakeChannel? channel;
  String? channelName;

  setUp(() async {
    HttpOverrides.global = null;
    backend = FakeBackend();
    await backend.start();
    store = MemoryStore();
    clock = DateTime.utc(2026, 11, 17, 9);
    auth = AuthController(api: AuthApi(base: backend.base, apiKey: 'k'), storageKey: 'sb-x-auth-token', store: store, now: () => clock, scheduleRefresh: false);
    await auth.signedInWith(AuthSession(
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: clock.add(const Duration(hours: 1)).millisecondsSinceEpoch ~/ 1000,
      user: const {'id': 'user-1', 'email': 'asha@example.test'},
    ));
    channel = null;
  });

  tearDown(() => backend.server.close(force: true));

  SessionGuard guard({bool timers = false}) => SessionGuard(
    auth: auth,
    rest: SupabaseRest(base: backend.base, apiKey: 'k', token: auth.accessToken),
    api: CrmApi(origin: backend.base, token: auth.accessToken),
    store: store,
    now: () => clock,
    runTimers: timers,
    staffChannel: ({required name, required onEvent}) {
      channelName = name;
      return channel = FakeChannel(onEvent);
    },
  );

  test('access comes from my_access: what they may open, how far, and their name', () async {
    final g = guard();
    await g.start();
    final access = g.access!;
    expect(access.permissions, {'clients.view', 'users.view', 'sales_orders.edit'}, reason: '"none" is not held');
    expect(access.scopeOf('sales_orders.edit'), 'own');
    expect(access.allowed, containsAll(['/clients', '/users', '/settings']));
    expect(access.allowed, isNot(contains('/leads')));
    expect((access.name, access.email, access.sessionId), ('Asha Rao', 'asha@example.test', 'session-1'));
    expect(channelName, 'staff:user-1');
    expect(channel!.started, isTrue);
    g.stop();
  });

  test('the sign-in is recorded once per session', () async {
    await guard().start();
    await Future<void>.delayed(const Duration(milliseconds: 50));
    await guard().start();
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(backend.calls('/api/me/session'), hasLength(1), reason: 'the next time the app opens, it is not recorded again');
  });

  test('suspended: signed out on the server too, and told why', () async {
    backend.access = {'status': 'suspended'};
    await guard().start();
    expect(auth.signedIn, isFalse);
    expect(auth.notice, 'Your access to Dikho has been suspended. Contact your administrator.');
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(backend.calls('/auth/v1/logout'), hasLength(1));
  });

  test('a session the server already ended signs out here without asking it again', () async {
    backend.access = {'status': 'session_ended'};
    await guard().start();
    expect(auth.notice, 'Your session was ended. Please sign in again.');
    expect(backend.calls('/auth/v1/logout'), isEmpty);
  });

  test('not reachable: still signed in, with a problem to show; a missing function means an update is due', () async {
    backend.accessStatus = 500;
    final g = guard();
    await g.start();
    expect((auth.signedIn, g.access, g.problem), (true, null, AccessProblem.unreachable));
    backend.accessStatus = 404;
    await g.loadAccess();
    expect(g.problem, AccessProblem.notReady);
    backend.accessStatus = 200;
    await g.loadAccess();
    expect((g.problem, g.access?.userId), (null, 'user-1'));
  });

  test('the heartbeat says where they are, only while they are at the screen', () async {
    final g = guard();
    await g.start();
    g.noteActivity('whatsapp-inbox');
    await g.beat();
    expect(backend.calls('touch_session').single, contains('"p_section":"whatsapp-inbox"'));
    clock = clock.add(const Duration(minutes: 3));
    await g.beat();
    expect(backend.calls('touch_session'), hasLength(1), reason: 'nobody has touched it for 3 minutes');
    g.noteActivity();
    g.foreground(false);
    await g.beat();
    expect(backend.calls('touch_session'), hasLength(1), reason: 'in the background');
    g.foreground(true);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    backend.touch = 'session_ended';
    await g.beat();
    expect(auth.signedIn, isFalse);
  });

  test('45 minutes without activity: a warning for the last 5, then signed out', () async {
    final g = guard();
    await g.start();
    clock = clock.add(const Duration(minutes: 41));
    g.checkClock();
    expect(g.warning, isTrue);
    expect(g.left, const Duration(minutes: 4));
    g.noteActivity();
    expect(g.warning, isFalse, reason: 'any activity keeps them in');
    clock = clock.add(const Duration(minutes: 46));
    g.foreground(true);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(auth.signedIn, isFalse);
    expect(auth.notice, 'You were signed out after a while without activity. Please sign in again.');
  });

  test('8 hours after signing in, however active, the session ends', () async {
    final g = guard();
    await g.start();
    for (var i = 0; i < 9; i++) {
      clock = clock.add(const Duration(minutes: 55));
      g.noteActivity();
    }
    g.foreground(true);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(auth.signedIn, isFalse);
  });

  test('an administrator ending this session signs out at once; another session\'s notice is ignored', () async {
    await guard().start();
    channel!.events('signed_out', {'session_id': 'session-2'});
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(auth.signedIn, isTrue);
    channel!.events('signed_out', {'session_id': 'session-1', 'reason': 'forced'});
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(auth.signedIn, isFalse);
    expect(auth.notice, 'An administrator signed you out of Dikho.');
    expect(backend.calls('/auth/v1/logout'), isEmpty, reason: 'the server ended it already');
  });

  test('the drawer pages follow the web rules, and the email pages only in a build with them', () {
    expect(canOpen({'campaigns.send'}, 'u', '/whatsapp'), isTrue);
    expect(canOpen({}, 'u', '/whatsapp/inbox'), isFalse);
    expect(canOpen({}, 'u', '/users/u'), isTrue, reason: 'your own profile');
    expect(canOpen({}, 'u', '/settings/profile'), isTrue);
    expect(sectionFor('/whatsapp/campaigns/12'), 'whatsapp-campaigns');
    expect(sectionFor('/whatsapp'), 'whatsapp');
    expect(allowedPaths({'email_inbox.view'}, 'u', emailHub: false), {'/settings'});
    expect(allowedPaths({'email_inbox.view'}, 'u', emailHub: true), containsAll(['/email', '/email/inbox', '/email/settings']));
  });
}
