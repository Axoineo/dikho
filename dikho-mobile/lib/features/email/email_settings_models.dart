import 'email_models.dart';

/// What each role may do, as ROLE_HELP.
const roleHelp = {
  'viewer': 'Reads conversations.',
  'responder': 'Reads, replies, files and takes conversations.',
  'manager': 'Also assigns conversations to others.',
  'admin': 'Also chooses who may use the mailbox and connects it.',
};

enum NoticeTone { ok, warn, danger }

/// What happened when Google sent the person back, as CONNECT_OUTCOMES. Words only:
/// the server answers a fixed code, never Google's text.
const connectOutcomes = {
  'connected': (NoticeTone.ok, 'Mailbox connected. The first sync is running; recent conversations appear in a minute.'),
  'cancelled': (NoticeTone.warn, 'The connection was cancelled in Google. Nothing was connected.'),
  'expired': (NoticeTone.warn, 'That connection link had expired or was already used. Start again from this page.'),
  'invalid': (NoticeTone.danger, 'Google sent back an unexpected answer. Start again from this page.'),
  'scope_missing': (NoticeTone.danger, 'Dikho needs permission to read and send mail. Connect again and leave the Gmail box ticked.'),
  'no_refresh_token': (NoticeTone.danger, 'Google did not grant lasting access. Connect again.'),
  'identity_invalid': (NoticeTone.danger, 'Google could not confirm which account signed in. Connect again.'),
  'wrong_domain': (NoticeTone.danger, 'Only company Google Workspace accounts can be connected.'),
  'conflict': (
    NoticeTone.danger,
    'That mailbox is already connected by someone else, or you signed in as a different address than the shared mailbox.',
  ),
  'forbidden': (NoticeTone.danger, "You are not allowed to connect that mailbox. A colleague's own address can only be connected by them."),
  'not_yours': (
    NoticeTone.danger,
    'This connection was started by someone else in Dikho, so nothing was connected. If someone sent you that link, tell an administrator. To connect your own mailbox, start from this page.',
  ),
  'not_configured': (NoticeTone.danger, 'Google sign-in is not set up on the server yet. Ask an administrator.'),
  'google_error': (NoticeTone.danger, 'Google reported an error. Try again in a minute.'),
  'google_unreachable': (NoticeTone.danger, 'Google could not be reached. Try again in a minute.'),
  'exchange_failed': (NoticeTone.danger, 'Google did not accept the connection. Start again from this page.'),
  'failed': (NoticeTone.danger, 'The mailbox could not be connected. Try again.'),
};

(NoticeTone, String) connectOutcome(String code) => connectOutcomes[code] ?? connectOutcomes['failed']!;

/// GET /email/accounts, arranged as EmailSettings.jsx arranges it.
class MailboxSettings {
  MailboxSettings(Map<String, dynamic> raw, {required this.me})
    : canConnectPersonal = raw['can_connect_personal'] == true,
      canManageShared = raw['can_manage_shared'] == true,
      _all = [for (final m in _list(raw['mailboxes'])) Mailbox(m)],
      _setup = [for (final m in _list(raw['shared_setup'])) Mailbox(m)];

  final bool canConnectPersonal;
  final bool canManageShared;
  final List<Mailbox> _all;
  final List<Mailbox> _setup;

  /// This person's user id.
  final String me;

  /// This person's own mailbox, when connected or started.
  Mailbox? get mine => _all.where((m) => m.kind == 'personal' && m.ownerId == me).firstOrNull;

  /// Shared mailboxes this person sets up, whether or not they can read them.
  List<Mailbox> get sharedAdmin {
    final byId = <String, Map<String, dynamic>>{};
    for (final m in _setup) {
      byId[m.id] = {...m.raw, 'can_configure': true};
    }
    for (final m in _all) {
      if (m.kind == 'shared' && (m.canConfigure || byId.containsKey(m.id))) byId[m.id] = {...?byId[m.id], ...m.raw};
    }
    return [for (final raw in byId.values) Mailbox(raw)]..sort((a, b) => a.email.compareTo(b.email));
  }

