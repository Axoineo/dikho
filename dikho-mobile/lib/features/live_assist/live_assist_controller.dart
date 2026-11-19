import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart' show MediaStream;

import '../../shared/crm_api.dart';
import 'assist_api.dart';
import 'assist_link.dart';
import 'assist_protocol.dart';
import 'screen_frames.dart';

/// A page the helper suggested, once it is known to be one of Dikho's.
class SuggestedPage {
  const SuggestedPage(this.path, this.label);

  final String path;
  final String label;
}

/// Helping someone: their screen, where it stands, and why it ended.
class HelperView {
  HelperView(this.session);

  AssistSession session;

  /// waiting, connecting, live or ended.
  String phase = 'waiting';
  String? reason;

  /// A computer's shared tab.
  MediaStream? video;

  /// A phone's shared screen: the newest picture.
  Uint8List? frame;

  /// Where they are in Dikho (a section key), as they report it.
  String? section;

  bool get live => phase == 'live';
  bool get ended => phase == 'ended';
  bool get fromPhone => frame != null;
}

/// Live Assist for whoever is signed in, in either role, as LiveAssistProvider.jsx:
/// - being helped: answers a request, shares Dikho's own screens, sees the helper's
///   pointer, highlights, notes and page suggestions, chats, and stops at any time;
/// - helping: starts a session, watches, points, highlights, pins notes, chats and
///   suggests pages.
/// Plus "Ask for help". The rules (who may help whom, one session per person, time
/// limits) are the server's; this drives the screens and the device-to-device link.
class LiveAssistController extends ChangeNotifier {
  LiveAssistController({
    required this.api,
    required this.userId,
    required this.canHelp,
    required this.makeLink,
    this.capture,
    DateTime Function()? now,
    this.frameEvery = const Duration(milliseconds: 400),
    this.connectTimeout = const Duration(seconds: 25),
  }) : _now = now ?? DateTime.now;

  final AssistApi api;
  final String userId;

  /// live_assist.use: may start a session with someone and is told of help requests.
  final bool canHelp;
  final LinkFactory makeLink;

  /// A picture of Dikho's screen ([ScreenFrames.capture] in the app).
  final Future<Uint8List?> Function()? capture;
  final Duration frameEvery;
  final Duration connectTimeout;
  final DateTime Function() _now;

  /// Where the person is now (a section key), for the helper's "is on Sales orders".
  String? Function()? sectionNow;

  /// The name of a page Dikho has at [path], or null when it has none: only those
  /// are offered as a helper's suggestion.
  String? Function(String path)? pageLabel;

  /// Opens a page the helper suggested and the person chose to go to.
  void Function(String? path)? onGo;

  bool _disposed = false;
  final _notices = StreamController<String>.broadcast();

  /// Short sentences on what happened, for a snackbar.
  Stream<String> get notices => _notices.stream;

