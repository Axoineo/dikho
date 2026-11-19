import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dikho_crm/features/inbox/inbox_realtime.dart';
import 'package:flutter_test/flutter_test.dart';

/// A tiny Phoenix-shaped server, enough to check what the client sends and how it
/// reacts. Real WebSockets on localhost: nothing leaves the machine.
class FakeRealtime {
  late HttpServer _server;
  final sockets = <WebSocket>[];
  final received = <Map<String, dynamic>>[];
  final _connections = StreamController<WebSocket>.broadcast();
  bool answerHeartbeats = true;
  String joinStatus = 'ok';

  Uri get url => Uri.parse('http://localhost:${_server.port}');

  Future<void> start() async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    _server.listen((request) async {
      if (request.uri.path != '/realtime/v1/websocket') {
        request.response.statusCode = 404;
        await request.response.close();
        return;
      }
      lastQuery = request.uri.queryParameters;
      final socket = await WebSocketTransformer.upgrade(request);
      sockets.add(socket);
      _connections.add(socket);
      socket.listen((data) {
        final message = jsonDecode(data as String) as Map<String, dynamic>;
        received.add(message);
        if (message['event'] == 'phx_join') {
          socket.add(jsonEncode({'event': 'phx_reply', 'topic': message['topic'], 'ref': message['ref'], 'payload': {'status': joinStatus}}));
        } else if (message['event'] == 'heartbeat' && answerHeartbeats) {
          socket.add(jsonEncode({'event': 'phx_reply', 'topic': 'phoenix', 'ref': message['ref'], 'payload': {'status': 'ok'}}));
        }
      });
    });
  }

  Map<String, String> lastQuery = const {};

  void broadcast(String event, Map<String, dynamic> payload) {
    sockets.last.add(jsonEncode({
      'topic': 'realtime:wa-inbox',
      'event': 'broadcast',
      'payload': {'type': 'broadcast', 'event': event, 'payload': payload},
    }));
  }

  Future<void> stop() => _server.close(force: true);
}

Future<void> until(bool Function() check) async {
  final end = DateTime.now().add(const Duration(seconds: 5));
  while (!check()) {
    if (DateTime.now().isAfter(end)) fail('timed out');
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

void main() {
  late FakeRealtime server;
  late InboxRealtime client;
  late List<(String, Map<String, dynamic>)> events;
  late int joins;
  late String token;

  setUp(() async {
    server = FakeRealtime();
    await server.start();
    events = [];
    joins = 0;
    token = 'token-1';
    client = InboxRealtime(
      supabaseUrl: server.url.toString(),
      apiKey: 'public-key',
      token: () async => token,
      onEvent: (event, payload) => events.add((event, payload)),
      onJoined: () => joins++,
    );
  });

  tearDown(() async {
    client.stop();
    await server.stop();
  });

  test('joins the private channel with the session token, as the browser does', () async {
    client.start();
    await until(() => joins == 1);
    expect(server.lastQuery['apikey'], 'public-key');
    expect(server.lastQuery['vsn'], '1.0.0');
    final join = server.received.first;
    expect(join['topic'], 'realtime:wa-inbox');
    expect(join['event'], 'phx_join');
    final payload = join['payload'] as Map<String, dynamic>;
    expect(payload['access_token'], 'token-1');
    final config = payload['config'] as Map<String, dynamic>;
    expect(config['private'], isTrue);
    expect(config['broadcast'], {'ack': false, 'self': false});
    expect(client.joined, isTrue);
  });

  test('hands broadcast events to the inbox', () async {
    client.start();
    await until(() => joins == 1);
    server.broadcast('message:new', {'message': {'id': 1}});
    await until(() => events.isNotEmpty);
    expect(events.single.$1, 'message:new');
    expect((events.single.$2['message'] as Map)['id'], 1);
  });

  test('a lost socket reconnects, and joining again asks the inbox to catch up', () async {
    client.start();
    await until(() => joins == 1);
    await server.sockets.last.close();
    await until(() => joins == 2);
    expect(server.sockets.length, 2);
  });

  test('a live channel going down says so once, so polling can speed up again', () async {
    var downs = 0;
    final watched = InboxRealtime(
      supabaseUrl: server.url.toString(),
      apiKey: 'public-key',
      token: () async => token,
      onEvent: (_, _) {},
      onJoined: () => joins++,
      onDown: () => downs++,
    )..start();
    addTearDown(watched.stop);
    await until(() => joins == 1);
    expect(downs, 0);
    await server.sockets.last.close();
    await until(() => joins == 2);
    expect(downs, 1);
  });

  test('a refused join does not count as joined, and tries again', () async {
    server.joinStatus = 'error';
    client.start();
    await until(() => server.sockets.isNotEmpty && server.received.isNotEmpty);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(joins, 0);
    expect(client.joined, isFalse);
  });

  test('stopping stays stopped: no reconnect after the screen goes away', () async {
    client.start();
    await until(() => joins == 1);
    client.stop();
    await Future<void>.delayed(const Duration(milliseconds: 1200));
    expect(server.sockets.length, 1);
    expect(client.joined, isFalse);
  });

  test('garbage from the socket is ignored', () async {
    client.start();
    await until(() => joins == 1);
    server.sockets.last
      ..add('not json')
      ..add('[1,2]')
      ..add(jsonEncode({'event': 'broadcast', 'payload': 'text'}))
      ..add(jsonEncode({'event': 'broadcast', 'payload': {'event': 5}}));
    server.broadcast('message:new', {'ok': true});
    await until(() => events.isNotEmpty);
    expect(events.single.$1, 'message:new');
  });

  test('a bad address never starts a connection', () {
    final bad = InboxRealtime(
      supabaseUrl: 'not a url',
      apiKey: 'k',
      token: () async => 't',
      onEvent: (_, _) {},
      onJoined: () {},
      connect: (_) => throw StateError('must not connect'),
    );
    bad.start();
    bad.stop();
  });
}
