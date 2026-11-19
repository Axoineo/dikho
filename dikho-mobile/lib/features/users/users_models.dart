/// User Management, as src/features/users/ shows it: people, their access and
/// sessions, permission templates, departments and the audit log. Every change goes
/// through the API Worker, which checks the caller and hands it to the um_* database
/// functions that hold the rules; these helpers only avoid offering what would be
/// refused. Change one side and change the other.
library;

const roleLabels = {'staff': 'Staff', 'manager': 'Manager', 'admin': 'Admin', 'owner': 'Owner'};
const developerLabels = {
  'developer': 'Developer',
  'senior_developer': 'Senior Developer',
  'lead_developer': 'Lead Developer',
  'system_owner': 'System Administrator',
};
const statusLabels = {'active': 'Active', 'invited': 'Invited', 'suspended': 'Suspended', 'archived': 'Archived'};
const sectionLabels = {
  'clients': 'Clients',
  'leads': 'Leads',
  'vendors': 'Vendors',
  'sales-orders': 'Sales orders',
  'purchase-orders': 'Purchase orders',
  'invoices': 'Invoices',
  'payments': 'Payments',
  'courier': 'Document courier',
  'whatsapp': 'WhatsApp overview',
  'whatsapp-inbox': 'WhatsApp inbox',
  'whatsapp-contacts': 'WhatsApp contacts',
  'whatsapp-campaigns': 'WhatsApp campaigns',
  'whatsapp-templates': 'WhatsApp templates',
  'users': 'Users',
  'email': 'Email overview',
  'email-inbox': 'Email inbox',
  'email-settings': 'Email settings',
  'email-campaigns': 'Email campaigns',
  'email-templates': 'Email templates',
  'email-consent': 'Email consent',
  'email-analytics': 'Email analytics',
  'dashboard': 'Dashboard',
  'settings': 'Settings',
};

const roleRank = {'staff': 0, 'manager': 10, 'admin': 20, 'owner': 40};
const scopeRank = {'own': 1, 'team': 2, 'department': 3, 'all': 4};
const scopeShort = {'own': 'Own', 'team': 'Team', 'department': 'Dept', 'all': 'All'};
const _scopeWords = {'own': 'own records', 'team': 'their team', 'department': 'their department', 'all': 'all records'};
String scopeLabel(String scope) => _scopeWords[scope] ?? scope;

String _text(Object? value) => value is String ? value.trim() : (value == null ? '' : '$value');

/// "AF" for "Asha (Finance)": words that start with a letter.
String initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .map((w) => w.replaceFirst(RegExp(r'^[^\p{L}]+', unicode: true), ''))
      .where((w) => w.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  final first = String.fromCharCode(parts.first.runes.first);
  final last = parts.length > 1 ? String.fromCharCode(parts.last.runes.first) : '';
  return '$first$last'.toUpperCase();
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

DateTime? _parse(String iso) => iso.isEmpty ? null : DateTime.tryParse(iso)?.toLocal();

/// "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", "12 Sep".
String? relativeTime(String iso, DateTime now) {
  final then = _parse(iso);
  if (then == null) return null;
  final diff = now.difference(then);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inHours < 1) return '${diff.inMinutes} min ago';
  if (diff.inDays < 1) return '${diff.inHours} h ago';
  if (diff.inDays < 2) return 'yesterday';
  if (diff.inDays < 7) return '${diff.inDays} days ago';
  return '${then.day} ${_months[then.month - 1]}${diff.inDays > 300 ? ' ${then.year}' : ''}';
}

/// "12 Sep 2026, 3:05 pm"
String dateTime(String iso) {
  final at = _parse(iso);
  if (at == null) return '';
  final hour = at.hour % 12 == 0 ? 12 : at.hour % 12;
  return '${at.day} ${_months[at.month - 1]} ${at.year}, $hour:${at.minute.toString().padLeft(2, '0')} ${at.hour < 12 ? 'am' : 'pm'}';
}

