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
          const TituloSecao('Procedimentos', apoio: 'O que fazemos'),
          const SizedBox(height: 10),
          Text(
            'Todo caso começa pela avaliação. É ela que diz qual destes caminhos '
            'faz sentido para você.',
            style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant, height: 1.5),
          ),
          const SizedBox(height: 24),
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
                          Icon(s.icone, size: 21, color: cs.onSurfaceVariant),
                          const SizedBox(width: 12),
                          Expanded(child: Text(s.nome, style: tt.titleMedium)),
                          Icon(Icons.arrow_forward_rounded, size: 18, color: cs.outline),
                        ],
                      ),
                      const SizedBox(height: 10),
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
            mensagem: 'Oi! Vim pelo app e queria entender qual procedimento é o meu caso.',
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
      appBar: AppBar(title: Text(servico.nome, maxLines: 2, overflow: TextOverflow.ellipsis)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        children: [
          Text(servico.nome, style: tt.headlineMedium),
          const SizedBox(height: 12),
          Text(servico.resumo,
              style: tt.bodyLarge?.copyWith(color: cs.onSurfaceVariant, height: 1.5)),
          const SizedBox(height: 26),
          Text(servico.texto, style: tt.bodyMedium?.copyWith(height: 1.6)),
          if (servico.destaques.isNotEmpty) ...[
            const SizedBox(height: 28),
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: cs.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final d in servico.destaques)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(top: 3, right: 10),
                            child: Icon(Icons.check_rounded, size: 16, color: cs.onSurface),
                          ),
                          Expanded(child: Text(d, style: tt.bodyMedium?.copyWith(height: 1.45))),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 30),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('E o valor?', style: tt.titleMedium),
                  const SizedBox(height: 8),
                  Text(
                    'Depende do que a avaliação indicar: número de unidades foliculares '
                    'e tipo de procedimento mudam muito de pessoa para pessoa. Por isso '
                    'a clínica passa o valor depois de te avaliar, e não por tabela.',
                    style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant, height: 1.5),
                  ),
                  const SizedBox(height: 18),
                  BotaoWhatsapp(
                    rotulo: 'Falar sobre este procedimento',
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
