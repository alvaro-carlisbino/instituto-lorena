import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';

import '../publico/comum.dart';
import 'tela_cirurgia.dart';
import 'tela_consultas.dart';
import 'tela_cuidados.dart';
import 'tela_fotos.dart';
import 'tela_resumo.dart';

/// Área do paciente. Fora do login, mostra o convite; dentro, o painel.
/// O login vive aqui e não na abertura do app: quem baixa ainda não é
/// paciente na maioria das vezes.
class TelaMinhaArea extends StatefulWidget {
  const TelaMinhaArea({super.key});

  @override
  State<TelaMinhaArea> createState() => _TelaMinhaAreaState();
}

class _TelaMinhaAreaState extends State<TelaMinhaArea> {
  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AuthState>(
      stream: LorenaApi.instance.mudancasDeAuth,
      builder: (context, _) {
        if (!LorenaApi.instance.logado) return const _Convite();
        return const _PainelPaciente();
      },
    );
  }
}

class _Convite extends StatelessWidget {
  const _Convite();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 32, 20, 40),
        children: [
          const Center(child: MarcaLorena(altura: 52)),
          const SizedBox(height: 24),
          Text('Sua área de paciente', style: tt.headlineMedium, textAlign: TextAlign.center),
          const SizedBox(height: 10),
          Text(
            'Aqui ficam suas consultas, o resultado da sua cirurgia e a sua '
            'evolução em fotos.',
            textAlign: TextAlign.center,
            style: tt.bodyLarge?.copyWith(color: cs.onSurfaceVariant, height: 1.5),
          ),
          const SizedBox(height: 30),
          for (final (icone, texto) in const [
            (Icons.event_rounded, 'Suas consultas e o histórico de atendimento'),
            (Icons.insights_rounded, 'Quantos folículos foram implantados, e onde'),
            (Icons.photo_library_rounded, 'Suas fotos lado a lado, marco a marco'),
            (Icons.health_and_safety_rounded, 'Os cuidados do pós-operatório'),
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Row(
                children: [
                  Icon(icone, size: 20, color: cs.primary),
                  const SizedBox(width: 14),
                  Expanded(child: Text(texto, style: tt.bodyMedium?.copyWith(height: 1.4))),
                ],
              ),
            ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => TelaLoginCodigo(
                  brand: AppBrand.paciente,
                  aoEntrar: () => Navigator.of(context).pop(),
                ),
              ),
            ),
            child: const Text('Entrar com meu CPF'),
          ),
          const SizedBox(height: 12),
          Text(
            'Só quem já é paciente da clínica consegue entrar. Ainda não é? '
            'Comece pela avaliação.',
            textAlign: TextAlign.center,
            style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant, height: 1.4),
          ),
          const SizedBox(height: 14),
          const BotaoWhatsapp(
            rotulo: 'Agendar avaliação',
            mensagem: 'Oi! Vim pelo app e quero agendar uma avaliação.',
            tonal: true,
          ),
        ],
      ),
    );
  }
}

class _PainelPaciente extends StatefulWidget {
  const _PainelPaciente();

  @override
  State<_PainelPaciente> createState() => _PainelPacienteState();
}

class _PainelPacienteState extends State<_PainelPaciente> {
  int _aba = 0;
  static const _titulos = ['Meu acompanhamento', 'Minha cirurgia', 'Minha evolução', 'Consultas'];

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
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(46),
          child: SizedBox(
            height: 46,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                for (var i = 0; i < _titulos.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(['Resumo', 'Cirurgia', 'Evolução', 'Consultas'][i]),
                      selected: _aba == i,
                      onSelected: (_) => setState(() => _aba = i),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
      body: IndexedStack(
        index: _aba,
        children: const [TelaResumo(), TelaCirurgia(), TelaFotos(), TelaConsultas()],
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
              leading: const Icon(Icons.chat_bubble_outline_rounded),
              title: const Text('Falar com a clínica'),
              onTap: () {
                Navigator.pop(ctx);
                abrirWhatsapp(mensagem: 'Oi! Sou paciente e estou falando pelo app.');
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
