import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../shared/platform_api.dart';
import '../auth/auth_controller.dart';

/// The CRM page's storage for its Supabase session, in the Android app. The session
/// itself belongs to the app ([AuthController]): the page reads it from here, asks
/// here for a fresh one, and its writes and its sign-out land here. Anything else
/// supabase-js keeps (the code verifier) is stored encrypted, as before. Only
/// Supabase's own keys get this far (WebViewBridge.kt checks them).
class SessionVault {
  SessionVault({required this.platform, required this.auth, FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  final PlatformApi platform;
  final AuthController auth;
  final FlutterSecureStorage _storage;

  Future<void> handle(Map<Object?, Object?> event) async {
    final id = event['id'];
    final op = event['op'];
    final key = event['key'];
    if (id is! int || key is! String) return;
    String? answer;
    try {
      if (key == auth.storageKey) {
        switch (op) {
          case 'get':
            answer = await auth.readForPage();
          case 'set':
            final value = event['value'];
            if (value is String) await auth.writtenByPage(value);
          case 'remove':
            await auth.removedByPage();
          case 'refresh':
            answer = await auth.refreshForPage();
        }
      } else {
        switch (op) {
          case 'get':
            answer = await _storage.read(key: key);
          case 'set':
            final value = event['value'];
            if (value is String) await _storage.write(key: key, value: value);
          case 'remove':
            await _storage.delete(key: key);
        }
      }
    } on PlatformException catch (error) {
      // A Keystore that fails (it happens after some restores) means signed out:
      // the person signs in again. Never an open session, never a crash.
      if (kDebugMode) debugPrint('vault $op failed: ${error.code}');
    }
    await platform.answerVault(id, answer);
  }
}
