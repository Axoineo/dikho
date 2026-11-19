import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../shared/crm_api.dart';
import '../inbox/chat_theme.dart';
import '../users/users_models.dart' show sectionLabels;
import 'assist_api.dart';
import 'assist_protocol.dart';
import 'live_assist_controller.dart';

/// Drawn over the whole app, around every route and dialog, as the web draws its Live
/// Assist layers over the tab. The boundary ([captureKey]) is what a helper sees: the
/// app's own screens, its dialogs and this layer, nothing else. The tree keeps the
/// same shape whether or not a session is on, so the app below never loses its state.
class AssistLayer extends StatelessWidget {
  const AssistLayer({super.key, required this.host, required this.captureKey, required this.navigatorKey, required this.child});

  final ValueListenable<LiveAssistController?> host;
  final GlobalKey captureKey;
  final GlobalKey<NavigatorState> navigatorKey;
  final Widget child;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<LiveAssistController?>(
    valueListenable: host,
    builder: (context, c, _) => c == null ? _frame(context, null) : ListenableBuilder(listenable: c, builder: (context, _) => _frame(context, c)),
  );

  Widget _frame(BuildContext context, LiveAssistController? c) {
    final media = MediaQuery.of(context);
    final sharing = c?.sharing != null;
    return RepaintBoundary(
      key: captureKey,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // The banner sits above the app but is drawn after it: every route's barrier
          // hides from screen readers whatever was drawn before it, Stop included.
          CustomMultiChildLayout(
            delegate: _BannerOnTop(),
            children: [
              LayoutId(
                id: _Slot.app,
                // The banner takes the status bar's place while it shows.
                child: MediaQuery(data: sharing ? media.removePadding(removeTop: true) : media, child: child),
              ),
              LayoutId(
                id: _Slot.banner,
                // Each part of the layer has its own overlay, for its buttons' tooltips:
                // the app's navigator, which has one, is below it.
                child: Overlay.wrap(
                  alwaysSizeToContent: true,
                  child: _Banner(c: c, navigatorKey: navigatorKey),
                ),
              ),
            ],
          ),
          if (c != null) ...[if (c.sharing != null) _Marks(c: c), _BottomCards(c: c, navigatorKey: navigatorKey)],
        ],
      ),
    );
  }
}

enum _Slot { app, banner }

/// The banner at the top at its own height, the app below it in the rest.
class _BannerOnTop extends MultiChildLayoutDelegate {
  @override
  void performLayout(Size size) {
    final banner = layoutChild(_Slot.banner, BoxConstraints(minWidth: size.width, maxWidth: size.width, maxHeight: size.height));
    positionChild(_Slot.banner, Offset.zero);
    layoutChild(_Slot.app, BoxConstraints.tight(Size(size.width, size.height - banner.height)));
    positionChild(_Slot.app, Offset(0, banner.height));
  }

  @override
  bool shouldRelayout(_BannerOnTop oldDelegate) => false;
}

/// "Asha is viewing your screen", the chat and Stop, always in view while sharing.
class _Banner extends StatelessWidget {
  const _Banner({required this.c, required this.navigatorKey});

  final LiveAssistController? c;
  final GlobalKey<NavigatorState> navigatorKey;

