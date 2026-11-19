/// The Email Hub's data, as src/features/email/emailFormat.js shows it. Nothing here
/// decides access: the API and the database check each mailbox role on every request.
library;

String _text(Object? value) => value is String ? value : (value == null ? '' : '$value');

Map<String, dynamic> _map(Object? value) => value is Map ? Map<String, dynamic>.from(value) : const {};

List<Map<String, dynamic>> _maps(Object? value) => [
  if (value is List)
    for (final v in value)
      if (v is Map) Map<String, dynamic>.from(v),
];

const emailFolders = [
  ('inbox', 'Inbox'),
  ('assigned', 'Assigned to me'),
  ('starred', 'Starred'),
  ('sent', 'Sent'),
  ('drafts', 'Drafts'),
  ('archived', 'Archived'),
  ('all', 'All mail'),
];

const workflowStates = [('open', 'Open'), ('pending', 'Waiting'), ('closed', 'Done')];

const providerLabels = {'google': 'Google Workspace', 'hostinger': 'Hostinger'};

const _roleRank = {'viewer': 1, 'responder': 2, 'manager': 3, 'admin': 4};

/// A mailbox role at least [min]: viewer, responder, manager, admin.
bool atLeast(String? role, String min) => (_roleRank[role] ?? 0) >= _roleRank[min]!;

/// Someone on an email: a name and an address.
class Person {
  const Person(this.name, this.email);

  factory Person.from(Object? raw) {
    final m = _map(raw);
    return Person(_text(m['name']).trim(), _text(m['email']).trim());
  }

  final String name;
  final String email;

  /// The name, else the address.
  String get display => name.isNotEmpty ? name : email;

  String get first => display.split(RegExp(r'[\s@]')).first;

