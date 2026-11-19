import 'email_compose.dart' show escapeHtml;
import 'email_models.dart';

/// Email campaigns, as CampaignEditor.jsx and AudiencePicker.jsx have them. The rules
/// are the database's: an edit after submission withdraws approval, nobody approves
/// what they wrote or submitted, and an approval covers exactly the version the
/// approver saw (its fingerprint).

String _text(Object? value) => value is String ? value : (value == null ? '' : '$value');

Map<String, dynamic> _map(Object? value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

List<String> _strings(Object? value) => [
  if (value is List)
    for (final v in value)
      if (v != null) '$v',
];

int _int(Object? value) => value is num ? value.toInt() : int.tryParse(_text(value)) ?? 0;

const campaignFilters = [
  ('all', 'All', <String>{}),
  ('review', 'Awaiting approval', {'pending_approval'}),
  ('drafts', 'Drafts', {'draft', 'rejected'}),
  ('live', 'Scheduled and sending', {'approved', 'sending', 'paused'}),
  ('done', 'Sent', {'sent', 'cancelled'}),
];

/// Started campaigns are kept as the record: they are never edited.
const lockedStatuses = {'sending', 'sent', 'cancelled'};

/// Saving a change in these withdraws the submission or the approval.
const withdrawingStatuses = {'pending_approval', 'approved', 'paused'};

const sourceLabels = {'client': 'Clients', 'vendor': 'Vendors', 'lead': 'Leads'};
const sourceHelp = {'client': 'Client contact emails.', 'vendor': 'Vendor contact emails.', 'lead': 'Corporate-gifting leads.'};

const campaignEvents = {
  'email_campaign.created': 'Created',
  'email_campaign.edited': 'Edited after submission',
  'email_campaign.submitted': 'Submitted for approval',
  'email_campaign.approved': 'Approved',
  'email_campaign.rejected': 'Changes requested',
  'email_campaign.paused': 'Paused',
  'email_campaign.resumed': 'Resumed',
  'email_campaign.cancelled': 'Cancelled',
  'email_campaign.sent': 'Finished sending',
};

/// The sample person the server's preview uses, so the subject reads like the message.
const _sample = {'first_name': 'Asha', 'name': 'Asha Verma', 'company': 'Example Industries', 'email': 'asha@example.com'};

String withSample(String text) => text.replaceAllMapped(RegExp(r'\{\{\s*([a-z_]+)\s*\}\}'), (m) => _sample[m.group(1)] ?? m.group(0)!);

/// A designed email (its own tables or styles) that a phone editor would flatten.
final _layout = RegExp(r'<(table|style|center)\b', caseSensitive: false);

/// Only paragraphs, line breaks and plain text: safe to edit as text on a phone.
final _simple = RegExp(r'^(\s|<\/?(p|div|br)\s*\/?>|[^<])*$', caseSensitive: false);

bool designedHtml(String html) => _layout.hasMatch(html) || !_simple.hasMatch(html);

/// Plain text as campaign HTML: a paragraph per block, line breaks kept.
String textToHtml(String text) {
  final blocks = text.replaceAll('\r\n', '\n').split(RegExp(r'\n{2,}')).map((b) => b.trim()).where((b) => b.isNotEmpty);
  return blocks.map((b) => '<p>${escapeHtml(b).replaceAll('\n', '<br>')}</p>').join();
}

/// Simple campaign HTML back to the text it was written as.
String htmlToText(String html) => html
    .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
    .replaceAll(RegExp(r'</(p|div)>\s*', caseSensitive: false), '\n\n')
    .replaceAll(RegExp(r'<[^>]+>'), '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .trim();

/// Who a campaign goes to.
class Audience {
  Audience({
    List<String>? sources,
    List<String>? country,
    List<String>? state,
    List<String>? city,
    List<String>? media,
    List<String>? subMedia,
    this.activeOnly = true,
  }) : sources = sources ?? [],
       country = country ?? [],
       state = state ?? [],
       city = city ?? [],
       media = media ?? [],
       subMedia = subMedia ?? [];

  factory Audience.from(Object? raw) {
    final m = _map(raw);
    return Audience(
      sources: _strings(m['sources']),
      country: _strings(m['country']),
      state: _strings(m['state']),
      city: _strings(m['city']),
      media: _strings(m['media']),
      subMedia: _strings(m['sub_media']),
      activeOnly: m['active_only'] != false,
    );
  }

  final List<String> sources;
  final List<String> country;
  final List<String> state;
  final List<String> city;
  final List<String> media;
  final List<String> subMedia;
  bool activeOnly;

  Map<String, Object?> toJson() => {
    'sources': sources,
    'country': country,
    'state': state,
    'city': city,
    'media': media,
    'sub_media': subMedia,
    'active_only': activeOnly,
  };

  Audience copy() => Audience.from(toJson());
}

/// One campaign as the API sends it.
class Campaign {
  Campaign(this.raw);

  final Map<String, dynamic> raw;

  String get id => _text(raw['id']);
  String get name => _text(raw['name']);
  String get subject => _text(raw['subject']);
  String get preheader => _text(raw['preheader']);
  String get html => _text(raw['html']);
  String get status => _text(raw['status']).isEmpty ? 'draft' : _text(raw['status']);
  String get statusLabel => campaignStatusLabels[status] ?? status;
  int get recipientCount => _int(raw['recipient_count']);
  CampaignCounts get counts => CampaignCounts(raw['stats']);
  String get senderAccountId => _text(raw['sender_account_id']);
  String get senderProvider => _text(raw['sender_provider']);
  String get fromEmail => _text(raw['from_email']);
  String get fromName => _text(raw['from_name']);
  String get replyTo => _text(raw['reply_to']);
  String get sendAt => _text(raw['send_at']);
  String get templateId => _text(raw['template_id']);
  Audience get audience => Audience.from(raw['audience']);
  bool get canEdit => raw['can_edit'] == true;
  bool get canApprove => raw['can_approve'] == true;
  String get startedAt => _text(raw['started_at']);
  bool get started => startedAt.isNotEmpty;
  String get updatedAt => _text(raw['updated_at']);
  String get createdByName => _text(raw['created_by_name']);
  String get decisionNote => _text(raw['decision_note']);
  String get snapshotHash => _text(raw['snapshot_hash']);
  String get submittedByName => _text(raw['submitted_by_name']);
  String get submittedAt => _text(raw['submitted_at']);
  String get approvedByName => _text(raw['approved_by_name']);
  String get approvedAt => _text(raw['approved_at']);
  String get finishedAt => _text(raw['finished_at']);

  /// Wrote, edited or submitted it: then someone else must approve it.
  bool wroteIt(String userId) => {_text(raw['created_by']), _text(raw['updated_by']), _text(raw['submitted_by'])}.contains(userId);

  /// "a1b2c3 d4e5f6": the version an approval covers.
  String get fingerprint => snapshotHash.length >= 12 ? '${snapshotHash.substring(0, 6)} ${snapshotHash.substring(6, 12)}' : snapshotHash;

  List<({String event, String by, String at, String note})> get history => [
    if (raw['history'] is List)
      for (final h in raw['history'] as List)
        if (h is Map) (event: _text(h['event']), by: _text(h['by']), at: _text(h['at']), note: _text(h['note'])),
  ];
}

/// A mailbox allowed to send campaigns, with its daily limit.
class SenderMailbox {
  SenderMailbox(Map raw)
    : id = _text(raw['id']),
      email = _text(raw['email_address']),
      provider = _text(raw['provider']),
      sentToday = _int(raw['sent_today']),
      dailyCap = _int(raw['daily_cap']),
      cooldownUntil = _text(raw['cooldown_until']);

  final String id;
  final String email;
  final String provider;
  final int sentToday;
  final int dailyCap;
  final String cooldownUntil;
}

/// GET /email/campaigns: the list and what sending needs.
class CampaignsData {
  CampaignsData(Map<String, dynamic> raw)
    : campaigns = [
        if (raw['campaigns'] is List)
          for (final c in raw['campaigns'] as List)
            if (c is Map) Campaign(Map<String, dynamic>.from(c)),
      ],
      readiness = _map(raw['readiness']),
      senders = _strings(raw['senders']),
      senderMailboxes = [
        if (raw['sender_mailboxes'] is List)
          for (final m in raw['sender_mailboxes'] as List)
            if (m is Map) SenderMailbox(m),
      ],
      variables = {for (final e in _map(raw['variables']).entries) e.key: _text(e.value)};

  final List<Campaign> campaigns;
  final Map<String, dynamic> readiness;
  final List<String> senders;
  final List<SenderMailbox> senderMailboxes;

  /// {{key}} placeholders, and what each stands for.
  final Map<String, String> variables;

  bool get ready => readiness['ready'] == true;
  bool get scheduler => readiness['scheduler'] == true;
  String get missing => _strings(readiness['missing']).join(', ');
}

/// The editable copy of a campaign.
class CampaignDraft {
  CampaignDraft({
    this.name = '',
    this.senderAccountId,
    this.fromEmail = '',
    this.fromName = '',
    this.replyTo = '',
    this.sendAt,
    this.templateId,
    Audience? audience,
    this.subject = '',
    this.preheader = '',
    this.html = '',
  }) : audience = audience ?? Audience();

  /// A new campaign starts from the first mailbox this person may send from.
  factory CampaignDraft.from(Campaign? c, CampaignsData meta) {
    if (c == null) {
      final first = meta.senderMailboxes.isEmpty ? null : meta.senderMailboxes.first;
      return CampaignDraft(senderAccountId: first?.id, fromEmail: first?.email ?? (meta.senders.isEmpty ? '' : meta.senders.first));
    }
    return CampaignDraft(
      name: c.name,
      senderAccountId: c.senderAccountId.isEmpty ? null : c.senderAccountId,
      fromEmail: c.fromEmail,
      fromName: c.fromName,
      replyTo: c.replyTo,
      sendAt: DateTime.tryParse(c.sendAt)?.toLocal(),
      templateId: c.templateId.isEmpty ? null : c.templateId,
      audience: c.audience,
      subject: c.subject,
      preheader: c.preheader,
      html: c.html,
    );
  }

  String name;
  String? senderAccountId;
  String fromEmail;
  String fromName;
  String replyTo;
  DateTime? sendAt;
  String? templateId;
  Audience audience;
  String subject;
  String preheader;
  String html;

  Map<String, Object?> toFields() => {
    'name': name.trim(),
    'sender_account_id': senderAccountId,
    // With a sender mailbox the server uses that mailbox's own address.
    if (senderAccountId == null) 'from_email': fromEmail,
    'from_name': fromName.trim(),
    'reply_to': replyTo.trim().isEmpty ? null : replyTo.trim(),
    'send_at': sendAt?.toUtc().toIso8601String(),
    'template_id': templateId,
    'audience': audience.toJson(),
    'subject': subject.trim(),
    'preheader': preheader.trim(),
    'html': html,
  };
}

/// One line of the checklist before submitting, and the part it belongs to.
typedef Check = ({bool ok, String label, String part});

List<Check> campaignChecks(CampaignDraft d, CampaignsData meta, {int? eligible, required DateTime now}) {
  final mailbox = meta.senderMailboxes.where((m) => m.id == d.senderAccountId).firstOrNull;
  final verified = d.senderAccountId != null ? mailbox != null : meta.senders.contains(d.fromEmail);
  final hostinger = d.senderAccountId != null && mailbox?.provider == 'hostinger';
  final from = mailbox?.email ?? d.fromEmail;
  final scheduleOk = d.sendAt == null || d.sendAt!.isAfter(now);
  return [
    (ok: d.name.trim().isNotEmpty, label: 'Named', part: 'details'),
    (ok: verified, label: verified ? 'From $from' : 'Choose a sending mailbox', part: 'details'),
    if (hostinger && d.replyTo.trim().isNotEmpty) (ok: false, label: 'Remove the reply-to address (Hostinger cannot set one)', part: 'details'),
    (
      ok: d.audience.sources.isNotEmpty && (eligible ?? 1) > 0,
      label: eligible != null ? '${formatCount(eligible)} recipient${eligible == 1 ? '' : 's'} with consent' : 'Choose an audience',
      part: 'audience',
    ),
    (ok: d.subject.trim().isNotEmpty && d.html.trim().isNotEmpty, label: 'Subject and message written', part: 'content'),
    (
      ok: scheduleOk,
      label: d.sendAt == null
          ? 'Sends as soon as it is approved'
          : (scheduleOk ? 'Scheduled for ${fullTime(d.sendAt!.toUtc().toIso8601String())}' : 'The scheduled time has passed'),
      part: 'details',
    ),
  ];
}

/// POST /email/audience/preview: how many would receive it, and why the rest would not.
class AudiencePreview {
  AudiencePreview(Map<String, dynamic> raw)
    : eligible = _int(raw['eligible']),
      matched = _int(raw['matched']),
      noConsent = _int(raw['no_consent']),
      unsubscribed = _int(raw['unsubscribed']),
      suppressed = _int(raw['suppressed']),
      bySource = {for (final e in _map(raw['by_source']).entries) e.key: _int(e.value)},
      canUse = {for (final e in _map(raw['can_use']).entries) e.key: e.value != false},
      sample = [
        if (raw['sample'] is List)
          for (final s in raw['sample'] as List)
            if (s is Map) (name: _text(s['name']), email: _text(s['email']), company: _text(s['company'])),
      ];

  final int eligible;
  final int matched;
  final int noConsent;
  final int unsubscribed;
  final int suppressed;
  final Map<String, int> bySource;
  final Map<String, bool> canUse;
  final List<({String name, String email, String company})> sample;
}

/// GET /email/audience/options: places to suggest and media to choose from.
class AudienceOptions {
  AudienceOptions(Map<String, dynamic> raw)
    : countries = _strings(raw['countries']),
      states = _strings(raw['states']),
      cities = _strings(raw['cities']),
      media = [
        if (raw['media'] is List)
          for (final m in raw['media'] as List)
            if (m is Map) (id: _text(m['id']), name: _text(m['name'])),
      ],
      subMedia = [
        if (raw['sub_media'] is List)
          for (final m in raw['sub_media'] as List)
            if (m is Map) (id: _text(m['id']), name: _text(m['name']), mediaId: _text(m['media_id'])),
      ];

  final List<String> countries;
  final List<String> states;
  final List<String> cities;
  final List<({String id, String name})> media;
  final List<({String id, String name, String mediaId})> subMedia;
}

/// A content template.
class EmailTemplate {
  EmailTemplate(this.raw);

  final Map<String, dynamic> raw;

  String get id => _text(raw['id']);
  String get name => _text(raw['name']);
  String get kind => _text(raw['kind']);
  String get description => _text(raw['description']);
  String get subject => _text(raw['subject']);
  String get preheader => _text(raw['preheader']);
  String get html => _text(raw['html']);
  int get version => _int(raw['version']);
  String get updatedAt => _text(raw['updated_at']);
  String get updatedByName => _text(raw['updated_by_name']);
  bool get canEdit => raw['can_edit'] != false;
}
