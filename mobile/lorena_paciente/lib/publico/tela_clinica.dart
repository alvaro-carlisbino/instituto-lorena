import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../conteudo.dart';
import 'comum.dart';

/// Quem somos, equipe, onde ficamos e como falar com a gente. O SAC entra
/// aqui e não numa aba própria: canal de atendimento escondido é canal que
/// ninguém usa, e é a mesma equipe que responde tudo.
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
          Row(
            children: [
              const MarcaLorena(tamanho: 46),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(Clinica.nome, style: tt.titleLarge),
                    Text('${Clinica.cidade} · ${Clinica.estacionamento}',
                        style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 26),
          Text(Clinica.sobre, style: tt.bodyLarge?.copyWith(height: 1.55)),

          const SizedBox(height: 36),
          const TituloSecao('Equipe médica', apoio: 'Quem cuida de você'),
          const SizedBox(height: 14),
          Card(
            child: Column(
              children: [
                for (var i = 0; i < equipe.length; i++) ...[
                  if (i > 0) const Divider(height: 1),
                  ListTile(
                    leading: CircleAvatar(
                      backgroundColor: cs.primaryContainer,
                      child: Text(
                        equipe[i].nome.replaceAll(RegExp(r'^Dra?\.\s*'), '').characters.first,
                        style: TextStyle(
                            color: cs.onPrimaryContainer, fontWeight: FontWeight.w700),
                      ),
                    ),
                    title: Text(equipe[i].nome,
                        style: tt.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                    subtitle: Text(equipe[i].atuacao),
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(height: 36),
          const TituloSecao('Onde ficamos', apoio: 'Visite a clínica'),
          const SizedBox(height: 14),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.location_on_rounded, size: 20, color: cs.primary),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(Clinica.endereco,
                                style: tt.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                            Text(Clinica.cidade,
                                style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant)),
                            const SizedBox(height: 4),
                            Text(Clinica.estacionamento,
                                style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant)),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    onPressed: () => abrirMapa(Clinica.mapsBusca),
                    icon: const Icon(Icons.map_outlined, size: 20),
                    label: const Text('Abrir no mapa'),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 36),
          const TituloSecao('Fale com a gente', apoio: 'Atendimento e SAC'),
          const SizedBox(height: 8),
          Text(
            'Agendamento, dúvida sobre tratamento, pós-operatório, elogio ou '
            'reclamação: é o mesmo caminho, e uma pessoa responde.',
            style: tt.bodyMedium?.copyWith(color: cs.onSurfaceVariant, height: 1.5),
          ),
          const SizedBox(height: 16),
          const BotaoWhatsapp(
            rotulo: 'WhatsApp da clínica',
            mensagem: 'Oi! Vim pelo app do Instituto Lorena.',
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => abrirWhatsapp(
              mensagem: 'Oi! Quero registrar uma reclamação ou sugestão sobre o '
                  'meu atendimento.',
            ),
            icon: const Icon(Icons.support_agent_rounded, size: 20),
            label: const Text('Reclamação ou sugestão'),
          ),

          const SizedBox(height: 30),
          Center(
            child: TextButton(
              onPressed: () => launchUrl(
                Uri.parse('https://www.instagram.com/institutolorenavisentainer'),
                mode: LaunchMode.externalApplication,
              ),
              child: const Text('Instagram da clínica'),
            ),
          ),
        ],
      ),
    );
  }
}