  String get initials {
    final parts = display.replaceAll(RegExp(r'@.*'), '').split(RegExp(r'[\s._-]+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
  }

  /// "Asha Rao `<asha@example.com>`", or the address alone.
  String get full => name.isNotEmpty ? '$name <$email>' : email;
}

List<Person> _people(Object? raw) => [
  if (raw is List)
    for (final p in raw) Person.from(p),
];

String addressList(List<Person> people) => people.map((p) => p.full).join(', ');

/// A mailbox this person can use (em_list_accounts).
class Mailbox {
  Mailbox(this.raw);

  final Map<String, dynamic> raw;

  String get id => _text(raw['id']);
  String get email => _text(raw['email_address']);
  String get displayName => _text(raw['display_name']);
  String get name => displayName.isNotEmpty ? displayName : email;
  String get provider => _text(raw['provider']);
  String get status => _text(raw['status']);
  String get role => _text(raw['role']);
  int get unread => raw['unread_count'] is num ? (raw['unread_count'] as num).toInt() : int.tryParse(_text(raw['unread_count'])) ?? 0;
  String get lastSyncedAt => _text(raw['last_synced_at']);
  bool get syncTrouble => _text(raw['last_sync_error']).isNotEmpty;
  bool get connected => status == 'connected';

  /// Older answers have no capabilities and are Gmail, which can do everything.
  bool can(String feature) => _map(raw['capabilities'])[feature] != false;

  bool get writable => connected && atLeast(role, 'responder');

  String get kind => _text(raw['kind']);
  String get ownerId => _text(raw['owner_id']);
  String get ownerName => _text(raw['owner_name']);
  bool get canConfigure => raw['can_configure'] == true;
  String get syncError => _text(raw['last_sync_error']);

  /// For Email settings, as MailboxRow reads it: only an explicit false withholds setup.
  bool get configurable => raw['can_configure'] != false;
  int? get memberCount => raw['member_count'] is num ? (raw['member_count'] as num).toInt() : null;
  bool get campaignSender => raw['campaign_sender'] == true;
  int? get campaignDailyCap => raw['campaign_daily_cap'] is num ? (raw['campaign_daily_cap'] as num).toInt() : null;
}

const roleLabels = {'viewer': 'Viewer', 'responder': 'Responder', 'manager': 'Manager', 'admin': 'Administrator'};

/// A mailbox's connection, in words.
const mailboxStatus = {
  'connected': 'Connected',
  'pending': 'Not connected yet',
  'reauth_required': 'Reconnect needed',
  'disconnected': 'Disconnected',
};

const campaignStatusLabels = {
  'draft': 'Draft',
  'pending_approval': 'Awaiting approval',
  'approved': 'Approved',
  'rejected': 'Changes requested',
  'sending': 'Sending',
  'paused': 'Paused',
  'sent': 'Sent',
  'cancelled': 'Cancelled',
};

/// A campaign recipient ends in exactly one state; these mean it was handed over.
const _deliveredStates = ['sent', 'delivered', 'bounced', 'complained', 'unsubscribed'];

/// Where campaign emails ended up, as campaignCounts on the web.
class CampaignCounts {
  CampaignCounts(Object? stats) : _s = _map(stats);

  final Map<String, dynamic> _s;

  int n(String key) => _s[key] is num ? (_s[key] as num).toInt() : int.tryParse(_text(_s[key])) ?? 0;
  int get total => _s.values.fold(0, (a, b) => a + (b is num ? b.toInt() : 0));
  int get queued => n('pending') + n('sending');
  int get sent => _deliveredStates.fold(0, (a, k) => a + n(k));
  int get delivered => n('delivered') + n('unsubscribed');
  int get bounced => n('bounced');
  int get complained => n('complained');
  int get failed => n('failed');
  int get uncertain => n('uncertain');
  int get skipped => n('skipped');
}

/// "12,345": counts read the same everywhere.
String formatCount(num value) {
  final digits = value.round().abs().toString();
  final grouped = digits.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  return value < 0 ? '-$grouped' : grouped;
}

/// "4.2%", or a dash when there is nothing to divide by.
String percentOf(num part, num whole) {
  if (whole == 0) return '–';
  final share = part / whole;
  return '${(share * 100).toStringAsFixed(part != 0 && share < 0.01 ? 2 : 1)}%';
}

/// A conversation in the list (em_list_threads).
class ThreadSummary {
  ThreadSummary(this.raw);

  final Map<String, dynamic> raw;

  String get id => _text(raw['id']);
  String get subject => _text(raw['subject']).isEmpty ? '(no subject)' : _text(raw['subject']);
  String get snippet => _text(raw['snippet']);
  String get lastMessageAt => _text(raw['last_message_at']);
  bool get unread => raw['unread'] == true;
  bool get starred => raw['starred'] == true;
  bool get hasAttachments => raw['has_attachments'] == true;
  int get messageCount => raw['message_count'] is num ? (raw['message_count'] as num).toInt() : 1;
  int get linkCount => raw['link_count'] is num ? (raw['link_count'] as num).toInt() : 0;
  int get noteCount => raw['note_count'] is num ? (raw['note_count'] as num).toInt() : 0;
  String get workflow => _text(raw['workflow_status']).isEmpty ? 'open' : _text(raw['workflow_status']);
  String get assignedTo => _text(raw['assigned_to']);
  String get assignedName => _text(raw['assigned_name']);
  String get accountEmail => _text(raw['account_email']);
  String get accountName => _text(raw['account_name']).isEmpty ? accountEmail : _text(raw['account_name']);
  List<Person> get participants => _people(raw['participants']);

  /// "Asha, Ravi (3)": the people other than the mailbox itself first.
  String get participantLine {
    final all = participants;
    final others = all.where((p) => p.email != accountEmail).toList();
    final names = (others.isNotEmpty ? others : all).take(3).map((p) => p.first).where((n) => n.isNotEmpty).join(', ');
    final line = names.isEmpty ? '(no one)' : names;
    return messageCount > 1 ? '$line ($messageCount)' : line;
  }

  ThreadSummary patched(Map<String, dynamic> changes) => ThreadSummary({...raw, ...changes});
}

class EmailAttachment {
  EmailAttachment(Map raw)
    : id = _text(raw['id']),
      filename = _text(raw['filename']).isEmpty ? 'attachment' : _text(raw['filename']),
      mime = _text(raw['mime_type']),
      size = raw['size'] is num ? (raw['size'] as num).toInt() : 0,
      inline = raw['inline'] == true;

  final String id;
  final String filename;
  final String mime;
  final int size;
  final bool inline;
}

class EmailMessage {
  EmailMessage(this.raw);

  final Map<String, dynamic> raw;

  String get id => _text(raw['id']);
  String get date => _text(raw['date']);
  Person get from => Person.from(raw['from']);
  List<Person> get to => _people(raw['to']);
  List<Person> get cc => _people(raw['cc']);
  List<Person> get bcc => _people(raw['bcc']);
  List<Person> get replyTo => _people(raw['reply_to']);
  String get subject => _text(raw['subject']);
  bool get unread => raw['unread'] == true;
  bool get draft => raw['draft'] == true;

  /// The server's sanitized HTML: no scripts, remote images held back.
  String get html => _text(raw['html']);
  String get text => _text(raw['text']);
  int get blockedImages => raw['blocked_images'] is num ? (raw['blocked_images'] as num).toInt() : 0;

  /// Attachments to list: inline images of an HTML message are part of it.
  List<EmailAttachment> get attachments => [
    for (final a in _maps(raw['attachments']))
      if (a['inline'] != true || html.isEmpty) EmailAttachment(a),
  ];

  String get snippet {
    final flat = text.replaceAll(RegExp(r'\s+'), ' ').trim();
    return flat.length > 140 ? flat.substring(0, 140) : flat;
  }
}

class ThreadNote {
  ThreadNote(Map raw) : id = _text(raw['id']), author = _text(raw['author_name']), body = _text(raw['body']), createdAt = _text(raw['created_at']);

  final String id;
  final String author;
  final String body;
  final String createdAt;
}

/// GET /email/threads/:id: the conversation, its mailbox and Dikho's own notes.
class ThreadDetail {
  ThreadDetail(Map<String, dynamic> raw)
    : thread = ThreadSummary(_map(raw['thread'])),
      account = Mailbox(_map(raw['account'])),
      notes = [for (final n in _maps(raw['notes'])) ThreadNote(n)],
      assignable = [for (final p in _maps(raw['assignable'])) (_text(p['user_id']), _text(p['full_name']))],
      messages = [for (final m in _maps(raw['messages'])) EmailMessage(m)],
      omitted = raw['omitted'] is num ? (raw['omitted'] as num).toInt() : 0;

  ThreadSummary thread;
  final Mailbox account;
  List<ThreadNote> notes;
  final List<(String, String)> assignable;
  final List<EmailMessage> messages;
  final int omitted;

  String get role => account.role;
  bool get canAct => atLeast(role, 'responder');
  bool get canAssign => atLeast(role, 'manager');
  Set<String> get labelIds => {
    if (thread.raw['label_ids'] is List)
      for (final l in thread.raw['label_ids'] as List) '$l',
  };

  EmailMessage? get lastMessage {
    for (final m in messages.reversed) {
      if (!m.draft) return m;
    }
    return null;
  }
}

/// A CRM record whose address appears in the conversation, or that is linked to it.
class CrmRecord {
  CrmRecord(Map raw)
    : type = _text(raw['type']),
      id = _text(raw['id']),
      name = _text(raw['name']),
      contact = _text(raw['contact']),
      email = _text(raw['email']),
      place = _text(raw['place']),
      linked = raw['linked'] == true;

  final String type;
  final String id;
  final String name;
  final String contact;
  final String email;
  final String place;
  final bool linked;

  String get typeLabel => const {'client': 'Client', 'vendor': 'Vendor', 'lead': 'Lead'}[type] ?? type;
}

/* ── Times and sizes ──────────────────────────────────────────────────────── */

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

String _clock(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'am' : 'pm'}';
}

bool _sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

/// The time today, "Yesterday", "12 Oct" this year, "12 Oct 2025" before.
String listTime(String iso, DateTime now) {
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) return '';
  final d = parsed.toLocal();
  if (_sameDay(d, now)) return _clock(d);
  if (_sameDay(d, now.subtract(const Duration(days: 1)))) return 'Yesterday';
  return d.year == now.year ? '${d.day} ${_months[d.month - 1]}' : '${d.day} ${_months[d.month - 1]} ${d.year}';
}

/// "Tue, 12 Nov 2026, 4:05 pm".
String fullTime(String iso) {
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) return '';
  final d = parsed.toLocal();
  return '${_days[d.weekday - 1]}, ${d.day} ${_months[d.month - 1]} ${d.year}, ${_clock(d)}';
}

String syncedAgo(String iso, DateTime now) {
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) return 'never';
  final s = now.difference(parsed).inSeconds;
  if (s < 60) return 'just now';
  if (s < 3600) return '${(s / 60).round()} min ago';
  if (s < 86400) return '${(s / 3600).round()} h ago';
  return listTime(iso, now);
}

String formatSize(int bytes) {
  if (bytes <= 0) return '';
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
}

/// An address a mailbox may send as.
class SendAs {
  SendAs(Map raw)
    : email = _text(raw['email']),
      name = _text(raw['display_name']),
      isDefault = raw['is_default'] == true,
      signature = _text(raw['signature']);

  final String email;
  final String name;
  final bool isDefault;

  /// Sanitized HTML from the mailbox's settings.
  final String signature;

  String get label => name.isEmpty ? email : '$name <$email>';
}
