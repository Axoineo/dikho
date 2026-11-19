import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import 'chat_actions.dart';
import 'chat_theme.dart';
import 'inbox_format.dart';
import 'inbox_scope.dart';
import 'inbox_widgets.dart';
import 'media_viewer.dart';
import 'thread_controller.dart';

/// Who this chat is with, the shared photos, and the same chat actions as the menu.
class ContactInfoScreen extends StatefulWidget {
  const ContactInfoScreen({super.key, required this.thread, required this.onChatAction});

  final ThreadController thread;
  final Future<void> Function(String key) onChatAction;

  @override
  State<ContactInfoScreen> createState() => _ContactInfoScreenState();
}

class _ContactInfoScreenState extends State<ContactInfoScreen> {
  bool _uploading = false;

  Future<void> _setPhoto() async {
    final scope = InboxScope.of(context);
    final picked = await scope.platform.pickFiles(const ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], false);
    if (picked.isEmpty || !mounted) return;
    setState(() => _uploading = true);
    await runWithNotice(context, () async {
      final file = await scope.platform.copyPicked(picked.first);
      if (file == null || file.path == null) throw const ApiException('That photo could not be read.');
      final copy = File(file.path!);
      try {
        final url = await scope.api.uploadAvatar(widget.thread.conversationId, file: copy, filename: file.name, mime: file.mime);
        scope.inbox.patch(widget.thread.conversationId, {'avatar_url': url});
      } finally {
        if (await copy.exists()) await copy.delete();
      }
    });
    if (mounted) setState(() => _uploading = false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scope = InboxScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Contact info')),
      body: ListenableBuilder(
        listenable: widget.thread,
        builder: (context, _) {
          final conversation = widget.thread.conversation;
          final name = conversation.displayName;
          final left = conversation.windowLeft();
          final photos = widget.thread.messages.where((m) => m.isImage && m.mediaStatus == 'ready' && m.mediaUrl != null).toList();
          final canBlock = scope.access.can('inbox.block');
          final canDelete = scope.access.can('inbox.delete');
          return ListView(
            padding: const EdgeInsets.all(Gap.l),
            children: [
              Center(
                child: Stack(
                  children: [
                    ChatAvatar(name: conversation.avatarName, phone: conversation.phone, avatarUrl: conversation.avatarUrl, size: 88),
                    if (scope.access.can('inbox.reply'))
                      Positioned(
                        right: -8,
                        bottom: -8,
                        child: IconButton.filled(
                          tooltip: 'Set contact photo',
                          onPressed: _uploading ? null : () => unawaited(_setPhoto()),
                          icon: _uploading
                              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.photo_camera_outlined, size: 18),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: Gap.m),
              Text(name, textAlign: TextAlign.center, style: theme.textTheme.titleLarge),
              const SizedBox(height: Gap.xs),
              Text(
                '+${conversation.phone}',
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: Gap.m),
              Center(
                child: Chip(
                  label: Text(
                    conversation.isBlocked
                        ? 'Blocked'
                        : left > Duration.zero
                        ? 'Replies open · ${formatCountdown(left)} left'
                        : 'Window closed · templates only',
                  ),
                ),
              ),
              const SizedBox(height: Gap.l),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Phone'),
                subtitle: Text('+${conversation.phone}'),
                trailing: IconButton(
                  tooltip: 'Copy phone',
                  onPressed: () => unawaited(copyMessageText(context, '+${conversation.phone}')),
                  icon: const Icon(Icons.copy),
                ),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Last active'),
                subtitle: Text(formatLastActive(conversation.lastInboundAt).isEmpty ? 'Not yet' : formatLastActive(conversation.lastInboundAt)),
              ),
              if (photos.isNotEmpty) ...[
                const SizedBox(height: Gap.s),
                Text('Media · ${photos.length}', style: theme.textTheme.titleSmall),
                const SizedBox(height: Gap.s),
                GridView.count(
                  crossAxisCount: 3,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: Gap.xs,
                  crossAxisSpacing: Gap.xs,
                  children: [
                    for (final photo in photos.reversed.take(12))
                      GestureDetector(
                        onTap: () => unawaited(
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => MediaViewer(items: photos, initialId: photo.id),
                            ),
                          ),
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: CachedMediaImage(
                            path: photo.mediaUrl!,
                            decodeWidth: 120,
                            placeholder: ColoredBox(color: theme.colorScheme.outlineVariant),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: Gap.m),
              const Divider(),
              if (canBlock)
                conversation.isBlocked
                    ? ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.check_circle_outline),
                        title: Text('Unblock $name'),
                        onTap: () => unawaited(widget.onChatAction('unblock')),
                      )
                    : ListTile(
                        contentPadding: EdgeInsets.zero,
                        enabled: conversation.canBlockNow,
                        leading: Icon(Icons.block, color: theme.colorScheme.error),
                        title: Text('Block $name', style: TextStyle(color: theme.colorScheme.error)),
                        subtitle: conversation.canBlockNow ? null : const Text('Only within 24 hours of their last message'),
                        onTap: () => unawaited(widget.onChatAction('block')),
                      ),
              if (canDelete)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.delete_outline, color: theme.colorScheme.error),
                  title: Text('Delete chat', style: TextStyle(color: theme.colorScheme.error)),
                  onTap: () async {
                    final navigator = Navigator.of(context);
                    await widget.onChatAction('delete');
                    if (widget.thread.gone && mounted) navigator.pop();
                  },
                ),
            ],
          );
        },
      ),
    );
  }
}
