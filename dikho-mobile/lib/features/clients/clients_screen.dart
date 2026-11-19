import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../shared/platform_api.dart';
import '../../shared/record_ui.dart';
import '../inbox/chat_theme.dart';
import 'client_form_screen.dart';
import 'clients_controller.dart';
import 'clients_models.dart';

const _loadMoreWithin = 200.0;

/// What a person may do here, from the permissions the page reported. The database
/// checks the same permissions on every save: this only decides what to offer.
class ClientAbilities {
  const ClientAbilities({required this.create, required this.edit, required this.newOrder});

  final bool create;
  final bool edit;
  final bool newOrder;
}

/// The companies you sell to, newest first, a page at a time.
class ClientsScreen extends StatefulWidget {
  const ClientsScreen({
    super.key,
    required this.controller,
    required this.platform,
    required this.abilities,
    required this.onOpenDrawer,
    required this.onNewOrder,
  });

  final ClientsController controller;
  final PlatformApi platform;
  final ClientAbilities abilities;
  final VoidCallback onOpenDrawer;

  /// Opens the CRM's sales order form with this client already chosen.
  final void Function(Client client) onNewOrder;

  @override
  State<ClientsScreen> createState() => _ClientsScreenState();
}

class _ClientsScreenState extends State<ClientsScreen> {
  final _scroll = ScrollController();
  final _search = TextEditingController();

  ClientsController get _clients => widget.controller;

  @override
  void initState() {
    super.initState();
    _search.text = _clients.query;
    _scroll.addListener(() {
      final position = _scroll.position;
      if (position.maxScrollExtent - position.pixels < _loadMoreWithin) {
        unawaited(_clients.loadMore());
      }
    });
    // Kept for the session: coming back shows the last list at once, then refreshes it.
    unawaited(_clients.reload());
  }

  @override
  void dispose() {
    _scroll.dispose();
    _search.dispose();
    super.dispose();
  }

  void _open(Client client) {
    FocusManager.instance.primaryFocus?.unfocus();
    unawaited(
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ClientDetailsScreen(
            client: client,
            controller: _clients,
            platform: widget.platform,
            abilities: widget.abilities,
            onNewOrder: widget.onNewOrder,
          ),
        ),
      ),
    );
  }

  Future<void> _add() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final saved = await Navigator.of(context)
        .push<Client>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => ClientFormScreen(controller: _clients)));
    if (saved == null || !mounted) return;
    // A new client is the newest: back to the top of the full list, as the web does.
    _search.clear();
    _clients.setQuery('');
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Client added')));
    _open(saved);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(tooltip: 'Open menu', onPressed: widget.onOpenDrawer, icon: const Icon(Icons.menu)),
        title: const Text('Clients'),
      ),
      floatingActionButton: widget.abilities.create
          ? FloatingActionButton.extended(onPressed: _add, icon: const Icon(Icons.add), label: const Text('New client'))
          : null,
      body: ListenableBuilder(
        listenable: _clients,
        builder: (context, _) => Column(
          children: [
            Container(
              color: theme.colorScheme.surface,
              padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, Gap.m, Gap.s),
              child: TextField(
                controller: _search,
                onChanged: (value) {
                  setState(() {});
                  _clients.setQuery(value);
                },
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search),
                  hintText: 'Search company, contact, email, GSTIN or PAN',
                  suffixIcon: _search.text.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear search',
                          onPressed: () {
                            _search.clear();
                            setState(() {});
                            _clients.setQuery('');
                          },
                          icon: const Icon(Icons.close),
                        ),
                ),
              ),
            ),
            const Divider(),
            Expanded(child: _body(context)),
          ],
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    final clients = _clients.rows;
    if (clients.isEmpty) {
      if (_clients.loading) return const Center(child: CircularProgressIndicator());
      if (_clients.error != null) {
        return EmptyMessage(title: "Couldn't load clients", body: _clients.error!, action: 'Try again', onAction: () => unawaited(_clients.reload()));
      }
      return EmptyMessage(
        title: _clients.query.isEmpty ? 'No clients yet' : 'No clients match your search',
        body: _clients.query.isEmpty
            ? 'Add the companies you sell to. Sales orders pick their client from this list.'
            : 'Try part of the company name, a contact, an email address, a GSTIN or a PAN.',
      );
    }
    final footer = _clients.hasMore ? 1 : 0;
    return RefreshIndicator(
      onRefresh: _clients.reload,
      child: ListView.builder(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        // Room at the end, so the last row is never under the New client button.
        padding: EdgeInsets.only(bottom: widget.abilities.create ? 88 : 0),
        itemExtent: recordRowExtent(context),
        itemCount: clients.length + footer,
        itemBuilder: (context, index) {
          if (index == clients.length) {
            return const Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)));
          }
          final client = clients[index];
          return _ClientRow(key: ValueKey(client.id), client: client, onTap: () => _open(client));
        },
      ),
    );
  }
}

