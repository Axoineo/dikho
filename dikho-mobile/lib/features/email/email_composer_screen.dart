import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/crm_api.dart';
import '../../shared/platform_api.dart';
import '../inbox/chat_theme.dart';
import 'email_api.dart';
import 'email_compose.dart';
import 'email_conversation_screen.dart' show ComposeRequest;
import 'email_models.dart';

/// Writing an email, redesigned for a phone from Composer.jsx: a plain-text body (the
/// original is quoted under a reply or forward, as on the web), recipients as chips
/// with suggestions, files from the phone, and one id per message so a send repeated
/// after a dropped connection goes once.
class EmailComposerScreen extends StatefulWidget {
  const EmailComposerScreen({
    super.key,
    required this.api,
    required this.platform,
    required this.mailboxes,
    required this.request,
    required this.onSent,
  });

  final EmailApi api;
  final PlatformApi platform;
  final List<Mailbox> mailboxes;
  final ComposeRequest request;
  final VoidCallback onSent;

  @override
  State<EmailComposerScreen> createState() => _EmailComposerScreenState();
}

class _Picked {
  const _Picked(this.file, this.name, this.mime, this.size);

  final File file;
  final String name;
  final String mime;
  final int size;
}

class _EmailComposerScreenState extends State<EmailComposerScreen> {
  late final List<Mailbox> _writable = widget.mailboxes.where((m) => m.writable).toList();
  late String? _accountId = _writable.any((m) => m.id == widget.request.accountId) ? widget.request.accountId : _writable.firstOrNull?.id;
  List<SendAs> _identities = const [];
  String _from = '';

  final _to = <Person>[];
  final _cc = <Person>[];
  final _bcc = <Person>[];
  bool _showCc = false;
  late final _subject = TextEditingController();
  final _body = TextEditingController();
  bool _quote = true;
  final _files = <_Picked>[];
  late List<EmailAttachment> _forwarded = const [];

  String _sendId = newSendId();
  String? _draftId;
  bool _sending = false;
  bool _picking = false;
  bool _uncertain = false;
  String? _error;
  bool _dirty = false;

  ComposeRequest get _r => widget.request;
  Mailbox? get _account => _writable.where((m) => m.id == _accountId).firstOrNull;