/// "12 Sep 2026". A bare date is a calendar day, never shifted.
String dateOnly(String iso) {
  final at = iso.length <= 10 ? DateTime.tryParse(iso) : _parse(iso);
  if (at == null) return '';
  return '${at.day} ${_months[at.month - 1]} ${at.year}';
}

/// "Ahmedabad, Gujarat, IN" from Cloudflare's IP lookup; null when unknown.
String? locationLabel(Map row) {
  final city = _text(row['city']);
  final region = _text(row['region']);
  final country = _text(row['country']);
  final parts = [city, if (region != city) region, country].where((p) => p.isNotEmpty);
  return parts.isEmpty ? null : parts.join(', ');
}

/// "Chrome on Windows", "Dikho app on Android": rough on purpose, it labels a
/// session for a person, it does not identify a device.
String deviceLabel(String ua) {
  if (ua.isEmpty) return 'Unknown device';
  if (ua.contains('DikhoCRM/')) return 'Dikho app on Android';
  final os = RegExp('iPhone|iPad').hasMatch(ua)
      ? 'iOS'
      : ua.contains('Android')
      ? 'Android'
      : ua.contains('Windows')
      ? 'Windows'
      : RegExp('Mac OS X|Macintosh').hasMatch(ua)
      ? 'macOS'
      : ua.contains('CrOS')
      ? 'ChromeOS'
      : ua.contains('Linux')
      ? 'Linux'
      : null;
  final browser = ua.contains('Edg/')
      ? 'Edge'
      : RegExp(r'OPR/|Opera').hasMatch(ua)
      ? 'Opera'
      : ua.contains('SamsungBrowser')
      ? 'Samsung Internet'
      : ua.contains('Firefox/')
      ? 'Firefox'
      : ua.contains('Chrome/')
      ? 'Chrome'
      : ua.contains('Safari/')
      ? 'Safari'
      : null;
  if (browser != null && os != null) return '$browser on $os';
  return browser ?? os ?? 'Unknown device';
}

bool isPhoneDevice(String ua) => RegExp('Android|iPhone|iPad|DikhoCRM/').hasMatch(ua);

String? sectionLabel(String section) => section.isEmpty ? null : sectionLabels[section];

/// One person, as um_list_members and um_get_member return them.
class Member {
  Member(this.raw);

  final Map<String, dynamic> raw;

  String _t(String key) => _text(raw[key]);

  String get userId => _t('user_id');
  String get name => _t('full_name').isEmpty ? 'Unnamed' : _t('full_name');
  String get email => _t('email');
  String get phone => _t('phone');
  String get employeeId => _t('employee_id');
  String get designation => _t('designation');
  String get departmentId => _t('department_id');
  String get department => _t('department');
  String get teamId => _t('team_id');
  String get team => _t('team');
  String get templateId => _t('template_id');
  String get template => _t('template');
  String get reportingManagerId => _t('reporting_manager_id');
  String get reportingManager => _t('reporting_manager');
  String get joiningDate => _t('joining_date');
  String get role => _t('system_role').isEmpty ? 'staff' : _t('system_role');
  String get developerLevel => _t('developer_level');
  String get status => _t('status');
  String get statusReason => _t('status_reason');
  String get statusChangedAt => _t('status_changed_at');
  String get lastSeenAt => _t('last_seen_at');
  String get lastSeenSection => _t('last_seen_section');
  String get lastSignInAt => _t('last_sign_in_at');
  String get welcomeSentAt => _t('welcome_sent_at');
  String get welcomeChannel => _t('welcome_channel');
  String get createdAt => _t('created_at');
  bool get online => raw['online'] == true;
  bool get canManage => raw['can_manage'] == true;
  int get activeSessions => raw['active_sessions'] is num ? (raw['active_sessions'] as num).toInt() : 0;

