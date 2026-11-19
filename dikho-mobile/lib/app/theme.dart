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
  final scheme = ColorScheme.fromSeed(seedColor: DikhoColors.brand, brightness: brightness).copyWith(
    primary: dark ? DikhoColors.brandInk : DikhoColors.brand,
    surface: dark ? DikhoColors.surfaceDark : DikhoColors.surfaceLight,
    onSurface: dark ? DikhoColors.textDark : DikhoColors.textLight,
    onSurfaceVariant: dark ? DikhoColors.mutedDark : DikhoColors.mutedLight,
    error: dark ? const Color(0xFFD9534F) : DikhoColors.danger,
  );
  final line = dark ? const Color(0xFF34373B) : const Color(0xFFE3E5E8);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme.copyWith(outlineVariant: line),
    scaffoldBackgroundColor: scheme.surface,
    dividerTheme: DividerThemeData(color: line, thickness: 1, space: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      foregroundColor: scheme.onSurface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleSpacing: 4,
      titleTextStyle: TextStyle(color: scheme.onSurface, fontSize: 18, fontWeight: FontWeight.w500),
      shape: Border(bottom: BorderSide(color: line)),
    ),
    drawerTheme: DrawerThemeData(backgroundColor: scheme.surface, surfaceTintColor: Colors.transparent, elevation: 1),
    navigationDrawerTheme: NavigationDrawerThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: dark ? const Color(0xFF233A52) : const Color(0xFFEAF1FA),
      tileHeight: 48,
      labelTextStyle: WidgetStatePropertyAll(TextStyle(color: scheme.onSurface, fontSize: 14, fontWeight: FontWeight.w500)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: scheme.primary, width: 1.5),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size(48, 48))),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(minimumSize: const Size(48, 48))),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(minimumSize: const Size(48, 48), tapTargetSize: MaterialTapTargetSize.padded),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
  );
}
