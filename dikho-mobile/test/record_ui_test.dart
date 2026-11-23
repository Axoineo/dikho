import 'package:dikho_crm/shared/record_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('the next page is due within a screen and a half of the end, not before', (tester) async {
    final scroll = ScrollController();
    addTearDown(scroll.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Align(
          alignment: Alignment.topCenter,
          child: SizedBox(
            height: 400,
            child: ListView.builder(controller: scroll, itemExtent: 50, itemCount: 100, itemBuilder: (_, i) => Text('Row $i')),
          ),
        ),
      ),
    );
    final position = scroll.position;
    expect(position.viewportDimension, 400);
    expect(nearListEnd(position), isFalse);
    scroll.jumpTo(position.maxScrollExtent - 601);
    expect(nearListEnd(position), isFalse);
    scroll.jumpTo(position.maxScrollExtent - 599);
    expect(nearListEnd(position), isTrue, reason: 'well before the old 200 px trigger');
  });

  testWidgets('placeholder rows fill the space in the list\'s row height, read as one "Loading", and pulse', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: LoadingRows(extent: 100))));
    // The default test screen is 600 tall: six rows, the last one cut by the edge.
    expect(find.descendant(of: find.byType(LoadingRows), matching: find.byType(Row)), findsNWidgets(6));
    expect(find.bySemanticsLabel('Loading'), findsOneWidget);
    final fade = tester.widget<FadeTransition>(find.descendant(of: find.byType(LoadingRows), matching: find.byType(FadeTransition)));
    final before = fade.opacity.value;
    await tester.pump(const Duration(milliseconds: 450));
    expect(fade.opacity.value, isNot(before));
  });

  testWidgets('placeholder rows hold still when the phone removes animations', (tester) async {
    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: LoadingRows())));
    final fade = tester.widget<FadeTransition>(find.descendant(of: find.byType(LoadingRows), matching: find.byType(FadeTransition)));
    expect(fade.opacity.value, 1);
    await tester.pump(const Duration(milliseconds: 450));
    expect(fade.opacity.value, 1);
    expect(tester.hasRunningAnimations, isFalse);
  });

  testWidgets('the line under a search keeps its height while it shows progress, so the rows never move', (tester) async {
    Future<double> heightWhen({required bool active}) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(children: [ListProgressLine(active: active)]),
          ),
        ),
      );
      return tester.getSize(find.byType(ListProgressLine)).height;
    }

    expect(await heightWhen(active: false), 2);
    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(find.byType(Divider), findsOneWidget);
    expect(await heightWhen(active: true), 2);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.bySemanticsLabel('Updating the list'), findsOneWidget);
  });
}