  @override
  void initState() {
    super.initState();
    final source = _r.source;
    if (source != null && (_r.mode == 'reply' || _r.mode == 'reply_all')) {
      final start = replyRecipients(source, _r.mode, _account?.email ?? '');
      _to.addAll(start.to);
      _cc.addAll(start.cc);
      _showCc = _cc.isNotEmpty;
    }
    if (source != null) {
      _subject.text = prefixed(_r.mode == 'forward' ? 'Fwd' : 'Re', source.subject.isNotEmpty ? source.subject : (_r.thread?.thread.subject ?? ''));
      if (_r.mode == 'forward') _forwarded = source.attachments;
    }
    unawaited(_loadIdentities());
  }

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    for (final f in _files) {
      unawaited(f.file.delete().catchError((Object _) => f.file));
    }
    super.dispose();
  }

  Future<void> _loadIdentities() async {
    final account = _account;
    if (account == null || !account.can('send_as')) return;
    try {
      final list = await widget.api.sendAs(account.id);
      if (!mounted) return;
      setState(() {
        _identities = list;
        _from = (list.where((i) => i.isDefault).firstOrNull ?? list.firstOrNull)?.email ?? '';
      });
    } on ApiException {
      // The mailbox's own address is used.
    }
  }

  void _touch() => setState(() {
    _dirty = true;
    _error = null;
  });

  int get _totalBytes => _files.fold(0, (n, f) => n + f.size) + _forwarded.fold(0, (n, a) => n + a.size);

  bool get _hasContent => _to.isNotEmpty || _cc.isNotEmpty || _bcc.isNotEmpty || _subject.text.trim().isNotEmpty || _body.text.trim().isNotEmpty;

  List<(String, String)> _fields({required bool forSend}) {
    final r = _r;
    final source = r.source;
    final identity = _identities.where((i) => i.email == _from).firstOrNull;
    final account = _account;
    return [
      ('mode', r.mode),
      if (r.thread != null && r.mode != 'new') ('thread_id', r.thread!.thread.id),
      if (source != null && r.mode != 'new') ('source_message_id', source.id),
      if (_from.isNotEmpty && (account?.can('send_as') ?? false)) ('from', _from),
      ('to', joinRecipients(_to)),
      ('cc', joinRecipients(_cc)),
      ('bcc', joinRecipients(_bcc)),
      ('subject', _subject.text),
      ('html', messageHtml(_body.text, signature: identity?.signature ?? '', quote: source != null && _quote ? quoteBlock(source, r.mode) : '')),
      if (forSend) ('send_id', _sendId),
      if (forSend && _draftId != null) ('draft_id', _draftId!),
      if (forSend && _forwarded.isNotEmpty)
        (
          'forward_attachments',
          jsonEncode([
            for (final a in _forwarded) {'id': a.id, 'filename': a.filename, 'mime_type': a.mime},
          ]),
        ),
    ];
  }

  Future<void> _attach() async {
    setState(() {
      _picking = true;
      _error = null;
    });
    try {
      final picked = await widget.platform.pickFiles(const ['*/*'], true);
      for (final uri in picked) {
        if (_files.length + _forwarded.length >= maxAttachments) {
          setState(() => _error = 'Attach at most $maxAttachments files.');
          break;
        }
        final file = await widget.platform.copyPicked(uri);
        final path = file?.path;
        if (file == null || path == null || file.tooLarge) {
          setState(() => _error = 'A file could not be added. Each must be smaller than 15 MB.');
          continue;
        }
        final copy = File(path);
        final size = await copy.length();
        if (_totalBytes + size > maxAttachmentBytes) {
          await copy.delete();
          setState(() => _error = 'Attachments add up to more than 15 MB.');
          continue;
        }
        setState(() {
          _files.add(_Picked(copy, file.name, file.mime, size));
          _dirty = true;
        });
      }
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  Future<void> _send() async {
    final account = _account;
    if (account == null) {
      setState(() => _error = 'Choose a connected mailbox you can send from.');
      return;
    }
    if (_to.isEmpty && _cc.isEmpty && _bcc.isEmpty) {
      setState(() => _error = 'Add at least one recipient.');
      return;
    }
    final invalid = [..._to, ..._cc, ..._bcc].where((p) => !emailPattern.hasMatch(p.email)).toList();
    if (invalid.isNotEmpty) {
      setState(() => _error = 'Check ${invalid.map((p) => p.email).join(', ')}: not a valid address.');
      return;
    }
    if (_totalBytes > maxAttachmentBytes) {
      setState(() => _error = 'Attachments add up to more than 15 MB.');
      return;
    }
    if (_subject.text.trim().isEmpty) {
      final go = await showDialog<bool>(
        context: context,
        builder: (dialog) => AlertDialog(
          title: const Text('Send without a subject?'),
          actions: [
            TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Add a subject')),
            FilledButton(onPressed: () => Navigator.of(dialog).pop(true), child: const Text('Send')),
          ],
        ),
      );
      if (go != true) return;
    }
    setState(() {
      _sending = true;
      _error = null;
      _uncertain = false;
    });
    try {
      final r = await widget.api.send(account.id, _fields(forSend: true), [
        for (final f in _files) FormFile(field: 'attachment', file: f.file, filename: f.name, mime: f.mime),
      ]);
      if (r['duplicate'] == true && r['status'] != 'sent') {
        setState(() {
          _uncertain = r['status'] == 'uncertain' || r['status'] == 'sending';
          _error = r['status'] == 'failed' ? 'This message failed earlier. Use "Send again anyway" to try once more.' : null;
        });
        return;
      }
      _dirty = false;
      widget.onSent();
      if (mounted) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Message sent.')));
        Navigator.of(context).pop();
      }
    } on ApiException catch (failure) {
      setState(() {
        if (failure.message.contains('Check the Sent folder')) {
          _uncertain = true;
        } else {
          _error = failure.message;
        }
      });
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _sendAgainAnyway() => setState(() {
    _sendId = newSendId();
    _uncertain = false;
    _error = 'Ready to send again. Tap Send.';
  });

  Future<void> _leave() async {
    if (!_dirty || !_hasContent) {
      Navigator.of(context).pop();
      return;
    }
    final draftsOk = _account?.can('drafts') ?? false;
    final choice = await showDialog<String>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('Keep this message?'),
        content: Text(draftsOk ? 'Save it to the mailbox\'s drafts to finish later, or discard it.' : 'It has not been sent.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialog).pop('discard'), child: const Text('Discard')),
          TextButton(onPressed: () => Navigator.of(dialog).pop('stay'), child: const Text('Keep editing')),
          if (draftsOk) FilledButton(onPressed: () => Navigator.of(dialog).pop('draft'), child: const Text('Save draft')),
        ],
      ),
    );
    if (!mounted || choice == null || choice == 'stay') return;
    if (choice == 'draft') {
      try {
        _draftId = await widget.api.saveDraft(_account!.id, _fields(forSend: false), draftId: _draftId);
        if (mounted) {
          ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Draft saved. Attachments are added when you send.')));
        }
      } on ApiException catch (failure) {
        setState(() => _error = 'Draft not saved: ${failure.message}');
        return;
      }
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    final title = switch (_r.mode) {
      'reply' => 'Reply',
      'reply_all' => 'Reply all',
      'forward' => 'Forward',
      _ => 'New message',
    };
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Close', onPressed: () => unawaited(_leave()), icon: const Icon(Icons.close)),
          title: Text(title),
          actions: [
            IconButton(
              tooltip: 'Attach files',
              onPressed: _picking || _sending ? null : () => unawaited(_attach()),
              icon: const Icon(Icons.attach_file),
            ),
            _sending
                ? const Padding(
                    padding: EdgeInsets.all(Gap.m),
                    child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                : IconButton(tooltip: 'Send', onPressed: () => unawaited(_send()), icon: const Icon(Icons.send)),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.xl),
          children: [
            if (_writable.isEmpty)
              Text('You need responder access to a connected mailbox to write.', style: TextStyle(color: theme.colorScheme.error)),
            if (_writable.length > 1 || _identities.length > 1)
              Padding(
                padding: const EdgeInsets.only(bottom: Gap.m),
                child: DropdownButtonFormField<String>(
                  key: ValueKey('from-$_accountId-$_from'),
                  initialValue: _identities.length > 1 ? 'id:$_from' : 'mb:$_accountId',
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'From'),
                  items: [
                    if (_identities.length > 1)
                      for (final i in _identities)
                        DropdownMenuItem(
                          value: 'id:${i.email}',
                          child: Text(i.label, overflow: TextOverflow.ellipsis),
                        )
                    else
                      for (final m in _writable)
                        DropdownMenuItem(
                          value: 'mb:${m.id}',
                          child: Text(m.name, overflow: TextOverflow.ellipsis),
                        ),
                  ],
                  onChanged: (value) {
                    if (value == null) return;
                    if (value.startsWith('id:')) {
                      setState(() => _from = value.substring(3));
                    } else {
                      setState(() {
                        _accountId = value.substring(3);
                        _identities = const [];
                        _from = '';
                      });
                      unawaited(_loadIdentities());
                    }
                  },
                ),
              ),
            _RecipientField(
              label: 'To',
              people: _to,
              api: widget.api,
              onChanged: _touch,
              trailing: _showCc ? null : TextButton(onPressed: () => setState(() => _showCc = true), child: const Text('Cc, Bcc')),
            ),
            if (_showCc) ...[
              _RecipientField(label: 'Cc', people: _cc, api: widget.api, onChanged: _touch),
              _RecipientField(label: 'Bcc', people: _bcc, api: widget.api, onChanged: _touch),
            ],
            const SizedBox(height: Gap.s),
            TextField(
              controller: _subject,
              textCapitalization: TextCapitalization.sentences,
              inputFormatters: [LengthLimitingTextInputFormatter(300)],
              onChanged: (_) => _touch(),
              decoration: const InputDecoration(labelText: 'Subject'),
            ),
            const SizedBox(height: Gap.m),
            TextField(
              controller: _body,
              minLines: 8,
              maxLines: null,
              keyboardType: TextInputType.multiline,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => _touch(),
              decoration: const InputDecoration(labelText: 'Message', alignLabelWithHint: true),
            ),
            if (_r.source != null)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _quote,
                onChanged: (v) => setState(() => _quote = v),
                title: Text(_r.mode == 'forward' ? 'Include the forwarded message' : 'Include the message you are answering'),
                subtitle: Text('${_r.source!.from.display}, ${fullTime(_r.source!.date)}', style: muted),
              ),
            if (_files.isNotEmpty || _forwarded.isNotEmpty) ...[
              const SizedBox(height: Gap.s),
              Wrap(
                spacing: Gap.s,
                runSpacing: Gap.s,
                children: [
                  for (final a in _forwarded)
                    InputChip(
                      avatar: const Icon(Icons.attach_file, size: 18),
                      label: Text('${a.filename}${a.size > 0 ? ' · ${formatSize(a.size)}' : ''}', overflow: TextOverflow.ellipsis),
                      deleteButtonTooltipMessage: 'Remove ${a.filename}',
                      onDeleted: () => setState(
                        () => _forwarded = [
                          for (final x in _forwarded)
                            if (x.id != a.id) x,
                        ],
                      ),
                    ),
                  for (final f in _files)
                    InputChip(
                      avatar: const Icon(Icons.attach_file, size: 18),
                      label: Text('${f.name} · ${formatSize(f.size)}', overflow: TextOverflow.ellipsis),
                      deleteButtonTooltipMessage: 'Remove ${f.name}',
                      onDeleted: () {
                        unawaited(f.file.delete().catchError((Object _) => f.file));
                        setState(() => _files.remove(f));
                      },
                    ),
                ],
              ),
            ],
            if (_uncertain)
              Container(
                margin: const EdgeInsets.only(top: Gap.m),
                padding: const EdgeInsets.all(Gap.m),
                decoration: BoxDecoration(color: theme.colorScheme.tertiaryContainer, borderRadius: BorderRadius.circular(12)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('It is not certain this message was sent. Check the Sent folder before sending it again.'),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(onPressed: _sendAgainAnyway, child: const Text('Send again anyway')),
                    ),
                  ],
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: Gap.m),
                child: Semantics(
                  liveRegion: true,
                  child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// People as chips, a field to type more, and suggestions from addresses this person
/// could already see.
class _RecipientField extends StatefulWidget {
  const _RecipientField({required this.label, required this.people, required this.api, required this.onChanged, this.trailing});

  final String label;
  final List<Person> people;
  final EmailApi api;
  final VoidCallback onChanged;
  final Widget? trailing;

  @override
  State<_RecipientField> createState() => _RecipientFieldState();
}

class _RecipientFieldState extends State<_RecipientField> {
  final _text = TextEditingController();
  List<Person> _suggestions = const [];
  Timer? _wait;

  @override
  void dispose() {
    _wait?.cancel();
    _text.dispose();
    super.dispose();
  }

  void _commit(String raw) {
    final person = parseRecipient(raw);
    if (person == null) return;
    if (!widget.people.any((p) => p.email == person.email)) widget.people.add(person);
    _text.clear();
    setState(() => _suggestions = const []);
    widget.onChanged();
  }

  void _typed(String value) {
    if (value.endsWith(',') || value.endsWith(';') || value.endsWith(' ') && value.contains('@')) {
      _commit(value);
      return;
    }
    _wait?.cancel();
    final query = value.trim();
    if (query.length < 2) {
      setState(() => _suggestions = const []);
      return;
    }
    _wait = Timer(const Duration(milliseconds: 200), () async {
      try {
        final list = await widget.api.recipients(query);
        if (mounted && _text.text.trim() == query) {
          setState(() => _suggestions = list.where((s) => !widget.people.any((p) => p.email == s.email)).take(6).toList());
        }
      } on ApiException {
        if (mounted) setState(() => _suggestions = const []);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.s),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.people.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.xs),
              child: Wrap(
                spacing: Gap.s,
                runSpacing: Gap.xs,
                children: [
                  for (final p in widget.people)
                    InputChip(
                      label: Text(p.display, overflow: TextOverflow.ellipsis),
                      tooltip: p.email,
                      deleteButtonTooltipMessage: 'Remove ${p.display}',
                      onDeleted: () {
                        setState(() => widget.people.remove(p));
                        widget.onChanged();
                      },
                    ),
                ],
              ),
            ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _text,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  textInputAction: TextInputAction.next,
                  onChanged: _typed,
                  onSubmitted: _commit,
                  onTapOutside: (_) {
                    if (_text.text.trim().isNotEmpty) _commit(_text.text);
                  },
                  decoration: InputDecoration(labelText: widget.label),
                ),
              ),
              ?widget.trailing,
            ],
          ),
          for (final s in _suggestions)
            ListTile(
              dense: true,
              leading: const Icon(Icons.person_outline),
              title: Text(s.display),
              subtitle: s.name.isNotEmpty ? Text(s.email) : null,
              onTap: () {
                if (!widget.people.any((p) => p.email == s.email)) widget.people.add(s);
                _text.clear();
                setState(() => _suggestions = const []);
                widget.onChanged();
              },
            ),
        ],
      ),
    );
  }
}
