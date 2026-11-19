import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../inbox/inbox_realtime.dart';
import 'assist_protocol.dart';

/// The device-to-device part of Live Assist, as src/features/live-assist/peer.js does
/// it in a browser, so a phone and a computer can be on either side.
///
/// The sharer (the employee) makes the offer; the viewer (the helper) answers. They
/// exchange the few setup messages over the private Realtime channel
/// `assist:<session id>`, which only the two of them may join or send on. After that,
/// everything goes directly between the two devices, encrypted by WebRTC, and nothing
/// passes through Dikho's servers or is recorded:
/// - the `assist` data channel: chat, notes, the pointer (JSON, at most 4 KB each);
/// - a computer's shared tab: a video track;
/// - a phone's shared screen: the `frames` data channel, carrying pictures of Dikho's
///   own screens only (never the phone's), each cut into chunks (see [FrameChunks]).
///
/// Only STUN servers are configured, as on the web; strict networks that block a
/// direct route would need a relay (TURN), issued by the Worker.
const iceServers = [
  {
    'urls': ['stun:stun.cloudflare.com:3478'],
  },
  {
    'urls': ['stun:stun.l.google.com:19302'],
  },
];

enum LinkState { connecting, connected, failed, signalFailed }

/// One side of a session's connection. [WebRtcLink] in the app; a fake in tests.
abstract class AssistLink {
  void send(AssistMessage message);

  /// A picture of the sharer's screen. False when it was not sent (the connection is
  /// not open, or earlier pictures are still on their way).
  Future<bool> sendFrame(Uint8List picture);

  Future<void> close();
}

typedef LinkFactory = AssistLink Function({
  required String sessionId,
  required bool sharer,
  required void Function(Object? message) onData,
  required void Function(LinkState state) onState,
  void Function(MediaStream stream)? onVideo,
  void Function(Uint8List picture)? onFrame,
});

/// A picture is cut into chunks of at most [chunkBytes], each with an 8-byte header:
/// the picture's number (4 bytes), the chunk's index and the number of chunks (2 bytes
/// each), all big-endian. Small messages travel well between every WebRTC stack.
class FrameChunks {
  static const chunkBytes = 16000;
  static const maxChunks = 120;

  static List<Uint8List> split(int frame, Uint8List picture) {
    final count = (picture.length / chunkBytes).ceil().clamp(1, maxChunks);
    if (picture.length > count * chunkBytes) return const [];
    return [
      for (var i = 0; i < count; i++)
        () {
          final start = i * chunkBytes;
          final end = (start + chunkBytes).clamp(0, picture.length);
          final chunk = Uint8List(8 + end - start);
          ByteData.sublistView(chunk)
            ..setUint32(0, frame)
            ..setUint16(4, i)
            ..setUint16(6, count);
          chunk.setRange(8, chunk.length, picture, start);
          return chunk;
        }(),
    ];
  }

  int? _frame;
  List<Uint8List?> _parts = const [];

  /// The whole picture once its last chunk arrives; a newer picture drops an
  /// unfinished older one.
  Uint8List? add(Uint8List chunk) {
    if (chunk.length < 9) return null;
    final header = ByteData.sublistView(chunk, 0, 8);
    final frame = header.getUint32(0);
    final index = header.getUint16(4);
    final count = header.getUint16(6);
    if (count == 0 || count > maxChunks || index >= count) return null;
    if (frame != _frame) {
      _frame = frame;
      _parts = List<Uint8List?>.filled(count, null);
    }
    if (_parts.length != count) return null;
    _parts[index] = Uint8List.sublistView(chunk, 8);
    if (_parts.any((p) => p == null)) return null;
    final whole = BytesBuilder(copy: false);
    for (final p in _parts) {
      whole.add(p!);
    }
    _parts = const [];
    _frame = null;
    return whole.takeBytes();
  }
}

/// The setup channel: a private Realtime broadcast channel per session.
class SignalChannel {
  SignalChannel({
    required String sessionId,
    required String supabaseUrl,
    required String apiKey,
    required Future<String> Function() token,
    required void Function(Map<String, dynamic> message) onMessage,
    required void Function() onJoined,
  }) : _realtime = InboxRealtime(
         supabaseUrl: supabaseUrl,
         apiKey: apiKey,
         token: token,
         channel: 'assist:$sessionId',
         onEvent: (event, payload) {
           if (event == 'signal') onMessage(payload);
         },
         onJoined: onJoined,
       );

