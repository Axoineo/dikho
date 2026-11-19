import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/email/campaign_models.dart';
import 'package:dikho_crm/features/email/email_analytics_screen.dart';
import 'package:dikho_crm/features/email/email_campaign_screen.dart';
import 'package:dikho_crm/features/email/email_campaigns_screen.dart';
import 'package:dikho_crm/features/email/email_api.dart';
import 'package:dikho_crm/features/email/email_compose.dart';
import 'package:dikho_crm/features/email/email_composer_screen.dart';
import 'package:dikho_crm/features/email/consent_models.dart';
import 'package:dikho_crm/features/email/email_consent_screen.dart';
import 'package:dikho_crm/features/email/email_settings_models.dart';
import 'package:dikho_crm/features/email/email_settings_screen.dart';
import 'package:dikho_crm/features/email/email_controller.dart';
import 'package:dikho_crm/features/email/email_conversation_screen.dart';
import 'package:dikho_crm/features/email/email_inbox_screen.dart';
import 'package:dikho_crm/features/email/email_models.dart';
import 'package:dikho_crm/features/email/email_overview_screen.dart';
import 'package:dikho_crm/features/email/email_templates_screen.dart';
import 'package:dikho_crm/features/email/message_body.dart';
import 'package:dikho_crm/shared/crm_api.dart';
import 'package:dikho_crm/shared/platform_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// The native email inbox against a stand-in for the API Worker's /api/email routes.
// Every request is recorded with its query and body. Synthetic mail only.

const me = 'u-me';
const box = '11111111-1111-4111-8111-111111111111';
const threadId = '22222222-2222-4222-8222-222222222222';

Map<String, Object?> threadRow(int n, {bool unread = false}) => {
  'id': n == 1 ? threadId : '22222222-2222-4222-8222-${n.toString().padLeft(12, '0')}',
  'subject': 'Quote request $n',
  'snippet': 'Please send the rates',
  'last_message_at': DateTime.now().subtract(Duration(hours: n)).toUtc().toIso8601String(),
  'unread': unread,
  'starred': false,
  'message_count': 2,
  'account_email': 'sales@example.test',
  'account_name': 'Sales',
  'workflow_status': 'open',
  'participants': [
    {'name': 'Asha Rao', 'email': 'asha@client.test'},
    {'name': 'Sales', 'email': 'sales@example.test'},
  ],
  'label_ids': ['INBOX', if (unread) 'UNREAD'],
};

class FakeEmail {
  late HttpServer server;
  final log = <String>[];
  final bodies = <String, String>{};
  var sendAnswer = <String, Object?>{'status': 'sent', 'message_id': 'm9'};
  bool unread = true;

  /// Consent records by address, as em_preference_json returns them.
  final consent = <String, Map<String, Object?>>{
    'asha@client.test': {
      'email': 'asha@client.test',
      'marketing': 'subscribed',
      'marketing_source': 'form',
      'marketing_note': 'Expo stall form',
      'marketing_changed_at': '2026-11-01T10:00:00Z',
      'marketing_changed_by_name': 'Ravi Kumar',
      'suppressed': false,
    },
  };

  /// When set, a consent change is refused with this message, as the database does.
  String? refuseConsent;

  /// Email settings: what GET /email/accounts answers, when a test sets it.
  Map<String, Object?>? settingsAccounts;
  final members = <Map<String, Object?>>[
    {'user_id': me, 'full_name': 'Mira Admin', 'role': 'admin', 'active': true},
  ];

