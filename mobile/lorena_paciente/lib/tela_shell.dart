import 'package:flutter/material.dart';

import 'area/tela_minha_area.dart';
import 'publico/tela_clinica.dart';
import 'publico/tela_inicio_publico.dart';
import 'publico/tela_servicos.dart';

class TelaShell extends StatefulWidget {
  const TelaShell({super.key});

  @override
  State<TelaShell> createState() => TelaShellState();

  /// Deixa qualquer tela pública mandar o usuário para "Minha área" sem
  /// precisar de rota nomeada nem pacote de navegação.
  static void irParaAba(BuildContext context, int aba) {
    context.findAncestorStateOfType<TelaShellState>()?.abrirAba(aba);
  }

  static void irParaMinhaArea(BuildContext context) => irParaAba(context, 3);
}

class TelaShellState extends State<TelaShell> {
  int _aba = 0;

  void abrirAba(int i) => setState(() => _aba = i);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // Trava de largura: no tablet e no navegador o conteúdo esticava a linha
      // inteira e virava texto ilegível. Celular não muda nada (fica abaixo de
      // 560), e tablet passa a ler como coluna, não como faixa.
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: IndexedStack(
            index: _aba,
            children: const [
              TelaInicioPublico(),
              TelaServicos(),
              TelaClinica(),
              TelaMinhaArea(),
            ],
          ),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _aba,
        onDestinationSelected: abrirAba,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home_rounded),
            label: 'Início',
          ),
          NavigationDestination(
            icon: Icon(Icons.spa_outlined),
            selectedIcon: Icon(Icons.spa_rounded),
            label: 'Serviços',
          ),
          NavigationDestination(
            icon: Icon(Icons.location_on_outlined),
            selectedIcon: Icon(Icons.location_on_rounded),
            label: 'A clínica',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline_rounded),
            selectedIcon: Icon(Icons.person_rounded),
            label: 'Minha área',
          ),
        ],
      ),
    );
  }
}
