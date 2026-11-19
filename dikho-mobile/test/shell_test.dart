import 'dart:convert';

import 'package:dikho_crm/features/shell/nav_items.dart';
import 'package:dikho_crm/features/shell/shell_controller.dart';
import 'package:dikho_crm/features/shell/shell_messages.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _access = ShellAccess(
  userId: 'u',
  name: 'Asha Rao',
  email: 'a@example.test',
  allowed: {'/clients', '/whatsapp/inbox', '/settings'},
  permissions: {'inbox.view'},
  helpOffered: true,
  helpRequested: false,
  supabaseUrl: 'https://x.example.test',
  publishableKey: 'public',
);

void main() {
  group('what the page may say', () {
    test('malformed bodies are dropped', () {
      for (final body in ['', 'not json', '[1]', '3', '{"t":"nonsense"}', '{"no":"type"}']) {
        expect(parseShellMessage(body), isNull, reason: body);
      }
    });

    test('a route must look like one', () {
      expect((parseShellMessage('{"t":"route","path":"/clients"}') as RouteMessage).path, '/clients');
      for (final path in ['clients', '//evil.example', '/a?b=c', '/a b', 'javascript:alert(1)', '/${'x' * 200}']) {
        expect(parseShellMessage(jsonEncode({'t': 'route', 'path': path})), isNull, reason: path);
      }
      expect(parseShellMessage('{"t":"route","path":5}'), isNull);
    });

    test('a token is bounded, and may be absent', () {
      expect((parseShellMessage('{"t":"token","id":3,"token":"abc"}') as TokenMessage).token, 'abc');
      expect((parseShellMessage('{"t":"token","id":3,"token":null}') as TokenMessage).token, isNull);
      expect(parseShellMessage(jsonEncode({'t': 'token', 'id': 3, 'token': 'x' * 9000})), isNull);
      expect(parseShellMessage('{"t":"token","id":"3","token":"abc"}'), isNull);
    });

    test('access drops anything out of shape, and too-long lists entirely', () {
      final message = parseShellMessage(
        jsonEncode({
          't': 'access',
          'userId': 'u',
          'name': 'x' * 500,
          'email': 'a@example.test',
          'allowed': ['/clients', 'javascript:x', 5, '/a b'],
          'permissions': ['inbox.view', 'NOT VALID', null],
        }),
      ) as AccessMessage;
      expect(message.access.name, '');
      expect(message.access.allowed, {'/clients'});
      expect(message.access.permissions, {'inbox.view'});

      final flood = parseShellMessage(jsonEncode({'t': 'access', 'allowed': List.filled(500, '/clients')})) as AccessMessage;
      expect(flood.access.allowed, isEmpty);
    });

    test('scopes keep only known reaches, and a page without them gives all for what is held', () {
      final message = parseShellMessage(
        jsonEncode({
          't': 'access',
          'permissions': ['sales_orders.edit', 'sales_orders.create', 'clients.edit'],
          'scopes': {'sales_orders.edit': 'own', 'sales_orders.create': 'everything', 'NOT VALID': 'all', 'clients.edit': 'all'},
        }),
      ) as AccessMessage;
      expect(message.access.scopes, {'sales_orders.edit': 'own', 'clients.edit': 'all'});
      expect(message.access.scopeOf('sales_orders.edit'), 'own');
      expect(message.access.scopeOf('sales_orders.create'), isNull, reason: 'an unknown reach is not guessed at');
      expect(message.access.scopeOf('vendors.edit'), isNull, reason: 'not held');

      final older = parseShellMessage(
        jsonEncode({
          't': 'access',
          'permissions': ['sales_orders.edit'],
        }),
      ) as AccessMessage;
      expect(older.access.scopes, isNull);
      expect(older.access.scopeOf('sales_orders.edit'), 'all');
      expect(older.access.scopeOf('sales_orders.view'), isNull);

      final flood = parseShellMessage(
        jsonEncode({
          't': 'access',
          'permissions': ['a.b'],
          'scopes': {for (var i = 0; i < 400; i++) 'a.b$i': 'all'},
        }),
      ) as AccessMessage;
      expect(flood.access.scopes, isNull);
    });

    test('only the native screens can be opened by name', () {
      expect(parseShellMessage('{"t":"open","screen":"inbox"}'), isA<OpenScreenMessage>());
      expect((parseShellMessage('{"t":"open","screen":"leads"}')! as OpenScreenMessage).screen, 'leads');
      expect((parseShellMessage('{"t":"open","screen":"dashboard"}')! as OpenScreenMessage).screen, 'dashboard');
      expect((parseShellMessage('{"t":"open","screen":"whatsapp-contacts"}')! as OpenScreenMessage).screen, 'whatsapp-contacts');
      expect((parseShellMessage('{"t":"open","screen":"whatsapp-campaigns"}')! as OpenScreenMessage).screen, 'whatsapp-campaigns');
      expect((parseShellMessage('{"t":"open","screen":"vendors"}')! as OpenScreenMessage).screen, 'vendors');
      expect((parseShellMessage('{"t":"open","screen":"sales-orders"}')! as OpenScreenMessage).screen, 'sales-orders');
      expect((parseShellMessage('{"t":"open","screen":"purchase-orders"}')! as OpenScreenMessage).screen, 'purchase-orders');
      expect((parseShellMessage('{"t":"open","screen":"users"}')! as OpenScreenMessage).screen, 'users');
      expect((parseShellMessage('{"t":"open","screen":"settings"}')! as OpenScreenMessage).screen, 'settings');
      expect((parseShellMessage('{"t":"open","screen":"email-inbox"}')! as OpenScreenMessage).screen, 'email-inbox');
      expect((parseShellMessage('{"t":"open","screen":"email"}')! as OpenScreenMessage).screen, 'email');
      expect((parseShellMessage('{"t":"open","screen":"email-settings"}')! as OpenScreenMessage).screen, 'email-settings');
      expect((parseShellMessage('{"t":"open","screen":"email-consent"}')! as OpenScreenMessage).screen, 'email-consent');
      expect(parseShellMessage('{"t":"open","screen":"email-connect"}'), isNull, reason: "Google's return is a link, never a screen the page opens");
      expect(parseShellMessage('{"t":"open","screen":"contacts"}'), isNull);
    });
  });

  group('the page and the session', () {
    late List<String> scripts;
    late ShellController shell;
    late DateTime now;

    setUp(() {
      scripts = [];
      now = DateTime.utc(2026, 11, 6, 12);
      shell = ShellController(now: () => now)..attachPage((script) async => scripts.add(script));
    });

    test('the page says why it signed out, once, and only reasons the app knows', () {
      shell.handle(const AccessMessage(_access));
      expect(shell.signedIn, isTrue);
      shell.handle(parseShellMessage('{"t":"signedOut","reason":"forced"}')!);
      expect(shell.signedIn, isFalse);
      expect(shell.takeSignOutReason(), 'forced');
      expect(shell.takeSignOutReason(), isNull, reason: 'said once');
      expect((parseShellMessage('{"t":"signedOut","reason":"made up"}')! as SignedOutMessage).reason, isNull);
      expect((parseShellMessage('{"t":"signedOut"}')! as SignedOutMessage).reason, isNull);
      expect((parseShellMessage('{"t":"signedOut","reason":"not_staff"}')! as SignedOutMessage).reason, 'not_staff');
    });

    test('an older page answering a token request changes nothing', () {
      shell.handle(const AccessMessage(_access));
      shell.handle(const TokenMessage(1, 'anything'));
      expect(shell.signedIn, isTrue);
    });

    test('activity is reported at most every 30 seconds, unless forced', () {
      shell.noteActivity('whatsapp-inbox');
      shell.noteActivity('whatsapp-inbox');
      expect(scripts.length, 1);
      expect(scripts.single, contains("noteActivity('whatsapp-inbox')"));
      now = now.add(const Duration(seconds: 31));
      shell.noteActivity('whatsapp-inbox');
      expect(scripts.length, 2);
      shell.noteActivity(null, force: true);
      expect(scripts.last, contains('noteActivity()'));
    });

    test('only paths from the fixed table shape reach a script', () {
      shell.openWebPage('/clients');
      expect(scripts.single, contains("'/clients'"));
      shell.openWebPage("/x');alert(1);//");
      shell.openWebPage('https://evil.example');
      shell.openWebPage('/Clients');
      shell.openWebPage('/whatsapp/campaigns/12?x=1');
      expect(scripts.length, 1);
      // A campaign's own page has its id in the path.
      shell.openWebPage('/whatsapp/campaigns/12');
      expect(scripts.last, contains("'/whatsapp/campaigns/12'"));
      shell.openWebPage('/whatsapp/contacts/import');
      expect(scripts.last, contains("'/whatsapp/contacts/import'"));
      // Through the screen's own route, so Back from the importer lands on native Contacts.
      shell.openWebPage('/whatsapp/contacts/import', via: '/whatsapp/contacts');
      expect(
        scripts.last,
        startsWith("window.history.pushState({},'','/whatsapp/contacts');window.history.pushState({},'','/whatsapp/contacts/import');"),
      );
      final before = scripts.length;
      shell.openWebPage('/whatsapp/contacts/import', via: "/x');alert(1);//");
      expect(scripts.length, before, reason: 'a bad via sends nothing');
    });

    test('the page decides light or dark once it has said', () {
      expect(shell.themeMode, ThemeMode.system);
      shell.handle(const ThemeMessage(dark: true));
      expect(shell.themeMode, ThemeMode.dark);
      shell.handle(const ThemeMessage(dark: false));
      expect(shell.themeMode, ThemeMode.light);
    });
  });

  group('the drawer table', () {
    test('every web entry has a path shape the shell will accept', () {
      final shell = ShellController();
      final scripts = <String>[];
      shell.attachPage((script) async => scripts.add(script));
      var count = 0;
      for (final group in navGroups) {
        for (final entry in group.entries) {
          if (entry.path == null || entry.native != null) continue;
          count++;
          shell.openWebPage(entry.path!);
          expect(scripts.length, count, reason: entry.path);
        }
      }
    });

    test('shows only what the page allows, and native contacts to everyone', () {
      final visible = [
        for (final group in navGroups)
          for (final entry in group.entries)
            if (entry.visibleTo(_access)) entry.label,
      ];
      expect(visible, ['Clients', 'Inbox', 'Phone contacts', 'Settings']);
    });

    test('marks what is on screen', () {
      final inbox = navGroups.expand((g) => g.entries).firstWhere((e) => e.native == NativeScreen.inbox);
      final clients = navGroups.expand((g) => g.entries).firstWhere((e) => e.path == '/clients');
      expect(inbox.isActive('/clients', NativeScreen.inbox), isTrue);
      expect(clients.isActive('/clients', NativeScreen.inbox), isFalse);
      expect(clients.isActive('/clients', NativeScreen.clients), isTrue);
      // Native screens are marked by the screen showing, never by the page's route.
      expect(clients.isActive('/clients', null), isFalse);
      expect(inbox.isActive('/whatsapp/inbox', null), isFalse);
      final settings = navGroups.expand((g) => g.entries).firstWhere((e) => e.label == 'Settings');
      expect(settings.isActive('/settings', null), isFalse, reason: 'Settings is native now');
      expect(settings.isActive('/settings', NativeScreen.settings), isTrue);
      const page = NavEntry(label: 'A page', icon: Icons.web, selectedIcon: Icons.web, path: '/a-page');
      expect(page.isActive('/a-page', null), isTrue, reason: 'a CRM page is marked by its route');
      expect(navGroups.expand((g) => g.entries).where((e) => e.native == null), isEmpty, reason: 'every drawer entry is a native screen now');
      final emailInbox = navGroups.expand((g) => g.entries).firstWhere((e) => e.label == 'Email inbox');
      expect(emailInbox.isActive('/email/inbox', null), isFalse, reason: 'the email inbox is native now');
      expect(emailInbox.isActive('/email/inbox', NativeScreen.emailInbox), isTrue);
      final users = navGroups.expand((g) => g.entries).firstWhere((e) => e.label == 'Users');
      expect(users.isActive('/users', null), isFalse, reason: 'Users is native now');
      expect(users.isActive('/users', NativeScreen.users), isTrue);
      final purchases = navGroups.expand((g) => g.entries).firstWhere((e) => e.label == 'Purchase orders');
      expect(purchases.isActive('/purchase-orders', null), isFalse, reason: 'Purchase orders is native now');
      expect(purchases.isActive('/purchase-orders', NativeScreen.purchaseOrders), isTrue);
      final orders = navGroups.expand((g) => g.entries).firstWhere((e) => e.label == 'Sales orders');
      expect(orders.isActive('/sales-orders', null), isFalse, reason: 'Sales orders is native now');
      expect(orders.isActive('/sales-orders', NativeScreen.salesOrders), isTrue);
      final vendors = navGroups.expand((g) => g.entries).firstWhere((e) => e.label == 'Vendors');
      expect(vendors.isActive('/vendors', null), isFalse, reason: 'Vendors is native now');
      expect(vendors.isActive('/vendors', NativeScreen.vendors), isTrue);
    });

    test('each native screen knows the CRM route it takes over, and Phone contacts has none', () {
      expect(handoffPathFor(NativeScreen.inbox), '/whatsapp/inbox');
      expect(handoffPathFor(NativeScreen.clients), '/clients');
      expect(handoffPathFor(NativeScreen.leads), '/leads');
      expect(handoffPathFor(NativeScreen.dashboard), '/whatsapp');
      expect(handoffPathFor(NativeScreen.waContacts), '/whatsapp/contacts');
      expect(handoffPathFor(NativeScreen.waCampaigns), '/whatsapp/campaigns');
      expect(handoffPathFor(NativeScreen.vendors), '/vendors');
      expect(handoffPathFor(NativeScreen.salesOrders), '/sales-orders');
      expect(handoffPathFor(NativeScreen.purchaseOrders), '/purchase-orders');
      expect(handoffPathFor(NativeScreen.users), '/users');
      expect(handoffPathFor(NativeScreen.settings), '/settings');
      expect(handoffPathFor(NativeScreen.emailInbox), '/email/inbox');
      expect(handoffPathFor(NativeScreen.emailOverview), '/email');
      expect(handoffPathFor(NativeScreen.emailAnalytics), '/email/analytics');
      expect(handoffPathFor(NativeScreen.emailCampaigns), '/email/campaigns');
      expect(handoffPathFor(NativeScreen.emailTemplates), '/email/templates');
      expect(handoffPathFor(NativeScreen.emailConsent), '/email/consent');
      expect(handoffPathFor(NativeScreen.emailSettings), '/email/settings');
      expect(handoffPathFor(NativeScreen.deviceContacts), isNull);
    });
  });
}
