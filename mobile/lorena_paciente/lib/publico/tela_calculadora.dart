import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';

import 'comum.dart';

/// Calculadora de unidades foliculares.
///
/// A referência de cada área NÃO vem de tabela de internet: vem dos quartis das
/// cirurgias já feitas nesta clínica (RPC clinica_referencia_por_area). Leve é o
/// 1º quartil, médio a mediana, avançado o 3º quartil. Assim a estimativa é o
/// resultado da casa e acompanha a operação sozinha.
class TelaCalculadora extends StatefulWidget {
  const TelaCalculadora({super.key});

  @override
  State<TelaCalculadora> createState() => _TelaCalculadoraState();
}

class _TelaCalculadoraState extends State<TelaCalculadora> {
  /// area -> null (não tratar) | 0 leve | 1 médio | 2 avançado
  final Map<String, int?> _escolhas = {};

  static const _niveis = ['Leve', 'Moderada', 'Avançada'];

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Quantos fios eu preciso?')),
      body: FutureBuilder<List<AreaReferencia>>(
        future: LorenaApi.instance.clinicaReferenciaPorArea(),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final areas = snap.data ?? const <AreaReferencia>[];
          if (areas.isEmpty) {
            return MensagemVazia(
              icone: Icons.calculate_outlined,
              titulo: 'Calculadora indisponível',
              descricao: 'Não conseguimos carregar a referência agora. Tente de novo '
                  'em instantes ou fale com a clínica.',
              acao: const BotaoWhatsapp(rotulo: 'Falar com a clínica'),
            );
          }

          final marcadas = _escolhas.entries.where((e) => e.value != null).toList();
          var total = 0;
          for (final e in marcadas) {
            final ref = areas.firstWhere((a) => a.area == e.key);
            total += ref.paraNivel(e.value!);
          }
          final amostra = areas.fold<int>(0, (m, a) => a.cirurgias > m ? a.cirurgias : m);

          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
            children: [
              Text(
                'Marque as áreas em que você tem falha e o quanto ela está avançada. '
                'A estimativa é feita com base nas cirurgias já realizadas aqui.',
                style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant, height: 1.5),
              ),
              const SizedBox(height: 24),

              for (final a in areas) ...[
                Card(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(a.area,
                                  style: tt.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                            ),
                            if (_escolhas[a.area] != null)
                              Text('${a.paraNivel(_escolhas[a.area]!)}',
                                  style: tt.bodyLarge?.copyWith(
                                      fontWeight: FontWeight.w700, color: cs.primary)),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          children: [
                            ChoiceChip(
                              label: const Text('Não tenho'),
                              selected: _escolhas[a.area] == null,
                              onSelected: (_) => setState(() => _escolhas[a.area] = null),
                            ),
                            for (var n = 0; n < 3; n++)
                              ChoiceChip(
                                label: Text(_niveis[n]),
                                selected: _escolhas[a.area] == n,
                                onSelected: (_) => setState(() => _escolhas[a.area] = n),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 10),
              ],

              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: cs.inverseSurface,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('SUA ESTIMATIVA',
                        style: tt.labelSmall?.copyWith(
                            color: cs.onInverseSurface.withValues(alpha: 0.7),
                            letterSpacing: 2.2,
                            fontWeight: FontWeight.w600)),
                    const SizedBox(height: 12),
                    Text(
                      total == 0 ? '—' : '$total',
                      style: tt.displayMedium?.copyWith(color: cs.onInverseSurface),
                    ),
                    Text('unidades foliculares',
                        style: tt.bodyMedium?.copyWith(
                            color: cs.onInverseSurface.withValues(alpha: 0.8))),
                    if (total > 0) ...[
                      const SizedBox(height: 18),
                      Text(
                        'Estimativa baseada em até $amostra cirurgias já realizadas na '
                        'clínica. O número real só sai na avaliação, que também diz se '
                        'a sua área doadora comporta essa quantidade.',
                        style: tt.bodySmall?.copyWith(
                            color: cs.onInverseSurface.withValues(alpha: 0.75), height: 1.5),
                      ),
                      const SizedBox(height: 20),
                      FilledButton.icon(
                        style: FilledButton.styleFrom(
                          backgroundColor: cs.inversePrimary,
                          foregroundColor: cs.onPrimaryContainer,
                        ),
                        onPressed: () => abrirWhatsapp(
                          mensagem: 'Oi! Fiz a estimativa pelo app e deu cerca de $total '
                              'unidades foliculares (${marcadas.map((e) => '${e.key}: '
                              '${_niveis[e.value!].toLowerCase()}').join(', ')}). '
                              'Quero agendar uma avaliação.',
                        ),
                        icon: const Icon(Icons.chat_bubble_outline_rounded, size: 19),
                        label: const Text('Levar isso para a avaliação'),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
