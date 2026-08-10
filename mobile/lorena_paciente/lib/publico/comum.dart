import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';
import 'package:url_launcher/url_launcher.dart';

/// Peças visuais que se repetem nas telas públicas. Ficam juntas para a marca
/// não escorregar de tela em tela.

Future<void> abrirWhatsapp({String? mensagem}) async {
  final texto = mensagem == null ? '' : '?text=${Uri.encodeComponent(mensagem)}';
  await launchUrl(
    Uri.parse('https://wa.me/${AppBrand.paciente.suporteWhatsapp}$texto'),
    mode: LaunchMode.externalApplication,
  );
}

Future<void> abrirMapa(String busca) async {
  await launchUrl(
    Uri.parse('https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(busca)}'),
    mode: LaunchMode.externalApplication,
  );
}

/// Marca desenhada, não ícone de biblioteca: três folículos saindo de uma
/// mesma base, que é a ideia do transplante.
class MarcaLorena extends StatelessWidget {
  const MarcaLorena({super.key, this.tamanho = 44, this.cor});
  final double tamanho;
  final Color? cor;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: tamanho,
      height: tamanho,
      child: CustomPaint(
        painter: _MarcaPainter(cor ?? Theme.of(context).colorScheme.primary),
      ),
    );
  }
}

class _MarcaPainter extends CustomPainter {
  _MarcaPainter(this.cor);
  final Color cor;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = cor
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = size.width * 0.075;

    final baseX = size.width / 2;
    final baseY = size.height * 0.88;

    for (final inclinacao in [-0.34, 0.0, 0.34]) {
      final caminho = Path()..moveTo(baseX, baseY);
      caminho.cubicTo(
        baseX + inclinacao * size.width * 0.85, baseY - size.height * 0.34,
        baseX + inclinacao * size.width * 1.15, baseY - size.height * 0.55,
        baseX + inclinacao * size.width * 0.62, baseY - size.height * 0.74,
      );
      canvas.drawPath(caminho, p);
    }

    canvas.drawCircle(
      Offset(baseX, baseY),
      size.width * 0.055,
      Paint()..color = cor,
    );
  }

  @override
  bool shouldRepaint(_MarcaPainter old) => old.cor != cor;
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
              color: cs.primary,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.4,
            ),
          ),
          const SizedBox(height: 8),
        ],
        Text(texto, style: tt.headlineMedium),
      ],
    );
  }
}

class BotaoWhatsapp extends StatelessWidget {
  const BotaoWhatsapp({super.key, this.rotulo = 'Falar no WhatsApp', this.mensagem, this.tonal = false});
  final String rotulo;
  final String? mensagem;
  final bool tonal;

  @override
  Widget build(BuildContext context) {
    final icone = const Icon(Icons.chat_bubble_rounded, size: 20);
    final label = Text(rotulo);
    return tonal
        ? FilledButton.tonalIcon(onPressed: () => abrirWhatsapp(mensagem: mensagem), icon: icone, label: label)
        : FilledButton.icon(onPressed: () => abrirWhatsapp(mensagem: mensagem), icon: icone, label: label);
  }
}
