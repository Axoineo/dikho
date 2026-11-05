import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/app_config.dart';
import '../../shared/platform_api.dart';

/// Turns native file results into messages with Open and Share actions.
class FileEvents {
  FileEvents({required this.platform, required this.messengerOf});

  final PlatformApi platform;
  final ScaffoldMessengerState? Function() messengerOf;

  void handle(Map<Object?, Object?> event) {
    // Local test builds only, where every file name is synthetic. A message on
    // screen outlives a slow accessibility dump, but this always arrives.
    if (AppConfig.localTestBuild) {
      debugPrint('file event: ${event['type']} ${event['reason'] ?? ''}');
    }
    switch (event['type']) {
      case 'downloadStarted':
        // Until the result replaces it: a large file can take a while.
        _show(
          'Downloading ${event['name']}...',
          duration: const Duration(minutes: 5),
        );
      case 'downloadFinished':
        _finished(event);
      case 'downloadFailed':
        _show(_failureText(event));
      case 'viewFailed':
        _viewFailed(event);
      case 'downloadCleared':
        messengerOf()?.clearSnackBars();
    }
  }

  void _finished(Map<Object?, Object?> event) {
    final uri = event['uri'] as String;
    final mime = event['mime'] as String;
    _show(
      'Saved ${event['name']} to Downloads',
      duration: const Duration(seconds: 10),
      action: SnackBarAction(
        label: 'Open',
        onPressed: () => unawaited(_open(uri, mime)),
      ),
      share: () => unawaited(platform.shareFile(uri, mime)),
    );
  }

  Future<void> _open(String uri, String mime) async {
    if (!await platform.openFile(uri, mime)) {
      _show(
        'No app on this phone can open this file.',
        action: SnackBarAction(
          label: 'Share',
          onPressed: () => unawaited(platform.shareFile(uri, mime)),
        ),
      );
    }
  }

  void _viewFailed(Map<Object?, Object?> event) {
    final uri = event['uri'] as String;
    final mime = event['mime'] as String;
    _show(
      'No app on this phone can open ${event['name']}.',
      action: SnackBarAction(
        label: 'Share',
        onPressed: () => unawaited(platform.shareFile(uri, mime)),
      ),
    );
  }

  String _failureText(Map<Object?, Object?> event) {
    final name = event['name'] ?? 'the file';
    return switch (event['reason']) {
      'too_large' => '$name is too large to download in the app.',
      'expired' => 'That link has expired. Open the file again.',
      'storage' => 'Could not save $name. Free up some space and try again.',
      _ => 'Could not download $name. Check your connection and try again.',
    };
  }

  void _show(
    String text, {
    Duration duration = const Duration(seconds: 8),
    SnackBarAction? action,
    VoidCallback? share,
  }) {
    final messenger = messengerOf();
    if (messenger == null) return;
    // Clears any queued message too. Hiding only the current one lets messages
    // pile up when files finish quickly, and each then plays out in turn.
    messenger.clearSnackBars();
    messenger.showSnackBar(
      SnackBar(
        duration: duration,
        action: action,
        content: Row(
          children: [
            Expanded(child: Text(text)),
            if (share != null)
              // A message bar is light in dark mode, so the icon follows the theme.
              Builder(
                builder: (context) => IconButton(
                  tooltip: 'Share',
                  icon: Icon(
                    Icons.share,
                    color: Theme.of(context).colorScheme.onInverseSurface,
                  ),
                  onPressed: share,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
