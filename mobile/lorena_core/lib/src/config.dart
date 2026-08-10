import 'package:flutter/material.dart';

/// Os três apps saem deste mesmo código. O que muda é o flavor: marca, cores,
/// quem faz login e quais telas existem. Um repo, três binários nas lojas.
enum AppFlavor { paciente, equipe, tricopill }

class SupabaseConfig {
  /// A chave anon é pública por definição (já vai no bundle do CRM web).
  /// Dá para sobrescrever no build com --dart-define, mas não precisa.
  static const url = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://fgyfpmnvlkmyxtucbxbu.supabase.co',
  );
  static const anonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZneWZwbW52bGtteXh0dWNieGJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDUzNzgsImV4cCI6MjA5MjAyMTM3OH0.p7bgCdk4IxDdOr55VWoslHKoYTjXkt810vpdxQk5Lyc',
  );

  static String fn(String name) => '$url/functions/v1/$name';
}

class AppBrand {
  const AppBrand({
    required this.flavor,
    required this.nome,
    required this.claro,
    required this.escuro,
    required this.suporteWhatsapp,
    required this.fonteTitulo,
    required this.fonteTexto,
    this.subtitulo,
    this.site,
  });

  final AppFlavor flavor;
  final String nome;
  final String? subtitulo;
  final String? site;

  /// Paletas escritas à mão. `ColorScheme.fromSeed` é prático mas entrega
  /// sempre a mesma cara de app genérico; marca de clínica não pode parecer
  /// template.
  final ColorScheme claro;
  final ColorScheme escuro;

  /// Número que a tela de "não recebi o código" e os CTAs usam.
  final String suporteWhatsapp;

  final String fonteTitulo;
  final String fonteTexto;

  // ---------------------------------------------------------------- clínica
  // Cobre queimado sobre creme. Quente, sóbrio, nada de azul de software.
  static const paciente = AppBrand(
    flavor: AppFlavor.paciente,
    nome: 'Instituto Lorena',
    subtitulo: 'Saúde capilar em Maringá',
    // TODO(Álvaro): trocar pelo WhatsApp OFICIAL da clínica. Nenhuma das duas
    // linhas em whatsapp_channel_instances tem phone_e164 preenchido, então
    // este número ainda é provisório.
    suporteWhatsapp: '5544999067665',
    fonteTitulo: 'Fraunces',
    fonteTexto: 'Inter',
    claro: ColorScheme(
      brightness: Brightness.light,
      primary: Color(0xFF9C5B31),
      onPrimary: Color(0xFFFFFFFF),
      primaryContainer: Color(0xFFF6E3D3),
      onPrimaryContainer: Color(0xFF3B1C08),
      secondary: Color(0xFF5F5145),
      onSecondary: Color(0xFFFFFFFF),
      secondaryContainer: Color(0xFFEDE0D4),
      onSecondaryContainer: Color(0xFF241A11),
      tertiary: Color(0xFF4F6152),
      onTertiary: Color(0xFFFFFFFF),
      tertiaryContainer: Color(0xFFD2E7D3),
      onTertiaryContainer: Color(0xFF0D1F11),
      error: Color(0xFFA03A2E),
      onError: Color(0xFFFFFFFF),
      errorContainer: Color(0xFFFBDAD5),
      onErrorContainer: Color(0xFF410E07),
      surface: Color(0xFFFCF8F4),
      onSurface: Color(0xFF221A14),
      surfaceContainerLowest: Color(0xFFFFFFFF),
      surfaceContainerLow: Color(0xFFF8F1EA),
      surfaceContainer: Color(0xFFF3EAE1),
      surfaceContainerHigh: Color(0xFFEDE3D9),
      surfaceContainerHighest: Color(0xFFE7DCD1),
      onSurfaceVariant: Color(0xFF6B5B4E),
      outline: Color(0xFFA08D7D),
      outlineVariant: Color(0xFFE1D3C6),
      inverseSurface: Color(0xFF382E27),
      onInverseSurface: Color(0xFFFBEFE6),
      inversePrimary: Color(0xFFF0B78C),
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
    ),
    escuro: ColorScheme(
      brightness: Brightness.dark,
      primary: Color(0xFFF0B78C),
      onPrimary: Color(0xFF4F2707),
      primaryContainer: Color(0xFF6F3C1B),
      onPrimaryContainer: Color(0xFFFFDCC5),
      secondary: Color(0xFFD5C4B4),
      onSecondary: Color(0xFF3A2E24),
      secondaryContainer: Color(0xFF52443A),
      onSecondaryContainer: Color(0xFFF2E0D0),
      tertiary: Color(0xFFB6CBB7),
      onTertiary: Color(0xFF223425),
      tertiaryContainer: Color(0xFF384A3B),
      onTertiaryContainer: Color(0xFFD2E7D3),
      error: Color(0xFFFFB4A6),
      onError: Color(0xFF5F1409),
      errorContainer: Color(0xFF8C2E22),
      onErrorContainer: Color(0xFFFFDAD4),
      surface: Color(0xFF16110D),
      onSurface: Color(0xFFEDE0D6),
      surfaceContainerLowest: Color(0xFF100C09),
      surfaceContainerLow: Color(0xFF1E1712),
      surfaceContainer: Color(0xFF241C16),
      surfaceContainerHigh: Color(0xFF2F2620),
      surfaceContainerHighest: Color(0xFF3A302A),
      onSurfaceVariant: Color(0xFFBFAC9C),
      outline: Color(0xFF8A7868),
      outlineVariant: Color(0xFF443A32),
      inverseSurface: Color(0xFFEDE0D6),
      onInverseSurface: Color(0xFF382E27),
      inversePrimary: Color(0xFF9C5B31),
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
    ),
  );

