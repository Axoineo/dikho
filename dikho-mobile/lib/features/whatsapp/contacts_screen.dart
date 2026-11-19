import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../shared/crm_api.dart';
import '../../shared/platform_api.dart';
import '../../shared/record_ui.dart';
import '../../shared/values.dart';
import '../inbox/chat_theme.dart';
import '../inbox/inbox_api.dart';
import '../inbox/template_sheet.dart';
import 'analytics_models.dart' show parseStamp;
import 'contact_import_screen.dart';
import 'contacts_controller.dart';
import 'contacts_models.dart';

const _loadMoreWithin = 200.0;

/// What this person may do here; the API checks each again.
class ContactAbilities {
  const ContactAbilities({this.delete = false, this.import = false, this.sendTemplates = false});

  final bool delete;
  final bool import;
  final bool sendTemplates;
}

/// The campaign audience, as the web Contacts page lists it: newest first, a page at a
/// time, searchable by name, number or company. A long press selects contacts to delete.
class ContactsScreen extends StatefulWidget {
  const ContactsScreen({
    super.key,
    required this.controller,
    required this.platform,
    required this.inboxApi,
    required this.abilities,
    required this.onOpenDrawer,
  });

  final ContactsController controller;
  final PlatformApi platform;
  final InboxApi inboxApi;
  final ContactAbilities abilities;
  final VoidCallback onOpenDrawer;

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  final _scroll = ScrollController();
  final _search = TextEditingController();
  final _selected = <int>{};

  ContactsController get _contacts => widget.controller;
  bool get _selecting => _selected.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _search.text = _contacts.query;
    _scroll.addListener(() {
      final position = _scroll.position;
      if (position.maxScrollExtent - position.pixels < _loadMoreWithin) unawaited(_contacts.loadMore());
    });
    if (_contacts.contacts.isEmpty && !_contacts.loading) {
      unawaited(_contacts.start());
    } else {
      unawaited(_contacts.refresh());
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    _search.dispose();
    super.dispose();
  }

  void _notice(String text) => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

  void _toggle(WaContact contact) => setState(() {
    if (!_selected.remove(contact.id)) _selected.add(contact.id);
  });

