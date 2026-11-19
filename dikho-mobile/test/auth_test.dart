import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/auth/auth_api.dart';
import 'package:dikho_crm/features/auth/auth_controller.dart';
import 'package:dikho_crm/features/auth/sign_in_screen.dart';
import 'package:dikho_crm/shared/crm_api.dart' show SessionUnavailable;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Native sign-in against a stand-in for Supabase Auth. Each refresh token works once,
// as on the real service, so a second refresher would be caught. Synthetic people only.

class FakeAuth {
  late HttpServer server;
  final log = <String>[];
  final bodies = <Map<String, dynamic>>[];
  final known = {'staff@example.test', '+919800000001'};
  final live = <String>{};
  String code = '123456';
  int issued = 0;
  int expiresIn = 3600;
  bool slowRefresh = false;
  int? limitedFor;

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen(_handle);
  }

  Uri get base => Uri.parse('http://localhost:${server.port}');
  AuthApi get api => AuthApi(base: base, apiKey: 'publishable');

  Map<String, Object?> issue(String who) {
    issued += 1;
    final refresh = 'refresh-$issued';
    live.add(refresh);
    return {
      'access_token': 'access-$issued',
      'refresh_token': refresh,
      'token_type': 'bearer',
      'expires_in': expiresIn,
      'user': {'id': 'user-1', who.startsWith('+') ? 'phone' : 'email': who},
    };
  }

  Future<void> _handle(HttpRequest request) async {
    final raw = await utf8.decoder.bind(request).join();
    final body = raw.isEmpty ? <String, dynamic>{} : jsonDecode(raw) as Map<String, dynamic>;
    log.add(
      '${request.method} ${request.uri.path}${request.uri.hasQuery ? '?${request.uri.query}' : ''} key=${request.headers.value('apikey')} auth=${request.headers.value('authorization')}',
    );
    bodies.add(body);
    final response = request.response..headers.contentType = ContentType.json;
    var status = 200;
    Object out = {};
    switch (request.uri.path) {
      case '/auth/v1/otp':
        final who = (body['email'] ?? body['phone']) as String;
        if (limitedFor != null) {
          status = 429;
          out = {
            'code': 429,
            'error_code': 'over_email_send_rate_limit',
            'msg': 'For security purposes, you can only request this after $limitedFor seconds.',
          };
        } else if (!known.contains(who)) {
          status = 422;
          out = {'code': 422, 'error_code': 'otp_disabled', 'msg': 'Signups not allowed for otp'};
        }
      case '/auth/v1/verify':
        if (body['token'] != code) {
          status = 403;
          out = {'code': 403, 'error_code': 'otp_expired', 'msg': 'Token has expired or is invalid'};
        } else {
          out = issue((body['email'] ?? body['phone']) as String);
        }
      case '/auth/v1/token':
        if (slowRefresh) await Future<void>.delayed(const Duration(milliseconds: 100));
        final token = body['refresh_token'] as String;
        if (!live.remove(token)) {
          status = 400;
          out = {'code': 400, 'error_code': 'refresh_token_already_used', 'msg': 'Invalid Refresh Token: Already Used'};
        } else {
          out = issue('staff@example.test');
        }
      case '/auth/v1/logout':
        status = 204;
      case '/functions/v1/device-check':
        out = {'ok': true};
    }
    response.statusCode = status;
    if (status != 204) response.write(jsonEncode(out));
    await response.close();
  }
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

const key = 'sb-project-auth-token';

