import 'dart:io';

import '../../shared/crm_api.dart';
import 'campaign_models.dart';
import 'consent_models.dart';
import 'email_models.dart';
import 'email_settings_models.dart';

/// /api/email, as src/features/email/emailApi.js calls it. Every call carries the
/// session; the Worker and the database decide what this person may see. Nothing here
/// is kept on the phone: message content is fetched live each time it is opened.
class EmailApi {
  EmailApi(this.api);

  final CrmApi api;

  /// GET /email/accounts as it comes: the mailboxes, and what this person may set up.
  Future<Map<String, dynamic>> accounts() => api.get('/email/accounts');

  /// Which connections the server has (Google, Hostinger, Gmail push, system email).
  Future<Map<String, dynamic>> status() => api.get('/email/status');

  /// Google's consent page for this person's own mailbox, or a shared one they set up.
  /// It opens in the browser: Google refuses sign-in inside an app's web view.
  Future<String> startGoogleConnect(String? mailbox) async {
    final url = (await api.post('/email/oauth/google/start', mailbox == null ? {} : {'account_id': mailbox}))['url'];
    if (url is! String || !url.startsWith('https://')) throw ApiException('Google sign-in could not be started. Try again.');
    return url;
  }

  /// Finishes Google's return with this session. The server only accepts it from the
  /// person who started, and answers a fixed outcome code.
  Future<String> completeGoogleConnect({required String state, String? code, String? error}) async {
    final answer = await api.post('/email/oauth/google/complete', {'state': state, 'code': ?code, 'error': ?error});
    return answer['outcome'] is String ? answer['outcome'] as String : 'failed';
  }

  /// Connects this person's own Hostinger mailbox (their sign-in address), or a shared one.
  Future<void> connectHostinger(String? mailbox) => api.post('/email/accounts/hostinger/connect', mailbox == null ? {} : {'account_id': mailbox});

  Future<List<String>> hostingerAddresses() async {
    final list = (await api.get('/email/hostinger/mailboxes'))['addresses'];
    return list is List
        ? [
            for (final a in list)
              if (a is String) a,
          ]
        : const [];
  }

  Future<void> createShared(String email, String name, String provider) =>
      api.post('/email/accounts/shared', {'email_address': email, 'display_name': name, 'provider': provider});

  Future<void> disconnect(String mailbox) => api.post('/email/accounts/$mailbox/disconnect', {});

  Future<void> removeMailbox(String mailbox) => api.delete('/email/accounts/$mailbox');

  Future<Routing> routing(String mailbox) async => Routing(await api.get('/email/accounts/$mailbox/routing'));

  /// Used and total bytes, where the provider reports them (Hostinger).
  Future<(int, int)?> quota(String mailbox) async {
    final q = (await api.get('/email/accounts/$mailbox/quota'))['quota'];
    if (q is! Map || q['limit_bytes'] is! num || q['used_bytes'] is! num) return null;
    return ((q['used_bytes'] as num).toInt(), (q['limit_bytes'] as num).toInt());
  }

  Future<void> setCampaignSender(String mailbox, {required bool enabled, int? dailyCap}) =>
      api.put('/email/accounts/$mailbox/campaign-sender', {'enabled': enabled, 'daily_cap': enabled ? dailyCap : null});

  Future<Members> members(String mailbox) async => Members(await api.get('/email/accounts/$mailbox/members'));

  Future<Members> setMember(String mailbox, String user, String role) async =>
      Members(await api.put('/email/accounts/$mailbox/members/$user', {'role': role}));

  Future<Members> removeMember(String mailbox, String user) async => Members(await api.delete('/email/accounts/$mailbox/members/$user'));

  Future<List<DirectoryPerson>> directory() async {
    return [for (final p in await api.getList('/email/directory')) DirectoryPerson(p)];
  }

  /// Syncs a mailbox now. True when a sync was already running.
  Future<bool> sync(String mailbox) async => (await api.post('/email/accounts/$mailbox/sync', {}))['busy'] == true;

  /// The campaigns and whether campaign sending is set up.
  Future<Map<String, dynamic>> campaigns() => api.get('/email/campaigns');

  Future<CampaignsData> campaignsData() async => CampaignsData(await api.get('/email/campaigns'));

  Future<Campaign> campaign(String id) async => Campaign(await api.get('/email/campaigns/$id'));