  String get roleLabel => roleLabels[role] ?? 'Staff';
  String? get developerLabel => developerLevel.isEmpty ? null : developerLabels[developerLevel] ?? 'Developer';
  String get statusLabel => statusLabels[status] ?? status;
  bool get isAdminOrOwner => role == 'admin' || role == 'owner';

  /// Email, else the number, then the employee ID.
  String get contactLine {
    final reach = email.isNotEmpty ? email : (phone.isNotEmpty ? '+$phone' : '');
    return [reach, employeeId].where((p) => p.isNotEmpty).join(' · ');
  }

  /// What they can do: { key: {scope, source} } for the one viewed.
  Map<String, Map<String, dynamic>> get permissions => {
    if (raw['permissions'] is Map)
      for (final entry in (raw['permissions'] as Map).entries)
        if (entry.value is Map) '${entry.key}': Map<String, dynamic>.from(entry.value as Map),
  };

  /// This person's own changes to their template: { key: {effect, scope} }.
  Map<String, Map<String, String>> get overrides => {
    if (raw['overrides'] is Map)
      for (final entry in (raw['overrides'] as Map).entries)
        if (entry.value is Map)
          '${entry.key}': {
            for (final inner in (entry.value as Map).entries)
              if (inner.value is String) '${inner.key}': inner.value as String,
          },
  };

  List<Map<String, dynamic>> get sessions =>
      raw['sessions'] is List ? (raw['sessions'] as List).whereType<Map<String, dynamic>>().toList() : const [];
  bool get hasSessions => raw['sessions'] is List;
  List<Map<String, dynamic>> get recentSignIns =>
      raw['recent_sign_ins'] is List ? (raw['recent_sign_ins'] as List).whereType<Map<String, dynamic>>().toList() : const [];

  /// "Online · Sales orders", "Active 5 min ago", "Signed in yesterday", "Never signed in".
  String activity(DateTime now) {
    if (online) {
      final where = sectionLabel(lastSeenSection);
      return where == null ? 'Online' : 'Online · $where';
    }
    final seen = relativeTime(lastSeenAt, now);
    if (seen != null) return 'Active $seen';
    final signedIn = relativeTime(lastSignInAt, now);
    if (signedIn != null) return 'Signed in $signedIn';
    return 'Never signed in';
  }
}

class PermissionDef {
  PermissionDef(Map raw)
    : key = _text(raw['key']),
      module = _text(raw['module']),
      action = _text(raw['action']),
      label = _text(raw['label']),
      description = _text(raw['description']),
      developerOnly = raw['developer_only'] == true,
      allowedScopes = raw['allowed_scopes'] is List ? (raw['allowed_scopes'] as List).whereType<String>().toList() : const ['all'];

  final String key;
  final String module;
  final String action;
  final String label;
  final String description;
  final bool developerOnly;
  final List<String> allowedScopes;
}

class PermissionModule {
  PermissionModule(this.name, this.permissions);

  final String name;
  final List<PermissionDef> permissions;
}

/// groupCatalog: by module, in the catalog's order.
List<PermissionModule> groupCatalog(List<PermissionDef> permissions) {
  final modules = <String, List<PermissionDef>>{};
  for (final p in permissions) {
    modules.putIfAbsent(p.module, () => []).add(p);
  }
  return [for (final entry in modules.entries) PermissionModule(entry.key, entry.value)];
}

class Template {
  Template(Map raw)
    : id = _text(raw['id']),
      key = _text(raw['key']),
      name = _text(raw['name']),
      description = _text(raw['description']),
      builtIn = raw['built_in'] == true,
      members = raw['members'] is num ? (raw['members'] as num).toInt() : 0,
      permissions = {
        if (raw['permissions'] is Map)
          for (final entry in (raw['permissions'] as Map).entries)
            if (entry.value is String) '${entry.key}': entry.value as String,
      };