  // ----------------------------------------------------------------- equipe
  // Verde profundo, mais "ferramenta" e menos vitrine: quem usa é a casa.
  static const equipe = AppBrand(
    flavor: AppFlavor.equipe,
    nome: 'Lorena Equipe',
    subtitulo: 'Ponto, agenda e centro cirúrgico',
    suporteWhatsapp: '5544999067665',
    fonteTitulo: 'Inter',
    fonteTexto: 'Inter',
    claro: ColorScheme(
      brightness: Brightness.light,
      primary: Color(0xFF1F5F5B),
      onPrimary: Color(0xFFFFFFFF),
      primaryContainer: Color(0xFFCDE9E5),
      onPrimaryContainer: Color(0xFF00201E),
      secondary: Color(0xFF4A6360),
      onSecondary: Color(0xFFFFFFFF),
      secondaryContainer: Color(0xFFCCE8E4),
      onSecondaryContainer: Color(0xFF051F1D),
      tertiary: Color(0xFF4B607C),
      onTertiary: Color(0xFFFFFFFF),
      tertiaryContainer: Color(0xFFD3E4FF),
      onTertiaryContainer: Color(0xFF041C35),
      error: Color(0xFFBA1A1A),
      onError: Color(0xFFFFFFFF),
      errorContainer: Color(0xFFFFDAD6),
      onErrorContainer: Color(0xFF410002),
      surface: Color(0xFFF7FAF9),
      onSurface: Color(0xFF171D1C),
      surfaceContainerLowest: Color(0xFFFFFFFF),
      surfaceContainerLow: Color(0xFFF1F5F4),
      surfaceContainer: Color(0xFFEBEFEE),
      surfaceContainerHigh: Color(0xFFE5EAE9),
      surfaceContainerHighest: Color(0xFFDFE4E3),
      onSurfaceVariant: Color(0xFF3F4947),
      outline: Color(0xFF6F7977),
      outlineVariant: Color(0xFFBEC9C6),
      inverseSurface: Color(0xFF2B3231),
      onInverseSurface: Color(0xFFECF2F0),
      inversePrimary: Color(0xFF9FD4CE),
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
    ),
    escuro: ColorScheme(
      brightness: Brightness.dark,
      primary: Color(0xFF9FD4CE),
      onPrimary: Color(0xFF003733),
      primaryContainer: Color(0xFF00504B),
      onPrimaryContainer: Color(0xFFBBF0EA),
      secondary: Color(0xFFB1CCC8),
      onSecondary: Color(0xFF1C3532),
      secondaryContainer: Color(0xFF334B48),
      onSecondaryContainer: Color(0xFFCCE8E4),
      tertiary: Color(0xFFB3C8E8),
      onTertiary: Color(0xFF1C314B),
      tertiaryContainer: Color(0xFF334863),
      onTertiaryContainer: Color(0xFFD3E4FF),
      error: Color(0xFFFFB4AB),
      onError: Color(0xFF690005),
      errorContainer: Color(0xFF93000A),
      onErrorContainer: Color(0xFFFFDAD6),
      surface: Color(0xFF0E1514),
      onSurface: Color(0xFFDFE4E3),
      surfaceContainerLowest: Color(0xFF090F0F),
      surfaceContainerLow: Color(0xFF171D1C),
      surfaceContainer: Color(0xFF1B2120),
      surfaceContainerHigh: Color(0xFF252C2B),
      surfaceContainerHighest: Color(0xFF303736),
      onSurfaceVariant: Color(0xFFBEC9C6),
      outline: Color(0xFF889391),
      outlineVariant: Color(0xFF3F4947),
      inverseSurface: Color(0xFFDFE4E3),
      onInverseSurface: Color(0xFF2B3231),
      inversePrimary: Color(0xFF1F5F5B),
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
    ),
  );

