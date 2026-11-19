import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../auth/page_access.dart' as pages;
import '../inbox/chat_theme.dart';
import '../users/users_models.dart' show sectionLabels;
import 'assist_protocol.dart';
import 'assist_widgets.dart';
import 'live_assist_controller.dart';

/// Pages a helper may suggest, as SUGGESTIBLE on the web: Dikho's pages, without
/// Settings, the email connection step and the pages that are still placeholders.
/// The other person's screen offers "Go" only for one their own access includes.
const _notSuggested = {
  '/settings',
  '/dashboard',
  '/email/connect',
  '/invoices',
  '/advance-payments',
  '/payment-receipts',
  '/payment-requests',
  '/courier',
};

List<(String, String)> suggestiblePages() => [
  for (final rule in pages.pageRules)
    if (!_notSuggested.contains(rule.path)) (rule.path, sectionLabels[rule.section] ?? rule.path),
];

/// The width and height a PNG says it has, from its header; null when it is not one.
Size? pngSize(Uint8List bytes) {
  if (bytes.length < 24 || bytes[0] != 0x89 || bytes[1] != 0x50 || bytes[2] != 0x4E || bytes[3] != 0x47) return null;
  final data = ByteData.sublistView(bytes, 16, 24);
  return Size(data.getUint32(0).toDouble(), data.getUint32(4).toDouble());
}

/// Where a picture of [content] sits inside [box] when it is fitted whole (letterboxed),
/// so a touch can be turned into a spot on their screen.
Rect containRect(Size box, Size content) {
  if (content.isEmpty || box.isEmpty) return Rect.zero;
  final scale = (box.width / content.width) < (box.height / content.height) ? box.width / content.width : box.height / content.height;
  final w = content.width * scale;
  final h = content.height * scale;
  return Rect.fromLTWH((box.width - w) / 2, (box.height - h) / 2, w, h);
}

/// [point] in [box] as a spot on their screen, or null when it is outside the picture.
Spot? spotIn(Rect picture, Offset point) {
  if (picture.isEmpty) return null;
  final x = (point.dx - picture.left) / picture.width;
  final y = (point.dy - picture.top) / picture.height;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : Spot(x, y);
}

/// Helping someone, redesigned for a phone from HelperViewer.jsx: their screen fills
/// this one; drag a finger to point, tap something to highlight it (your next message
/// is then pinned there as a note), and chat below. You cannot tap or type for them.
class HelperViewerScreen extends StatefulWidget {
  const HelperViewerScreen({super.key, required this.c});

  final LiveAssistController c;

  @override
  State<HelperViewerScreen> createState() => _HelperViewerScreenState();
}

class _HelperViewerScreenState extends State<HelperViewerScreen> {
  final _renderer = RTCVideoRenderer();
  bool _rendererReady = false;
  MediaStream? _shown;
  Spot? _pin;
  Timer? _pinTimer;
  Offset? _ripple;
  DateTime _lastPointer = DateTime.fromMillisecondsSinceEpoch(0);
  Timer? _tick;