  Future<Campaign> createCampaign(Map<String, Object?> fields) async => Campaign(await api.post('/email/campaigns', fields));

  Future<Campaign> saveCampaign(String id, Map<String, Object?> fields) async => Campaign(await api.put('/email/campaigns/$id', fields));

  Future<void> submitCampaign(String id) => api.post('/email/campaigns/$id/submit', {});

  /// Approves exactly the version with [hash], or sends it back with [note].
  Future<void> decideCampaign(String id, {required bool approve, required String hash, String? note}) =>
      api.post('/email/campaigns/$id/decision', {'approve': approve, 'hash': hash, 'note': note});

  /// pause, resume or cancel.
  Future<void> controlCampaign(String id, String action) => api.post('/email/campaigns/$id/control', {'action': action});

  /// One address's consent and suppression. Anyone who may write campaigns can look.
  Future<ConsentRecord> preference(String email) async => ConsentRecord(await api.get('/email/preferences', query: {'email': email}));

  /// Records consent or an unsubscribe ({marketing, source, note}), or {suppress: true} /
  /// {unsuppress: true}. Needs email_consent.manage; the database checks it again.
  Future<ConsentRecord> setPreference(String email, Map<String, Object?> change) async =>
      ConsentRecord(await api.put('/email/preferences', {'email': email, ...change}));

  Future<Campaign> duplicateCampaign(String id) async => Campaign(await api.post('/email/campaigns/$id/duplicate', {}));

  /// One copy to the person's own address.
  Future<void> testCampaign(String id) => api.post('/email/campaigns/$id/test', {});

  /// One bounded batch now, where no unattended scheduler runs.
  Future<void> dispatchCampaigns() => api.post('/email/campaigns/dispatch', {});

  Future<AudiencePreview> audiencePreview(Audience audience) async =>
      AudiencePreview(await api.post('/email/audience/preview', {'audience': audience.toJson()}));

  Future<AudienceOptions> audienceOptions() async => AudienceOptions(await api.get('/email/audience/options'));

  /// Templates and the placeholders each kind offers.
  Future<(List<EmailTemplate>, Map<String, Map<String, String>>)> templates() async {
    final data = await api.get('/email/templates');
    final list = data['templates'];
    final vars = data['variables'];
    return (
      [
        if (list is List)
          for (final t in list)
            if (t is Map) EmailTemplate(Map<String, dynamic>.from(t)),
      ],
      {
        if (vars is Map)
          for (final e in vars.entries)
            '${e.key}': {
              if (e.value is Map)
                for (final v in (e.value as Map).entries) '${v.key}': '${v.value}',
            },
      },
    );
  }

  /// A template, or one of its earlier [version]s.
  Future<EmailTemplate> template(String id, {int? version}) async =>
      EmailTemplate(await api.get('/email/templates/$id', query: {if (version != null) 'version': '$version'}));

  Future<EmailTemplate> createTemplate(Map<String, Object?> fields) async => EmailTemplate(await api.post('/email/templates', fields));

  /// Every save is a new numbered version; older ones stay readable.
  Future<EmailTemplate> saveTemplate(String id, Map<String, Object?> fields) async => EmailTemplate(await api.put('/email/templates/$id', fields));

  Future<void> archiveTemplate(String id) => api.delete('/email/templates/$id', {});

  /// Sending and consent numbers for the last [days] days (7, 30 or 90).
  Future<Map<String, dynamic>> analytics(int days) => api.get('/email/analytics', query: {'days': '$days'});

  Future<List<Mailbox>> mailboxes() async {
    final data = await api.get('/email/accounts');
    final list = data['mailboxes'];
    return [
      if (list is List)
        for (final m in list)
          if (m is Map) Mailbox(Map<String, dynamic>.from(m)),
    ];
  }

  /// One page of conversations, newest first; [before] continues after the last row.
  Future<(List<ThreadSummary>, bool)> threads({
    required String folder,
    String? mailbox,
    bool unread = false,
    String search = '',
    ThreadSummary? before,
    int limit = 30,
  }) async {
    final data = await api.get(
      '/email/threads',
      query: {
        'folder': folder,
        'limit': '$limit',
        'account': ?mailbox,
        if (unread) 'unread': '1',
        if (search.isNotEmpty) 'search': search,
        if (before != null) 'before_at': before.lastMessageAt,
        if (before != null) 'before_id': before.id,
      },
    );
    final rows = data['threads'];
    return (
      [
        if (rows is List)
          for (final r in rows)
            if (r is Map) ThreadSummary(Map<String, dynamic>.from(r)),
      ],
      data['has_more'] == true,
    );
  }

