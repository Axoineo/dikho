import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/users/permission_editor.dart';
import 'package:dikho_crm/features/users/user_forms.dart';
import 'package:dikho_crm/features/users/user_profile_screen.dart';
import 'package:dikho_crm/features/users/users_controller.dart';
import 'package:dikho_crm/features/users/users_models.dart';
import 'package:dikho_crm/features/users/users_screen.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Native User Management against a stand-in for the API Worker's /api/users routes.
// Every request is recorded with its body. Synthetic people only.

Map<String, Object?> catalogJson() => {
  'actor': {
    'user_id': 'me',
    'system_role': 'admin',
    'rank': 20,
    'permissions': {
      'users.view': 'all',
      'users.create': 'all',
      'clients.view': 'all',
      'clients.create': 'all',
      'clients.edit': 'own',
      'sales_orders.view': 'all',
    },
  },
  'templates': [
    {
      'id': 't1',
      'key': 'sales_executive',
      'name': 'Sales executive',
      'built_in': true,
      'members': 2,
      'permissions': {'clients.view': 'all', 'sales_orders.view': 'own'},
    },
    {
      'id': 't2',
      'key': 'finance',
      'name': 'Finance',
      'built_in': false,
      'members': 0,
      'permissions': {'invoices.view': 'all'},
    },
  ],
  'departments': [
    {
      'id': 'd1',
      'name': 'Sales',
      'archived': false,
      'members': 3,
      'teams': [
        {'id': 'tm1', 'name': 'North', 'archived': false, 'members': 2},
      ],
    },
  ],
  'permissions': [
    {
      'key': 'clients.view',
      'module': 'Clients',
      'action': 'view',
      'label': 'View clients',
      'allowed_scopes': ['own', 'all'],
    },
    {
      'key': 'clients.create',
      'module': 'Clients',
      'action': 'create',
      'label': 'Add clients',
      'allowed_scopes': ['all'],
    },
    {
      'key': 'clients.edit',
      'module': 'Clients',
      'action': 'edit',
      'label': 'Edit clients',
      'allowed_scopes': ['own', 'all'],
    },
    {
      'key': 'sales_orders.view',
      'module': 'Sales orders',
      'action': 'view',
      'label': 'View sales orders',
      'allowed_scopes': ['own', 'all'],
    },
    {
      'key': 'invoices.view',
      'module': 'Invoices',
      'action': 'view',
      'label': 'View invoices',
      'allowed_scopes': ['all'],
    },
    {
      'key': 'dev.tools',
      'module': 'Developer',
      'action': 'use',
      'label': 'Developer tools',
      'developer_only': true,
      'allowed_scopes': ['all'],
    },
  ],
  'role_permissions': {
    'manager': {'clients.edit': 'all'},
  },
};

Map<String, Object?> person(
  String id,
  String name, {
  String role = 'staff',
  String status = 'active',
  bool online = false,
  String template = 't1',
  Map<String, Object?> extra = const {},
}) => {
  'user_id': id,
  'full_name': name,
  'email': '${name.split(' ').first.toLowerCase()}@example.test',
  'system_role': role,
  'status': status,
  'online': online,
  'template_id': template,
  'template': template == 't1' ? 'Sales executive' : null,
  'department_id': 'd1',
  'department': 'Sales',
  'last_seen_section': online ? 'sales-orders' : null,
  ...extra,
};