  @override
  Widget build(BuildContext context) {
    final session = c?.sharing;
    if (c == null || session == null) return const SizedBox.shrink();
    final live = c!.sharingLive;
    final unread = c!.employeeChat.unread;
    const ink = Colors.white;
    return Material(
      color: live ? const Color(0xFFB3261E) : const Color(0xFF5F6368),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.xs, Gap.xs, Gap.xs),
          child: Row(
            children: [
              const Icon(Icons.screen_share_outlined, color: ink, size: 20),
              const SizedBox(width: Gap.s),
              Expanded(
                child: Semantics(
                  liveRegion: true,
                  child: Text(
                    live ? '${session.helperName} is viewing your screen' : 'Connecting to ${firstName(session.helperName)}…',
                    style: const TextStyle(color: ink, fontWeight: FontWeight.w500),
                  ),
                ),
              ),
              if (live)
                IconButton(
                  tooltip: unread > 0 ? 'Chat, $unread new' : 'Chat',
                  onPressed: () => openEmployeeChat(navigatorKey, c!),
                  icon: Badge(
                    isLabelVisible: unread > 0,
                    label: Text('$unread'),
                    child: const Icon(Icons.chat_bubble_outline, color: ink),
                  ),
                ),
              TextButton(
                style: TextButton.styleFrom(foregroundColor: ink, backgroundColor: Colors.white.withValues(alpha: 0.18)),
                onPressed: () => unawaited(c!.stopSharing()),
                child: const Text('Stop'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The helper's pointer, a highlighted spot and their pinned notes, over everything.
class _Marks extends StatelessWidget {
  const _Marks({required this.c});

  final LiveAssistController c;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final who = firstName(c.sharing?.helperName);
    return Positioned.fill(child: Overlay.wrap(child: _marks(theme, who)));
  }

  Widget _marks(ThemeData theme, String who) => LayoutBuilder(
    builder: (context, box) {
      final w = box.maxWidth;
      final h = box.maxHeight;
      final pointer = c.pointer;
      final highlight = c.highlight;
      return Stack(
        children: [
          if (highlight != null)
            Positioned(
              key: ValueKey('highlight-${c.highlightCount}'),
              left: highlight.x * w - 28,
              top: highlight.y * h - 28,
              child: IgnorePointer(
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: 1.6, end: 1),
                  duration: const Duration(milliseconds: 500),
                  builder: (context, scale, child) => Transform.scale(scale: scale, child: child),
                  child: Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: const Color(0xFFF9AB00), width: 4),
                      color: const Color(0x33F9AB00),
                    ),
                  ),
                ),
              ),
            ),
          for (final note in c.employeeChat.notes) _note(context, note, w, h),
          if (pointer != null)
            Positioned(
              left: pointer.x * w - 2,
              top: pointer.y * h - 2,
              child: IgnorePointer(
                child: ExcludeSemantics(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Transform.rotate(angle: -0.6, child: Icon(Icons.navigation, size: 26, color: theme.colorScheme.primary)),
                      Container(
                        margin: const EdgeInsets.only(top: 18),
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(color: theme.colorScheme.primary, borderRadius: BorderRadius.circular(6)),
                        child: Text(who, style: TextStyle(color: theme.colorScheme.onPrimary, fontSize: 12)),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      );
    },
  );

  /// A note beside its spot, kept on screen: a dot on the spot, the card below it (or
  /// above, near the bottom).
  Widget _note(BuildContext context, NotePin note, double w, double h) {
    final theme = Theme.of(context);
    const cardWidth = 220.0;
    final x = note.x * w;
    final y = note.y * h;
    final left = (x - cardWidth / 2).clamp(Gap.s, (w - cardWidth - Gap.s).clamp(Gap.s, w));
    final below = y < h * 0.7;
    return Positioned(
      left: left,
      top: below ? y + 14 : null,
      bottom: below ? null : h - y + 14,
      width: cardWidth,
      child: Material(
        elevation: 6,
        color: const Color(0xFFFFF4CE),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Gap.m, Gap.s, Gap.xs, Gap.s),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 11,
                backgroundColor: const Color(0xFFB06000),
                child: Text('${note.n}', style: const TextStyle(fontSize: 12, color: Colors.white)),
              ),
              const SizedBox(width: Gap.s),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(note.text, style: const TextStyle(color: Color(0xFF3D2E00))),
                    TextButton(
                      style: TextButton.styleFrom(padding: EdgeInsets.zero, foregroundColor: theme.colorScheme.primary),
                      onPressed: () => c.noteDone(note.id, 'clicked'),
                      child: const Text('Done'),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Hide this note',
                visualDensity: VisualDensity.compact,
                onPressed: () => c.noteDone(note.id, 'dismissed'),
                icon: const Icon(Icons.close, size: 18, color: Color(0xFF3D2E00)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// At the bottom: a page suggestion, the helper's newest message, help requests for a
/// helper, and your own request for help.
class _BottomCards extends StatelessWidget {
  const _BottomCards({required this.c, required this.navigatorKey});

  final LiveAssistController c;
  final GlobalKey<NavigatorState> navigatorKey;

  @override
  Widget build(BuildContext context) {
    final cards = <Widget>[];
    final session = c.sharing;
    if (session != null && c.sharingLive) {
      final who = firstName(session.helperName);
      final suggestion = c.suggestion;
      if (suggestion != null) {
        cards.add(
          _Card(
            text: '$who suggests opening ${suggestion.label}',
            actions: [
              TextButton(onPressed: c.dismissSuggestion, child: const Text('Not now')),
              FilledButton(onPressed: () => c.onGo?.call(c.takeSuggestion()), child: const Text('Go')),
            ],
          ),
        );
      }
      final peek = c.employeeChat.peek;
      if (peek != null && !c.employeeChat.open) {
        cards.add(
          _Card(
            text: '$who: ${peek.text}',
            onClose: c.dismissPeek,
            closeLabel: 'Hide this message',
            actions: [
              for (final reply in employeeReplies.take(3)) OutlinedButton(onPressed: () => c.employeeSend(reply), child: Text(reply)),
              TextButton(onPressed: () => openEmployeeChat(navigatorKey, c), child: const Text('Reply')),
            ],
          ),
        );
      }
    }
    if (c.canHelp && !c.helping && session == null) {
      for (final r in c.openRequests.take(2)) {
        final where = sectionLabels[r.section];
        cards.add(
          _Card(
            text: [
              '${r.requesterName} ${r.forYou ? 'asked you for help' : 'needs help'}${where == null ? '' : ' in $where'}',
              if (r.message.isNotEmpty) '"${r.message}"',
            ].join('\n'),
            actions: [
              TextButton(onPressed: () => c.dismissRequest(r.id), child: const Text('Later')),
              FilledButton(
                onPressed: () => unawaited(c.startAssist(r.requesterId, r.requesterName, helpRequestId: r.id)),
                child: const Text('Help now'),
              ),
            ],
          ),
        );
      }
    }
    final mine = c.myHelp;
    if (mine != null && session == null && c.incoming == null) {
      cards.add(
        _Card(
          text: mine.helperName == null
              ? 'Help requested. Someone will ask to see your screen.'
              : '${firstName(mine.helperName)} has been asked to help you.',
          actions: [TextButton(onPressed: () => unawaited(c.cancelHelp()), child: const Text('Cancel'))],
        ),
      );
    }
    if (cards.isEmpty) return const SizedBox.shrink();
    final media = MediaQuery.of(context);
    return Positioned(
      left: Gap.m,
      right: Gap.m,
      bottom: media.viewInsets.bottom + media.padding.bottom + Gap.xl * 2,
      child: Overlay.wrap(
        alwaysSizeToContent: true,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final card in cards)
              Padding(
                padding: const EdgeInsets.only(top: Gap.s),
                child: card,
              ),
          ],
        ),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.text, required this.actions, this.onClose, this.closeLabel});

  final String text;
  final List<Widget> actions;
  final VoidCallback? onClose;
  final String? closeLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      elevation: 6,
      color: theme.colorScheme.surfaceContainerHigh,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.s, Gap.s),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: Semantics(liveRegion: true, child: Text(text))),
                if (onClose != null)
                  IconButton(tooltip: closeLabel, visualDensity: VisualDensity.compact, onPressed: onClose, icon: const Icon(Icons.close, size: 20)),
              ],
            ),
            const SizedBox(height: Gap.xs),
            Wrap(alignment: WrapAlignment.end, spacing: Gap.s, runSpacing: Gap.xs, children: actions),
          ],
        ),
      ),
    );
  }
}

