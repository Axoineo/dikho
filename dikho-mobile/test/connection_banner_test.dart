import 'dart:async';

import 'package:dikho_crm/features/connectivity/connection_banner.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late StreamController<bool> changes;

  Future<void> pump(WidgetTester tester, {bool onlineAtStart = true}) async {
    changes = StreamController<bool>.broadcast();
    addTearDown(changes.close);
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => ConnectionBanner(isOnline: () async => onlineAtStart, changes: changes.stream, child: child!),
        home: const Scaffold(body: Text('Clients')),
      ),
    );
    await tester.pump();
  }

  testWidgets('online: nothing covers the screen', (tester) async {
    await pump(tester);
    expect(find.text('Back online'), findsNothing);
    expect(find.textContaining('No connection'), findsNothing);
  });

  testWidgets('losing the connection shows the dark bar until it returns, then green "Back online" for a few seconds', (tester) async {
    await pump(tester);
    changes.add(false);
    await tester.pump();
    await tester.pumpAndSettle();
    expect(find.textContaining('No connection'), findsOneWidget);
    await tester.pump(const Duration(minutes: 1));
    expect(find.textContaining('No connection'), findsOneWidget, reason: 'stays while offline');
    expect(find.text('Clients'), findsOneWidget, reason: 'the screen stays, it is not replaced');

    changes.add(true);
    await tester.pump();
    await tester.pumpAndSettle();
    expect(find.text('Back online'), findsOneWidget);
    expect(find.textContaining('No connection'), findsNothing);
    final bar = tester.widget<Material>(find.ancestor(of: find.text('Back online'), matching: find.byType(Material)).first);
    expect(bar.color, const Color(0xFF1E8E3E));

    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.text('Back online'), findsNothing);
  });

  testWidgets('opening the app offline shows the bar, with no "Back online" before anything came back', (tester) async {
    await pump(tester, onlineAtStart: false);
    await tester.pumpAndSettle();
    expect(find.textContaining('No connection'), findsOneWidget);
    expect(find.text('Back online'), findsNothing);
    expect(find.bySemanticsLabel(RegExp('No connection')), findsOneWidget);
  });
}