class _ClientRow extends StatelessWidget {
  const _ClientRow({super.key, required this.client, required this.onTap});

  final Client client;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Gap.m),
        child: Row(
          children: [
            Initials(text: client.initials),
            const SizedBox(width: Gap.m),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(client.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15)),
                  if (client.subtitle.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      client.subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: Gap.s),
            _ActivePill(active: client.active),
            Icon(Icons.chevron_right, color: theme.colorScheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}

class _ActivePill extends StatelessWidget {
  const _ActivePill({required this.active});

  final bool active;

  @override
  Widget build(BuildContext context) => Pill(label: active ? 'Active' : 'Inactive', tone: active ? PillTone.active : PillTone.neutral);
}

/// Everything known about one client, with the ways to reach them. Follows the list:
/// an edit saved here shows at once.
class ClientDetailsScreen extends StatelessWidget {
  const ClientDetailsScreen({
    super.key,
    required this.client,
    required this.controller,
    required this.platform,
    required this.abilities,
    required this.onNewOrder,
  });

  final Client client;
  final ClientsController controller;
  final PlatformApi platform;
  final ClientAbilities abilities;
  final void Function(Client client) onNewOrder;

  Client _current() {
    for (final row in controller.rows) {
      if (row.id == client.id) return row;
    }
    return client;
  }

  Future<void> _call(BuildContext context, String number) async {
    // Asked at the first call. If refused, the dialer opens with the number filled in.
    await Permission.phone.request();
    final result = await platform.placeCall(number);
    if (result == null && context.mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('This phone cannot place calls.')));
    }
  }

  Future<void> _email(BuildContext context, String address) async {
    final opened = await platform.openExternal(Uri(scheme: 'mailto', path: address).toString());
    if (!opened && context.mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('No app on this phone can send email.')));
    }
  }

  Future<void> _edit(BuildContext context, Client current) async {
    final saved = await Navigator.of(context).push<Client>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => ClientFormScreen(controller: controller, client: current),
      ),
    );
    if (saved != null && context.mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Client saved')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final c = _current();
        final number = c.dialable;
        return Scaffold(
          appBar: AppBar(
            title: const Text('Client'),
            actions: [
              if (abilities.edit)
                IconButton(tooltip: 'Edit client', onPressed: () => unawaited(_edit(context, c)), icon: const Icon(Icons.edit_outlined)),
            ],
          ),
          body: ListView(
            padding: const EdgeInsets.all(Gap.l),
            children: [
              Row(
                children: [
                  Initials(text: c.initials, size: 52),
                  const SizedBox(width: Gap.m),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(c.title, style: theme.textTheme.titleLarge),
                        const SizedBox(height: Gap.xs),
                        Wrap(
                          spacing: Gap.s,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            _ActivePill(active: c.active),
                            Text('Client #${c.id}', style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: Gap.l),
              Row(
                children: [
                  QuickAction(icon: Icons.call_outlined, label: 'Call', onPressed: number == null ? null : () => unawaited(_call(context, number))),
                  const SizedBox(width: Gap.s),
                  QuickAction(
                    icon: Icons.mail_outline,
                    label: 'Email',
                    onPressed: c.email.isEmpty ? null : () => unawaited(_email(context, c.email)),
                  ),
                  if (abilities.newOrder) ...[
                    const SizedBox(width: Gap.s),
                    QuickAction(icon: Icons.add_shopping_cart_outlined, label: 'New order', onPressed: () => onNewOrder(c)),
                  ],
                ],
              ),
              const SizedBox(height: Gap.l),
              DetailsCard(
                title: 'Contact',
                rows: [('Contact person', c.contactPerson), ('Designation', c.designation), ('Phone', c.phoneDisplay ?? ''), ('Email', c.email)],
              ),
              DetailsCard(
                title: 'Tax',
                rows: [
                  ('GSTIN', c.gstin),
                  ('PAN', c.pan),
                  ('Registration', c.registration),
                  ('GSTIN date', formatDisplayDate(c.gstinDate)),
                  ('TDS', c.tdsPercentage.isEmpty ? '' : '${c.tdsPercentage}%'),
                  ('TDS section', c.tdsSection),
                ],
              ),
              DetailsCard(title: 'Address', rows: [('Address', c.address), ('City, state, PIN', c.place), ('Country', c.country)]),
            ],
          ),
        );
      },
    );
  }
}
