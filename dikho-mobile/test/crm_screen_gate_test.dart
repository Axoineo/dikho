import 'package:dikho_crm/features/crm_webview/crm_screen.dart';
import 'package:dikho_crm/shared/platform_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final calls = <MethodCall>[];

  setUp(() {
    calls.clear();
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('in.dikho.crm/platform'),
      (call) async {
        calls.add(call);
        return call.method == 'openExternal' ? true : null;
      },
    );
    messenger.setMockMethodCallHandler(
      const MethodChannel('in.dikho.crm/events'),
      (call) async => null,
    );
  });

  AppInfo info(int webViewMajor) => AppInfo(
    versionName: '1.0.0',
    versionCode: 1,
    sdkInt: 31,
    webViewMajor: webViewMajor,
    filesDir: '/nonexistent',
    cacheDir: '/nonexistent',
  );

  Future<void> pump(WidgetTester tester, int webViewMajor) => tester.pumpWidget(
    MaterialApp(
      home: CrmScreen(
        platform: PlatformApi(),
        info: info(webViewMajor),
        navigatorKey: GlobalKey<NavigatorState>(),
      ),
    ),
  );

  testWidgets('an old WebView gets an explanation instead of a blank page', (
    tester,
  ) async {
    await pump(tester, minimumWebViewMajor - 1);
    await tester.pump();
    expect(find.text('Update Android System WebView'), findsOneWidget);
    expect(find.text('Open Play Store'), findsOneWidget);
    // The gate comes first: no WebView is created or attached behind it.
    expect(calls.where((call) => call.method == 'attachWebView'), isEmpty);
  });

  testWidgets('the button opens the WebView listing and nothing else', (
    tester,
  ) async {
    await pump(tester, minimumWebViewMajor - 1);
    await tester.pump();
    await tester.tap(find.text('Open Play Store'));
    await tester.pump();
    final opened = calls.singleWhere((call) => call.method == 'openExternal');
    expect(
      (opened.arguments as Map)['url'],
      'https://play.google.com/store/apps/details?id=com.google.android.webview',
    );
  });
}
