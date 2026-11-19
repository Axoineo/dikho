import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import '../../shared/crm_api.dart';
import 'chat_theme.dart';
import 'inbox_format.dart';
import 'inbox_scope.dart';

/// An image fetched once to private cache storage and decoded at the size shown,
/// so a list of photos never holds full-resolution bitmaps in memory.
class CachedMediaImage extends StatefulWidget {
  const CachedMediaImage({
    super.key,
    required this.path,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.decodeWidth,
    this.placeholder,
    this.failure,
  });

  final String path;
  final double? width;
  final double? height;
  final BoxFit fit;

  /// Logical pixels. Multiplied by the screen's density before decoding.
  final double? decodeWidth;
  final Widget? placeholder;
  final Widget? failure;

  @override
  State<CachedMediaImage> createState() => _CachedMediaImageState();
}

class _CachedMediaImageState extends State<CachedMediaImage> {
  Future<File>? _file;
  String? _loadedPath;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load();
  }

  @override
  void didUpdateWidget(CachedMediaImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    _load();
  }

  void _load() {
    if (_loadedPath == widget.path) return;
    _loadedPath = widget.path;
    _file = InboxScope.of(context).media.fileFor(widget.path);
  }

  @override
  Widget build(BuildContext context) {
    final fallback = SizedBox(width: widget.width, height: widget.height);
    return FutureBuilder<File>(
      future: _file,
      builder: (context, snapshot) {
        if (snapshot.hasError) return widget.failure ?? fallback;
        final file = snapshot.data;
        if (file == null) return widget.placeholder ?? fallback;
        final ratio = MediaQuery.devicePixelRatioOf(context);
        final decode = widget.decodeWidth;
        return Image.file(
          file,
          width: widget.width,
          height: widget.height,
          fit: widget.fit,
          cacheWidth: decode == null ? null : (decode * ratio).round(),
          gaplessPlayback: true,
          errorBuilder: (_, _, _) => widget.failure ?? fallback,
        );
      },
    );
  }
}

class ChatAvatar extends StatelessWidget {
  const ChatAvatar({super.key, required this.name, required this.phone, this.avatarUrl, this.size = 44});

  final String? name;
  final String? phone;
  final String? avatarUrl;
  final double size;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final initials = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(shape: BoxShape.circle, color: theme.navigationDrawerTheme.indicatorColor),
      child: Text(
        initialsOf(name, phone),
        style: TextStyle(fontSize: size * 0.36, fontWeight: FontWeight.w500, color: theme.colorScheme.primary),
      ),
    );
    final url = avatarUrl;
    if (url == null) return initials;
    return ClipOval(
      child: CachedMediaImage(path: url, width: size, height: size, decodeWidth: size, placeholder: initials, failure: initials),
    );
  }
}

/// Single grey sent, double grey delivered, double blue read.
class DeliveryTicks extends StatelessWidget {
  const DeliveryTicks({super.key, required this.status, this.color, this.size = 15, this.readColor});

  final String? status;
  final Color? color;
  final Color? readColor;
  final double size;

  @override
  Widget build(BuildContext context) {
    final chat = ChatColors.of(context);
    final base = color ?? chat.sub;
    switch (status) {
      case 'read':
        return Icon(Icons.done_all, size: size, color: readColor ?? chat.tick, semanticLabel: 'Read');
      case 'delivered':
        return Icon(Icons.done_all, size: size, color: base, semanticLabel: 'Delivered');
      case 'sent':
      case 'queued':
        return Icon(Icons.done, size: size, color: base, semanticLabel: 'Sent');
      case 'failed':
        return Icon(Icons.error_outline, size: size, color: Theme.of(context).colorScheme.error, semanticLabel: 'Failed');
      default:
        return Icon(Icons.schedule, size: size - 2, color: base, semanticLabel: 'Sending');
    }
  }
}

/// Centred on the wallpaper: day separators and system notices.
class CanvasChip extends StatelessWidget {
  const CanvasChip({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final chat = ChatColors.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: Gap.m),
      child: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.82),
          child: Material(
            color: chat.raised,
            elevation: 0.5,
            borderRadius: BorderRadius.circular(8),
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: Gap.m, vertical: 6),
                child: DefaultTextStyle.merge(
                  style: TextStyle(fontSize: 12.5, color: chat.sub, height: 1.35),
                  textAlign: TextAlign.center,
                  child: child,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Runs an action and tells the person when it did not work. Returns whether it did.
Future<bool> runWithNotice(BuildContext context, Future<void> Function() action) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  try {
    await action();
    return true;
  } on Exception catch (error) {
    messenger?.showSnackBar(SnackBar(content: Text(friendlyError(error))));
    return false;
  }
}

void showNotice(BuildContext context, String text) {
  ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));
}

extension ScheduleAfterFrame on State {
  void afterFrame(VoidCallback run) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) run();
    });
  }
}

/// A future nobody needs to wait on.
void fireAndForget(Future<void> future) => unawaited(future.then<void>((_) {}, onError: (Object _) {}));