/// The chat with the helper, as a sheet over the app (so the helper sees it too).
void openEmployeeChat(GlobalKey<NavigatorState> navigatorKey, LiveAssistController c) {
  final context = navigatorKey.currentContext;
  if (context == null || c.employeeChat.open) return;
  c.setEmployeeChatOpen(true);
  unawaited(
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => ListenableBuilder(
        listenable: c,
        builder: (context, _) {
          final session = c.sharing;
          if (session == null) return const SizedBox(height: 120, child: Center(child: Text('Live Assist has ended.')));
          final who = firstName(session.helperName);
          return Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
            child: SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.55,
              child: AssistThread(
                title: 'Chat with $who',
                chat: c.employeeChat,
                theirName: who,
                statusText: employeeNoteStatus,
                emptyText: 'Messages with $who show here. Nothing is saved.',
                quick: employeeReplies,
                onSend: c.employeeSend,
                onTyping: c.employeeTyping,
              ),
            ),
          );
        },
      ),
    ).whenComplete(() => c.setEmployeeChatOpen(false)),
  );
}

/// A Live Assist conversation: the thread, typing, quick replies and the composer.
class AssistThread extends StatefulWidget {
  const AssistThread({
    super.key,
    required this.title,
    required this.chat,
    required this.theirName,
    required this.statusText,
    required this.emptyText,
    required this.quick,
    required this.onSend,
    required this.onTyping,
    this.enabled = true,
    this.header,
    this.now,
  });

