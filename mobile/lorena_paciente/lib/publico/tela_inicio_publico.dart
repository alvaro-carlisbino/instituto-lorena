import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';

import '../conteudo.dart';
import '../tela_shell.dart';
import 'comum.dart';
import 'tela_calculadora.dart';
import 'tela_servicos.dart';

/// Vitrine da clínica, na ordem que o site usa: quem somos pelo método, a
/// pergunta que todo mundo faz (quantos fios eu preciso), procedimentos, a
/// Dra. Lorena, depoimentos e contato.
class TelaInicioPublico extends StatelessWidget {
  const TelaInicioPublico({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return ListView(
      padding: EdgeInsets.zero,
      children: [
        const _Hero(),

        // ---- calculadora: é a isca do site, e aqui roda com dado da casa
        FaixaAreia(
          filho: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const TituloSecao(
                'Não sabe se o seu nível de calvície tem solução?',
                apoio: 'Escala de Norwood',
              ),
              const SizedBox(height: 12),
              Text(
                'Uma dúvida comum é se há indicação para o transplante, ou em que '
                'estágio de calvície a pessoa está. Pela calculadora você descobre, '
                'a partir das áreas com falha, quantas unidades foliculares seriam '
                'necessárias.',
                style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant, height: 1.55),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const TelaCalculadora()),
                ),
                icon: const Icon(Icons.calculate_outlined, size: 19),
                label: const Text('Conhecer a calculadora'),
              ),
            ],
          ),
        ),

        Padding(
          padding: const EdgeInsets.fromLTRB(20, 40, 20, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const TituloSecao('Procedimentos', apoio: 'O que fazemos'),
              const SizedBox(height: 20),
              for (final s in servicos) ...[
                _CartaoServico(servico: s),
                const SizedBox(height: 10),
              ],

              const SizedBox(height: 44),
              const TituloSecao('Sobre a Dra. Lorena', apoio: 'Direção clínica'),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(Dra.nome, style: tt.titleLarge),
                      const SizedBox(height: 2),
                      Text(Dra.registro,
                          style: tt.bodySmall?.copyWith(
                              color: cs.onSurfaceVariant, letterSpacing: 0.6)),
                      const SizedBox(height: 14),
                      Text(Dra.resumo,
                          style: tt.bodyMedium?.copyWith(height: 1.55)),
                      const SizedBox(height: 20),
                      _Credenciais('Autora de livros', Dra.livros, Icons.menu_book_outlined),
                      const SizedBox(height: 16),
                      _Credenciais('Formação', Dra.formacao, Icons.school_outlined),
                      const SizedBox(height: 16),
                      _Credenciais('Ensino', Dra.ensino, Icons.record_voice_over_outlined),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 44),
              const TituloSecao('Depoimentos', apoio: 'Quem passou por aqui'),
              const SizedBox(height: 16),
            ],
          ),
        ),

        SizedBox(
          height: 236,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            itemCount: depoimentos.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (_, i) => _CartaoDepoimento(depoimentos[i]),
          ),
        ),

        Padding(
          padding: const EdgeInsets.fromLTRB(20, 44, 20, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const TituloSecao('Perguntas frequentes', apoio: 'Dúvidas'),
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
                                      color: cs.onSurfaceVariant, height: 1.55)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 40),
            ],
          ),
        ),

        _ChamadaFinal(),
      ],
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return Container(
      width: double.infinity,
      color: cs.surface,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 36),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const MarcaLorena(altura: 46),
              const SizedBox(height: 38),
              Text('Transplante Capilar\nRegenerativo®', style: tt.displaySmall),
              const SizedBox(height: 16),
              Text(
                'Método exclusivo do Instituto: a técnica FUE somada, no '
                'intraoperatório, a um tratamento com células autólogas que regenera '
                'também os seus fios nativos.',
                style: tt.bodyLarge?.copyWith(color: cs.onSurfaceVariant, height: 1.55),
              ),
              const SizedBox(height: 28),
              const BotaoWhatsapp(
                rotulo: 'Agendar avaliação',
                mensagem: 'Oi! Vim pelo app e quero agendar uma avaliação.',
              ),
              const SizedBox(height: 10),
              OutlinedButton(
                onPressed: () => TelaShell.irParaMinhaArea(context),
                child: const Text('Já sou paciente'),
              ),
              const SizedBox(height: 34),
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

    return FutureBuilder<({int cirurgias, int foliculos, int desdeAno})?>(
      future: LorenaApi.instance.clinicaNumeros(),
      builder: (context, snap) {
        final d = snap.data;
        // Sem internet, ou base ainda vazia: a home abre igual, só sem a faixa.
        if (d == null || d.cirurgias == 0) return const SizedBox.shrink();
        return Row(
          children: [
            Expanded(child: _Numero('${d.cirurgias}', 'cirurgias\nrealizadas')),
            Container(width: 1, height: 40, color: cs.outlineVariant),
            Expanded(
                child: _Numero('${(d.foliculos / 1000).round()} mil', 'folículos\nimplantados')),
            Container(width: 1, height: 40, color: cs.outlineVariant),
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
        Text(valor, style: tt.headlineSmall),
        const SizedBox(height: 3),
        Text(rotulo,
            textAlign: TextAlign.center,
            style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant, height: 1.3)),
      ],
    );
  }
}