void main() {
  late FakeAuth auth;

  setUp(() async {
    HttpOverrides.global = null;
    auth = FakeAuth();
    await auth.start();
  });

  tearDown(() => auth.server.close(force: true));

  group('numbers and sessions', () {
    test('a typed number becomes E.164 as the web sign-in makes it', () {
      expect(toE164('98000 00001'), '+919800000001');
      expect(toE164('09800000001'), '+919800000001');
      expect(toE164('+44 7700 900123'), '+447700900123');
      expect(toE164('12345'), isNull);
      expect(toE164(''), isNull);
    });

    test('a session is stored in supabase-js\'s own shape, with expires_at worked out', () {
      final now = DateTime.utc(2026, 11, 14, 10);
      final session = AuthSession.fromJson({
        'access_token': 'a',
        'refresh_token': 'r',
        'expires_in': 3600,
        'user': {'id': 'u', 'email': 'e@example.test'},
      }, now: now)!;
      expect(session.expiresAt, now.millisecondsSinceEpoch ~/ 1000 + 3600);
      expect(session.toJson().keys, ['access_token', 'token_type', 'expires_in', 'expires_at', 'refresh_token', 'user']);
      expect(AuthSession.fromJson(session.toJson())!.refreshToken, 'r');
      expect(AuthSession.fromJson({'access_token': 'a'}), isNull);
      expect(AuthSession.fromJson('nonsense'), isNull);
    });
  });

  group('Supabase Auth, in words for people', () {
    test('a code is asked for without ever creating someone, with the publishable key', () async {
      await auth.api.sendCode(email: 'staff@example.test');
      expect(auth.bodies.single, {'email': 'staff@example.test', 'create_user': false});
      expect(auth.log.single, contains('key=publishable auth=null'));
      await auth.api.sendCode(phone: '+919800000001');
      expect(auth.bodies.last, {'phone': '+919800000001', 'create_user': false});
    });

    test('someone not added, and too many tries, are said plainly', () async {
      await expectLater(
        auth.api.sendCode(email: 'stranger@example.test'),
        throwsA(
          isA<AuthFailure>().having((f) => (f.kind, f.message), 'failure', (
            AuthProblem.notAllowed,
            "This email isn't registered for Dikho CRM. Contact an admin to get access.",
          )),
        ),
      );
      await expectLater(
        auth.api.sendCode(phone: '+910000000000'),
        throwsA(isA<AuthFailure>().having((f) => f.message, 'message', "This number isn't authorized. Contact an admin to get access.")),
      );
      auth.limitedFor = 37;
      await expectLater(
        auth.api.sendCode(email: 'staff@example.test'),
        throwsA(isA<AuthFailure>().having((f) => f.message, 'message', 'For your security, wait 37 seconds before asking for another code.')),
      );
    });

    test('a wrong code is refused; the right one is a session; email and WhatsApp verify differently', () async {
      await expectLater(
        auth.api.verify(email: 'staff@example.test', code: '000000'),
        throwsA(isA<AuthFailure>().having((f) => f.kind, 'kind', AuthProblem.invalidCode)),
      );
      final session = await auth.api.verify(phone: '+919800000001', code: '123456');
      expect(auth.bodies.last['type'], 'sms');
      expect(session.refreshToken, 'refresh-1');
      await auth.api.verify(email: 'staff@example.test', code: '123456');
      expect(auth.bodies.last['type'], 'email');
    });

    test('a spent refresh token means the session has gone', () async {
      final first = await auth.api.verify(email: 'staff@example.test', code: '123456');
      await auth.api.refresh(first.refreshToken);
      await expectLater(auth.api.refresh(first.refreshToken), throwsA(isA<AuthFailure>().having((f) => f.kind, 'kind', AuthProblem.sessionGone)));
    });

    test('no connection is a network problem, not a wrong code', () async {
      final dead = AuthApi(base: Uri.parse('http://localhost:1'), apiKey: 'k');
      await expectLater(dead.sendCode(email: 'staff@example.test'), throwsA(isA<AuthFailure>().having((f) => f.kind, 'kind', AuthProblem.network)));
    });
  });

  group('the one owner of the session', () {
    late MemoryStore store;
    late DateTime now;

    AuthController keeper() => AuthController(api: auth.api, storageKey: key, store: store, now: () => now, scheduleRefresh: false);

    Future<AuthController> signedIn() async {
      final controller = keeper();
      await controller.signedInWith(await auth.api.verify(email: 'staff@example.test', code: '123456'));
      return controller;
    }

    setUp(() {
      store = MemoryStore();
      now = DateTime.now();
    });

    test('signing in stores the session and checks the device once with a lasting id', () async {
      final controller = await signedIn();
      expect(controller.signedIn, isTrue);
      expect(jsonDecode(store.values[key]!)['refresh_token'], 'refresh-1');
      await Future<void>.delayed(const Duration(milliseconds: 50));
      final checks = auth.log.where((l) => l.contains('device-check')).toList();
      expect(checks.single, contains('auth=Bearer access-1'));
      final device = store.values[AuthController.deviceIdKey]!;
      expect(device, matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));
      await controller.signedInWith(await auth.api.verify(email: 'staff@example.test', code: '123456'));
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(store.values[AuthController.deviceIdKey], device, reason: 'the same phone keeps its id');
    });

    test('a session the page stored earlier is picked up, and refreshed if it is about to run out', () async {
      final page = await auth.api.verify(email: 'staff@example.test', code: '123456');
      store.values[key] = jsonEncode(page.toJson());
      final controller = keeper();
      now = page.expiry.subtract(const Duration(minutes: 2));
      await controller.load();
      expect(controller.signedIn, isTrue);
      expect(controller.session!.refreshToken, 'refresh-2');
      expect(jsonDecode(store.values[key]!)['refresh_token'], 'refresh-2');
    });

    test('one refresh at a time, however many ask, and none while the token is fresh', () async {
      final controller = await signedIn();
      expect(await controller.accessToken(), 'access-1');
      expect(auth.log.where((l) => l.contains('/token')), isEmpty);
      now = controller.session!.expiry.subtract(const Duration(minutes: 4));
      auth.slowRefresh = true;
      final tokens = await Future.wait([controller.accessToken(), controller.accessToken(), controller.readForPage(), controller.refreshForPage()]);
      expect(auth.log.where((l) => l.contains('/token')), hasLength(1));
      expect(tokens[0], 'access-2');
      expect(jsonDecode(tokens[3]!)['access_token'], 'access-2');
    });

    test('a session that has gone signs out and says so; offline keeps the token while it lasts', () async {
      final controller = await signedIn();
      auth.live.clear();
      now = controller.session!.expiry.subtract(const Duration(minutes: 1));
      await expectLater(controller.accessToken(), throwsA(isA<SessionUnavailable>()));
      expect(controller.state, AuthState.signedOut);
      expect(controller.notice, 'Your session was ended. Please sign in again.');
      expect(store.values.containsKey(key), isFalse);

      final offline = AuthController(
        api: AuthApi(base: Uri.parse('http://localhost:1'), apiKey: 'k'),
        storageKey: key,
        store: store,
        now: () => now,
        scheduleRefresh: false,
      );
      final session = AuthSession(
        accessToken: 'held',
        refreshToken: 'r',
        expiresAt: now.add(const Duration(minutes: 3)).millisecondsSinceEpoch ~/ 1000,
        user: const {'id': 'u'},
      );
      await offline.signedInWith(session);
      expect(await offline.accessToken(), 'held');
      expect(offline.signedIn, isTrue, reason: 'no connection is not a sign-out');
    });

    test('signing out ends only this phone\'s session on the server and forgets it here', () async {
      final controller = await signedIn();
      await controller.signOut();
      expect(controller.state, AuthState.signedOut);
      expect(store.values.containsKey(key), isFalse);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(
        auth.log.where((l) => l.contains('/auth/v1/logout')).single,
        allOf(contains('/auth/v1/logout?scope=local'), contains('auth=Bearer access-1')),
      );
      expect(controller.notice, isNull);
      await expectLater(controller.accessToken(), throwsA(isA<SessionUnavailable>()));
    });

    test('the page: its writes of the same session change nothing; its sign-out signs out without a second call', () async {
      final controller = await signedIn();
      final writes = store.values[key];
      await controller.writtenByPage(await controller.readForPage() ?? '');
      expect(store.values[key], writes);
      final before = auth.log.length;
      await controller.removedByPage();
      expect(controller.state, AuthState.signedOut);
      expect(auth.log.length, before, reason: 'the page told the server already');
      controller.explain('forced');
      expect(controller.notice, 'An administrator signed you out of Dikho.');
    });

    test('a page that signed in by itself (an older one) hands its session over', () async {
      final controller = keeper();
      await controller.load();
      expect(controller.state, AuthState.signedOut);
      final page = await auth.api.verify(email: 'staff@example.test', code: '123456');
      await controller.writtenByPage(jsonEncode(page.toJson()));
      expect(controller.signedIn, isTrue);
      expect(await controller.readForPage(), contains('refresh-1'));
    });
  });

  group('the sign-in screen', () {
    late MemoryStore store;
    late AuthController controller;

    setUp(() {
      store = MemoryStore();
      controller = AuthController(api: auth.api, storageKey: key, store: store, scheduleRefresh: false)..state = AuthState.signedOut;
    });

    Future<void> settle(WidgetTester tester) async {
      for (var i = 0; i < 10; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
        await tester.pump(const Duration(milliseconds: 50));
      }
    }

    Future<GlobalKey<SignInScreenState>> pump(WidgetTester tester) async {
      HttpOverrides.global = null;
      final screen = GlobalKey<SignInScreenState>();
      await tester.pumpWidget(
        MaterialApp(
          home: SignInScreen(key: screen, auth: controller),
        ),
      );
      return screen;
    }

    Future<void> done(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(minutes: 2));
    }

    testWidgets('email: a wrong address, then a code, a wrong code, the right code', (tester) async {
      final screen = await pump(tester);
      await tester.enterText(find.widgetWithText(TextField, 'Work email'), 'not an email');
      await tester.tap(find.text('Send code'));
      await tester.pump();
      expect(find.text('Enter your full email address.'), findsOneWidget);

      await tester.enterText(find.widgetWithText(TextField, 'Work email'), 'staff@example.test');
      await tester.tap(find.text('Send code'));
      await settle(tester);
      expect(find.text('Check your email'), findsOneWidget);
      expect(find.text('Send a new code in 60 s'), findsOneWidget);

      await tester.enterText(find.widgetWithText(TextField, 'Code'), '000000');
      await settle(tester);
      expect(find.text('That code is wrong or has expired. Check it, or send a new one.'), findsOneWidget);
      expect(controller.signedIn, isFalse);
      final codeField = tester.widget<TextField>(find.widgetWithText(TextField, 'Code'));
      expect(codeField.focusNode!.hasFocus, isTrue, reason: 'the keyboard stays up for the right code');
      expect(codeField.controller!.text, isEmpty);

      await tester.pump(const Duration(seconds: 60));
      expect(find.text('Send a new code'), findsOneWidget);

      expect(screen.currentState!.handleBack(), isTrue, reason: 'Back from the code returns to the email');
      await tester.pump();
      expect(find.text('Sign in to Dikho CRM'), findsOneWidget);
      expect(screen.currentState!.handleBack(), isFalse);

      await tester.tap(find.text('Send code'));
      await settle(tester);
      await tester.enterText(find.widgetWithText(TextField, 'Code'), '123456');
      await settle(tester);
      expect(controller.signedIn, isTrue, reason: 'six digits sign in by themselves');
      await done(tester);
    });

    testWidgets('WhatsApp: the number goes as E.164, and a number not added is told so', (tester) async {
      await pump(tester);
      await tester.tap(find.text('WhatsApp'));
      await tester.pump();
      await tester.enterText(find.widgetWithText(TextField, 'WhatsApp number'), '9800000002');
      await tester.tap(find.text('Send code'));
      await settle(tester);
      expect(auth.bodies.last['phone'], '+919800000002');
      expect(find.text("This number isn't authorized. Contact an admin to get access."), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'WhatsApp number'), '98000 00001');
      await tester.tap(find.text('Send code'));
      await settle(tester);
      expect(find.text('Check WhatsApp'), findsOneWidget);
      expect(find.textContaining('+919800000001', findRichText: true), findsOneWidget);
      await done(tester);
    });

    testWidgets('why the last session ended shows above the form', (tester) async {
      controller.notice = signOutNotice('suspended');
      await pump(tester);
      expect(find.text('Your access to Dikho has been suspended. Contact your administrator.'), findsOneWidget);
      await done(tester);
    });
  });
}
