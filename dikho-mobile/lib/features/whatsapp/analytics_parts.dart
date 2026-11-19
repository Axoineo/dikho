import 'package:flutter/material.dart';

import '../../shared/values.dart';
import '../inbox/chat_theme.dart';
import 'analytics_charts.dart';
import 'analytics_models.dart';

/// Pieces the dashboard and the campaign screen share.

class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.title, this.subtitle, this.action, this.footnote, required this.child});

  final String title;
  final String? subtitle;
  final Widget? action;
  final String? footnote;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card.outlined(
      margin: const EdgeInsets.only(bottom: Gap.m),
      child: Padding(
        padding: const EdgeInsets.all(Gap.l),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Semantics(header: true, child: Text(title, style: theme.textTheme.titleSmall)),
                      if (subtitle != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(subtitle!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                        ),
                    ],
                  ),
                ),
                if (action != null) ...[const SizedBox(width: Gap.s), action!],
              ],
            ),
            const SizedBox(height: Gap.m),
            child,
            if (footnote != null)
              Padding(
                padding: const EdgeInsets.only(top: Gap.s),
                child: Text(footnote!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ),
          ],
        ),
      ),
    );
  }
}

/// A line of muted text where a chart or list would be.
class QuietText extends StatelessWidget {
  const QuietText(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: Gap.m),
    child: Center(
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
      ),
    ),
  );
}

Color _goodInk(BuildContext context) => Theme.of(context).brightness == Brightness.dark ? const Color(0xFF6FD3A0) : const Color(0xFF23704A);
Color _warnInk(BuildContext context) => Theme.of(context).brightness == Brightness.dark ? const Color(0xFFF2C46B) : const Color(0xFF8A5A0B);
Color _badInk(BuildContext context) => Theme.of(context).brightness == Brightness.dark ? const Color(0xFFF19A9E) : const Color(0xFFA3343B);

/// "↑ 12% vs previous 30 days": green when better, red when worse, with the words for
/// screen readers so colour never carries it alone.
class ChangeText extends StatelessWidget {
  const ChangeText({super.key, required this.change, this.period});

  final Change change;
  final String? period;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = switch (change.tone) {
      ChangeTone.good => _goodInk(context),
      ChangeTone.bad => _badInk(context),
      ChangeTone.neutral => theme.colorScheme.onSurfaceVariant,
    };
    final arrow = change.up == null ? '' : (change.up! ? '↑ ' : '↓ ');
    final spoken = [
      if (change.up != null) change.up! ? 'up' : 'down',
      change.text,
      if (period != null) 'versus $period',
      if (change.tone == ChangeTone.good) 'better',
      if (change.tone == ChangeTone.bad) 'worse',
    ].join(' ');
    return Semantics(
      label: spoken,
      excludeSemantics: true,
      child: Text.rich(
        TextSpan(
          text: '$arrow${change.text}',
          style: TextStyle(color: color),
          children: [
            if (period != null)
              TextSpan(
                text: ' vs $period',
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
              ),
          ],
        ),
        style: theme.textTheme.bodySmall,
      ),
    );
  }
}

class KpiTile extends StatelessWidget {
  const KpiTile({super.key, required this.label, required this.value, this.sub, this.change, this.period});

  final String label;
  final String value;
  final String? sub;
  final Change? change;
  final String? period;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    return MergeSemantics(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: Gap.m, vertical: Gap.m - 2),
        decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(10)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: muted),
            const SizedBox(height: 2),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w500, fontFeatures: const [FontFeature.tabularFigures()]),
            ),
            if (sub != null) Text(sub!, style: muted),
            if (change != null) ChangeText(change: change!, period: period),
          ],
        ),
      ),
    );
  }
}

/// Tiles two to a row on a phone, more on a tablet.
class KpiGrid extends StatelessWidget {
  const KpiGrid({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final columns = constraints.maxWidth >= 840
          ? 4
          : constraints.maxWidth >= 560
          ? 3
          : 2;
      final width = (constraints.maxWidth - Gap.s * (columns - 1)) / columns;
      return Wrap(
        spacing: Gap.s,
        runSpacing: Gap.s,
        children: [for (final child in children) SizedBox(width: width, child: child)],
      );
    },
  );
}