  final InboxRealtime _realtime;

  bool get joined => _realtime.joined;

  void start() => _realtime.start();

  void send(Map<String, Object?> message) => _realtime.broadcast('signal', message);

  void close() => _realtime.stop();
}

// Ours are small; anything bigger on the `assist` channel is not one of them.
const _maxMessageBytes = 4096;

// Chat, notes and their answers wait for the channel to open; pointer moves and typing
// are only worth sending live.
const _keepUntilOpen = {'chat', 'note', 'note_remove', 'note_done', 'notes_cleared', 'section'};

/// The link in the app, over flutter_webrtc.
class WebRtcLink implements AssistLink {
  WebRtcLink({
    required this.sessionId,
    required this.sharer,
    required this.onData,
    required this.onState,
    required SignalChannel Function({required void Function(Map<String, dynamic>) onMessage, required void Function() onJoined}) signal,
    this.onVideo,
    this.onFrame,
  }) {
    _signal = signal(onMessage: (m) => unawaited(_onSignal(m)), onJoined: () => unawaited(_onJoined()));
    unawaited(_setUp());
  }

  final String sessionId;
  final bool sharer;
  final void Function(Object? message) onData;
  final void Function(LinkState state) onState;
  final void Function(MediaStream stream)? onVideo;
  final void Function(Uint8List picture)? onFrame;

  late final SignalChannel _signal;
  RTCPeerConnection? _pc;
  RTCDataChannel? _assist;
  RTCDataChannel? _frames;
  final _queue = <String>[];
  final _pendingIce = <RTCIceCandidate>[];
  final _chunks = FrameChunks();
  Future<void>? _offering;
  bool _answered = false;
  bool _gotOffer = false;
  bool _closed = false;
  int _frameNumber = 0;
  Timer? _hello;
  Timer? _joinTimeout;

  String get _me => sharer ? 'employee' : 'helper';
  String get _them => sharer ? 'helper' : 'employee';

  Future<void> _setUp() async {
    try {
      final pc = await createPeerConnection({'iceServers': iceServers, 'sdpSemantics': 'unified-plan'});
      if (_closed) {
        await pc.close();
        return;
      }
      _pc = pc;
      pc.onIceCandidate = (candidate) {
        if (candidate.candidate != null) _signal.send({'from': _me, 'type': 'ice', 'candidate': candidate.toMap()});
      };
      pc.onConnectionState = (state) => onState(switch (state) {
        RTCPeerConnectionState.RTCPeerConnectionStateConnected => LinkState.connected,
        RTCPeerConnectionState.RTCPeerConnectionStateFailed => LinkState.failed,
        _ => LinkState.connecting,
      });
      if (sharer) {
        _attachAssist(await pc.createDataChannel('assist', RTCDataChannelInit()..ordered = true));
        _frames = await pc.createDataChannel(
          'frames',
          RTCDataChannelInit()
            ..ordered = true
            ..binaryType = 'binary',
        );
      } else {
        pc.onTrack = (event) {
          if (event.streams.isNotEmpty) onVideo?.call(event.streams.first);
        };
        pc.onDataChannel = (channel) {
          if (channel.label == 'frames') {
            channel.onMessage = (message) {
              if (!message.isBinary) return;
              final picture = _chunks.add(message.binary);
              if (picture != null) onFrame?.call(picture);
            };
          } else {
            _attachAssist(channel);
          }
        };
      }
      _signal.start();
      // The channel either opens or this session cannot be set up.
      _joinTimeout = Timer(const Duration(seconds: 20), () {
        if (!_signal.joined && !_closed) onState(LinkState.signalFailed);
      });
    } on Object {
      if (!_closed) onState(LinkState.failed);
    }
  }

  void _attachAssist(RTCDataChannel channel) {
    _assist = channel;
    channel.onMessage = (message) {
      if (message.isBinary || message.text.length > _maxMessageBytes) return;
      try {
        onData(jsonDecode(message.text));
      } on FormatException {
        // Not one of ours.
      }
    };
    channel.onDataChannelState = (state) {
      if (state == RTCDataChannelState.RTCDataChannelOpen) _flush();
    };
    if (channel.state == RTCDataChannelState.RTCDataChannelOpen) _flush();
  }

