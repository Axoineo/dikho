import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/settings/settings_controller.dart';
import 'package:dikho_crm/features/settings/settings_models.dart';
import 'package:dikho_crm/features/settings/settings_parts.dart';
import 'package:dikho_crm/features/settings/settings_screen.dart';
import 'package:dikho_crm/features/shell/shell_controller.dart';
import 'package:dikho_crm/features/shell/shell_messages.dart';
import 'package:dikho_crm/features/users/users_controller.dart';
import 'package:dikho_crm/features/users/users_screen.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:dikho_crm/shared/supabase_rest.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Native Settings against a stand-in for Supabase's REST API (the Settings database
// functions, media and sub_media) and the API Worker's /api/users/me routes. Every
// request is recorded with its body. Synthetic data only.

class FakeBackend {
  late HttpServer server;
  final log = <String>[];
  final bodies = <String, Object?>{};
  final calls = <String, int>{};

  /// Database functions that fail, with the status and body PostgREST would send.
  final failing = <String, (int, Map<String, Object?>)>{};

  /// Database functions whose connection drops before any answer.
  final dropping = <String>{};

  Map<String, Object?> preferences = {'page_size': 25};
  Map<String, Object?> organization = {'date_format': 'd MMM yyyy', 'number_format': 'en-IN'};
  var nextId = 100;
  List<Map<String, Object?>> lists = [
    {'id': 1, 'list_key': 'order_status', 'value': 'Open', 'label': null, 'sort_order': 10, 'hidden': false},
    {'id': 2, 'list_key': 'order_status', 'value': 'Closed', 'label': null, 'sort_order': 20, 'hidden': false},
    {'id': 3, 'list_key': 'order_status', 'value': 'Old', 'label': null, 'sort_order': 30, 'hidden': true},
    {'id': 4, 'list_key': 'row_color', 'value': '#185494', 'label': 'Blue', 'sort_order': 10, 'hidden': false},
  ];
  Map<String, Object?> company = {
    'legal_name': 'Example Media LLP',
    'gstin': null,
    'pan': null,
    'state_code': '27',
    'address_line1': '1 Test Road',
    'address_line2': null,
    'city': 'Pune',
    'state': 'Maharashtra',
    'pincode': '411001',
    'country': 'India',
    'bank_name': null,
    'bank_account_name': null,
    'bank_account_number': null,
    'bank_ifsc': null,
    'bank_branch': null,
  };
  List<Map<String, Object?>> media = [
    {'id': 1, 'name': 'Outdoor', 'hidden': false},
    {'id': 2, 'name': 'Print', 'hidden': true},
  ];
  List<Map<String, Object?>> subMedia = [
    {'id': 11, 'media_id': 1, 'name': 'Hoarding', 'hidden': false},
  ];

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final raw = await utf8.decoder.bind(request).join();
      final path = request.uri.path;
      final key = '${request.method} $path';
      log.add(key);
      calls[key] = (calls[key] ?? 0) + 1;
      final body = raw.isEmpty ? null : jsonDecode(raw);
      bodies[key] = body;
      final args = body is Map ? body.cast<String, Object?>() : <String, Object?>{};
      var status = 200;
      Object? data;
      var envelope = false;

      if (path.startsWith('/rest/v1/rpc/')) {
        final function = path.substring('/rest/v1/rpc/'.length);
        if (dropping.contains(function)) {
          final socket = await request.response.detachSocket(writeHeaders: false);
          socket.destroy();
          return;
        }
        final failure = failing[function];
        if (failure != null) {
          (status, data) = failure;
        } else {
          switch (function) {
            case 'get_settings':
              data = {'organization': organization, 'lists': lists};
            case 'set_my_preferences':
              preferences = {...preferences, ...(args['p_changes'] as Map).cast<String, Object?>()}..removeWhere((_, v) => v == null);
              data = preferences;
            case 'set_my_theme':
              status = 204;
            case 'update_organization_settings':
              organization = {...organization, ...(args['p_changes'] as Map).cast<String, Object?>()};
              data = organization;
            case 'get_organization_profile':
              data = company;
            case 'update_organization_profile':
              company = {...company, ...(args['p_changes'] as Map).cast<String, Object?>()};
              data = company;
            case 'add_list_option':
              final value = args['p_value'] as String;
              if (lists.any((r) => r['list_key'] == args['p_list'] && '${r['value']}'.toLowerCase() == value.toLowerCase())) {
                (status, data) = (409, {'code': 'PT409', 'message': 'That value is already in the list'});
              } else {
                final row = {'id': nextId++, 'list_key': args['p_list'], 'value': value, 'label': args['p_label'], 'sort_order': 99, 'hidden': false};
                lists = [...lists, row];
                data = row;
              }
            case 'set_list_option_hidden':
              lists = [
                for (final r in lists) r['id'] == args['p_id'] ? {...r, 'hidden': args['p_hidden']} : r,
              ];
              data = lists.firstWhere((r) => r['id'] == args['p_id']);
            case 'move_list_option':
              status = 204;
            case 'save_media':
              data = {'id': args['p_id'] ?? nextId++, 'name': args['p_name'], 'hidden': args['p_hidden'] ?? false};
            case 'save_sub_media':
              data = {'id': args['p_id'] ?? nextId++, 'media_id': args['p_media_id'], 'name': args['p_name'], 'hidden': args['p_hidden'] ?? false};
          }
        }
      } else if (path == '/rest/v1/media') {
        data = media;
      } else if (path == '/rest/v1/sub_media') {
        data = subMedia;
      } else if (key == 'GET /api/users/me') {
        envelope = true;
        data = {
          'user_id': 'me',
          'full_name': 'Mira Admin',
          'email': 'mira@example.test',
          'phone': '919800000001',
          'system_role': 'admin',
          'designation': 'Operations lead',
          'department': 'Sales',
          'team': 'North',
          'employee_id': 'E-1',
          'joining_date': '2025-04-01',
          'sessions': [
            {
              'session_id': '00000000-0000-4000-8000-000000000001',
              'user_agent': 'DikhoCRM/1.1.0 (Android)',
              'city': 'Pune',
              'country': 'IN',
              'signed_in_at': '2026-11-17T04:00:00Z',
              'last_seen_at': '2026-11-17T05:00:00Z',
              'current': true,
            },
            {
              'session_id': '00000000-0000-4000-8000-000000000002',
              'user_agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36',
              'city': 'Mumbai',
              'country': 'IN',
              'signed_in_at': '2026-11-16T04:00:00Z',
              'last_seen_at': '2026-11-16T05:00:00Z',
              'current': false,
            },
          ],
          'recent_sign_ins': const [],
        };
      } else if (path.endsWith('/sign-out')) {
        envelope = true;
        data = {'sessions_ended': 1};
      }
      request.response.statusCode = status;
      if (status != 204) {
        request.response
          ..headers.contentType = ContentType.json
          ..write(jsonEncode(envelope ? {'success': true, 'data': data} : data));
      }
      await request.response.close();
    });
  }

  Uri get base => Uri.parse('http://localhost:${server.port}');
  SupabaseRest get rest => SupabaseRest(base: base, apiKey: 'publishable', token: ({bool forceFresh = false}) async => 't');
  CrmApi get api => CrmApi(origin: base, token: ({bool forceFresh = false}) async => 't');
}