  /// Mailboxes this person can read but not set up.
  List<Mailbox> get sharedWithMe {
    final own = mine;
    final admin = {for (final m in sharedAdmin) m.id};
    return [
      for (final m in _all)
        if (m.id != own?.id && !admin.contains(m.id)) m,
    ];
  }
}

/// GET /email/status: what the server has set up, as yes or no.
class ServerSetup {
  ServerSetup(Map<String, dynamic> raw)
    : gmail = _map(raw['gmail'])['configured'] == true,
      hostinger = _map(raw['hostinger'])['configured'] == true,
      delivery = _map(raw['delivery']);

  final bool gmail;
  final bool hostinger;
  final Map<String, dynamic> delivery;

  bool get any => gmail || hostinger;
  bool readyFor(Mailbox m) => m.provider == 'hostinger' ? hostinger : gmail;

  /// brevo, ses or empty.
  String get sender => delivery['provider'] is String ? delivery['provider'] as String : '';
  bool get brevo => _map(delivery['brevo'])['configured'] == true;
  bool get sesOn => _map(delivery['ses'])['configured'] == true && _map(delivery['ses'])['sending_enabled'] == true;
}

class Member {
  Member(Map<String, dynamic> raw)
    : userId = _text(raw['user_id']),
      name = _text(raw['full_name']),
      role = _text(raw['role']),
      active = raw['active'] != false,
      owner = raw['is_owner'] == true,
      grantedBy = _text(raw['granted_by_name']);

  final String userId;
  final String name;
  final String role;
  final bool active;
  final bool owner;
  final String grantedBy;
}

class Members {
  Members(Map<String, dynamic> raw) : people = [for (final m in _list(raw['members'])) Member(m)], canConfigure = raw['can_configure'] == true;

  final List<Member> people;
  final bool canConfigure;
}

/// Someone who could be given access, from GET /email/directory.
class DirectoryPerson {
  DirectoryPerson(Map<String, dynamic> raw) : userId = _text(raw['user_id']), name = _text(raw['full_name']), hasInbox = raw['has_inbox'] != false;

  final String userId;
  final String name;

  /// Without the Email permission they are added but cannot open the inbox.
  final bool hasInbox;
}

/// Whether outside mail reaches a mailbox, from its domain's MX records.
class Routing {
  Routing(Map<String, dynamic> raw)
    : inbound = _text(raw['inbound']),
      note = _text(raw['note']),
      mx = [
        for (final r in _list(raw['mx']))
          if (r['host'] is String) r['host'] as String,
      ];

  Routing.unknown() : inbound = 'unknown', note = "The domain's mail routing could not be checked just now.", mx = const [];

  final String inbound;
  final String note;
  final List<String> mx;

  String get label => switch (inbound) {
    'direct' => 'Receives mail directly',
    'elsewhere' => 'Incoming mail goes elsewhere',
    'none' => 'Domain cannot receive mail',
    _ => 'Receiving not checked',
  };
}

/// The roles a mailbox can give: a personal mailbox has no administrators but its owner.
List<String> rolesFor(Mailbox m) =>
    m.kind == 'personal' ? const ['viewer', 'responder', 'manager'] : const ['viewer', 'responder', 'manager', 'admin'];

/// Mail Dikho sends by itself, in words.
String senderLabel(String provider) => switch (provider) {
  'ses' => 'Amazon SES',
  'brevo' => 'Brevo',
  _ => 'Not sending',
};

List<Map<String, dynamic>> _list(Object? value) => value is List
    ? [
        for (final v in value)
          if (v is Map) v.cast<String, dynamic>(),
      ]
    : const [];
Map<String, dynamic> _map(Object? value) => value is Map ? value.cast<String, dynamic>() : const {};
String _text(Object? value) => value is String ? value : '';
