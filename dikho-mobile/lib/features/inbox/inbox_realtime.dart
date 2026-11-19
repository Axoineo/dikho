import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// A private Supabase Realtime channel the API Worker broadcasts to: `wa-inbox`, as
/// src/features/whatsapp/inbox/useInboxRealtime.js joins it from the browser, or a
/// person's own `staff:<id>`, where an administrator ending their session is announced.
///
/// Joining needs the staff policy on realtime.messages, so a valid session is the
/// credential: the same access token every API call uses, never stored here.
/// Broadcasts are fire-and-forget: anything sent while the socket is down is gone,
/// so [onJoined] fires on every (re)connect and the inbox re-reads from D1 then.
class InboxRealtime {
  InboxRealtime({
    required this.supabaseUrl,
    required this.apiKey,
    required this.token,
    required this.onEvent,
    required this.onJoined,
    this.onDown,
    this.channel = 'wa-inbox',
    Future<WebSocket> Function(String url)? connect,
  }) : _connect = connect ?? WebSocket.connect;

  /// The channel's name, without Realtime's `realtime:` prefix.
  final String channel;

  final String supabaseUrl;
  final String apiKey;
  final Future<String> Function() token;
  final void Function(String event, Map<String, dynamic> payload) onEvent;
  final void Function() onJoined;

  /// The channel was live and no longer is, so polling is the only source again.
  final void Function()? onDown;
  final Future<WebSocket> Function(String url) _connect;

  static const heartbeatEvery = Duration(seconds: 25);
  static const tokenCheckEvery = Duration(minutes: 5);
  static const _retryDelays = [1, 2, 5, 10, 30];

  WebSocket? _socket;
  Timer? _heartbeat;
  Timer? _tokenCheck;
  Timer? _retry;
  int _attempt = 0;
  int _ref = 0;
  String? _joinRef;
  String? _heartbeatRef;
  String? _sentToken;
  bool _running = false;
  bool _joined = false;

  bool get joined => _joined;

  // Broadcasts asked for before the channel is joined, sent once it is (at most 50).
  final _outbox = <Map<String, Object?>>[];

  /// Sends [payload] to everyone else on the channel as [event]. Before the channel
  /// is joined it waits, so a message sent the moment the channel opens is not lost.
  void broadcast(String event, Map<String, Object?> payload) {
    if (!_joined) {
      if (_outbox.length < 50) _outbox.add({'event': event, 'payload': payload});
      return;
    }
    _send({
      'topic': _topic,
      'event': 'broadcast',
      'payload': {'type': 'broadcast', 'event': event, 'payload': payload},
      'ref': '${++_ref}',
      'join_ref': _joinRef,
    });
  }

  String get _topic => 'realtime:$channel';

  Uri? get _socketUri {
    final base = Uri.tryParse(supabaseUrl);
    if (base == null || !base.hasAuthority) return null;
    return base.replace(
      scheme: base.scheme == 'https' ? 'wss' : 'ws',
      path: '/realtime/v1/websocket',
      queryParameters: {'apikey': apiKey, 'vsn': '1.0.0'},
    );
  }

  void start() {
    if (_running) return;
    _running = true;
    unawaited(_open());
  }

  void stop() {
    _running = false;
    _retry?.cancel();
    _outbox.clear();
    _closeSocket();
  }

  Future<void> _open() async {
    final uri = _socketUri;
    if (uri == null || !_running) return;
    try {
      final access = await token();
      final socket = await _connect(uri.toString());
      if (!_running) {
        await socket.close();
        return;
      }
      _socket = socket;
      // Closing a socket ends its stream too. Only the current one counts as lost.
      void lost() {
        if (identical(socket, _socket)) _onLost();
      }

      socket.listen(_onData, onDone: lost, onError: (Object _) => lost(), cancelOnError: true);
      _join(access);
      _heartbeat = Timer.periodic(heartbeatEvery, (_) => _beat());
      _tokenCheck = Timer.periodic(tokenCheckEvery, (_) => unawaited(_refreshToken()));
    } on Exception {
      _scheduleRetry();
    }
  }

  void _join(String access) {
    _sentToken = access;
    _joinRef = '${++_ref}';
    _send({
      'topic': _topic,
      'event': 'phx_join',
      'ref': _joinRef,
      'join_ref': _joinRef,
      'payload': {
        'config': {
          'broadcast': {'ack': false, 'self': false},
          'presence': {'key': '', 'enabled': false},
          'postgres_changes': <Object>[],
          'private': true,
        },
        'access_token': access,
      },
    });
  }

  void _beat() {
    // No answer to the last one: the socket looks open but nothing is arriving.
    if (_heartbeatRef != null) {
      _onLost();
      return;
    }
    _heartbeatRef = '${++_ref}';
    _send({'topic': 'phoenix', 'event': 'heartbeat', 'payload': <String, Object>{}, 'ref': _heartbeatRef});
  }

  Future<void> _refreshToken() async {
    try {
      final access = await token();
      if (access == _sentToken) return;
      _sentToken = access;
      _send({
        'topic': _topic,
        'event': 'access_token',
        'payload': {'access_token': access},
        'ref': '${++_ref}',
        'join_ref': _joinRef,
      });
    } on Exception {
      // Keep the channel until the server closes it, which reconnects.
    }
  }

  void _send(Map<String, Object?> message) {
    final socket = _socket;
    if (socket != null && socket.readyState == WebSocket.open) socket.add(jsonEncode(message));
  }

  void _onData(Object? data) {
    if (data is! String) return;
    final Object? decoded;
    try {
      decoded = jsonDecode(data);
    } on FormatException {
      return;
    }
    if (decoded is! Map<String, dynamic>) return;
    final event = decoded['event'];
    final payload = decoded['payload'];
    final ref = decoded['ref'];
    switch (event) {
      case 'phx_reply':
        if (ref == _heartbeatRef) {
          _heartbeatRef = null;
        } else if (ref == _joinRef) {
          if (payload is Map && payload['status'] == 'ok') {
            _joined = true;
            _attempt = 0;
            for (final waiting in List.of(_outbox)) {
              broadcast(waiting['event']! as String, waiting['payload']! as Map<String, Object?>);
            }
            _outbox.clear();
            onJoined();
          } else {
            _onLost();
          }
        }
      case 'phx_close':
      case 'phx_error':
        if (decoded['topic'] == _topic) _onLost();
      case 'broadcast':
        if (payload is Map<String, dynamic> && payload['event'] is String) {
          final inner = payload['payload'];
          onEvent(payload['event'] as String, inner is Map<String, dynamic> ? inner : const {});
        }
    }
  }

  void _onLost() {
    final wasJoined = _joined;
    _closeSocket();
    if (wasJoined) onDown?.call();
    _scheduleRetry();
  }

  void _scheduleRetry() {
    if (!_running) return;
    _retry?.cancel();
    final seconds = _retryDelays[_attempt.clamp(0, _retryDelays.length - 1)];
    _attempt++;
    _retry = Timer(Duration(seconds: seconds), () => unawaited(_open()));
  }

  void _closeSocket() {
    _heartbeat?.cancel();
    _tokenCheck?.cancel();
    _heartbeatRef = null;
    _joined = false;
    final socket = _socket;
    _socket = null;
    if (socket != null) unawaited(socket.close().catchError((Object _) => null));
  }
}
