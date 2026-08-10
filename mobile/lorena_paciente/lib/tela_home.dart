import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';

import 'tela_cirurgia.dart';
import 'tela_consultas.dart';
import 'tela_cuidados.dart';
import 'tela_fotos.dart';
import 'tela_inicio.dart';

class TelaHome extends StatefulWidget {
  const TelaHome({super.key});

  @override
  State<TelaHome> createState() => _TelaHomeState();
}

class _TelaHomeState extends State<TelaHome> {
  int _aba = 0;

  static const _titulos = ['Início', 'Minha cirurgia', 'Minha evolução', 'Consultas'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_titulos[_aba]),
        actions: [
          IconButton(
            tooltip: 'Conta',
            icon: const Icon(Icons.account_circle_outlined),
            onPressed: _abrirConta,
          ),
        ],
      ),
      body: IndexedStack(
        index: _aba,
        children: const [
          TelaInicio(),
          TelaCirurgia(),
          TelaFotos(),
          TelaConsultas(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _aba,
        onDestinationSelected: (i) => setState(() => _aba = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Início'),
          NavigationDestination(icon: Icon(Icons.insights_outlined), selectedIcon: Icon(Icons.insights_rounded), label: 'Cirurgia'),
          NavigationDestination(icon: Icon(Icons.photo_library_outlined), selectedIcon: Icon(Icons.photo_library_rounded), label: 'Evolução'),
          NavigationDestination(icon: Icon(Icons.event_outlined), selectedIcon: Icon(Icons.event_rounded), label: 'Consultas'),
        ],
      ),
    );
  }

  Future<void> _abrirConta() async {
    final me = await LorenaApi.instance.pacienteEu();
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(me?['nome']?.toString() ?? 'Paciente'),
              subtitle: Text('Prontuário ${me?['prontuario'] ?? '—'}'),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.health_and_safety_outlined),
              title: const Text('Cuidados pós-operatórios'),
              onTap: () {
                Navigator.pop(ctx);
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const TelaCuidados()),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.logout_rounded),
              title: const Text('Sair'),
              onTap: () async {
                Navigator.pop(ctx);
                await LorenaApi.instance.sair();
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
