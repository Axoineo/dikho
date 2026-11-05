import 'package:flutter/material.dart';

import '../features/connectivity/load_failure_view.dart';
import '../features/crm_webview/crm_screen.dart';
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
  late final Future<AppInfo> _info = widget.platform.appInfo();

  @override
  Widget build(BuildContext context) {
    final problems = AppConfig.problems();
    return MaterialApp(
      title: 'Dikho CRM',
      debugShowCheckedModeBanner: false,
      navigatorKey: _navigatorKey,
      theme: dikhoTheme(Brightness.light),
      darkTheme: dikhoTheme(Brightness.dark),
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
                );
              },
            ),
    );
  }
}
