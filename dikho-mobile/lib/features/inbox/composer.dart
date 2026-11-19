import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../shared/app_permissions.dart';
import '../../shared/crm_api.dart';
import '../../shared/platform_api.dart';
import 'chat_theme.dart';
import 'compose_sheet.dart';
import 'inbox_format.dart';
import 'inbox_models.dart';
import 'inbox_scope.dart';
import 'inbox_widgets.dart';
import 'template_sheet.dart';
import 'thread_controller.dart';

const _maxRecording = Duration(minutes: 10);
const _minRecording = Duration(seconds: 1);

/// The types WhatsApp accepts. The API enforces the same list and the per-type size
/// limits, so this only spares a pointless upload.
const _anyAccepted = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/3gpp',
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'text/plain',
  'application/pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
];

/// Text, attachments and voice notes for one open chat. Only shown inside the
/// 24-hour window: outside it, an approved template is the one thing Meta accepts.
class Composer extends StatefulWidget {
  const Composer({super.key, required this.thread, required this.canTemplate, this.replyTo, this.replyAuthor = '', this.onCancelReply, this.onSent});

  final ThreadController thread;
  final bool canTemplate;
  final Message? replyTo;
  final String replyAuthor;
  final VoidCallback? onCancelReply;
  final VoidCallback? onSent;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _text = TextEditingController();
  final _focus = FocusNode();
  bool _busy = false;
  String? _error;
  DateTime _lastTyping = DateTime.fromMillisecondsSinceEpoch(0);

  Duration? _recording;
  Timer? _recordingTimer;
  DateTime? _recordingStarted;
  bool _startingRecording = false;

  // Kept from the last build: dispose may not look anything up, and it is exactly
  // when the microphone has to be let go.
  late PlatformApi _platform;

  ThreadController get _thread => widget.thread;

  @override
  void initState() {
    super.initState();
    _text.addListener(_onTextChanged);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _platform = InboxScope.of(context).platform;
  }

