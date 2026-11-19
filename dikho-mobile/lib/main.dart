import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app/app.dart';
import 'app/app_config.dart';
import 'shared/platform_api.dart';

void main() {
  // A release build keeps nothing in the system log: anything printed there can
  // be read over adb by whoever holds the phone.
  if (kReleaseMode && !AppConfig.localTestBuild) debugPrint = (message, {wrapWidth}) {};
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  runApp(DikhoApp(platform: PlatformApi()));
}
