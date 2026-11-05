import 'package:flutter/material.dart';

import 'update_controller.dart';
import 'update_info.dart';

/// Shows the update flow. Returns true when the user chose to put it off.
Future<bool> showUpdateDialog(
  BuildContext context,
  UpdateController controller,
) async {
  final later = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => UpdateDialog(controller: controller),
  );
  return later ?? true;
}

class UpdateDialog extends StatelessWidget {
  const UpdateDialog({super.key, required this.controller});

  final UpdateController controller;

  UpdateInfo get _info => controller.info;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) => PopScope(
        // Back never dismisses mid-download or a mandatory prompt.
        canPop: controller.phase == UpdatePhase.prompt && !_info.mandatory,
        child: switch (controller.phase) {
          UpdatePhase.prompt => _prompt(context),
          UpdatePhase.downloading => _downloading(context),
          UpdatePhase.verifying => _waiting(
            context,
            title: 'Checking the update',
            body: 'Making sure the download is complete and genuine.',
          ),
          UpdatePhase.needsPermission => _permission(context),
          UpdatePhase.installing => _waiting(
            context,
            // Android's own screen is on top by now. If it never appears, this
            // must not trap the person behind a dialog with no way out.
            closable: true,
            title: 'Installing the update',
            body:
                'Android will ask you to confirm. Google Play Protect may also '
                'offer to scan the app: choose "Scan app". Android then closes '
                'this app, so open Dikho CRM again afterwards. Your sign-in and '
                'data stay as they are.',
          ),
          UpdatePhase.failed => _failed(context),
        },
      ),
    );
  }

  Widget _prompt(BuildContext context) {
    final theme = Theme.of(context);
    return AlertDialog(
      title: const Text('New update available'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Dikho CRM v${_info.version}',
              style: theme.textTheme.titleSmall,
            ),
            if (_info.mandatory) ...[
              const SizedBox(height: 8),
              Text(
                'This version of the app is no longer supported. Please '
                'update to keep using the CRM.',
                style: theme.textTheme.bodyMedium,
              ),
            ],
            if (_info.releaseNotes.trim().isNotEmpty) ...[
              const SizedBox(height: 12),
              Text("What's new:", style: theme.textTheme.titleSmall),
              const SizedBox(height: 4),
              Text(_info.releaseNotes, style: theme.textTheme.bodyMedium),
            ],
            const SizedBox(height: 12),
            Text(
              '${_formatSize(_info.sizeBytes)} download',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
      actions: [
        if (!_info.mandatory)
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Later'),
          ),
        FilledButton(
          onPressed: controller.start,
          child: const Text('Update Now'),
        ),
      ],
    );
  }

  Widget _downloading(BuildContext context) {
    return AlertDialog(
      title: const Text('Downloading update'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Version ${_info.version}'),
          const SizedBox(height: 16),
          LinearProgressIndicator(value: controller.fraction),
          const SizedBox(height: 8),
          Text('${controller.percent}% downloaded'),
        ],
      ),
      actions: [
        TextButton(
          onPressed: controller.cancelDownload,
          child: const Text('Cancel'),
        ),
      ],
    );
  }

  Widget _waiting(
    BuildContext context, {
    required String title,
    required String body,
    bool closable = false,
  }) {
    return AlertDialog(
      actions: [
        if (closable)
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Close'),
          ),
      ],
      title: Text(title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(body),
          const SizedBox(height: 16),
          const LinearProgressIndicator(),
        ],
      ),
    );
  }

  Widget _permission(BuildContext context) {
    return AlertDialog(
      title: const Text('Allow Dikho CRM to install updates'),
      content: const Text(
        'Android asks for your permission before an app can install its own '
        'updates. Dikho CRM uses this only to update itself.\n\n'
        'On the next screen, turn on "Allow from this source", then come back '
        'to this app.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Not now'),
        ),
        FilledButton(
          onPressed: controller.openPermissionSettings,
          child: const Text('Open settings'),
        ),
      ],
    );
  }

  Widget _failed(BuildContext context) {
    final (title, body) = switch (controller.problem) {
      UpdateProblem.network => (
        'Download did not finish',
        'Check your connection and try again.',
      ),
      UpdateProblem.badFile => (
        'The download was damaged',
        'The file did not match the published release, so it was deleted '
            'and nothing was installed.',
      ),
      UpdateProblem.wrongSigner => (
        'This update was rejected',
        'The file was not signed by Dikho, so it was deleted and nothing '
            'was installed. Please tell your administrator.',
      ),
      UpdateProblem.storage => (
        'Not enough storage',
        'Free up some space on this phone and try again.',
      ),
      UpdateProblem.installCancelled => (
        'Update not installed',
        'The installation was cancelled. You can try again when you are '
            'ready.',
      ),
      _ => (
        'Update not installed',
        'Android could not install this update. Try again, or ask your '
            'administrator for help.',
      ),
    };
    return AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        // A failed mandatory update must not lock anyone out of their work:
        // it asks again at the next launch.
        TextButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(_info.mandatory ? 'Continue for now' : 'Later'),
        ),
        FilledButton(
          onPressed: controller.start,
          child: const Text('Try again'),
        ),
      ],
    );
  }
}

String _formatSize(int bytes) {
  final mb = bytes / (1024 * 1024);
  return '${mb.toStringAsFixed(mb < 10 ? 1 : 0)} MB';
}