  @override
  void didUpdateWidget(Composer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.replyTo != null && oldWidget.replyTo?.id != widget.replyTo?.id) _focus.requestFocus();
  }

  @override
  void dispose() {
    _recordingTimer?.cancel();
    if (_recording != null) fireAndForget(_platform.voiceCancel());
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onTextChanged() {
    setState(() {});
    // Meta keeps "typing…" up for about 25 seconds per call.
    if (_text.text.trim().isEmpty) return;
    final now = DateTime.now();
    if (now.difference(_lastTyping) < const Duration(seconds: 12)) return;
    _lastTyping = now;
    fireAndForget(_thread.api.typing(_thread.conversationId));
  }

  Future<void> _run(Future<void> Function() send) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await send();
      widget.onSent?.call();
    } on Exception catch (error) {
      if (mounted) setState(() => _error = friendlyError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendText() async {
    final body = _text.text.trim();
    if (body.isEmpty || _busy) return;
    await _run(() async {
      await _thread.sendText(body, replyTo: widget.replyTo?.id);
      // Anything typed while this was sending stays.
      if (_text.text.trim() == body) _text.clear();
      widget.onCancelReply?.call();
    });
  }

  Future<void> _pickAndSend(List<String> accept) async {
    final platform = InboxScope.of(context).platform;
    final picked = await platform.pickFiles(accept, false);
    if (picked.isEmpty || !mounted) return;
    await _run(() async {
      final file = await platform.copyPicked(picked.first);
      if (file == null) throw const ApiException('That file could not be read.');
      if (file.tooLarge) throw const ApiException('That file is too large to send.');
      final copy = File(file.path!);
      try {
        await _thread.sendFile(file: copy, filename: file.name, mime: file.mime, caption: _text.text.trim(), replyTo: widget.replyTo?.id);
        _text.clear();
        widget.onCancelReply?.call();
      } finally {
        if (await copy.exists()) await copy.delete();
      }
    });
  }

  /* ── Voice notes ───────────────────────────────────────────────────── */

  Future<void> _startRecording() async {
    // The prompt and the start take a moment: a second tap must not start another.
    if (_busy || _startingRecording || _recording != null) return;
    _startingRecording = true;
    try {
      final scope = InboxScope.of(context);
      setState(() => _error = null);
      final granted = await ensurePermission(context, Permission.microphone, why: 'Dikho CRM needs the microphone to record voice notes.');
      if (!granted || !mounted) return;
      if (!await _platform.voiceStart()) {
        if (mounted) setState(() => _error = 'The microphone could not be started. Another app may be using it.');
        return;
      }
      if (!mounted) {
        fireAndForget(_platform.voiceCancel());
        return;
      }
      scope.audio.stop();
      _recordingStarted = DateTime.now();
      setState(() => _recording = Duration.zero);
      _recordingTimer?.cancel();
      _recordingTimer = Timer.periodic(const Duration(milliseconds: 250), (_) {
        final elapsed = DateTime.now().difference(_recordingStarted!);
        if (elapsed >= _maxRecording) {
          unawaited(_stopRecording(send: true));
        } else if (elapsed.inSeconds != _recording?.inSeconds) {
          setState(() => _recording = elapsed);
        }
      });
    } finally {
      _startingRecording = false;
    }
  }

  Future<void> _stopRecording({required bool send}) async {
    final platform = _platform;
    final elapsed = DateTime.now().difference(_recordingStarted ?? DateTime.now());
    _recordingTimer?.cancel();
    setState(() => _recording = null);
    if (!send) {
      await platform.voiceCancel();
      return;
    }
    if (elapsed < _minRecording) {
      await platform.voiceCancel();
      if (mounted) setState(() => _error = 'That recording was too short.');
      return;
    }
    final recording = await platform.voiceStop();
    if (recording == null) {
      if (mounted) setState(() => _error = 'Nothing was recorded. Please try again.');
      return;
    }
    await _run(() async {
      final file = File(recording.path);
      try {
        await _thread.sendFile(file: file, filename: recording.filename, mime: recording.mime, replyTo: widget.replyTo?.id, voice: recording.voice);
        widget.onCancelReply?.call();
      } finally {
        if (await file.exists()) await file.delete();
      }
    });
  }

  /* ── Attachments ───────────────────────────────────────────────────── */

  Future<void> _openAttachments() async {
    FocusScope.of(context).unfocus();
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (sheetContext) => _AttachmentSheet(canTemplate: widget.canTemplate),
    );
    if (choice == null || !mounted) return;
    switch (choice) {
      case 'document':
        await _pickAndSend(_anyAccepted);
      case 'media':
        await _pickAndSend(const ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/3gpp']);
      case 'audio':
        await _pickAndSend(const ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg']);
      case 'template':
        await _openTemplates();
      default:
        final reply = widget.replyTo?.id;
        await showComposeSheet(
          context,
          kind: choice,
          recipient: _thread.conversation.displayName,
          onSend: (input) async {
            await _thread.compose(choice, reply == null ? input : {...input, 'replyTo': reply});
            widget.onCancelReply?.call();
            widget.onSent?.call();
          },
        );
    }
  }

  Future<void> _openTemplates() async {
    await showTemplateSheet(
      context,
      api: _thread.api,
      recipient: _thread.conversation.displayName,
      onSend: (template, values) async {
        await _thread.compose('template', {'name': template.name, 'language': template.language, 'values': values});
        widget.onSent?.call();
      },
    );
  }

  /* ── Layout ────────────────────────────────────────────────────────── */

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final conversation = _thread.conversation;
    if (conversation.windowLeft() <= Duration.zero) {
      return _Notice(
        icon: Icons.schedule,
        text:
            'The 24-hour reply window has closed. ${conversation.displayName} must message first, or '
            '${widget.canTemplate ? 'you can' : 'someone who can send campaigns can'} send an approved template.',
        action: widget.canTemplate ? 'Send a template' : null,
        onAction: _openTemplates,
      );
    }
    final canSend = !_busy && _text.text.trim().isNotEmpty;
    return Material(
      color: Colors.transparent,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Gap.s, Gap.xs, Gap.s, Gap.s),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_error != null)
                Container(
                  margin: const EdgeInsets.only(bottom: Gap.xs),
                  padding: const EdgeInsets.symmetric(horizontal: Gap.m, vertical: Gap.s),
                  decoration: BoxDecoration(color: theme.colorScheme.errorContainer, borderRadius: BorderRadius.circular(12)),
                  child: Text(_error!, style: TextStyle(fontSize: 13, color: theme.colorScheme.onErrorContainer)),
                ),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: theme.colorScheme.surface,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: theme.colorScheme.outlineVariant),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (widget.replyTo != null) _ReplyBar(message: widget.replyTo!, author: widget.replyAuthor, onCancel: widget.onCancelReply),
                    if (_recording != null) _recordingBar(theme) else _inputRow(canSend),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _inputRow(bool canSend) => Row(
    crossAxisAlignment: CrossAxisAlignment.end,
    children: [
      IconButton(tooltip: 'Attach or send something else', onPressed: _busy ? null : _openAttachments, icon: const Icon(Icons.attach_file)),
      Expanded(
        child: TextField(
          controller: _text,
          focusNode: _focus,
          // Stays enabled while sending: disabling it would close the keyboard after
          // every message.
          minLines: 1,
          maxLines: 5,
          textCapitalization: TextCapitalization.sentences,
          keyboardType: TextInputType.multiline,
          decoration: const InputDecoration(
            hintText: 'Type a message',
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
            contentPadding: EdgeInsets.symmetric(vertical: 14),
          ),
        ),
      ),
      if (_busy)
        const SizedBox(
          width: 48,
          height: 48,
          child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
        )
      else if (canSend)
        IconButton(
          tooltip: 'Send message',
          onPressed: _sendText,
          icon: Icon(Icons.send, color: Theme.of(context).colorScheme.primary),
        )
      else
        IconButton(tooltip: 'Record a voice message', onPressed: _startRecording, icon: const Icon(Icons.mic_none)),
    ],
  );

  /// Swipe it away, or tap the bin, to throw the recording out.
  Widget _recordingBar(ThemeData theme) => Dismissible(
    key: const ValueKey('recording'),
    direction: DismissDirection.horizontal,
    onDismissed: (_) => unawaited(_stopRecording(send: false)),
    child: Row(
      children: [
        IconButton(tooltip: 'Discard recording', onPressed: () => unawaited(_stopRecording(send: false)), icon: const Icon(Icons.delete_outline)),
        Icon(Icons.fiber_manual_record, size: 12, color: theme.colorScheme.error),
        const SizedBox(width: Gap.s),
        Text(
          'Recording ${formatDuration(_recording!.inMilliseconds)}',
          style: const TextStyle(fontSize: 14, fontFeatures: [FontFeature.tabularFigures()]),
        ),
        const Spacer(),
        IconButton(
          tooltip: 'Send voice message',
          onPressed: () => unawaited(_stopRecording(send: true)),
          icon: Icon(Icons.send, color: theme.colorScheme.primary),
        ),
      ],
    ),
  );
}