  Future<void> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final String raw;
      try {
        raw = await utf8.decoder.bind(request).join();
      } on HttpException {
        // A request cut off when the test ends.
        return;
      }
      final path = request.uri.path;
      final key = '${request.method} $path';
      log.add(request.uri.hasQuery ? '$key?${request.uri.query}' : key);
      bodies[key] = raw;
      Object? data;
      String? refusal;
      if (key == 'GET /api/email/accounts' && settingsAccounts != null) {
        data = settingsAccounts;
      } else if (key == 'POST /api/email/oauth/google/start') {
        data = {'url': 'https://accounts.google.com/o/oauth2/v2/auth?state=s1'};
      } else if (key == 'POST /api/email/oauth/google/complete') {
        data = {'outcome': 'connected'};
      } else if (path.endsWith('/routing')) {
        data = {
          'inbound': 'elsewhere',
          'note': 'Incoming mail for example.test is delivered to Hostinger.',
          'mx': [
            {'host': 'mx1.hostinger.com'},
          ],
        };
      } else if (path.endsWith('/campaign-sender')) {
        data = {};
      } else if (key == 'GET /api/email/directory') {
        data = [
          {'user_id': 'u2', 'full_name': 'Ravi Kumar', 'has_inbox': true},
          {'user_id': 'u3', 'full_name': 'New Person', 'has_inbox': false},
        ];
      } else if (path.contains('/members')) {
        final user = path.split('/members/').length > 1 ? path.split('/members/').last : null;
        if (request.method == 'PUT' && user != null) {
          final role = (jsonDecode(raw) as Map)['role'];
          members.removeWhere((m) => m['user_id'] == user);
          members.add({
            'user_id': user,
            'full_name': user == 'u2' ? 'Ravi Kumar' : 'Someone',
            'role': role,
            'active': true,
            'granted_by_name': 'Mira Admin',
          });
        }
        data = {'members': members, 'can_configure': true};
      } else if (key == 'GET /api/email/preferences') {
        final email = request.uri.queryParameters['email'] ?? '';
        data = consent[email] ?? {'email': email, 'marketing': null, 'suppressed': false};
      } else if (key == 'PUT /api/email/preferences') {
        refusal = refuseConsent;
        if (refusal == null) {
          final body = jsonDecode(raw) as Map<String, dynamic>;
          final email = body['email'] as String;
          final next = <String, Object?>{...?consent[email], 'email': email};
          if (body.containsKey('marketing')) {
            next
              ..['marketing'] = body['marketing']
              ..['marketing_source'] = body['source']
              ..['marketing_note'] = body['note']
              ..['marketing_changed_at'] = '2026-11-19T06:00:00Z'
              ..['marketing_changed_by_name'] = 'Mira Admin';
          }
          if (body['suppress'] == true) {
            next
              ..['suppressed'] = true
              ..['suppressed_reason'] = 'manual'
              ..['suppressed_at'] = '2026-11-19T06:00:00Z';
          }
          if (body['unsuppress'] == true) {
            next
              ..['suppressed'] = false
              ..['suppressed_reason'] = null
              ..['suppressed_at'] = null;
          }
          data = consent[email] = next;
        }
      } else if (key == 'GET /api/email/accounts') {
        data = {
          'mailboxes': [
            {
              'id': box,
              'email_address': 'sales@example.test',
              'display_name': 'Sales',
              'provider': 'google',
              'status': 'connected',
              'role': 'manager',
              'unread_count': 2,
            },
          ],
        };
      } else if (key == 'GET /api/email/threads') {
        final before = request.uri.queryParameters['before_id'];
        data = before == null
            ? {
                'threads': [threadRow(1, unread: unread), threadRow(2)],
                'has_more': true,
              }
            : {
                'threads': [threadRow(3)],
                'has_more': false,
              };
      } else if (key == 'GET /api/email/threads/$threadId') {
        data = {
          'thread': threadRow(1, unread: unread),
          'account': {
            'id': box,
            'email_address': 'sales@example.test',
            'display_name': 'Sales',
            'provider': 'google',
            'status': 'connected',
            'role': 'manager',
          },
          'notes': [],
          'assignable': [
            {'user_id': me, 'full_name': 'Mira Admin'},
            {'user_id': 'u2', 'full_name': 'Ravi Kumar'},
          ],
          'messages': [
            {
              'id': 'm1',
              'date': '2026-11-17T05:00:00Z',
              'from': {'name': 'Asha Rao', 'email': 'asha@client.test'},
              'to': [
                {'name': 'Sales', 'email': 'sales@example.test'},
              ],
              'cc': [
                {'name': 'Ravi', 'email': 'ravi@client.test'},
              ],
              'bcc': [],
              'reply_to': [],
              'subject': 'Quote request 1',
              'unread': true,
              'html': '<p>Please send <b>the rates</b>.</p>',
              'text': 'Please send the rates.',
              'blocked_images': 2,
              'attachments': [
                {'id': 'a1', 'filename': 'brief.pdf', 'mime_type': 'application/pdf', 'size': 20480, 'inline': false},
              ],
            },
          ],
        };
      } else if (path.endsWith('/labels') && request.method == 'POST') {
        final b = jsonDecode(raw) as Map;
        final remove = (b['remove'] as List).cast<String>();
        final add = (b['add'] as List).cast<String>();
        if (remove.contains('UNREAD')) unread = false;
        data = {
          'label_ids': ['INBOX', ...add].where((l) => !remove.contains(l)).toList(),
          'unread': add.contains('UNREAD'),
          'starred': add.contains('STARRED'),
        };
      } else if (path.endsWith('/labels')) {
        data = {
          'labels': [
            {'id': 'Label_1', 'name': 'Quotes'},
          ],
        };
      } else if (request.method == 'PATCH') {
        data = jsonDecode(raw);
      } else if (path.endsWith('/notes')) {
        data = {'id': 'n1', 'author_name': 'Mira Admin', 'body': (jsonDecode(raw) as Map)['body'], 'created_at': '2026-11-17T06:00:00Z'};
      } else if (key == 'GET /api/email/status') {
        data = {
          'gmail': {'configured': true, 'push': false},
          'hostinger': {'configured': false},
          'delivery': {'provider': 'brevo'},
        };
      } else if (key == 'GET /api/email/campaigns') {
        data = {
          'campaigns': [
            {
              'id': 'c1',
              'name': 'December offers',
              'subject': 'Hoardings for December',
              'status': 'pending_approval',
              'recipient_count': 120,
              'updated_at': '2026-11-17T05:00:00Z',
            },
            {'id': 'c2', 'name': 'Draft one', 'status': 'draft', 'updated_at': '2026-11-16T05:00:00Z'},
            {'id': 'c3', 'name': 'Sent back', 'status': 'rejected', 'updated_at': '2026-11-15T05:00:00Z'},
            {
              'id': 'c4',
              'name': 'Going out',
              'status': 'sending',
              'recipient_count': 50,
              'started_at': '2026-11-17T04:00:00Z',
              'stats': {'delivered': 20, 'pending': 25, 'bounced': 5},
              'updated_at': '2026-11-17T04:00:00Z',
            },
          ],
          'readiness': {
            'ready': false,
            'missing': ['a campaign sender'],
          },
          'sender_mailboxes': [
            {'id': box, 'email_address': 'sales@example.test', 'provider': 'google', 'sent_today': 10, 'daily_cap': 200},
          ],
          'senders': [],
          'variables': {'first_name': 'First name'},
        };
      } else if (key == 'GET /api/email/campaigns/c1') {
        data = {
          'id': 'c1',
          'name': 'December offers',
          'subject': 'Hello {{first_name}}',
          'preheader': 'Rates inside',
          'status': 'pending_approval',
          'html': '<p>Our December rates.</p>',
          'sender_account_id': box,
          'from_email': 'sales@example.test',
          'from_name': 'Dikho Sales',
          'audience': {
            'sources': ['client'],
            'active_only': true,
          },
          'recipient_count': 120,
          'can_edit': true,
          'can_approve': true,
          'created_by': 'u2',
          'submitted_by': 'u2',
          'submitted_by_name': 'Ravi Kumar',
          'submitted_at': '2026-11-17T05:00:00Z',
          'snapshot_hash': 'abcdef123456789',
          'updated_at': '2026-11-17T05:00:00Z',
          'history': [
            {'event': 'email_campaign.submitted', 'by': 'Ravi Kumar', 'at': '2026-11-17T05:00:00Z'},
          ],
        };
      } else if (path.endsWith('/decision')) {
        data = {};
      } else if (key == 'POST /api/email/audience/preview') {
        data = {
          'eligible': 80,
          'matched': 120,
          'no_consent': 30,
          'unsubscribed': 6,
          'suppressed': 4,
          'by_source': {'client': 80},
          'can_use': {'client': true},
          'sample': [],
        };
      } else if (key == 'GET /api/email/audience/options') {
        data = {
          'countries': ['India'],
          'states': ['Gujarat'],
          'cities': ['Surat'],
          'media': [],
          'sub_media': [],
        };
      } else if (key == 'POST /api/email/campaigns') {
        data = {'id': 'c9', 'name': (jsonDecode(raw) as Map)['name'], 'status': 'draft', 'can_edit': true};
      } else if (key == 'GET /api/email/campaigns/c9') {
        data = {
          'id': 'c9',
          'name': 'Phone campaign',
          'status': 'draft',
          'can_edit': true,
          'audience': {'sources': []},
        };
      } else if (key == 'GET /api/email/templates') {
        data = {
          'templates': [
            {'id': 't1', 'name': 'Rate card', 'kind': 'marketing', 'subject': 'Our rates', 'version': 3, 'updated_at': '2026-11-10T05:00:00Z'},
          ],
          'variables': {
            'marketing': {'first_name': 'First name'},
            'transactional': {'client_name': 'Client name'},
          },
        };
      } else if (key == 'GET /api/email/templates/t1') {
        final version = request.uri.queryParameters['version'];
        data = {
          'id': 't1',
          'name': 'Rate card',
          'kind': 'marketing',
          'subject': version == '2' ? 'Old rates' : 'Our rates',
          'preheader': '',
          'html': version == '2' ? '<p>Old text</p>' : '<p>New text</p>',
          'version': 3,
          'versions': [
            {'version': 3, 'saved_by_name': 'Mira', 'saved_at': '2026-11-10T05:00:00Z'},
            {'version': 2, 'saved_by_name': 'Ravi', 'saved_at': '2026-11-01T05:00:00Z'},
          ],
        };
      } else if (key == 'PUT /api/email/templates/t1') {
        data = {'id': 't1', 'version': 4};
      } else if (key == 'GET /api/email/analytics') {
        data = {
          'campaign_recipients': {'delivered': 90, 'sent': 5, 'bounced': 4, 'complained': 1, 'pending': 10},
          'events': {'send': 100, 'bounce': 4, 'complaint': 1, 'delivery': 90},
          'unsubscribes': 3,
          'subscribed': 1200,
          'suppressed': 15,
          'campaigns': {'sent': 2, 'draft': 1},
        };
      } else if (path.endsWith('/sync')) {
        data = {'busy': false};
      } else if (path.endsWith('/send-as')) {
        data = {'identities': []};
      } else if (path.endsWith('/send')) {
        data = sendAnswer;
      } else if (path.endsWith('/recipients')) {
        data = [
          {'name': 'Asha Rao', 'email': 'asha@client.test'},
        ];
      }
      if (refusal != null) {
        request.response
          ..statusCode = 400
          ..headers.contentType = ContentType.json
          ..write(
            jsonEncode({
              'success': false,
              'error': {'message': refusal},
            }),
          );
        await request.response.close();
        return;
      }
      request.response
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({'success': true, 'data': data}));
      await request.response.close();
    });
  }

  EmailApi get api => EmailApi(CrmApi(origin: Uri.parse('http://localhost:${server.port}'), token: ({bool forceFresh = false}) async => 't'));
}

