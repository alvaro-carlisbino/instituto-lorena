import 'package:flutter/material.dart';

import '../conteudo.dart';
import 'comum.dart';

/// Quem somos, unidades e contato. O SAC entra aqui e não numa aba própria:
/// canal escondido é canal que ninguém usa, e é a mesma equipe que responde.
class TelaClinica extends StatelessWidget {
  const TelaClinica({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 40),
        children: [
          const MarcaLorena(altura: 44),
          const SizedBox(height: 28),
          const TituloSecao('Sobre o Instituto', apoio: 'Quem somos'),
          const SizedBox(height: 14),
          Text(Clinica.sobre, style: tt.bodyMedium?.copyWith(height: 1.6)),
          const SizedBox(height: 18),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: cs.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('NOSSA MISSÃO',
                    style: tt.labelSmall?.copyWith(
                        letterSpacing: 2, fontWeight: FontWeight.w600,
                        color: cs.onSurfaceVariant)),
                const SizedBox(height: 8),
                Text(Clinica.missao, style: tt.bodyMedium?.copyWith(height: 1.55)),
              ],
            ),
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [for (final v in Clinica.valores) Chip(label: Text(v))],
          ),

          const SizedBox(height: 40),
          const TituloSecao('Direção clínica', apoio: 'Equipe'),
          const SizedBox(height: 14),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(Dra.nome, style: tt.titleLarge),
                  Text(Dra.registro,
                      style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                  const SizedBox(height: 12),
                  Text(Dra.resumo, style: tt.bodyMedium?.copyWith(height: 1.55)),
                ],
              ),
            ),
          ),

          const SizedBox(height: 40),
          const TituloSecao('Unidades', apoio: 'Onde estamos'),
          const SizedBox(height: 14),
          for (final u in unidades) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.location_on_outlined, size: 19, color: cs.onSurfaceVariant),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(u.cidade,
                                  style: tt.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                              const SizedBox(height: 2),
                              Text(u.endereco,
                                  style: tt.bodySmall?.copyWith(
                                      color: cs.onSurfaceVariant, height: 1.4)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    OutlinedButton.icon(
                      onPressed: () => abrirMapa(u.busca),
                      icon: const Icon(Icons.map_outlined, size: 18),
                      label: const Text('Abrir no mapa'),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],

          const SizedBox(height: 32),
          const TituloSecao('Fale conosco', apoio: 'Atendimento e SAC'),
          const SizedBox(height: 10),
          Text(
            'Agendamento, dúvida, pós-operatório, elogio ou reclamação: é o mesmo '
            'caminho, e uma pessoa responde. ${Contato.prazoResposta}',
            style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant, height: 1.5),
          ),
          const SizedBox(height: 18),
          const BotaoWhatsapp(
            rotulo: 'WhatsApp ${Contato.telefoneVisivel}',
            mensagem: 'Oi! Vim pelo app do Instituto Lorena Visentainer.',
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => abrirLink('mailto:${Contato.email}'),
            icon: const Icon(Icons.mail_outline_rounded, size: 18),
            label: const Text(Contato.email),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => abrirWhatsapp(
              mensagem: 'Oi! Quero registrar uma reclamação ou sugestão sobre o meu atendimento.',
            ),
            icon: const Icon(Icons.support_agent_rounded, size: 18),
            label: const Text('Reclamação ou sugestão'),
          ),
          const SizedBox(height: 24),
          Center(
            child: TextButton(
              onPressed: () => abrirLink(Contato.site),
              child: const Text('institutolorenavisentainer.com.br'),
            ),
          ),
        ],
      ),
    );
  }
}