  final String title;
  final AssistChat chat;
  final String theirName;
  final String Function(String? status) statusText;
  final String emptyText;
  final List<String> quick;
  final ValueChanged<String> onSend;
  final VoidCallback onTyping;
  final bool enabled;

  /// Shown above the composer, for the helper's "pinned at the spot you tapped".
  final Widget? header;
  final DateTime Function()? now;

  @override
  State<AssistThread> createState() => _AssistThreadState();
}

class _AssistThreadState extends State<AssistThread> {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _send([String? value]) {
    final text = value ?? _text.text;
    if (text.trim().isEmpty) return;
    widget.onSend(text);
    if (value == null) _text.clear();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final chat = widget.chat;
    final muted = TextStyle(fontSize: 12, color: theme.colorScheme.onSurfaceVariant);
    final typing = chat.typing((widget.now ?? DateTime.now)());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.l, 0, Gap.l, Gap.s),
          child: Semantics(header: true, child: Text(widget.title, style: theme.textTheme.titleMedium)),
        ),
        Expanded(
          child: chat.messages.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(Gap.l),
                    child: Text(widget.emptyText, textAlign: TextAlign.center, style: muted),
                  ),
                )
              : ListView(
                  reverse: true,
                  padding: const EdgeInsets.symmetric(horizontal: Gap.l),
                  children: [
                    for (final m in chat.messages.reversed)
                      Align(
                        alignment: m.mine ? Alignment.centerRight : Alignment.centerLeft,
                        child: Container(
                          margin: const EdgeInsets.symmetric(vertical: Gap.xs),
                          padding: const EdgeInsets.symmetric(horizontal: Gap.m, vertical: Gap.s),
                          constraints: const BoxConstraints(maxWidth: 300),
                          decoration: BoxDecoration(
                            color: m.mine ? theme.colorScheme.primaryContainer : theme.colorScheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (m.isNote) Text('Note ${m.note} · ${widget.statusText(m.status)}', style: muted),
                              Text(m.text),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
        ),
        if (typing)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Gap.l),
            child: Text('${widget.theirName} is typing…', style: muted),
          ),
        if (widget.enabled) ...[
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: Gap.l),
              children: [
                for (final q in widget.quick)
                  Padding(
                    padding: const EdgeInsets.only(right: Gap.s),
                    child: ActionChip(label: Text(q), onPressed: () => _send(q)),
                  ),
              ],
            ),
          ),
          ?widget.header,
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.l, Gap.xs, Gap.s, Gap.s),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _text,
                    minLines: 1,
                    maxLines: 4,
                    textCapitalization: TextCapitalization.sentences,
                    inputFormatters: [LengthLimitingTextInputFormatter(maxChat)],
                    onChanged: (_) => widget.onTyping(),
                    decoration: InputDecoration(hintText: 'Message ${widget.theirName}'),
                  ),
                ),
                IconButton(tooltip: 'Send', onPressed: _send, icon: const Icon(Icons.send)),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// "Asha wants to help you": the person's choice, every time.
class IncomingDialog extends StatefulWidget {
  const IncomingDialog({super.key, required this.c, required this.session, this.now});

  final LiveAssistController c;
  final AssistSession session;
  final DateTime Function()? now;

  @override
  State<IncomingDialog> createState() => _IncomingDialogState();
}

class _IncomingDialogState extends State<IncomingDialog> {
  bool _busy = false;
  String? _error;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  int get _left {
    final expires = widget.session.expiresAt;
    if (expires == null) return 0;
    final seconds = (expires.difference((widget.now ?? DateTime.now)()).inMilliseconds / 1000).ceil();
    return seconds < 0 ? 0 : seconds;
  }

  Future<void> _accept() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final problem = await widget.c.accept();
    if (!mounted) return;
    if (problem == null) {
      Navigator.of(context).pop();
    } else {
      setState(() {
        _busy = false;
        _error = problem;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = widget.session;
    final who = firstName(s.helperName, fallback: 'Your colleague');
    final left = _left;
    return AlertDialog(
      icon: const Icon(Icons.screen_share_outlined),
      title: Text('${s.helperName} wants to help you'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$who will see Dikho on this phone, nothing else: not your notifications or other apps. '
            'They can point at things and pin notes, but cannot tap or type for you. '
            'You can stop at any time. Nothing is recorded.',
          ),
          if (_error != null) ...[
            const SizedBox(height: Gap.m),
            Semantics(
              liveRegion: true,
              child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
            ),
          ],
          const SizedBox(height: Gap.m),
          Text(
            left > 0 ? 'This request closes in $left s.' : 'This request has closed.',
            style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy
              ? null
              : () {
                  unawaited(widget.c.decline());
                  Navigator.of(context).pop();
                },
          child: const Text('Not now'),
        ),
        FilledButton(onPressed: _busy || left == 0 ? null : () => unawaited(_accept()), child: Text(_busy ? 'Starting…' : 'Share my screen')),
      ],
    );
  }
}

/// "Ask for help": everyone who can help is told, or only the person chosen.
class AskHelpDialog extends StatefulWidget {
  const AskHelpDialog({super.key, required this.c});