  LiveAssistController get _c => widget.c;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _onChange());
    _c.addListener(_onChange);
    // The waiting countdown.
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _c.helper?.phase == 'waiting') setState(() {});
    });
  }

  @override
  void dispose() {
    _c.removeListener(_onChange);
    _pinTimer?.cancel();
    _tick?.cancel();
    if (_rendererReady) {
      _renderer.srcObject = null;
      unawaited(_renderer.dispose().catchError((Object _) {}));
    }
    super.dispose();
  }

  Future<void> _startRenderer() async {
    try {
      await _renderer.initialize();
      if (!mounted) return;
      setState(() => _rendererReady = true);
      _onChange();
    } on Object {
      // No video on this device; pictures still show.
    }
  }

  bool _rendererStarted = false;

  void _onChange() {
    final video = _c.helper?.video;
    // Only for someone sharing from a computer: a phone's pictures need no video view.
    if (video != null && !_rendererStarted) {
      _rendererStarted = true;
      unawaited(_startRenderer());
    }
    if (_rendererReady && !identical(video, _shown)) {
      _shown = video;
      _renderer.srcObject = video;
    }
    if (_c.helper?.live != true) _pin = null;
    if (mounted) setState(() {});
  }

  Size? _pictureSize(HelperView h) {
    final frame = h.frame;
    if (frame != null) return pngSize(frame);
    if (h.video != null && _renderer.videoWidth > 0 && _renderer.videoHeight > 0) {
      return Size(_renderer.videoWidth.toDouble(), _renderer.videoHeight.toDouble());
    }
    return null;
  }

  void _point(Rect picture, Offset at) {
    final now = DateTime.now();
    if (now.difference(_lastPointer) < const Duration(milliseconds: 50)) return;
    _lastPointer = now;
    _c.pointTo(spotIn(picture, at));
  }

  void _tap(Rect picture, Offset at) {
    final spot = spotIn(picture, at);
    if (spot == null) return;
    _c.highlightAt(spot);
    _pinTimer?.cancel();
    // Type straight after tapping; a pin nobody uses lapses after 20 seconds.
    _pinTimer = Timer(const Duration(seconds: 20), () {
      if (mounted) setState(() => _pin = null);
    });
    setState(() {
      _pin = spot;
      _ripple = at;
    });
    if (!_c.helperChat.open) _c.setHelperChatOpen(true);
  }

  Future<void> _leave() async {
    final h = _c.helper;
    if (h != null && !h.ended) {
      final end = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('End Live Assist?'),
          content: Text('${firstName(h.session.employeeName)} stops sharing their screen with you.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Keep helping')),
            FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('End')),
          ],
        ),
      );
      if (end != true) return;
      await _c.endHelper();
    }
    _c.closeViewer();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final h = _c.helper;
    if (h == null) return const Scaffold(body: SizedBox.shrink());
    final who = firstName(h.session.employeeName);
    final left = h.session.expiresAt?.difference(DateTime.now()).inSeconds;
    final status = switch (h.phase) {
      'waiting' => 'Waiting for $who to accept${left != null && left > 0 ? ' ($left s)' : ''}',
      'connecting' => '$who accepted. Connecting…',
      'live' => h.section == null ? 'Live' : 'Live · $who is on ${sectionLabels[h.section] ?? h.section}',
      _ => 'Ended',
    };
    final hasPicture = h.frame != null || h.video != null;
    final live = h.live && hasPicture;
    final chat = _c.helperChat;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(tooltip: 'Close', onPressed: () => unawaited(_leave()), icon: const Icon(Icons.close)),
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Live Assist with ${h.session.employeeName}', overflow: TextOverflow.ellipsis),
              Semantics(
                liveRegion: true,
                child: Text(status, style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant)),
              ),
            ],
          ),
          actions: [
            if (h.live) ...[
              PopupMenuButton<String>(
                tooltip: 'Suggest a page',
                icon: const Icon(Icons.open_in_new),
                onSelected: _c.suggest,
                itemBuilder: (_) => [for (final (path, label) in suggestiblePages()) PopupMenuItem(value: path, child: Text(label))],
              ),
              if (chat.notes.isNotEmpty || chat.messages.any((m) => m.mine && m.isNote && m.status == 'pinned'))
                IconButton(tooltip: 'Remove notes', onPressed: _c.removeNotes, icon: const Icon(Icons.layers_clear_outlined)),
              IconButton(
                tooltip: chat.unread > 0 ? 'Chat, ${chat.unread} new' : 'Chat',
                onPressed: () => _c.setHelperChatOpen(!chat.open),
                icon: Badge(isLabelVisible: chat.unread > 0, label: Text('${chat.unread}'), child: const Icon(Icons.chat_bubble_outline)),
              ),
            ],
          ],
        ),
        body: Column(
          children: [
            Expanded(
              child: ColoredBox(
                color: const Color(0xFF202124),
                child: LayoutBuilder(
                  builder: (context, box) {
                    final size = _pictureSize(h);
                    final picture = size == null ? Rect.zero : containRect(box.biggest, size);
                    return Stack(
                      fit: StackFit.expand,
                      children: [
                        // One renderer for the whole session, so the video stays attached.
                        if (_rendererReady) Offstage(offstage: h.video == null || h.frame != null, child: RTCVideoView(_renderer)),
                        if (h.frame != null) Image.memory(h.frame!, fit: BoxFit.contain, gaplessPlayback: true, semanticLabel: "$who's screen"),
                        if (live)
                          GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onPanUpdate: (d) => _point(picture, d.localPosition),
                            onPanEnd: (_) => _c.pointTo(null),
                            onTapUp: (d) => _tap(picture, d.localPosition),
                          ),
                        if (live && _ripple != null)
                          Positioned(
                            key: ValueKey(_ripple),
                            left: _ripple!.dx - 24,
                            top: _ripple!.dy - 24,
                            child: IgnorePointer(
                              child: TweenAnimationBuilder<double>(
                                tween: Tween(begin: 0.4, end: 1),
                                duration: const Duration(milliseconds: 600),
                                builder: (context, t, _) => Opacity(
                                  opacity: 1 - t,
                                  child: Container(
                                    width: 48,
                                    height: 48,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      border: Border.all(color: const Color(0xFFF9AB00), width: 3),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        if (!live)
                          Center(
                            child: _StageMessage(h: h, who: who),
                          ),
                      ],
                    );
                  },
                ),
              ),
            ),
            if (live && !chat.open)
              Padding(
                padding: const EdgeInsets.fromLTRB(Gap.l, Gap.s, Gap.l, Gap.s),
                child: Text(
                  'Drag to point. Tap something to highlight it, then type to pin a note beside it. You cannot tap or type for them.',
                  style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
                ),
              ),
            if (chat.open && !h.ended)
              SizedBox(
                height: MediaQuery.sizeOf(context).height * 0.38,
                child: AssistThread(
                  title: 'Chat with $who',
                  chat: chat,
                  theirName: who,
                  statusText: helperNoteStatus,
                  emptyText: 'Messages with $who show here. Nothing is saved.',
                  quick: h.fromPhone ? helperPhrases : ['Click here', ...helperPhrases.skip(1)],
                  enabled: h.live,
                  onSend: (text) {
                    _c.helperSend(text, pin: _pin);
                    setState(() => _pin = null);
                  },
                  onTyping: _c.helperTyping,
                  header: _pin == null
                      ? null
                      : Padding(
                          padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.s, 0),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  'Your next message is pinned beside the spot you tapped.',
                                  style: TextStyle(fontSize: 13, color: theme.colorScheme.primary),
                                ),
                              ),
                              TextButton(onPressed: () => setState(() => _pin = null), child: const Text('Unpin')),
                            ],
                          ),
                        ),
                ),
              ),
            if (h.ended)
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.all(Gap.l),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton(onPressed: () => unawaited(_leave()), child: const Text('Close')),
                  ),
                ),
              )
            else if (!h.live)
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.all(Gap.l),
                  child: SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () => unawaited(_c.endHelper()),
                      child: Text(h.phase == 'waiting' ? 'Cancel' : 'End Live Assist'),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _StageMessage extends StatelessWidget {
  const _StageMessage({required this.h, required this.who});

  final HelperView h;
  final String who;

  @override
  Widget build(BuildContext context) {
    const ink = TextStyle(color: Colors.white);
    if (h.ended) {
      return Padding(
        padding: const EdgeInsets.all(Gap.xl),
        child: Text(endMessages[h.reason] ?? 'Live Assist has ended.', textAlign: TextAlign.center, style: ink),
      );
    }
    return Padding(
      padding: const EdgeInsets.all(Gap.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(color: Colors.white),
          const SizedBox(height: Gap.l),
          Text(
            h.phase == 'waiting' ? 'Asking $who to share their Dikho screen…' : (h.live ? 'Waiting for their screen…' : 'Setting up the connection…'),
            textAlign: TextAlign.center,
            style: ink,
          ),
        ],
      ),
    );
  }
}
