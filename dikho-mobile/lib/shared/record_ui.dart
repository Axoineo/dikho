import 'dart:async';

import 'package:flutter/material.dart';

import '../features/inbox/chat_theme.dart';

/// The pieces every native record screen shares (Leads, Clients and the modules after
/// them), so a list, its details and its empty states look and behave the same.

/// A round monogram, the native form of the CRM's Monogram.
class Initials extends StatelessWidget {
  const Initials({super.key, required this.text, this.size = 44});

  final String text;
  final double size;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(shape: BoxShape.circle, color: theme.navigationDrawerTheme.indicatorColor),
        child: Text(
          text,
          style: TextStyle(fontSize: size * 0.34, fontWeight: FontWeight.w500, color: theme.colorScheme.primary),
        ),
      ),
    );
  }
}

enum PillTone { neutral, pending, active, danger }

/// A status label, coloured as the CRM's StatusPill tones are.
class Pill extends StatelessWidget {
  const Pill({super.key, required this.label, this.tone = PillTone.neutral});

  final String label;
  final PillTone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final (Color ground, Color ink) = switch (tone) {
      PillTone.active => dark ? (const Color(0xFF1F3B2A), const Color(0xFF8FD6A7)) : (const Color(0xFFE6F4EA), const Color(0xFF1E6B3A)),
      PillTone.pending => dark ? (const Color(0xFF3D3016), const Color(0xFFF2C46B)) : (const Color(0xFFFFF4DE), const Color(0xFF8A5A00)),
      PillTone.danger => (scheme.errorContainer, scheme.onErrorContainer),
      PillTone.neutral => (scheme.surfaceContainerHighest, scheme.onSurfaceVariant),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Gap.s, vertical: 3),
      decoration: BoxDecoration(color: ground, borderRadius: BorderRadius.circular(12)),
      child: Text(
        label,
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: ink),
      ),
    );
  }
}

/// What a list shows when it has nothing, or could not load.
class EmptyMessage extends StatelessWidget {
  const EmptyMessage({super.key, required this.title, required this.body, this.action, this.onAction});

  final String title;
  final String body;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(Gap.xl),
      children: [
        const SizedBox(height: Gap.xl),
        Text(title, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
        const SizedBox(height: Gap.s),
        Text(
          body,
          textAlign: TextAlign.center,
          style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
        ),
        if (action != null) ...[
          const SizedBox(height: Gap.l),
          Center(
            child: FilledButton(onPressed: onAction, child: Text(action!)),
          ),
        ],
      ],
    );
  }
}

/// One of a row of ways to reach someone. Icon above the word, like a phone's own
/// contact card: three across fit a 320dp phone with large text, where icon and word
/// side by side cut "WhatsApp" short.
class QuickAction extends StatelessWidget {
  const QuickAction({super.key, required this.icon, required this.label, required this.onPressed});

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Expanded(
    child: FilledButton.tonal(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 64),
        padding: const EdgeInsets.symmetric(horizontal: Gap.xs, vertical: Gap.s),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      onPressed: onPressed,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 22),
          const SizedBox(height: Gap.xs),
          FittedBox(fit: BoxFit.scaleDown, child: Text(label, maxLines: 1)),
        ],
      ),
    ),
  );
}

/// A titled card of label and value rows, the native form of the CRM's KeyValues.
class DetailsCard extends StatelessWidget {
  const DetailsCard({super.key, required this.title, required this.rows});