  final String id;
  final String key;
  final String name;
  final String description;
  final bool builtIn;
  final int members;
  final Map<String, String> permissions;
}

class OrgTeam {
  OrgTeam(Map raw)
    : id = _text(raw['id']),
      name = _text(raw['name']),
      archived = raw['archived'] == true,
      members = raw['members'] is num ? (raw['members'] as num).toInt() : 0;

  final String id;
  final String name;
  final bool archived;
  final int members;
}

class Department {
  Department(Map raw)
    : id = _text(raw['id']),
      name = _text(raw['name']),
      archived = raw['archived'] == true,
      members = raw['members'] is num ? (raw['members'] as num).toInt() : 0,
      teams = raw['teams'] is List ? (raw['teams'] as List).whereType<Map>().map(OrgTeam.new).toList() : const [];

  final String id;
  final String name;
  final bool archived;
  final int members;
  final List<OrgTeam> teams;
}

/// The person using the app, as the catalog describes them: their rank and what
/// they may hand out.
class Actor {
  Actor(Map raw)
    : userId = _text(raw['user_id']),
      role = _text(raw['system_role']).isEmpty ? 'staff' : _text(raw['system_role']),
      rank = raw['rank'] is num ? (raw['rank'] as num).toInt() : 0,
      permissions = {
        if (raw['permissions'] is Map)
          for (final entry in (raw['permissions'] as Map).entries)
            if (entry.value is String) '${entry.key}': entry.value as String,
      };

  final String userId;
  final String role;
  final int rank;

  /// key → scope the actor holds.
  final Map<String, String> permissions;
}

class Catalog {
  Catalog(Map raw)
    : actor = Actor(raw['actor'] is Map ? raw['actor'] as Map : const {}),
      templates = raw['templates'] is List ? (raw['templates'] as List).whereType<Map>().map(Template.new).toList() : const [],
      departments = raw['departments'] is List ? (raw['departments'] as List).whereType<Map>().map(Department.new).toList() : const [],
      permissions = raw['permissions'] is List ? (raw['permissions'] as List).whereType<Map>().map(PermissionDef.new).toList() : const [],
      rolePermissions = {
        if (raw['role_permissions'] is Map)
          for (final entry in (raw['role_permissions'] as Map).entries)
            if (entry.value is Map)
              '${entry.key}': {
                for (final inner in (entry.value as Map).entries)
                  if (inner.value is String) '${inner.key}': inner.value as String,
              },
      };

  final Actor actor;
  final List<Template> templates;
  final List<Department> departments;
  final List<PermissionDef> permissions;
  final Map<String, Map<String, String>> rolePermissions;

  Template? template(String id) => templates.where((t) => t.id == id).firstOrNull;
  Department? department(String id) => departments.where((d) => d.id == id).firstOrNull;
  PermissionDef? permission(String key) => permissions.where((p) => p.key == key).firstOrNull;

  /// Roles the actor may hand out: below their own rank, and Owner only by an Owner.
  List<String> assignableRoles() => [
    for (final role in roleRank.keys)
      if (actor.role == 'owner' || (roleRank[role]! < actor.rank && (role == 'staff' || actor.permissions.containsKey('users.roles')))) role,
  ];

  /// A template the actor could give: every permission in it, at least as wide.
  bool withinReach(Template template) => template.permissions.entries.every((entry) {
    final mine = actor.permissions[entry.key];
    return mine != null && (scopeRank[mine] ?? 0) >= (scopeRank[entry.value] ?? 99);
  });

  /// What a template and a system role give, before this person's own changes.
  Map<String, String> inherited(String templateId, String role) {
    final out = <String, String>{...?template(templateId)?.permissions};
    for (final entry in (rolePermissions[role] ?? const <String, String>{}).entries) {
      final had = out[entry.key];
      if (had == null || (scopeRank[entry.value] ?? 0) > (scopeRank[had] ?? 0)) out[entry.key] = entry.value;
    }
    return out;
  }

