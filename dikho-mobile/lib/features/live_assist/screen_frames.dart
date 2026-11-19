import 'dart:math';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

/// Pictures of Dikho's own screens for Live Assist, taken from the app's top widget
/// (the boundary [key] wraps every route and dialog). Only what the app itself draws
/// is in them: never the status bar, notifications, the keyboard or another app, so
/// nothing outside Dikho can be seen, as on the web, where only the Dikho tab is
/// shared. A CRM page shown by the WebView is not drawn by the app and comes out blank.
class ScreenFrames {
  ScreenFrames(this.key);

  final GlobalKey key;

  /// The longest side of a picture, in pixels. Lowered when pictures come out large,
  /// so a slow connection still gets a readable screen.
  double longestSide = 1280;

  Future<Uint8List?> capture() async {
    // After the frame in progress is painted, never in the middle of one.
    await SchedulerBinding.instance.endOfFrame;
    final object = key.currentContext?.findRenderObject();
    if (object is! RenderRepaintBoundary || !object.attached || object.size.isEmpty) return null;
    final ratio = min(2.0, longestSide / max(object.size.width, object.size.height));
    final ui.Image image;
    try {
      image = await object.toImage(pixelRatio: ratio);
    } on Object {
      return null;
    }
    try {
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      final bytes = data?.buffer.asUint8List();
      if (bytes != null && bytes.length > 700 * 1024 && longestSide > 800) longestSide -= 240;
      return bytes;
    } finally {
      image.dispose();
    }
  }
}

/// A quick fingerprint of a picture, so an unchanged screen is not sent again.
int fingerprint(Uint8List bytes) {
  var hash = 0x811c9dc5;
  for (var i = 0; i < bytes.length; i += 7) {
    hash = ((hash ^ bytes[i]) * 0x01000193) & 0xffffffff;
  }
  return hash ^ bytes.length;
}
