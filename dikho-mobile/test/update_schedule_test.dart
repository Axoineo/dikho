import 'dart:io';

import 'package:dikho_crm/features/updater/update_info.dart';
import 'package:dikho_crm/features/updater/update_schedule.dart';
import 'package:flutter_test/flutter_test.dart';

UpdateInfo _info({int code = 2, bool mandatory = false}) => UpdateInfo(
  version: '1.1.0',
  versionCode: code,
  mandatory: mandatory,
  releaseNotes: '',
  apkUrl: Uri.parse('https://updates.example.test/a.apk'),
  sha256: 'a' * 64,
  sizeBytes: 1,
  publishedAt: DateTime.utc(2026),
);

void main() {
  late Directory dir;
  late File file;
  final t0 = DateTime.utc(2026, 11, 4, 12);

  setUp(() {
    dir = Directory.systemTemp.createTempSync('schedule');
    file = File('${dir.path}/state.json');
  });
  tearDown(() => dir.deleteSync(recursive: true));

  test('a check is due first, then not until the interval passes', () async {
    final schedule = UpdateSchedule(file);
    await schedule.load();
    expect(schedule.isCheckDue(t0), isTrue);
    await schedule.recordCheck(t0);
    expect(schedule.isCheckDue(t0.add(const Duration(hours: 5))), isFalse);
    expect(schedule.isCheckDue(t0.add(UpdateSchedule.checkInterval)), isTrue);
  });

  test('state survives a restart', () async {
    final first = UpdateSchedule(file);
    await first.recordCheck(t0);
    await first.snooze(_info(), t0);
    final second = UpdateSchedule(file);
    await second.load();
    expect(second.isCheckDue(t0.add(const Duration(hours: 1))), isFalse);
    expect(
      second.shouldPrompt(_info(), t0.add(const Duration(hours: 1))),
      isFalse,
    );
  });

  test('a clock set backwards does not block checks', () async {
    final schedule = UpdateSchedule(file);
    await schedule.recordCheck(t0);
    expect(schedule.isCheckDue(t0.subtract(const Duration(days: 30))), isTrue);
  });

  test('Later holds for that version only, and only for a day', () async {
    final schedule = UpdateSchedule(file);
    await schedule.snooze(_info(code: 2), t0);
    expect(
      schedule.shouldPrompt(_info(code: 2), t0.add(const Duration(hours: 23))),
      isFalse,
    );
    expect(
      schedule.shouldPrompt(_info(code: 2), t0.add(UpdateSchedule.snoozeFor)),
      isTrue,
    );
    expect(schedule.shouldPrompt(_info(code: 3), t0), isTrue);
  });

  test('a mandatory update ignores Later', () async {
    final schedule = UpdateSchedule(file);
    await schedule.snooze(_info(code: 2), t0);
    expect(schedule.shouldPrompt(_info(code: 2, mandatory: true), t0), isTrue);
  });

  test('forgetting the last check makes the next launch check again', () async {
    final first = UpdateSchedule(file);
    await first.recordCheck(t0);
    await first.forgetLastCheck();
    final second = UpdateSchedule(file);
    await second.load();
    expect(second.isCheckDue(t0.add(const Duration(minutes: 1))), isTrue);
  });

  test('a corrupt state file starts clean', () async {
    file.writeAsStringSync('{not json');
    final schedule = UpdateSchedule(file);
    await schedule.load();
    expect(schedule.isCheckDue(t0), isTrue);
  });
}