  /// The actor may give or take [p] at [scope]: only what they hold themselves.
  bool canGrant(PermissionDef p, [String scope = 'all']) {
    if (p.developerOnly) return false;
    final mine = actor.permissions[p.key];
    return mine != null && (scopeRank[mine] ?? 0) >= (scopeRank[scope] ?? 99);
  }

  /// The widest scope of [p] within the actor's own.
  String widestFor(PermissionDef p) {
    final mine = actor.permissions[p.key];
    final sorted = [...p.allowedScopes]..sort((a, b) => (scopeRank[b] ?? 0) - (scopeRank[a] ?? 0));
    return sorted.firstWhere((s) => mine == null || (scopeRank[s] ?? 0) <= (scopeRank[mine] ?? 0), orElse: () => 'all');
  }
}

enum PermissionSource { inherited, added, removed, off, template, full }

class PermissionState {
  const PermissionState(this.on, this.scope, this.source);

  final bool on;
  final String? scope;
  final PermissionSource source;
}

/// Where one permission stands for a person: from the template or role, added or
/// removed for them, or not at all (stateOf in PermissionMatrix.jsx).
PermissionState userPermissionState(PermissionDef p, Map<String, String> inherited, Map<String, Map<String, String>> overrides) {
  final o = overrides[p.key];
  final base = inherited[p.key];
  if (o?['effect'] == 'revoke') return const PermissionState(false, null, PermissionSource.removed);
  if (o?['effect'] == 'grant') return PermissionState(true, o?['scope'] ?? 'all', PermissionSource.added);
  return PermissionState(base != null, base, base != null ? PermissionSource.inherited : PermissionSource.off);
}

/// The smallest override that gives [p] this setting, so going back to how the
/// template has it never leaves a redundant override behind (setPermission).
Map<String, Map<String, String>> setUserPermission(
  Map<String, Map<String, String>> overrides,
  Map<String, String> inherited,
  PermissionDef p, {
  required bool on,
  String? scope,
  required String widest,
}) {
  final next = {...overrides};
  final base = inherited[p.key];
  if (!on) {
    if (base != null) {
      next[p.key] = {'effect': 'revoke'};
    } else {
      next.remove(p.key);
    }
  } else {
    final wanted = scope ?? base ?? widest;
    if (base != null && base == wanted) {
      next.remove(p.key);
    } else {
      next[p.key] = {'effect': 'grant', 'scope': wanted};
    }
  }
  return next;
}

/// The same overrides, compared without regard to key order.
bool sameOverrides(Map<String, Map<String, String>> a, Map<String, Map<String, String>> b) {
  if (a.length != b.length) return false;
  for (final entry in a.entries) {
    final other = b[entry.key];
    if (other == null || other.length != entry.value.length) return false;
    for (final inner in entry.value.entries) {
      if (other[inner.key] != inner.value) return false;
    }
  }
  return true;
}

/// One audit entry.
class AuditEvent {
  AuditEvent(this.raw);

  final Map<String, dynamic> raw;

  String _t(String key) => _text(raw[key]);

  String get id => _t('id');
  String get type => _t('event_type');
  String get occurredAt => _t('occurred_at');
  String get ip => _t('ip');
  String get targetUserId => _t('target_user_id');

  static const _verbs = {
    'user.created': 'added',
    'user.updated': 'updated the profile of',
    'user.role_changed': 'changed the system role of',
    'user.template_changed': 'changed the permission template of',
    'user.permissions_changed': 'changed the permissions of',
    'user.developer_granted': 'granted developer access to',
    'user.developer_revoked': 'removed developer access from',
    'user.suspended': 'suspended',
    'user.reactivated': 'reactivated',
    'user.archived': 'archived',
    'user.signed_out_everywhere': 'signed out',
    'user.session_ended': 'ended a session of',
    'user.welcome_sent': 'sent a welcome message to',
    'user.welcome_failed': 'could not deliver a welcome message to',
    'user.owner_bootstrapped': 'made the first Owner:',
    'access.denied': 'was refused an action on',
    'template.created': 'created a permission template',
    'template.updated': 'changed a permission template',
    'template.deleted': 'deleted a permission template',
    'department.saved': 'saved a department',
    'team.saved': 'saved a team',
  };

