import 'package:flutter/material.dart';

/// Shown over the WebView when the CRM cannot load, so nobody ever sees the
/// browser's own error page.
class LoadFailureView extends StatelessWidget {
  const LoadFailureView({
    super.key,
    required this.title,
    required this.message,
    this.actionLabel = 'Try again',
    this.onAction,
  });

  final String title;
  final String message;
  final String actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ColoredBox(
      color: theme.colorScheme.surface,
      child: SizedBox.expand(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32),
          child: ConstrainedBox(
            constraints: BoxConstraints(
              minHeight: MediaQuery.sizeOf(context).height - 160,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Image.asset('assets/brand/mark.png', width: 72, height: 72),
                const SizedBox(height: 24),
                Text(
                  title,
                  style: theme.textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  message,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                ),
                if (onAction != null) ...[
                  const SizedBox(height: 24),
                  FilledButton(onPressed: onAction, child: Text(actionLabel)),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
