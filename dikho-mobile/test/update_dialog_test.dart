import 'package:dikho_crm/features/updater/apk_downloader.dart';
import 'package:dikho_crm/features/updater/update_controller.dart';
import 'package:dikho_crm/features/updater/update_dialog.dart';
import 'package:dikho_crm/features/updater/update_info.dart';
import 'package:dikho_crm/shared/platform_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _NoPlatform implements UpdaterPlatform {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

UpdateController _controller({bool mandatory = false}) => UpdateController(
  info: UpdateInfo(
    version: '1.1.0',
    versionCode: 2,
    mandatory: mandatory,
    releaseNotes: 'Bug fixes\nBetter file handling',
    apkUrl: Uri.parse('https://updates.example.test/a.apk'),
    sha256: 'a' * 64,
    sizeBytes: 12 * 1024 * 1024,
    publishedAt: DateTime.utc(2026),
  ),
  platform: _NoPlatform(),
  downloader: ApkDownloader(isAllowedRedirect: (_) => true),
  cacheDir: '/nonexistent',
);

Future<void> _pump(WidgetTester tester, UpdateController controller) =>
    tester.pumpWidget(MaterialApp(home: UpdateDialog(controller: controller)));

void main() {
  testWidgets('the prompt shows version, notes and both choices', (
    tester,
  ) async {
    await _pump(tester, _controller());
    expect(find.text('New update available'), findsOneWidget);
    expect(find.text('Dikho CRM v1.1.0'), findsOneWidget);
    expect(find.textContaining('Better file handling'), findsOneWidget);
    expect(find.text('Later'), findsOneWidget);
    expect(find.text('Update Now'), findsOneWidget);
  });

  testWidgets('a mandatory update offers no Later and says why', (
    tester,
  ) async {
    await _pump(tester, _controller(mandatory: true));
    expect(find.text('Later'), findsNothing);
    expect(find.textContaining('no longer supported'), findsOneWidget);
  });

  testWidgets('downloading shows real progress and Cancel', (tester) async {
    final c = _controller()
      ..phase = UpdatePhase.downloading
      ..received = (12 * 1024 * 1024 * 0.68).ceil();
    await _pump(tester, c);
    expect(find.text('Downloading update'), findsOneWidget);
    expect(find.text('Version 1.1.0'), findsOneWidget);
    expect(find.text('68% downloaded'), findsOneWidget);
    expect(find.text('Cancel'), findsOneWidget);
  });

  testWidgets('the permission step explains why before opening settings', (
    tester,
  ) async {
    final c = _controller()..phase = UpdatePhase.needsPermission;
    await _pump(tester, c);
    expect(find.textContaining('only to update itself'), findsOneWidget);
    expect(find.text('Open settings'), findsOneWidget);
    expect(find.text('Not now'), findsOneWidget);
  });

  testWidgets('the installing step can always be closed', (tester) async {
    final c = _controller(mandatory: true)..phase = UpdatePhase.installing;
    await _pump(tester, c);
    expect(find.text('Close'), findsOneWidget);
  });

  testWidgets('every failure explains itself and offers a retry', (
    tester,
  ) async {
    for (final problem in UpdateProblem.values) {
      final c = _controller()
        ..phase = UpdatePhase.failed
        ..problem = problem;
      await _pump(tester, c);
      expect(find.text('Try again'), findsOneWidget, reason: '$problem');
      expect(find.text('Later'), findsOneWidget, reason: '$problem');
    }
  });

  testWidgets('a failed mandatory update never locks the person out', (
    tester,
  ) async {
    final c = _controller(mandatory: true)
      ..phase = UpdatePhase.failed
      ..problem = UpdateProblem.network;
    await _pump(tester, c);
    expect(find.text('Continue for now'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });
}
