import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lorena_core/lorena_core.dart';
import 'package:url_launcher/url_launcher.dart';

class _Resumo {
  _Resumo(this.me, this.cirurgias, this.consultas);
  final Map<String, dynamic>? me;
  final List<Cirurgia> cirurgias;
  final List<Consulta> consultas;
}

class TelaInicio extends StatelessWidget {
  const TelaInicio({super.key});

  Future<_Resumo> _buscar() async {
    final api = LorenaApi.instance;
    final r = await Future.wait([
      api.pacienteEu(),
      api.pacienteCirurgias(),
      api.pacienteConsultas(),
    ]);
    return _Resumo(
      r[0] as Map<String, dynamic>?,
      r[1] as List<Cirurgia>,
      r[2] as List<Consulta>,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Carrega<_Resumo>(
      buscar: _buscar,
      constroi: (context, d, _) {
        final tt = Theme.of(context).textTheme;
        final cs = Theme.of(context).colorScheme;
        final primeiroNome = (d.me?['nome']?.toString() ?? '').split(' ').first;
        final proxima = d.consultas.where((c) => c.futura).toList()
          ..sort((a, b) => (a.data ?? DateTime(2100)).compareTo(b.data ?? DateTime(2100)));
        final ultimaCirurgia = d.cirurgias.isEmpty ? null : d.cirurgias.first;

        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            Text(
              primeiroNome.isEmpty ? 'Olá' : 'Olá, $primeiroNome',
              style: tt.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.5),
            ),
            const SizedBox(height: 24),

            if (proxima.isNotEmpty) ...[
              CartaoSecao(
                titulo: 'SUA PRÓXIMA CONSULTA',
                filho: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: cs.primaryContainer,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(Icons.event_rounded, color: cs.onPrimaryContainer),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            DateFormat("EEEE, d 'de' MMMM", 'pt_BR').format(proxima.first.data!),
                            style: tt.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            '${proxima.first.horario} · ${proxima.first.servico}',
                            style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ],

            if (ultimaCirurgia != null) ...[
              CartaoSecao(
                titulo: 'SEU PROCEDIMENTO',
                filho: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${ultimaCirurgia.totalImplantados}',
                              style: tt.headlineMedium?.copyWith(
                                fontWeight: FontWeight.w800,
                                color: cs.primary,
                                letterSpacing: -1,
                              )),
                          Text('folículos implantados',
                              style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                        ],
                      ),
                    ),
                    if (ultimaCirurgia.dia != null)
                      Text(DateFormat('dd/MM/yy').format(ultimaCirurgia.dia!),
                          style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ],

            CartaoSecao(
              titulo: 'PRECISA FALAR COM A GENTE?',
              filho: Column(
                children: [
                  Text(
                    'Nossa equipe responde pelo WhatsApp. Dúvida sobre cuidados, '
                    'agendamento ou o seu tratamento? É só chamar.',
                    style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant),
                  ),
                  const SizedBox(height: 14),
                  FilledButton.tonalIcon(
                    onPressed: () => _abrirWhatsapp(context),
                    icon: const Icon(Icons.chat_bubble_outline_rounded),
                    label: const Text('Falar com a clínica'),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Future<void> _abrirWhatsapp(BuildContext context) async {
    final uri = Uri.parse('https://wa.me/${AppBrand.paciente.suporteWhatsapp}');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (context.mounted) mostraErro(context, ApiErro('whatsapp', 'Não foi possível abrir o WhatsApp.'));
    }
  }
}
