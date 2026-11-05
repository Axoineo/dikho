import 'package:flutter/material.dart';

/// The web CRM's tokens (src/index.css), so native screens read as the same
/// product. The two grounds are --surface in each theme.
class DikhoColors {
  const DikhoColors._();

  static const brand = Color(0xFF185494);
  static const brandInk = Color(0xFF8FC2F0);
  static const accent = Color(0xFFF9AF1B);
  static const danger = Color(0xFFB23B43);
  static const surfaceLight = Color(0xFFFFFFFF);
  static const surfaceDark = Color(0xFF1B1C1E);
  static const textLight = Color(0xFF1E2329);
  static const textDark = Color(0xFFE7E8EA);
  static const mutedLight = Color(0xFF5C626C);
  static const mutedDark = Color(0xFF9DA1A8);
}

ThemeData dikhoTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme =
      ColorScheme.fromSeed(
        seedColor: DikhoColors.brand,
        brightness: brightness,
      ).copyWith(
        primary: dark ? DikhoColors.brandInk : DikhoColors.brand,
        surface: dark ? DikhoColors.surfaceDark : DikhoColors.surfaceLight,
        onSurface: dark ? DikhoColors.textDark : DikhoColors.textLight,
        onSurfaceVariant: dark ? DikhoColors.mutedDark : DikhoColors.mutedLight,
        error: dark ? const Color(0xFFD9534F) : DikhoColors.danger,
      );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    dialogTheme: DialogThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
  );
}
