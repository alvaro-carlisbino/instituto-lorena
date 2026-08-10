import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lorena_core/lorena_core.dart';

class TelaConsultas extends StatelessWidget {
  const TelaConsultas({super.key});

  @override
  Widget build(BuildContext context) {
    return Carrega<List<Consulta>>(
      buscar: LorenaApi.instance.pacienteConsultas,
      temConteudo: (l) => l.isNotEmpty,
      vazio: const MensagemVazia(
        icone: Icons.event_busy_outlined,
        titulo: 'Nenhuma consulta por aqui',
        descricao: 'Quando você agendar com a clínica, sua consulta aparece nesta tela.',
      ),
      constroi: (context, consultas, _) {
        final futuras = consultas.where((c) => c.futura).toList()
          ..sort((a, b) => (a.data ?? DateTime(2100)).compareTo(b.data ?? DateTime(2100)));
        final passadas = consultas.where((c) => !c.futura).toList()
          ..sort((a, b) => (b.data ?? DateTime(1900)).compareTo(a.data ?? DateTime(1900)));

        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            if (futuras.isNotEmpty) ...[
              CartaoSecao(
                titulo: 'PRÓXIMAS',
                filho: Column(children: [for (final c in futuras) _Linha(c, futura: true)]),
              ),
              const SizedBox(height: 20),
            ],
            if (passadas.isNotEmpty)
              CartaoSecao(
                titulo: 'HISTÓRICO',
                filho: Column(children: [for (final c in passadas) _Linha(c, futura: false)]),
              ),
          ],
        );
      },
    );
  }
}

class _Linha extends StatelessWidget {
  const _Linha(this.c, {required this.futura});
  final Consulta c;
  final bool futura;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 62,
            child: Text(
              c.data == null ? '—' : DateFormat('dd/MM/yy').format(c.data!),
              style: tt.bodySmall?.copyWith(
                color: futura ? cs.primary : cs.onSurfaceVariant,
                fontWeight: futura ? FontWeight.w700 : FontWeight.w400,
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c.servico, style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                if (c.prestador.isNotEmpty || c.horario.isNotEmpty)
                  Text(
                    [if (c.horario.isNotEmpty) c.horario, if (c.prestador.isNotEmpty) c.prestador].join(' · '),
                    style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