void main() {
  late FakeEmail backend;

  setUp(() async {
    HttpOverrides.global = null;
    backend = FakeEmail();
    await backend.start();
  });

  tearDown(() => backend.server.close(force: true));

  group('the web module\'s rules', () {
    test('a conversation reads as on the web', () {
      final t = ThreadSummary(threadRow(1));
      expect(t.participantLine, 'Asha (2)', reason: 'the mailbox itself is left out');
      final now = DateTime(2026, 11, 17, 18);
      expect(listTime('2026-11-16T05:00:00Z', now), 'Yesterday');
      expect(listTime('2026-03-02T05:00:00Z', now), '2 Mar');
      expect(listTime('2025-03-02T05:00:00Z', now), '2 Mar 2025');
      expect(formatSize(20480), '20 KB');
      expect(const Person('', 'ravi.kumar@client.test').initials, 'RK');
    });

    test('a reply goes to the sender, reply all to everyone but the mailbox itself', () {
      final source = EmailMessage({
        'from': {'name': 'Asha', 'email': 'asha@client.test'},
        'to': [
          {'email': 'sales@example.test'},
          {'email': 'ops@client.test'},
        ],
        'cc': [
          {'email': 'ravi@client.test'},
          {'email': 'Sales@Example.test'},
        ],
        'reply_to': [],
      });
      final one = replyRecipients(source, 'reply', 'sales@example.test');
      expect(one.to.map((p) => p.email), ['asha@client.test']);
      expect(one.cc, isEmpty);
      final all = replyRecipients(source, 'reply_all', 'sales@example.test');
      expect(all.to.map((p) => p.email), ['asha@client.test', 'ops@client.test']);
      expect(all.cc.map((p) => p.email), ['ravi@client.test']);
      final mine = EmailMessage({
        'from': {'email': 'sales@example.test'},
        'to': [
          {'email': 'asha@client.test'},
        ],
      });
      expect(
        replyRecipients(mine, 'reply', 'sales@example.test').to.single.email,
        'asha@client.test',
        reason: 'answering your own message goes to its recipients',
      );
      expect(prefixed('Re', 'Re: Quote'), 'Re: Quote');
      expect(prefixed('Fwd', 'Quote'), 'Fwd: Quote');
    });

    test('what is typed is escaped; the quote keeps the sanitized original', () {
      expect(messageHtml('a < b & "c"\nnext'), '<div>a &lt; b &amp; &quot;c&quot;<br>next</div>');
      final source = EmailMessage({
        'from': {'name': 'Asha <x>', 'email': 'asha@client.test'},
        'date': '2026-11-17T05:00:00Z',
        'html': '<p>Hi</p>',
        'text': 'Hi',
      });
      final quote = quoteBlock(source, 'reply');
      expect(quote, contains('Asha &lt;x&gt; wrote:'));
      expect(quote, contains('<blockquote><p>Hi</p></blockquote>'));
      expect(
        quoteBlock(
          EmailMessage({
            'text': '<script>',
            'from': {'email': 'a@b.c'},
          }),
          'reply',
        ),
        contains('&lt;script&gt;'),
      );
      expect(joinRecipients([const Person('Asha "A" Rao', 'asha@client.test'), const Person('', 'b@c.d')]), '"Asha A Rao" <asha@client.test>, b@c.d');
      expect(parseRecipient('Asha <Asha@Client.test>')?.email, 'asha@client.test');
      expect(parseRecipient('  ,'), isNull);
      expect(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').hasMatch(newSendId()), isTrue);
    });

    test('a message is shown in a document that can load nothing and run nothing', () {
      final page = MessageBody.document('<p>Hi</p>');
      expect(page, contains("default-src 'none'"));
      expect(page, isNot(contains('script-src')), reason: 'no script source is allowed');
      expect(page, contains('<body><p>Hi</p></body>'));
    });
  });

  group('overview and analytics rules', () {
    test('counts, shares and the SES limits read as on the web', () {
      expect(formatCount(1234567), '1,234,567');
      expect(percentOf(4, 100), '4.0%');
      expect(percentOf(1, 1000), '0.10%', reason: 'small shares keep two decimals');
      expect(percentOf(3, 0), '–');
      expect(health(4, 100, 0.05), 'warning');
      expect(health(6, 100, 0.05), 'critical');
      expect(health(1, 100, 0.05), 'good');
      expect(health(1, 0, 0.05), isNull);
      final c = CampaignCounts({'delivered': 90, 'sent': 5, 'bounced': 4, 'complained': 1, 'unsubscribed': 2, 'pending': 10, 'sending': 1});
      expect((c.sent, c.delivered, c.queued, c.total), (102, 92, 11, 113));
    });
  });

  group('campaign rules', () {
    test('a plain message is edited as text; a designed one is not', () {
      expect(designedHtml('<p>Hello</p><p>Two<br>lines</p>'), isFalse);
      expect(designedHtml('<table><tr><td>x</td></tr></table>'), isTrue);
      expect(designedHtml('<p>Hi <a href="https://x.test">link</a></p>'), isTrue, reason: 'a link would be lost as text');
      expect(textToHtml('Hello Asha,\n\nRates & sizes\nbelow.'), '<p>Hello Asha,</p><p>Rates &amp; sizes<br>below.</p>');
      expect(htmlToText(textToHtml('Hello Asha,\n\nRates & sizes\nbelow.')), 'Hello Asha,\n\nRates & sizes\nbelow.');
      expect(withSample('Hi {{first_name}} at {{ company }}, {{unknown}}'), 'Hi Asha at Example Industries, {{unknown}}');
    });

    test('the checklist before submitting', () {
      final meta = CampaignsData({
        'sender_mailboxes': [
          {'id': box, 'email_address': 'sales@example.test', 'provider': 'hostinger'},
        ],
        'readiness': {'ready': true},
      });
      final d = CampaignDraft.from(null, meta);
      expect(d.senderAccountId, box, reason: 'a new campaign starts from the first sending mailbox');
      final now = DateTime(2026, 11, 17);
      var checks = campaignChecks(d, meta, now: now);
      expect(checks.where((c) => !c.ok).map((c) => c.label), ['Named', 'Choose an audience', 'Subject and message written']);
      d
        ..name = 'December'
        ..replyTo = 'other@example.test'
        ..subject = 'Rates'
        ..html = '<p>x</p>'
        ..sendAt = DateTime(2026, 11, 16)
        ..audience.sources.add('client');
      checks = campaignChecks(d, meta, eligible: 0, now: now);
      expect(checks.where((c) => !c.ok).map((c) => c.label), [
        'Remove the reply-to address (Hostinger cannot set one)',
        '0 recipients with consent',
        'The scheduled time has passed',
      ]);
      expect(d.toFields().containsKey('from_email'), isFalse, reason: 'a sending mailbox uses its own address');
      expect((d.toFields()['audience'] as Map)['sources'], ['client']);
    });
  });

  group('consent rules', () {
    test('an address is looked up as the server keys it, and only when it is whole', () {
      expect(lookupAddress('  Asha@Client.TEST '), 'asha@client.test');
      expect(lookupAddress('asha@client'), isNull);
      expect(lookupAddress('asha rao@client.test'), isNull);
      expect(lookupAddress(''), isNull);
    });

    test('the headline: suppression first, then consent, then nothing recorded', () {
      expect(ConsentRecord({'suppressed': true, 'suppressed_reason': 'hard_bounce', 'marketing': 'subscribed'}).state, (
        ConsentTone.suppressed,
        'Suppressed: no email is sent',
        'The address bounced permanently.',
      ));
      expect(ConsentRecord({'suppressed': true, 'suppressed_reason': 'manual'}).state.$3, 'Suppressed by staff.');
      expect(ConsentRecord({'marketing': 'subscribed', 'marketing_source': 'verbal'}).state, (
        ConsentTone.agreed,
        'Agreed to marketing email',
        'Agreed verbally',
      ));
      expect(ConsentRecord({'marketing': 'unsubscribed', 'marketing_source': 'unsubscribe_link'}).state, (
        ConsentTone.stopped,
        'Unsubscribed',
        'Unsubscribe link',
      ));
      final none = ConsentRecord({'marketing': null, 'suppressed': false});
      expect(none.state.$1, ConsentTone.none);
      expect(none.marketingLabel, 'Not recorded');
      expect(none.recorded, '');
      expect(none.suppressedLabel, 'No');
    });
  });

  group('email settings rules', () {
    test('mailboxes are grouped as the web page groups them', () {
      final s = MailboxSettings({
        'can_connect_personal': true,
        'mailboxes': [
          {'id': 'p1', 'kind': 'personal', 'owner_id': me, 'email_address': 'mira@example.test'},
          {'id': 's1', 'kind': 'shared', 'can_configure': true, 'email_address': 'sales@example.test', 'role': 'manager'},
          {'id': 'p2', 'kind': 'personal', 'owner_id': 'u2', 'owner_name': 'Ravi', 'email_address': 'ravi@example.test', 'role': 'viewer'},
        ],
        'shared_setup': [
          {'id': 's2', 'kind': 'shared', 'email_address': 'contact@example.test'},
        ],
      }, me: me);
      expect(s.mine?.id, 'p1');
      expect([for (final m in s.sharedAdmin) m.id], ['s2', 's1'], reason: 'set up by this person, sorted by address, readable or not');
      expect(s.sharedAdmin.first.configurable, isTrue);
      expect([for (final m in s.sharedWithMe) m.id], ['p2']);
    });

    test('outcomes, roles and routing in words', () {
      expect(connectOutcome('connected').$1, NoticeTone.ok);
      expect(connectOutcome('something new'), connectOutcome('failed'), reason: 'an unknown code reads as a failure');
      expect(rolesFor(Mailbox({'kind': 'personal'})), isNot(contains('admin')), reason: 'a personal mailbox has no administrators');
      expect(rolesFor(Mailbox({'kind': 'shared'})), contains('admin'));
      expect(Routing({'inbound': 'none'}).label, 'Domain cannot receive mail');
      expect(Routing.unknown().label, 'Receiving not checked');
    });
  });

  group('the inbox', () {
    test('pages through the folder, and every choice reloads from the first page', () async {
      final c = EmailInboxController(api: backend.api);
      await c.start();
      expect(c.mailboxes!.single.name, 'Sales');
      expect(c.threads.length, 2);
      expect(c.hasMore, isTrue);
      await c.load(more: true);
      expect(c.threads.length, 3);
      expect(backend.log.where((l) => l.startsWith('GET /api/email/threads?')).last, contains('before_id=22222222-2222-4222-8222-000000000002'));
      c.setFolder('starred');
      c.setUnreadOnly(true);
      c.setSearch('  rates  ');
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(backend.log.last, allOf(contains('folder=starred'), contains('unread=1'), contains('search=rates')));
      expect(c.threads.length, 2, reason: 'back to the first page');
      c.patch(threadId, {'unread': false});
      expect(c.threads.first.unread, isFalse);
      c.drop(threadId);
      expect(c.threads.any((t) => t.id == threadId), isFalse);
      c.dispose();
    });
  });

  group('screens', () {
    Future<void> settle(WidgetTester tester) async {
      for (var i = 0; i < 10; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
        await tester.pump(const Duration(milliseconds: 50));
      }
    }

    void phone(WidgetTester tester) {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.6;
      addTearDown(tester.view.reset);
    }

    Future<void> done(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(minutes: 2));
    }

    testWidgets('the overview: figures, unread, mailboxes, campaigns and connections', (tester) async {
      phone(tester);
      final opened = <String>[];
      final pages = <String>[];
      var inbox = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: EmailOverviewScreen(
            api: backend.api,
            abilities: const EmailAbilities(userId: me, inbox: true, campaigns: true, approve: true),
            onOpenDrawer: () {},
            onOpenInbox: () => inbox++,
            onOpenThread: (context, t) async => opened.add(t.id),
            onOpenPage: pages.add,
          ),
        ),
      );
      await settle(tester);
      expect(find.text('Unread in inbox'), findsOneWidget);
      expect(find.text('1/1'), findsOneWidget, reason: 'connected mailboxes');
      expect(find.text('all healthy'), findsOneWidget);
      expect(backend.log, contains(startsWith('GET /api/email/threads?folder=inbox&limit=6')));
      await tester.tap(find.text('Open inbox'));
      expect(inbox, 1);
      await tester.tap(find.text('Quote request 1').first);
      expect(opened, [threadId]);
      await tester.tap(find.byTooltip('Sync sales@example.test now'));
      await settle(tester);
      expect(backend.log, contains('POST /api/email/accounts/$box/sync'));
      expect(find.text('Mailbox synced.'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Awaiting approval'), 300, scrollable: find.byType(Scrollable).first);
      expect(find.textContaining('1 campaign needs an approver'), findsOneWidget);
      expect(find.textContaining('not switched on yet (needs a campaign sender)'), findsOneWidget);
      await tester.tap(find.text('Open'));
      expect(pages, ['/email/campaigns']);
      await tester.scrollUntilVisible(find.text('Welcome emails and alerts go through Brevo.'), 300, scrollable: find.byType(Scrollable).first);
      await done(tester);
    });

    testWidgets('analytics: the period is asked for, rates carry their standing in words', (tester) async {
      phone(tester);
      await tester.pumpWidget(
        MaterialApp(
          home: EmailAnalyticsScreen(api: backend.api, onOpenDrawer: () {}),
        ),
      );
      await settle(tester);
      expect(backend.log.last, 'GET /api/email/analytics?days=30');
      expect(find.text('4.0%'), findsOneWidget, reason: 'bounce rate');
      expect(find.text('Watch'), findsOneWidget, reason: 'at half the SES limit or more');
      expect(find.text('Too high'), findsOneWidget, reason: '1 complaint in 100 is over 0.1%');
      await tester.tap(find.text('7 days'));
      await settle(tester);
      expect(backend.log.last, 'GET /api/email/analytics?days=7');
      await tester.scrollUntilVisible(find.text('Delivered'), 300, scrollable: find.byType(Scrollable).first);
      expect(find.text('Waiting to send'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Agreed to marketing email'), 300, scrollable: find.byType(Scrollable).first);
      expect(find.text('1,200'), findsOneWidget);
      await done(tester);
    });

    testWidgets('campaigns: filtered list, and approving exactly the version reviewed', (tester) async {
      phone(tester);
      await tester.pumpWidget(
        MaterialApp(
          home: EmailCampaignsScreen(api: backend.api, userId: me, canCreate: true, onOpenDrawer: () {}, onOpenPage: (_) {}),
        ),
      );
      await settle(tester);
      expect(find.textContaining('Sending is not switched on yet'), findsOneWidget);
      expect(find.text('Going out'), findsOneWidget);
      await tester.tap(find.text('Awaiting approval (1)'));
      await tester.pump();
      expect(find.text('Going out'), findsNothing);
      await tester.tap(find.text('December offers'));
      await settle(tester);
      final list = find.descendant(of: find.byType(EmailCampaignScreen), matching: find.byType(Scrollable)).first;
      await tester.scrollUntilVisible(find.widgetWithText(TextField, 'Subject'), 300, scrollable: list);
      expect(
        tester.widget<TextField>(find.widgetWithText(TextField, 'Subject')).controller!.text,
        'Hello {{first_name}}',
        reason: 'the subject as written',
      );
      await tester.scrollUntilVisible(find.text('Hello Asha'), 300, scrollable: list);
      expect(find.text('Hello Asha'), findsOneWidget, reason: 'the preview with sample values');
      await tester.scrollUntilVisible(find.widgetWithText(FilledButton, 'Approve'), 300, scrollable: list);
      expect(find.text('abcdef 123456'), findsOneWidget, reason: 'the fingerprint');
      await tester.tap(find.widgetWithText(FilledButton, 'Approve'));
      await tester.pumpAndSettle();
      expect(find.textContaining('fingerprint abcdef 123456'), findsOneWidget);
      await tester.tap(find.text('Approve sending to 120'));
      await settle(tester);
      expect(jsonDecode(backend.bodies['POST /api/email/campaigns/c1/decision']!), {'approve': true, 'hash': 'abcdef123456789', 'note': null});
      await done(tester);
    });

    testWidgets('a new campaign written on the phone is saved as a draft', (tester) async {
      phone(tester);
      final api = backend.api;
      final meta = await tester.runAsync(api.campaignsData);
      await tester.pumpWidget(
        MaterialApp(
          home: EmailCampaignScreen(api: api, meta: meta!, id: null, userId: me, canCreate: true, onChanged: () {}, onOpenPage: (_) {}),
        ),
      );
      await settle(tester);
      await tester.enterText(find.widgetWithText(TextField, 'Campaign name'), 'Phone campaign');
      await tester.scrollUntilVisible(find.text('Clients'), 300, scrollable: find.byType(Scrollable).first);
      // scrollUntilVisible stops once the row is built, which can be just below the screen,
      // and its last drag leaves the list gliding, when rows take no taps.
      await tester.pump(const Duration(seconds: 2));
      await Scrollable.ensureVisible(tester.element(find.text('Clients')), alignment: 0.5);
      await tester.pump();
      await tester.tap(find.text('Clients'));
      await settle(tester);
      expect(find.text('80 will receive this email'), findsOneWidget);
      await tester.scrollUntilVisible(find.widgetWithText(TextField, 'Message'), 300, scrollable: find.byType(Scrollable).first);
      await tester.enterText(find.widgetWithText(TextField, 'Subject'), 'December rates');
      await tester.enterText(find.widgetWithText(TextField, 'Message'), 'Hello,\n\nOur rates.');
      await tester.tap(find.text('Save changes'));
      await settle(tester);
      final body = jsonDecode(backend.bodies['POST /api/email/campaigns']!) as Map;
      expect(body['name'], 'Phone campaign');
      expect(body['sender_account_id'], box);
      expect(body['html'], '<p>Hello,</p><p>Our rates.</p>');
      expect((body['audience'] as Map)['sources'], ['client']);
      await done(tester);
    });

    testWidgets('templates: an older version restored, saved as the newest', (tester) async {
      phone(tester);
      await tester.pumpWidget(
        MaterialApp(
          home: EmailTemplatesScreen(api: backend.api, canManage: true, onOpenDrawer: () {}),
        ),
      );
      await settle(tester);
      await tester.tap(find.text('Rate card'));
      await settle(tester);
      expect(find.text('New text'), findsWidgets);
      await tester.ensureVisible(find.text('Restore'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Restore'));
      await settle(tester);
      expect(backend.log, contains('GET /api/email/templates/t1?version=2'));
      await tester.tap(find.text('Save changes'));
      await settle(tester);
      final body = jsonDecode(backend.bodies['PUT /api/email/templates/t1']!) as Map;
      expect((body['subject'], body['html']), ('Old rates', '<p>Old text</p>'));
      await done(tester);
    });

    testWidgets('consent: a whole address looked up, consent recorded with how they agreed, then suppressed', (tester) async {
      phone(tester);
      await tester.pumpWidget(
        MaterialApp(
          home: EmailConsentScreen(api: backend.api, canManage: true, onOpenDrawer: () {}),
        ),
      );
      await tester.enterText(find.widgetWithText(TextField, 'Email address'), 'ravi@client');
      await tester.tap(find.text('Look up'));
      await tester.pump();
      expect(find.text('Enter a full email address.'), findsOneWidget);
      expect(backend.log.where((l) => l.contains('preferences')), isEmpty, reason: 'nothing is asked for part of an address');

      await tester.enterText(find.widgetWithText(TextField, 'Email address'), ' Ravi@Client.test ');
      await tester.tap(find.text('Look up'));
      await settle(tester);
      expect(backend.log.last, 'GET /api/email/preferences?email=ravi%40client.test');
      expect(find.text('No consent recorded'), findsOneWidget);
      expect(find.text('Not recorded'), findsOneWidget);

      await tester.ensureVisible(find.widgetWithText(FilledButton, 'Record consent'));
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Record consent'));
      await tester.pumpAndSettle();
      final save = find.widgetWithText(FilledButton, 'Record consent').last;
      await tester.tap(save);
      await tester.pump();
      expect(find.text('Choose how this person agreed.'), findsOneWidget, reason: 'consent needs how they agreed');
      expect(backend.bodies.containsKey('PUT /api/email/preferences'), isFalse);
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Agreed verbally').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Note (optional)'), 'Phone call\nwith Ravi');
      await tester.tap(save);
      await settle(tester);
      expect(jsonDecode(backend.bodies['PUT /api/email/preferences']!), {
        'email': 'ravi@client.test',
        'marketing': 'subscribed',
        'source': 'verbal',
        'note': 'Phone call with Ravi',
      });
      await tester.pumpAndSettle();
      expect(find.byType(ConsentForm), findsNothing, reason: 'the form closes once saved');
      await tester.drag(find.byType(ListView).first, const Offset(0, 2000));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.widgetWithText(TextField, 'Email address')).focusNode!.hasFocus,
        isFalse,
        reason: 'the address field does not take focus back, so no keyboard covers the result',
      );
      await tester.ensureVisible(find.text('Agreed to marketing email'));
      await tester.pump();
      expect(find.text('Agreed to marketing email'), findsOneWidget);
      expect(find.text('Agreed verbally'), findsOneWidget);
      expect(find.text('Phone call with Ravi'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Record consent'), findsNothing, reason: 'already agreed');

      await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'Suppress'));
      await tester.pump();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Suppress'));
      await tester.pumpAndSettle();
      expect(find.text('Suppress this address?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Suppress'));
      await settle(tester);
      expect(jsonDecode(backend.bodies['PUT /api/email/preferences']!), {'email': 'ravi@client.test', 'suppress': true});
      expect(find.text('Suppressed: no email is sent'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Lift suppression'), findsOneWidget);
      await done(tester);
    });

    testWidgets('consent: a refusal stays in the form; without the permission nothing can be changed', (tester) async {
      phone(tester);
      backend.refuseConsent = 'That change was refused.';
      await tester.pumpWidget(
        MaterialApp(
          home: EmailConsentScreen(api: backend.api, canManage: true, onOpenDrawer: () {}),
        ),
      );
      await tester.enterText(find.widgetWithText(TextField, 'Email address'), 'asha@client.test');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await settle(tester);
      expect(find.text('Agreed to marketing email'), findsOneWidget);
      expect(find.text('Signed up on a form'), findsOneWidget);
      expect(find.text('Expo stall form'), findsOneWidget);
      expect(find.textContaining('by Ravi Kumar'), findsOneWidget);

      await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'Record unsubscribe'));
      await tester.pump();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Record unsubscribe'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Record unsubscribe'));
      await settle(tester);
      expect(find.text('That change was refused.'), findsOneWidget);
      expect(find.byType(ConsentForm), findsOneWidget, reason: 'the form stays open to try again');
      expect(find.text('Agreed to marketing email'), findsOneWidget, reason: 'the record is unchanged');

      await tester.pumpWidget(
        MaterialApp(
          key: const ValueKey('viewer'),
          home: EmailConsentScreen(api: backend.api, canManage: false, onOpenDrawer: () {}),
        ),
      );
      await tester.enterText(find.widgetWithText(TextField, 'Email address'), 'asha@client.test');
      await tester.tap(find.text('Look up'));
      await settle(tester);
      expect(find.text('Agreed to marketing email'), findsOneWidget);
      expect(find.textContaining('"Manage email consent" permission'), findsOneWidget);
      expect(find.byType(OutlinedButton), findsNothing);
      await done(tester);
    });

    testWidgets('email settings: Google opens in the browser; its outcome shows; campaigns get a limit', (tester) async {
      phone(tester);
      backend.settingsAccounts = {
        'can_connect_personal': true,
        'can_manage_shared': true,
        'mailboxes': [
          {
            'id': box,
            'kind': 'shared',
            'can_configure': true,
            'email_address': 'sales@example.test',
            'display_name': 'Sales',
            'provider': 'google',
            'status': 'connected',
            'role': 'admin',
            'member_count': 1,
            'last_synced_at': '2026-11-19T05:00:00Z',
          },
        ],
        'shared_setup': [],
      };
      final opened = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: EmailSettingsScreen(
            api: backend.api,
            me: me,
            outcome: 'cancelled',
            openExternal: (url) async {
              opened.add(url);
              return true;
            },
            onOpenDrawer: () {},
          ),
        ),
      );
      await settle(tester);
      expect(find.textContaining('cancelled in Google'), findsOneWidget, reason: 'how the last connection ended');
      await tester.tap(find.byTooltip('Dismiss'));
      await tester.pump();
      expect(find.textContaining('cancelled in Google'), findsNothing);

      await tester.tap(find.text('Connect with Google'));
      await settle(tester);
      expect(opened, ['https://accounts.google.com/o/oauth2/v2/auth?state=s1'], reason: 'Google opens in the browser, never in the app');
      expect(jsonDecode(backend.bodies['POST /api/email/oauth/google/start']!), isEmpty, reason: 'your own mailbox: no mailbox id');
      expect(find.textContaining('Finish in the browser'), findsOneWidget);

      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('Change'), 300, scrollable: find.byType(Scrollable).first);
      await tester.pump(const Duration(seconds: 2));
      await Scrollable.ensureVisible(tester.element(find.text('Change')), alignment: 0.5);
      await tester.pump();
      expect(find.text('Campaigns: not allowed'), findsOneWidget);
      await tester.tap(find.text('Change'));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(Switch));
      await tester.pump();
      await tester.enterText(find.widgetWithText(TextField, 'Most per day (1 to 2000)'), '0');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pump();
      expect(find.text('Set a daily limit between 1 and 2000.'), findsOneWidget);
      expect(backend.bodies.containsKey('PUT /api/email/accounts/$box/campaign-sender'), isFalse);
      await tester.enterText(find.widgetWithText(TextField, 'Most per day (1 to 2000)'), '80');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await settle(tester);
      expect(jsonDecode(backend.bodies['PUT /api/email/accounts/$box/campaign-sender']!), {'enabled': true, 'daily_cap': 80});
      await tester.pumpAndSettle();
      expect(find.byType(CampaignSenderForm), findsNothing);
      await done(tester);
    });

    testWidgets('mailbox people: a person added with a role; yourself not offered', (tester) async {
      phone(tester);
      await tester.pumpWidget(
        MaterialApp(
          home: MailboxPeopleScreen(api: backend.api, me: me, mailbox: Mailbox({'id': box, 'kind': 'shared', 'email_address': 'sales@example.test'})),
        ),
      );
      await settle(tester);
      expect(find.text('Mira Admin (you)'), findsOneWidget);
      await tester.tap(find.widgetWithText(DropdownButtonFormField<String>, 'Person'));
      await tester.pumpAndSettle();
      expect(find.text('New Person (needs Email permission)'), findsOneWidget);
      expect(find.text('Mira Admin'), findsNothing, reason: 'nobody can add themselves');
      await tester.tap(find.text('Ravi Kumar').last);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Add'));
      await settle(tester);
      expect(jsonDecode(backend.bodies['PUT /api/email/accounts/$box/members/u2']!), {'role': 'responder'});
      expect(find.text('Ravi Kumar'), findsOneWidget);
      expect(find.text('Role for Ravi Kumar'), findsOneWidget, reason: 'an administrator can change their role');
      await done(tester);
    });

    testWidgets('the list: who, subject, unread, and a conversation opens', (tester) async {
      phone(tester);
      final c = EmailInboxController(api: backend.api);
      final opened = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: EmailInboxScreen(controller: c, me: me, onOpenDrawer: () {}, onOpenThread: (context, t) async => opened.add(t.id), onCompose: (_) {}),
        ),
      );
      await settle(tester);
      expect(find.text('Quote request 1'), findsOneWidget);
      expect(find.text('Asha (2)'), findsWidgets);
      expect(find.bySemanticsLabel('Unread'), findsOneWidget);
      expect(find.text('Compose'), findsOneWidget, reason: 'a manager of a connected mailbox may write');
      await tester.tap(find.text('Quote request 1'));
      expect(opened, [threadId]);
      await tester.pumpWidget(const SizedBox());
      c.dispose();
      await done(tester);
    });

    testWidgets('a conversation: read on opening, status, note, reply, archive', (tester) async {
      phone(tester);
      final patches = <Map<String, dynamic>>[];
      final removed = <String>[];
      final composed = <ComposeRequest>[];
      final downloads = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => EmailConversationScreen(
                        api: backend.api,
                        threadId: threadId,
                        me: me,
                        onPatch: (id, changes) => patches.add(changes),
                        onRemoved: removed.add,
                        onCompose: (r) async => composed.add(r),
                        onDownload: (t, m, a) async => downloads.add(a.filename),
                        onOpenLink: (_) async {},
                      ),
                    ),
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await settle(tester);
      expect(find.text('Quote request 1'), findsOneWidget);
      expect(find.text('Please send the rates.'), findsOneWidget, reason: 'without a web view the plain text shows');
      expect(find.textContaining('2 remote images are hidden'), findsOneWidget);
      expect(
        backend.bodies['POST /api/email/threads/$threadId/labels'],
        jsonEncode({
          'add': [],
          'remove': ['UNREAD'],
        }),
        reason: 'opening marks it read',
      );
      expect(patches.first['unread'], isFalse);

      await tester.tap(find.text('Open').last);
      await settle(tester);
      await tester.tap(find.text('Done').last);
      await settle(tester);
      expect(jsonDecode(backend.bodies['PATCH /api/email/threads/$threadId']!), {'workflow_status': 'closed'});

      await tester.tap(find.textContaining('brief.pdf'));
      await settle(tester);
      expect(downloads, ['brief.pdf']);

      await tester.scrollUntilVisible(find.widgetWithText(TextField, 'Add a note for your team'), 300, scrollable: find.byType(Scrollable).first);
      await tester.enterText(find.widgetWithText(TextField, 'Add a note for your team'), 'Rates sent by phone');
      await tester.tap(find.byTooltip('Add note'));
      await settle(tester);
      expect(jsonDecode(backend.bodies['POST /api/email/threads/$threadId/notes']!), {'body': 'Rates sent by phone'});
      expect(find.text('Rates sent by phone'), findsOneWidget);

      await tester.scrollUntilVisible(find.widgetWithText(OutlinedButton, 'Reply all'), -300, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.widgetWithText(OutlinedButton, 'Reply all'));
      await tester.pump();
      expect((composed.single.mode, composed.single.source?.id), ('reply_all', 'm1'));

      await tester.tap(find.byTooltip('Archive'));
      await settle(tester);
      expect(jsonDecode(backend.bodies['POST /api/email/threads/$threadId/labels']!), {
        'add': [],
        'remove': ['INBOX'],
      });
      expect(removed, [threadId]);
      expect(find.text('open'), findsOneWidget, reason: 'back to the list');
      await done(tester);
    });

    testWidgets('composing a reply: recipients filled in, sent once with its fields', (tester) async {
      phone(tester);
      final api = backend.api;
      final detail = await tester.runAsync(() => api.thread(threadId));
      final mailboxes = await tester.runAsync(api.mailboxes);
      var sent = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: EmailComposerScreen(
            api: api,
            platform: PlatformApi(),
            mailboxes: mailboxes!,
            request: ComposeRequest(mode: 'reply_all', accountId: box, thread: detail, source: detail!.messages.single),
            onSent: () => sent++,
          ),
        ),
      );
      await settle(tester);
      expect(find.text('Asha Rao'), findsOneWidget);
      expect(find.text('Ravi'), findsOneWidget, reason: 'reply all copies the others');
      expect(find.text('Re: Quote request 1'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'Message'), 'Rates attached.\nThanks');
      await tester.tap(find.byTooltip('Send'));
      await settle(tester);
      final body = backend.bodies['POST /api/email/accounts/$box/send']!;
      expect(body, contains('name="mode"\r\n\r\nreply_all'));
      expect(body, contains('name="thread_id"\r\n\r\n$threadId'));
      expect(body, contains('name="source_message_id"\r\n\r\nm1'));
      expect(body, contains('name="to"\r\n\r\n"Asha Rao" <asha@client.test>'));
      expect(body, contains('<div>Rates attached.<br>Thanks</div>'));
      expect(body, contains('<blockquote><p>Please send <b>the rates</b>.</p></blockquote>'));
      expect(RegExp(r'name="send_id"\r\n\r\n[0-9a-f-]{36}').hasMatch(body), isTrue);
      expect(sent, 1);
      await done(tester);
    });

    testWidgets('a send the server is not sure about says so, and nothing goes again by itself', (tester) async {
      phone(tester);
      backend.sendAnswer = {'status': 'uncertain', 'duplicate': true};
      final api = backend.api;
      final mailboxes = await tester.runAsync(api.mailboxes);
      await tester.pumpWidget(
        MaterialApp(
          home: EmailComposerScreen(
            api: api,
            platform: PlatformApi(),
            mailboxes: mailboxes!,
            request: const ComposeRequest(mode: 'new', accountId: box),
            onSent: () {},
          ),
        ),
      );
      await settle(tester);
      await tester.tap(find.byTooltip('Send'));
      await tester.pump();
      expect(find.text('Add at least one recipient.'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'To'), 'not-an-address');
      await tester.testTextInput.receiveAction(TextInputAction.next);
      await tester.pump();
      await tester.tap(find.byTooltip('Send'));
      await tester.pump();
      expect(find.textContaining('not a valid address'), findsOneWidget);
      await tester.tap(find.byTooltip('Remove not-an-address'));
      await tester.enterText(find.widgetWithText(TextField, 'To'), 'asha@client.test');
      await tester.testTextInput.receiveAction(TextInputAction.next);
      await tester.enterText(find.widgetWithText(TextField, 'Subject'), 'Rates');
      await tester.tap(find.byTooltip('Send'));
      await settle(tester);
      expect(find.textContaining('It is not certain this message was sent'), findsOneWidget);
      expect(backend.log.where((l) => l.endsWith('/send')).length, 1);
      await done(tester);
    });
  });
}
