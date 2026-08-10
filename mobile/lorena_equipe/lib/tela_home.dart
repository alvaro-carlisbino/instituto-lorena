import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';

import 'tela_agenda.dart';
import 'tela_cirurgia_hoje.dart';
import 'tela_fotos_equipe.dart';
import 'tela_ponto.dart';

class TelaHomeEquipe extends StatefulWidget {
  const TelaHomeEquipe({super.key});

  @override
  State<TelaHomeEquipe> createState() => _TelaHomeEquipeState();
}

class _TelaHomeEquipeState extends State<TelaHomeEquipe> {
  int _aba = 0;
  static const _titulos = ['Ponto', 'Agenda de hoje', 'Centro cirúrgico', 'Fotos do paciente'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_titulos[_aba]),
        actions: [
          IconButton(
            tooltip: 'Sair',
            icon: const Icon(Icons.logout_rounded),
            onPressed: () async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('Sair do app?'),
                  content: const Text('Você vai precisar entrar de novo com e-mail e senha.'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Ficar')),
                    FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sair')),
                  ],
                ),
              );
              if (ok == true) await LorenaApi.instance.sair();
            },
          ),
        ],
      ),
      body: IndexedStack(
        index: _aba,
        children: const [
          TelaPonto(),
          TelaAgenda(),
          TelaCirurgiaHoje(),
          TelaFotosEquipe(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _aba,
        onDestinationSelected: (i) => setState(() => _aba = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.fingerprint_rounded), label: 'Ponto'),
          NavigationDestination(icon: Icon(Icons.event_note_outlined), label: 'Agenda'),
          NavigationDestination(icon: Icon(Icons.monitor_heart_outlined), label: 'Cirurgia'),
          NavigationDestination(icon: Icon(Icons.photo_camera_outlined), label: 'Fotos'),
        ],
      ),
    );
  }
}