class _ReplyBar extends StatelessWidget {
  const _ReplyBar({required this.message, required this.author, this.onCancel});

  final Message message;
  final String author;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    final chat = ChatColors.of(context);
    final accent = message.isOutbound ? chat.quoteYou : chat.quoteThem;
    return Padding(
      padding: const EdgeInsets.fromLTRB(Gap.s, Gap.s, Gap.xs, 0),
      child: Container(
        decoration: BoxDecoration(color: chat.quote, borderRadius: BorderRadius.circular(12)),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                width: 4,
                decoration: BoxDecoration(
                  color: accent,
                  borderRadius: const BorderRadius.horizontal(left: Radius.circular(12)),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: Gap.m, vertical: Gap.s),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Replying to $author',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12.8, fontWeight: FontWeight.w500, color: accent),
                      ),
                      Text(
                        message.snippet,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 13, color: chat.sub),
                      ),
                    ],
                  ),
                ),
              ),
              IconButton(tooltip: 'Cancel reply', onPressed: onCancel, icon: const Icon(Icons.close, size: 18)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.text, this.action, this.onAction});

  final IconData icon;
  final String text;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.all(Gap.m),
        padding: const EdgeInsets.all(Gap.m),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: theme.colorScheme.outlineVariant),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 20, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: Gap.m),
                Expanded(
                  child: Text(text, style: TextStyle(fontSize: 13.5, height: 1.4, color: theme.colorScheme.onSurfaceVariant)),
                ),
              ],
            ),
            if (action != null) ...[
              const SizedBox(height: Gap.s),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(onPressed: onAction, child: Text(action!)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Shared with the thread: blocked and read-only chats replace the composer.
class ComposerNotice extends StatelessWidget {
  const ComposerNotice({super.key, required this.text, this.action, this.onAction, this.icon = Icons.block});

  final String text;
  final String? action;
  final VoidCallback? onAction;
  final IconData icon;

  @override
  Widget build(BuildContext context) => _Notice(icon: icon, text: text, action: action, onAction: onAction);
}

class _AttachmentSheet extends StatelessWidget {
  const _AttachmentSheet({required this.canTemplate});

  final bool canTemplate;

  @override
  Widget build(BuildContext context) {
    final items = <(String, String, IconData)>[
      ('document', 'Document', Icons.description_outlined),
      ('media', 'Photos and videos', Icons.image_outlined),
      ('audio', 'Audio', Icons.audiotrack_outlined),
      ('location', 'Location', Icons.place_outlined),
      ('contact', 'Contact', Icons.person_outline),
      ('buttons', 'Reply buttons', Icons.smart_button_outlined),
      ('list', 'List', Icons.list),
      ('cta_url', 'Link button', Icons.link),
      ('location_request', 'Ask for location', Icons.my_location),
      ('address', 'Ask for address', Icons.home_outlined),
      if (canTemplate) ('template', 'Template', Icons.article_outlined),
    ];
    return SafeArea(
      child: ListView(
        shrinkWrap: true,
        children: [
          for (final (key, label, icon) in items)
            ListTile(minTileHeight: 52, leading: Icon(icon), title: Text(label), onTap: () => Navigator.of(context).pop(key)),
        ],
      ),
    );
  }
}