  final LiveAssistController c;

  @override
  State<AskHelpDialog> createState() => _AskHelpDialogState();
}

class _AskHelpDialogState extends State<AskHelpDialog> {
  final _message = TextEditingController();
  List<AssistHelper>? _helpers;
  bool _listFailed = false;
  String _choice = '';
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_loadHelpers());
  }

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _loadHelpers() async {
    try {
      final list = await widget.c.helpers();
      if (mounted) setState(() => _helpers = list);
    } on ApiException {
      if (mounted) {
        setState(() {
          _helpers = const [];
          _listFailed = true;
        });
      }
    }
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.c.askForHelp(_message.text.trim(), helperId: _choice.isEmpty ? null : _choice);
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (failure) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = failure.message;
        });
      }
    }
  }

  static String _status(AssistHelper h) => h.busy ? 'In a session' : (h.online ? 'Online' : 'Away');

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final helpers = _helpers;
    final nobody = helpers != null && helpers.isEmpty && !_listFailed;
    final chosen = helpers?.where((h) => h.userId == _choice).firstOrNull;
    final muted = TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant);
    return AlertDialog(
      title: const Text('Ask for help'),
      scrollable: true,
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'We will tell the people who can help you, or only the person you choose. When they are free, '
            'you will get a request to share Dikho on this phone so they can show you.',
          ),
          if (widget.c.myHelp != null) ...[
            const SizedBox(height: Gap.s),
            Text('You have already asked. Sending again just reminds you it is open.', style: muted),
          ],
          const SizedBox(height: Gap.m),
          TextField(
            controller: _message,
            minLines: 2,
            maxLines: 4,
            textCapitalization: TextCapitalization.sentences,
            inputFormatters: [LengthLimitingTextInputFormatter(300)],
            decoration: const InputDecoration(labelText: 'What do you need help with? (optional)'),
          ),
          const SizedBox(height: Gap.m),
          if (nobody)
            Text(
              'Nobody can take Live Assist requests for your account yet. Ask an Owner to set it up.',
              style: TextStyle(color: theme.colorScheme.error),
            )
          else ...[
            Semantics(header: true, child: Text('Who should help?', style: theme.textTheme.titleSmall)),
            if (helpers == null)
              Padding(
                padding: const EdgeInsets.all(Gap.s),
                child: Text('Loading who can help…', style: muted),
              ),
            if (_listFailed) Text('The list could not be loaded. You can still ask everyone.', style: muted),
            RadioGroup<String>(
              groupValue: _choice,
              onChanged: (v) => setState(() => _choice = v ?? ''),
              child: Column(
                children: [
                  RadioListTile<String>(
                    contentPadding: EdgeInsets.zero,
                    value: '',
                    title: const Text('Anyone who can help'),
                    subtitle: helpers == null || helpers.isEmpty ? null : Text(helpers.length == 1 ? '1 person' : '${helpers.length} people'),
                  ),
                  for (final h in helpers ?? const <AssistHelper>[])
                    RadioListTile<String>(contentPadding: EdgeInsets.zero, value: h.userId, title: Text(h.name), subtitle: Text(_status(h))),
                ],
              ),
            ),
            if (chosen != null && !chosen.online && !chosen.busy)
              Text('${firstName(chosen.name)} is away. They will see your request if they come back within 15 minutes.', style: muted),
            if (chosen != null && chosen.busy)
              Text('${firstName(chosen.name)} is helping someone right now. They will see your request when they finish.', style: muted),
          ],
          if (_error != null) ...[
            const SizedBox(height: Gap.s),
            Semantics(
              liveRegion: true,
              child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(), child: Text(nobody ? 'Close' : 'Cancel')),
        if (!nobody) FilledButton(onPressed: _busy ? null : () => unawaited(_send()), child: Text(_busy ? 'Sending…' : 'Ask for help')),
      ],
    );
  }
}