  /// Searching the mailbox's own provider, beyond what Dikho has synced (Gmail).
  Future<List<ThreadSummary>> searchProvider(String mailbox, String text) async {
    final data = await api.get('/email/accounts/$mailbox/search', query: {'q': text});
    final rows = data['threads'];
    return [
      if (rows is List)
        for (final r in rows)
          if (r is Map) ThreadSummary(Map<String, dynamic>.from(r)),
    ];
  }

  Future<ThreadDetail> thread(String id) async => ThreadDetail(await api.get('/email/threads/$id'));

  /// Dikho's own state (status, assignee). Never touches the mailbox.
  Future<Map<String, dynamic>> updateThread(String id, Map<String, Object?> patch) => api.patch('/email/threads/$id', patch);

  /// The mailbox's own state: read, inbox, star and labels, as Gmail label changes.
  Future<Map<String, dynamic>> labelThread(String id, {List<String> add = const [], List<String> remove = const []}) =>
      api.post('/email/threads/$id/labels', {'add': add, 'remove': remove});

  Future<ThreadNote> addNote(String id, String body) async => ThreadNote(await api.post('/email/threads/$id/notes', {'body': body}));

  Future<(List<CrmRecord>, Map<String, bool>)> crm(String id) async => _crm(await api.get('/email/threads/$id/crm'));

  Future<(List<CrmRecord>, Map<String, bool>)> link(String id, CrmRecord record, {required bool linked}) async => _crm(
    linked
        ? await api.put('/email/threads/$id/links/${record.type}/${record.id}', {})
        : await api.delete('/email/threads/$id/links/${record.type}/${record.id}'),
  );

  static (List<CrmRecord>, Map<String, bool>) _crm(Map<String, dynamic> data) {
    final records = data['records'];
    final view = data['can_view'];
    return (
      [
        if (records is List)
          for (final r in records)
            if (r is Map) CrmRecord(r),
      ],
      {
        if (view is Map)
          for (final e in view.entries) '${e.key}': e.value == true,
      },
    );
  }

  /// The mailbox's own labels (Gmail), for filing.
  Future<List<(String, String)>> labels(String mailbox) async {
    final data = await api.get('/email/accounts/$mailbox/labels');
    final list = data['labels'];
    return [
      if (list is List)
        for (final l in list)
          if (l is Map) ('${l['id']}', '${l['name']}'),
    ];
  }

  /// Addresses this person could already see, for the composer's suggestions.
  Future<List<Person>> recipients(String text) async {
    final list = await api.getList('/email/recipients', query: {'q': text});
    return [for (final p in list) Person.from(p)];
  }

  /// The addresses a mailbox may send as (Gmail), with their signatures.
  Future<List<SendAs>> sendAs(String mailbox) async {
    final data = await api.get('/email/accounts/$mailbox/send-as');
    final list = data['identities'];
    return [
      if (list is List)
        for (final i in list)
          if (i is Map) SendAs(i),
    ];
  }

  /// Sends a message. The answer says sent, or a duplicate of an earlier send.
  Future<Map<String, dynamic>> send(String mailbox, List<(String, String)> fields, List<FormFile> files) =>
      api.sendForm('POST', '/email/accounts/$mailbox/send', fields: fields, files: files);

  /// Saves to the mailbox's drafts; [draftId] replaces an earlier save.
  Future<String?> saveDraft(String mailbox, List<(String, String)> fields, {String? draftId}) async {
    final data = draftId == null
        ? await api.sendForm('POST', '/email/accounts/$mailbox/drafts', fields: fields)
        : await api.sendForm('PUT', '/email/accounts/$mailbox/drafts/$draftId', fields: fields);
    return data['id'] is String ? data['id'] as String : draftId;
  }

  /// An attachment, downloaded with the session into [into].
  Future<File> attachment(String threadId, String messageId, EmailAttachment a, {required File into}) =>
      api.download('/email/threads/$threadId/messages/$messageId/attachments/${a.id}', query: {'name': a.filename}, into: into);
}
