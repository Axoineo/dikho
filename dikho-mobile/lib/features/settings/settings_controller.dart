import 'package:flutter/foundation.dart';

import '../../shared/crm_api.dart';
import '../../shared/supabase_rest.dart';
import '../users/users_models.dart';
import 'settings_models.dart';

/// Settings' reads and writes, through the same database functions and API routes
/// as src/lib/settings.js and the web Settings pages. Every change is checked again
/// by the database (settings.manage for the organization's settings), so this class
/// decides nothing about who may change what.
class SettingsController extends ChangeNotifier {
  SettingsController({required this.rest, required this.api, this.onChanged});

  final SupabaseRest rest;
  final CrmApi api;

  /// After a saved change: [organization] when it changes what everyone sees (lists,
  /// formats), so screens holding a copy of get_settings load it again.
  final void Function({required bool organization})? onChanged;

  bool _disposed = false;

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /* ── Your account ──────────────────────────────────────────────────────── */

  /// From my_access; set again by every save.
  Preferences preferences = const Preferences();

  void usePreferences(Map<String, Object?> value) {
    preferences = Preferences(value);
    _notify();
  }

  /// Your own profile and devices: GET /users/me needs no users.* permission.
  Future<Member> me() async => Member(await api.get('/users/me'));

  /// Shown at once, then replaced by what the database kept. Put back when refused.
  Future<void> savePreferences(Map<String, Object?> changes) async {
    final previous = preferences;
    preferences = preferences.merged(changes);
    _notify();
    try {
      final saved = await rest.rpcWrite('set_my_preferences', {'p_changes': changes});
      if (saved is Map) preferences = Preferences(Map<String, Object?>.from(saved));
      onChanged?.call(organization: false);
    } on Object {
      preferences = previous;
      rethrow;
    } finally {
      _notify();
    }
  }

  /// 'light', 'dark' or 'system', saved to the person's profile so it follows them.
  Future<void> saveTheme(String mode) async {
    await rest.rpcWrite('set_my_theme', {'p_theme': mode});
    onChanged?.call(organization: false);
  }

  /* ── Organization ──────────────────────────────────────────────────────── */

  /// get_settings: the display formats and every dropdown list.
  Object? settings;
  bool settingsLoaded = false;

  /// The database has not had the Settings update (PostgREST cannot find the function).
  bool notReady = false;
  String? settingsError;

  Future<void> loadSettings() async {
    try {
      settings = await rest.rpc('get_settings');
      notReady = false;
      settingsError = null;
    } on ApiException catch (failure) {
      notReady = failure.code == 'PGRST202' || failure.status == 404;
      settingsError = notReady ? null : failure.message;
    } finally {
      settingsLoaded = true;
      _notify();
    }
  }

  Regional get regional => Regional.from(settings);

  List<OptionRow> options(String listKey) => optionsOf(settings, listKey);

  Future<void> saveRegional(Regional value) async {
    await rest.rpcWrite('update_organization_settings', {'p_changes': value.toJson()});
    await _organizationChanged();
  }

  Future<Map<String, String>> loadCompany() async => companyForm(await rest.rpc('get_organization_profile'));

  /// Only the fields that changed. Returns the profile as the database kept it.
  Future<Map<String, String>> saveCompany(Map<String, String> changes) async {
    final saved = companyForm(await rest.rpcWrite('update_organization_profile', {'p_changes': changes}));
    onChanged?.call(organization: false);
    return saved;
  }

  Future<void> addOption(String listKey, String value, {String? label}) async {
    await rest.rpcWrite('add_list_option', {'p_list': listKey, 'p_value': value, 'p_label': label});
    await _organizationChanged();
  }

  /// Values are hidden, never deleted: orders already hold them.
  Future<void> setOptionHidden(int id, bool hidden) async {
    await rest.rpcWrite('set_list_option_hidden', {'p_id': id, 'p_hidden': hidden});
    await _organizationChanged();
  }

  /// [direction] -1 is up, 1 is down.
  Future<void> moveOption(int id, int direction) async {
    await rest.rpcWrite('move_list_option', {'p_id': id, 'p_direction': direction});
    await _organizationChanged();
  }

  Future<void> _organizationChanged() async {
    await loadSettings();
    onChanged?.call(organization: true);
  }

  /* ── Media ─────────────────────────────────────────────────────────────── */

  List<MediaType>? media;
  List<SubMediaType> subMedia = const [];
  String? mediaError;

  Future<void> loadMedia() async {
    try {
      final results = await Future.wait([
        rest.select('media', query: {'select': '*', 'order': 'name.asc'}, from: 0, to: 999),
        rest.select('sub_media', query: {'select': '*', 'order': 'name.asc'}, from: 0, to: 1999),
      ]);
      media = results[0].rows.map(MediaType.new).toList();
      subMedia = results[1].rows.map(SubMediaType.new).toList();
      mediaError = null;
    } on ApiException catch (failure) {
      mediaError = failure.message;
    } finally {
      _notify();
    }
  }

  /// A new media type when [id] is null; else a rename ([name]) or hide/show ([hidden]).
  Future<void> saveMedia({int? id, String? name, bool? hidden}) async {
    await rest.rpcWrite('save_media', {'p_id': id, 'p_name': name, 'p_hidden': hidden});
    await loadMedia();
    onChanged?.call(organization: true);
  }

  /// A new sub media under [mediaId] when [id] is null; else a rename or hide/show.
  Future<void> saveSubMedia({int? id, int? mediaId, String? name, bool? hidden}) async {
    await rest.rpcWrite('save_sub_media', {'p_id': id, 'p_media_id': mediaId, 'p_name': name, 'p_hidden': hidden});
    await loadMedia();
    onChanged?.call(organization: true);
  }
}
