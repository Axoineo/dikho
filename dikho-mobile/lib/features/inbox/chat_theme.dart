import 'package:flutter/material.dart';

/// The thread's own palette, from the --chat-* tokens in src/index.css: chrome
/// follows the app, the conversation keeps the look people read all day.
class ChatColors {
  const ChatColors({
    required this.canvas,
    required this.doodle,
    required this.bubbleIn,
    required this.bubbleOut,
    required this.bubbleOutText,
    required this.raised,
    required this.ring,
    required this.text,
    required this.sub,
    required this.meta,
    required this.tick,
    required this.quote,
    required this.quoteYou,
    required this.quoteThem,
    required this.actionIn,
    required this.actionOut,
    required this.accent,
    required this.onAccent,
    required this.hit,
  });

  final Color canvas;
  final Color doodle;
  final Color bubbleIn;
  final Color bubbleOut;
  final Color bubbleOutText;
  final Color raised;
  final Color ring;
  final Color text;
  final Color sub;
  final Color meta;
  final Color tick;
  final Color quote;
  final Color quoteYou;
  final Color quoteThem;
  final Color actionIn;
  final Color actionOut;
  final Color accent;
  final Color onAccent;
  final Color hit;

  static const light = ChatColors(
    canvas: Color(0xFFEFEAE2),
    doodle: Color(0x16543E22),
    bubbleIn: Color(0xFFFFFFFF),
    bubbleOut: Color(0xFFD9FDD3),
    bubbleOutText: Color(0xFF111B21),
    raised: Color(0xFFFFFFFF),
    ring: Color(0x1A185494),
    text: Color(0xFF1E2329),
    sub: Color(0xFF5C626C),
    meta: Color(0xA6111B21),
    tick: Color(0xFF0F7BC4),
    quote: Color(0x0E0B141A),
    quoteYou: Color(0xFF017561),
    quoteThem: Color(0xFF4B52B8),
    actionIn: Color(0xFF017561),
    actionOut: Color(0xFF017561),
    accent: Color(0xFF008069),
    onAccent: Color(0xFFFFFFFF),
    hit: Color(0x29185494),
  );

  static const dark = ChatColors(
    canvas: Color(0xFF101318),
    doodle: Color(0x0EFFFFFF),
    bubbleIn: Color(0xFF232831),
    bubbleOut: Color(0xFF005C4B),
    bubbleOutText: Color(0xFFE9EDEF),
    raised: Color(0xFF232831),
    ring: Color(0x14FFFFFF),
    text: Color(0xFFE2E5EA),
    sub: Color(0xFF8B919C),
    meta: Color(0xBFE9EDEF),
    tick: Color(0xFF53BDEB),
    quote: Color(0x33000000),
    quoteYou: Color(0xFF3FD59A),
    quoteThem: Color(0xFFAAB4FF),
    actionIn: Color(0xFF3FD59A),
    actionOut: Color(0xFF7FE0C4),
    accent: Color(0xFF00A884),
    onAccent: Color(0xFF111B21),
    hit: Color(0x4D5BA0E0),
  );

  static ChatColors of(BuildContext context) => Theme.of(context).brightness == Brightness.dark ? dark : light;
}

/// Spacing scale for every native screen.
class Gap {
  const Gap._();

  static const xs = 4.0;
  static const s = 8.0;
  static const m = 12.0;
  static const l = 16.0;
  static const xl = 24.0;
}
