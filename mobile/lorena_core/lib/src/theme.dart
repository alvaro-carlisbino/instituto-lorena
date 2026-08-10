import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'config.dart';

/// Tema dos apps. A paleta vem escrita à mão no AppBrand, não de
/// `ColorScheme.fromSeed`: seed entrega sempre a mesma cara de app genérico,
/// e marca de clínica não pode parecer template.
ThemeData lorenaTheme(AppBrand brand, Brightness brilho) {
  final scheme = brilho == Brightness.dark ? brand.escuro : brand.claro;

  // Fonte da marca empacotada (caso da clínica, que usa a Bould do site) ou
  // baixada do Google Fonts. O app precisa abrir igual sem rede, então marca
  // com fonte própria nunca depende de download.
  final base = ThemeData(brightness: brilho).textTheme;
  final baseTexto = brand.fonteEmpacotada
      ? base.apply(fontFamily: brand.fonteTexto)
      : GoogleFonts.getTextTheme(brand.fonteTexto, base);

  TextStyle fonte(String familia, double tam, FontWeight peso, double espaco, double altura) =>
      brand.fonteEmpacotada
          ? TextStyle(
              fontFamily: familia,
              fontSize: tam,
              fontWeight: peso,
              height: altura,
              letterSpacing: espaco,
              color: scheme.onSurface,
            )
          : GoogleFonts.getFont(
              familia,
              fontSize: tam,
              fontWeight: peso,
              height: altura,
              letterSpacing: espaco,
              color: scheme.onSurface,
            );

  TextStyle titulo(double tam, {FontWeight peso = FontWeight.w600, double espaco = -0.6}) =>
      fonte(brand.fonteTitulo, tam, peso, espaco, 1.14);

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
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: fonte(brand.fonteTexto, 16, FontWeight.w600, 0.1, 1.2),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        side: BorderSide(color: scheme.outline),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: fonte(brand.fonteTexto, 16, FontWeight.w600, 0, 1.2),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        textStyle: fonte(brand.fonteTexto, 15, FontWeight.w600, 0, 1.2),
      ),
    ),
    chipTheme: ChipThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
      side: BorderSide(color: scheme.outlineVariant),
      labelStyle: fonte(brand.fonteTexto, 13.5, FontWeight.w400, 0, 1.2),
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
        fonte(brand.fonteTexto, 12, FontWeight.w600, 0.2, 1.2),
      ),
    ),
    dividerTheme: DividerThemeData(color: scheme.outlineVariant, thickness: 1),
    listTileTheme: const ListTileThemeData(
      contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
    ),
  );
}
