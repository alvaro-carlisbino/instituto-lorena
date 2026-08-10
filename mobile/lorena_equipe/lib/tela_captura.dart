import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:lorena_core/lorena_core.dart';

/// Câmera com guia de enquadramento. O parâmetro `fantasma` é o que faz a foto
/// de acompanhamento valer alguma coisa: mostra a captura anterior por baixo,
/// translúcida, para o profissional repetir o mesmo ângulo. Sem isso, comparar
/// antes e depois vira comparação de duas fotos diferentes.
class TelaCaptura extends StatefulWidget {
  const TelaCaptura({
    super.key,
    required this.titulo,
    required this.instrucao,
    this.frontal = false,
    this.fantasmaUrl,
  });

  final String titulo;
  final String instrucao;
  final bool frontal;
  final String? fantasmaUrl;

  @override
  State<TelaCaptura> createState() => _TelaCapturaState();
}

class _TelaCapturaState extends State<TelaCaptura> {
  CameraController? _ctrl;
  String? _erro;
  bool _tirando = false;
  double _opacidadeFantasma = 0.45;

  @override
  void initState() {
    super.initState();
    _iniciar();
  }

  Future<void> _iniciar() async {
    try {
      final cams = await availableCameras();
      if (cams.isEmpty) {
        setState(() => _erro = 'Nenhuma câmera disponível neste aparelho.');
        return;
      }
      final alvo = cams.firstWhere(
        (c) => widget.frontal
            ? c.lensDirection == CameraLensDirection.front
            : c.lensDirection == CameraLensDirection.back,
        orElse: () => cams.first,
      );
      final c = CameraController(alvo, ResolutionPreset.high, enableAudio: false);
      await c.initialize();
      if (!mounted) return;
      setState(() => _ctrl = c);
    } catch (e) {
      if (mounted) setState(() => _erro = 'Não foi possível abrir a câmera. Confira a permissão.');
    }
  }

  @override
  void dispose() {
    _ctrl?.dispose();
    super.dispose();
  }

  Future<void> _capturar() async {
    final c = _ctrl;
    if (c == null || _tirando) return;
    setState(() => _tirando = true);
    try {
      final f = await c.takePicture();
      if (!mounted) return;
      Navigator.of(context).pop(f);
    } catch (e) {
      if (!mounted) return;
      setState(() => _tirando = false);
      mostraErro(context, ApiErro('foto', 'Não deu para tirar a foto. Tente de novo.'));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(widget.titulo, style: const TextStyle(color: Colors.white)),
      ),
      body: _erro != null
          ? MensagemVazia(
              icone: Icons.no_photography_outlined,
              titulo: 'Câmera indisponível',
              descricao: _erro,
              acao: FilledButton.tonal(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Voltar'),
              ),
            )
          : _ctrl == null
              ? const Center(child: CircularProgressIndicator())
              : Column(
                  children: [
                    Expanded(
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          CameraPreview(_ctrl!),
                          if (widget.fantasmaUrl != null)
                            IgnorePointer(
                              child: Opacity(
                                opacity: _opacidadeFantasma,
                                child: Image.network(
                                  widget.fantasmaUrl!,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                                ),
                              ),
                            ),
                          // Guia central: ajuda a centralizar mesmo sem fantasma.
                          IgnorePointer(
                            child: Center(
                              child: FractionallySizedBox(
                                widthFactor: 0.72,
                                heightFactor: 0.62,
                                child: DecoratedBox(
                                  decoration: BoxDecoration(
                                    border: Border.all(color: Colors.white54, width: 1.5),
                                    borderRadius: BorderRadius.circular(16),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      color: Colors.black,
                      padding: const EdgeInsets.fromLTRB(20, 14, 20, 28),
                      child: Column(
                        children: [
                          Text(
                            widget.instrucao,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white70, fontSize: 13),
                          ),
                          if (widget.fantasmaUrl != null) ...[
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                const Icon(Icons.layers_outlined, color: Colors.white54, size: 18),
                                Expanded(
                                  child: Slider(
                                    value: _opacidadeFantasma,
                                    onChanged: (v) => setState(() => _opacidadeFantasma = v),
                                  ),
                                ),
                                const Text('foto anterior',
                                    style: TextStyle(color: Colors.white54, fontSize: 12)),
                              ],
                            ),
                          ],
                          const SizedBox(height: 8),
                          GestureDetector(
                            onTap: _capturar,
                            child: Container(
                              height: 74,
                              width: 74,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: Colors.white,
                                border: Border.all(color: Colors.white24, width: 6),
                              ),
                              child: _tirando
                                  ? const Padding(
                                      padding: EdgeInsets.all(20),
                                      child: CircularProgressIndicator(strokeWidth: 3),
                                    )
                                  : null,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}