  // -------------------------------------------------------------- tricopill
  static const tricopill = AppBrand(
    flavor: AppFlavor.tricopill,
    nome: 'Tricopill',
    subtitulo: 'Seu tratamento, no seu ritmo',
    site: 'https://tricopill.com.br',
    suporteWhatsapp: '5544999067665',
    fonteTitulo: 'Inter',
    fonteTexto: 'Inter',
    claro: ColorScheme(
      brightness: Brightness.light,
      primary: Color(0xFF2E6B4F),
      onPrimary: Color(0xFFFFFFFF),
      primaryContainer: Color(0xFFB8F0CE),
      onPrimaryContainer: Color(0xFF002113),
      secondary: Color(0xFF4E6355),
      onSecondary: Color(0xFFFFFFFF),
      secondaryContainer: Color(0xFFD0E8D6),
      onSecondaryContainer: Color(0xFF0B1F14),
      tertiary: Color(0xFF3B6470),
      onTertiary: Color(0xFFFFFFFF),
      tertiaryContainer: Color(0xFFBFE9F8),
      onTertiaryContainer: Color(0xFF001F27),
      error: Color(0xFFBA1A1A),
      onError: Color(0xFFFFFFFF),
      errorContainer: Color(0xFFFFDAD6),
      onErrorContainer: Color(0xFF410002),
      surface: Color(0xFFF8FBF6),
      onSurface: Color(0xFF191C19),
      surfaceContainerLowest: Color(0xFFFFFFFF),
      surfaceContainerLow: Color(0xFFF2F6F1),
      surfaceContainer: Color(0xFFECF0EB),
      surfaceContainerHigh: Color(0xFFE6EAE5),
      surfaceContainerHighest: Color(0xFFE0E4DF),
      onSurfaceVariant: Color(0xFF414942),
      outline: Color(0xFF717972),
      outlineVariant: Color(0xFFC1C9C1),
      inverseSurface: Color(0xFF2E312E),
      onInverseSurface: Color(0xFFEFF2ED),
      inversePrimary: Color(0xFF9DD4B3),
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
    ),
    escuro: ColorScheme(
      brightness: Brightness.dark,
      primary: Color(0xFF9DD4B3),
      onPrimary: Color(0xFF003824),
      primaryContainer: Color(0xFF135136),
      onPrimaryContainer: Color(0xFFB8F0CE),
      secondary: Color(0xFFB4CCBA),
      onSecondary: Color(0xFF203528),
      secondaryContainer: Color(0xFF364B3E),
      onSecondaryContainer: Color(0xFFD0E8D6),
      tertiary: Color(0xFFA3CDDC),
      onTertiary: Color(0xFF033541),
      tertiaryContainer: Color(0xFF224C58),
      onTertiaryContainer: Color(0xFFBFE9F8),
      error: Color(0xFFFFB4AB),
      onError: Color(0xFF690005),
      errorContainer: Color(0xFF93000A),
      onErrorContainer: Color(0xFFFFDAD6),
      surface: Color(0xFF101410),
      onSurface: Color(0xFFE0E4DF),
      surfaceContainerLowest: Color(0xFF0B0F0B),
      surfaceContainerLow: Color(0xFF191C19),
      surfaceContainer: Color(0xFF1D211D),
      surfaceContainerHigh: Color(0xFF272B27),
      surfaceContainerHighest: Color(0xFF323632),
      onSurfaceVariant: Color(0xFFC1C9C1),
      outline: Color(0xFF8B938C),
      outlineVariant: Color(0xFF414942),
      inverseSurface: Color(0xFFE0E4DF),
      onInverseSurface: Color(0xFF2E312E),
      inversePrimary: Color(0xFF2E6B4F),
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
    ),
  );
}
