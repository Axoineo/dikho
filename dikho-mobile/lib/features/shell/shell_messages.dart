/// What the CRM page tells the app about the signed-in person. Everything here
/// comes from a web page, so each field is checked and bounded before use, and
/// none of it is trusted for authorization: the API and RLS decide on every
/// request. These only choose what to draw.
library;

import 'dart:convert';

final _pathShape = RegExp(r'^/[A-Za-z0-9/_-]{0,120}$');
final _permissionShape = RegExp(r'^[a-z_.]{1,60}$');

class ShellAccess {
  const ShellAccess({
    required this.userId,
    required this.name,
    required this.email,
    required this.allowed,
    required this.permissions,
    this.scopes,
    required this.helpOffered,
    required this.helpRequested,
    required this.supabaseUrl,
    required this.publishableKey,
    this.sessionId = '',
    this.theme,
    this.preferences = const {},
  });

  final String userId;
  final String name;
  final String email;
  final Set<String> allowed;
  final Set<String> permissions;

  /// How far each permission reaches ('own', 'team', 'department' or 'all'). Null
  /// from a page too old to send them.
  final Map<String, String>? scopes;
  final bool helpOffered;
  final bool helpRequested;
  final String supabaseUrl;
  final String publishableKey;

  /// This sign-in's id (the JWT's session_id), from my_access. Empty from the page.
  final String sessionId;

  /// 'light', 'dark' or 'system' as saved to the person's profile; null when unknown
  /// (from the page, or never chosen).
  final String? theme;

  /// my_access's `preferences` (start page, table density, rows per page).
  final Map<String, Object?> preferences;

  /// The same access with Live Assist's state, which only the page knows for now.
  ShellAccess withHelp({required bool offered, required bool requested}) => ShellAccess(
    userId: userId,
    name: name,
    email: email,
    allowed: allowed,
    permissions: permissions,
    scopes: scopes,
    helpOffered: offered,
    helpRequested: requested,
    supabaseUrl: supabaseUrl,
    publishableKey: publishableKey,
    sessionId: sessionId,
    theme: theme,
    preferences: preferences,
  );

  bool can(String permission) => permissions.contains(permission);

  /// The permission's reach, or null when it is not held. A page that sends no
  /// scopes gives 'all' for every permission held, and RLS still refuses the rest.
  String? scopeOf(String permission) {
    if (!can(permission)) return null;
    final known = scopes;
    return known == null ? 'all' : known[permission];
  }

  bool mayOpen(String path) => allowed.contains(path);

  String get initials {
    final words = name.trim().split(RegExp(r'[\s._-]+')).where((w) => w.isNotEmpty);
    final letters = words.take(2).map((w) => w.characters0).join();
    return letters.isEmpty ? '?' : letters.toUpperCase();
  }
}

extension on String {
  String get characters0 => isEmpty ? '' : String.fromCharCode(runes.first);
}

sealed class ShellMessage {
  const ShellMessage();
}

class AccessMessage extends ShellMessage {
  const AccessMessage(this.access);
  final ShellAccess access;
}

/// The page is signed out. [reason] says why when it was not the person's choice:
/// 'forced', 'ended', 'idle', 'suspended', 'archived' or 'not_staff'.
class SignedOutMessage extends ShellMessage {
  const SignedOutMessage({this.reason});
  final String? reason;
}

const signOutReasons = {'forced', 'ended', 'idle', 'suspended', 'archived', 'not_staff'};

class RouteMessage extends ShellMessage {
  const RouteMessage(this.path);
  final String path;
}

class ReadyMessage extends ShellMessage {
  const ReadyMessage();
}

class TokenMessage extends ShellMessage {
  const TokenMessage(this.id, this.token);
  final int id;
  final String? token;
}

class ThemeMessage extends ShellMessage {
  const ThemeMessage({required this.dark});
  final bool dark;
}

/// A page asked for one of the screens the app draws itself.
class OpenScreenMessage extends ShellMessage {
  const OpenScreenMessage(this.screen);
  final String screen;
}

/// The person used the page (in an app that owns the session, the page reports it,
/// at most every 30 seconds, instead of keeping its own idle clock).
class ActiveMessage extends ShellMessage {
  const ActiveMessage();
}

class WarningMessage extends ShellMessage {
  const WarningMessage({required this.showing});
  final bool showing;
}

String _bounded(Object? value, int max) => value is String && value.length <= max ? value : '';

const _scopeValues = {'own', 'team', 'department', 'all'};

Map<String, String>? _scopes(Object? value) {
  if (value is! Map || value.length > 300) return null;
  return {
    for (final entry in value.entries)
      if (entry.key is String && _permissionShape.hasMatch(entry.key as String) && _scopeValues.contains(entry.value))
        entry.key as String: entry.value as String,
  };
}

Set<String> _strings(Object? value, RegExp shape, int max) {
  if (value is! List || value.length > max) return const {};
  return value.whereType<String>().where(shape.hasMatch).toSet();
}

/// Null for anything malformed: it is dropped, never guessed at.
ShellMessage? parseShellMessage(String body) {
  final Object? decoded;
  try {
    decoded = jsonDecode(body);
  } on FormatException {
    return null;
  }
  if (decoded is! Map<String, Object?>) return null;
  switch (decoded['t']) {
    case 'access':
      return AccessMessage(
        ShellAccess(
          userId: _bounded(decoded['userId'], 64),
          name: _bounded(decoded['name'], 160),
          email: _bounded(decoded['email'], 254),
          allowed: _strings(decoded['allowed'], _pathShape, 60),
          permissions: _strings(decoded['permissions'], _permissionShape, 300),
          scopes: _scopes(decoded['scopes']),
          helpOffered: decoded['helpOffered'] == true,
          helpRequested: decoded['helpRequested'] == true,
          supabaseUrl: _bounded(decoded['supabaseUrl'], 300),
          publishableKey: _bounded(decoded['publishableKey'], 300),
        ),
      );
    case 'signedOut':
      final reason = decoded['reason'];
      return SignedOutMessage(reason: reason is String && signOutReasons.contains(reason) ? reason : null);
    case 'route':
      final path = decoded['path'];
      return path is String && _pathShape.hasMatch(path) ? RouteMessage(path) : null;
    case 'ready':
      return const ReadyMessage();
    case 'token':
      final id = decoded['id'];
      final token = decoded['token'];
      if (id is! int) return null;
      if (token == null) return TokenMessage(id, null);
      return token is String && token.length <= 8192 ? TokenMessage(id, token) : null;
    case 'theme':
      return ThemeMessage(dark: decoded['value'] == 'dark');
    case 'open':
      final screen = decoded['screen'];
      const known = {
        'inbox',
        'clients',
        'leads',
        'sales-orders',
        'vendors',
        'purchase-orders',
        'users',
        'settings',
        'email-inbox',
        'email',
        'email-analytics',
        'email-campaigns',
        'email-templates',
        'email-consent',
        'email-settings',
        'dashboard',
        'whatsapp-contacts',
        'whatsapp-campaigns',
        'templates',
      };
      return screen is String && known.contains(screen) ? OpenScreenMessage(screen) : null;
    case 'active':
      return const ActiveMessage();
    case 'warning':
      return WarningMessage(showing: decoded['showing'] == true);
  }
  return null;
}