  final String title;
  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.l),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            header: true,
            child: Text(title, style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ),
          const SizedBox(height: Gap.s),
          DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(color: theme.colorScheme.outlineVariant),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                for (final (index, (label, value)) in rows.indexed) ...[
                  if (index > 0) Divider(height: 1, color: theme.colorScheme.outlineVariant),
                  // One row reads as one: "Phone, +91 98200 00060", not every label
                  // in the card first and every value after.
                  MergeSemantics(
                    child: Padding(
                      padding: const EdgeInsets.all(Gap.m),
                      // Labels are short and keep their width, so a long value wraps instead.
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(label, style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                          const SizedBox(width: Gap.l),
                          Expanded(
                            child: value.isEmpty
                                ? Semantics(
                                    label: 'Not set',
                                    child: const ExcludeSemantics(child: Text('—', textAlign: TextAlign.end)),
                                  )
                                : SelectableText(value, textAlign: TextAlign.end),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "1 Nov 2026", in the phone's own time zone, as formatDisplayDate shows dates on the web.
String formatDisplayDate(String? value) {
  if (value == null || value.isEmpty) return '';
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return '';
  // A bare date ("2026-11-01") is a calendar day, not a moment: never shift it.
  final at = value.length <= 10 ? parsed : parsed.toLocal();
  return '${at.day} ${_months[at.month - 1]} ${at.year}';
}

/// Row height that grows with the phone's font size, so large text is never cut off,
/// while staying fixed so a long list never measures each row.
double recordRowExtent(BuildContext context) {
  final scaled = MediaQuery.textScalerOf(context).scale(44) + 20;
  return scaled > 72 ? scaled : 72;
}

/// True once a list is within about a screen and a half of its end. That is when the
/// next page is asked for, so it has usually arrived before anyone reaches it and a
/// fling carries on instead of stopping at a spinner. Only scrolling asks, so a list
/// nobody scrolls never reads a second page.
bool nearListEnd(ScrollPosition position) => position.extentAfter < position.viewportDimension * 1.5;

/// The line under a list's search box. While a search, a filter or a return to the
/// screen reloads a list that is already showing, it becomes a thin progress bar, so
/// the old rows never pass for the new result. It is the same height either way, so
/// the rows below never move.
class ListProgressLine extends StatelessWidget {
  const ListProgressLine({super.key, required this.active});

  final bool active;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 2,
    child: active
        ? const LinearProgressIndicator(minHeight: 2, semanticsLabel: 'Updating the list')
        : const Align(alignment: Alignment.topCenter, child: Divider()),
  );
}

/// Grey rows in the list's own shape while its first page loads, so the screen has
/// its final layout at once and nothing jumps when the rows arrive. They pulse
/// gently, and hold still when the phone is set to remove animations.
class LoadingRows extends StatefulWidget {
  const LoadingRows({super.key, this.extent});

  /// Each row's height: the record list's own unless given.
  final double? extent;

  @override
  State<LoadingRows> createState() => _LoadingRowsState();
}

class _LoadingRowsState extends State<LoadingRows> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 900));
  late final Animation<double> _opacity = _pulse.drive(Tween<double>(begin: 1, end: 0.5).chain(CurveTween(curve: Curves.easeInOut)));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      // Setting the value also stops it.
      _pulse.value = 0;
    } else if (!_pulse.isAnimating) {
      unawaited(_pulse.repeat(reverse: true));
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final extent = widget.extent ?? recordRowExtent(context);
    final ground = Theme.of(context).colorScheme.surfaceContainerHighest;
    return Semantics(
      container: true,
      label: 'Loading',
      child: ExcludeSemantics(
        // One faded layer for the whole block: the rows themselves are never rebuilt.
        child: FadeTransition(
          opacity: _opacity,
          child: LayoutBuilder(
            builder: (context, constraints) => ListView.builder(
              physics: const NeverScrollableScrollPhysics(),
              padding: EdgeInsets.zero,
              itemExtent: extent,
              itemCount: constraints.maxHeight.isFinite ? (constraints.maxHeight / extent).ceil() : 8,
              itemBuilder: (_, index) => _PlaceholderRow(ground: ground, width: _placeholderWidths[index % _placeholderWidths.length]),
            ),
          ),
        ),
      ),
    );
  }
}

/// How much of the line each placeholder's first bar takes, so the rows don't look stamped out.
const _placeholderWidths = [0.72, 0.5, 0.64, 0.42, 0.58];

class _PlaceholderRow extends StatelessWidget {
  const _PlaceholderRow({required this.ground, required this.width});

  final Color ground;
  final double width;

  @override
  Widget build(BuildContext context) {
    final bar = BoxDecoration(color: ground, borderRadius: BorderRadius.circular(4));
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Gap.m),
      child: Row(
        children: [
          DecoratedBox(
            decoration: BoxDecoration(color: ground, shape: BoxShape.circle),
            child: const SizedBox.square(dimension: 44),
          ),
          const SizedBox(width: Gap.m),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FractionallySizedBox(
                  widthFactor: width,
                  child: DecoratedBox(decoration: bar, child: const SizedBox(height: 12)),
                ),
                const SizedBox(height: Gap.s),
                FractionallySizedBox(
                  widthFactor: width * 0.6,
                  child: DecoratedBox(decoration: bar, child: const SizedBox(height: 10)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
