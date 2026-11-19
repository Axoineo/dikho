import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

/// Asks for a permission at the moment it is needed, with the reason on screen,
/// never at startup. Once Android has stopped asking (the person chose "Don't allow"
/// twice), the only way back is the app's settings page, so this offers it.
Future<bool> ensurePermission(BuildContext context, Permission permission, {required String why}) async {
  final status = await permission.request();
  if (status.isGranted || status.isLimited) return true;
  if (status.isPermanentlyDenied && context.mounted) {
    final open = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Permission needed'),
        content: Text('$why Turn it on in the app\'s settings.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Not now')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: const Text('Open App Settings')),
        ],
      ),
    );
    if (open == true) await openAppSettings();
  }
  return false;
}
