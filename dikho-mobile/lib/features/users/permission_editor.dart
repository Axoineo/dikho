import 'package:flutter/material.dart';

import '../inbox/chat_theme.dart';
import 'users_models.dart';

/// A person's or a template's permissions, redesigned for a phone: the web shows a
/// wide grid (PermissionMatrix.jsx); here each module is a card with a switch per
/// permission, its reach beside it, and quick settings for the whole module. The
/// rules are the grid's: the smallest change that gives the result, and only access
/// the editor holds can be given or taken.
class PermissionEditor extends StatelessWidget {
  const PermissionEditor.user({
    super.key,
    required this.catalog,
    required this.inherited,
    required Map<String, Map<String, String>> this.overrides,
    required ValueChanged<Map<String, Map<String, String>>> this.onOverrides,
    this.readOnly = false,
    this.superuser = false,
    this.effective = const {},
  }) : templatePermissions = null,
       onTemplate = null;

  const PermissionEditor.template({
    super.key,
    required this.catalog,
    required Map<String, String> this.templatePermissions,
    required ValueChanged<Map<String, String>> this.onTemplate,
    this.readOnly = false,
  }) : inherited = const {},
       overrides = null,
       onOverrides = null,
       superuser = false,
       effective = const {};

  final Catalog catalog;
  final Map<String, String> inherited;
  final Map<String, Map<String, String>>? overrides;
  final ValueChanged<Map<String, Map<String, String>>>? onOverrides;
  final Map<String, String>? templatePermissions;
  final ValueChanged<Map<String, String>>? onTemplate;
  final bool readOnly;

  /// Owners and developers hold everything: shown as they are, never narrowed.
  final bool superuser;
  final Map<String, Map<String, dynamic>> effective;

  bool get _userMode => overrides != null;

  PermissionState _state(PermissionDef p) {
    if (superuser) {
      final held = effective[p.key];
      return PermissionState(held != null, held?['scope'] as String?, PermissionSource.full);
    }
    if (!_userMode) {
      final scope = templatePermissions![p.key];
      return PermissionState(scope != null, scope, scope != null ? PermissionSource.template : PermissionSource.off);
    }
    return userPermissionState(p, inherited, overrides!);
  }

  void _set(PermissionDef p, {required bool on, String? scope}) {
    if (_userMode) {
      onOverrides!(setUserPermission(overrides!, inherited, p, on: on, scope: scope, widest: catalog.widestFor(p)));
    } else {
      final next = {...templatePermissions!};
      if (on) {
        next[p.key] = scope ?? catalog.widestFor(p);
      } else {
        next.remove(p.key);
      }
      onTemplate!(next);
    }
  }

  /// All, view only, none, or (for a person) back to the template.
  void _preset(PermissionModule m, String preset) {
    if (_userMode) {
      var next = {...overrides!};
      for (final p in m.permissions) {
        if (!catalog.canGrant(p)) continue;
        final base = inherited[p.key];
        if (preset == 'reset') {
          next.remove(p.key);
          continue;
        }
        final on = preset == 'all' || (preset == 'view' && p.action == 'view');
        if (!on) {
          if (base != null) {
            next[p.key] = {'effect': 'revoke'};
          } else {
            next.remove(p.key);
          }
        } else if (base != null) {
          next.remove(p.key);
        } else {
          next[p.key] = {'effect': 'grant', 'scope': catalog.widestFor(p)};
        }
      }
      onOverrides!(next);
    } else {
      final next = {...templatePermissions!};
      for (final p in m.permissions) {
        if (!catalog.canGrant(p)) continue;
        final on = preset == 'all' || (preset == 'view' && p.action == 'view');
        if (on) {
          next[p.key] = catalog.widestFor(p);
        } else {
          next.remove(p.key);
        }
      }
      onTemplate!(next);
    }
  }

  static String _sourceText(PermissionSource source) => switch (source) {
    PermissionSource.inherited => 'From the template or role',
    PermissionSource.added => 'Added for this person',
    PermissionSource.removed => 'Removed for this person',
    _ => '',
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final modules = groupCatalog(catalog.permissions);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final m in modules)
          Card.outlined(
            margin: const EdgeInsets.only(bottom: Gap.m),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(Gap.m, Gap.xs, Gap.xs, Gap.s),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Semantics(header: true, child: Text(m.name, style: theme.textTheme.titleSmall)),
                      ),
                      if (m.permissions.any((p) => p.developerOnly))
                        // Wraps under a large font rather than pushing off the screen.
                        Flexible(
                          child: Padding(
                            padding: const EdgeInsets.all(Gap.m),
                            child: Text('Comes with developer access', textAlign: TextAlign.end, style: muted),
                          ),
                        )
                      else if (!readOnly && !superuser)
                        PopupMenuButton<String>(
                          tooltip: 'Set all of ${m.name}',
                          icon: const Icon(Icons.tune),
                          onSelected: (preset) => _preset(m, preset),
                          itemBuilder: (_) => [
                            const PopupMenuItem(value: 'all', child: Text('All')),
                            const PopupMenuItem(value: 'view', child: Text('View only')),
                            const PopupMenuItem(value: 'none', child: Text('None')),
                            if (_userMode) const PopupMenuItem(value: 'reset', child: Text('Back to the template')),
                          ],
                        ),
                    ],
                  ),
                  for (final p in m.permissions) _row(context, p, muted),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _row(BuildContext context, PermissionDef p, TextStyle muted) {
    final theme = Theme.of(context);
    final s = _state(p);
    final locked = readOnly || superuser || !catalog.canGrant(p, s.scope ?? 'all');
    final note = superuser
        ? 'Full access'
        : locked && !readOnly
        ? 'You can only give or take access you have yourself.'
        : _sourceText(s.source);
    final scopes = p.allowedScopes;
    // The whole row turns it on or off: a bigger target than the switch alone.
    return MergeSemantics(
      child: InkWell(
        onTap: locked ? null : () => _set(p, on: !s.on),
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: Gap.xs),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(p.label.isEmpty ? p.key : p.label),
                    if (p.description.isNotEmpty) Text(p.description, style: muted),
                    if (note.isNotEmpty)
                      Text(
                        note,
                        style: muted.copyWith(
                          color: s.source == PermissionSource.removed
                              ? theme.colorScheme.error
                              : s.source == PermissionSource.added
                              ? theme.colorScheme.primary
                              : null,
                        ),
                      ),
                  ],
                ),
              ),
              if (s.on && scopes.length > 1)
                DropdownButton<String>(
                  value: scopes.contains(s.scope) ? s.scope : scopes.last,
                  underline: const SizedBox.shrink(),
                  onChanged: locked ? null : (scope) => _set(p, on: true, scope: scope),
                  items: [
                    for (final scope in scopes)
                      DropdownMenuItem(value: scope, enabled: catalog.canGrant(p, scope), child: Text(scopeShort[scope] ?? scope)),
                  ],
                ),
              Switch(
                value: s.on,
                onChanged: locked ? null : (on) => _set(p, on: on),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
