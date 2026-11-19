import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../shared/crm_api.dart';
import 'users_models.dart';

/// What the people list is narrowed to, as the web People tab's filters.
class PeopleFilter {
  const PeopleFilter({this.status = 'current', this.role = '', this.department = '', this.template = ''});

  /// 'current' (everyone but archived), '' (everyone), or one status.
  final String status;

  /// '' for every role, a system role, or 'developer'.
  final String role;
  final String department;

  /// '' for every template, 'none' for custom, or a template id.
  final String template;

  bool get narrowed => status != 'current' || role.isNotEmpty || department.isNotEmpty || template.isNotEmpty;

  PeopleFilter copyWith({String? status, String? role, String? department, String? template}) => PeopleFilter(
    status: status ?? this.status,
    role: role ?? this.role,
    department: department ?? this.department,
    template: template ?? this.template,
  );
}

/// User Management through the API Worker (src/api/routes/users): the people, the
/// catalog of roles, templates, departments and permissions, and every change. The
/// Worker and the um_* functions decide who may do what.
class UsersController extends ChangeNotifier {
  UsersController({required this.api, DateTime Function()? now, this.refreshEvery = const Duration(seconds: 30)}) : _now = now ?? DateTime.now;

  final CrmApi api;
  final DateTime Function() _now;
  final Duration refreshEvery;

  List<Member>? members;
  String? error;
  Catalog? catalog;
  String? catalogError;
  String query = '';
  PeopleFilter filter = const PeopleFilter();

  Timer? _refresh;
  bool _disposed = false;

  DateTime now() => _now();

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /// The list, kept fresh while it is on screen so "Online" stays true.
  void watch() {
    unawaited(load());
    if (catalog == null) unawaited(loadCatalog());
    _refresh?.cancel();
    _refresh = Timer.periodic(refreshEvery, (_) => unawaited(load()));
  }

  void unwatch() {
    _refresh?.cancel();
    _refresh = null;
  }

  Future<void> load() async {
    try {
      members = (await api.getList('/users')).map(Member.new).toList();
      error = null;
    } on ApiException catch (failure) {
      error = failure.message;
    }
    _notify();
  }

  Future<void> loadCatalog() async {
    try {
      catalog = Catalog(await api.get('/users/catalog'));
      catalogError = null;
    } on ApiException catch (failure) {
      catalogError = failure.message;
    }
    _notify();
  }

  void setQuery(String value) {
    query = value;
    _notify();
  }

  void setFilter(PeopleFilter value) {
    filter = value;
    _notify();
  }

  /// The people shown: filtered and searched here, as the web does, since the whole
  /// list comes at once.
  List<Member> get shown {
    final q = query.trim().toLowerCase();
    final f = filter;
    return [
      for (final m in members ?? const <Member>[])
        if (!(f.status == 'current' ? m.status == 'archived' : f.status.isNotEmpty && m.status != f.status) &&
            !(f.role == 'developer' ? m.developerLevel.isEmpty : f.role.isNotEmpty && m.role != f.role) &&
            !(f.department.isNotEmpty && m.departmentId != f.department) &&
            !(f.template == 'none' ? m.templateId.isNotEmpty : f.template.isNotEmpty && m.templateId != f.template) &&
            (q.isEmpty || [m.name, m.email, m.phone, m.employeeId, m.designation].any((v) => v.toLowerCase().contains(q))))
          m,
    ];
  }

  ({int total, int online, int invited, int suspended, int admins, int developers}) get counts {
    final list = members ?? const <Member>[];
    return (
      total: list.where((m) => m.status != 'archived').length,
      online: list.where((m) => m.online).length,
      invited: list.where((m) => m.status == 'invited').length,
      suspended: list.where((m) => m.status == 'suspended').length,
      admins: list.where((m) => m.isAdminOrOwner && m.status != 'archived').length,
      developers: list.where((m) => m.developerLevel.isNotEmpty && m.status != 'archived').length,
    );
  }

  /* ── One person ────────────────────────────────────────────────────── */

  Future<Member> member(String id) async => Member(await api.get('/users/$id'));

  /// Adds someone. The result says whether an existing sign-in account was linked
  /// and whether the welcome message went.
  Future<({Member member, bool reused, bool welcomeSent, String? welcomeReason})> create(Map<String, Object?> body) async {
    final result = await api.post('/users', body);
    final welcome = result['welcome'] is Map ? result['welcome'] as Map : const {};
    final added = Member(result['user'] is Map<String, dynamic> ? result['user'] as Map<String, dynamic> : const {});
    unawaited(load());
    return (
      member: added,
      reused: result['reused_account'] == true,
      welcomeSent: welcome['sent'] == true,
      welcomeReason: welcome['reason'] is String ? welcome['reason'] as String : null,
    );
  }

  Future<Member> update(String id, Map<String, Object?> patch) async {
    final saved = Member(await api.patch('/users/$id', patch));
    unawaited(load());
    return saved;
  }

  Future<Member> setOverrides(String id, Map<String, Map<String, String>> overrides) async =>
      Member(await api.put('/users/$id/permissions', {'overrides': overrides}));

  /// Suspend, reactivate or archive. False in the second place when the sign-in
  /// service could not be told (Dikho refuses them anyway).
  Future<({Member member, bool signInUpdated})> setStatus(String id, String status, String reason) async {
    final result = await api.post('/users/$id/status', {'status': status, 'reason': reason.isEmpty ? null : reason});
    unawaited(load());
    return (
      member: Member(result['user'] is Map<String, dynamic> ? result['user'] as Map<String, dynamic> : const {}),
      signInUpdated: result['sign_in_updated'] != false,
    );
  }

  /// Every session, or the one [sessionId]. Returns how many ended.
  Future<int> signOut(String id, {String? sessionId}) async {
    final result = await api.post('/users/$id/sign-out', {'session_id': sessionId});
    final ended = result['sessions_ended'];
    return ended is num ? ended.toInt() : 0;
  }

  Future<({bool sent, String channel, String reason})> resendWelcome(String id) async {
    final result = await api.post('/users/$id/welcome', {});
    return (
      sent: result['sent'] == true,
      channel: result['channel'] is String ? result['channel'] as String : '',
      reason: result['reason'] is String ? result['reason'] as String : '',
    );
  }

  /* ── Templates, departments, the audit log ───────────────────────────── */

  Future<void> saveTemplate({String? id, required String name, required String description, required Map<String, String> permissions}) async {
    catalog = Catalog(
      await api.post('/users/templates', {'id': id, 'name': name.trim(), 'description': description.trim(), 'permissions': permissions}),
    );
    _notify();
  }

  Future<void> deleteTemplate(String id) async {
    catalog = Catalog(await api.delete('/users/templates/$id', {}));
    _notify();
  }

  /// A department or team: a new one ([id] null), a new name, or archived or restored.
  Future<void> saveOrgUnit({required String kind, String? id, String? departmentId, required String name, bool? archived}) async {
    catalog = Catalog(
      await api.post('/users/org-units', {'kind': kind, 'id': ?id, 'department_id': ?departmentId, 'name': name.trim(), 'archived': ?archived}),
    );
    _notify();
  }

  /// Fifty entries at a time, newest first; [before] continues from an entry's id.
  Future<List<AuditEvent>> audit({String? user, String? before}) async =>
      (await api.getList('/users/audit', query: {'user': ?user, 'before': ?before})).map(AuditEvent.new).toList();

  @override
  void dispose() {
    _disposed = true;
    _refresh?.cancel();
    super.dispose();
  }
}
