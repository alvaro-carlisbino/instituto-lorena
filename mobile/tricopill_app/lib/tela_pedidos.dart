import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lorena_core/lorena_core.dart';

class TelaPedidos extends StatelessWidget {
  const TelaPedidos({super.key});

  static final _moeda = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

  @override
  Widget build(BuildContext context) {
    return Carrega<List<Pedido>>(
      buscar: LorenaApi.instance.clientePedidos,
      temConteudo: (l) => l.isNotEmpty,
      vazio: const MensagemVazia(
        icone: Icons.receipt_long_outlined,
        titulo: 'Nenhum pedido por aqui',
        descricao: 'Suas compras aparecem nesta tela assim que forem registradas.',
      ),
      constroi: (context, pedidos, _) {
        final cs = Theme.of(context).colorScheme;
        final tt = Theme.of(context).textTheme;
        final ordenados = [...pedidos]
          ..sort((a, b) => (b.criadoEm ?? DateTime(1900)).compareTo(a.criadoEm ?? DateTime(1900)));

        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          itemCount: ordenados.length,
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (_, i) {
            final p = ordenados[i];
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            p.kit != null && p.kit!.isNotEmpty ? _rotuloKit(p.kit!) : 'Pedido',
                            style: tt.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                        Text(_moeda.format(p.valorCentavos / 100),
                            style: tt.bodyLarge?.copyWith(fontWeight: FontWeight.w800)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Icon(
                          p.pago ? Icons.check_circle_rounded : Icons.schedule_rounded,
                          size: 15,
                          color: p.pago ? cs.primary : cs.outline,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          p.pago ? 'Pago' : 'Aguardando pagamento',
                          style: tt.bodySmall?.copyWith(
                            color: p.pago ? cs.primary : cs.onSurfaceVariant,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const Spacer(),
                        if (p.criadoEm != null)
                          Text(DateFormat('dd/MM/yyyy').format(p.criadoEm!),
                              style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                      ],
                    ),
                    if (p.metodo.isNotEmpty || p.nfe != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        [
                          if (p.metodo.isNotEmpty) _rotuloMetodo(p.metodo),
                          if (p.freteCentavos > 0) 'frete ${_moeda.format(p.freteCentavos / 100)}',
                          if (p.nfe != null) 'NF-e ${p.nfe}',
                        ].join(' · '),
                        style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                      ),
                    ],
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  static String _rotuloKit(String k) => switch (k) {
        '1_mes' => 'Kit 1 mês',
        '3_meses' => 'Kit 3 meses',
        '5_meses' => 'Kit Evolução',
        _ => k,
      };

  static String _rotuloMetodo(String m) => switch (m.toLowerCase()) {
        'pix' => 'Pix',
        'credit' || 'cartao' || 'card' => 'Cartão',
        _ => m,
      };
}
