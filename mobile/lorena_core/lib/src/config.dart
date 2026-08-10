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
    required this.seed,
    required this.suporteWhatsapp,
    this.subtitulo,
  });

  final AppFlavor flavor;
  final String nome;
  final String? subtitulo;
  final Color seed;

  /// Número que a tela de "não recebi o código" oferece.
  final String suporteWhatsapp;

  static const paciente = AppBrand(
    flavor: AppFlavor.paciente,
    nome: 'Instituto Lorena',
    subtitulo: 'Seu acompanhamento capilar',
    seed: Color(0xFF6A4B3A),
    suporteWhatsapp: '5544999067665',
  );

  static const equipe = AppBrand(
    flavor: AppFlavor.equipe,
    nome: 'Lorena Equipe',
    subtitulo: 'Ponto, agenda e centro cirúrgico',
    seed: Color(0xFF1F5F5B),
    suporteWhatsapp: '5544999067665',
  );

  static const tricopill = AppBrand(
    flavor: AppFlavor.tricopill,
    nome: 'Tricopill',
    subtitulo: 'Seu tratamento, no seu ritmo',
    seed: Color(0xFF2E6B4F),
    suporteWhatsapp: '5544999067665',
  );
}