ShellAccess accessFor(Set<String> permissions, {String? theme, Map<String, Object?> preferences = const {}}) => ShellAccess(
  userId: 'me',
  name: 'Mira Admin',
  email: 'mira@example.test',
  allowed: {'/clients', '/sales-orders', '/whatsapp/inbox', '/users', '/settings', '/email/inbox'},
  permissions: permissions,
  helpOffered: false,
  helpRequested: false,
  supabaseUrl: '',
  publishableKey: '',
  theme: theme,
  preferences: preferences,
);

void main() {
  late FakeBackend backend;

  setUp(() async {
    HttpOverrides.global = null;
    backend = FakeBackend();
    await backend.start();
  });

  tearDown(() => backend.server.close(force: true));

  group('the web module\'s rules', () {
    test('company details are checked as on the web, and only changes are sent', () {
      final form = companyForm(backend.company);
      expect(form['country'], 'India');
      expect(form['gstin'], '', reason: 'nulls become empty fields');
      expect(companyProblems(form), isEmpty);
      expect(companyProblems({...form, 'legal_name': ' '})['legal_name'], 'Enter the legal name.');
      expect(companyProblems({...form, 'gstin': '27ABCDE1234F1Z5', 'pan': 'ABCDE1234G'})['pan'], 'This PAN is not the one inside the GSTIN.');
      expect(
        companyProblems({...form, 'gstin': '27ABCDE1234F1Z5', 'pan': 'ABCDE1234F', 'state_code': ''}),
        isEmpty,
        reason: 'the GSTIN gives the state code',
      );
      expect(derivedStateCode({...form, 'gstin': '27ABCDE1234F1Z5'}), '27');
      expect(companyProblems({...form, 'state_code': '7'})['state_code'], isNotNull);
      expect(companyProblems({...form, 'pincode': '011001'})['pincode'], 'Enter the 6-digit PIN code.');
      expect(companyProblems({...form, 'country': 'Nepal', 'pincode': '44600'}), isEmpty, reason: 'any PIN outside India');
      expect(companyProblems({...form, 'bank_ifsc': 'HDFC1234567'})['bank_ifsc'], isNotNull, reason: 'the fifth character is a zero');
      expect(companyProblems({...form, 'bank_account_number': '12345'})['bank_account_number'], 'Use 6 to 18 digits.');
      expect(companyChanges(form, {...form, 'city': 'Mumbai'}), {'city': 'Mumbai'});
    });

    test('formats read as what they look like', () {
      final day = DateTime(2026, 11, 7);
      expect(dateFormats.map((f) => formatDayAs(f, day)), ['7 Nov 2026', '07/11/2026', '2026-11-07']);
      expect(Regional.from(null), const Regional());
      expect(
        Regional.from({
          'organization': {'date_format': 'nonsense', 'number_format': 'en-US'},
        }),
        const Regional(numberFormat: 'en-US'),
      );
    });

    test('lists in their order, preferences as the database keeps them, start pages this person can open', () {
      final settings = {'lists': backend.lists};
      expect(optionsOf(settings, 'order_status').map((r) => r.name), ['Open', 'Closed', 'Old']);
      expect(optionsOf(settings, 'row_color').single.name, 'Blue');
      expect(const Preferences({'page_size': 50, 'start_page': '/clients'}).merged({'start_page': null}).raw, {'page_size': 50});
      expect(const Preferences({'page_size': 7}).pageSize, 25);
      final starts = startPagesFor(accessFor({}), emailHub: false).map((s) => s.$1);
      expect(starts, ['/clients', '/sales-orders', '/whatsapp/inbox', '/users', '/settings']);
      expect(startPagesFor(accessFor({}), emailHub: true).map((s) => s.$1), contains('/email/inbox'));
      expect(colourValue('#185494'), 0xFF185494);
      expect(colourValue('blue'), isNull);
    });
  });

  group('the database functions', () {
    test('a refusal written for people is shown; anything else is not', () {
      expect(
        SupabaseRest.rpcFailure(409, '{"code":"PT409","message":"That value is already in the list"}', reading: false).message,
        'That value is already in the list',
      );
      expect(
        SupabaseRest.rpcFailure(
          403,
          '{"code":"PT403","message":"You do not have permission to change organization settings"}',
          reading: false,
        ).message,
        contains('permission'),
      );
      final missing = SupabaseRest.rpcFailure(404, '{"code":"PGRST202","message":"Could not find the function public.get_settings"}', reading: true);
      expect(missing.message, 'This needs a database update that has not been applied yet.');
      expect(missing.code, 'PGRST202');
      expect(
        SupabaseRest.rpcFailure(409, '{"code":"23505","message":"duplicate key value violates unique constraint \\"x\\""}', reading: false).message,
        isNot(contains('duplicate key')),
      );
      expect(SupabaseRest.rpcFailure(500, 'not json', reading: true).message, contains('did not load'));
    });

    test('a change is never sent twice after a dropped connection; a read is tried again', () async {
      backend.dropping.addAll({'add_list_option', 'get_settings'});
      await expectLater(backend.rest.rpcWrite('add_list_option', {'p_list': 'order_type', 'p_value': 'X'}), throwsA(isA<ApiException>()));
      expect(backend.calls['POST /rest/v1/rpc/add_list_option'], 1);
      await expectLater(backend.rest.rpc('get_settings'), throwsA(isA<ApiException>()));
      expect(backend.calls['POST /rest/v1/rpc/get_settings'], 2);
    });
  });

  group('the controller', () {
    test('preferences save, take what the database kept, and go back when refused', () async {
      var changed = 0;
      final c = SettingsController(rest: backend.rest, api: backend.api, onChanged: ({required organization}) => changed++);
      c.usePreferences({'page_size': 25});
      await c.savePreferences({'page_size': 50});
      expect(backend.bodies['POST /rest/v1/rpc/set_my_preferences'], {
        'p_changes': {'page_size': 50},
      });
      expect(c.preferences.pageSize, 50);
      expect(changed, 1);
      backend.failing['set_my_preferences'] = (400, {'code': 'PT400', 'message': 'Rows per page must be 25, 50 or 100'});
      await expectLater(c.savePreferences({'page_size': 100}), throwsA(isA<ApiException>()));
      expect(c.preferences.pageSize, 50, reason: 'put back');
      c.dispose();
    });

    test('a list change reloads the lists and tells the other screens', () async {
      final changes = <bool>[];
      final c = SettingsController(rest: backend.rest, api: backend.api, onChanged: ({required organization}) => changes.add(organization));
      await c.loadSettings();
      expect(c.options('order_status').length, 3);
      await c.addOption('order_status', 'Dispatched');
      expect(backend.bodies['POST /rest/v1/rpc/add_list_option'], {'p_list': 'order_status', 'p_value': 'Dispatched', 'p_label': null});
      expect(c.options('order_status').map((r) => r.value), contains('Dispatched'), reason: 'get_settings read again');
      expect(changes, [true]);
      await c.saveCompany({'city': 'Mumbai'});
      expect(changes, [true, false], reason: 'the company is not in any list');
      c.dispose();
    });

    test('a database without the Settings update says so', () async {
      backend.failing['get_settings'] = (404, {'code': 'PGRST202', 'message': 'Could not find the function'});
      final c = SettingsController(rest: backend.rest, api: backend.api);
      await c.loadSettings();
      expect(c.notReady, isTrue);
      expect(c.settingsError, isNull);
      c.dispose();
    });
  });

  group('screens', () {
    Future<void> settle(WidgetTester tester) async {
      for (var i = 0; i < 12; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
        await tester.pump(const Duration(milliseconds: 50));
      }
    }

    late SettingsController controller;
    late UsersController users;
    late ShellController shell;
    var openedUsers = 0;

    Future<void> pump(WidgetTester tester, {Set<String> permissions = const {'settings.manage', 'users.view'}, String? theme}) async {
      HttpOverrides.global = null;
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.6;
      addTearDown(tester.view.reset);
      openedUsers = 0;
      controller = SettingsController(rest: backend.rest, api: backend.api);
      users = UsersController(api: backend.api);
      shell = ShellController()..setNativeAccess(accessFor(permissions, theme: theme, preferences: backend.preferences));
      final access = shell.access!;
      await tester.pumpWidget(
        ListenableBuilder(
          listenable: shell,
          builder: (_, _) => MaterialApp(
            themeMode: shell.themeMode,
            darkTheme: ThemeData.dark(),
            home: SettingsScreen(
              controller: controller,
              users: users,
              usersAbilities: const UsersAbilities(userId: 'me'),
              shell: shell,
              abilities: SettingsAbilities(
                access: access,
                manage: permissions.contains('settings.manage'),
                viewUsers: permissions.contains('users.view'),
                emailHub: false,
              ),
              onOpenDrawer: () {},
              onOpenUsers: () => openedUsers++,
            ),
          ),
        ),
      );
      await settle(tester);
    }

    Future<void> done(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox());
      controller.dispose();
      users.dispose();
      await tester.pump(const Duration(minutes: 1));
    }

    Future<void> open(WidgetTester tester, String tile) async {
      await tester.ensureVisible(find.text(tile));
      await tester.tap(find.text(tile));
      await settle(tester);
    }

    testWidgets('someone without settings.manage sees their own sections and why the rest is missing', (tester) async {
      await pump(tester, permissions: const {});
      expect(find.text('Profile'), findsOneWidget);
      expect(find.text('Preferences'), findsOneWidget);
      expect(find.text('Sign-in and security'), findsOneWidget);
      expect(find.text('Company'), findsNothing);
      expect(find.text('Lists and media'), findsNothing);
      expect(find.textContaining('changed by Owners and Admins'), findsOneWidget);
      expect(find.text('Users and roles'), findsNothing);
      await done(tester);
    });

    testWidgets('a manager has the organization too, and Users and roles opens Users', (tester) async {
      await pump(tester);
      expect(find.text('Company'), findsOneWidget);
      expect(find.text('Regional'), findsOneWidget);
      expect(find.text('Lists and media'), findsOneWidget);
      await open(tester, 'Users and roles');
      expect(openedUsers, 1);
      await done(tester);
    });

    testWidgets('profile: your details from /users/me', (tester) async {
      await pump(tester, permissions: const {});
      await open(tester, 'Profile');
      expect(backend.log, contains('GET /api/users/me'));
      expect(find.text('Operations lead'), findsOneWidget);
      expect(find.text('Sales · North'), findsOneWidget);
      expect(find.text('+919800000001'), findsOneWidget);
      expect(find.text('Your full profile and access'), findsOneWidget);
      await done(tester);
    });

    testWidgets('the theme changes at once and is saved; a refusal puts it back', (tester) async {
      await pump(tester, theme: 'light');
      await open(tester, 'Preferences');
      expect(tester.getSemantics(find.text('Theme')), isSemantics(label: 'Theme\nLight, dark, or the same as your phone.'));
      await tester.tap(find.text('Dark'));
      await settle(tester);
      expect(shell.themeMode, ThemeMode.dark);
      expect(backend.bodies['POST /rest/v1/rpc/set_my_theme'], {'p_theme': 'dark'});
      expect(find.text('Saved. Your theme follows you to every device.'), findsOneWidget);
      backend.failing['set_my_theme'] = (400, {'code': 'PT400', 'message': 'Unknown theme'});
      await tester.tap(find.text('System'));
      await settle(tester);
      expect(shell.themeMode, ThemeMode.dark, reason: 'put back');
      expect(find.text('Unknown theme'), findsOneWidget);
      await done(tester);
    });

    testWidgets('rows per page and the start page save as they change', (tester) async {
      await pump(tester);
      await open(tester, 'Preferences');
      await tester.ensureVisible(find.text('50'));
      await tester.tap(find.text('50'));
      await settle(tester);
      expect(backend.bodies['POST /rest/v1/rpc/set_my_preferences'], {
        'p_changes': {'page_size': 50},
      });
      await tester.ensureVisible(find.text('The first page you can open'));
      await tester.tap(find.text('The first page you can open'));
      await settle(tester);
      await tester.tap(find.text('Sales orders').last);
      await settle(tester);
      expect(backend.bodies['POST /rest/v1/rpc/set_my_preferences'], {
        'p_changes': {'start_page': '/sales-orders'},
      });
      expect(controller.preferences.raw, {'page_size': 50, 'start_page': '/sales-orders'});
      await done(tester);
    });

    testWidgets('sign-in and security: your devices, and ending another one', (tester) async {
      await pump(tester, permissions: const {});
      await open(tester, 'Sign-in and security');
      expect(find.text('Dikho app on Android · This device'), findsOneWidget);
      expect(find.text('Chrome on Windows'), findsOneWidget);
      await tester.tap(find.text('End session'));
      await settle(tester);
      expect(backend.bodies['POST /api/users/me/sign-out'], {'session_id': '00000000-0000-4000-8000-000000000002'});
      await tester.scrollUntilVisible(find.text('Signed in as mira@example.test.'), 300);
      expect(find.text('What administrators can see'), findsOneWidget);
      await done(tester);
    });

    testWidgets('company: checked before saving, and only the changes are sent', (tester) async {
      await pump(tester);
      await open(tester, 'Company');
      expect(find.text('Save changes'), findsNothing);
      await tester.enterText(find.widgetWithText(TextField, 'Legal name *'), '');
      await tester.pump();
      expect(find.text('Save changes'), findsOneWidget);
      await tester.tap(find.text('Save changes'));
      await settle(tester);
      expect(find.text('Enter the legal name.'), findsOneWidget);
      expect(backend.log, isNot(contains('POST /rest/v1/rpc/update_organization_profile')));
      await tester.enterText(find.widgetWithText(TextField, 'Legal name *'), 'Example Media LLP');
      await tester.enterText(find.widgetWithText(TextField, 'GSTIN'), '27abcde 1234f1z5');
      await tester.pump();
      expect(find.text('27ABCDE1234F1Z5'), findsOneWidget, reason: 'capitals, no spaces');
      expect(find.text('Taken from the GSTIN.'), findsOneWidget);
      await tester.tap(find.text('Save changes'));
      await settle(tester);
      expect(backend.bodies['POST /rest/v1/rpc/update_organization_profile'], {
        'p_changes': {'gstin': '27ABCDE1234F1Z5'},
      });
      expect(find.text('Company details saved'), findsOneWidget);
      expect(find.text('Save changes'), findsNothing);
      await done(tester);
    });

    testWidgets('regional: a choice is saved only with Save changes', (tester) async {
      await pump(tester);
      await open(tester, 'Regional');
      final today = DateTime.now();
      final slashed = formatDayAs('dd/MM/yyyy', today);
      await tester.tap(find.text(slashed));
      await settle(tester);
      expect(backend.log, isNot(contains('POST /rest/v1/rpc/update_organization_settings')));
      await tester.tap(find.text('Save changes'));
      await settle(tester);
      expect(backend.bodies['POST /rest/v1/rpc/update_organization_settings'], {
        'p_changes': {'date_format': 'dd/MM/yyyy', 'number_format': 'en-IN'},
      });
      expect(find.text('Saved. Everyone else sees it the next time they open Dikho.'), findsOneWidget);
      await done(tester);
    });

    testWidgets('a list: move, hide, add, and the database\'s refusal in its own words', (tester) async {
      await pump(tester);
      await open(tester, 'Lists and media');
      expect(find.text('Sales and purchase orders. 2 values, 1 hidden.'), findsOneWidget);
      await open(tester, 'Order statuses');
      expect(find.text('Hidden from dropdowns'), findsOneWidget);
      await tester.tap(find.byTooltip('Change Open'));
      await settle(tester);
      await tester.tap(find.text('Move down'));
      await settle(tester);
      expect(backend.bodies['POST /rest/v1/rpc/move_list_option'], {'p_id': 1, 'p_direction': 1});
      await tester.tap(find.byTooltip('Change Old'));
      await settle(tester);
      await tester.tap(find.text('Show in dropdowns'));
      await settle(tester);
      expect(backend.bodies['POST /rest/v1/rpc/set_list_option_hidden'], {'p_id': 3, 'p_hidden': false});
      await tester.ensureVisible(find.text('Add'));
      await tester.tap(find.text('Add'));
      await tester.pump();
      expect(find.text('Type the new value.'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'New order status'), 'open');
      await tester.tap(find.text('Add'));
      await settle(tester);
      expect(find.text('That value is already in the list'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'New order status'), 'Dispatched');
      await tester.tap(find.text('Add'));
      await settle(tester);
      expect(backend.bodies['POST /rest/v1/rpc/add_list_option'], {'p_list': 'order_status', 'p_value': 'Dispatched', 'p_label': null});
      expect(find.text('Dispatched'), findsOneWidget);
      await done(tester);
    });

    testWidgets('a row colour is a colour and a name', (tester) async {
      await pump(tester);
      await open(tester, 'Lists and media');
      await open(tester, 'Row colours');
      await tester.tap(find.bySemanticsLabel('Green'));
      await tester.pump();
      await tester.enterText(find.widgetWithText(TextField, 'Name of the new colour'), 'Urgent');
      await tester.ensureVisible(find.text('Add'));
      await tester.tap(find.text('Add'));
      await settle(tester);
      expect(backend.bodies['POST /rest/v1/rpc/add_list_option'], {'p_list': 'row_color', 'p_value': '#1e6b3a', 'p_label': 'Urgent'});
      await done(tester);
    });

    testWidgets('media: rename one, and add a sub media under it', (tester) async {
      await pump(tester);
      await open(tester, 'Lists and media');
      await open(tester, 'Media and sub media');
      expect(find.text('1 sub media'), findsOneWidget);
      expect(find.text('0 sub media · Hidden from pickers'), findsOneWidget);
      await tester.tap(find.byTooltip('Change Outdoor'));
      await settle(tester);
      await tester.tap(find.text('Rename'));
      await settle(tester);
      await tester.enterText(find.widgetWithText(TextField, 'Media name'), 'Outdoor ads');
      await tester.tap(find.text('Save'));
      await settle(tester);
      expect(backend.bodies['POST /rest/v1/rpc/save_media'], {'p_id': 1, 'p_name': 'Outdoor ads', 'p_hidden': null});
      await open(tester, 'Outdoor');
      expect(find.text('Hoarding'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'New sub media for Outdoor'), 'Bus shelter');
      await tester.tap(find.text('Add'));
      await settle(tester);
      expect(backend.bodies['POST /rest/v1/rpc/save_sub_media'], {'p_id': null, 'p_media_id': 1, 'p_name': 'Bus shelter', 'p_hidden': null});
      await done(tester);
    });

    testWidgets('organization screens on a database without the update say so', (tester) async {
      backend.failing['get_settings'] = (404, {'code': 'PGRST202', 'message': 'Could not find the function'});
      backend.failing['get_organization_profile'] = (404, {'code': 'PGRST202', 'message': 'Could not find the function'});
      await pump(tester);
      await open(tester, 'Company');
      expect(find.textContaining('need a database update'), findsOneWidget);
      await tester.pageBack();
      await settle(tester);
      await open(tester, 'Regional');
      expect(find.textContaining('need a database update'), findsOneWidget);
      await done(tester);
    });
  });

  group('the save bar', () {
    Future<void> bar(WidgetTester tester, {required Size size, double text = 1}) async {
      tester.view.physicalSize = size * 2.625;
      tester.view.devicePixelRatio = 2.625;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery.withClampedTextScaling(
            minScaleFactor: text,
            maxScaleFactor: text,
            child: Scaffold(
              body: const SizedBox.shrink(),
              bottomNavigationBar: SaveBar(busy: false, onSave: () {}, onCancel: () {}),
            ),
          ),
        ),
      );
    }

    double top(WidgetTester tester, String label) => tester.getTopLeft(find.text(label)).dy;

    testWidgets('on a phone: the words above, both buttons on one line', (tester) async {
      await bar(tester, size: const Size(411, 914));
      expect(top(tester, 'Cancel'), moreOrLessEquals(top(tester, 'Save changes'), epsilon: 2));
      expect(top(tester, 'You have unsaved changes'), lessThan(top(tester, 'Cancel') - 20));
      expect(tester.takeException(), isNull);
    });

    testWidgets('on a phone with very large text the buttons stack, and nothing overflows', (tester) async {
      await bar(tester, size: const Size(360, 780), text: 2);
      expect(top(tester, 'Save changes'), greaterThan(top(tester, 'Cancel') + 20));
      expect(tester.takeException(), isNull);
    });

    testWidgets('on a wide screen: one row', (tester) async {
      await bar(tester, size: const Size(900, 700));
      expect(top(tester, 'You have unsaved changes'), moreOrLessEquals(top(tester, 'Cancel'), epsilon: 12));
      expect(top(tester, 'Cancel'), moreOrLessEquals(top(tester, 'Save changes'), epsilon: 2));
    });
  });
}