  /// Who did what to whom, as eventParts and describeEvent word it.
  String get sentence {
    final actor = _t('actor').isNotEmpty ? _t('actor') : (_t('actor_id').isNotEmpty ? 'Someone' : 'The system');
    final verb = _verbs[type] ?? type;
    final target = _t('target').isNotEmpty ? _t('target') : (targetUserId.isNotEmpty ? 'a former user' : '');
    if (type == 'user.signed_out_everywhere') return '$actor signed out ${target.isEmpty ? '' : '$target '}on every device'.trim();
    if (type == 'access.denied' && targetUserId.isEmpty) return '$actor was refused an action';
    return [actor, verb, target].where((p) => p.isNotEmpty).join(' ');
  }

  /// Short "before → after" lines, in plain words (describeChange).
  List<String> details(Catalog? catalog) {
    final lines = <String>[];
    final before = raw['old_value'] is Map ? raw['old_value'] as Map : const {};
    final after = raw['new_value'] is Map ? raw['new_value'] as Map : const {};
    final metadata = raw['metadata'] is Map ? raw['metadata'] as Map : const {};
    String label(String key) => catalog?.permission(key)?.label ?? key;
    String dev(Object? level) => level is String && level.isNotEmpty ? developerLabels[level] ?? 'Developer' : 'No developer access';
    String sessions(Object? count) => count is num ? '${count.toInt()} session${count == 1 ? '' : 's'} ended' : '';
    switch (type) {
      case 'user.role_changed':
        lines.add('${roleLabels[before['system_role']] ?? before['system_role']} → ${roleLabels[after['system_role']] ?? after['system_role']}');
      case 'user.developer_granted' || 'user.developer_revoked':
        lines.add('${dev(before['developer_level'])} → ${dev(after['developer_level'])}');
      case 'user.template_changed':
        lines.add(
          '${_text(before['template']).isEmpty ? 'No template' : before['template']} → ${_text(after['template']).isEmpty ? 'No template' : after['template']}',
        );
      case 'user.permissions_changed':
        String text(Object? o) => o is! Map
            ? 'as template'
            : o['effect'] == 'revoke'
            ? 'removed'
            : 'granted (${scopeLabel(_text(o['scope']))})';
        for (final key in {...before.keys, ...after.keys}) {
          if ('${before[key]}' != '${after[key]}') lines.add('${label('$key')}: ${text(before[key])} → ${text(after[key])}');
        }
      case 'user.suspended' || 'user.archived':
        if (_text(metadata['reason']).isNotEmpty) lines.add('Reason: ${metadata['reason']}');
        if (after['sessions_ended'] is num && after['sessions_ended'] != 0) lines.add(sessions(after['sessions_ended']));
      case 'user.signed_out_everywhere' || 'user.session_ended':
        if (after['sessions_ended'] != null) lines.add(sessions(after['sessions_ended']));
      case 'user.updated':
        for (final key in after.keys) {
          lines.add('${'$key'.replaceAll('_', ' ')}: ${before[key] ?? 'empty'} → ${after[key] ?? 'empty'}');
        }
      case 'user.welcome_sent' || 'user.welcome_failed':
        lines.add(after['channel'] == 'whatsapp' ? 'By WhatsApp' : 'By email');
      case 'access.denied':
        if (_text(metadata['message']).isNotEmpty) lines.add(_text(metadata['message']));
      default:
        if (_text(after['name']).isNotEmpty) lines.add(_text(after['name']));
    }
    return lines;
  }
}
