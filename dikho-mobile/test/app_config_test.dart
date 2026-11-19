import 'package:dikho_crm/app/app_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const supabase = 'https://project.supabase.co';

  test('the defaults this app ships with are valid and use https', () {
    expect(AppConfig.problems(supabase: supabase, supabaseKey: 'publishable', localTest: false), isEmpty);
    expect(AppConfig.crmUri.scheme, 'https');
    expect(AppConfig.updateUri.scheme, 'https');
    expect(AppConfig.localTestBuild, isFalse);
  });

  test('plain http is refused unless this is a local test build', () {
    expect(
      AppConfig.problems(supabase: supabase, supabaseKey: 'k', crm: 'http://manage.dikho.in', localTest: false),
      isNotEmpty,
    );
    expect(
      AppConfig.problems(supabase: supabase, supabaseKey: 'k', crm: 'http://localhost:5199', localTest: false),
      isNotEmpty,
    );
    expect(
      AppConfig.problems(supabase: supabase, supabaseKey: 'k', update: 'http://localhost:8799', localTest: false),
      isNotEmpty,
    );
    expect(
      AppConfig.problems(supabase: supabase, supabaseKey: 'k', crm: 'http://example.com', localTest: true),
      isNotEmpty,
    );
    expect(
      AppConfig.problems(supabase: supabase, supabaseKey: 'k', crm: 'http://localhost:5199', localTest: true),
      isEmpty,
    );
  });

  test('malformed or credentialed addresses are refused', () {
    expect(AppConfig.problems(supabase: supabase, supabaseKey: 'k', api: 'not a url', localTest: false), isNotEmpty);
    expect(
      AppConfig.problems(supabase: supabase, supabaseKey: 'k', api: 'https://u:p@example.com', localTest: false),
      isNotEmpty,
    );
  });

  group('APK source', () {
    const update = 'https://updates.example.test';

    bool allowed(String url, {String extra = '', bool local = false}) =>
        AppConfig.isAllowedApkUrl(
          Uri.parse(url),
          update: update,
          extraHosts: extra,
          localTest: local,
        );

    test('accepts the update host', () {
      expect(allowed('$update/releases/dikho-crm-v1.1.0.apk'), isTrue);
    });

    test('refuses anything else', () {
      for (final url in [
        'http://updates.example.test/releases/a.apk',
        'https://evil.example/releases/a.apk',
        'https://updates.example.test.evil.example/a.apk',
        'https://u:p@updates.example.test/a.apk',
        '$update/releases/a.exe',
        '$update/releases/a.apk?x=1',
        '$update/releases/a.apk#x',
      ]) {
        expect(allowed(url), isFalse, reason: url);
      }
    });

    test('accepts a configured extra host only', () {
      expect(
        allowed('https://cdn.example.test/a.apk', extra: 'cdn.example.test'),
        isTrue,
      );
      expect(
        allowed('https://other.example.test/a.apk', extra: 'cdn.example.test'),
        isFalse,
      );
    });
  });

  test('every download hop must stay on https', () {
    expect(
      AppConfig.isAllowedDownloadHop(
        Uri.parse('https://a.test/x'),
        localTest: false,
      ),
      isTrue,
    );
    expect(
      AppConfig.isAllowedDownloadHop(
        Uri.parse('http://a.test/x'),
        localTest: false,
      ),
      isFalse,
    );
    expect(
      AppConfig.isAllowedDownloadHop(
        Uri.parse('http://localhost/x'),
        localTest: false,
      ),
      isFalse,
    );
    expect(
      AppConfig.isAllowedDownloadHop(
        Uri.parse('http://localhost/x'),
        localTest: true,
      ),
      isTrue,
    );
    expect(
      AppConfig.isAllowedDownloadHop(
        Uri.parse('ftp://a.test/x'),
        localTest: true,
      ),
      isFalse,
    );
  });

  test('a build without the Supabase address or key cannot sign anyone in, so it says so', () {
    expect(AppConfig.problems(supabase: '', supabaseKey: 'k', localTest: false), contains('Supabase address or key is not set'));
    expect(AppConfig.problems(supabase: supabase, supabaseKey: '', localTest: false), contains('Supabase address or key is not set'));
    expect(AppConfig.problems(supabase: 'http://project.supabase.co', supabaseKey: 'k', localTest: false), isNotEmpty);
    expect(AppConfig.problems(supabase: 'http://localhost:54321', supabaseKey: 'k', localTest: true), isEmpty);
  });

  test('the session key is the one supabase-js uses, so the page and the app share it', () {
    expect(AppConfig.sessionKeyFor('https://abcdef.supabase.co'), 'sb-abcdef-auth-token');
    expect(AppConfig.sessionKeyFor('http://localhost:54321'), 'sb-localhost-auth-token');
  });
}
