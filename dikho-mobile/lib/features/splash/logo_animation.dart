import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'logo_glyphs.dart';

/// The logo sequence from index.html: the D alone, the letters leaving it one
/// at a time, the dot rising out of the i, a hold, then back again. Drawn from
/// paths compiled into the app, so nothing is fetched or decoded, and the
/// controller drives only the painter, so no widget rebuilds on any frame.
class LogoAnimation extends StatefulWidget {
  const LogoAnimation({super.key, required this.width});

  final double width;

  @override
  State<LogoAnimation> createState() => _LogoAnimationState();
}

class _LogoAnimationState extends State<LogoAnimation> with SingleTickerProviderStateMixin {
  static const _period = Duration(milliseconds: 4400);

  late final AnimationController _controller = AnimationController(vsync: this, duration: _period);
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _controller.value = LogoTimeline.holdAt;
    } else if (!_started) {
      _started = true;
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => RepaintBoundary(
    child: SizedBox(
      width: widget.width,
      height: widget.width * LogoTimeline.height / LogoTimeline.width,
      child: CustomPaint(painter: LogoPainter(_controller)),
    ),
  );
}

/// One animated value: keyframes at fractions of the loop, with the curve that
/// leads away from each.
class Track {
  const Track(this.keys);

  final List<(double, double, Curve)> keys;

  double at(double t) {
    if (t <= keys.first.$1) return keys.first.$2;
    for (var i = 0; i < keys.length - 1; i++) {
      final (start, from, curve) = keys[i];
      final (end, to, _) = keys[i + 1];
      if (t <= end) {
        if (end == start) return to;
        return from + (to - from) * curve.transform((t - start) / (end - start));
      }
    }
    return keys.last.$2;
  }
}

/// The numbers from the @keyframes in index.html, as fractions of 4400ms.
class LogoTimeline {
  const LogoTimeline._();

  static const width = 1241.0;
  static const height = 420.0;

  /// The D's centre, and how far it sits from the middle of the mark at rest.
  static const centre = Offset(133, 264);
  static const parked = Offset(487.5, -54);
  static const parkedScale = 1.9;

  /// Everything out and settled: where a person who asked for less motion stays.
  static const holdAt = 0.45;

  static const _settle = Cubic(.37, 0, .63, 1);
  static const _exit = Cubic(.55, 0, .75, .35);
  static const _pop = Cubic(.25, 1.12, .5, 1);
  static const _sink = Cubic(.45, 0, .75, .55);

  /// 1 is parked in the middle at 1.9x, 0 is in place with the word beside it.
  static const open = Track([
    (0, 1, Curves.linear),
    (.075, 1, _settle),
    (.28125, 0, Curves.linear),
    (.63125, 0, _settle),
    (.853125, 1, Curves.linear),
    (1, 1, Curves.linear),
  ]);

  static Track _letter(double from, double start, double end, double back, double home) => Track([
    (0, from, Curves.linear),
    (start, from, _settle),
    (end, 0, Curves.linear),
    (back, 0, _exit),
    (home, from, Curves.linear),
    (1, from, Curves.linear),
  ]);

  static final slideO = _letter(-983, .075, .196875, .734375, .853125);
  static final slideH = _letter(-630, .103125, .225, .70, .81875);
  static final slideK = _letter(-383, .13125, .253125, .665625, .784375);
  static final slideI = _letter(-122, .159375, .28125, .63125, .75);

  static const dotOpacity = Track([
    (0, 0, Curves.linear),
    (.284, 0, Curves.linear),
    (.294, 1, Curves.linear),
    (.61, 1, Curves.linear),
    (.628125, 0, Curves.linear),
    (1, 0, Curves.linear),
  ]);

  /// 1 is risen and full size, 0 is sunk in the i at 0.4x.
  static const dotRise = Track([
    (0, 0, Curves.linear),
    (.294, 0, _pop),
    (.36875, 1, Curves.linear),
    (.55, 1, _sink),
    (.609375, 0, Curves.linear),
    (1, 0, Curves.linear),
  ]);

