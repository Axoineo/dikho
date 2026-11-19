import 'dart:async';

import 'package:flutter/material.dart';

import '../features/connectivity/load_failure_view.dart';
import '../features/auth/auth_api.dart';
import '../features/auth/auth_controller.dart';
import '../features/crm_webview/crm_screen.dart';
import '../features/live_assist/assist_widgets.dart';
import '../features/live_assist/live_assist_controller.dart';
import '../features/shell/shell_controller.dart';
import '../shared/platform_api.dart';
import 'app_config.dart';
import 'theme.dart';

class DikhoApp extends StatefulWidget {
  const DikhoApp({super.key, required this.platform});

  final PlatformApi platform;

  @override
  State<DikhoApp> createState() => _DikhoAppState();
}

class _DikhoAppState extends State<DikhoApp> {
  final _navigatorKey = GlobalKey<NavigatorState>();
  final _shell = ShellController();

  /// Live Assist for whoever is signed in, set by the main screen; and the boundary
  /// its pictures of Dikho's screens are taken from.
  final _assist = ValueNotifier<LiveAssistController?>(null);
  final _captureKey = GlobalKey(debugLabel: 'live-assist-capture');
  late final Future<AppInfo> _info = widget.platform.appInfo();

  /// Signs people in and keeps the session; built only for a build that can sign in.
  late final AuthController? _auth = AppConfig.problems().isNotEmpty
      ? null
      : (AuthController(
          api: AuthApi(base: AppConfig.supabaseUri, apiKey: AppConfig.supabasePublishableKey),
          storageKey: AppConfig.sessionKey,
        )..load());
  bool _precached = false;

  // Decoded before they are first shown, so nothing pops in.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_precached) return;
    _precached = true;
    unawaited(precacheImage(const AssetImage('assets/brand/logo.png'), context));
    unawaited(precacheImage(const AssetImage('assets/chat/doodles.png'), context));
  }

  @override
  void dispose() {
    _assist.dispose();
    _shell.dispose();
    _auth?.api.close();
    _auth?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(listenable: _shell, builder: (context, _) => _app());

  Widget _app() {
    final problems = AppConfig.problems();
    return MaterialApp(
      title: 'Dikho CRM',
      debugShowCheckedModeBanner: false,
      navigatorKey: _navigatorKey,
      theme: dikhoTheme(Brightness.light),
      darkTheme: dikhoTheme(Brightness.dark),
      // The page's own light or dark choice, so native screens match it.
      themeMode: _shell.themeMode,
      // Around every route and dialog: what Live Assist shares, and its marks over it.
      builder: (context, child) =>
          AssistLayer(host: _assist, captureKey: _captureKey, navigatorKey: _navigatorKey, child: child ?? const SizedBox.shrink()),
      home: problems.isNotEmpty
          ? const LoadFailureView(
              title: 'This build is misconfigured',
              message:
                  'It was built with an address that is not allowed. '
                  'Install an official build of Dikho CRM.',
            )
          : FutureBuilder<AppInfo>(
              future: _info,
              builder: (context, snapshot) {
                final info = snapshot.data;
                if (info == null) {
                  return const ColoredBox(color: DikhoColors.surfaceLight);
                }
                return CrmScreen(
                  platform: widget.platform,
                  info: info,
                  navigatorKey: _navigatorKey,
                  shell: _shell,
                  auth: _auth!,
                  assistHost: _assist,
                  captureKey: _captureKey,
                );
              },
            ),
    );
  }
}
