import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import 'chat_theme.dart';
import 'inbox_models.dart';
import 'inbox_scope.dart';
import 'inbox_widgets.dart';

/// Forward one message to up to five chats, as WhatsApp allows. Each is a separate
/// send through the API, one after another, and each chat's 24-hour window must be
/// open: a forward is a free-form message.
class ForwardScreen extends StatefulWidget {
  const ForwardScreen({super.key, required this.message, required this.currentId});

  final Message message;
  final int currentId;

  @override
  State<ForwardScreen> createState() => _ForwardScreenState();
}

class _ForwardScreenState extends State<ForwardScreen> {
  static const _maxTargets = 5;

  final _selected = <int>[];
  final _results = <int, String>{};
  List<Conversation> _chats = const [];
  bool _loading = true;
  bool _running = false;
  String? _error;
  Timer? _debounce;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    unawaited(_load(''));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load(String query) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await InboxScope.of(context).api.conversations(query: query);
      if (mounted) setState(() => _chats = page.conversations.where((c) => c.id != widget.currentId).toList());
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String? _unavailable(Conversation c) {
    if (c.isBlocked) return 'Blocked';
    if (c.windowLeft() <= Duration.zero) return 'Reply window closed';
    return null;
  }

  Future<void> _run() async {
    final scope = InboxScope.of(context);
    setState(() => _running = true);
    for (final id in _selected) {
      setState(() => _results[id] = 'sending');
      try {
        final sent = await scope.api.forward(id, widget.message.id);
        scope.inbox.noteSent(id, sent);
        if (mounted) setState(() => _results[id] = 'sent');
      } on ApiException catch (error) {
        if (mounted) setState(() => _results[id] = error.message);
      }
    }
    if (mounted) setState(() => _running = false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final done = _results.isNotEmpty && !_running;
    return PopScope(
      canPop: !_running,
      child: Scaffold(
        appBar: AppBar(title: const Text('Forward message')),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, 0),
              child: Text(
                '“${widget.message.snippet}”',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(Gap.m),
              child: TextField(
                onChanged: (value) {
                  _debounce?.cancel();
                  _debounce = Timer(const Duration(milliseconds: 300), () => unawaited(_load(value.trim())));
                },
                decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search chats'),
              ),
            ),
            const Divider(),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                  ? Center(child: Text(_error!))
                  : _chats.isEmpty
                  ? const Center(child: Text('No chats match.'))
                  : ListView.builder(
                      itemCount: _chats.length,
                      itemBuilder: (context, index) {
                        final chat = _chats[index];
                        final reason = _unavailable(chat);
                        final checked = _selected.contains(chat.id);
                        final result = _results[chat.id];
                        final disabled = reason != null || _running || done || (!checked && _selected.length >= _maxTargets);
                        return CheckboxListTile(
                          value: checked,
                          enabled: !disabled,
                          secondary: ChatAvatar(name: chat.avatarName, phone: chat.phone, avatarUrl: chat.avatarUrl, size: 40),
                          title: Text(chat.displayName, maxLines: 1, overflow: TextOverflow.ellipsis),
                          subtitle: reason != null
                              ? Text(reason)
                              : result == null
                              ? null
                              : Text(
                                  result == 'sending'
                                      ? 'Sending…'
                                      : result == 'sent'
                                      ? 'Sent'
                                      : result,
                                  style: TextStyle(color: result == 'sending' || result == 'sent' ? null : theme.colorScheme.error),
                                ),
                          onChanged: (value) => setState(() {
                            if (value == true) {
                              _selected.add(chat.id);
                            } else {
                              _selected.remove(chat.id);
                            }
                          }),
                        );
                      },
                    ),
            ),
            const Divider(),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.all(Gap.m),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${_selected.length} of $_maxTargets selected',
                        style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ),
                    if (done)
                      FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done'))
                    else
                      FilledButton(
                        onPressed: _running || _selected.isEmpty ? null : () => unawaited(_run()),
                        child: Text(_running ? 'Forwarding…' : 'Forward'),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
