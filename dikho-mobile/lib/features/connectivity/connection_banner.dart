import 'dart:async';

import 'package:flutter/material.dart';

/// The connection notice along the bottom of every screen, as video apps show it: a
/// dark "No connection" bar for as long as the phone is offline, then a green "Back
/// online" bar for a few seconds once it can reach the internet again.
class ConnectionBanner extends StatefulWidget {
  const ConnectionBanner({
    super.key,
    required this.isOnline,
    required this.changes,
    required this.child,
    this.backOnlineFor = const Duration(seconds: 3),
  });

  /// Whether the phone is online now (PlatformApi.isOnline).
  final Future<bool> Function() isOnline;

  /// Each change of it (PlatformApi.onlineChanges).
  final Stream<bool> changes;
  final Widget child;
  final Duration backOnlineFor;

  @override
  State<ConnectionBanner> createState() => _ConnectionBannerState();
}

enum _Notice { none, offline, backOnline }

class _ConnectionBannerState extends State<ConnectionBanner> {
  bool _online = true;
  _Notice _notice = _Notice.none;
  StreamSubscription<bool>? _changes;
  Timer? _hide;

  @override
  void initState() {
    super.initState();
    _changes = widget.changes.listen(_changed);
    // Offline from the start shows the bar, but nothing is "back" yet.
    unawaited(
      widget.isOnline().then((online) {
        if (mounted && !online) _changed(false);
      }),
    );
  }

  @override
  void dispose() {
    _changes?.cancel();
    _hide?.cancel();
    super.dispose();
  }

  void _changed(bool online) {
    if (online == _online) return;
    _hide?.cancel();
    setState(() {
      _online = online;
      _notice = online ? _Notice.backOnline : _Notice.offline;
    });
    if (online) {
      _hide = Timer(widget.backOnlineFor, () {
        if (mounted) setState(() => _notice = _Notice.none);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return Stack(
      children: [
        widget.child,
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: AnimatedSwitcher(
            duration: reduceMotion ? Duration.zero : const Duration(milliseconds: 220),
            switchInCurve: Curves.easeOut,
            switchOutCurve: Curves.easeIn,
            transitionBuilder: (child, animation) => SizeTransition(sizeFactor: animation, alignment: Alignment.bottomCenter, child: child),
            child: switch (_notice) {
              _Notice.none => const SizedBox.shrink(key: ValueKey('none')),
              _Notice.offline => const _Bar(
                key: ValueKey('offline'),
                color: Color(0xFF323232),
                icon: Icons.cloud_off_outlined,
                text: 'No connection. Showing what was already loaded.',
              ),
              _Notice.backOnline => const _Bar(key: ValueKey('online'), color: Color(0xFF1E8E3E), icon: Icons.wifi, text: 'Back online'),
            },
          ),
        ),
      ],
    );
  }
}

class _Bar extends StatelessWidget {
  const _Bar({super.key, required this.color, required this.icon, required this.text});

  final Color color;
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      container: true,
      label: text,
      child: ExcludeSemantics(
        child: Material(
          color: color,
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  Icon(icon, size: 18, color: Colors.white),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      text,
                      style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w500),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