class _Credenciais extends StatelessWidget {
  const _Credenciais(this.titulo, this.itens, this.icone);
  final String titulo;
  final List<String> itens;
  final IconData icone;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icone, size: 17, color: cs.onSurfaceVariant),
            const SizedBox(width: 8),
            Text(titulo.toUpperCase(),
                style: tt.labelSmall?.copyWith(
                    color: cs.onSurfaceVariant, letterSpacing: 1.6, fontWeight: FontWeight.w600)),
          ],
        ),
        const SizedBox(height: 8),
        for (final i in itens)
          Padding(
            padding: const EdgeInsets.only(bottom: 5, left: 25),
            child: Text('· $i', style: tt.bodyMedium?.copyWith(height: 1.45)),
          ),
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
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Icon(servico.icone, size: 22, color: cs.onSurfaceVariant),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(servico.nome,
                        style: tt.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 3),
                    Text(servico.resumo,
                        style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant, height: 1.4)),
                  ],
                ),
              ),
              Icon(Icons.arrow_forward_rounded, size: 18, color: cs.outline),
            ],
          ),
        ),
      ),
    );
  }
}

class _CartaoDepoimento extends StatelessWidget {
  const _CartaoDepoimento(this.d);
  final Depoimento d;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Container(
      width: 290,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: cs.surfaceContainer,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.format_quote_rounded, color: cs.outline),
          const SizedBox(height: 8),
          Expanded(
            child: Text(d.texto,
                maxLines: 6,
                overflow: TextOverflow.ellipsis,
                style: tt.bodyMedium?.copyWith(height: 1.5)),
          ),
          const SizedBox(height: 12),
          Text(d.autor, style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
          if (d.papel != null)
            Text(d.papel!, style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
        ],
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
      color: cs.inverseSurface,
      padding: const EdgeInsets.fromLTRB(20, 40, 20, 44),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          MarcaLorena(altura: 40, cor: cs.onInverseSurface),
          const SizedBox(height: 26),
          Text('Comece pela avaliação',
              style: tt.headlineSmall?.copyWith(color: cs.onInverseSurface)),
          const SizedBox(height: 10),
          Text(
            'É nela que descobrimos a causa da sua queda e dizemos, com honestidade, '
            'se o transplante é o seu caminho. ${Contato.prazoResposta}',
            style: tt.bodyMedium?.copyWith(
                color: cs.onInverseSurface.withValues(alpha: 0.8), height: 1.55),
          ),
          const SizedBox(height: 22),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: cs.inversePrimary,
              foregroundColor: cs.onPrimaryContainer,
            ),
            onPressed: () => abrirWhatsapp(
              mensagem: 'Oi! Vim pelo app e quero agendar uma avaliação.',
            ),
            icon: const Icon(Icons.chat_bubble_outline_rounded, size: 19),
            label: const Text('Falar com a clínica'),
          ),
        ],
      ),
    );
  }
}
