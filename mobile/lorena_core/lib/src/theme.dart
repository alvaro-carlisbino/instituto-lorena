import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'config.dart';

/// Tema dos apps. A paleta vem escrita à mão no AppBrand, não de
/// `ColorScheme.fromSeed`: seed entrega sempre a mesma cara de app genérico,
/// e marca de clínica não pode parecer template.
ThemeData lorenaTheme(AppBrand brand, Brightness brilho) {
  final scheme = brilho == Brightness.dark ? brand.escuro : brand.claro;
  final baseTexto = GoogleFonts.getTextTheme(
    brand.fonteTexto,
    ThemeData(brightness: brilho).textTheme,
  );

  TextStyle titulo(double tam, {FontWeight peso = FontWeight.w600, double espaco = -0.6}) =>
      GoogleFonts.getFont(
        brand.fonteTitulo,
        fontSize: tam,
        fontWeight: peso,
        height: 1.12,
        letterSpacing: espaco,
        color: scheme.onSurface,
      );

  final texto = baseTexto.copyWith(
    displayLarge: titulo(46, espaco: -1.4),
    displayMedium: titulo(38, espaco: -1.1),
    displaySmall: titulo(32, espaco: -0.9),
    headlineLarge: titulo(28),
    headlineMedium: titulo(24),
    headlineSmall: titulo(21),
    titleLarge: titulo(19, peso: FontWeight.w600, espaco: -0.3),
  ).apply(bodyColor: scheme.onSurface, displayColor: scheme.onSurface);

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    textTheme: texto,
    scaffoldBackgroundColor: scheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      foregroundColor: scheme.onSurface,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: texto.headlineSmall,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: scheme.surfaceContainerLowest,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: scheme.outlineVariant),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: GoogleFonts.getFont(brand.fonteTexto,
            fontSize: 16, fontWeight: FontWeight.w600, letterSpacing: 0.1),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        side: BorderSide(color: scheme.outline),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: GoogleFonts.getFont(brand.fonteTexto,
            fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        textStyle: GoogleFonts.getFont(brand.fonteTexto,
            fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    chipTheme: ChipThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
      side: BorderSide(color: scheme.outlineVariant),
      labelStyle: GoogleFonts.getFont(brand.fonteTexto, fontSize: 13.5),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surfaceContainerLow,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: scheme.primary, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 20),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: scheme.surfaceContainerLowest,
      indicatorColor: scheme.primaryContainer,
      elevation: 0,
      height: 68,
      labelTextStyle: WidgetStatePropertyAll(
        GoogleFonts.getFont(brand.fonteTexto, fontSize: 12, fontWeight: FontWeight.w600),
      ),
    ),
    dividerTheme: DividerThemeData(color: scheme.outlineVariant, thickness: 1),
    listTileTheme: const ListTileThemeData(
      contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    ),
  );
}