  Future<void> _open(WaContact contact) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final deleted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ContactDetailsScreen(
          contact: contact,
          platform: widget.platform,
          inboxApi: widget.inboxApi,
          abilities: widget.abilities,
          onDelete: () => _contacts.delete([contact.id]),
        ),
      ),
    );
    if (deleted == true && mounted) _notice('Deleted ${contact.title}.');
  }

  Future<void> _deleteSelected() async {
    final count = _selected.length;
    final label = count == 1 ? '1 contact' : '$count contacts';
    if (!await confirmDelete(context, 'Delete $label?')) return;
    try {
      await _contacts.delete(_selected);
      if (!mounted) return;
      setState(_selected.clear);
      _notice('Deleted $label.');
    } on ApiException catch (failure) {
      if (mounted) _notice(friendlyError(failure));
    }
  }

  /// A spreadsheet of contacts, read and checked on the phone, then this list again.
  Future<void> _import() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ContactImportScreen(
          api: _contacts.api,
          platform: widget.platform,
          onImported: (summary) {
            ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(summary)));
          },
        ),
      ),
    );
    if (mounted) unawaited(_contacts.reload());
  }

  Future<void> _deleteAll() async {
    final total = _contacts.total ?? 0;
    final label = total == 1 ? 'the only contact' : 'all ${formatCount(total)} contacts';
    if (!await confirmDelete(context, 'Delete $label?', everyone: true)) return;
    try {
      await _contacts.deleteAll();
      if (!mounted) return;
      setState(_selected.clear);
      _notice('Deleted $label.');
    } on ApiException catch (failure) {
      if (mounted) _notice(friendlyError(failure));
    }
  }

  PreferredSizeWidget _appBar() {
    if (_selecting) {
      return AppBar(
        leading: IconButton(tooltip: 'Clear selection', onPressed: () => setState(_selected.clear), icon: const Icon(Icons.close)),
        title: Text('${_selected.length} selected'),
        actions: [
          if (widget.abilities.delete)
            IconButton(
              tooltip: 'Delete selected',
              onPressed: _contacts.deleting ? null : () => unawaited(_deleteSelected()),
              icon: const Icon(Icons.delete_outline),
            ),
        ],
      );
    }
    final menu = [
      if (widget.abilities.import) const PopupMenuItem(value: 'import', child: Text('Import a spreadsheet')),
      if (widget.abilities.delete && (_contacts.total ?? 0) > 0) const PopupMenuItem(value: 'delete-all', child: Text('Delete all contacts')),
    ];
    return AppBar(
      leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
      title: const Text('Contacts'),
      actions: [
        if (menu.isNotEmpty)
          PopupMenuButton<String>(
            tooltip: 'More',
            onSelected: (value) => value == 'import' ? unawaited(_import()) : unawaited(_deleteAll()),
            itemBuilder: (_) => menu,
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: _contacts,
      builder: (context, _) => PopScope(
        // Back clears a selection before it leaves the screen.
        canPop: !_selecting,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop && _selecting) setState(_selected.clear);
        },
        child: Scaffold(
          appBar: _appBar(),
          body: Column(
            children: [
              if (_contacts.deleting) const LinearProgressIndicator(minHeight: 2),
              Container(
                color: theme.colorScheme.surface,
                padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, Gap.m, Gap.s),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextField(
                      controller: _search,
                      onChanged: (value) {
                        setState(() {});
                        _contacts.setQuery(value);
                      },
                      textInputAction: TextInputAction.search,
                      decoration: InputDecoration(
                        prefixIcon: const Icon(Icons.search),
                        hintText: 'Search name, phone or company',
                        suffixIcon: _search.text.isEmpty
                            ? null
                            : IconButton(
                                tooltip: 'Clear search',
                                onPressed: () {
                                  _search.clear();
                                  setState(() {});
                                  _contacts.setQuery('');
                                },
                                icon: const Icon(Icons.close),
                              ),
                      ),
                    ),
                    if (_contacts.total != null) ...[
                      const SizedBox(height: Gap.s),
                      Text(
                        _contacts.query.isEmpty
                            ? '${formatCount(_contacts.total!)} ${_contacts.total == 1 ? 'contact' : 'contacts'}'
                            : '${formatCount(_contacts.total!)} ${_contacts.total == 1 ? 'match' : 'matches'}',
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ],
                ),
              ),
              const Divider(),
              Expanded(child: _body(context)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    final contacts = _contacts.contacts;
    if (contacts.isEmpty) {
      if (_contacts.loading) return const Center(child: CircularProgressIndicator());
      if (_contacts.error != null) {
        return EmptyMessage(
          title: "Couldn't load contacts",
          body: _contacts.error!,
          action: 'Try again',
          onAction: () => unawaited(_contacts.reload()),
        );
      }
      return EmptyMessage(
        title: _contacts.query.isEmpty ? 'No contacts yet' : 'No contacts match your search',
        body: _contacts.query.isEmpty
            ? 'Contacts are added by importing a spreadsheet, and when someone writes to you on WhatsApp.'
            : 'Try a different name, number or company.',
        action: _contacts.query.isEmpty && widget.abilities.import ? 'Import a spreadsheet' : null,
        onAction: _contacts.query.isEmpty && widget.abilities.import ? () => unawaited(_import()) : null,
      );
    }
    final footer = _contacts.hasMore ? 1 : 0;
    return RefreshIndicator(
      onRefresh: _contacts.refresh,
      child: ListView.builder(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        itemExtent: recordRowExtent(context),
        itemCount: contacts.length + footer,
        itemBuilder: (context, index) {
          if (index == contacts.length) {
            return const Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)));
          }
          final contact = contacts[index];
          final selected = _selected.contains(contact.id);
          return _ContactRow(
            key: ValueKey(contact.id),
            contact: contact,
            selecting: _selecting,
            selected: selected,
            onTap: () => _selecting ? _toggle(contact) : unawaited(_open(contact)),
            onLongPress: widget.abilities.delete ? () => _toggle(contact) : null,
          );
        },
      ),
    );
  }
}

/// Asks before deleting, saying it cannot be undone. True when the person agreed.
Future<bool> confirmDelete(BuildContext context, String title, {bool everyone = false}) async {
  final agreed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(
        everyone
            ? 'Every contact is removed from the campaign audience for good. Chats and their messages stay. This cannot be undone.'
            : 'They are removed from the campaign audience for good. Their chats and messages stay. This cannot be undone.',
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error, foregroundColor: Theme.of(context).colorScheme.onError),
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );
  return agreed == true;
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({
    super.key,
    required this.contact,
    required this.selecting,
    required this.selected,
    required this.onTap,
    required this.onLongPress,
  });

  final WaContact contact;
  final bool selecting;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      selected: selecting ? selected : null,
      child: Material(
        color: selected ? theme.colorScheme.secondaryContainer : Colors.transparent,
        child: InkWell(
          onTap: onTap,
          onLongPress: onLongPress,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: Gap.m),
            child: Row(
              children: [
                if (selecting)
                  SizedBox(
                    width: 44,
                    height: 44,
                    child: Icon(
                      selected ? Icons.check_circle : Icons.radio_button_unchecked,
                      color: selected ? theme.colorScheme.primary : theme.colorScheme.outline,
                    ),
                  )
                else
                  Initials(text: contact.initials, size: 44),
                const SizedBox(width: Gap.m),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        contact.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 15, color: contact.name.isEmpty ? theme.colorScheme.onSurfaceVariant : null),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        contact.subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: Gap.s),
                ContactStatus(contact: contact),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Subscribed or opted out, coloured as the web page's badge.
class ContactStatus extends StatelessWidget {
  const ContactStatus({super.key, required this.contact});

  final WaContact contact;

  @override
  Widget build(BuildContext context) =>
      Pill(label: contact.optedOut ? 'Opted out' : 'Subscribed', tone: contact.optedOut ? PillTone.danger : PillTone.active);
}

/// One contact, with the ways to reach them.
class ContactDetailsScreen extends StatefulWidget {
  const ContactDetailsScreen({
    super.key,
    required this.contact,
    required this.platform,
    required this.inboxApi,
    required this.abilities,
    required this.onDelete,
  });

  final WaContact contact;
  final PlatformApi platform;
  final InboxApi inboxApi;
  final ContactAbilities abilities;

  /// Deletes this contact; throws ApiException when refused.
  final Future<void> Function() onDelete;

  @override
  State<ContactDetailsScreen> createState() => _ContactDetailsScreenState();
}

class _ContactDetailsScreenState extends State<ContactDetailsScreen> {
  bool _deleting = false;

  WaContact get _contact => widget.contact;

  void _notice(String text) => ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

  Future<void> _call() async {
    // Asked at the first call. If refused, the dialer opens with the number filled in.
    await Permission.phone.request();
    final result = await widget.platform.placeCall(_contact.dialable);
    if (result == null && mounted) _notice('This phone cannot place calls.');
  }

  Future<void> _sendTemplate() async {
    final sent = await showTemplateSheet(
      context,
      api: widget.inboxApi,
      recipient: _contact.name.isEmpty ? _contact.dialable : '${_contact.name} (${_contact.dialable})',
      askConsent: true,
      onSend: (template, values) async {
        await widget.inboxApi.sendTemplateToPhone(_contact.dialable, name: template.name, language: template.language, values: values);
      },
    );
    if (sent == true && mounted) _notice('Sent to ${_contact.title}');
  }

  Future<void> _delete() async {
    if (!await confirmDelete(context, 'Delete ${_contact.title}?')) return;
    setState(() => _deleting = true);
    try {
      await widget.onDelete();
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (failure) {
      if (!mounted) return;
      setState(() => _deleting = false);
      _notice(friendlyError(failure));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final added = parseStamp(_contact.createdAt);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Contact'),
        actions: [
          if (widget.abilities.delete)
            IconButton(tooltip: 'Delete contact', onPressed: _deleting ? null : () => unawaited(_delete()), icon: const Icon(Icons.delete_outline)),
        ],
        bottom: _deleting ? const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator(minHeight: 2)) : null,
      ),
      body: ListView(
        padding: const EdgeInsets.all(Gap.l),
        children: [
          Row(
            children: [
              Initials(text: _contact.initials, size: 52),
              const SizedBox(width: Gap.m),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_contact.title, style: theme.textTheme.titleLarge),
                    const SizedBox(height: Gap.xs),
                    ContactStatus(contact: _contact),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: Gap.l),
          Row(
            children: [
              QuickAction(icon: Icons.call_outlined, label: 'Call', onPressed: _contact.phone.isEmpty ? null : () => unawaited(_call())),
              if (widget.abilities.sendTemplates) ...[
                const SizedBox(width: Gap.s),
                QuickAction(
                  icon: Icons.chat_outlined,
                  label: 'Send template',
                  // They said stop: the API would refuse, so the button says so first.
                  onPressed: _contact.optedOut || _contact.phone.isEmpty ? null : () => unawaited(_sendTemplate()),
                ),
              ],
            ],
          ),
          if (_contact.optedOut)
            Padding(
              padding: const EdgeInsets.only(top: Gap.s),
              child: Text(
                'Opted out of WhatsApp messages, so no template can be sent.',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
          const SizedBox(height: Gap.l),
          DetailsCard(
            title: 'Details',
            rows: [
              ('Name', _contact.name),
              ('Phone', _contact.dialable),
              ('Company', _contact.company),
              ('Email', _contact.email),
              ('Status', _contact.optedOut ? 'Opted out' : 'Subscribed'),
              ('Added', added == null ? '' : formatDisplayDate(added.toIso8601String())),
            ],
          ),
          if (_contact.attributes.isNotEmpty)
            DetailsCard(
              title: 'From the import',
              rows: [for (final entry in _contact.attributes.entries) (sentenceCase(entry.key.replaceAll('_', ' ')), entry.value)],
            ),
        ],
      ),
    );
  }
}