  void _say(String text) {
    if (!_disposed) _notices.add(text);
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /* ── Being helped ──────────────────────────────────────────────────────── */

  /// A helper asking to see this person's screen, until answered or expired.
  AssistSession? incoming;

  /// The session this person is sharing their screen in.
  AssistSession? sharing;

  /// connecting or live.
  String sharingPhase = 'connecting';
  bool get sharingLive => sharing != null && sharingPhase == 'live';

  /// The helper's pointer, while they move it; a highlighted spot for four seconds.
  Spot? pointer;
  Spot? highlight;

  /// Bumped with each highlight, so the same spot twice still shows twice.
  int highlightCount = 0;
  SuggestedPage? suggestion;
  final employeeChat = AssistChat();

  AssistLink? _employeeLink;
  Timer? _incomingTimer;
  Timer? _pointerTimer;
  Timer? _highlightTimer;
  Timer? _frameTimer;
  bool _capturing = false;
  int? _lastPicture;
  DateTime? _lastPictureAt;
  bool _foreground = true;
  String? _sentSection;
  String? _screen;
  DateTime? _lastTypingSent;

  /* ── Helping ───────────────────────────────────────────────────────────── */

  HelperView? helper;
  final helperChat = AssistChat();
  AssistLink? _helperLink;
  Timer? _waitTimer;
  Timer? _connectTimer;

  bool get helping => helper != null && !helper!.ended;

  /// In a session in either role: one at a time per person.
  bool get busy => helping || sharing != null;

  /* ── Asking for help ───────────────────────────────────────────────────── */

  MyHelp? myHelp;
  Timer? _myHelpTimer;
  List<HelpRequest> helpRequests = [];
  final _dismissed = <String>{};

  List<HelpRequest> get openRequests => [
    for (final r in helpRequests)
      if (!_dismissed.contains(r.id)) r,
  ];

  HelpRequest? helpRequestFor(String person) {
    for (final r in helpRequests) {
      if (r.requesterId == person) return r;
    }
    return null;
  }

  /// What is already in flight: at sign-in, after a restart, and back from the
  /// background. A session marked live that this app is not in (one from before a
  /// restart) cannot continue, so it is closed on both sides.
  Future<void> start() async {
    try {
      final state = await api.state();
      final pending = state.incoming;
      if (pending != null && (pending.expiresAt?.isAfter(_now()) ?? false) && incoming?.id != pending.id) _setIncoming(pending);
      _setMyHelp(state.myHelp);
      helpRequests = canHelp ? state.helpRequests : [];
      for (final session in state.sessions) {
        if (session.id == sharing?.id || session.id == helper?.session.id) continue;
        unawaited(api.end(session.id, connectionLost: true).catchError((Object _) {}));
      }
      _notify();
    } on ApiException {
      // The staff channel still brings anything new.
    }
  }

  void _setIncoming(AssistSession? session) {
    _incomingTimer?.cancel();
    incoming = session;
    final expires = session?.expiresAt;
    if (session != null && expires != null) {
      _incomingTimer = Timer(_positive(expires.difference(_now())), () {
        if (incoming?.id == session.id) {
          incoming = null;
          _notify();
        }
      });
    }
  }

  void _setMyHelp(MyHelp? help) {
    _myHelpTimer?.cancel();
    myHelp = help;
    final expires = help?.expiresAt;
    if (help != null && expires != null) {
      _myHelpTimer = Timer(_positive(expires.difference(_now())), () {
        if (myHelp?.id == help.id) {
          myHelp = null;
          _notify();
        }
      });
    }
  }

  static Duration _positive(Duration d) => d.isNegative ? Duration.zero : d;

  /// An event on the person's private staff channel.
  void handleStaffEvent(String event, Map<String, dynamic> payload) {
    switch (event) {
      case 'assist_request':
        final session = AssistSession(payload);
        if (session.id.isEmpty || session.employeeId != userId) return;
        _setIncoming(session);
        if (session.fromHelpRequest) _setMyHelp(null);
      case 'assist_response':
        final session = AssistSession(payload);
        final h = helper;
        if (h == null || h.session.id != session.id || h.ended) return;
        if (session.status == 'active') {
          _connectTimer?.cancel();
          _connectTimer = Timer(connectTimeout, () {
            unawaited(api.end(session.id, connectionLost: true).catchError((Object _) {}));
            _finishHelper('no_connection');
          });
          h.session = h.session.merged(session);
          if (h.phase != 'live') h.phase = 'connecting';
        } else {
          _finishHelper(session.endReason.isEmpty ? 'declined' : session.endReason);
          return;
        }
      case 'assist_ended':
        final session = AssistSession(payload);
        if (session.id.isEmpty) return;
        if (incoming?.id == session.id) _setIncoming(null);
        final h = helper;
        if (h != null && h.session.id == session.id && !h.ended) _finishHelper(session.endReason);
        if (sharing?.id == session.id) {
          _closeSharing();
          _say(session.endReason == 'helper_ended' ? '${session.helperName} ended Live Assist.' : 'Live Assist ended.');
        }
      case 'help_request':
        final request = HelpRequest(payload);
        if (request.id.isEmpty || !canHelp || helpRequests.any((r) => r.id == request.id)) return;
        helpRequests = [...helpRequests, request];
      case 'help_closed':
        final id = payload['request_id'];
        helpRequests = [
          for (final r in helpRequests)
            if (r.id != id) r,
        ];
      default:
        return;
    }
    _notify();
  }

  /// "Share my screen". Null when it started (or the server said why not, as a
  /// notice); else the reason, for the dialog.
  Future<String?> accept() async {
    final session = incoming;
    if (session == null) return null;
    final AssistSession answer;
    try {
      answer = await api.respond(session.id, accept: true);
    } on ApiException catch (failure) {
      _setIncoming(null);
      _say(failure.message);
      _notify();
      return failure.message;
    }
    _setIncoming(null);
    if (answer.status != 'active') {
      _say(endMessages[answer.endReason] ?? 'Live Assist could not start.');
      _notify();
      return null;
    }
    sharing = answer;
    sharingPhase = 'connecting';
    employeeChat.reset();
    _sentSection = null;
    _lastPicture = null;
    _employeeLink = makeLink(
      sessionId: answer.id,
      sharer: true,
      onData: _fromHelper,
      onState: (state) {
        if (sharing?.id != answer.id) return;
        if (state == LinkState.connected) {
          sharingPhase = 'live';
          _reportSection();
          _notify();
        } else if (state == LinkState.failed || state == LinkState.signalFailed) {
          _closeSharing();
          unawaited(api.end(answer.id, connectionLost: true).catchError((Object _) {}));
          _say('Live Assist ended: the connection was lost.');
        }
      },
    );
    _frameTimer = Timer.periodic(frameEvery, (_) => unawaited(_sendPicture()));
    _notify();
    return null;
  }

  Future<void> decline() async {
    final id = incoming?.id;
    _setIncoming(null);
    _notify();
    if (id != null) {
      try {
        await api.respond(id, accept: false);
      } on ApiException {
        // It expires by itself.
      }
    }
  }

  Future<void> stopSharing() async {
    final id = sharing?.id;
    _closeSharing();
    if (id != null) {
      try {
        await api.end(id);
      } on ApiException {
        // The other side's connection drops anyway.
      }
    }
  }

  void _closeSharing() {
    _frameTimer?.cancel();
    _pointerTimer?.cancel();
    _highlightTimer?.cancel();
    unawaited(_employeeLink?.close());
    _employeeLink = null;
    sharing = null;
    pointer = null;
    highlight = null;
    suggestion = null;
    employeeChat.reset();
    _notify();
  }

  /// Pictures only while the app is on screen: nothing is taken in the background.
  void setForeground(bool value) => _foreground = value;

  Future<void> _sendPicture() async {
    final link = _employeeLink;
    final take = capture;
    if (link == null || take == null || !_foreground || _capturing || !sharingLive) return;
    _capturing = true;
    try {
      final picture = await take();
      if (picture == null || _employeeLink != link) return;
      final mark = fingerprint(picture);
      final now = _now();
      // An unchanged screen goes again only every few seconds.
      final last = _lastPictureAt;
      if (mark == _lastPicture && last != null && now.difference(last) < const Duration(seconds: 3)) return;
      if (await link.sendFrame(picture)) {
        _lastPicture = mark;
        _lastPictureAt = now;
      }
    } finally {
      _capturing = false;
    }
  }

  void _fromHelper(Object? raw) {
    final message = readHelperMessage(raw);
    if (message == null || sharing == null) return;
    switch (message) {
      case PointerAt(:final spot):
        pointer = spot;
        _pointerTimer?.cancel();
        // The pointer fades when the helper stops moving it.
        _pointerTimer = Timer(const Duration(seconds: 4), () {
          pointer = null;
          _notify();
        });
      case PointerHide():
        pointer = null;
      case HighlightAt(:final spot):
        highlight = spot;
        highlightCount++;
        _highlightTimer?.cancel();
        _highlightTimer = Timer(const Duration(seconds: 4), () {
          highlight = null;
          _notify();
        });
      case GoTo(:final path):
        // Only a page of this app, never an arbitrary address.
        final label = pageLabel?.call(path);
        if (label == null) return;
        suggestion = SuggestedPage(path, label);
      default:
        employeeChat.receive(message, _now());
    }
    _notify();
  }

  /// The person moved in the app. [screen] names the screen; notes and highlights
  /// point at things on the old one, so they go, and the helper is told.
  void screenChanged(String? screen) {
    if (screen == _screen) return;
    _screen = screen;
    if (sharing == null) return;
    highlight = null;
    if (employeeChat.notes.isNotEmpty) {
      employeeChat.clearNotes();
      _employeeLink?.send(const NotesCleared());
    }
    _reportSection();
    _notify();
  }

  void _reportSection() {
    if (!sharingLive) return;
    final section = sectionNow?.call();
    if (section == _sentSection) return;
    _sentSection = section;
    _employeeLink?.send(SectionIs(section));
  }

  void employeeSend(String text) {
    final message = chatMessage(text);
    if (message == null) return;
    _employeeLink?.send(message);
    employeeChat.sent(message, _now());
    _notify();
  }

  void employeeTyping() => _typing(_employeeLink);

  void _typing(AssistLink? link) {
    final now = _now();
    final last = _lastTypingSent;
    if (last != null && now.difference(last) < const Duration(seconds: 2)) return;
    _lastTypingSent = now;
    link?.send(const Typing());
  }

  /// A pinned note tapped "Done" ('clicked', the web's word) or closed ('dismissed').
  void noteDone(String id, String how) {
    _employeeLink?.send(NoteDone(id, how));
    employeeChat.noteDone(id, how);
    _notify();
  }

  void setEmployeeChatOpen(bool open) {
    employeeChat.setOpen(open);
    _notify();
  }

  void dismissPeek() {
    employeeChat.peek = null;
    _notify();
  }

  /// "Go": the suggested page, for the shell to open; the suggestion is done with.
  String? takeSuggestion() {
    final path = suggestion?.path;
    suggestion = null;
    _notify();
    return path;
  }

  void dismissSuggestion() {
    suggestion = null;
    _notify();
  }

  /* ── Helping ───────────────────────────────────────────────────────────── */

  /// Asks [personId] to share their screen. False when it could not start (a notice
  /// says why).
  Future<bool> startAssist(String personId, String name, {String? helpRequestId}) async {
    if (helping) {
      _say('Finish your current Live Assist session first.');
      return false;
    }
    if (sharing != null) {
      _say('Stop sharing your screen before you help someone.');
      return false;
    }
    final AssistSession session;
    try {
      session = await api.start(personId, helpRequestId: helpRequestId);
    } on ApiException catch (failure) {
      _say(failure.message);
      return false;
    }
    if (helpRequestId != null) {
      helpRequests = [
        for (final r in helpRequests)
          if (r.id != helpRequestId) r,
      ];
    }
    _closeHelperLink();
    helperChat.reset();
    final view = HelperView(session);
    helper = view;
    final expires = session.expiresAt;
    if (expires != null) {
      // A request waits about a minute for an answer.
      _waitTimer = Timer(_positive(expires.difference(_now())) + const Duration(milliseconds: 1500), () {
        if (helper == view && view.phase == 'waiting') _finishHelper('expired');
      });
    }
    _helperLink = makeLink(
      sessionId: session.id,
      sharer: false,
      onData: (raw) => _fromEmployee(view, raw),
      onState: (state) {
        if (helper != view || view.ended) return;
        if (state == LinkState.connected) {
          _connectTimer?.cancel();
          view.phase = 'live';
          _notify();
        } else if (state == LinkState.failed || state == LinkState.signalFailed) {
          unawaited(api.end(session.id, connectionLost: true).catchError((Object _) {}));
          _finishHelper(state == LinkState.signalFailed ? 'signal_failed' : 'no_connection');
        }
      },
      onVideo: (stream) {
        if (helper != view) return;
        view.video = stream;
        _notify();
      },
      onFrame: (picture) {
        if (helper != view || view.ended) return;
        view.frame = picture;
        _notify();
      },
    );
    _notify();
    return true;
  }

  void _fromEmployee(HelperView view, Object? raw) {
    if (helper != view) return;
    final message = readEmployeeMessage(raw);
    if (message == null) return;
    if (message is SectionIs) {
      view.section = message.section;
    } else {
      helperChat.receive(message, _now());
    }
    _notify();
  }

  void helperSend(String text, {Spot? pin}) {
    final message = helperMessage(text, pin, helperChat.nextNote);
    if (message == null) return;
    _helperLink?.send(message);
    helperChat.sent(message, _now());
    _notify();
  }

  void helperTyping() => _typing(_helperLink);

  void removeNotes() {
    _helperLink?.send(const NoteRemove('all'));
    helperChat.removeNotes();
    _notify();
  }

  /// The helper's finger on their screen; null when lifted.
  void pointTo(Spot? spot) => _helperLink?.send(spot == null ? const PointerHide() : PointerAt(spot));

  void highlightAt(Spot spot) => _helperLink?.send(HighlightAt(spot));

  void suggest(String path) => _helperLink?.send(GoTo(path));

  void setHelperChatOpen(bool open) {
    helperChat.setOpen(open);
    _notify();
  }

  Future<void> endHelper() async {
    final view = helper;
    if (view == null || view.ended) return;
    _finishHelper(view.phase == 'waiting' ? 'cancelled' : 'helper_ended');
    try {
      await api.end(view.session.id);
    } on ApiException {
      // It ends by itself when the connection drops.
    }
  }

  void _finishHelper(String reason) {
    final view = helper;
    if (view == null) return;
    _closeHelperLink();
    view
      ..phase = 'ended'
      ..reason = reason
      ..video = null
      ..frame = null;
    _notify();
  }

  void _closeHelperLink() {
    _waitTimer?.cancel();
    _connectTimer?.cancel();
    unawaited(_helperLink?.close());
    _helperLink = null;
  }

  /// The viewer was closed after the session ended.
  void closeViewer() {
    _closeHelperLink();
    helper = null;
    helperChat.reset();
    _notify();
  }

  /* ── Asking for help ───────────────────────────────────────────────────── */

  Future<List<AssistHelper>> helpers() => api.helpers();

  /// Tells everyone who may help, or only [helperId]. Throws [ApiException] for the
  /// dialog to show.
  Future<void> askForHelp(String message, {String? helperId}) async {
    final result = await api.askHelp(message, sectionNow?.call(), helperId: helperId);
    if (result.helpersNotified == 0) {
      try {
        await api.cancelHelp(result.requestId);
      } on ApiException {
        // It expires by itself.
      }
      _say('Nobody can take Live Assist requests for your account yet. Ask an Owner to set it up.');
      return;
    }
    _setMyHelp(MyHelp(id: result.requestId, expiresAt: result.expiresAt, helperName: result.helperName));
    if (result.alreadyOpen) {
      _say('You have already asked. Someone will be with you shortly.');
    } else if (result.helperName != null) {
      _say('${firstName(result.helperName)} has been asked. You will get a request to share your screen.');
    } else {
      _say('Help is on the way. You will get a request to share your screen.');
    }
    _notify();
  }

  Future<void> cancelHelp() async {
    final id = myHelp?.id;
    _setMyHelp(null);
    _notify();
    if (id != null) {
      try {
        await api.cancelHelp(id);
      } on ApiException {
        // It expires by itself.
      }
    }
  }

  void dismissRequest(String id) {
    _dismissed.add(id);
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final t in [_incomingTimer, _pointerTimer, _highlightTimer, _frameTimer, _waitTimer, _connectTimer, _myHelpTimer]) {
      t?.cancel();
    }
    unawaited(_employeeLink?.close());
    unawaited(_helperLink?.close());
    unawaited(_notices.close());
    super.dispose();
  }
}
