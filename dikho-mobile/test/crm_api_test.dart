import 'dart:io';

import 'package:dikho_crm/shared/crm_api.dart';
import 'package:flutter_test/flutter_test.dart';

/// Real sockets on localhost: the first request on each path has its connection cut
/// before any answer, as a connection left idle too long is.
void main() {
  late HttpServer server;
  late Map<String, int> hits;
  late CrmApi api;

  setUp(() async {
    hits = {};
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final key = '${request.method} ${request.uri.path}';
      hits[key] = (hits[key] ?? 0) + 1;
      if (hits[key] == 1) {
        final socket = await request.response.detachSocket(writeHeaders: false);
        socket.destroy();
        return;
      }
      request.response.write('{"success":true,"data":{"ok":true}}');
      await request.response.close();
    });
    api = CrmApi(origin: Uri.parse('http://localhost:${server.port}'), token: ({bool forceFresh = false}) async => 't');
  });

  tearDown(() async {
    api.close();
    await server.close(force: true);
  });

  test('a read asks again when its connection was dropped', () async {
    expect(await api.get('/x'), {'ok': true});
    expect(hits['GET /api/x'], 2);
  });

  test('a send is never repeated, so it cannot go out twice', () async {
    await expectLater(api.post('/send', {'a': 1}), throwsA(isA<ApiException>()));
    expect(hits['POST /api/send'], 1);
  });
}
