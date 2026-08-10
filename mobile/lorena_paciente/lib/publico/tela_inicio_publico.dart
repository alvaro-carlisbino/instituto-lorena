import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';

import '../conteudo.dart';
import '../tela_shell.dart';
import 'comum.dart';
import 'tela_servicos.dart';

/// Vitrine da clínica. É a primeira tela de quem ainda não é paciente, então
/// ela precisa responder três coisas antes de pedir qualquer dado: o que
/// fazemos, por que aqui, e como falar com a gente.
class TelaInicioPublico extends StatelessWidget {
  const TelaInicioPublico({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return CustomScrollView(
      slivers: [
        SliverToBoxAdapter(child: _Hero()),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 32, 20, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const TituloSecao('O que fazemos', apoio: 'Tratamentos'),
                const SizedBox(height: 18),
                for (final s in servicos.take(4)) ...[
                  _CartaoServico(servico: s),
                  const SizedBox(height: 10),
                ],
                const SizedBox(height: 6),
                OutlinedButton(
                  onPressed: () => TelaShell.irParaAba(context, 1),
                  child: const Text('Ver todos os tratamentos'),
                ),

                const SizedBox(height: 44),
                const TituloSecao('Por que aqui', apoio: 'Nosso jeito'),
                const SizedBox(height: 18),
                for (final (icone, titulo, texto) in Clinica.diferenciais)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 20),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(11),
                          decoration: BoxDecoration(
                            color: cs.primaryContainer,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Icon(icone, size: 20, color: cs.onPrimaryContainer),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(titulo, style: tt.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                              const SizedBox(height: 3),
                              Text(texto,
                                  style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant, height: 1.45)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),

                const SizedBox(height: 24),
                const TituloSecao('Perguntas que sempre chegam', apoio: 'Dúvidas'),
                const SizedBox(height: 14),
                Card(
                  child: Column(
                    children: [
                      for (var i = 0; i < faq.length; i++) ...[
                        if (i > 0) const Divider(height: 1),
                        Theme(
                          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                          child: ExpansionTile(
                            tilePadding: const EdgeInsets.symmetric(horizontal: 18),
                            childrenPadding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
                            title: Text(faq[i].pergunta,
                                style: tt.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                            children: [
                              Align(
                                alignment: Alignment.centerLeft,
                                child: Text(faq[i].resposta,
                                    style: tt.bodyMedium?.copyWith(
                                        color: cs.onSurfaceVariant, height: 1.5)),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),

                const SizedBox(height: 40),
                _ChamadaFinal(),
                const SizedBox(height: 40),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _Hero extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final escuro = Theme.of(context).brightness == Brightness.dark;

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: escuro
              ? [cs.surfaceContainerHigh, cs.surface]
              : [cs.primaryContainer, cs.surfaceContainerLow],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 28, 20, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const MarcaLorena(tamanho: 40),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Instituto Lorena',
                            style: tt.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                        Text('Visentainer',
                            style: tt.bodySmall?.copyWith(
                                color: cs.onSurfaceVariant, letterSpacing: 2.4)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 34),
              Text(
                'Seu cabelo\nde volta ao lugar.',
                style: tt.displaySmall?.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 14),
              Text(
                'Transplante capilar e tratamento clínico em Maringá, com '
                'diagnóstico antes da cirurgia e acompanhamento até o resultado.',
                style: tt.bodyLarge?.copyWith(color: cs.onSurfaceVariant, height: 1.5),
              ),
              const SizedBox(height: 26),
              const BotaoWhatsapp(
                rotulo: 'Agendar avaliação',
                mensagem: 'Oi! Vim pelo app e quero agendar uma avaliação.',
              ),
              const SizedBox(height: 10),
              OutlinedButton(
                onPressed: () => TelaShell.irParaMinhaArea(context),
                child: const Text('Já sou paciente'),
              ),
              const SizedBox(height: 30),
              const _FaixaNumeros(),
            ],
          ),
        ),
      ),
    );
  }
}

/// Números reais, puxados do servidor. Prova social chumbada no app envelhece
/// e vira mentira na loja.
class _FaixaNumeros extends StatelessWidget {
  const _FaixaNumeros();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final risco = Container(width: 1, height: 38, color: cs.outlineVariant);

    return FutureBuilder<({int cirurgias, int foliculos, int desdeAno})?>(
      future: LorenaApi.instance.clinicaNumeros(),
      builder: (context, snap) {
        final d = snap.data;
        // Sem internet, ou base ainda vazia: a home abre igual, só sem a faixa.
        if (d == null || d.cirurgias == 0) return const SizedBox.shrink();
        return Row(
          children: [
            Expanded(child: _Numero('${d.cirurgias}', 'cirurgias\nrealizadas')),
            risco,
            Expanded(child: _Numero('${(d.foliculos / 1000).round()} mil', 'folículos\nimplantados')),
            risco,
            Expanded(child: _Numero('${d.desdeAno}', 'desde')),
          ],
        );
      },
    );
  }
}

class _Numero extends StatelessWidget {
  const _Numero(this.valor, this.rotulo);
  final String valor;
  final String rotulo;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;
    return Column(
      children: [
        Text(valor, style: tt.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 2),
        Text(rotulo,
            textAlign: TextAlign.center,
            style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant, height: 1.25)),
      ],
    );
  }
}

class _CartaoServico extends StatelessWidget {
  const _CartaoServico({required this.servico});
  final Servico servico;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => TelaServicoDetalhe(servico: servico)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(11),
                decoration: BoxDecoration(
                  color: cs.secondaryContainer,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(servico.icone, size: 21, color: cs.onSecondaryContainer),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(servico.nome,
                        style: tt.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(servico.resumo,
                        style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant, height: 1.4)),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: cs.outline),
            ],
          ),
        ),
      ),
    );
  }
}

class _ChamadaFinal extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: cs.inverseSurface,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Comece pela avaliação',
              style: tt.headlineSmall?.copyWith(color: cs.onInverseSurface)),
          const SizedBox(height: 8),
          Text(
            'É nela que a gente descobre a causa da sua queda e diz, com '
            'honestidade, se o transplante é o seu caminho ou não.',
            style: tt.bodyMedium?.copyWith(
                color: cs.onInverseSurface.withValues(alpha: 0.82), height: 1.5),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: cs.inversePrimary,
              foregroundColor: cs.onPrimaryContainer,
            ),
            onPressed: () => abrirWhatsapp(
              mensagem: 'Oi! Vim pelo app e quero agendar uma avaliação.',
            ),
            icon: const Icon(Icons.chat_bubble_rounded, size: 20),
            label: const Text('Falar com a clínica'),
          ),
        ],
      ),
    );
  }
}