/// Meta's quality as an icon and a word, never colour alone.
class QualityText extends StatelessWidget {
  const QualityText(this.value, {super.key});

  final String? value;

  @override
  Widget build(BuildContext context) {
    final q = qualityOf(value);
    final color = switch (q.tone) {
      QualityTone.good => _goodInk(context),
      QualityTone.warn => _warnInk(context),
      QualityTone.bad => _badInk(context),
      QualityTone.neutral => Theme.of(context).colorScheme.onSurfaceVariant,
    };
    final icon = switch (q.tone) {
      QualityTone.good => Icons.check,
      QualityTone.warn || QualityTone.bad => Icons.warning_amber_rounded,
      QualityTone.neutral => null,
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[Icon(icon, size: 14, color: color), const SizedBox(width: 3)],
        Text(q.label, style: TextStyle(color: color, fontSize: 13)),
      ],
    );
  }
}

/// Each step against the one before it (or against step [of]).
class Funnel extends StatelessWidget {
  const Funnel({super.key, required this.steps, this.style = 'en-IN'});

  final List<({String label, int value, int? of})> steps;
  final String style;

  @override
  Widget build(BuildContext context) => BarList(
    max: steps.isEmpty || steps.first.value == 0 ? 1 : steps.first.value,
    items: [
      for (var i = 0; i < steps.length; i++)
        (
          label: steps[i].label,
          value: steps[i].value,
          text: formatCount(steps[i].value, style: style),
          note: i == 0
              ? null
              : '${formatPercent(rate(steps[i].value, steps[steps[i].of ?? i - 1].value))} of ${steps[steps[i].of ?? i - 1].label.toLowerCase()}',
        ),
    ],
  );
}

/// Label on the left, value on the right, a hairline between rows.
class FactRow extends StatelessWidget {
  const FactRow({super.key, required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return MergeSemantics(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: Gap.s + 1),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: theme.colorScheme.outlineVariant.withValues(alpha: 0.5))),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(label, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            ),
            const SizedBox(width: Gap.m),
            Flexible(
              child: Align(
                alignment: Alignment.centerRight,
                child: DefaultTextStyle.merge(textAlign: TextAlign.right, child: child),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Chart or table, for the cards that offer both.
class ViewToggle extends StatelessWidget {
  const ViewToggle({super.key, required this.table, required this.onChanged});

  final bool table;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => SegmentedButton<bool>(
    showSelectedIcon: false,
    style: const ButtonStyle(visualDensity: VisualDensity.compact, tapTargetSize: MaterialTapTargetSize.padded),
    segments: const [
      ButtonSegment(value: false, label: Text('Chart')),
      ButtonSegment(value: true, label: Text('Table')),
    ],
    selected: {table},
    onSelectionChanged: (value) => onChanged(value.first),
  );
}

/// Quick-reply taps (from our records) and link taps (from Meta's template insights).
/// Links show only while insights answer, so switching them on in Meta needs no change
/// here.
class TapLists extends StatelessWidget {
  const TapLists({super.key, required this.replies, required this.links, this.style = 'en-IN', this.linkTitle = 'Links'});

  final List<ButtonTaps> replies;

  /// Null when Meta's template insights did not answer: the Links part is then hidden.
  final List<ButtonTaps>? links;
  final String style;
  final String linkTitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    Widget list(List<ButtonTaps> items) => BarList(
      items: [
        for (final b in items)
          (
            label: b.template == null ? b.label : '${b.label}\n${b.template}',
            value: b.count,
            text: formatCount(b.count, style: style),
            note: b.people == null ? null : 'by ${formatCount(b.people!, style: style)} ${b.people == 1 ? 'person' : 'people'}',
          ),
      ],
    );
    Widget heading(String text) => Padding(
      padding: const EdgeInsets.only(bottom: Gap.s),
      child: Semantics(header: true, child: Text(text, style: theme.textTheme.labelLarge)),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        heading('Quick replies'),
        if (replies.isEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: Gap.m),
            child: Text('No quick-reply taps.', style: muted),
          )
        else
          list(replies),
        if (links != null) ...[heading(linkTitle), if (links!.isEmpty) Text('No link taps.', style: muted) else list(links!)],
      ],
    );
  }
}
