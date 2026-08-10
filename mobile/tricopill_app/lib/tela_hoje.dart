import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';
import 'package:url_launcher/url_launcher.dart';

import 'lembrete.dart';

/// A tela que segura o cliente: o lembrete da cápsula. Quem esquece de tomar
/// para de comprar — e reposição perdida não volta com anúncio, volta com
/// hábito.
class TelaHoje extends StatefulWidget {
  const TelaHoje({super.key});

  @override
  State<TelaHoje> createState() => _TelaHojeState();
}

class _TelaHojeState extends State<TelaHoje> {
  bool _ligado = false;
  TimeOfDay _hora = const TimeOfDay(hour: 8, minute: 0);
  bool _carregado = false;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    final c = await Lembrete.instance.ler();
    if (!mounted) return;
    setState(() {
      _ligado = c.ligado;
      _hora = c.hora;
      _carregado = true;
    });
  }

  Future<void> _alternar(bool v) async {
    if (v) {
      final ok = await Lembrete.instance.pedirPermissao();
      if (!ok) {
        if (mounted) {
          mostraErro(context,
              ApiErro('sem_permissao', 'Libere as notificações nos ajustes do celular para receber o lembrete.'));
        }
        return;
      }
    }
    await Lembrete.instance.definir(ligado: v, hora: _hora);
    if (!mounted) return;
    setState(() => _ligado = v);
    mostraOk(context, v ? 'Lembrete ligado.' : 'Lembrete desligado.');
  }

  Future<void> _escolherHora() async {
    final nova = await showTimePicker(context: context, initialTime: _hora);
    if (nova == null) return;
    await Lembrete.instance.definir(ligado: _ligado, hora: nova);
    if (!mounted) return;
    setState(() => _hora = nova);
  }

  String _fmt(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    final segunda = TimeOfDay(hour: (_hora.hour + 12) % 24, minute: _hora.minute);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        CartaoSecao(
          titulo: 'LEMBRETE DA CÁPSULA',
          filho: !_carregado
              ? const Center(child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator()))
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'A posologia é 2 cápsulas por dia. Escolha o horário da primeira '
                      'e a segunda é agendada 12 horas depois.',
                      style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant),
                    ),
                    const SizedBox(height: 16),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      value: _ligado,
                      onChanged: _alternar,
                      title: const Text('Quero ser lembrado'),
                    ),
                    if (_ligado) ...[
                      const Divider(height: 24),
                      InkWell(
                        onTap: _escolherHora,
                        borderRadius: BorderRadius.circular(12),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          child: Row(
                            children: [
                              Icon(Icons.wb_sunny_outlined, size: 20, color: cs.primary),
                              const SizedBox(width: 12),
                              Expanded(child: Text('Primeira cápsula', style: tt.bodyMedium)),
                              Text(_fmt(_hora),
                                  style: tt.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                              const Icon(Icons.chevron_right_rounded),
                            ],
                          ),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Row(
                          children: [
                            Icon(Icons.nightlight_outlined, size: 20, color: cs.outline),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text('Segunda cápsula',
                                  style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant)),
                            ),
                            Text(_fmt(segunda),
                                style: tt.titleMedium?.copyWith(color: cs.onSurfaceVariant)),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
        ),
        const SizedBox(height: 24),
        CartaoSecao(
          titulo: 'COMO TOMAR',
          filho: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final t in const [
                'Duas cápsulas por dia, sempre no mesmo horário.',
                'Pode tomar junto com a refeição, com água.',
                'Resultado aparece com constância: os primeiros sinais costumam '
                    'vir a partir do terceiro mês.',
                'Esqueceu uma dose? Tome quando lembrar e siga o horário normal. '
                    'Não dobre a dose.',
              ])
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 5, right: 10),
                        child: Icon(Icons.circle, size: 6, color: cs.primary),
                      ),
                      Expanded(child: Text(t, style: tt.bodyMedium)),
                    ],
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        CartaoSecao(
          titulo: 'PRECISA REPOR?',
          filho: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Chame no WhatsApp e a gente resolve na hora, ou compre direto na loja.',
                style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () => launchUrl(
                        Uri.parse('https://wa.me/${AppBrand.tricopill.suporteWhatsapp}'
                            '?text=${Uri.encodeComponent('Oi! Quero repor meu Tricopill.')}'),
                        mode: LaunchMode.externalApplication,
                      ),
                      icon: const Icon(Icons.chat_bubble_outline_rounded),
                      label: const Text('WhatsApp'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => launchUrl(
                        Uri.parse('https://tricopill.com.br'),
                        mode: LaunchMode.externalApplication,
                      ),
                      icon: const Icon(Icons.storefront_outlined),
                      label: const Text('Loja'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
