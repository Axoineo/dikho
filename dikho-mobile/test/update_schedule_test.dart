import 'dart:io';

import 'package:dikho_crm/features/updater/update_info.dart';
import 'package:dikho_crm/features/updater/update_schedule.dart';
import 'package:flutter_test/flutter_test.dart';

UpdateInfo _info({int code = 2, bool mandatory = false}) => UpdateInfo(
  version: '1.1.0',
  versionCode: code,
  mandatory: mandatory,
  releaseNotes: 'Notes',
  apkUrl: Uri.parse('https://updates.example.test/a.apk'),
  sha256: 'a' * 64,
  sizeBytes: 1,
  publishedAt: DateTime.utc(2026),
);

bool _allowed(Uri uri) => uri.host == 'updates.example.test';

void main() {
  late Directory dir;
  late File file;
  final t0 = DateTime.utc(2026, 11, 4, 12);

  setUp(() {
    dir = Directory.systemTemp.createTempSync('schedule');
    file = File('${dir.path}/state.json');
  });
  tearDown(() => dir.deleteSync(recursive: true));

  test('every fresh start checks, then not until the interval passes', () async {
    final schedule = UpdateSchedule(file);
    await schedule.load();
    expect(schedule.isCheckDue(t0), isTrue);
    schedule.recordCheck(t0);
    expect(schedule.isCheckDue(t0.add(const Duration(minutes: 29))), isFalse);
    expect(schedule.isCheckDue(t0.add(UpdateSchedule.checkInterval)), isTrue);

    final nextStart = UpdateSchedule(file);
    await nextStart.load();
    expect(nextStart.isCheckDue(t0), isTrue, reason: 'a restart always asks');
  });

  test('a clock set backwards does not block checks', () {
    final schedule = UpdateSchedule(file)..recordCheck(t0);
    expect(schedule.isCheckDue(t0.subtract(const Duration(days: 30))), isTrue);
  });

  test('Later holds for this run only: the next start asks again', () async {
    final schedule = UpdateSchedule(file);
    expect(schedule.shouldPrompt(_info()), isTrue);
    schedule.dismiss(_info());
    expect(schedule.shouldPrompt(_info()), isFalse);

    final nextStart = UpdateSchedule(file);
    await nextStart.load();
    expect(nextStart.shouldPrompt(_info()), isTrue);
  });

  test('a newer update is asked about even after Later on an older one', () {
    final schedule = UpdateSchedule(file)..dismiss(_info(code: 2));
    expect(schedule.shouldPrompt(_info(code: 3)), isTrue);
    schedule.dismiss(_info(code: 3));
    expect(schedule.shouldPrompt(_info(code: 2)), isFalse, reason: 'never back to an older one');
  });

  test('a required update ignores Later', () {
    final schedule = UpdateSchedule(file)..dismiss(_info(code: 2));
    expect(schedule.shouldPrompt(_info(code: 2, mandatory: true)), isTrue);
  });

  test('a required update survives restarts until it is installed', () async {
    final first = UpdateSchedule(file);
    await first.rememberRequired(_info(code: 5, mandatory: true));

    final restarted = UpdateSchedule(file);
    await restarted.load();
    final saved = restarted.requiredUpdate(installedVersionCode: 4, isAllowedApkUrl: _allowed);
    expect(saved?.versionCode, 5);
    expect(saved?.mandatory, isTrue);
    expect(saved?.releaseNotes, 'Notes');

    expect(
      restarted.requiredUpdate(installedVersionCode: 5, isAllowedApkUrl: _allowed),
      isNull,
      reason: 'installed: the block lifts by itself',
    );
  });

  test('a required update the server dropped is forgotten', () async {
    final first = UpdateSchedule(file);
    await first.rememberRequired(_info(code: 5, mandatory: true));
    await first.forgetRequired();
    final restarted = UpdateSchedule(file);
    await restarted.load();
    expect(restarted.requiredUpdate(installedVersionCode: 4, isAllowedApkUrl: _allowed), isNull);
  });

  test('a damaged or altered state file blocks nobody', () async {
    await file.writeAsString('not json');
    final corrupt = UpdateSchedule(file);
    await corrupt.load();
    expect(corrupt.requiredUpdate(installedVersionCode: 1, isAllowedApkUrl: _allowed), isNull);

    await file.writeAsString('{"required":{"updateAvailable":true,"versionCode":"x"}}');
    final malformed = UpdateSchedule(file);
    await malformed.load();
    expect(malformed.requiredUpdate(installedVersionCode: 1, isAllowedApkUrl: _allowed), isNull);
  });

  test('a saved update pointing at a host no longer allowed is refused', () async {
    final first = UpdateSchedule(file);
    await first.rememberRequired(_info(code: 5, mandatory: true));
    final restarted = UpdateSchedule(file);
    await restarted.load();
    expect(restarted.requiredUpdate(installedVersionCode: 4, isAllowedApkUrl: (_) => false), isNull);
  });
}
