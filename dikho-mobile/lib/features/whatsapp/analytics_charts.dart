import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../inbox/chat_theme.dart';
import 'analytics_models.dart';

/// The dashboard's charts, drawn by hand as the web's are
/// (src/features/whatsapp/analytics/charts.jsx): one axis, 2px lines, columns with
/// rounded tops on the baseline, a recessive grid, a legend for two or more series,
/// a touch readout with a crosshair, and a table beside every time chart.
///
/// Series colours are the web's, with their own steps for the dark theme, validated
/// against both surfaces.
class ChartSeries {
  const ChartSeries(this.label, this.light, this.dark);

  final String label;
  final Color light;
  final Color dark;

  Color on(BuildContext context) => Theme.of(context).brightness == Brightness.dark ? dark : light;
}

const sentSeries = ChartSeries('Sent', Color(0xFF2A78D6), Color(0xFF3987E5));
const deliveredSeries = ChartSeries('Delivered', Color(0xFFEB6834), Color(0xFFD95926));
const readSeries = ChartSeries('Read', Color(0xFF1BAF7A), Color(0xFF199E70));

class ChartLegend extends StatelessWidget {
  const ChartLegend({super.key, required this.series});

  final List<ChartSeries> series;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: Gap.l,
    runSpacing: Gap.xs,
    children: [
      for (final s in series)
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(color: s.on(context), borderRadius: BorderRadius.circular(3)),
            ),
            const SizedBox(width: 6),
            Text(s.label, style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
    ],
  );
}

/// Indices to label on the x axis: an even step counted back from the last point, or
/// round [steps] counted from the first (hours: every 6, 12 or 24).
List<int> _labelIndices(int n, int room, List<int>? steps) {
  if (n <= 0) return const [];
  if (steps != null) {
    final step = steps.firstWhere((s) => (n / s).ceil() <= room, orElse: () => steps.last);
    final picked = [for (var i = 0; i < n; i += step) i];
    if (picked.last != n - 1 && n - 1 - picked.last >= step / 2) picked.add(n - 1);
    return picked;
  }
  final step = math.max(1, (n / math.max(1, room)).ceil());
  return [for (var i = n - 1; i >= 0; i -= step) i].reversed.toList();
}

class _Frame {
  _Frame({required this.size, required this.top, required this.ticks, required this.left, this.bands});

  final Size size;
  final double top;
  final List<double> ticks;
  final double left;
  final int? bands;

  static const double topPad = 10;
  static const double bottomPad = 24;
  double get right => size.width - 4;
  double get bottom => size.height - bottomPad;
  double y(num value) => bottom - (value / top) * (bottom - topPad);
}

TextPainter _text(String text, TextStyle style) => TextPainter(
  text: TextSpan(text: text, style: style),
  textDirection: TextDirection.ltr,
)..layout();

void _paintAxes(
  Canvas canvas,
  _Frame f, {
  required Color grid,
  required TextStyle axis,
  required String Function(num) formatAxis,
  required List<int> labels,
  required String Function(int) xLabel,
  required double Function(int) xAt,
}) {
  final gridPaint = Paint()
    ..color = grid
    ..strokeWidth = 1;
  for (final t in f.ticks) {
    final y = f.y(t).roundToDouble() + 0.5;
    canvas.drawLine(Offset(f.left, y), Offset(f.right, y), gridPaint);
    final label = _text(formatAxis(t), axis);
    label.paint(canvas, Offset(f.left - 6 - label.width, y - label.height / 2));
  }
  for (final i in labels) {
    final label = _text(xLabel(i), axis);
    var x = xAt(i) - label.width / 2;
    x = x.clamp(f.left - 4, f.right - label.width).toDouble();
    label.paint(canvas, Offset(x, f.bottom + 6));
  }
}

double _leftPad(List<double> ticks, String Function(num) formatAxis, TextStyle axis) =>
    ticks.map((t) => _text(formatAxis(t), axis).width).fold<double>(0, math.max) + 10;

/// The readout over a chart, flipped to the left of the finger near the right edge.
class _Readout extends StatelessWidget {
  const _Readout({required this.x, required this.width, required this.title, required this.rows});

