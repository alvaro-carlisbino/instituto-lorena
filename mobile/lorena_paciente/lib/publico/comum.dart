import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';

import '../conteudo.dart';

/// Peças visuais que se repetem nas telas públicas. Ficam juntas para a marca
/// não escorregar de tela em tela.

Future<void> abrirWhatsapp({String? mensagem}) async {
  final texto = mensagem == null ? '' : '?text=${Uri.encodeComponent(mensagem)}';
  await launchUrl(
    Uri.parse('https://wa.me/${Contato.whatsapp}$texto'),
    mode: LaunchMode.externalApplication,
  );
}

Future<void> abrirMapa(String busca) async {
  await launchUrl(
    Uri.parse('https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(busca)}'),
    mode: LaunchMode.externalApplication,
  );
}

Future<void> abrirLink(String url) async {
  await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
}

/// A marca oficial, o mesmo SVG do site. No escuro ela é recolorida, senão o
/// grafite do símbolo some no fundo.
class MarcaLorena extends StatelessWidget {
  const MarcaLorena({super.key, this.altura = 40, this.cor});
  final double altura;
  final Color? cor;

  @override
  Widget build(BuildContext context) {
    final tinta = cor ??
        (Theme.of(context).brightness == Brightness.dark
            ? Theme.of(context).colorScheme.onSurface
            : null);
    return SvgPicture.asset(
      'assets/marca/logo.svg',
      height: altura,
      colorFilter: tinta == null ? null : ColorFilter.mode(tinta, BlendMode.srcIn),
    );
  }
}

/// Título de seção com a régua tipográfica da marca.
class TituloSecao extends StatelessWidget {
  const TituloSecao(this.texto, {super.key, this.apoio});
  final String texto;
  final String? apoio;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (apoio != null) ...[
          Text(
            apoio!.toUpperCase(),
            style: tt.labelSmall?.copyWith(
              color: cs.onSurfaceVariant,
              fontWeight: FontWeight.w600,
              letterSpacing: 2.2,
            ),
          ),
          const SizedBox(height: 10),
        ],
        Text(texto, style: tt.headlineMedium),
      ],
    );
  }
}

class BotaoWhatsapp extends StatelessWidget {
  const BotaoWhatsapp({
    super.key,
    this.rotulo = 'Falar no WhatsApp',
    this.mensagem,
    this.tonal = false,
  });
  final String rotulo;
  final String? mensagem;
  final bool tonal;

  @override
  Widget build(BuildContext context) {
    const icone = Icon(Icons.chat_bubble_outline_rounded, size: 19);
    final label = Text(rotulo);
    return tonal
        ? OutlinedButton.icon(
            onPressed: () => abrirWhatsapp(mensagem: mensagem), icon: icone, label: label)
        : FilledButton.icon(
            onPressed: () => abrirWhatsapp(mensagem: mensagem), icon: icone, label: label);
  }
}

/// Faixa areia, que é como o site separa blocos.
class FaixaAreia extends StatelessWidget {
  const FaixaAreia({super.key, required this.filho, this.padding});
  final Widget filho;
  final EdgeInsets? padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      padding: padding ?? const EdgeInsets.fromLTRB(20, 36, 20, 36),
      child: filho,
    );
  }
}
