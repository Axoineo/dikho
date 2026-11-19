import 'package:dikho_crm/features/downloads/file_events.dart';
import 'package:dikho_crm/shared/platform_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// The message after a download. It has Open, and Flutter keeps any message with a
// button up until dismissed, which left it over native screens' own buttons for good.

void main() {
  Future<FileEvents> pump(WidgetTester tester, {bool screenReader = false}) async {
    final messenger = GlobalKey<ScaffoldMessengerState>();
    await tester.pumpWidget(
      MediaQuery(
        data: MediaQueryData(accessibleNavigation: screenReader),
        child: MaterialApp(
          scaffoldMessengerKey: messenger,
          home: const Scaffold(body: SizedBox()),
        ),
      ),
    );
    return FileEvents(platform: PlatformApi(), messengerOf: () => messenger.currentState);
  }

  const finished = {'type': 'downloadFinished', 'name': 'TI_SO-1.pdf', 'uri': 'content://x/1', 'mime': 'application/pdf'};

  testWidgets('"Saved … Open" goes by itself after its ten seconds', (tester) async {
    (await pump(tester)).handle(finished);
    await tester.pumpAndSettle();
    expect(find.text('Saved TI_SO-1.pdf to Downloads'), findsOneWidget);
    expect(find.text('Open'), findsOneWidget);
    await tester.pump(const Duration(seconds: 9));
    expect(find.text('Saved TI_SO-1.pdf to Downloads'), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(find.text('Saved TI_SO-1.pdf to Downloads'), findsNothing);
  });

  testWidgets('with a screen reader on, it stays until dismissed', (tester) async {
    (await pump(tester, screenReader: true)).handle(finished);
    await tester.pumpAndSettle();
    await tester.pump(const Duration(minutes: 1));
    await tester.pumpAndSettle();
    expect(find.text('Saved TI_SO-1.pdf to Downloads'), findsOneWidget);
  });
}