class FakeApi {
  late HttpServer server;
  final log = <String>[];
  final bodies = <String, Object?>{};
  var members = <Map<String, Object?>>[
    person('me', 'Mira Admin', role: 'admin', online: true),
    person('u2', 'Asha Rao', extra: {'employee_id': 'E-2', 'can_manage': true, 'overrides': {}, 'active_sessions': 1}),
    person('u3', 'Ravi Kumar', status: 'invited'),
    person('u4', 'Suresh Old', status: 'suspended'),
    person('u5', 'Gone Person', status: 'archived'),
    person('u6', 'Olivia Owner', role: 'owner'),
  ];

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final raw = await utf8.decoder.bind(request).join();
      final key = '${request.method} ${request.uri.path}';
      log.add('$key${request.uri.hasQuery ? '?${request.uri.query}' : ''}');
      bodies[key] = raw.isEmpty ? null : jsonDecode(raw);
      final path = request.uri.path;
      Object? data;
      if (key == 'GET /api/users') {
        data = members;
      } else if (key == 'GET /api/users/catalog') {
        data = catalogJson();
      } else if (key == 'GET /api/users/audit') {
        data = [
          {
            'id': 9,
            'event_type': 'user.role_changed',
            'actor': 'Mira Admin',
            'target': 'Asha Rao',
            'target_user_id': 'u2',
            'occurred_at': '2026-11-17T05:30:00Z',
            'old_value': {'system_role': 'staff'},
            'new_value': {'system_role': 'manager'},
          },
          {
            'id': 8,
            'event_type': 'access.denied',
            'actor': 'Asha Rao',
            'occurred_at': '2026-11-16T05:30:00Z',
            'metadata': {'message': 'Not allowed'},
          },
        ];
      } else if (key == 'POST /api/users') {
        final added = person('u9', 'New Person', status: 'invited');
        members = [...members, added];
        data = {
          'user': added,
          'welcome': {'sent': true, 'channel': 'email'},
          'reused_account': false,
        };
      } else if (path.endsWith('/status')) {
        data = {'user': members[1], 'sign_in_updated': true};
      } else if (path.endsWith('/sign-out')) {
        data = {'sessions_ended': 2};
      } else if (path.endsWith('/permissions') || request.method == 'PATCH') {
        data = {...members[1], ...?(jsonDecode(raw) as Map?)?.cast<String, Object?>()};
      } else if (path == '/api/users/org-units' || path.startsWith('/api/users/templates')) {
        data = catalogJson();
      } else if (request.method == 'GET' && path.startsWith('/api/users/')) {
        final id = path.split('/').last;
        data = {
          ...members.firstWhere((m) => m['user_id'] == id),
          'permissions': {
            'clients.view': {'scope': 'all', 'source': 'template'},
            'sales_orders.view': {'scope': 'own', 'source': 'template'},
          },
          'sessions': [
            {
              'session_id': 's1',
              'user_agent': 'DikhoCRM/1.1.0 (Android)',
              'city': 'Pune',
              'region': 'Maharashtra',
              'country': 'IN',
              'signed_in_at': '2026-11-17T04:00:00Z',
              'last_seen_at': '2026-11-17T05:00:00Z',
              'current': false,
            },
          ],
          'recent_sign_ins': const [],
        };
      }
      request.response
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({'success': true, 'data': data}));
      await request.response.close();
    });
  }

  Uri get base => Uri.parse('http://localhost:${server.port}');
  CrmApi get api => CrmApi(origin: base, token: ({bool forceFresh = false}) async => 't');
}

