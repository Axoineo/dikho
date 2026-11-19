import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/platform_api.dart';
import '../shell/shell_messages.dart';
import 'inbox_api.dart';
import 'inbox_controller.dart';
import 'media_repository.dart';

/// One audio message playing at a time, across the whole inbox.
class AudioState extends ChangeNotifier {
  AudioState(this.platform);

  final PlatformApi platform;
  bool _disposed = false;

  String? id;
  String state = 'idle';
  int positionMs = 0;
  int durationMs = 0;

  void onEvent(Map<Object?, Object?> event) {
    final eventId = event['id'];
    if (eventId is String) id = eventId;
    state = event['state'] as String? ?? state;
    positionMs = (event['positionMs'] as num?)?.toInt() ?? positionMs;
    durationMs = (event['durationMs'] as num?)?.toInt() ?? durationMs;
    if (state == 'completed' || state == 'error') {
      positionMs = 0;
    }
    notifyListeners();
  }

  bool isPlaying(String messageId) => id == messageId && state == 'playing';

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  void stop() {
    // A chat closing at sign-out comes after this has gone.
    if (_disposed) return;
    id = null;
    state = 'idle';
    positionMs = 0;
    durationMs = 0;
    unawaited(platform.audioStop());
    notifyListeners();
  }
}

/// What every inbox screen needs, handed down rather than passed through each one.
class InboxScope extends InheritedWidget {
  const InboxScope({
    super.key,
    required this.inbox,
    required this.api,
    required this.media,
    required this.audio,
    required this.platform,
    required this.access,
    required super.child,
  });

  final InboxController inbox;
  final InboxApi api;
  final MediaRepository media;
  final AudioState audio;
  final PlatformApi platform;
  final ShellAccess access;

  static InboxScope of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<InboxScope>()!;

  @override
  bool updateShouldNotify(InboxScope oldWidget) => !identical(oldWidget.access, access);
}
