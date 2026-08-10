import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';

/// Cuidados pós-operatórios. Conteúdo fixo no app de propósito: é orientação
/// geral, funciona sem internet e não depende de nada estar cadastrado.
/// Toda dúvida específica volta para a clínica — o app não substitui a equipe.
class TelaCuidados extends StatelessWidget {
  const TelaCuidados({super.key});

  static const _blocos = <(String, IconData, List<String>)>[
    (
      'Primeiras 48 horas',
      Icons.bedtime_outlined,
      [
        'Durma de barriga para cima, com a cabeça elevada em 30 a 45 graus.',
        'Não encoste a área implantada no travesseiro.',
        'Aplique gelo na testa (nunca sobre os implantes) se houver inchaço.',
        'Evite abaixar a cabeça e fazer força.',
      ],
    ),
    (
      'Lavagem',
      Icons.water_drop_outlined,
      [
        'A primeira lavagem segue a orientação que a equipe passou na alta.',
        'Água morna, jamais quente, e sem jato direto sobre a área.',
        'Espuma nas mãos, aplicada com toque leve — sem esfregar.',
        'Secar dando batidinhas com toalha limpa, sem atrito.',
      ],
    ),
    (
      'Evite nas primeiras semanas',
      Icons.do_not_disturb_on_outlined,
      [
        'Sol direto na área implantada.',
        'Academia, corrida e qualquer esforço que aumente a pressão.',
        'Piscina, mar, sauna e banho muito quente.',
        'Bebida alcoólica e cigarro — atrapalham a cicatrização.',
        'Boné apertado ou capacete sobre a área.',
      ],
    ),
    (
      'É esperado acontecer',
      Icons.info_outline_rounded,
      [
        'Casquinhas nos primeiros dias, que saem sozinhas com as lavagens.',
        'Inchaço na testa entre o 2º e o 4º dia.',
        'Queda dos fios implantados nas primeiras semanas: a raiz permanece, '
            'o fio novo nasce depois.',
        'Coceira leve durante a cicatrização.',
      ],
    ),
    (
      'Procure a clínica se',
      Icons.emergency_outlined,
      [
        'Febre acima de 38 °C.',
        'Dor forte que não passa com o analgésico orientado.',
        'Vermelhidão que aumenta, secreção ou mau cheiro.',
        'Sangramento que não para com compressão leve.',
      ],
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Cuidados pós-operatórios')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Card(
            color: cs.secondaryContainer,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(Icons.lightbulb_outline_rounded, color: cs.onSecondaryContainer),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Estas são orientações gerais. A palavra final é sempre da sua '
                      'equipe: em caso de dúvida, chame a clínica.',
                      style: tt.bodySmall?.copyWith(color: cs.onSecondaryContainer),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          for (final (titulo, icone, itens) in _blocos) ...[
            CartaoSecao(
              titulo: titulo.toUpperCase(),
              filho: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final item in itens)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(top: 3, right: 10),
                            child: Icon(icone, size: 16, color: cs.primary),
                          ),
                          Expanded(child: Text(item, style: tt.bodyMedium)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 20),
          ],
        ],
      ),
    );
  }
}
