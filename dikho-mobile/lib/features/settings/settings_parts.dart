import 'package:flutter/material.dart';

import '../inbox/chat_theme.dart';

/// Pieces every Settings screen uses, as SettingsParts.jsx: a line on what the
/// screen is for, titled groups, the status line and the unsaved-changes bar.

/// What this screen changes, in one or two sentences under the app bar.
class SettingsIntro extends StatelessWidget {
  const SettingsIntro(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: Gap.l),
    child: Text(text, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
  );
}

/// A group's name (and note) in small type above its rows.
class SettingsGroup extends StatelessWidget {
  const SettingsGroup({super.key, this.title, this.description, required this.children});

  final String? title;
  final String? description;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (title != null)
            Semantics(
              header: true,
              child: Text(title!, style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary)),
            ),
          if (description != null)
            Padding(
              padding: const EdgeInsets.only(top: Gap.xs),
              child: Text(description!, style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant)),
            ),
          if (title != null || description != null) const SizedBox(height: Gap.m),
          ...children,
        ],
      ),
    );
  }
}

/// One line on what just happened; read out when it changes.
class StatusText extends StatelessWidget {
  const StatusText({super.key, required this.text, this.error = false});

  final String? text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: Gap.s),
        child: Text(text ?? '', style: TextStyle(color: error ? theme.colorScheme.error : theme.colorScheme.onSurfaceVariant)),
      ),
    );
  }
}

/// Shown only while a screen has changes that are not saved. On a phone the words sit
/// above the buttons, which keeps both buttons on one line; they move under each other
/// only when large text leaves no room.
class SaveBar extends StatelessWidget {
  const SaveBar({super.key, required this.busy, required this.onSave, required this.onCancel});

  final bool busy;
  final VoidCallback onSave;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surfaceContainerHigh,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Gap.l, Gap.m, Gap.l, Gap.m),
          child: Semantics(
            container: true,
            label: 'Unsaved changes',
            child: LayoutBuilder(
              builder: (context, box) {
                const words = Text('You have unsaved changes');
                final buttons = OverflowBar(
                  alignment: MainAxisAlignment.end,
                  overflowAlignment: OverflowBarAlignment.end,
                  spacing: Gap.s,
                  overflowSpacing: Gap.xs,
                  children: [
                    TextButton(onPressed: busy ? null : onCancel, child: const Text('Cancel')),
                    FilledButton(onPressed: busy ? null : onSave, child: Text(busy ? 'Saving…' : 'Save changes')),
                  ],
                );
                if (box.maxWidth >= 600) {
                  return Row(
                    children: [
                      const Expanded(child: words),
                      const SizedBox(width: Gap.s),
                      Flexible(child: buttons),
                    ],
                  );
                }
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    words,
                    const SizedBox(height: Gap.xs),
                    buttons,
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

/// The database has not had the Settings update yet.
class NotReadyNote extends StatelessWidget {
  const NotReadyNote({super.key});

  @override
  Widget build(BuildContext context) => const InfoNote(
    icon: Icons.info_outline,
    text: 'These settings need a database update that has not been applied yet. Everything else keeps working meanwhile.',
  );
}

class InfoNote extends StatelessWidget {
  const InfoNote({super.key, required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(Gap.m),
      decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: Gap.m),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}

/// "Discard your changes?" before leaving a screen with unsaved changes.
Future<bool> confirmDiscard(BuildContext context) async {
  final discard = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Discard your changes?'),
      content: const Text('What you changed here has not been saved.'),
      actions: [
        TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Keep editing')),
        FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Discard')),
      ],
    ),
  );
  return discard == true;
}