  void _flush() {
    final channel = _assist;
    if (channel == null || channel.state != RTCDataChannelState.RTCDataChannelOpen) return;
    for (final text in List.of(_queue)) {
      unawaited(channel.send(RTCDataChannelMessage(text)));
    }
    _queue.clear();
  }

  Future<void> _onJoined() async {
    _joinTimeout?.cancel();
    if (sharer) {
      await _sendOffer();
    } else {
      _signal.send({'from': _me, 'type': 'hello'});
      // The sharer may join before or after: a hello every two seconds asks for the
      // offer until it arrives.
      _hello ??= Timer.periodic(const Duration(seconds: 2), (_) {
        if (_gotOffer) {
          _hello?.cancel();
          return;
        }
        _signal.send({'from': _me, 'type': 'hello'});
      });
    }
  }

  Future<void> _sendOffer() async {
    final pc = _pc;
    if (pc == null) return;
    _offering ??= () async {
      final offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
    }();
    await _offering;
    final local = await pc.getLocalDescription();
    if (local != null) _signal.send({'from': _me, 'type': 'offer', 'sdp': local.toMap()});
  }

  Future<void> _onSignal(Map<String, dynamic> message) async {
    final pc = _pc;
    if (pc == null || message['from'] != _them) return;
    try {
      final type = message['type'];
      final sdp = message['sdp'];
      if (sharer && type == 'hello' && !_answered) {
        await _sendOffer();
      } else if (sharer && type == 'answer' && !_answered && sdp is Map && sdp['type'] == 'answer') {
        _answered = true;
        await pc.setRemoteDescription(RTCSessionDescription(sdp['sdp'] as String?, 'answer'));
        await _addPendingIce(pc);
      } else if (!sharer && type == 'offer' && !_gotOffer && sdp is Map && sdp['type'] == 'offer') {
        _gotOffer = true;
        await pc.setRemoteDescription(RTCSessionDescription(sdp['sdp'] as String?, 'offer'));
        final answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        _signal.send({'from': _me, 'type': 'answer', 'sdp': answer.toMap()});
        await _addPendingIce(pc);
      } else if (type == 'ice' && message['candidate'] is Map) {
        final c = message['candidate'] as Map;
        final candidate = RTCIceCandidate(c['candidate'] as String?, c['sdpMid'] as String?, (c['sdpMLineIndex'] as num?)?.toInt());
        if (await pc.getRemoteDescription() != null) {
          await pc.addCandidate(candidate);
        } else {
          _pendingIce.add(candidate);
        }
      }
    } on Object {
      // A malformed or out-of-order message is ignored: the connection completes from
      // the next one, or the helper's side times out.
    }
  }

  Future<void> _addPendingIce(RTCPeerConnection pc) async {
    for (final candidate in List.of(_pendingIce)) {
      await pc.addCandidate(candidate);
    }
    _pendingIce.clear();
  }

  @override
  void send(AssistMessage message) {
    final json = message.toJson();
    final text = jsonEncode(json);
    final channel = _assist;
    if (channel != null && channel.state == RTCDataChannelState.RTCDataChannelOpen) {
      unawaited(channel.send(RTCDataChannelMessage(text)));
    } else if (_keepUntilOpen.contains(json['t']) && _queue.length < 50) {
      _queue.add(text);
    }
  }

  @override
  Future<bool> sendFrame(Uint8List picture) async {
    final channel = _frames;
    if (channel == null || channel.state != RTCDataChannelState.RTCDataChannelOpen) return false;
    // A slow connection gets fewer pictures rather than a growing queue.
    if ((channel.bufferedAmount ?? 0) > 512 * 1024) return false;
    final chunks = FrameChunks.split(++_frameNumber, picture);
    if (chunks.isEmpty) return false;
    for (final chunk in chunks) {
      await channel.send(RTCDataChannelMessage.fromBinary(chunk));
    }
    return true;
  }

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _hello?.cancel();
    _joinTimeout?.cancel();
    _queue.clear();
    _signal.close();
    try {
      await _assist?.close();
      await _frames?.close();
      await _pc?.close();
    } on Object {
      // Already closed.
    }
  }
}
