import 'package:dikho_crm/features/crm_webview/navigation_policy.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final policy = NavigationPolicy(
    crmOrigin: Uri.parse('https://manage.dikho.in'),
    apiOrigin: Uri.parse('https://api.example.test'),
  );

  void expectAll(NavigationTarget target, List<String> urls) {
    for (final url in urls) {
      expect(policy.classify(url), target, reason: url);
    }
  }

  test('only the exact CRM origin stays in the app', () {
    expectAll(NavigationTarget.inApp, [
      'https://manage.dikho.in/',
      'https://manage.dikho.in/clients?page=2#top',
      'https://manage.dikho.in/corporategifting',
    ]);
  });

  test('lookalike hosts and other origins never stay in the app', () {
    expectAll(NavigationTarget.external, [
      'https://manage.dikho.in.evil.example/',
      'https://evilmanage.dikho.in/',
      'https://dikho.in/',
      'https://manage.dikho.in:8443/',
      'http://manage.dikho.in/',
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
      'https://wa.me/910000000000?text=hi',
      'https://example.com/',
    ]);
  });

  test('credentials in a URL are refused', () {
    expectAll(NavigationTarget.blocked, [
      'https://user:pw@manage.dikho.in/',
      'https://manage.dikho.in@evil.example/',
    ]);
  });

  test('apps may handle only the allowed schemes', () {
    expectAll(NavigationTarget.external, [
      'mailto:someone@example.test',
      'tel:+910000000000',
      'sms:+910000000000',
      'whatsapp://send?phone=910000000000',
      'geo:0,0',
    ]);
  });

  test('schemes that could reach app internals are refused', () {
    expectAll(NavigationTarget.blocked, [
      'intent://evil#Intent;scheme=https;package=com.android.chrome;end',
      'market://details?id=evil',
      'file:///data/data/in.dikho.crm/shared_prefs/x.xml',
      'content://in.dikho.crm.files/shared/x',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://manage.dikho.in/1234',
      'chrome://settings',
      'about:settings',
      'about:blank',
      'not a url at all',
      '',
    ]);
  });

  test('signed storage and ticketed media links are fetched as files', () {
    expectAll(NavigationTarget.file, [
      'https://abcdefgh.supabase.co/storage/v1/object/sign/Dikho/a.pdf?token=x',
      'https://api.example.test/api/whatsapp/media/abc?t=ticket',
    ]);
  });

  test('other paths on those hosts are not file links', () {
    expectAll(NavigationTarget.external, [
      'https://abcdefgh.supabase.co/auth/v1/verify?token=x',
      'https://api.example.test/api/email/oauth/google/callback',
      'https://supabase.co.evil.example/storage/v1/object/sign/a.pdf',
    ]);
    expect(
      policy.classify('http://abcdefgh.supabase.co/storage/v1/object/a'),
      NavigationTarget.external,
    );
  });

  test('deep links are limited to the Gmail return path on the CRM origin', () {
    expect(
      policy.isAllowedDeepLink(
        'https://manage.dikho.in/email/connect?state=abc&code=def',
      ),
      isTrue,
    );
    for (final url in [
      'https://manage.dikho.in/',
      'https://manage.dikho.in/clients',
      'https://manage.dikho.in/email/connect/extra',
      'https://evil.example/email/connect',
      'http://manage.dikho.in/email/connect',
      'https://user@manage.dikho.in/email/connect',
      'intent://manage.dikho.in/email/connect',
    ]) {
      expect(policy.isAllowedDeepLink(url), isFalse, reason: url);
    }
  });
}