void main() {
  late FakeApi backend;

  setUp(() async {
    HttpOverrides.global = null;
    backend = FakeApi();
    await backend.start();
  });

  tearDown(() => backend.server.close(force: true));

  group('the web module\'s rules', () {
    final catalog = Catalog(catalogJson());
    final now = DateTime.now();

    test('names, times and devices read as on the web', () {
      expect(initials('Asha (Finance) Rao'), 'AR');
      expect(initials('(x)'), 'X');
      expect(relativeTime(now.subtract(const Duration(minutes: 5)).toUtc().toIso8601String(), now), '5 min ago');
      expect(relativeTime(now.subtract(const Duration(hours: 30)).toUtc().toIso8601String(), now), 'yesterday');
      expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36'), 'Chrome on Windows');
      expect(deviceLabel('DikhoCRM/1.1.0 (Android)'), 'Dikho app on Android');
      expect(Member(person('a', 'A', online: true)).activity(now), 'Online · Sales orders');
      expect(Member(person('b', 'B')).activity(now), 'Never signed in');
    });

    test('an admin hands out only roles below theirs; a template only within their own access', () {
      expect(catalog.assignableRoles(), ['staff'], reason: 'no users.roles: Staff only');
      final owner = Catalog({
        ...catalogJson(),
        'actor': {'system_role': 'owner', 'rank': 40, 'permissions': {}},
      });
      expect(owner.assignableRoles(), ['staff', 'manager', 'admin', 'owner']);
      expect(catalog.withinReach(catalog.template('t1')!), isTrue);
      expect(catalog.withinReach(catalog.template('t2')!), isFalse, reason: 'the actor has no invoices.view');
    });

    test('a role adds to a template, the wider reach winning', () {
      expect(catalog.inherited('t1', 'staff'), {'clients.view': 'all', 'sales_orders.view': 'own'});
      expect(catalog.inherited('t1', 'manager')['clients.edit'], 'all');
    });

    test('each change is the smallest override that gives it', () {
      final inherited = catalog.inherited('t1', 'staff');
      final view = catalog.permission('clients.view')!;
      final add = catalog.permission('clients.create')!;
      var o = setUserPermission({}, inherited, view, on: false, widest: 'all');
      expect(o, {
        'clients.view': {'effect': 'revoke'},
      });
      o = setUserPermission(o, inherited, view, on: true, widest: 'all');
      expect(o, isEmpty, reason: 'back to the template leaves nothing behind');
      o = setUserPermission(o, inherited, add, on: true, widest: catalog.widestFor(add));
      expect(o, {
        'clients.create': {'effect': 'grant', 'scope': 'all'},
      });
      expect(userPermissionState(add, inherited, o).source, PermissionSource.added);
      o = setUserPermission(o, inherited, catalog.permission('sales_orders.view')!, on: true, scope: 'all', widest: 'all');
      expect(o['sales_orders.view'], {'effect': 'grant', 'scope': 'all'}, reason: 'wider than the template');
      expect(catalog.canGrant(catalog.permission('dev.tools')!), isFalse);
      expect(catalog.canGrant(catalog.permission('clients.edit')!, 'all'), isFalse, reason: 'the actor has edit for their own only');
    });

    test('audit entries read as sentences, with what changed', () {
      final e = AuditEvent({
        'event_type': 'user.role_changed',
        'actor': 'Mira',
        'target': 'Asha',
        'old_value': {'system_role': 'staff'},
        'new_value': {'system_role': 'manager'},
      });
      expect(e.sentence, 'Mira changed the system role of Asha');
      expect(e.details(catalog), ['Staff → Manager']);
      final perms = AuditEvent({
        'event_type': 'user.permissions_changed',
        'actor': 'Mira',
        'target': 'Asha',
        'old_value': {},
        'new_value': {
          'clients.view': {'effect': 'revoke'},
        },
      });
      expect(perms.details(catalog), ['View clients: as template → removed']);
      expect(
        AuditEvent({'event_type': 'user.signed_out_everywhere', 'actor': 'Mira', 'target': 'Asha'}).sentence,
        'Mira signed out Asha on every device',
      );
    });
  });

  group('the controller', () {
    test('the people, filtered and searched as on the web, with the counts', () async {
      final c = UsersController(api: backend.api);
      await c.load();
      expect(c.shown.map((m) => m.userId), ['me', 'u2', 'u3', 'u4', 'u6'], reason: 'archived are hidden by default');
      expect((c.counts.total, c.counts.online, c.counts.invited, c.counts.admins), (5, 1, 1, 2));
      c.setFilter(const PeopleFilter(status: 'invited'));
      expect(c.shown.single.name, 'Ravi Kumar');
      c.setFilter(const PeopleFilter(status: ''));
      c.setQuery('E-2');
      expect(c.shown.single.name, 'Asha Rao', reason: 'employee ID is searched');
      c.dispose();
    });

    test('changes go to the right routes with the right bodies', () async {
      final c = UsersController(api: backend.api);
      final status = await c.setStatus('u2', 'suspended', 'Left the team');
      expect(status.signInUpdated, isTrue);
      expect(backend.bodies['POST /api/users/u2/status'], {'status': 'suspended', 'reason': 'Left the team'});
      expect(await c.signOut('u2', sessionId: 's1'), 2);
      expect(backend.bodies['POST /api/users/u2/sign-out'], {'session_id': 's1'});
      await c.setOverrides('u2', {
        'clients.view': {'effect': 'revoke'},
      });
      expect(backend.bodies['PUT /api/users/u2/permissions'], {
        'overrides': {
          'clients.view': {'effect': 'revoke'},
        },
      });
      await c.saveOrgUnit(kind: 'team', departmentId: 'd1', name: ' South ');
      expect(backend.bodies['POST /api/users/org-units'], {'kind': 'team', 'department_id': 'd1', 'name': 'South'});
      final events = await c.audit(user: 'u2', before: '9');
      expect(backend.log.last, 'GET /api/users/audit?user=u2&before=9');
      expect(events.first.type, 'user.role_changed');
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

    const everything = UsersAbilities(
      userId: 'me',
      create: true,
      edit: true,
      permissions: true,
      suspend: true,
      sessions: true,
      audit: true,
      templates: true,
      departments: true,
    );

    Future<UsersController> pump(WidgetTester tester, {UsersAbilities abilities = everything}) async {
      HttpOverrides.global = null;
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.6;
      addTearDown(tester.view.reset);
      final c = UsersController(api: backend.api);
      await tester.pumpWidget(
        MaterialApp(
          home: UsersScreen(controller: c, abilities: abilities, onOpenDrawer: () {}),
        ),
      );
      await settle(tester);
      return c;
    }

    Future<void> done(WidgetTester tester, UsersController c) async {
      await tester.pumpWidget(const SizedBox());
      c.dispose();
      await tester.pump(const Duration(minutes: 1));
    }

    testWidgets('the list: who, their role and activity, and the counts as filters', (tester) async {
      final c = await pump(tester);
      expect(find.text('Mira Admin (you)'), findsOneWidget);
      expect(find.text('Admin · Online · Sales orders'), findsOneWidget);
      expect(find.text('Invited'), findsWidgets);
      expect(find.text('Gone Person'), findsNothing);
      await tester.ensureVisible(find.text('Invited 1'));
      await tester.pump();
      await tester.tap(find.text('Invited 1'));
      await tester.pump();
      expect(find.text('Asha Rao'), findsNothing);
      expect(find.text('Ravi Kumar'), findsOneWidget);
      expect(find.text('Add user'), findsOneWidget);
      await done(tester, c);
    });

    testWidgets('nothing refreshes while the app is behind another, and coming back reloads at once', (tester) async {
      final c = await pump(tester);
      int listReads() => backend.log.where((l) => l == 'GET /api/users').length;
      final before = listReads();
      for (final state in [AppLifecycleState.inactive, AppLifecycleState.hidden, AppLifecycleState.paused]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      await tester.pump(const Duration(minutes: 2));
      await settle(tester);
      expect(listReads(), before, reason: 'the 30-second refresh is stopped');
      for (final state in [AppLifecycleState.hidden, AppLifecycleState.inactive, AppLifecycleState.resumed]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      await settle(tester);
      expect(listReads(), before + 1);
      await tester.pump(const Duration(seconds: 31));
      await settle(tester);
      expect(listReads(), before + 2, reason: 'and the refresh runs again');
      await done(tester, c);
    });

    testWidgets('without users.create there is no Add user', (tester) async {
      final c = await pump(tester, abilities: const UsersAbilities(userId: 'me'));
      expect(find.text('Add user'), findsNothing);
      await done(tester, c);
    });

    testWidgets('a profile: details, a suspension asked about first with a reason', (tester) async {
      final c = await pump(tester);
      await tester.tap(find.text('Asha Rao'));
      await settle(tester);
      expect(find.byType(UserProfileScreen), findsOneWidget);
      expect(find.text('Contact and sign-in'), findsOneWidget);
      await tester.tap(find.byTooltip('Actions'));
      await tester.pumpAndSettle();
      expect(find.text('Sign out everywhere'), findsOneWidget);
      await tester.tap(find.text('Suspend'));
      await tester.pumpAndSettle();
      expect(find.text('Suspend Asha Rao?'), findsOneWidget);
      expect(backend.log.where((l) => l.endsWith('/status')), isEmpty, reason: 'nothing until confirmed');
      await tester.enterText(find.widgetWithText(TextField, 'Reason (optional)'), 'Left');
      await tester.tap(find.text('Suspend and sign out'));
      await settle(tester);
      expect(backend.bodies['POST /api/users/u2/status'], {'status': 'suspended', 'reason': 'Left'});
      await done(tester, c);
    });

    testWidgets('sessions: the app named as such, and one ended', (tester) async {
      final c = await pump(tester);
      await tester.tap(find.text('Asha Rao'));
      await settle(tester);
      await tester.tap(find.text('Sessions'));
      await settle(tester);
      expect(find.text('Dikho app on Android'), findsOneWidget);
      expect(find.textContaining('Near Pune, Maharashtra, IN'), findsOneWidget);
      await tester.tap(find.text('End session'));
      await settle(tester);
      expect(backend.bodies['POST /api/users/u2/sign-out'], {'session_id': 's1'});
      await done(tester, c);
    });

    testWidgets('access: a permission switched off saves as the smallest change', (tester) async {
      final c = await pump(tester);
      await tester.tap(find.text('Asha Rao'));
      await settle(tester);
      await tester.tap(find.text('Access'));
      await settle(tester);
      expect(find.byType(PermissionEditor), findsOneWidget);
      final viewClients = find.ancestor(of: find.text('View clients'), matching: find.byType(Row)).first;
      await tester.tap(find.descendant(of: viewClients, matching: find.byType(Switch)));
      await tester.pump();
      expect(find.text('Removed for this person'), findsOneWidget);
      expect(find.text('Unsaved changes to their access.'), findsOneWidget);
      await tester.tap(find.text('Save'));
      await settle(tester);
      expect(backend.bodies['PUT /api/users/u2/permissions'], {
        'overrides': {
          'clients.view': {'effect': 'revoke'},
        },
      });
      await done(tester, c);
    });

    testWidgets('adding someone needs an email or a number, then sends exactly what was filled in', (tester) async {
      final c = await pump(tester);
      await tester.tap(find.text('Add user'));
      await settle(tester);
      expect(find.byType(AddUserScreen), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'Full name *'), 'New Person');
      await tester.tap(find.text('Add'));
      await tester.pump();
      expect(find.textContaining('Enter an email address or a WhatsApp number'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'Email'), 'new@example.test');
      await tester.tap(find.text('Add'));
      await settle(tester);
      expect(backend.bodies['POST /api/users'], {'send_welcome': true, 'full_name': 'New Person', 'email': 'new@example.test', 'template_id': 't1'});
      expect(find.byType(UserProfileScreen), findsOneWidget, reason: 'opens the person just added');
      await done(tester, c);
    });
  });
}
