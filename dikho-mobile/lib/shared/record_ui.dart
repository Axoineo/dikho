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
