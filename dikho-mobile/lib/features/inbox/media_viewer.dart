import 'dart:async';

import 'package:flutter/material.dart';

import 'inbox_format.dart';
import 'inbox_models.dart';
import 'inbox_scope.dart';
import 'inbox_widgets.dart';

/// Full screen: swipe between a chat's media, pinch to zoom a photo. Videos and
/// documents open in the phone's own apps, through the same native download path as
/// the rest of the CRM (no cookie or token on the request).
class MediaViewer extends StatefulWidget {
  const MediaViewer({super.key, required this.items, required this.initialId});

  final List<Message> items;
  final int initialId;

  @override
  State<MediaViewer> createState() => _MediaViewerState();
}

class _MediaViewerState extends State<MediaViewer> {
  late final PageController _pages = PageController(initialPage: _index);
  late int _index = widget.items.indexWhere((m) => m.id == widget.initialId).clamp(0, widget.items.length - 1);

  Message get _item => widget.items[_index];

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  Future<void> _fetch(Message message, {required bool view}) async {
    final scope = InboxScope.of(context);
    final path = message.mediaUrl;
    if (path == null) return;
    final url = await scope.media.urlFor(path);
    if (url == null) return;
    if (!view && mounted) showNotice(context, 'Saving to Downloads…');
    await scope.platform.fetchFile(url: url.toString(), view: view, name: message.mediaFilename, mime: message.mediaMime);
  }

  @override
  Widget build(BuildContext context) {
    final item = _item;
    final size = formatFileSize(item.mediaSize);
    final time = formatTime(item.at);
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        shape: const Border(),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              item.mediaFilename ?? item.type,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 15, color: Colors.white),
            ),
            Text(size.isEmpty ? time : '$size · $time', style: const TextStyle(fontSize: 12, color: Colors.white70)),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Save to Downloads',
            onPressed: () => unawaited(runWithNotice(context, () => _fetch(item, view: false))),
            icon: const Icon(Icons.download_outlined),
          ),
        ],
      ),
      body: PageView.builder(
        controller: _pages,
        itemCount: widget.items.length,
        onPageChanged: (index) => setState(() => _index = index),
        itemBuilder: (context, index) {
          final message = widget.items[index];
          if (message.isImage && message.mediaUrl != null) {
            return InteractiveViewer(
              maxScale: 4,
              child: Center(
                child: CachedMediaImage(
                  path: message.mediaUrl!,
                  fit: BoxFit.contain,
                  placeholder: const CircularProgressIndicator(color: Colors.white),
                  failure: const Text('Media unavailable', style: TextStyle(color: Colors.white70)),
                ),
              ),
            );
          }
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(message.isVideo ? Icons.play_circle_outline : Icons.description_outlined, size: 64, color: Colors.white70),
                  const SizedBox(height: 12),
                  Text(
                    message.mediaFilename ?? (message.isVideo ? 'Video' : 'Document'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(onPressed: () => unawaited(runWithNotice(context, () => _fetch(message, view: true))), child: const Text('Open')),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
