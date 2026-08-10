import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lorena_core/lorena_core.dart';

/// Centro cirúrgico em modo LEITURA. Quem opera o sistema durante a cirurgia é
/// a tela do PHP, com paciente na mesa — o app não escreve nada aqui.
class TelaCirurgiaHoje extends StatelessWidget {
  const TelaCirurgiaHoje({super.key});

  static const _rotuloEtapa = {
    'PRE-CIRURGICO': 'Pré-cirúrgico',
    'ANESTESIA1': 'Anestesia',
    'PRE_INSICOES': 'Pré-incisões',
    'ANESTESIA2': 'Anestesia (2ª)',
    'EXTRACAO': 'Extração',
    'IMPLANTE': 'Implante',
    'RPA': 'Recuperação',
    'ALTA_ANESTESICA': 'Alta anestésica',
    'ALTA': 'Alta',
  };

  @override
  Widget build(BuildContext context) {
    return Carrega<List<CirurgiaHoje>>(
      buscar: LorenaApi.instance.equipeCirurgiasHoje,
      temConteudo: (l) => l.isNotEmpty,
      vazio: const MensagemVazia(
        icone: Icons.monitor_heart_outlined,
        titulo: 'Nenhuma cirurgia hoje',
        descricao: 'Os dados vêm do sistema do centro cirúrgico e atualizam a cada 2 horas.',
      ),
      constroi: (context, itens, _) {
        final cs = Theme.of(context).colorScheme;
        final tt = Theme.of(context).textTheme;
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            for (final c in itens) ...[
              CartaoSecao(
                titulo: (c.sala ?? 'CIRURGIA').toUpperCase(),
                filho: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(c.paciente, style: tt.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                    if (c.horaInicio != null)
                      Text('Início às ${DateFormat('HH:mm').format(c.horaInicio!)}',
                          style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: _Numero(
                            valor: c.totalExtraidos,
                            rotulo: 'extraídos',
                            cor: cs.tertiary,
                          ),
                        ),
                        Expanded(
                          child: _Numero(
                            valor: c.totalImplantados,
                            rotulo: 'implantados',
                            cor: cs.primary,
                          ),
                        ),
                        Expanded(
                          child: _Numero(valor: c.meta, rotulo: 'meta', cor: cs.onSurfaceVariant),
                        ),
                      ],
                    ),
                    if (c.meta > 0) ...[
                      const SizedBox(height: 14),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: LinearProgressIndicator(
                          value: (c.totalImplantados / c.meta).clamp(0, 1),
                          minHeight: 8,
                          backgroundColor: cs.surfaceContainerHighest,
                        ),
                      ),
                    ],
                    if (c.etapaAtual != null) ...[
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Icon(Icons.play_circle_outline_rounded, size: 18, color: cs.primary),
                          const SizedBox(width: 8),
                          Text(_rotuloEtapa[c.etapaAtual] ?? c.etapaAtual!,
                              style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ],
          ],
        );
      },
    );
  }
}

class _Numero extends StatelessWidget {
  const _Numero({required this.valor, required this.rotulo, required this.cor});
  final int valor;
  final String rotulo;
  final Color cor;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('$valor',
            style: tt.headlineSmall?.copyWith(fontWeight: FontWeight.w800, color: cor, letterSpacing: -0.8)),
        Text(rotulo, style: tt.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      ],
    );
  }
}
