import 'package:dikho_crm/features/clients/client_form_screen.dart';
import 'package:dikho_crm/features/clients/clients_controller.dart';
import 'package:dikho_crm/shared/supabase_rest.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late ClientsController controller;

  setUp(() {
    // Never reached in these tests: nothing here saves.
    final rest = SupabaseRest(base: Uri.parse('http://localhost:9'), apiKey: 'k', token: ({bool forceFresh = false}) async => 't');
    controller = ClientsController(rest: rest);
  });

  tearDown(() => controller.dispose());

  Future<void> openForm(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ClientFormScreen(controller: controller))),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('closing an untouched form just closes it', (tester) async {
    await openForm(tester);
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.text('open'), findsOneWidget);
  });

  testWidgets('closing a changed form asks first, and keeps the changes on "Keep editing"', (tester) async {
    await openForm(tester);
    await tester.enterText(find.widgetWithText(TextField, 'Company name'), 'Half typed');
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.text('Discard your changes?'), findsOneWidget);
    await tester.tap(find.text('Keep editing'));
    await tester.pumpAndSettle();
    expect(find.text('Half typed'), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Discard'));
    await tester.pumpAndSettle();
    expect(find.text('open'), findsOneWidget);
  });

  testWidgets('Add with no company name says what is missing and saves nothing', (tester) async {
    await openForm(tester);
    await tester.tap(find.text('Add'));
    await tester.pump();
    expect(find.text('Enter the company name.'), findsOneWidget);
  });
}
