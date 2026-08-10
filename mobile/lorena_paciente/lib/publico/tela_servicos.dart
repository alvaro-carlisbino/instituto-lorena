import 'package:flutter/material.dart';

import '../conteudo.dart';
import 'comum.dart';

class TelaServicos extends StatelessWidget {
  const TelaServicos({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 40),
        children: [
          const TituloSecao('Tratamentos', apoio: 'O que fazemos'),
          const SizedBox(height: 8),
          Text(
            'Cada caso começa pela avaliação. É ela que diz qual destes caminhos '
            'faz sentido para você.',
            style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant, height: 1.5),
          ),
          const SizedBox(height: 22),
          for (final s in servicos) ...[
            Card(
              child: InkWell(
                borderRadius: BorderRadius.circular(20),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => TelaServicoDetalhe(servico: s)),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(s.icone, size: 22, color: cs.primary),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(s.nome,
                                style: tt.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                          ),
                          Icon(Icons.chevron_right_rounded, color: cs.outline),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(s.resumo,
                          style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant, height: 1.45)),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
          const SizedBox(height: 16),
          const BotaoWhatsapp(
            rotulo: 'Tirar dúvida no WhatsApp',
            mensagem: 'Oi! Vim pelo app e queria entender qual tratamento é o meu caso.',
            tonal: true,
          ),
        ],
      ),
    );
  }
}

class TelaServicoDetalhe extends StatelessWidget {
  const TelaServicoDetalhe({super.key, required this.servico});
  final Servico servico;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: Text(servico.nome)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: cs.primaryContainer,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              children: [
                Icon(servico.icone, size: 30, color: cs.onPrimaryContainer),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(servico.resumo,
                      style: tt.bodyLarge?.copyWith(
                          color: cs.onPrimaryContainer, height: 1.4, fontWeight: FontWeight.w500)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 30),
          const TituloSecao('Para quem é'),
          const SizedBox(height: 10),
          Text(servico.paraQuem,
              style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant, height: 1.55)),
          const SizedBox(height: 30),
          const TituloSecao('Como funciona'),
          const SizedBox(height: 14),
          for (var i = 0; i < servico.comoFunciona.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 26,
                    height: 26,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: cs.secondaryContainer,
                      shape: BoxShape.circle,
                    ),
                    child: Text('${i + 1}',
                        style: tt.bodySmall?.copyWith(
                            fontWeight: FontWeight.w700, color: cs.onSecondaryContainer)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(servico.comoFunciona[i],
                        style: tt.bodyMedium?.copyWith(height: 1.5)),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 16),
          Row(
            children: [
              Icon(Icons.schedule_rounded, size: 18, color: cs.onSurfaceVariant),
              const SizedBox(width: 8),
              Expanded(
                child: Text(servico.duracao,
                    style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
              ),
            ],
          ),
          const SizedBox(height: 30),
          Card(
            color: cs.surfaceContainerLow,
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('E o valor?',
                      style: tt.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Text(
                    'Depende do que a avaliação indicar: número de folículos e tipo '
                    'de procedimento mudam muito de pessoa para pessoa. Por isso a '
                    'clínica passa o valor depois de te avaliar, e não por tabela.',
                    style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant, height: 1.5),
                  ),
                  const SizedBox(height: 16),
                  BotaoWhatsapp(
                    rotulo: 'Falar sobre este tratamento',
                    mensagem: 'Oi! Vim pelo app e quero saber sobre ${servico.nome}.',
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
