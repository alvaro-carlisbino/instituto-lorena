import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lorena_core/lorena_core.dart';
import 'package:url_launcher/url_launcher.dart';

class TelaAssinatura extends StatelessWidget {
  const TelaAssinatura({super.key});

  static final _moeda = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

  @override
  Widget build(BuildContext context) {
    return Carrega<Assinatura?>(
      buscar: LorenaApi.instance.clienteAssinatura,
      temConteudo: (a) => a != null,
      vazio: MensagemVazia(
        icone: Icons.autorenew_rounded,
        titulo: 'Você ainda não tem assinatura',
        descricao: 'No clube, o frasco chega sozinho todo mês e sai mais barato que a compra avulsa.',
        acao: FilledButton.icon(
          onPressed: () => launchUrl(
            Uri.parse('https://wa.me/${AppBrand.tricopill.suporteWhatsapp}'
                '?text=${Uri.encodeComponent('Oi! Quero saber da assinatura do Tricopill.')}'),
            mode: LaunchMode.externalApplication,
          ),
          icon: const Icon(Icons.chat_bubble_outline_rounded),
          label: const Text('Quero saber mais'),
        ),
      ),
      constroi: (context, a, _) {
        final cs = Theme.of(context).colorScheme;
        final tt = Theme.of(context).textTheme;
        final s = a!;

        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: s.ativa ? cs.primaryContainer : cs.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            s.ativa ? 'Ativa' : s.status,
                            style: tt.bodySmall?.copyWith(
                              fontWeight: FontWeight.w700,
                              color: s.ativa ? cs.onPrimaryContainer : cs.onSurfaceVariant,
                            ),
                          ),
                        ),
                        const Spacer(),
                        Text(_cadencia(s.cadencia),
                            style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                      ],
                    ),
                    const SizedBox(height: 18),
                    Text('${s.ciclosPagos}',
                        style: tt.displaySmall?.copyWith(
                          fontWeight: FontWeight.w800,
                          color: cs.primary,
                          letterSpacing: -1.5,
                        )),
                    Text(s.ciclosPagos == 1 ? 'mês de tratamento' : 'meses de tratamento',
                        style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            CartaoSecao(
              titulo: 'SEU PLANO',
              filho: Column(
                children: [
                  _Linha('Valor mensal', _moeda.format(s.valorMensalCentavos / 100)),
                  _Linha('Frascos por envio', '${s.unidadesPorEnvio}'),
                  if (s.ultimoEnvioEm != null)
                    _Linha('Último envio', DateFormat('dd/MM/yyyy').format(s.ultimoEnvioEm!)),
                  if (s.minCiclos > 0) _Linha('Fidelidade', '${s.minCiclos} ciclos'),
                ],
              ),
            ),
            const SizedBox(height: 20),
            CartaoSecao(
              titulo: 'PRECISA MUDAR ALGO?',
              filho: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Trocar endereço, adiar um envio, pausar ou cancelar: é só falar com a gente '
                    'no WhatsApp que resolvemos.',
                    style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant),
                  ),
                  const SizedBox(height: 14),
                  FilledButton.tonalIcon(
                    onPressed: () => launchUrl(
                      Uri.parse('https://wa.me/${AppBrand.tricopill.suporteWhatsapp}'
                          '?text=${Uri.encodeComponent('Oi! Quero falar sobre a minha assinatura.')}'),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(Icons.chat_bubble_outline_rounded),
                    label: const Text('Falar no WhatsApp'),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  static String _cadencia(String c) => switch (c.toLowerCase()) {
        'monthly' || 'mensal' => 'Mensal',
        'quarterly' || 'trimestral' => 'Trimestral',
        _ => c,
      };
}

class _Linha extends StatelessWidget {
  const _Linha(this.rotulo, this.valor);
  final String rotulo;
  final String valor;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Expanded(
            child: Text(rotulo,
                style: tt.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          ),
          Text(valor, style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}
