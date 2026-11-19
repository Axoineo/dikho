import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/crm_api.dart';
import 'chat_theme.dart';
import 'inbox_models.dart';

const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const allReactions = [
  '😀',
  '😁',
  '😂',
  '🤣',
  '😊',
  '😍',
  '😘',
  '😎',
  '🤩',
  '🥳',
  '👍',
  '👎',
  '🙏',
  '👏',
  '🙌',
  '💪',
  '🔥',
  '✨',
  '🎉',
  '✅',
  '❌',
  '⚠️',
  '❤️',
  '💙',
  '💯',
  '🤝',
  '🙂',
  '😉',
  '😅',
  '😢',
  '😡',
  '🤔',
  '👌',
  '👋',
  '💰',
  '📎',
];

/// What one chat action says before it happens. The API checks inbox.delete and
/// inbox.block on every request; the screen only hides what the person may not do.
class ChatActionCopy {
  const ChatActionCopy(this.title, this.body, this.confirm, {this.danger = true});

  final String title;
  final String body;
  final String confirm;
  final bool danger;

  static ChatActionCopy of(String action, String name) => switch (action) {
    'clear' => ChatActionCopy(
      'Clear this chat?',
      'Every message in this chat is removed from the inbox for everyone on your team. $name keeps their copy on WhatsApp.',
      'Clear chat',
    ),
    'delete' => ChatActionCopy(
      'Delete this chat?',
      'The chat and its messages are removed from the inbox for everyone on your team. If $name writes again, a new chat starts without the old messages.',
      'Delete chat',
    ),
    'block' => ChatActionCopy(
      'Block $name?',
      'They will not be able to message this business number, and nobody here can message them until they are unblocked. The chat stays in the inbox.',
      'Block',
    ),
    'unblock' => ChatActionCopy('Unblock $name?', 'They will be able to message this business number again.', 'Unblock', danger: false),
    _ => ChatActionCopy(
      'Delete this message?',
      'It is removed from this chat for everyone on your team. WhatsApp cannot unsend it, so $name keeps their copy.',
      'Delete',
    ),
  };
}

/// Stays open with the reason if the action is refused, so a refusal is never silent.
Future<bool> confirmChatAction(BuildContext context, {required String action, required String name, required Future<void> Function() run}) async {
  final done = await showDialog<bool>(
    context: context,
    builder: (_) => _ChatActionDialog(copy: ChatActionCopy.of(action, name), run: run),
  );
  return done == true;
}

class _ChatActionDialog extends StatefulWidget {
  const _ChatActionDialog({required this.copy, required this.run});

  final ChatActionCopy copy;
  final Future<void> Function() run;

  @override
  State<_ChatActionDialog> createState() => _ChatActionDialogState();
}

class _ChatActionDialogState extends State<_ChatActionDialog> {
  bool _busy = false;
  String? _error;

  Future<void> _confirm() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.run();
      if (mounted) Navigator.of(context).pop(true);
    } on Exception catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = friendlyError(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final copy = widget.copy;
    return PopScope(
      canPop: !_busy,
      child: AlertDialog(
        title: Text(copy.title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(copy.body),
            if (_error != null) ...[const SizedBox(height: Gap.m), Text(_error!, style: TextStyle(color: theme.colorScheme.error))],
          ],
        ),
        actions: [
          TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          FilledButton(
            style: copy.danger ? FilledButton.styleFrom(backgroundColor: theme.colorScheme.error) : null,
            onPressed: _busy ? null : () => unawaited(_confirm()),
            child: Text(_busy ? 'Working…' : copy.confirm),
          ),
        ],
      ),
    );
  }
}

/// What a person may do with one message.
class MessageMenuSpec {
  const MessageMenuSpec({
    required this.reactionsEnabled,
    this.reactionsReason,
    required this.canReply,
    required this.canCopy,
    required this.canForward,
    required this.canPin,
    required this.canDelete,
  });

