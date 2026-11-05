import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dikho_crm/features/updater/apk_downloader.dart';
import 'package:dikho_crm/features/updater/update_controller.dart';
import 'package:dikho_crm/features/updater/update_info.dart';
import 'package:dikho_crm/shared/platform_api.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class FakePlatform implements UpdaterPlatform {
  String? rejection;
  bool canInstall = true;
  bool channelBroken = false;
  bool installBroken = false;
  int settingsOpened = 0;
  final installed = <String>[];
  final _events = StreamController<Map<Object?, Object?>>.broadcast();

  void sendInstallStatus(String status) =>
      _events.add({'type': 'installStatus', 'status': status});

  @override
  Future<String?> verifyApk(String path, int versionCode) async {
    if (channelBroken) throw PlatformException(code: 'broken');
    return rejection;
  }

  @override
  Future<bool> canInstallPackages() async => canInstall;

  @override
  Future<void> openInstallPermissionSettings() async => settingsOpened++;

  @override
  Future<void> installApk(String path) async {
    if (installBroken) throw PlatformException(code: 'broken');
    installed.add(path);
  }

  @override
  Stream<Map<Object?, Object?>> get installEvents => _events.stream;
}

void main() {
  final payload = List<int>.generate(64 * 1024, (i) => i % 251);
  late HttpServer server;
  late Directory dir;
  late FakePlatform platform;
  late void Function(HttpRequest) respond;

  setUp(() async {
    dir = Directory.systemTemp.createTempSync('update');
    platform = FakePlatform();
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) => respond(request));
    respond = (request) {
      request.response
        ..contentLength = payload.length
        ..add(payload)
        ..close();
    };
  });

  tearDown(() async {
    await server.close(force: true);
    dir.deleteSync(recursive: true);
  });

  UpdateController controller({String? hash}) => UpdateController(
    info: UpdateInfo(
      version: '1.1.0',
      versionCode: 2,
      mandatory: false,
      releaseNotes: '',
      apkUrl: Uri.parse('http://127.0.0.1:${server.port}/a.apk'),
      sha256: hash ?? sha256.convert(payload).toString(),
      sizeBytes: payload.length,
      publishedAt: DateTime.utc(2026),
    ),
    platform: platform,
    downloader: ApkDownloader(isAllowedRedirect: (_) => true),
    cacheDir: dir.path,
  );

  File apkFile() => File('${dir.path}/updates/dikho-crm-2.apk');

  test('success downloads, verifies and hands over to the installer', () async {
    final c = controller();
    await c.start();
    expect(c.phase, UpdatePhase.installing);
    expect(platform.installed.single, apkFile().path);
    expect(c.percent, 100);
  });

  test('a checksum mismatch never reaches the installer', () async {
    final c = controller(hash: 'b' * 64);
    await c.start();
    expect(c.phase, UpdatePhase.failed);
    expect(c.problem, UpdateProblem.badFile);
    expect(platform.installed, isEmpty);
    expect(apkFile().existsSync(), isFalse);
  });

  test('a wrong signer is rejected, deleted and never installed', () async {
    platform.rejection = 'signer';
    final c = controller();
    await c.start();
    expect(c.phase, UpdatePhase.failed);
    expect(c.problem, UpdateProblem.wrongSigner);
    expect(platform.installed, isEmpty);
    expect(apkFile().existsSync(), isFalse);
  });

  test('a network failure can be retried', () async {
    respond = (request) {
      request.response
        ..statusCode = 503
        ..close();
    };
    final c = controller();
    await c.start();
    expect(c.problem, UpdateProblem.network);

    respond = (request) {
      request.response
        ..contentLength = payload.length
        ..add(payload)
        ..close();
    };
    await c.start();
    expect(c.phase, UpdatePhase.installing);
  });

  test('cancelling returns to the prompt with nothing installed', () async {
    respond = (request) async {
      request.response.bufferOutput = false;
      request.response.contentLength = payload.length;
      request.response.add(payload.sublist(0, 1024));
      await request.response.flush();
    };
    final c = controller();
    final running = c.start();
    while (c.received == 0) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    c.cancelDownload();
    await running;
    expect(c.phase, UpdatePhase.prompt);
    expect(platform.installed, isEmpty);
  });

  test(
    'without install permission it explains first, then continues on return',
    () async {
      platform.canInstall = false;
      final c = controller();
      await c.start();
      expect(c.phase, UpdatePhase.needsPermission);
      expect(platform.installed, isEmpty);

      await c.openPermissionSettings();
      expect(platform.settingsOpened, 1);

      // Back from settings with the permission still off: nothing changes.
      await c.onResumed();
      expect(c.phase, UpdatePhase.needsPermission);

      platform.canInstall = true;
      await c.onResumed();
      expect(c.phase, UpdatePhase.installing);
      expect(platform.installed, hasLength(1));
    },
  );

  test(
    'cancelling Android installer screen can be retried without a new download',
    () async {
      final c = controller();
      await c.start();
      platform.sendInstallStatus('pendingUser');
      await Future<void>.delayed(Duration.zero);
      expect(c.phase, UpdatePhase.installing);

      platform.sendInstallStatus('cancelled');
      await Future<void>.delayed(Duration.zero);
      expect(c.phase, UpdatePhase.failed);
      expect(c.problem, UpdateProblem.installCancelled);
      expect(apkFile().existsSync(), isTrue);

      await c.start();
      expect(c.phase, UpdatePhase.installing);
      expect(platform.installed, hasLength(2));
    },
  );

  test('an installer failure is reported', () async {
    final c = controller();
    await c.start();
    platform.sendInstallStatus('failed');
    await Future<void>.delayed(Duration.zero);
    expect(c.problem, UpdateProblem.installFailed);
  });

  test(
    'a native failure while verifying rejects the file, never hangs',
    () async {
      platform.channelBroken = true;
      final c = controller();
      await c.start();
      expect(c.phase, UpdatePhase.failed);
      expect(platform.installed, isEmpty);
      expect(apkFile().existsSync(), isFalse);
    },
  );

  test(
    'a native failure while installing offers a retry, never hangs',
    () async {
      platform.installBroken = true;
      final c = controller();
      await c.start();
      expect(c.phase, UpdatePhase.failed);
      expect(c.problem, UpdateProblem.installFailed);
    },
  );

  test('progress is never above 100 percent', () {
    final c = controller();
    c.received = payload.length * 2;
    expect(c.percent, 100);
  });
}