  static const spin = Track([(0, 0, Curves.linear), (.859375, 0, _settle), (1, 2 * math.pi, Curves.linear)]);
}

class LogoPainter extends CustomPainter {
  LogoPainter(this.progress) : super(repaint: progress);

  final Animation<double> progress;

  static final _d = glyphD();
  static final _i = glyphI();
  static final _k = glyphK();
  static final _h = glyphH();
  static final _o = glyphO();
  static final _dot = glyphDot();
  static final _dotBounds = _dot.getBounds();
  static final _dBounds = _d.getBounds();
  static final _brand = Paint()
    ..color = const Color(0xFF185494)
    ..isAntiAlias = true;
  static final _accent = Paint()
    ..color = const Color(0xFFF9AF1B)
    ..isAntiAlias = true;

  // The tunnel: letters inside the D are hidden, and dissolve into view over
  // their first 42 units out, instead of being cut at a hard edge.
  static final _tunnel = Paint()
    ..blendMode = BlendMode.dstIn
    ..shader = const LinearGradient(colors: [Color(0x00000000), Color(0x28000000), Color(0x80000000), Color(0xD7000000), Color(0xFF000000)])
        .createShader(const Rect.fromLTWH(266, 0, 42, 1));
  static const _wordArea = Rect.fromLTWH(-1400, -300, 2900, 1000);

  @override
  void paint(Canvas canvas, Size size) {
    final t = progress.value;
    canvas.scale(size.width / LogoTimeline.width);

    // The whole mark: parked around the D's centre, then into place.
    final open = LogoTimeline.open.at(t);
    final scale = 1 + (LogoTimeline.parkedScale - 1) * open;
    canvas.translate(LogoTimeline.parked.dx * open, LogoTimeline.parked.dy * open);
    canvas.translate(LogoTimeline.centre.dx, LogoTimeline.centre.dy);
    canvas.scale(scale);
    canvas.translate(-LogoTimeline.centre.dx, -LogoTimeline.centre.dy);

    // Under the word, so the i hides it as it rises.
    final dotOpacity = LogoTimeline.dotOpacity.at(t);
    if (dotOpacity > 0) {
      final rise = LogoTimeline.dotRise.at(t);
      final dotScale = 0.4 + 0.6 * rise;
      final c = _dotBounds.center;
      canvas.save();
      canvas.translate(0, 150 * (1 - rise));
      canvas.translate(c.dx, c.dy);
      canvas.scale(dotScale);
      canvas.translate(-c.dx, -c.dy);
      canvas.drawPath(_dot, _accent);
      canvas.restore();
    }

    canvas.saveLayer(_wordArea, Paint());
    void letter(Path path, double x) {
      canvas.save();
      canvas.translate(x, 0);
      canvas.drawPath(path, _brand);
      canvas.restore();
    }

    letter(_i, LogoTimeline.slideI.at(t));
    letter(_k, LogoTimeline.slideK.at(t));
    letter(_h, LogoTimeline.slideH.at(t));
    letter(_o, LogoTimeline.slideO.at(t));
    canvas.drawRect(_wordArea, _tunnel);
    canvas.restore();

    // Over the word, so it covers any bleed at the mouth. Turns once per loop.
    final spin = LogoTimeline.spin.at(t);
    if (spin > 0) {
      final c = _dBounds.center;
      canvas.save();
      canvas.translate(c.dx, c.dy);
      canvas.rotate(spin);
      canvas.translate(-c.dx, -c.dy);
      canvas.drawPath(_d, _brand);
      canvas.restore();
    } else {
      canvas.drawPath(_d, _brand);
    }
  }

  @override
  bool shouldRepaint(LogoPainter oldDelegate) => oldDelegate.progress != progress;
}
