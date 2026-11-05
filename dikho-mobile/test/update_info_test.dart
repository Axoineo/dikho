import 'package:dikho_crm/features/updater/update_info.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> _valid() => {
  'updateAvailable': true,
  'version': '1.1.0',
  'versionCode': 2,
  'mandatory': false,
  'releaseNotes': 'Bug fixes.',
  'apkUrl': 'https://updates.example.test/releases/dikho-crm-v1.1.0.apk',
  'sha256': 'a' * 64,
  'sizeBytes': 1024,
  'publishedAt': '2026-11-04T00:00:00Z',
};

UpdateInfo? _parse(Object? json, {int installed = 1}) => UpdateInfo.parse(
  json,
  installedVersionCode: installed,
  isAllowedApkUrl: (uri) => uri.host == 'updates.example.test',
);

void main() {
  test('no update is null', () {
    expect(_parse({'updateAvailable': false}), isNull);
  });

  test('a full answer parses', () {
    final info = _parse(_valid())!;
    expect(info.version, '1.1.0');
    expect(info.versionCode, 2);
    expect(info.mandatory, isFalse);
    expect(info.apkUrl.host, 'updates.example.test');
    expect(info.sizeBytes, 1024);
  });

  test('each malformed field is rejected', () {
    final broken = <String, List<Object?>>{
      'updateAvailable': [null, 'true', 1],
      'version': [null, '1.1', 'v1.1.0', 7],
      'versionCode': [null, '2', 2.5],
      'mandatory': [null, 'false', 0],
      'releaseNotes': [null, 7, 'x' * 2001],
      'apkUrl': [null, 7, 'https://evil.example/a.apk'],
      'sha256': [null, 'abc', 'A' * 64, 'g' * 64],
      'sizeBytes': [null, 0, -1, '1024', 1.5, 201 * 1024 * 1024],
      'publishedAt': [null, 'yesterday', 7],
    };
    for (final MapEntry(key: field, value: values) in broken.entries) {
      for (final value in values) {
        final json = _valid()..[field] = value;
        expect(
          () => _parse(json),
          throwsFormatException,
          reason: '$field=$value',
        );
      }
    }
  });

  test('a version that is not newer is rejected, not offered', () {
    expect(() => _parse(_valid(), installed: 2), throwsFormatException);
    expect(() => _parse(_valid(), installed: 3), throwsFormatException);
  });

  test('non-object responses are rejected', () {
    for (final json in [null, 'text', 7, <Object?>[]]) {
      expect(() => _parse(json), throwsFormatException, reason: '$json');
    }
  });
}