  final bool reactionsEnabled;
  final String? reactionsReason;
  final bool canReply;
  final bool canCopy;
  final bool canForward;
  final bool canPin;
  final bool canDelete;
}

sealed class MessageChoice {
  const MessageChoice();
}

class ReactChoice extends MessageChoice {
  const ReactChoice(this.emoji);
  final String emoji;
}

class ActionChoice extends MessageChoice {
  const ActionChoice(this.key);
  final String key;
}

/// Long-press on a message: reactions first, as in WhatsApp, then the actions.
Future<MessageChoice?> showMessageSheet(BuildContext context, {required Message message, required MessageMenuSpec spec, String? myReaction}) =>
    showModalBottomSheet<MessageChoice>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _MessageSheet(message: message, spec: spec, myReaction: myReaction),
    );

class _MessageSheet extends StatefulWidget {
  const _MessageSheet({required this.message, required this.spec, this.myReaction});

  final Message message;
  final MessageMenuSpec spec;
  final String? myReaction;

  @override
  State<_MessageSheet> createState() => _MessageSheetState();
}

class _MessageSheetState extends State<_MessageSheet> {
  bool _allEmoji = false;

  Widget _emoji(String emoji) {
    final mine = widget.myReaction == emoji;
    return Semantics(
      button: true,
      selected: mine,
      label: mine ? 'Remove reaction $emoji' : 'React $emoji',
      child: InkResponse(
        radius: 24,
        onTap: () => Navigator.of(context).pop(ReactChoice(mine ? '' : emoji)),
        child: Container(
          width: 48,
          height: 48,
          alignment: Alignment.center,
          decoration: mine ? BoxDecoration(shape: BoxShape.circle, color: Theme.of(context).navigationDrawerTheme.indicatorColor) : null,
          child: ExcludeSemantics(child: Text(emoji, style: const TextStyle(fontSize: 24))),
        ),
      ),
    );
  }

  Widget _action(String key, String label, IconData icon, {bool danger = false}) {
    final color = danger ? Theme.of(context).colorScheme.error : null;
    return ListTile(
      minTileHeight: 52,
      leading: Icon(icon, color: color),
      title: Text(label, style: TextStyle(color: color)),
      onTap: () => Navigator.of(context).pop(ActionChoice(key)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final m = widget.message;
    final spec = widget.spec;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.8),
        child: ListView(
          shrinkWrap: true,
          children: [
            if (spec.reactionsEnabled)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Gap.s),
                child: Wrap(
                  alignment: WrapAlignment.spaceEvenly,
                  children: [
                    for (final emoji in _allEmoji ? allReactions : quickReactions) _emoji(emoji),
                    if (!_allEmoji)
                      IconButton(tooltip: 'More reactions', onPressed: () => setState(() => _allEmoji = true), icon: const Icon(Icons.add)),
                  ],
                ),
              )
            else if (spec.reactionsReason != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.s),
                child: Text(spec.reactionsReason!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ),
            const Divider(),
            if (spec.canReply) _action('reply', 'Reply', Icons.reply),
            if (spec.canCopy) _action('copy', 'Copy', Icons.copy),
            if (spec.canForward) _action('forward', 'Forward', Icons.shortcut),
            if (spec.canPin) m.pinnedAt != null ? _action('unpin', 'Unpin', Icons.push_pin_outlined) : _action('pin', 'Pin', Icons.push_pin_outlined),
            m.starred ? _action('unstar', 'Unstar', Icons.star) : _action('star', 'Star', Icons.star_border),
            if (spec.canDelete) _action('delete', 'Delete', Icons.delete_outline, danger: true),
          ],
        ),
      ),
    );
  }
}

Future<void> copyMessageText(BuildContext context, String text) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  await Clipboard.setData(ClipboardData(text: text));
  messenger?.showSnackBar(const SnackBar(content: Text('Copied')));
}