  final double x;
  final double width;
  final String title;
  final List<(Color?, String, String)> rows;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final flip = x > width * 0.55;
    return Positioned(
      top: 0,
      left: flip ? null : x + 10,
      right: flip ? width - x + 10 : null,
      child: IgnorePointer(
        child: Material(
          elevation: 3,
          color: theme.colorScheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 120, maxWidth: 200),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(title, style: theme.textTheme.labelMedium),
                  const SizedBox(height: 4),
                  for (final (color, label, value) in rows)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Row(
                        children: [
                          if (color != null) ...[
                            Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2)),
                            ),
                            const SizedBox(width: 6),
                          ],
                          Expanded(
                            child: Text(label, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                          ),
                          const SizedBox(width: Gap.s),
                          Text(value, style: theme.textTheme.bodySmall?.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Lines over the same x, one per series. Touch or drag to read each point.
class LineChart extends StatefulWidget {
  const LineChart({
    super.key,
    required this.series,
    required this.values,
    required this.xLabel,
    required this.tipTitle,
    required this.semanticLabel,
    this.formatValue = _plain,
    this.formatAxis,
    this.labelSteps,
    this.height = 220,
  });

  final List<ChartSeries> series;

  /// One list per series, all the same length.
  final List<List<num>> values;
  final String Function(int index) xLabel;
  final String Function(int index) tipTitle;
  final String semanticLabel;
  final String Function(num) formatValue;
  final String Function(num)? formatAxis;
  final List<int>? labelSteps;
  final double height;

  @override
  State<LineChart> createState() => _LineChartState();
}

String _plain(num value) => value.round().toString();

class _LineChartState extends State<LineChart> {
  int? _index;

  int get _n => widget.values.isEmpty ? 0 : widget.values.first.length;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final axis = TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant);
    final formatAxis = widget.formatAxis ?? widget.formatValue;
    final max = widget.values.expand((v) => v).fold<num>(0, (a, b) => math.max(a, b)).toDouble();
    final scale = chartScale(max);
    final colors = [for (final s in widget.series) s.on(context)];
    return Semantics(
      label: '${widget.semanticLabel}. The table view lists every value.',
      child: ExcludeSemantics(
        child: SizedBox(
          height: widget.height,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final size = Size(constraints.maxWidth, widget.height);
              final frame = _Frame(size: size, top: scale.top, ticks: scale.ticks, left: _leftPad(scale.ticks, formatAxis, axis));
              double xAt(int i) => _n <= 1 ? (frame.left + frame.right) / 2 : frame.left + i * (frame.right - frame.left) / (_n - 1);
              void pick(Offset local) {
                if (_n == 0) return;
                final i = _n <= 1 ? 0 : ((local.dx - frame.left) / (frame.right - frame.left) * (_n - 1)).round();
                setState(() => _index = i.clamp(0, _n - 1));
              }

              final index = _index != null && _index! < _n ? _index : null;
              return GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTapDown: (d) => pick(d.localPosition),
                onHorizontalDragStart: (d) => pick(d.localPosition),
                onHorizontalDragUpdate: (d) => pick(d.localPosition),
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    CustomPaint(
                      size: size,
                      painter: _LinePainter(
                        frame: frame,
                        values: widget.values,
                        colors: colors,
                        index: index,
                        grid: theme.colorScheme.outlineVariant.withValues(alpha: 0.6),
                        crosshair: theme.colorScheme.onSurfaceVariant,
                        surface: theme.colorScheme.surface,
                        axis: axis,
                        formatAxis: formatAxis,
                        labels: _labelIndices(_n, ((frame.right - frame.left) / 56).floor() + 1, widget.labelSteps),
                        xLabel: widget.xLabel,
                        xAt: xAt,
                      ),
                    ),
                    if (index != null)
                      _Readout(
                        x: xAt(index),
                        width: size.width,
                        title: widget.tipTitle(index),
                        rows: [
                          for (var s = 0; s < widget.series.length; s++)
                            (colors[s], widget.series[s].label, widget.formatValue(widget.values[s][index])),
                        ],
                      ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _LinePainter extends CustomPainter {
  _LinePainter({
    required this.frame,
    required this.values,
    required this.colors,
    required this.index,
    required this.grid,
    required this.crosshair,
    required this.surface,
    required this.axis,
    required this.formatAxis,
    required this.labels,
    required this.xLabel,
    required this.xAt,
  });

  final _Frame frame;
  final List<List<num>> values;
  final List<Color> colors;
  final int? index;
  final Color grid, crosshair, surface;
  final TextStyle axis;
  final String Function(num) formatAxis;
  final List<int> labels;
  final String Function(int) xLabel;
  final double Function(int) xAt;

  @override
  void paint(Canvas canvas, Size size) {
    _paintAxes(canvas, frame, grid: grid, axis: axis, formatAxis: formatAxis, labels: labels, xLabel: xLabel, xAt: xAt);
    for (var s = 0; s < values.length; s++) {
      final line = values[s];
      if (line.isEmpty) continue;
      final paint = Paint()
        ..color = colors[s]
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round
        ..strokeCap = StrokeCap.round;
      final path = Path()..moveTo(xAt(0), frame.y(line[0]));
      for (var i = 1; i < line.length; i++) {
        path.lineTo(xAt(i), frame.y(line[i]));
      }
      canvas.drawPath(path, paint);
      if (line.length == 1) _dot(canvas, Offset(xAt(0), frame.y(line[0])), colors[s]);
    }
    final i = index;
    if (i != null) {
      final x = xAt(i);
      final dash = Paint()
        ..color = crosshair.withValues(alpha: 0.6)
        ..strokeWidth = 1;
      for (var y = _Frame.topPad; y < frame.bottom; y += 6) {
        canvas.drawLine(Offset(x, y), Offset(x, math.min(y + 3, frame.bottom)), dash);
      }
      for (var s = 0; s < values.length; s++) {
        _dot(canvas, Offset(x, frame.y(values[s][i])), colors[s]);
      }
    }
  }

  void _dot(Canvas canvas, Offset at, Color color) {
    canvas.drawCircle(at, 6, Paint()..color = surface);
    canvas.drawCircle(at, 4, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_LinePainter old) => old.index != index || old.values != values || old.frame.size != frame.size || old.colors != colors;
}

/// One series as columns. The card's title names it, so no legend.
class ColumnChart extends StatefulWidget {
  const ColumnChart({
    super.key,
    required this.series,
    required this.values,
    required this.xLabel,
    required this.tipTitle,
    required this.semanticLabel,
    this.formatValue = _plain,
    this.formatAxis,
    this.integer = true,
    this.height = 180,
  });

  final ChartSeries series;
  final List<num> values;
  final String Function(int index) xLabel;
  final String Function(int index) tipTitle;
  final String semanticLabel;
  final String Function(num) formatValue;
  final String Function(num)? formatAxis;
  final bool integer;
  final double height;

  @override
  State<ColumnChart> createState() => _ColumnChartState();
}

class _ColumnChartState extends State<ColumnChart> {
  int? _index;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final axis = TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant);
    final formatAxis = widget.formatAxis ?? widget.formatValue;
    final n = widget.values.length;
    final max = widget.values.fold<num>(0, (a, b) => math.max(a, b)).toDouble();
    final scale = chartScale(max, integer: widget.integer);
    final color = widget.series.on(context);
    return Semantics(
      label: widget.semanticLabel,
      child: ExcludeSemantics(
        child: SizedBox(
          height: widget.height,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final size = Size(constraints.maxWidth, widget.height);
              final frame = _Frame(size: size, top: scale.top, ticks: scale.ticks, left: _leftPad(scale.ticks, formatAxis, axis), bands: n);
              final band = n == 0 ? 0.0 : (frame.right - frame.left) / n;
              double center(int i) => frame.left + band * i + band / 2;
              void pick(Offset local) {
                if (n == 0) return;
                setState(() => _index = ((local.dx - frame.left) / band).floor().clamp(0, n - 1));
              }

              final index = _index != null && _index! < n ? _index : null;
              return GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTapDown: (d) => pick(d.localPosition),
                onHorizontalDragStart: (d) => pick(d.localPosition),
                onHorizontalDragUpdate: (d) => pick(d.localPosition),
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    CustomPaint(
                      size: size,
                      painter: _ColumnPainter(
                        frame: frame,
                        values: widget.values,
                        color: color,
                        index: index,
                        band: band,
                        highlight: theme.colorScheme.onSurface.withValues(alpha: 0.05),
                        grid: theme.colorScheme.outlineVariant.withValues(alpha: 0.6),
                        axis: axis,
                        formatAxis: formatAxis,
                        labels: _labelIndices(n, ((frame.right - frame.left) / 56).floor() + 1, null),
                        xLabel: widget.xLabel,
                        center: center,
                      ),
                    ),
                    if (index != null)
                      _Readout(
                        x: center(index),
                        width: size.width,
                        title: widget.tipTitle(index),
                        rows: [(color, widget.series.label, widget.formatValue(widget.values[index]))],
                      ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _ColumnPainter extends CustomPainter {
  _ColumnPainter({
    required this.frame,
    required this.values,
    required this.color,
    required this.index,
    required this.band,
    required this.highlight,
    required this.grid,
    required this.axis,
    required this.formatAxis,
    required this.labels,
    required this.xLabel,
    required this.center,
  });

  final _Frame frame;
  final List<num> values;
  final Color color;
  final int? index;
  final double band;
  final Color highlight, grid;
  final TextStyle axis;
  final String Function(num) formatAxis;
  final List<int> labels;
  final String Function(int) xLabel;
  final double Function(int) center;

  @override
  void paint(Canvas canvas, Size size) {
    _paintAxes(canvas, frame, grid: grid, axis: axis, formatAxis: formatAxis, labels: labels, xLabel: xLabel, xAt: center);
    final i = index;
    if (i != null) {
      canvas.drawRect(Rect.fromLTWH(center(i) - band / 2, _Frame.topPad, band, frame.bottom - _Frame.topPad), Paint()..color = highlight);
    }
    final width = math.max(1.0, math.min(28.0, band - 2));
    final paint = Paint()..color = color;
    for (var k = 0; k < values.length; k++) {
      final top = frame.y(values[k]);
      final height = frame.bottom - top;
      if (height <= 0) continue;
      final r = math.min(4.0, math.min(height, width / 2));
      final rect = Rect.fromLTWH(center(k) - width / 2, top, width, height);
      canvas.drawRRect(RRect.fromRectAndCorners(rect, topLeft: Radius.circular(r), topRight: Radius.circular(r)), paint);
    }
  }

  @override
  bool shouldRepaint(_ColumnPainter old) => old.index != index || old.values != values || old.frame.size != frame.size || old.color != color;
}

/// Ranked bars with the label and value written out, so nothing depends on reading a
/// bar's length or colour.
class BarList extends StatelessWidget {
  const BarList({super.key, required this.items, this.max});

  /// (label, value, written value, note)
  final List<({String label, num value, String text, String? note})> items;
  final num? max;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final top = max ?? items.fold<num>(1, (a, b) => math.max(a, b.value));
    final color = sentSeries.on(context);
    return Column(
      children: [
        for (final item in items)
          MergeSemantics(
            child: Padding(
              padding: const EdgeInsets.only(bottom: Gap.m),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: Text(item.label, style: theme.textTheme.bodyMedium)),
                      const SizedBox(width: Gap.m),
                      Text.rich(
                        TextSpan(
                          text: item.text,
                          children: [
                            if (item.note != null)
                              TextSpan(
                                text: ' ${item.note}',
                                style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 12),
                              ),
                          ],
                        ),
                        style: theme.textTheme.bodyMedium?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  ExcludeSemantics(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: SizedBox(
                        height: 8,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            ColoredBox(color: theme.colorScheme.surfaceContainerHighest),
                            if (item.value > 0)
                              FractionallySizedBox(
                                alignment: Alignment.centerLeft,
                                widthFactor: math.max(0.02, math.min(1, item.value / top)).toDouble(),
                                child: DecoratedBox(
                                  decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(4)),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// The numbers behind a time chart, newest first.
class ChartTable extends StatelessWidget {
  const ChartTable({super.key, required this.columns, required this.rows});

  final List<String> columns;
  final List<List<String>> rows;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final head = theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final cell = theme.textTheme.bodySmall?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        headingRowHeight: 32,
        dataRowMinHeight: 32,
        dataRowMaxHeight: 36,
        horizontalMargin: 0,
        columnSpacing: Gap.l,
        columns: [
          for (var i = 0; i < columns.length; i++)
            DataColumn(
              label: Text(columns[i], style: head),
              numeric: i > 0,
            ),
        ],
        rows: [
          for (final row in rows.reversed) DataRow(cells: [for (final value in row) DataCell(Text(value, style: cell))]),
        ],
      ),
    );
  }
}
