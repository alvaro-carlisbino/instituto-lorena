import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lorena_core/lorena_core.dart';

class TelaAgenda extends StatelessWidget {
  const TelaAgenda({super.key});

  @override
  Widget build(BuildContext context) {
    return Carrega<List<AgendaItem>>(
      buscar: LorenaApi.instance.equipeAgendaHoje,
      temConteudo: (l) => l.isNotEmpty,
      vazio: const MensagemVazia(
        icone: Icons.event_available_outlined,
        titulo: 'Nenhuma consulta hoje',
        descricao: 'A agenda vem da Shosp e atualiza sozinha.',
      ),
      constroi: (context, itens, _) {
        final cs = Theme.of(context).colorScheme;
        final tt = Theme.of(context).textTheme;
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Text(DateFormat("EEEE, d 'de' MMMM", 'pt_BR').format(DateTime.now()),
                style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
            const SizedBox(height: 4),
            Text('${itens.length} ${itens.length == 1 ? 'consulta' : 'consultas'}',
                style: tt.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 20),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    for (final a in itens)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: 52,
                              child: Text(a.horario,
                                  style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                            ),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(a.paciente,
                                      style: tt.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                                  Text(
                                    [a.servico, if (a.prestador.isNotEmpty) a.prestador].join(' · '),
                                    style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                                  ),
                                ],
                              ),
                            ),
                            if (a.status.isNotEmpty)
                              Text(a.status, style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
