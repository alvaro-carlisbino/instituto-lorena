import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lorena_core/lorena_core.dart';

/// A tela que justifica o app existir: o paciente pagou dezenas de milhares e
/// hoje não tem lugar nenhum para ver o que foi feito nele.
class TelaCirurgia extends StatelessWidget {
  const TelaCirurgia({super.key});

  @override
  Widget build(BuildContext context) {
    return Carrega<List<Cirurgia>>(
      buscar: LorenaApi.instance.pacienteCirurgias,
      temConteudo: (l) => l.isNotEmpty,
      vazio: const MensagemVazia(
        icone: Icons.event_available_outlined,
        titulo: 'Ainda não há cirurgia registrada',
        descricao: 'Assim que seu procedimento acontecer, o resultado aparece aqui: '
            'número de folículos, áreas tratadas e a linha do tempo do dia.',
      ),
      constroi: (context, cirurgias, _) => ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        itemCount: cirurgias.length,
        separatorBuilder: (_, __) => const SizedBox(height: 28),
        itemBuilder: (_, i) => _CartaoCirurgia(cirurgias[i]),
      ),
    );
  }
}

class _CartaoCirurgia extends StatelessWidget {
  const _CartaoCirurgia(this.c);
  final Cirurgia c;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final fmt = DateFormat("d 'de' MMMM 'de' y", 'pt_BR');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(c.dia == null ? 'Cirurgia' : fmt.format(c.dia!),
            style: tt.titleLarge?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.4)),
        const SizedBox(height: 2),
        Text(
          c.finalizada ? 'Procedimento concluído' : 'Em andamento',
          style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
        ),
        const SizedBox(height: 16),

        // Número grande: é a resposta da pergunta que todo paciente faz.
        Card(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
            child: Column(
              children: [
                Text('${c.totalImplantados}',
                    style: tt.displaySmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      color: cs.primary,
                      letterSpacing: -1.5,
                    )),
                Text('folículos implantados',
                    style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant)),
                if (c.duracao != null) ...[
                  const SizedBox(height: 14),
                  Text(_duracaoLegivel(c.duracao!),
                      style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                ],
              ],
            ),
          ),
        ),

        if (c.areas.isNotEmpty) ...[
          const SizedBox(height: 20),
          CartaoSecao(
            titulo: 'ONDE FOI IMPLANTADO',
            filho: Column(
              children: [
                for (final a in c.areas.where((a) => a.implantados > 0))
                  _LinhaArea(area: a, maximo: _maiorArea(c)),
              ],
            ),
          ),
        ],

        if (c.etapas.isNotEmpty) ...[
          const SizedBox(height: 20),
          CartaoSecao(
            titulo: 'COMO FOI O SEU DIA',
            filho: _LinhaDoTempo(c.etapas),
          ),
        ],
      ],
    );
  }

  int _maiorArea(Cirurgia c) =>
      c.areas.fold<int>(1, (max, a) => a.implantados > max ? a.implantados : max);

  String _duracaoLegivel(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60);
    if (h == 0) return 'Procedimento de $m minutos';
    return 'Procedimento de ${h}h${m.toString().padLeft(2, '0')}';
  }
}

class _LinhaArea extends StatelessWidget {
  const _LinhaArea({required this.area, required this.maximo});
  final AreaResultado area;
  final int maximo;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(area.area, style: tt.bodyMedium)),
              Text('${area.implantados}',
                  style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: maximo == 0 ? 0 : area.implantados / maximo,
              minHeight: 8,
              backgroundColor: cs.surfaceContainerHighest,
            ),
          ),
        ],
      ),
    );
  }
}

class _LinhaDoTempo extends StatelessWidget {
  const _LinhaDoTempo(this.etapas);
  final List<EtapaCirurgia> etapas;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final hora = DateFormat('HH:mm');

    // O banco grava INICIO e CONCLUIDO separados; o paciente só quer ver a
    // etapa e quando ela começou.
    final inicios = etapas.where((e) => e.tipo == 'INICIO' && e.horario != null).toList();
    final itens = inicios.isNotEmpty ? inicios : etapas.where((e) => e.horario != null).toList();

    return Column(
      children: [
        for (var i = 0; i < itens.length; i++)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: 52,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: Text(hora.format(itens[i].horario!),
                        style: tt.bodySmall?.copyWith(
                          color: cs.onSurfaceVariant,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        )),
                  ),
                ),
                Column(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      margin: const EdgeInsets.only(top: 4),
                      decoration: BoxDecoration(color: cs.primary, shape: BoxShape.circle),
                    ),
                    if (i < itens.length - 1)
                      Expanded(child: Container(width: 2, color: cs.outlineVariant)),
                  ],
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(bottom: i < itens.length - 1 ? 18 : 0),
                    child: Text(itens[i].rotulo,
                        style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
