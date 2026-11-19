import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../shared/platform_api.dart';
import '../inbox/chat_list_screen.dart' show chatRowExtent;
import '../inbox/chat_theme.dart';
import '../inbox/inbox_api.dart';
import '../inbox/template_sheet.dart';
import 'phone_number.dart';

enum _Access { checking, needsAsking, deniedForGood, granted }

/// The contacts on this phone, read only when this screen opens. They stay on the
/// phone: the only thing that ever leaves is the one number a template is sent to.
class DeviceContactsScreen extends StatefulWidget {
  const DeviceContactsScreen({super.key, required this.platform, required this.api, required this.canSendTemplates, required this.onOpenDrawer});

  final PlatformApi platform;
  final InboxApi api;
  final bool canSendTemplates;
  final VoidCallback onOpenDrawer;

  @override
  State<DeviceContactsScreen> createState() => _DeviceContactsScreenState();
}

class _DeviceContactsScreenState extends State<DeviceContactsScreen> with WidgetsBindingObserver {
  final _search = TextEditingController();
  Timer? _debounce;

  _Access _access = _Access.checking;
  bool _loading = false;
  String? _error;
  List<DeviceContact> _all = const [];
  List<DeviceContact> _shown = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_checkAccess());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  // The person may be back from the app's settings page with the permission on.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _access != _Access.granted) unawaited(_checkAccess());
  }

  Future<void> _checkAccess() async {
    final status = await Permission.contacts.status;
    if (!mounted) return;
    if (status.isGranted || status.isLimited) {
      setState(() => _access = _Access.granted);
      await _load();
    } else {
      setState(() => _access = status.isPermanentlyDenied ? _Access.deniedForGood : _Access.needsAsking);
    }
  }

  Future<void> _ask() async {
    final status = await Permission.contacts.request();
    if (!mounted) return;
    if (status.isGranted || status.isLimited) {
      setState(() => _access = _Access.granted);
      await _load();
    } else {
      setState(() => _access = status.isPermanentlyDenied ? _Access.deniedForGood : _Access.needsAsking);
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final flat = await widget.platform.readContacts();
      final parsed = await compute(parseDeviceContacts, flat);
      if (!mounted) return;
      setState(() {
        _all = parsed;
        _shown = filterDeviceContacts(parsed, _search.text);
      });
    } on Exception {
      if (mounted) setState(() => _error = 'The contacts on this phone could not be read.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onSearch(String value) {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) setState(() => _shown = filterDeviceContacts(_all, value));
    });
  }

  Future<void> _call(DeviceContact contact) async {
    // Asked at the moment of the first call. If it is refused the dialer opens with
    // the number filled in, so the person can still call.
    await Permission.phone.request();
    final result = await widget.platform.placeCall(contact.number);
    if (result == null && mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('This phone cannot place calls.')));
    }
  }

  Future<void> _sendTemplate(DeviceContact contact) async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    final sent = await showTemplateSheet(
      context,
      api: widget.api,
      recipient: contact.name.isEmpty ? contact.display : '${contact.name} (${contact.display})',
      askConsent: true,
      onSend: (template, values) async {
        await widget.api.sendTemplateToPhone(contact.number, name: template.name, language: template.language, values: values);
      },
    );
    if (sent == true) messenger?.showSnackBar(SnackBar(content: Text('Sent to ${contact.label}')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
        title: const Text('Phone contacts'),
      ),
      body: switch (_access) {
        _Access.checking => const Center(child: CircularProgressIndicator()),
        _Access.needsAsking => _PermissionState(
          title: 'See the contacts on this phone',
          body: 'To call them or send a WhatsApp template from here, Dikho CRM needs to read your contacts. Only names and numbers are read, and they stay on this phone.',
          action: 'Grant Permission',
          onAction: () => unawaited(_ask()),
        ),
        _Access.deniedForGood => _PermissionState(
          title: 'Contacts are turned off',
          body: 'Android will not ask again. Turn Contacts on in the app\'s settings, then come back here.',
          action: 'Open App Settings',
          onAction: () => unawaited(openAppSettings()),
        ),
        _Access.granted => _list(context),
      },
    );
  }

  Widget _list(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, Gap.m, Gap.s),
          child: TextField(
            controller: _search,
            onChanged: _onSearch,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: 'Search name or number',
              suffixIcon: _search.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear search',
                      onPressed: () {
                        _search.clear();
                        _onSearch('');
                      },
                      icon: const Icon(Icons.close),
                    ),
            ),
          ),
        ),
        const Divider(),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
              ? _PermissionState(title: 'Something went wrong', body: _error!, action: 'Try again', onAction: () => unawaited(_load()))
              : _shown.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(Gap.xl),
                  child: Text(
                    _all.isEmpty ? 'No contacts with a phone number on this phone.' : 'No contacts match that search.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                  ),
                )
              : ListView.builder(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  itemExtent: chatRowExtent(context),
                  itemCount: _shown.length,
                  itemBuilder: (context, index) {
                    final contact = _shown[index];
                    return _ContactRow(
                      key: ValueKey('${contact.name}|${contact.number}'),
                      contact: contact,
                      onCall: () => unawaited(_call(contact)),
                      onWhatsApp: widget.canSendTemplates ? () => unawaited(_sendTemplate(contact)) : null,
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({super.key, required this.contact, required this.onCall, this.onWhatsApp});

  final DeviceContact contact;
  final VoidCallback onCall;
  final VoidCallback? onWhatsApp;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(left: Gap.m, right: Gap.xs),
      child: Row(
        children: [
          CircleAvatar(
            radius: 22,
            backgroundColor: theme.navigationDrawerTheme.indicatorColor,
            child: Text(
              contact.initials,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: theme.colorScheme.primary),
            ),
          ),
          const SizedBox(width: Gap.m),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(contact.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15)),
                if (contact.name.isNotEmpty)
                  Text(
                    contact.display,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
                  ),
              ],
            ),
          ),
          IconButton(tooltip: 'Call ${contact.label}', onPressed: onCall, icon: const Icon(Icons.call_outlined)),
          if (onWhatsApp != null)
            IconButton(tooltip: 'Send WhatsApp message to ${contact.label}', onPressed: onWhatsApp, icon: const Icon(Icons.chat_outlined)),
        ],
      ),
    );
  }
}

class _PermissionState extends StatelessWidget {
  const _PermissionState({required this.title, required this.body, required this.action, required this.onAction});

  final String title;
  final String body;
  final String action;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(Gap.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.perm_contact_calendar_outlined, size: 48, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: Gap.l),
            Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
            const SizedBox(height: Gap.s),
            Text(
              body,
              textAlign: TextAlign.center,
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: Gap.l),
            FilledButton(onPressed: onAction, child: Text(action)),
          ],
        ),
      ),
    );
  }
}
